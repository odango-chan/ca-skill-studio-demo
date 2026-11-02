from pathlib import Path
import os
import pytest
from skill_studio_poc.package_guard import (
    capture_package, assert_opaque_unchanged, write_recovery_intent,
    inspect_recovery, PackageGuardError,
)


@pytest.fixture
def workspace(tmp_path):
    root = tmp_path / 'skill'
    (root / 'assurance').mkdir(parents=True)
    (root / 'assurance/contract.yaml').write_bytes(b'old contract\n')
    (root / 'assurance/procedure.yaml').write_bytes(b'old proc\n')
    (root / 'assurance/predicates.yaml').write_bytes(b'old predicates\n')
    (root / 'notes.dat').write_bytes(b'\xff opaque\x00 bytes')
    stage = tmp_path / 'private'
    stage.mkdir(mode=0o700)
    return root, stage


def test_includes_opaque_assets_and_is_deterministic(workspace):
    root, _ = workspace
    a = capture_package(root)
    b = capture_package(root)
    assert a == b
    assert set(a.hashes) == {'assurance/contract.yaml', 'assurance/procedure.yaml', 'assurance/predicates.yaml','notes.dat'}
    assert len(a.fingerprint) == 64


def test_opaque_change_and_add_delete_detected(workspace):
    root, _ = workspace
    original = capture_package(root)
    (root / 'notes.dat').write_bytes(b'changed')
    with pytest.raises(PackageGuardError, match='notes.dat'):
        assert_opaque_unchanged(original, capture_package(root), {'assurance/contract.yaml'})
    (root / 'notes.dat').unlink()
    (root / 'extra.txt').write_text('extra')
    with pytest.raises(PackageGuardError):
        assert_opaque_unchanged(original, capture_package(root), {'assurance/contract.yaml'})


def test_known_changes_can_be_filtered(workspace):
    root, _ = workspace
    old = capture_package(root)
    (root / 'assurance/procedure.yaml').write_text('new proc')
    assert_opaque_unchanged(old, capture_package(root), {'assurance/procedure.yaml'})


@pytest.mark.parametrize('type', ['symlink-file', 'symlink-dir', 'hardlink', 'fifo'])
def test_unsafe_assets_fail_closed(workspace, type):
    root, stage = workspace
    if type == 'symlink-file':
        (root / 'link').symlink_to(stage)
    elif type == 'symlink-dir':
        (root / 'link').symlink_to(stage, target_is_directory=True)
    elif type == 'hardlink':
        os.link(root / 'assurance/contract.yaml', root / 'contract-copy.yaml')
    else:
        os.mkfifo(root / 'named-pipe')
    with pytest.raises(PackageGuardError):
        capture_package(root)


def _intent(workspace):
    root, stage = workspace
    snapshot = capture_package(root)
    updates = {'assurance/contract.yaml': b'new contract\n',
               'assurance/procedure.yaml': b'new proc\n'}
    return root, stage, write_recovery_intent(stage, snapshot, updates)


def test_journal_outside_package_and_not_applied(workspace):
    root, stage, journal = _intent(workspace)
    assert journal.is_file()
    assert journal.parent == stage
    assert journal.stat().st_mode & 0o077 == 0
    assert list(root.rglob('*.json')) == []
    result = inspect_recovery(journal, root)
    assert result.status == 'NOT_APPLIED'
    assert len(result.old_paths) == 2
    assert len(result.new_paths) == 0


def test_partial_after_first_rename_and_full_new_are_not_auto_success(workspace):
    root, _, journal = _intent(workspace)
    (root / 'assurance/contract.yaml').write_bytes(b'new contract\n')
    result = inspect_recovery(journal, root)
    assert result.status == 'PARTIAL'
    assert result.new_paths == ('assurance/contract.yaml',)
    (root / 'assurance/procedure.yaml').write_bytes(b'new proc\n')
    assert inspect_recovery(journal, root).status == 'ALL_NEW_UNCONFIRMED'


def test_unknown_source_or_opaque_drift_is_diverged(workspace):
    root, _, journal = _intent(workspace)
    (root / 'assurance/contract.yaml').write_bytes(b'unknown')
    assert inspect_recovery(journal, root).status == 'DIVERGED'
    (root / 'assurance/contract.yaml').write_bytes(b'old contract\n')
    (root / 'notes.dat').write_bytes(b'opaque drift')
    assert inspect_recovery(journal, root).opaque_drift == ('notes.dat',)


def test_missing_target_is_reported_diverged(workspace):
    root, _, journal = _intent(workspace)
    (root / 'assurance/procedure.yaml').unlink()
    r = inspect_recovery(journal, root)
    assert r.status == 'DIVERGED'
    assert 'assurance/procedure.yaml' in r.other_paths


def test_external_stage_path_checks(workspace, tmp_path):
    root, stage = workspace
    snapshot = capture_package(root)
    updates = {'assurance/procedure.yaml': b'new'}
    with pytest.raises(PackageGuardError):
        write_recovery_intent(root / 'assurance', snapshot, updates)
    stage.chmod(0o755)
    with pytest.raises(PackageGuardError):
        write_recovery_intent(stage, snapshot, updates)


def test_reject_invalid_change_keys(workspace):
    root, stage = workspace
    before = capture_package(root)
    for name in ['../outside', '/etc/passwd', 'missing.yaml', 'assurance/../x']:
        with pytest.raises(PackageGuardError):
            write_recovery_intent(stage, before, {name: b'new'})


def test_corrupted_and_wrong_root_rejected(workspace, tmp_path):
    root, _, journal = _intent(workspace)
    with pytest.raises(PackageGuardError, match='root'):
        inspect_recovery(journal, tmp_path)
    journal.write_text('{}')
    with pytest.raises(PackageGuardError, match='shape'):
        inspect_recovery(journal, root)


def test_symlink_journal_rejected(workspace):
    root, stage, journal = _intent(workspace)
    link = stage / 'link.json'
    link.symlink_to(journal)
    with pytest.raises(PackageGuardError, match='record'):
        inspect_recovery(link, root)
