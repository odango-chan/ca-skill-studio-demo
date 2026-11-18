import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectPredicateSet} from '../site/predicate-projection.mjs';

const source = readFileSync(new URL(
  '../site/samples/v1alpha5/establish-pdu-session/assurance/predicates.yaml',
  import.meta.url), 'utf8');

test('CA-SL v1alpha5 PredicateSet projects ordered parameter signatures and Evidence', () => {
  const p = projectPredicateSet(source, {skillName: 'establish-pdu-session'});
  assert.equal(p.state, 'READY');
  assert.equal(p.kind, 'PredicateSet');
  assert.equal(p.language, 'CA-SL v1alpha5');
  assert.equal(p.skill.value, 'establish-pdu-session');
  assert.equal(p.predicateCount, 12);

  const request = p.predicates.find(item => item.id === 'establishment.request.supported');
  assert.deepEqual(request.parameters.map(item => [item.name, item.type]), [
    ['requestType', 'integer'],
    ['requestedPduSessionType', 'string'],
    ['requestedSscMode', 'integer']
  ]);
  assert.equal(request.evaluator.type.value, 'cel');
  assert.match(request.evaluator.expression.value, /requestType == 1/);
  assert.equal(request.evidence.length, 0);

  const owned = p.predicates.find(item => item.id === 'establishment.udm.subscription_owned');
  assert.equal(owned.evidence[0].parameter, 'subscription');
  assert.equal(owned.evidence[0].guarantees[0].value, 'ca::udm.subscription-owned');

  const scripted = p.predicates.find(item => item.id === 'establishment.subscription.request_valid');
  assert.equal(scripted.evaluator.type.value, 'script');
  assert.equal(scripted.evaluator.script.value, 'scripts/validate-subscription-request.py');
  assert.ok(scripted.parameters.some(item => item.name === 'requestedDnn'));
  assert.ok(scripted.line > 0);
  assert.match(source, /^# CA-SL v1alpha5/);
});

test('Unknown v1alpha5 Predicate fields are explicit rather than silently omitted', () => {
  const changed = source.replace(
    '    evidence:\n      requires:\n        subscription:',
    '    evidence:\n      futureEvidenceMode: strict\n      requires:\n        subscription:');
  const p = projectPredicateSet(changed);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.unprojectedPaths.includes(
    'predicates.establishment.udm.subscription_owned.evidence.futureEvidenceMode'));
  assert.match(changed, /futureEvidenceMode: strict/);
});

test('Malformed parameter signatures, Evidence references and Script paths are partial', () => {
  const malformedParameters = source.replace(
    '      - requestType: integer',
    '      - requestType: integer\n        duplicate: string');
  const p = projectPredicateSet(malformedParameters);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.projectionWarnings.some(message =>
    message.includes('must be a single-entry parameter mapping')));

  const undeclaredEvidence = source.replace(
    '        subscription: [ca::udm.subscription-owned]',
    '        missingParameter: [ca::udm.subscription-owned]');
  const q = projectPredicateSet(undeclaredEvidence);
  assert.equal(q.state, 'PARTIAL');
  assert.ok(q.projectionWarnings.some(message =>
    message.includes('refers to an undeclared parameter')));

  const unsafeScript = source.replace(
    'script: scripts/validate-subscription-request.py',
    'script: scripts/../outside.py');
  const s = projectPredicateSet(unsafeScript);
  assert.equal(s.state, 'PARTIAL');
  assert.ok(s.projectionWarnings.some(message => message.includes('safe scripts/ package-relative path')));
});

test('Malformed YAML, duplicate keys, aliases and oversized source fail closed', () => {
  assert.equal(projectPredicateSet('predicates: [').state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet(source.replace(
    '  establishment.request.supported:',
    '  establishment.request.supported: {}\n  establishment.request.supported:')).state,
    'SOURCE_ONLY');
  assert.equal(projectPredicateSet(source.replace(
    '  establishment.request.supported:',
    '  &predicate establishment.request.supported:')).state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet('x'.repeat(1024 * 1024 + 1)).state, 'SOURCE_ONLY');
});
