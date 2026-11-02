from __future__ import annotations

from pathlib import Path
import pytest

from skill_studio_poc.patch import PatchRejected, SourceDocument, TypedPatch
from skill_studio_poc.compat import load_demo_yaml

ROOT = Path(__file__).resolve().parents[1]
ENSURE = ROOT / 'fixtures/baseline/ensure-pdu-session/procedure.yaml'
ESTABLISH = ROOT / 'fixtures/baseline/establish-pdu-session/procedure.yaml'

BASIC = '''# preserve me\nprocedures:\n  example:\n    start: first\n    nodes:\n      first:\n        verify: subject.valid # trailing comment\n        'on':\n          PASS: done\n          UNKNOWN: unresolved\n      done:\n        terminal: SUCCEEDED\n      unresolved:\n        terminal: UNRESOLVED\n'''


def patch(doc: SourceDocument, kind: str, **kwargs):
    return TypedPatch(kind=kind, base_revision=doc.source_revision, procedure='example', **kwargs)


def test_yaml_12_bool_semantics_and_roundtrip():
    document = SourceDocument('''# comment\nprocedures:\n  x:\n    on: true\n    not-approved: false\n    literal: 'on'\n    note: |\n      do not change me\n''')
    assert document.snapshot()['procedures']['x']['on'] is True
    assert isinstance(next(iter(document.snapshot()['procedures']['x'])), str)
    assert document.round_trip() == document.text
    assert load_demo_yaml(document.text) == document.snapshot()
    assert load_demo_yaml('on: true\nfalse: off\n') == {'on': True, False: 'off'}


def test_set_scalar_changes_only_the_value_span():
    doc = SourceDocument(BASIC)
    p = patch(doc, 'SetScalar', path=('procedures', 'example', 'nodes', 'first', 'verify'),
              expected_old='subject.valid', value='subject.checked')
    preview = doc.preview(p)
    assert 'subject.checked # trailing comment' in preview.after_text
    assert '# preserve me' in preview.after_text
    assert preview.modified_spans == 1
    assert '+        verify: subject.checked # trailing comment' in preview.unified_diff
    assert doc.text == BASIC
    updated = doc.apply(preview)
    assert updated.snapshot()['procedures']['example']['nodes']['first']['verify'] == 'subject.checked'
    assert load_demo_yaml(updated.text) == updated.snapshot()


def test_add_route_only_inserts_one_line():
    doc = SourceDocument(BASIC)
    p = patch(doc, 'AddRoute', node='first', outcome='FAIL', target='unresolved')
    preview = doc.preview(p)
    assert '          FAIL: unresolved\n      done:' in preview.after_text
    assert preview.modified_spans == 1
    result = doc.apply(preview)
    assert result.snapshot()['procedures']['example']['nodes']['first']['on']['FAIL'] == 'unresolved'
    assert result.text.replace('          FAIL: unresolved\n', '') == BASIC


def test_rename_node_updates_key_start_routes_and_exact_binding():
    src = BASIC.replace('start: first', 'start: first')\
        .replace('      done:\n', '      receiver:\n        call: pdu_session.create\n        with:\n          ref:\n            from: first.output.value\n        on:\n          COMMITTED: done\n      done:\n')
    doc = SourceDocument(src)
    p = patch(doc, 'RenameNode', node='first', expected_old='first', new_name='check-first')
    preview = doc.preview(p)
    result = doc.apply(preview)
    assert 'start: check-first' in result.text
    assert '      check-first:' in result.text
    assert 'from: check-first.output.value' in result.text
    assert '# preserve me' in result.text
    assert 'subject.valid # trailing comment' in result.text
    assert 'from: first.output.value' not in result.text
    assert result.snapshot()['procedures']['example']['start'] == 'check-first'


def test_stale_revision_and_invalid_target_rejected_atomically():
    doc = SourceDocument(BASIC)
    original = doc.text
    stale = patch(doc, 'AddRoute', node='first', outcome='FAIL', target='unresolved')
    changed = doc.apply(doc.preview(patch(doc, 'SetScalar',
        path=('procedures', 'example', 'nodes', 'first', 'verify'),
        expected_old='subject.valid', value='subject.ready')))
    with pytest.raises(PatchRejected, match='stale'):
        changed.preview(stale)
    with pytest.raises(PatchRejected, match='destination'):
        doc.preview(patch(doc, 'AddRoute', node='first', outcome='FAIL', target='not-a-node'))
    with pytest.raises(PatchRejected, match='already routed'):
        doc.preview(patch(doc, 'AddRoute', node='first', outcome='PASS', target='done'))
    with pytest.raises(PatchRejected, match='precondition'):
        doc.preview(patch(doc, 'SetScalar', path=('procedures','example','nodes','first','verify'),
                          expected_old='wrong', value='new'))
    assert doc.text == original


def test_unknown_syntax_and_block_scalar_are_preserved():
    src = BASIC.replace('        verify: subject.valid # trailing comment',
                        '        verify: subject.valid # trailing comment\n        someFutureField: |+\n          preserve on and true\n          another line')
    doc = SourceDocument(src)
    preview = doc.preview(patch(doc,'AddRoute',node='first',outcome='FAIL',target='unresolved'))
    assert preview.after_text.replace('          FAIL: unresolved\n', '') == src
    assert 'someFutureField: |+' in preview.after_text


def test_duplicate_key_and_transitional_profile_fail_closed():
    with pytest.raises(PatchRejected, match='duplicate'):
        SourceDocument('procedures:\n  x:\n    a: 1\n    a: 2\n')
    doc = SourceDocument(BASIC, profile='establish-pdu-session')
    with pytest.raises(PatchRejected, match='Source-only'):
        doc.preview(TypedPatch('AddRoute', doc.source_revision, 'example',
                               node='first', outcome='FAIL', target='unresolved',profile='establish-pdu-session'))


def test_crlf_insert_preserves_crlf():
    src = BASIC.replace('\n','\r\n')
    doc = SourceDocument(src)
    preview = doc.preview(patch(doc,'AddRoute',node='first',outcome='FAIL',target='unresolved'))
    assert preview.after_text.replace('          FAIL: unresolved\r\n','') == src


def test_manifest_yaml_parses():
    manifest = ROOT / 'spec/editor-capability-manifest.yaml'
    if not manifest.exists():
        pytest.skip('Manifest exists in GitHub source checkout; not local scratch copy')
    result = load_demo_yaml(manifest.read_text(encoding='utf-8'))
    assert result['kind'] == 'EditorCapabilityManifest'
    assert result['authoringPolicy']['sourceAuthority'] == 'package-files'
    assert result['artifactIdentity']['admittedExecutableClosureDigest']['includes'] == [
        'assurance/contract.yaml', 'assurance/procedure.yaml', 'assurance/predicates.yaml'
    ]


def test_real_ensure_roundtrip_and_rename():
    if not ENSURE.exists():
        pytest.skip('versioned source fixtures exist in GitHub checkout')
    doc = SourceDocument(ENSURE.read_text(encoding='utf-8'))
    assert doc.round_trip() == doc.text
    assert load_demo_yaml(doc.text) == doc.snapshot()
    root = doc.snapshot()['procedures']['ensure-session']
    assert len(root['nodes']) == 11
    patch_spec = TypedPatch('RenameNode',doc.source_revision,'ensure-session',
                            node='create-session',new_name='create-session-renamed',
                            expected_old='create-session')
    result = doc.apply(doc.preview(patch_spec))
    assert result.snapshot()['procedures']['ensure-session']['nodes']['reconcile-create']['with']['c6BackendOperationRef']['from'] == 'create-session-renamed.output.c6BackendOperationRef'
    assert result.snapshot()['procedures']['ensure-session']['nodes']['create-session-renamed']['call'] == 'pdu_session.create'
    assert load_demo_yaml(result.text) == result.snapshot()


def test_real_establish_read_only_roundtrip():
    if not ESTABLISH.exists():
        pytest.skip('versioned source fixtures exist in GitHub checkout')
    doc = SourceDocument(ESTABLISH.read_text(encoding='utf-8'),profile='establish-pdu-session')
    assert doc.round_trip() == doc.text
    assert len(doc.snapshot()['procedures']) == 6
    root = doc.snapshot()['procedures']['ue-requested-pdu-session-establishment']
    assert len(root['nodes']) == 17
    assert 'preconditions' in root['nodes']['nudm-sdm-subscribe']
    assert load_demo_yaml(doc.text) == doc.snapshot()


def test_set_scalar_rejects_invalid_route_target():
    doc = SourceDocument(BASIC)
    with pytest.raises(PatchRejected, match='route target'):
        doc.preview(patch(doc, 'SetScalar',
                path=('procedures','example','nodes','first','on','PASS'),
                expected_old='done', value='missing'))


def test_block_scalar_is_source_only_even_when_type_string():
    src = BASIC.replace('        verify: subject.valid # trailing comment',
                        '        verify: |\n          line one\n          line two')
    doc = SourceDocument(src)
    with pytest.raises(PatchRejected, match='block scalar'):
        doc.preview(patch(doc,'SetScalar',
                          path=('procedures','example','nodes','first','verify'),
                          expected_old='line one\nline two\n',value='different'))


def test_new_identifier_inside_comment_is_not_rewritten():
    src = BASIC.replace('# preserve me', '# first.output.message is documentation')
    doc = SourceDocument(src)
    preview=doc.preview(patch(doc,'RenameNode',node='first',expected_old='first',new_name='check'))
    assert '# first.output.message is documentation' in preview.after_text
    assert 'start: check' in preview.after_text

SEQUENCE = '''# header preserved
procedures:
  example:
    start: first
    nodes:
      first:
        preconditions:
          steps:
            - verify: alpha.ready
              with:
                x:
                  from: input.x
            - verify: beta.ready
          'on':
            FAILED: failed
        call: some.action
        'on':
          FAILED: failed
      failed:
        terminal: FAILED
'''


def test_insert_sequence_item_before_existing_item_preserves_other_text():
    doc = SourceDocument(SEQUENCE, profile='poc-sequence')
    spec = TypedPatch('InsertSequenceItem', doc.source_revision, 'example',
                      path=('procedures','example','nodes','first','preconditions','steps'),
                      expected_old=2, value={'verify':'new.ready'}, index=1,
                      profile='poc-sequence')
    result = doc.apply(doc.preview(spec))
    assert result.text.replace('            - verify: new.ready\n','') == SEQUENCE
    steps = result.snapshot()['procedures']['example']['nodes']['first']['preconditions']['steps']
    assert [s['verify'] for s in steps] == ['alpha.ready','new.ready','beta.ready']
    assert load_demo_yaml(result.text) == result.snapshot()


def test_insert_sequence_item_append_preserves_route_and_nested_fields():
    doc = SourceDocument(SEQUENCE, profile='poc-sequence')
    spec = TypedPatch('InsertSequenceItem', doc.source_revision, 'example',
                      path=('procedures','example','nodes','first','preconditions','steps'),
                      expected_old=2, value={'verify':'new.ready'}, index=2,
                      profile='poc-sequence')
    result = doc.apply(doc.preview(spec))
    assert result.text.replace('            - verify: new.ready\n','') == SEQUENCE
    assert '            - verify: new.ready\n          \'on\':' in result.text


def test_insert_sequence_rejects_stale_length_ambiguous_comments_and_real_profile():
    doc = SourceDocument(SEQUENCE,profile='poc-sequence')
    base = dict(kind='InsertSequenceItem', base_revision=doc.source_revision,
                procedure='example', path=('procedures','example','nodes','first','preconditions','steps'),
                expected_old=1, value={'verify':'new.ready'},index=2,profile='poc-sequence')
    with pytest.raises(PatchRejected,match='precondition'):
        doc.preview(TypedPatch(**base))
    bad = SEQUENCE.replace('          \'on\':','          # route comment\n          \'on\':')
    doc_bad = SourceDocument(bad,profile='poc-sequence')
    with pytest.raises(PatchRejected,match='comments'):
        doc_bad.preview(TypedPatch(**{**base,'base_revision':doc_bad.source_revision,'expected_old':2}))
    prod = SourceDocument(SEQUENCE,profile='ensure-pdu-session')
    with pytest.raises(PatchRejected,match='not qualified'):
        prod.preview(TypedPatch(**{**base,'base_revision':prod.source_revision,'expected_old':2,'profile':'ensure-pdu-session'}))


def test_anchors_are_source_only_and_bom_roundtrip_safe():
    anchored = BASIC.replace('verify: subject.valid','verify: &evidence subject.valid')
    doc = SourceDocument(anchored)
    assert doc.round_trip() == anchored
    with pytest.raises(PatchRejected,match='anchors'):
        doc.preview(patch(doc,'AddRoute',node='first',outcome='FAIL',target='unresolved'))
    bom = '\ufeff' + BASIC
    doc_bom = SourceDocument(bom)
    assert doc_bom.round_trip() == bom
    result=doc_bom.apply(doc_bom.preview(patch(doc_bom,'AddRoute',node='first',outcome='FAIL',target='unresolved')))
    assert result.text.startswith('\ufeff')
    assert result.text.replace('          FAIL: unresolved\n','') == bom


def test_apply_rejects_forged_preview_with_self_consistent_digest():
    from dataclasses import replace
    from skill_studio_poc.patch import revision
    doc=SourceDocument(BASIC)
    good=doc.preview(patch(doc,'AddRoute',node='first',outcome='FAIL',target='unresolved'))
    forged_text=good.after_text.replace('terminal: SUCCEEDED','terminal: FAILED')
    fabricated=replace(good,after_text=forged_text,after_revision=revision(forged_text))
    with pytest.raises(PatchRejected,match='canonical'):
        doc.apply(fabricated)
    assert doc.text == BASIC


def test_sequence_insertion_respects_crlf_and_initial_index():
    doc=SourceDocument(SEQUENCE.replace('\n','\r\n'),profile='poc-sequence')
    spec=TypedPatch('InsertSequenceItem',doc.source_revision,'example',
                    path=('procedures','example','nodes','first','preconditions','steps'),
                    expected_old=2,value={'verify':'fresh.ready'},index=0,profile='poc-sequence')
    updated=doc.apply(doc.preview(spec))
    assert updated.text.replace('            - verify: fresh.ready\r\n','')==doc.text
    assert updated.snapshot()['procedures']['example']['nodes']['first']['preconditions']['steps'][0]['verify']=='fresh.ready'


def test_sequence_insertion_rejects_malformed_verify_identifier():
    doc=SourceDocument(SEQUENCE,profile='poc-sequence')
    spec=TypedPatch('InsertSequenceItem',doc.source_revision,'example',
                    path=('procedures','example','nodes','first','preconditions','steps'),
                    expected_old=2,value={'verify':'a..b'},index=1,profile='poc-sequence')
    with pytest.raises(PatchRejected,match='single verify'):
        doc.preview(spec)
