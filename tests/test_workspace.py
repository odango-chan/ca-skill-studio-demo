"""Caller-driven polling plus explicitly non-atomic multi-file save regression."""
import os
from pathlib import Path

import pytest

from skill_studio_poc.session import EditorSession, EditRejected
from skill_studio_poc.storage import FileSaveRejected
from skill_studio_poc.workspace import (
    WorkspaceWatcher, BatchSaveUncertain, save_batch,
)
import skill_studio_poc.workspace as workspace


def source(name):
    return f"""# {name}
procedures:
  {name}:
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
    root = tmp_path / 'skill'
    assurance = root / 'assurance'
    assurance.mkdir(parents=True)
    staging = tmp_path / 'private-staging'
    staging.mkdir(mode=0o700)
    paths = [assurance / f'{name}.yaml' for name in ('contract', 'procedure', 'predicates')]
    for path in paths:
        path.write_text(source(path.stem), encoding='utf-8')
    sessions = {p: EditorSession.open(p.read_text()) for p in paths}
    return root, staging, paths, sessions


def edit_sessions(sessions):
    return {p: s.source_edit(s.working_text.replace('subject.valid', 'subject.ready')) for p, s in sessions.items()}


def test_watch_clean_baseline_and_no_sidecar(layout):
    root, _, paths, sessions = layout
    watcher = WorkspaceWatcher(sessions)
    assert [e.kind for e in watcher.poll()] == ['UNCHANGED'] * 3
    assert not watcher.blocked_paths
    assert set(root.joinpath('assurance').iterdir()) == set(paths)


def test_watch_content_change_preserves_unsaved_text(layout):
    _, _, paths, sessions = layout
    watcher = WorkspaceWatcher(edit_sessions(sessions))
    target = paths[1]
    external = source(target.stem) + '# changed externally\n'
    target.write_text(external)
    events = {e.path: e for e in watcher.poll()}
    assert events[target].kind == 'CONTENT_CHANGED'
    assert target in watcher.blocked_paths
    assert watcher.sessions[target].is_conflicted
    assert 'subject.ready' in watcher.sessions[target].working_text
    assert watcher.sessions[target].external_text == external
    with pytest.raises(EditRejected):
        watcher.sessions[target].prepare_save(external)
    target.write_text(source(target.stem))
    assert dict((e.path, e.kind) for e in watcher.poll())[target] == 'CONTENT_CHANGED'
    assert not watcher.blocked_paths


def test_watch_inode_replacement_same_contents_is_visible(layout):
    _, staging, paths, sessions = layout
    watcher = WorkspaceWatcher(sessions)
    target = paths[0]
    other = staging / 'replacement'
    other.write_text(target.read_text())
    os.replace(other, target)
    kinds = {e.path: e.kind for e in watcher.poll()}
    assert kinds[target] == 'REPLACED_SAME_CONTENT'
    assert not watcher.blocked_paths


def test_watch_missing_then_recovered(layout):
    _, _, paths, sessions = layout
    watcher = WorkspaceWatcher(sessions)
    target = paths[0]
    original = target.read_text()
    target.unlink()
    assert {e.path:e.kind for e in watcher.poll()}[target] == 'UNAVAILABLE'
    assert target in watcher.blocked_paths
    target.write_text(original)
    assert {e.path:e.kind for e in watcher.poll()}[target] == 'REPLACED_SAME_CONTENT'
    assert target not in watcher.blocked_paths


def test_watch_rejects_stale_start_and_adopt_checks_disk(layout):
    _, _, paths, sessions = layout
    target = paths[1]
    target.write_text('changed: true\n')
    with pytest.raises(FileSaveRejected, match='baseline'):
        WorkspaceWatcher(sessions)
    target.write_text(source(target.stem))
    watcher = WorkspaceWatcher(sessions)
    altered = edit_sessions(sessions)
    with pytest.raises(FileSaveRejected, match='does not match'):
        watcher.adopt_saved(altered)


def test_batch_commits_three_files_and_avoids_digest_temps(layout):
    root, staging, paths, sessions = layout
    changed = edit_sessions(sessions)
    saved = save_batch(changed, package_root=root, staging_dir=staging)
    for p in paths:
        assert p.read_text() == changed[p].working_text
        assert not saved[p].is_dirty
        assert saved[p].undo().is_dirty
    assert list(staging.iterdir()) == []
    assert set(root.joinpath('assurance').iterdir()) == set(paths)


def test_batch_clean_no_replace(layout, monkeypatch):
    root, stage, paths, sessions = layout
    before = {p:p.stat().st_ino for p in paths}
    def forbidden(*args):
        raise AssertionError('clean batch should not replace anything')
    monkeypatch.setattr(workspace.os, 'replace', forbidden)
    output = save_batch(sessions, package_root=root, staging_dir=stage)
    assert all(not s.is_dirty for s in output.values())
    assert before == {p:p.stat().st_ino for p in paths}


def test_batch_drift_preflight_rejects_all(layout):
    root, stage, paths, sessions = layout
    changed = edit_sessions(sessions)
    paths[-1].write_text('changed: externally\n')
    with pytest.raises(EditRejected, match='disk changed'):
        save_batch(changed, package_root=root, staging_dir=stage)
    assert paths[0].read_text() == source('contract')
    assert paths[1].read_text() == source('procedure')
    assert not list(stage.iterdir())


def test_batch_failure_during_staging_preserves_originals(layout, monkeypatch):
    root, stage, paths, sessions = layout
    original_fsync = workspace.os.fsync
    calls = 0
    def fail_stage(fd):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError('stage fsync fault')
        return original_fsync(fd)
    monkeypatch.setattr(workspace.os, 'fsync', fail_stage)
    with pytest.raises(OSError, match='stage fsync fault'):
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    assert all(p.read_text() == source(p.stem) for p in paths)
    assert not list(stage.iterdir())


def test_batch_partial_second_replace_reports_which_file(layout, monkeypatch):
    root, stage, paths, sessions = layout
    real_replace = workspace.os.replace
    count = 0
    def fail_second(src, dst):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError('injected second rename failure')
        return real_replace(src, dst)
    monkeypatch.setattr(workspace.os, 'replace', fail_second)
    with pytest.raises(BatchSaveUncertain, match='incomplete') as caught:
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    assert caught.value.replaced_paths == (sorted(paths)[0],)
    assert paths[0].read_text() != source(paths[0].stem)
    assert paths[1].read_text() == source(paths[1].stem)
    assert paths[2].read_text() == source(paths[2].stem)
    assert not list(stage.iterdir())


def test_batch_post_replace_dir_fsync_failure_uncertain_all(layout, monkeypatch):
    root, stage, paths, sessions = layout
    fsync = workspace.os.fsync
    count = 0
    def fail_last(fd):
        nonlocal count
        count += 1
        if count == 4:
            raise OSError('directory fsync failed')
        return fsync(fd)
    monkeypatch.setattr(workspace.os, 'fsync', fail_last)
    with pytest.raises(BatchSaveUncertain) as e:
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    assert e.value.replaced_paths == tuple(sorted(paths))
    assert all('subject.ready' in p.read_text() for p in paths)
    assert not list(stage.iterdir())


def test_batch_injected_external_change_before_first_replace(layout, monkeypatch):
    root, stage, paths, sessions = layout
    original = workspace._check_pre_replace
    calls = 0
    def race(path, snapshot):
        nonlocal calls
        calls += 1
        if calls == len(paths):
            path.write_text(source(path.stem) + '# race\n')
        return original(path, snapshot)
    monkeypatch.setattr(workspace, '_check_pre_replace', race)
    with pytest.raises(FileSaveRejected, match='source changed'):
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    assert paths[0].read_text() == source('contract')
    assert paths[1].read_text().endswith('# race\n')
    assert paths[-1].read_text() == source('predicates')
    assert not list(stage.iterdir())


def test_batch_rejects_staging_inside_package(layout):
    root, _, paths, sessions = layout
    stage = root / 'staging'
    stage.mkdir(mode=0o700)
    with pytest.raises(FileSaveRejected, match='outside'):
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    assert not list(stage.iterdir())


def test_batch_rejects_world_readable_staging(layout):
    root, stage, paths, sessions = layout
    stage.chmod(0o755)
    with pytest.raises(FileSaveRejected, match='private'):
        save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)


def test_batch_rejects_different_parent_and_missing_file(layout):
    root, stage, paths, sessions = layout
    other = root / 'other'
    other.mkdir()
    extra = other / 'extra.yaml'
    extra.write_text(source('extra'))
    altered = dict(sessions)
    altered[extra] = EditorSession.open(extra.read_text())
    with pytest.raises(FileSaveRejected, match='single parent'):
        save_batch(altered, package_root=root, staging_dir=stage)
    paths[0].unlink()
    with pytest.raises(FileSaveRejected):
        save_batch(sessions, package_root=root, staging_dir=stage)


def test_batch_save_source_only_createdsession_remains_nonvisual(layout):
    root, stage, paths, sessions = layout
    changed = dict(sessions)
    first, second = paths[:2]
    changed[first] = EditorSession.open(first.read_text(), profile='establish-pdu-session').source_edit(first.read_text()+'# source only\n')
    changed[second] = sessions[second].source_edit(sessions[second].working_text+'# source only\n')
    saved = save_batch(changed, package_root=root, staging_dir=stage)
    assert not saved[first].is_dirty
    from skill_studio_poc.patch import TypedPatch, PatchRejected
    with pytest.raises(PatchRejected, match='Source-only'):
        saved[first].preview_visual(TypedPatch('AddRoute', saved[first].source_revision,'contract',node='check',outcome='FAIL',target='done',profile='establish-pdu-session'))


def test_watch_re_adopts_after_batch_save(layout):
    root, stage, paths, sessions = layout
    watcher = WorkspaceWatcher(sessions)
    saved = save_batch(edit_sessions(sessions), package_root=root, staging_dir=stage)
    watcher.adopt_saved(saved)
    assert [e.kind for e in watcher.poll()] == ['UNCHANGED']*3
    assert not watcher.blocked_paths


def test_batch_real_ensure_procedure_with_contract_predicate_sources(layout):
    """Mixed assurance source shapes must not be coerced to Procedure YAML."""
    root, stage, paths, _ = layout
    from pathlib import Path
    fixture = (Path(__file__).resolve().parents[1] /
               'fixtures/baseline/ensure-pdu-session/procedure.yaml')
    paths[1].write_bytes(fixture.read_bytes())
    paths[0].write_text('apiVersion: example/v1\nkind: SkillContract\n# original\nspec:\n  entryProcedure: ensure\n')
    paths[2].write_text('apiVersion: example/v1\nkind: PredicateSet\n# original\npredicates: {}\n')
    sessions = {p:EditorSession.open(p.read_text()) for p in paths}
    changed = {p:s.source_edit(s.working_text+'# deliberately edited\n') for p,s in sessions.items()}
    result = save_batch(changed, package_root=root, staging_dir=stage)
    assert all(not s.is_dirty for s in result.values())
    assert paths[1].read_text() == fixture.read_text()+'# deliberately edited\n'
    assert paths[0].read_text().startswith('apiVersion:')
    assert paths[2].read_text().startswith('apiVersion:')
    assert not list(stage.iterdir())
    assert set(paths[1].parent.iterdir()) == set(paths)


def test_batch_preserves_mixed_crlf_bom_and_modes(layout):
    root, stage, paths, _ = layout
    text0 = '\ufeff'+source('contract').replace('\n','\r\n')
    paths[0].write_bytes(text0.encode('utf-8'))
    paths[0].chmod(0o640)
    sessions={p:EditorSession.open(p.read_bytes().decode('utf-8')) for p in paths}
    changed={p:s.source_edit(s.working_text+'# note\r\n' if p==paths[0] else s.working_text+'# note\n') for p,s in sessions.items()}
    saved=save_batch(changed,package_root=root,staging_dir=stage)
    assert paths[0].read_bytes() == saved[paths[0]].working_text.encode('utf-8')
    assert paths[0].read_bytes().startswith(b'\xef\xbb\xbf')
    assert (paths[0].stat().st_mode & 0o777) == 0o640
    assert not list(stage.iterdir())


def test_batch_rejects_invalid_source_before_staging(layout):
    root,stage,paths,sessions=layout
    changed=edit_sessions(sessions)
    changed[paths[-1]]=sessions[paths[-1]].source_edit('procedures: [invalid\n')
    with pytest.raises(EditRejected, match='invalid Source'):
        save_batch(changed,package_root=root,staging_dir=stage)
    assert all(p.read_text()==source(p.stem) for p in paths)
    assert not list(stage.iterdir())


def test_batch_saves_only_modified_files(layout):
    root,stage,paths,sessions=layout
    ino={p:p.stat().st_ino for p in paths}
    changed=dict(sessions)
    changed[paths[1]]=sessions[paths[1]].source_edit(sessions[paths[1]].working_text+'# changed\n')
    result=save_batch(changed,package_root=root,staging_dir=stage)
    assert paths[1].stat().st_ino!=ino[paths[1]]
    assert paths[0].stat().st_ino==ino[paths[0]]
    assert paths[2].stat().st_ino==ino[paths[2]]
    assert not any(s.is_dirty for s in result.values())
