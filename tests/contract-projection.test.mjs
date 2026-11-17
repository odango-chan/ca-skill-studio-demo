import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectSkillContract} from '../site/contract-projection.mjs';

const source = readFileSync(new URL(
  '../site/samples/v1alpha4/establish-pdu-session/assurance/contract.yaml',
  import.meta.url), 'utf8');

test('CA-SL v1alpha4 Contract projects its actual source fields and coordinates', () => {
  const p = projectSkillContract(source, {name: 'establish-pdu-session'});
  assert.equal(p.state, 'READY');
  assert.equal(p.kind, 'SkillContract');
  assert.equal(p.language, 'CA-SL v1alpha4');
  assert.equal(p.name.value, 'establish-pdu-session');
  assert.equal(p.goal.value, 'pdu_session.initial_request_fulfilled');
  assert.equal(p.precondition.value, 'get-sm-subscription-data.precondition');
  assert.equal(p.requestSchema.value, 'schemas/establishment-request.schema.yaml');
  assert.equal(p.contextSchema.value,
    'ca-context::urn:connectionagent:ca:context:subject:v1');
  assert.equal(p.dependencies.length, 4);
  assert.equal(p.dependencies[0].name, 'ca-context');
  assert.equal(p.dependencies[0].value, 'urn:connectionagent:ca:host-context');
  assert.equal(p.capabilities.length, 9);
  assert.equal(p.limits[0].name, 'maxActions');
  assert.equal(p.limits[0].value, 32);
  assert.deepEqual(p.unprojectedPaths, []);
  assert.deepEqual(p.projectionWarnings, []);
  assert.match(source, /^# CA-SL v1alpha4/);
});

test('Unknown v1alpha4 Contract extensions are explicit and remain in Source', () => {
  const changed = source.replace('goal: pdu_session.initial_request_fulfilled',
    'futurePolicy: strict\ngoal: pdu_session.initial_request_fulfilled');
  const p = projectSkillContract(changed);
  assert.equal(p.state, 'PARTIAL');
  assert.deepEqual(p.unprojectedPaths, ['futurePolicy']);
  assert.match(changed, /futurePolicy: strict/);
});

test('Malformed known v1alpha4 sections are partial rather than silently discarded', () => {
  const changed = source.replace(/capabilities:\n[\\s\\S]*?\n\nlimits:/,
    'capabilities: not-a-sequence\n\nlimits:');
  const p = projectSkillContract(changed);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.projectionWarnings.includes('capabilities is not a sequence'));

  const malformedLimits = projectSkillContract(source.replace('limits:\n  maxActions: 32',
    'limits: 32'));
  assert.equal(malformedLimits.state, 'PARTIAL');
  assert.ok(malformedLimits.projectionWarnings.includes('limits is not a mapping'));
});

test('Invalid YAML, duplicate keys, aliases and oversized source fail closed', () => {
  assert.equal(projectSkillContract('goal: [').state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract(source.replace(
    'goal: pdu_session.initial_request_fulfilled',
    'goal: one\ngoal: two')).state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract(source.replace(
    'goal: pdu_session.initial_request_fulfilled',
    'goal: &g pdu_session.initial_request_fulfilled')).state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract('x'.repeat(1024 * 1024 + 1)).state, 'SOURCE_ONLY');
});

test('Contract projection never invents qualification or Runtime evidence', () => {
  const p = projectSkillContract(source, {name: 'establish-pdu-session'});
  assert.equal(p.qualification, undefined);
  assert.equal(p.runtime, undefined);
  assert.equal(p.state, 'READY'); // projection completeness only
});
