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


test('Full Owner Contract sections are projected, including requirements and dependencies', () => {
  const advanced = contract
    .replace('  postconditions:',
      '  preconditions:\n  - predicate: session.input_ready\n    expect: PASS\n  postconditions:')
    .replace('  planning:\n    maxActions: 32\n    allowDynamicProcedure: false',
      '  requirements:\n  - predicate: policy.ready\n    expect: PASS\n    satisfiable: true\n' +
      '  dependencies:\n  - name: child-skill\n    artifactRef: child-skill\n' +
      '    digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' +
      '    variant: compact\n  planning:\n    maxActions: 32\n' +
      '    allowDynamicProcedure: false\n    fallbackProcedure: recover\n' +
      '    budgetPartition:\n      parentActions: 10\n      childActions: 22');
  const p = projectSkillContract(advanced);
  assert.equal(p.state, 'READY');
  assert.equal(p.preconditions[0].predicate.value, 'session.input_ready');
  assert.equal(p.requirements[0].satisfiable.value, true);
  assert.equal(p.dependencies[0].artifactRef.value, 'child-skill');
  assert.equal(p.dependencies[0].variant.value, 'compact');
  assert.equal(p.fallbackProcedure.value, 'recover');
  assert.equal(p.budgetPartition.parentActions.value, 10);
  assert.equal(p.budgetPartition.childActions.value, 22);
});

test('Unknown nested fields and malformed known sections are explicitly partial', () => {
  const unknown = contract.replace('    requiredFacts:',
    '    futureContextPolicy: strict\n    requiredFacts:');
  const p = projectSkillContract(unknown);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.unprojectedPaths.includes('spec.context.futureContextPolicy'));

  const malformed = contract.replace('    requiredFacts:\n    - ingress',
    '    requiredFacts: ingress');
  const partial = projectSkillContract(malformed);
  assert.equal(partial.state, 'PARTIAL');
  assert.ok(partial.projectionWarnings.includes('spec.context.requiredFacts is not a sequence'));
});

test('Current ca-skills 5GC and MAS contracts project context schemas completely',()=>{
  const examples=[
    ['establish-pdu-session',['subject','facts','observations','evidence']],
    ['establish-pdu-session-mas',['subject','facts','observations']]
  ];
  for(const [skill,expected] of examples){
    const source=readFileSync(new URL(
      '../site/samples/skills/'+skill+'/assurance/contract.yaml',import.meta.url),'utf8');
    const projection=projectSkillContract(source);
    assert.equal(projection.state,'READY',JSON.stringify({
      unknown:projection.unprojectedPaths,warnings:projection.projectionWarnings
    }));
    assert.equal(projection.name.value,skill);
    assert.deepEqual(projection.contextSchemas.map(item=>item.name).sort(),expected);
    assert.ok(projection.contextSchemas.every(item=>item.value.startsWith('lib/')));
    assert.ok(projection.contextSchemas.every(item=>item.line>0));
  }
});

test('Unknown context schema roles remain visible as partial instead of being discarded',()=>{
  const source=contract.replace('    - ingress',
    '    - ingress\n    schemas:\n      futureRole: lib/host/future.schema.yaml');
  const projection=projectSkillContract(source);
  assert.equal(projection.state,'PARTIAL');
  assert.ok(projection.unprojectedPaths.includes('spec.context.schemas.futureRole'));
});
