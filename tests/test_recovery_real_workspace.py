"""Integration of real workspace.save_batch with durable package recovery.

The Studio package modules are imported directly. No stubbed batch writer.
"""
import pytest

from skill_studio_poc.package_guard import (
    PackageGuardError, capture_package, inspect_recovery,
)
from skill_studio_poc.recovery_batch import RecoveryRequired, save_batch_recoverable
from skill_studio_poc.session import EditorSession
import skill_studio_poc.workspace as workspace

SOURCE = """procedures:
  example:
    start: check
    nodes:
      check:
        verify: subject.valid
        on:
          PASS: done
      done:
        terminal: SUCCEEDED
"""


@pytest.fixture
def layout(tmp_path):
    root = tmp_path / "skill"
    base = root / "assurance"
    base.mkdir(parents=True)
    paths = [base / name for name in ("contract.yaml", "procedure.yaml", "predicates.yaml")]
    for path in paths:
        path.write_text(SOURCE, encoding="utf-8")
    (root / "SKILL.md").write_text("# opaque package document\n", encoding="utf-8")
    stage = tmp_path / "private"
    stage.mkdir(mode=0o700)
    baseline = capture_package(root)
    sessions = {
        path: EditorSession.open(path.read_text()).source_edit(
            path.read_text() + f"# changed {path.name}\n"
        )
        for path in paths
    }
    return root, stage, baseline, sessions


def test_recovery_wrapper_with_real_batch_writer(layout):
    root, stage, baseline, sessions = layout
    results = save_batch_recoverable(
        sessions, package_root=root, staging_dir=stage, expected_package=baseline
    )
    assert all(
        results[path].saved_text == session.working_text == path.read_text()
        for path, session in sessions.items()
    )
    assert list(stage.iterdir()) == []
    assert set(capture_package(root).hashes) == set(baseline.hashes)


def test_actual_second_rename_failure_requires_reconciliation(layout, monkeypatch):
    root, stage, baseline, sessions = layout
    actual_replace = workspace.os.replace
    count = 0

    def second_rename_fails(old, new):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("injected second replace failure")
        return actual_replace(old, new)

    monkeypatch.setattr(workspace.os, "replace", second_rename_fails)
    with pytest.raises(RecoveryRequired) as caught:
        save_batch_recoverable(
            sessions, package_root=root, staging_dir=stage, expected_package=baseline
        )
    assessment = inspect_recovery(caught.value.journal, root)
    assert assessment.status == "PARTIAL"
    assert len(assessment.new_paths) == 1 and len(assessment.old_paths) == 2
    assert not list(root.rglob("skillstudio-recovery-*"))
    with pytest.raises(PackageGuardError, match="unresolved recovery"):
        save_batch_recoverable(
            sessions, package_root=root, staging_dir=stage, expected_package=baseline
        )


def test_actual_batch_detects_racing_uncooperative_edit(layout, monkeypatch):
    root, stage, baseline, sessions = layout
    original = workspace._check_pre_replace
    changed = False

    def external_edit(path, snapshot):
        nonlocal changed
        if not changed:
            changed = True
            path.write_text(path.read_text() + "# external writer\n")
        original(path, snapshot)

    monkeypatch.setattr(workspace, "_check_pre_replace", external_edit)
    with pytest.raises(RecoveryRequired) as caught:
        save_batch_recoverable(
            sessions, package_root=root, staging_dir=stage, expected_package=baseline
        )
    assert inspect_recovery(caught.value.journal, root).status == "DIVERGED"
    assert all(
        path.read_text() == sessions[path].saved_text
        for path in sessions
        if "# external writer" not in path.read_text()
    )


def test_actual_batch_interrupted_before_first_rename_retains_intent(layout, monkeypatch):
    root, stage, baseline, sessions = layout

    def interrupted(*args):
        raise KeyboardInterrupt("simulated process interruption")

    monkeypatch.setattr(workspace.os, "replace", interrupted)
    with pytest.raises(KeyboardInterrupt):
        save_batch_recoverable(
            sessions, package_root=root, staging_dir=stage, expected_package=baseline
        )
    intents = list(stage.glob("skillstudio-recovery-*.json"))
    assert len(intents) == 1
    assert inspect_recovery(intents[0], root).status == "NOT_APPLIED"
