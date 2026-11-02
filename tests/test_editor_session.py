"""Source/Visual in-memory transaction and conflict tests; no file writes."""
from dataclasses import replace
from pathlib import Path

import pytest

from skill_studio_poc.patch import PatchRejected, TypedPatch
from skill_studio_poc.session import EditRejected, EditorSession

ROOT = Path(__file__).resolve().parents[1]
ENSURE = ROOT / 'fixtures/baseline/ensure-pdu-session/procedure.yaml'
ESTABLISH = ROOT / 'fixtures/baseline/establish-pdu-session/procedure.yaml'
BASE = '''procedures:\n  example:\n    start: check\n    nodes:\n      check:\n        verify: subject.valid\n        on:\n          PASS: done\n      done:\n        terminal: SUCCEEDED\n'''


def replace_predicate(source, text='subject.ready'):
    return source.replace('subject.valid', text)


def plan_scalar(s: EditorSession, new_value='subject.ready'):
    patch = TypedPatch('SetScalar', s.source_revision, 'example',
                      path=('procedures', 'example', 'nodes', 'check', 'verify'),
                      expected_old='subject.valid', value=new_value)
    return s.preview_visual(patch)


def test_initial_state_and_source_edit_undo_redo_save_plan():
    a = EditorSession.open(BASE)
    assert not a.is_dirty and a.projection_state == 'READY'
    a = a.source_edit(replace_predicate(BASE))
    assert a.is_dirty and len(a.history) == 1
    assert a.undo().working_text == BASE
    assert a.undo().redo().working_text == a.working_text
    saved = a.acknowledge_save(a.prepare_save(BASE), a.working_text)
    assert not saved.is_dirty
    assert saved.saved_revision == saved.source_revision
    assert saved.undo().is_dirty  # Saving does not erase Undo


def test_source_and_visual_share_one_undo_history():
    original = EditorSession.open(BASE)
    first = original.apply_visual(plan_scalar(original))
    assert len(first.history) == 1
    second = first.source_edit(first.working_text.replace('terminal: SUCCEEDED','terminal: FAILED'))
    assert len(second.history) == 2
    assert second.undo().working_text == first.working_text
    assert second.undo().undo().working_text == BASE
    assert second.undo().redo().working_text == second.working_text
    assert second.undo().source_edit(first.working_text + '# new\n').future == ()
    assert second.source_revision != first.source_revision


def test_source_can_be_invalid_and_projection_stays_stale():
    start = EditorSession.open(BASE)
    invalid = start.source_edit('procedures: [oops\n')
    assert invalid.working_text == 'procedures: [oops\n'
    assert invalid.projection_state == 'STALE'
    assert invalid.projection_revision == start.source_revision
    with pytest.raises(PatchRejected):
        invalid.preview_visual(plan_scalar(start).patch)
    with pytest.raises(EditRejected, match='invalid Source'):
        invalid.prepare_save(BASE)
    assert invalid.undo().projection_state == 'READY'
    assert invalid.undo().redo().projection_state == 'STALE'
    assert EditorSession.open('procedures: [oops\n').projection_state == 'UNAVAILABLE'


def test_preview_stale_after_intervening_source_edit():
    start = EditorSession.open(BASE)
    preview = plan_scalar(start)
    changed = start.source_edit(BASE + '# comment\n')
    with pytest.raises(PatchRejected, match='preview no longer matches'):
        changed.apply_visual(preview)
    assert changed.working_text == BASE + '# comment\n'


def test_conflict_blocks_all_mutation_and_save_until_resolution():
    original = EditorSession.open(BASE)
    working = original.source_edit(replace_predicate(BASE))
    external = BASE + '# changed externally\n'
    conflict = working.observe_disk(external)
    assert conflict.is_conflicted
    assert conflict.working_text == working.working_text
    for action in (lambda: conflict.undo(),lambda: conflict.redo(),
                   lambda: conflict.source_edit(BASE),
                   lambda: conflict.apply_visual(plan_scalar(original)),
                   lambda: conflict.preview_visual(plan_scalar(original).patch),
                   lambda: conflict.prepare_save(external)):
        with pytest.raises(EditRejected, match='conflict'):
            action()
    with pytest.raises(EditRejected, match='revision changed'):
        conflict.resolve_reload(external + 'another')
    restored = conflict.resolve_reload(external)
    assert restored.working_text == external and not restored.is_dirty
    assert restored.history == () and not restored.is_conflicted


def test_external_revision_race_and_manual_resolution():
    original = EditorSession.open(BASE)
    dirty = original.source_edit(replace_predicate(BASE))
    external = BASE.replace('terminal: SUCCEEDED', 'terminal: FAILED')
    conflict = dirty.observe_disk(external)
    with pytest.raises(EditRejected, match='revision changed'):
        conflict.resolve_manual(BASE, 'resolution')
    agreed = replace_predicate(external)
    resolved = conflict.resolve_manual(external, agreed)
    assert resolved.saved_text == external
    assert resolved.working_text == agreed
    assert resolved.is_dirty
    assert resolved.undo().working_text == external
    assert not resolved.is_conflicted
    # The external file may change AGAIN after explicit resolution.
    with pytest.raises(EditRejected, match='disk changed'):
        resolved.prepare_save(external + '# second change\n')


def test_conflict_clears_if_disk_reverts_to_baseline():
    s = EditorSession.open(BASE).source_edit(replace_predicate(BASE))
    external = BASE + 'extra: true\n'
    s = s.observe_disk(external)
    assert s.is_conflicted
    back = s.observe_disk(BASE)
    assert not back.is_conflicted
    assert back.working_text == s.working_text
    assert back.prepare_save(BASE).text == s.working_text


def test_save_plan_has_strict_revision_guards_and_no_implicit_io():
    s = EditorSession.open(BASE).source_edit(replace_predicate(BASE))
    plan = s.prepare_save(BASE)
    tampered = replace(plan, text='evil')
    with pytest.raises(EditRejected, match='working copy changed'):
        s.acknowledge_save(tampered, s.working_text)
    with pytest.raises(EditRejected, match='persisted content differs'):
        s.acknowledge_save(plan, BASE)
    newer = s.source_edit(s.working_text + '# changed\n')
    with pytest.raises(EditRejected, match='working copy changed'):
        newer.acknowledge_save(plan, plan.text)
    assert s.is_dirty


def test_ensure_fixture_visual_edit_and_external_observation():
    source = ENSURE.read_text(encoding='utf-8')
    s = EditorSession.open(source)
    patch = TypedPatch('RenameNode',s.source_revision,'ensure-session',
                       node='create-session',new_name='create-session-v2',expected_old='create-session')
    s2 = s.apply_visual(s.preview_visual(patch))
    assert 'create-session-v2:' in s2.working_text
    assert s2.undo().working_text == source
    assert s2.undo().redo().working_text == s2.working_text
    assert s2.prepare_save(source).expected_disk_revision == s.saved_revision


def test_establish_fixture_source_edit_remains_source_only():
    source = ESTABLISH.read_text(encoding='utf-8')
    s = EditorSession.open(source,profile='establish-pdu-session')
    assert s.projection_state == 'READY'
    with pytest.raises(PatchRejected,match='Source-only'):
        s.preview_visual(TypedPatch('AddRoute',s.source_revision,
            'ue-requested-pdu-session-establishment',node='nudm-sdm-get',
            outcome='FAILED',target='failed',profile='establish-pdu-session'))
    new = s.source_edit(source+'# editor source-only comment\n')
    assert new.projection_state == 'READY' and new.is_dirty
    assert new.undo().working_text == source
