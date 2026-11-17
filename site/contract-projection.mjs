import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// Read-only CA-SL v1alpha4 Contract projection. This is not qualification,
// dependency linking, authorization, or Runtime validation.
const LIMIT = 1024 * 1024;
const MAX_NODES = 20000;
const ROOT_KEYS = new Set([
  'goal', 'precondition', 'requestSchema', 'contextSchema',
  'dependencies', 'capabilities', 'limits'
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
function stringField(node, counter, path, warnings, required = false) {
  if (!node) {
    if (required) warnings.push(path + ' is missing');
    return null;
  }
  if (!isScalar(node) || typeof scalar(node) !== 'string' || !scalar(node).trim()) {
    warnings.push(path + ' must be a non-empty string');
    return null;
  }
  return {value: scalar(node), path, line: nodeAt(node, counter)};
}
function scalarList(root, counter, path, warnings) {
  const node = get(root, ...path);
  if (!node) return [];
  if (!isSeq(node)) {
    warnings.push(path.join('.') + ' is not a sequence');
    return [];
  }
  return node.items.map((item, index) => {
    if (!isScalar(item) || typeof scalar(item) !== 'string' || !scalar(item).trim()) {
      warnings.push(path.join('.') + '[' + index + '] must be a non-empty string');
      return null;
    }
    return {
      value: scalar(item),
      path: path.join('.') + '[' + index + ']',
      line: nodeAt(item, counter)
    };
  }).filter(Boolean);
}
function dependencyList(root, counter, warnings) {
  const node = get(root, 'dependencies');
  if (!node) return [];
  if (!isMap(node)) {
    warnings.push('dependencies is not a mapping');
    return [];
  }
  return node.items.map(pair => {
    const name = scalar(pair.key);
    const value = scalar(pair.value);
    if (typeof name !== 'string' || !name.trim() ||
        typeof value !== 'string' || !value.trim()) {
      warnings.push('dependencies entries must map non-empty aliases to non-empty identities');
      return null;
    }
    return {
      name,
      value,
      path: 'dependencies.' + name,
      line: nodeAt(pair.value, counter)
    };
  }).filter(Boolean);
}
function limitList(root, counter, warnings) {
  const node = get(root, 'limits');
  if (!node) return [];
  if (!isMap(node)) {
    warnings.push('limits is not a mapping');
    return [];
  }
  return node.items.map(pair => {
    const name = scalar(pair.key);
    const value = scalar(pair.value);
    if (typeof name !== 'string' || !name.trim() || !isScalar(pair.value)) {
      warnings.push('limits entries must have string names and scalar values');
      return null;
    }
    return {
      name,
      value,
      path: 'limits.' + name,
      line: nodeAt(pair.value, counter)
    };
  }).filter(Boolean);
}
function unknownFields(node, allowed, prefix, output) {
  if (!isMap(node)) return;
  for (const pair of node.items) {
    const key = scalar(pair.key);
    if (typeof key === 'string' && !allowed.has(key)) output.push(prefix + key);
  }
}
function unsafeTree(root) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (++seen > MAX_NODES || node.anchor || node.tag || isAlias(node)) return true;
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
export function projectSkillContract(source, options = {}) {
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

  const unknown = [];
  const warnings = [];
  unknownFields(root, ROOT_KEYS, '', unknown);
  const goal = stringField(get(root, 'goal'), counter, 'goal', warnings, true);
  const precondition = stringField(get(root, 'precondition'), counter, 'precondition', warnings);
  const requestSchema = stringField(get(root, 'requestSchema'), counter, 'requestSchema', warnings);
  const contextSchema = stringField(get(root, 'contextSchema'), counter, 'contextSchema', warnings);
  const capabilities = scalarList(root, counter, ['capabilities'], warnings);
  const dependencies = dependencyList(root, counter, warnings);
  const limits = limitList(root, counter, warnings);
  const packageName = typeof options.name === 'string' && options.name.trim()
    ? {value: options.name, path: 'package', line: 1} : null;
  const state = unknown.length || warnings.length ? 'PARTIAL' : 'READY';
  return {
    state,
    kind: 'SkillContract',
    language: 'CA-SL v1alpha4',
    name: packageName,
    goal,
    precondition,
    requestSchema,
    contextSchema,
    capabilities,
    dependencies,
    limits,
    unprojectedPaths: unknown,
    projectionWarnings: warnings
  };
}
