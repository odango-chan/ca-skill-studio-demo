import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// Read-only, source-backed projection. Not a Runtime validator or a second DSL.
const LIMIT = 1024 * 1024;
const MAX_NODES = 20000;
const SUPPORTED = 'connectionagent.io/v1alpha1';
const ROOT_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'spec']);
const SPEC_KEYS = new Set([
  'skillType', 'goal', 'entryProcedure', 'inputs', 'context',
  'allowedResources', 'preconditions', 'requirements', 'postconditions',
  'dependencies', 'planning', 'failureSemantics'
]);
const scalar = node => isScalar(node) ? node.value : undefined;
const nodeAt = (node, counter) => counter.linePos(node?.range?.[0] ?? 0).line || 1;
const get = (node, ...path) => {
  let current = node;
  for (const key of path) {
    if (!isMap(current)) return undefined;
    current = current.get(key, true);
  }
  return current;
};
const field = (root, counter, ...path) => {
  const node = get(root, ...path);
  return isScalar(node) ? {
    value: node.value,
    path: path.join('.'),
    line: nodeAt(node, counter)
  } : null;
};
function listValues(root, counter, path, warnings) {
  const parent = get(root, ...path);
  if (!parent) return [];
  if (!isSeq(parent)) {
    warnings.push(path.join('.') + ' is not a sequence');
    return [];
  }
  return parent.items.filter(isScalar).map((node, index) => ({
    value: scalar(node),
    path: path.join('.') + '[' + index + ']',
    line: nodeAt(node, counter)
  }));
}
function contextSchemaList(root, counter, warnings) {
  const schemas = get(root, 'spec', 'context', 'schemas');
  if (!schemas) return [];
  if (!isMap(schemas)) {
    warnings.push('spec.context.schemas is not a mapping');
    return [];
  }
  return schemas.items.map(pair => {
    const name = scalar(pair.key);
    const value = scalar(pair.value);
    if (typeof name !== 'string' || typeof value !== 'string' || !value.trim()) {
      warnings.push('spec.context.schemas entries must have string keys and paths');
      return null;
    }
    return {
      name,
      value,
      path: 'spec.context.schemas.' + name,
      line: nodeAt(pair.value, counter)
    };
  }).filter(Boolean);
}
function expectationList(root, counter, name, warnings, satisfiable = false) {
  const path = ['spec', name];
  const list = get(root, ...path);
  if (!list) return [];
  if (!isSeq(list)) {
    warnings.push(path.join('.') + ' is not a sequence');
    return [];
  }
  return list.items.map((entry, index) => ({
    predicate: field(entry, counter, 'predicate'),
    expect: field(entry, counter, 'expect'),
    satisfiable: satisfiable ? field(entry, counter, 'satisfiable') : null,
    line: nodeAt(entry, counter),
    path: path.join('.') + '[' + index + ']'
  }));
}
function dependencyList(root, counter, warnings) {
  const list = get(root, 'spec', 'dependencies');
  if (!list) return [];
  if (!isSeq(list)) {
    warnings.push('spec.dependencies is not a sequence');
    return [];
  }
  return list.items.map((entry, index) => ({
    name: field(entry, counter, 'name'),
    artifactRef: field(entry, counter, 'artifactRef'),
    digest: field(entry, counter, 'digest'),
    variant: field(entry, counter, 'variant'),
    line: nodeAt(entry, counter),
    path: 'spec.dependencies[' + index + ']'
  }));
}
function unknownFields(node, allowed, prefix, output) {
  if (!isMap(node)) return;
  for (const pair of node.items) {
    const key = scalar(pair.key);
    if (typeof key === 'string' && !allowed.has(key)) output.push(prefix + key);
  }
}
function collectUnprojected(root) {
  const paths = [];
  unknownFields(root, ROOT_KEYS, '', paths);
  unknownFields(get(root, 'metadata'), new Set(['name']), 'metadata.', paths);
  const spec = get(root, 'spec');
  unknownFields(spec, SPEC_KEYS, 'spec.', paths);
  unknownFields(get(spec, 'inputs'), new Set(['requestSchema']), 'spec.inputs.', paths);
  unknownFields(get(spec, 'context'), new Set(['requiredFacts', 'schemas']), 'spec.context.', paths);
  unknownFields(get(spec, 'context', 'schemas'),
    new Set(['subject', 'facts', 'observations', 'evidence']),
    'spec.context.schemas.', paths);
  unknownFields(get(spec, 'allowedResources'), new Set(['capabilities', 'localTools']),
    'spec.allowedResources.', paths);
  unknownFields(get(spec, 'planning'),
    new Set(['maxActions', 'allowDynamicProcedure', 'fallbackProcedure', 'budgetPartition']),
    'spec.planning.', paths);
  unknownFields(get(spec, 'planning', 'budgetPartition'),
    new Set(['parentActions', 'childActions']), 'spec.planning.budgetPartition.', paths);
  unknownFields(get(spec, 'failureSemantics'), new Set(['outcomeUnknown']),
    'spec.failureSemantics.', paths);
  unknownFields(get(spec, 'failureSemantics', 'outcomeUnknown'),
    new Set(['requireReconcile']), 'spec.failureSemantics.outcomeUnknown.', paths);
  for (const section of ['preconditions', 'requirements', 'postconditions']) {
    const list = get(spec, section);
    if (!isSeq(list)) continue;
    list.items.forEach((entry, index) => unknownFields(entry,
      section === 'requirements'
        ? new Set(['predicate', 'expect', 'satisfiable'])
        : new Set(['predicate', 'expect']),
      'spec.' + section + '[' + index + '].', paths));
  }
  const dependencies = get(spec, 'dependencies');
  if (isSeq(dependencies)) dependencies.items.forEach((entry, index) =>
    unknownFields(entry, new Set(['name', 'artifactRef', 'digest', 'variant']),
      'spec.dependencies[' + index + '].', paths));
  return paths;
}
function unsafeTree(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (++seen > MAX_NODES || node.anchor || node.tag || isAlias(node))
      return true;
    if (isMap(node)) {
      for (const pair of node.items) stack.push(pair.key, pair.value);
    } else if (isSeq(node)) {
      for (const item of node.items) stack.push(item);
    }
  }
  return false;
}
function fallback(reason, line = 1) {
  return {state: 'SOURCE_ONLY', reason, line};
}
export function projectSkillContract(source) {
  if (typeof source !== 'string' || source.length > LIMIT)
    return fallback('Contract Source is unavailable or exceeds the preview limit');
  const counter = new LineCounter();
  const doc = parseDocument(source, {
    version: '1.2', schema: 'core', strict: true,
    uniqueKeys: true, stringKeys: true,
    lineCounter: counter, logLevel: 'silent'
  });
  if (doc.errors.length) {
    const error = doc.errors[0];
    return fallback('Invalid YAML: ' + error.message,
      counter.linePos(error.pos?.[0] ?? 0).line || 1);
  }
  const root = doc.contents;
  if (!isMap(root) || unsafeTree(root))
    return fallback('Unsupported YAML structure, alias, anchor or explicit tag');
  if (scalar(get(root, 'apiVersion')) !== SUPPORTED ||
      scalar(get(root, 'kind')) !== 'SkillContract' ||
      !isMap(get(root, 'metadata')) || !isMap(get(root, 'spec')))
    return fallback('Not a supported v1alpha1 SkillContract');

  const warnings = [];
  const spec = get(root, 'spec');
  const post = get(spec, 'planning');
  const budget = get(post, 'budgetPartition');
  const failure = get(spec, 'failureSemantics');
  const outcomeUnknown = get(failure, 'outcomeUnknown');
  const unknown = collectUnprojected(root);
  const requiredFacts = listValues(root, counter, ['spec', 'context', 'requiredFacts'], warnings);
  const contextSchemas = contextSchemaList(root, counter, warnings);
  const capabilities = listValues(root, counter,
    ['spec', 'allowedResources', 'capabilities'], warnings);
  const localTools = listValues(root, counter,
    ['spec', 'allowedResources', 'localTools'], warnings);
  const preconditions = expectationList(root, counter, 'preconditions', warnings);
  const requirements = expectationList(root, counter, 'requirements', warnings, true);
  const postconditions = expectationList(root, counter, 'postconditions', warnings);
  const dependencies = dependencyList(root, counter, warnings);
  const state = unknown.length || warnings.length ? 'PARTIAL' : 'READY';
  return {
    state,
    kind: 'SkillContract',
    apiVersion: field(root, counter, 'apiVersion'),
    name: field(root, counter, 'metadata', 'name'),
    skillType: field(root, counter, 'spec', 'skillType'),
    goal: field(root, counter, 'spec', 'goal'),
    entryProcedure: field(root, counter, 'spec', 'entryProcedure'),
    requestSchema: field(root, counter, 'spec', 'inputs', 'requestSchema'),
    requiredFacts,
    contextSchemas,
    capabilities,
    localTools,
    preconditions,
    requirements,
    postconditions,
    dependencies,
    maxActions: field(root, counter, 'spec', 'planning', 'maxActions'),
    allowDynamicProcedure: field(root, counter, 'spec', 'planning', 'allowDynamicProcedure'),
    fallbackProcedure: field(root, counter, 'spec', 'planning', 'fallbackProcedure'),
    budgetPartition: {
      parentActions: field(budget, counter, 'parentActions'),
      childActions: field(budget, counter, 'childActions')
    },
    requireReconcile: field(outcomeUnknown, counter, 'requireReconcile'),
    unprojectedPaths: unknown,
    projectionWarnings: warnings
  };
}
