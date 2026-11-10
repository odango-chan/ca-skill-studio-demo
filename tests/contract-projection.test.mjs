import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectSkillContract} from '../site/contract-projection.mjs';

const contract = [
  '# Preserve me',
  'apiVersion: connectionagent.io/v1alpha1',
  'kind: SkillContract',
  'metadata:',
  '  name: example',
  'spec:',
  '  skillType: executable',
  '  goal: session.fulfilled',
  '  entryProcedure: begin',
  '  inputs:',
  '    requestSchema: schemas/request.yaml',
  '  context:',
  '    requiredFacts:',
  '    - ingress',
  '  allowedResources:',
  '    capabilities: [tool.read]',
  '    localTools: [skill.select]',
  '  postconditions:',
  '  - predicate: session.ready',
  '    expect: PASS',
  '  planning:',
  '    maxActions: 32',
  '    allowDynamicProcedure: false',
  '  failureSemantics:',
  '    outcomeUnknown:',
  '      requireReconcile: true',
  ''
].join('\n');

test('Contract projection preserves source coordinates and real references', () => {
  const p = projectSkillContract(contract);
  assert.equal(p.state, 'READY');
  assert.equal(p.entryProcedure.value, 'begin');
  assert.equal(p.entryProcedure.line, 9);
  assert.equal(p.requestSchema.value, 'schemas/request.yaml');
  assert.equal(p.capabilities[0].value, 'tool.read');
  assert.equal(p.localTools[0].value, 'skill.select');
  assert.equal(p.postconditions[0].predicate.value, 'session.ready');
  assert.equal(p.allowDynamicProcedure.value, false);
  assert.equal(p.requireReconcile.value, true);
  assert.match(contract, /^# Preserve me/);
});

test('Unknown extension is explicitly partial rather than silently dropped', () => {
  const p = projectSkillContract(contract.replace('  skillType:',
    '  extensionField: enabled\n  skillType:'));
  assert.equal(p.state, 'PARTIAL');
  assert.deepEqual(p.unprojectedPaths, ['spec.extensionField']);
});

test('Invalid or ambiguous Contract falls back without guessing', () => {
  assert.equal(projectSkillContract('kind: [').state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract(contract.replace('  goal: session.fulfilled',
    '  goal: a\n  goal: b')).state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract(contract.replace('  goal: session.fulfilled',
    '  goal: &g session.fulfilled')).state, 'SOURCE_ONLY');
  assert.equal(projectSkillContract('x'.repeat(1024 * 1024 + 1)).state,
    'SOURCE_ONLY');
  assert.equal(projectSkillContract(contract.replace('kind: SkillContract',
    'kind: PredicateSet')).state, 'SOURCE_ONLY');
});

test('Existing Skill fixture can be projected without Runtime assumptions', () => {
  const source = readFileSync(new URL(
    '../site/samples/packages/establish-pdu-session/assurance/contract.yaml',
    import.meta.url), 'utf8');
  const p = projectSkillContract(source);
  assert.equal(p.kind, 'SkillContract');
  assert.equal(p.name.value, 'establish-pdu-session');
  assert.ok(p.entryProcedure.value);
  assert.ok(p.postconditions.length);
});
