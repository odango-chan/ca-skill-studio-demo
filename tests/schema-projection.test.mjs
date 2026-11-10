import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectJsonSchema, resolveSchemaPointer} from '../site/schema-projection.mjs';

const sample = readFileSync(new URL(
  '../site/samples/packages/establish-pdu-session/schemas/establishment-request.schema.yaml',
  import.meta.url), 'utf8');
const find = (node, name) => node?.name === name ? node :
  node?.children.flatMap(c => [find(c,name)]).find(Boolean);

test('C3 projects real Skill request JSON Schema with source lines and nested required fields', () => {
  const result = projectJsonSchema(sample);
  assert.equal(result.state,'READY');
  assert.equal(result.kind,'JsonSchema202012');
  assert.equal(result.title,'EstablishmentRequest');
  assert.ok(result.fieldCount >= 12);
  const requestType = find(result.tree,'requestType');
  assert.equal(requestType.type,'integer');
  assert.equal(requestType.required,true);
  assert.equal(requestType.constraints.find(c=>c.key==='const').value,1);
  assert.ok(requestType.line > 1);
  const sd = find(result.tree,'sd');
  const sst = find(result.tree,'sst');
  assert.equal(sst.required,true);
  assert.equal(sd.required,false);
  assert.equal(sd.constraints.find(c=>c.key==='maximum').value,16777214);
  assert.equal(find(result.tree,'requestedPduSessionType')
    .constraints.find(c=>c.key==='const').value,'IPV4');
});

test('C3 shows draft, $defs, enum, arrays, additionalProperties, constraints and exact local refs', () => {
  const source = [
    '# Preserve comments and byte content',
    '$schema: https://json-schema.org/draft/2020-12/schema',
    '$id: example.schema.yaml',
    'title: Example',
    'type: object',
    'required: [flags]',
    'properties:',
    '  flags:',
    '    type: array',
    '    minItems: 1',
    '    items:',
    '      $ref: "#/$defs/option~1special"',
    '  opt:',
    '    enum: [alpha, beta, null]',
    'additionalProperties: false',
    '$defs:',
    '  option/special:',
    '    type: boolean',
    ''
  ].join('\n');
  const result = projectJsonSchema(source);
  assert.equal(result.state,'READY');
  assert.equal(find(result.tree,'flags').required,true);
  assert.equal(find(result.tree,'items').ref.value,'#/$defs/option~1special');
  assert.deepEqual(find(result.tree,'opt').constraints.find(c=>c.key==='enum').value,
    ['alpha','beta',null]);
  assert.equal(result.tree.constraints.find(c=>c.key==='additionalProperties').value,false);
  const ref = resolveSchemaPointer(source,'#/$defs/option~1special');
  assert.equal(ref.line,18);
  assert.equal(ref.pointer,'#/$defs/option~1special');
  assert.equal(resolveSchemaPointer(source,'#/$defs/missing'),null);
  assert.equal(resolveSchemaPointer(source,'https://example.com/spec'),null);
  assert.equal(resolveSchemaPointer(source,'#/$defs/option~2special'),null);
  assert.match(source,/^# Preserve comments/);
});

test('C3 does not expand cyclic refs and recognizes boolean sub-schemas', () => {
  const source = [
    '$schema: https://json-schema.org/draft/2020-12/schema',
    'type: object',
    'properties:',
    '  myself:',
    '    $ref: "#/properties/myself"',
    '  never: false'
  ].join('\n');
  const result = projectJsonSchema(source);
  assert.equal(result.state,'READY');
  assert.equal(find(result.tree,'myself').ref.value,'#/properties/myself');
  assert.equal(find(result.tree,'never').booleanValue,false);
  assert.equal(resolveSchemaPointer(source,'#/properties/myself').line,5);
  assert.ok(result.fieldCount < 10);
});

test('C3 keeps unsupported combinator/unknown extensions visible as PARTIAL', () => {
  const source = sample.replace('additionalProperties: false',
    'additionalProperties: false\nallOf:\n- type: object\nx-extra: true');
  const projected = projectJsonSchema(source);
  assert.equal(projected.state,'PARTIAL');
  assert.deepEqual(projected.unprojectedPaths.sort(),['#/allOf','#/x-extra']);
});

test('C3 fails closed on malformed/unsafe/unsupported or unbounded YAML', () => {
  assert.equal(projectJsonSchema('type: object').state,'SOURCE_ONLY');
  assert.equal(projectJsonSchema(sample.replace('2020-12','2019-09')).state,'SOURCE_ONLY');
  assert.equal(projectJsonSchema('$schema: [').state,'SOURCE_ONLY');
  assert.equal(projectJsonSchema(sample.replace('type: object','type: object\ntype: object'))
    .state,'SOURCE_ONLY');
  assert.equal(projectJsonSchema(sample.replace('type: object','type: &t object'))
    .state,'SOURCE_ONLY');
  assert.equal(projectJsonSchema('x'.repeat(1024*1024+1)).state,'SOURCE_ONLY');
  const deeplyNested = [
    '$schema: https://json-schema.org/draft/2020-12/schema',
    ...Array.from({length:18},(_,i)=>' '.repeat(i*2)+'items:'),
    ' '.repeat(18*2)+'type: string'
  ].join('\n');
  assert.equal(projectJsonSchema(deeplyNested).state,'SOURCE_ONLY');
});

test('C3 rejects malformed recognized fields rather than claiming complete visualization',()=>{
  const source = sample.replace('  sNssai:\n',
    '  sNssai:\n    required: 5\n');
  const p = projectJsonSchema(source);
  assert.equal(p.state,'PARTIAL');
  assert.ok(p.projectionWarnings.some(x=>x.includes('/required must be an array')));
});
