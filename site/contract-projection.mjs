import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// Read-only, source-backed projection. Not a Runtime validator or a second DSL.
const LIMIT = 1024 * 1024;
const MAX_NODES = 20000;
const SUPPORTED = 'connectionagent.io/v1alpha1';
const ROOT_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'spec']);
const SPEC_KEYS = new Set([
  'skillType', 'goal', 'entryProcedure', 'inputs', 'context',
  'allowedResources', 'preconditions', 'postconditions',
  'planning', 'failureSemantics'
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
const values = (root, counter, ...path) => {
  const parent = get(root, ...path);
  if (!isSeq(parent)) return [];
  return parent.items.filter(isScalar).map((node, index) => ({
    value: scalar(node),
    path: path.join('.') + '[' + index + ']',
    line: nodeAt(node, counter)
  }));
};
const extraKeys = (node, known, prefix) => isMap(node) ? node.items
  .map(pair => scalar(pair.key))
  .filter(key => typeof key === 'string' && !known.has(key))
  .map(key => prefix + key) : [];

function unsafeTree(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (++seen > MAX_NODES || node.anchor || node.tag || isAlias(node))
      return true;
    if (isMap(node)) for (const pair of node.items) {
      stack.push(pair.key, pair.value);
    } else if (isSeq(node)) stack.push(...node.items);
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

  const spec = get(root, 'spec');
  const unknown = [
    ...extraKeys(root, ROOT_KEYS, ''),
    ...extraKeys(spec, SPEC_KEYS, 'spec.')
  ];
  const post = get(root, 'spec', 'postconditions');
  const postconditions = isSeq(post) ? post.items.map((entry, index) => ({
    predicate: field(entry, counter, 'predicate'),
    expect: field(entry, counter, 'expect'),
    line: nodeAt(entry, counter),
    path: 'spec.postconditions[' + index + ']'
  })) : [];
  return {
    state: unknown.length ? 'PARTIAL' : 'READY',
    kind: 'SkillContract',
    apiVersion: field(root, counter, 'apiVersion'),
    name: field(root, counter, 'metadata', 'name'),
    skillType: field(root, counter, 'spec', 'skillType'),
    goal: field(root, counter, 'spec', 'goal'),
    entryProcedure: field(root, counter, 'spec', 'entryProcedure'),
    requestSchema: field(root, counter, 'spec', 'inputs', 'requestSchema'),
    requiredFacts: values(root, counter, 'spec', 'context', 'requiredFacts'),
    capabilities: values(root, counter, 'spec', 'allowedResources', 'capabilities'),
    localTools: values(root, counter, 'spec', 'allowedResources', 'localTools'),
    postconditions,
    maxActions: field(root, counter, 'spec', 'planning', 'maxActions'),
    allowDynamicProcedure: field(root, counter, 'spec', 'planning', 'allowDynamicProcedure'),
    requireReconcile: field(root, counter, 'spec', 'failureSemantics',
      'outcomeUnknown', 'requireReconcile'),
    unprojectedPaths: unknown
  };
}
