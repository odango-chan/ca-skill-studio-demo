from pathlib import Path
from dataclasses import replace
import pytest

from skill_studio_poc.package_guard import capture_package, PackageGuardError, inspect_recovery
from skill_studio_poc.session import EditorSession
from skill_studio_poc.workspace import BatchSaveUncertain
import skill_studio_poc.recovery_batch as rb

@pytest.fixture
def world(tmp_path):
    root = tmp_path / 'skill'
    assurance = root / 'assurance'
    assurance.mkdir(parents=True)
    paths = [assurance / n for n in ('contract.yaml','procedure.yaml','predicates.yaml')]
    def valid_source(name):
        return ("procedures:\n  example:\n    start: check\n    nodes:\n"
                "      check:\n        verify: subject.valid\n        on:\n"
                "          PASS: done\n      done:\n        terminal: SUCCEEDED\n"
                f"# {name}\n")
    for p in paths:
        p.write_text(valid_source(p.name))
    (root / 'SKILL.md').write_text('opaque')
    stage = tmp_path / 'stage'
    stage.mkdir(mode=0o700)
    expected = capture_package(root)
    sess = {p: EditorSession.open(p.read_text()).source_edit(p.read_text() + '# updated\n') for p in paths}
    return root,stage,expected,sess


def test_success_clears_intent_and_changes_files(world):
    root,stage,before,sess = world
    result=rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    assert set(result)==set(sess)
    assert all(p.read_text()==s.working_text for p,s in sess.items())
    assert list(stage.iterdir()) == []


def test_opaque_drift_blocks_before_saving(world):
    root,stage,before,sess=world
    (root/'SKILL.md').write_text('changed')
    with pytest.raises(PackageGuardError,match='other package files changed'):
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    assert all(p.read_text()==s.saved_text for p,s in sess.items())


def test_managed_drift_blocks_even_when_editor_saved_baseline_matches_current(world):
    root,stage,before,sess=world
    path=next(iter(sess))
    path.write_text('changed externally')
    sess[path]=replace(sess[path], saved_text='changed externally')
    with pytest.raises(PackageGuardError,match='managed source changed'):
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)


def test_partial_save_leaves_journal_and_detects_state(world,monkeypatch):
    root,stage,before,sess=world
    path=next(iter(sess))
    def fail(*args,**kwargs):
        path.write_text(sess[path].working_text)
        raise BatchSaveUncertain((path,), OSError('partial'))
    monkeypatch.setattr(rb,'save_batch',fail)
    with pytest.raises(rb.RecoveryRequired,match='PARTIAL') as error:
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    assert error.value.journal.exists()
    assessment=inspect_recovery(error.value.journal,root)
    assert assessment.status == 'PARTIAL'
    assert list(root.rglob('skillstudio-recovery-*')) == []
    with pytest.raises(PackageGuardError,match='unresolved recovery'):
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)


def test_pre_replace_exception_cleans_journal_and_keeps_original_error(world,monkeypatch):
    root,stage,before,sess=world
    def fail(*args,**kwargs):
        raise ValueError('preflight')
    monkeypatch.setattr(rb,'save_batch',fail)
    with pytest.raises(ValueError,match='preflight'):
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    assert list(stage.iterdir()) == []


def test_all_new_but_writer_throws_is_uncertain_and_keeps_journal(world,monkeypatch):
    root,stage,before,sess=world
    def fail(*args,**kwargs):
        for p,s in sess.items():p.write_text(s.working_text)
        raise BatchSaveUncertain(tuple(sess), OSError('dir sync'))
    monkeypatch.setattr(rb,'save_batch',fail)
    with pytest.raises(rb.RecoveryRequired) as error:
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    assert inspect_recovery(error.value.journal,root).status == 'ALL_NEW_UNCONFIRMED'


def test_reject_wrong_package_baseline(world,tmp_path):
    root,stage,before,sess=world
    other=tmp_path/'other';other.mkdir()
    with pytest.raises(PackageGuardError):
        rb.save_batch_recoverable(sess,package_root=other,staging_dir=stage,expected_package=before)


def test_keyboard_interrupt_preserves_intent_for_crash_recovery(world,monkeypatch):
    root,stage,before,sess=world
    def interrupted(*args,**kwargs):
        raise KeyboardInterrupt('stopped during save')
    monkeypatch.setattr(rb,'save_batch',interrupted)
    with pytest.raises(KeyboardInterrupt):
        rb.save_batch_recoverable(sess,package_root=root,staging_dir=stage,expected_package=before)
    records = list(stage.glob('skillstudio-recovery-*.json'))
    assert len(records)==1
    assert inspect_recovery(records[0],root).status == 'NOT_APPLIED'
