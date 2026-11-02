"""Synthetic, read-only tests; not a substitute for the pinned full Demo fixture."""
from copy import deepcopy
from pathlib import Path
import yaml

from skill_studio_poc.validator import (
    MAIN_PREFIX, RECONCILE_PAIRS, JIT_PREDICATES,
    validate_createdsession_source,
)


def sample():
    nodes = {name: {"call": "placeholder"} for name in MAIN_PREFIX}
    nodes["safe-stopped"] = {"terminal": "SAFE_STOPPED"}
    for mutation, reconcile in RECONCILE_PAIRS:
        nodes[mutation]["on"] = {"OUTCOME_UNKNOWN": reconcile}
        nodes[reconcile] = {"reconcile": mutation, "on": {"UNRESOLVED": "safe-stopped"}}
    nodes["nudm-sdm-subscribe"]["preconditions"] = {
        "steps": [{"verify": v} for v in sorted(JIT_PREDICATES)],
        "on": {"FAILED": "safe-stopped", "UNRESOLVED": "safe-stopped"},
    }
    return {"procedures": {
        "ue-requested-pdu-session-establishment": {
            "start": "nudm-sdm-get", "nodes": nodes,
        },
    }}


def source(tree):
    return yaml.safe_dump(tree,sort_keys=False)


def codes(src):
    return {item.code for item in validate_createdsession_source(src)}


def test_valid_synthetic_authoring_shape():
    assert validate_createdsession_source(source(sample())) == ()


def test_outcome_unknown_must_target_exact_reconcile():
    tree=sample()
    tree['procedures']['ue-requested-pdu-session-establishment']['nodes']['nudm-sdm-subscribe']['on']['OUTCOME_UNKNOWN']='safe-stopped'
    assert 'RECONCILE_TARGET' in codes(source(tree))


def test_outgoing_phase_routes_are_local_and_complete():
    tree=sample()
    node=tree['procedures']['ue-requested-pdu-session-establishment']['nodes']['nudm-sdm-subscribe']
    node['preconditions']['on']['UNRESOLVED']='not-a-node'
    assert 'ROUTE_TARGET' in codes(source(tree))
    del node['preconditions']['on']['FAILED']
    assert 'PHASE_OUTCOMES' in codes(source(tree))


def test_precondition_is_exactly_one_approved_operator():
    tree=sample()
    steps=tree['procedures']['ue-requested-pdu-session-establishment']['nodes']['nudm-sdm-subscribe']['preconditions']['steps']
    steps.append({'call':'other.service', 'verify':'extra.ready'})
    cc=codes(source(tree))
    assert 'PRECONDITION_CALL' in cc and 'PRECONDITION_OPERATOR' in cc


def test_main_business_order_is_significant():
    tree=sample()
    nodes=tree['procedures']['ue-requested-pdu-session-establishment']['nodes']
    key=MAIN_PREFIX[0];value=nodes.pop(key);nodes[key]=value
    assert 'MAIN_ORDER' in codes(source(tree))


def test_postcondition_never_bypassed_by_success():
    tree=sample()
    nodes=tree['procedures']['ue-requested-pdu-session-establishment']['nodes']
    nodes['nudm-sdm-get']['postconditions']={
        'steps':[{'verify':'observed.ready'}],
        'on':{'PASS':'safe-stopped','FAIL':'safe-stopped','UNKNOWN':'safe-stopped'}
    }
    nodes['nudm-sdm-get']['on']={'SUCCEEDED':'safe-stopped'}
    assert 'POSTCONDITION_BYPASS' in codes(source(tree))


def test_first_mutation_requires_three_jit_predicates():
    tree=sample()
    steps=tree['procedures']['ue-requested-pdu-session-establishment']['nodes']['nudm-sdm-subscribe']['preconditions']['steps']
    steps.pop()
    assert 'JIT_PREDICATE' in codes(source(tree))


def test_parse_errors_are_diagnostics_not_exceptions():
    assert 'YAML_PARSE' in codes('procedures:\n  x: [invalid')


def test_exact_pinned_createdsession_source_has_no_subset_diagnostics():
    fixture = Path(__file__).resolve().parents[1] / 'fixtures/baseline/establish-pdu-session/procedure.yaml'
    assert fixture.is_file(), 'complete CreatedSession source is mandatory'
    assert validate_createdsession_source(fixture.read_text(encoding='utf-8')) == ()


def test_real_createdsession_rejects_broken_reconcile_target():
    fixture = Path(__file__).resolve().parents[1] / 'fixtures/baseline/establish-pdu-session/procedure.yaml'
    assert fixture.is_file()
    src = fixture.read_text(encoding='utf-8')
    needle = 'OUTCOME_UNKNOWN: reconcile-nudm-sdm-subscribe'
    assert src.count(needle) == 1
    altered = src.replace(needle, 'OUTCOME_UNKNOWN: failed', 1)
    assert 'RECONCILE_TARGET' in codes(altered)


def test_real_createdsession_rejects_unsupported_precondition_operator():
    fixture = Path(__file__).resolve().parents[1] / 'fixtures/baseline/establish-pdu-session/procedure.yaml'
    assert fixture.is_file()
    src = fixture.read_text(encoding='utf-8')
    needle = 'call: ca.session.operation_context.read'
    assert needle in src
    altered = src.replace(needle, 'call: unapproved.action', 1)
    assert 'PRECONDITION_CALL' in codes(altered)
