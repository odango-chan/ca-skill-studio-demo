"""Execute the *exact pinned upstream authoring function* in an inert test harness.

Not an execution of ca-agent-demo's entire validate_docs.py, its Schema
validators, or the Makefile gate. The pinned function is extracted verbatim
from ca-agent-demo@bf445ad scripts/validate_docs.py lines 86-269.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from skill_studio_poc.compat import load_demo_yaml
from skill_studio_poc.validator import validate_createdsession_source

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'fixtures/upstream/validate_createdsession_authoring_source.py'
PROCEDURE = ROOT / 'fixtures/baseline/establish-pdu-session/procedure.yaml'
UPSTREAM_FUNCTION_SHA256 = 'd1f60f0d6af43d121d69097f4f0ee3a7f20732a5fa28ae83d146a65e42b0fa1d'


class UpstreamRejected(ValueError):
    pass


def original_authoring_gate(source: str) -> tuple[bool, str]:
    """Use original function, with only read/fail dependency hooks substituted."""
    original = SOURCE.read_bytes()
    assert hashlib.sha256(original).hexdigest() == UPSTREAM_FUNCTION_SHA256, (
        'original upstream validator source changed without re-pinning'
    )

    def fail(message: str) -> None:
        raise UpstreamRejected(message)

    scope = {'fail': fail, 'read': lambda label: source}
    exec(compile(original, str(SOURCE), 'exec'), scope)
    try:
        scope['validate_createdsession_authoring_source'](
            load_demo_yaml(source), str(PROCEDURE)
        )
        return True, ''
    except UpstreamRejected as exc:
        return False, str(exc)


def local_gate(source: str) -> tuple[bool, tuple[str, ...]]:
    diagnostics = validate_createdsession_source(source)
    return not diagnostics, tuple(d.code for d in diagnostics)


def source_fixture() -> str:
    return PROCEDURE.read_text(encoding='utf-8')


def test_original_pinned_function_accepts_exact_full_source():
    assert original_authoring_gate(source_fixture()) == (True, '')
    assert local_gate(source_fixture()) == (True, ())


@pytest.mark.parametrize('needle,replacement,expected_code', [
    ('OUTCOME_UNKNOWN: reconcile-nudm-sdm-subscribe',
     'OUTCOME_UNKNOWN: failed', 'RECONCILE_TARGET'),
    ('call: ca.session.operation_context.read',
     'call: unapproved.action', 'PRECONDITION_CALL'),
    ('call: ca.session.pcf_create_inputs.read',
     'call: unapproved.pcf.read', 'PRECONDITION_CALL'),
    ('script: scripts/select_establishment_configuration.py',
     'script: scripts/unapproved.py', 'PRECONDITION_SCRIPT'),
    ('procedure: await-ue-session-configuration',
     'procedure: unknown-procedure', 'PRECONDITION_CHILD'),
    ('verify: createdsession.ingress.eligible',
     'verify: createdsession.ingress.not-ready', 'JIT_PREDICATE'),
    ('OUTCOME_UNKNOWN: reconcile-n1n2-message-transfer',
     'OUTCOME_UNKNOWN: failed', 'RECONCILE_TARGET'),
    ('COMMITTED: safe-stopped',
     'COMMITTED: failed', 'RECONCILE_STOP'),
    ('FAILED: failed',
     'FAILED: absent-node', 'ROUTE_TARGET'),
])
def test_original_and_subset_both_reject_known_bad_source(needle, replacement, expected_code):
    base = source_fixture()
    assert needle in base, needle
    changed = base.replace(needle, replacement, 1)
    original_ok, reason = original_authoring_gate(changed)
    subset_ok, codes = local_gate(changed)
    assert not original_ok, (needle, reason)
    assert not subset_ok, (needle, codes)
    assert expected_code in codes, (needle, codes)


def test_original_and_subset_reject_retired_authoring_form():
    original = source_fixture()
    changed = original.replace('call: sbi.udm.sm_data.get', 'call: fivegc.invalid', 1)
    # Fall back to a guaranteed insertion into source text if candidate is absent.
    if changed == original:
        changed = original.replace('procedures:\n', '# fivegc.retired\nprocedures:\n', 1)
    assert not original_authoring_gate(changed)[0]
    assert not local_gate(changed)[0]


def test_runtime_incompatibility_remains_explicit():
    """This test does NOT grant Structured/Runtime compatibility."""
    from skill_studio_poc.patch import SourceDocument, TypedPatch, PatchRejected
    doc = SourceDocument(source_fixture(), profile='establish-pdu-session')
    with pytest.raises(PatchRejected, match='Source-only'):
        doc.preview(TypedPatch(
            kind='AddRoute', base_revision=doc.source_revision,
            procedure='ue-requested-pdu-session-establishment',
            node='nudm-sdm-get', outcome='FAILED', target='failed',
            profile='establish-pdu-session',
        ))


def test_original_narrow_gate_does_not_claim_terminal_semantics():
    """Upstream authoring gate only checks reconcile targets, not terminal enums.

    A separate Schema / Runtime gate must decide the terminal validity.
    """
    base = source_fixture()
    changed = base.replace('terminal: SAFE_STOPPED', 'terminal: COMPLETED', 1)
    assert changed != base
    assert original_authoring_gate(changed)[0]
    assert local_gate(changed)[0]
