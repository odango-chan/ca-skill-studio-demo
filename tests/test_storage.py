"""POSIX single-file persistence regression for the Skill Studio POC."""
import os
from pathlib import Path
import stat

import pytest

from skill_studio_poc.session import EditorSession, EditRejected
from skill_studio_poc.storage import (
    FileSaveRejected, FileSaveUncertain, load_session, observe_session,
    save_session,
)
import skill_studio_poc.storage as storage


BASE = """procedures:
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
def doc(tmp_path):
    path = tmp_path / 'procedure.yaml'
    path.write_text(BASE, encoding='utf-8')
    return path


def _edit(s):
    return s.source_edit(s.working_text.replace('subject.valid', 'subject.ready'))


def _tmp_files(path):
    return list(path.parent.glob(f'.{path.name}.skillstudio-*'))


def test_write_uses_atomic_replace_and_cleans_temp_preserves_mode(doc):
    os.chmod(doc, 0o640)
    before_inode = doc.stat().st_ino
    initial = load_session(doc)
    changed = _edit(initial)
    saved = save_session(doc, changed)
    assert saved.working_text == doc.read_text(encoding='utf-8')
    assert not saved.is_dirty and saved.undo().is_dirty
    assert doc.stat().st_ino != before_inode
    assert stat.S_IMODE(doc.stat().st_mode) == 0o640
    assert not _tmp_files(doc)
    assert set(doc.parent.iterdir()) == {doc}  # no lock sidecar in Skill Package


def test_clean_save_does_not_rewrite_file(doc):
    original_inode = doc.stat().st_ino
    saved = save_session(doc, load_session(doc))
    assert not saved.is_dirty and doc.stat().st_ino == original_inode
    assert not _tmp_files(doc)


def test_external_edit_rejected_and_working_copy_unmodified(doc):
    s = _edit(load_session(doc))
    external = BASE + '# external writer\n'
    doc.write_text(external, encoding='utf-8')
    with pytest.raises(EditRejected, match='disk changed'):
        save_session(doc, s)
    assert doc.read_text() == external and s.working_text != external
    observed = observe_session(doc, s)
    assert observed.is_conflicted
    with pytest.raises(EditRejected, match='conflict'):
        save_session(doc, observed)


def test_manual_resolution_can_be_saved_after_new_disk_baseline(doc):
    s = _edit(load_session(doc))
    external = BASE + '# their change\n'
    doc.write_text(external, encoding='utf-8')
    conflict = observe_session(doc, s)
    resolved = conflict.resolve_manual(external, s.working_text + '# their change\n')
    done = save_session(doc, resolved)
    assert not done.is_dirty
    assert doc.read_text() == done.working_text


def test_pre_replace_external_race_fails_without_overwrite(doc, monkeypatch):
    original_guard = storage._check_pre_replace
    s = _edit(load_session(doc))
    external = BASE + '# raced\n'

    def race(path, before):
        path.write_text(external, encoding='utf-8')
        original_guard(path, before)

    monkeypatch.setattr(storage, '_check_pre_replace', race)
    with pytest.raises(FileSaveRejected, match='between temporary'):
        save_session(doc, s)
    assert doc.read_text(encoding='utf-8') == external
    assert s.is_dirty and not _tmp_files(doc)


def test_failed_replace_keeps_original_and_unsaved_buffer(doc, monkeypatch):
    s = _edit(load_session(doc))
    def deny(*args):
        raise OSError('injected failure before atomic replace')
    monkeypatch.setattr(storage.os, 'replace', deny)
    with pytest.raises(OSError, match='injected failure'):
        save_session(doc, s)
    assert doc.read_text() == BASE and s.is_dirty and not _tmp_files(doc)


def test_failure_after_replace_requires_observe_not_rollback(doc, monkeypatch):
    s = _edit(load_session(doc))
    original_fsync = storage.os.fsync
    calls = 0
    def fsync(fd):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError('injected directory fsync failure')
        return original_fsync(fd)
    monkeypatch.setattr(storage.os, 'fsync', fsync)
    with pytest.raises(FileSaveUncertain, match='re-read disk'):
        save_session(doc, s)
    # Rename happened, even though the caller did not receive an ack.
    assert doc.read_text() == s.working_text and s.is_dirty
    assert not _tmp_files(doc)
    observed = observe_session(doc, s)
    assert observed.is_conflicted


def test_symlink_and_hardlink_rejected(tmp_path, doc):
    target = tmp_path / 'symlink.yaml'
    target.symlink_to(doc)
    with pytest.raises(FileSaveRejected):
        load_session(target)
    hard = tmp_path / 'hard.yaml'
    os.link(doc, hard)
    with pytest.raises(FileSaveRejected, match='hardlinked'):
        load_session(doc)
    assert doc.read_text() == BASE


def test_invalid_utf8_or_missing_file_rejected(tmp_path):
    path = tmp_path / 'invalid.yaml'
    path.write_bytes(b'\xff\xfe')
    with pytest.raises(FileSaveRejected, match='UTF-8'):
        load_session(path)
    with pytest.raises(FileSaveRejected):
        load_session(tmp_path / 'missing.yaml')


def test_crlf_bom_preserved_after_real_save(doc):
    text = '\ufeff' + BASE.replace('\n', '\r\n')
    doc.write_bytes(text.encode('utf-8'))
    s = load_session(doc)
    saved = save_session(doc, _edit(s))
    assert doc.read_bytes() == saved.working_text.encode('utf-8')
    assert saved.working_text.startswith('\ufeff')
    assert '\r\n' in saved.working_text


def test_real_ensure_fixture_copy_remains_parseable(doc):
    fixture = Path(__file__).resolve().parents[1] / 'fixtures/baseline/ensure-pdu-session/procedure.yaml'
    doc.write_bytes(fixture.read_bytes())
    s = load_session(doc)
    edited = s.source_edit(s.working_text + '# locally edited\n')
    saved = save_session(doc, edited)
    assert saved.working_text == fixture.read_text() + '# locally edited\n'
    assert fixture.read_bytes() != doc.read_bytes()


def test_invalid_yaml_draft_is_not_saved(doc):
    s = load_session(doc).source_edit('procedures: [bad\n')
    with pytest.raises(EditRejected, match='invalid Source'):
        save_session(doc, s)
    assert doc.read_text() == BASE


def test_symlinked_parent_directory_is_rejected(tmp_path):
    real = tmp_path / 'real'
    real.mkdir()
    (real / 'procedure.yaml').write_text(BASE)
    symlink = tmp_path / 'symlink-parent'
    symlink.symlink_to(real, target_is_directory=True)
    with pytest.raises(FileSaveRejected, match='lock'):
        load_session(symlink / 'procedure.yaml')
    assert (real / 'procedure.yaml').read_text() == BASE


def test_cooperating_file_lock_held_during_final_check(doc, monkeypatch):
    import fcntl
    s = _edit(load_session(doc))
    original_check = storage._check_pre_replace
    seen_lock = False

    def check(path, snapshot):
        nonlocal seen_lock
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with pytest.raises(BlockingIOError):
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            seen_lock = True
        finally:
            os.close(fd)
        original_check(path, snapshot)

    monkeypatch.setattr(storage, '_check_pre_replace', check)
    saved = save_session(doc, s)
    assert seen_lock and not saved.is_dirty


def test_direct_observation_retains_dirty_working_buffer(doc):
    session = _edit(load_session(doc))
    doc.write_text(BASE + '# external\n')
    changed = observe_session(doc, session)
    assert changed.is_conflicted and changed.working_text == session.working_text
    doc.write_text(BASE)
    restored = observe_session(doc, changed)
    assert not restored.is_conflicted
    assert restored.working_text == session.working_text
