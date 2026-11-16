import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectPredicateSet} from '../site/predicate-projection.mjs';

const source = [
  '# Keep this comment and the original YAML untouched',
  'apiVersion: connectionagent.io/v1alpha1',
  'kind: PredicateSet',
  'metadata:',
  '  skill: sample-skill',
  'predicates:',
  '  session.ready:',
  '    observations:',
  '      state:',
  '        ref: session.context',
  '        scope: request.sessionRef',
  '        freshness: 5s',
  '        when: request.present == true',
  '    evaluator:',
  '      type: cel',
  '      expression: observations.state.status == "READY"',
  '  session.persisted:',
  '    observations:',
  '      response:',
  '        ref: session.persistence_result',
  '        scope: request.sessionRef',
  '        freshness: 1h',
  '    evaluator:',
  '      type: script',
  '      ref: skill.evaluate-session-persisted',
  ''
].join('\n');

test('PredicateSet projection preserves observation-to-evaluator relationships and source lines', () => {
  const p = projectPredicateSet(source);
  assert.equal(p.state, 'READY');
  assert.equal(p.skill.value, 'sample-skill');
  assert.equal(p.predicateCount, 2);
  assert.equal(p.predicates[0].id, 'session.ready');
  assert.equal(p.predicates[0].observations[0].name, 'state');
  assert.equal(p.predicates[0].observations[0].ref.value, 'session.context');
  assert.equal(p.predicates[0].observations[0].freshness.value, '5s');
  assert.equal(p.predicates[0].evaluator.type.value, 'cel');
  assert.match(p.predicates[0].evaluator.expression.value, /status == "READY"/);
  assert.equal(p.predicates[1].evaluator.type.value, 'script');
  assert.equal(p.predicates[1].evaluator.ref.value, 'skill.evaluate-session-persisted');
  assert.ok(p.predicates[0].line > 0);
  assert.ok(p.predicates[0].observations[0].line > 0);
  assert.match(source, /^# Keep this comment/);
});

test('Current establish-pdu-session PredicateSet projects all real predicates without claiming live results', () => {
  const actual = readFileSync(new URL(
    '../site/samples/skills/establish-pdu-session/assurance/predicates.yaml',
    import.meta.url), 'utf8');
  const p = projectPredicateSet(actual);
  assert.equal(p.state, 'READY');
  assert.equal(p.skill.value, 'establish-pdu-session');
  assert.equal(p.predicateCount, 17);
  assert.ok(p.predicates.some(x => x.id === 'createdsession.ran.setup_accepted'));
  assert.ok(p.predicates.some(x => x.evaluator.type.value === 'script' &&
    x.evaluator.ref.value === 'scripts/evaluate_udm_read.py'));
  assert.ok(p.predicates.every(x => x.observations.length > 0 && x.evaluator));
  assert.equal('result' in p.predicates[0], false);
  assert.equal('status' in p.predicates[0], false);
});

test('Unknown nested fields are visible as partial rather than silently omitted', () => {
  const changed = source.replace('        freshness: 5s',
    '        freshness: 5s\n        futureEvidenceMode: strict');
  const p = projectPredicateSet(changed);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.unprojectedPaths.includes(
    'predicates.session.ready.observations.state.futureEvidenceMode'));
});

test('Missing required fields and unsupported evaluator variants are explicitly partial', () => {
  const missing = source.replace('        scope: request.sessionRef\n', '');
  const p = projectPredicateSet(missing);
  assert.equal(p.state, 'PARTIAL');
  assert.ok(p.projectionWarnings.includes(
    'predicates.session.ready.observations.state.scope is missing'));

  const unsupported = source.replace('      type: cel', '      type: custom');
  const q = projectPredicateSet(unsupported);
  assert.equal(q.state, 'PARTIAL');
  assert.ok(q.projectionWarnings.some(x => x.includes('not a supported cel/script variant')));
});

test('Malformed YAML, duplicate keys, aliases and unsupported kinds fail closed', () => {
  assert.equal(projectPredicateSet('predicates: [').state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet(source.replace('  skill: sample-skill',
    '  skill: one\n  skill: two')).state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet(source.replace('  skill: sample-skill',
    '  skill: &s sample-skill')).state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet(source.replace('kind: PredicateSet',
    'kind: SkillContract')).state, 'SOURCE_ONLY');
  assert.equal(projectPredicateSet('x'.repeat(1024 * 1024 + 1)).state, 'SOURCE_ONLY');
});
