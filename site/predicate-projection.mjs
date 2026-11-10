import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// Read-only PredicateSet projection. Declarations are not live evidence/results.
const LIMIT = 1024 * 1024;
const MAX_NODES = 30000;
const SUPPORTED = 'connectionagent.io/v1alpha1';
const ROOT_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'predicates']);
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
function field(node, counter, path, warnings) {
  if (!node) return null;
  if (!isScalar(node)) {
    warnings.push(path + ' is not a scalar');
    return null;
  }
  return {value: node.value, path, line: nodeAt(node, counter)};
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
function projectObservation(name, node, counter, prefix, unknown, warnings) {
  if (!isMap(node)) {
    warnings.push(prefix + ' is not a mapping');
    return {name, line: nodeAt(node, counter), ref: null, scope: null,
      freshness: null, when: null};
  }
  unknownFields(node, new Set(['ref', 'scope', 'freshness', 'when']), prefix, unknown);
  return {
    name,
    line: nodeAt(node, counter),
    ref: field(get(node, 'ref'), counter, prefix + 'ref', warnings),
    scope: field(get(node, 'scope'), counter, prefix + 'scope', warnings),
    freshness: field(get(node, 'freshness'), counter, prefix + 'freshness', warnings),
    when: field(get(node, 'when'), counter, prefix + 'when', warnings)
  };
}
function projectPredicate(id, node, counter, unknown, warnings) {
  const prefix = 'predicates.' + id + '.';
  if (!isMap(node)) {
    warnings.push(prefix + 'definition is not a mapping');
    return {id, line: nodeAt(node, counter), observations: [], evaluator: null};
  }
  unknownFields(node, new Set(['observations', 'evaluator']), prefix, unknown);
  const observationsNode = get(node, 'observations');
  const observations = [];
  if (!isMap(observationsNode)) {
    warnings.push(prefix + 'observations is not a mapping');
  } else {
    for (const pair of observationsNode.items) {
      const name = scalar(pair.key);
      if (typeof name !== 'string') {
        warnings.push(prefix + 'observations contains a non-string key');
        continue;
      }
      observations.push(projectObservation(name, pair.value, counter,
        prefix + 'observations.' + name + '.', unknown, warnings));
    }
    if (!observations.length) warnings.push(prefix + 'observations is empty');
  }
  const evaluatorNode = get(node, 'evaluator');
  let evaluator = null;
  if (!isMap(evaluatorNode)) {
    warnings.push(prefix + 'evaluator is not a mapping');
  } else {
    const type = field(get(evaluatorNode, 'type'), counter,
      prefix + 'evaluator.type', warnings);
    const known = type?.value === 'cel'
      ? new Set(['type', 'expression'])
      : type?.value === 'script' ? new Set(['type', 'ref']) : new Set(['type']);
    unknownFields(evaluatorNode, known, prefix + 'evaluator.', unknown);
    evaluator = {
      type,
      expression: type?.value === 'cel'
        ? field(get(evaluatorNode, 'expression'), counter,
          prefix + 'evaluator.expression', warnings) : null,
      ref: type?.value === 'script'
        ? field(get(evaluatorNode, 'ref'), counter,
          prefix + 'evaluator.ref', warnings) : null,
      line: nodeAt(evaluatorNode, counter)
    };
    if (type?.value !== 'cel' && type?.value !== 'script')
      warnings.push(prefix + 'evaluator.type is not a supported cel/script variant');
  }
  return {id, line: nodeAt(node, counter), path: 'predicates.' + id,
    observations, evaluator};
}
export function projectPredicateSet(source) {
  if (typeof source !== 'string' || source.length > LIMIT)
    return fallback('PredicateSet Source is unavailable or exceeds the preview limit');
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
      scalar(get(root, 'kind')) !== 'PredicateSet' ||
      !isMap(get(root, 'metadata')) || !isMap(get(root, 'predicates')))
    return fallback('Not a supported v1alpha1 PredicateSet');

  const unknown = [];
  const warnings = [];
  unknownFields(root, ROOT_KEYS, '', unknown);
  unknownFields(get(root, 'metadata'), new Set(['skill']), 'metadata.', unknown);
  const predicateMap = get(root, 'predicates');
  const predicates = [];
  for (const pair of predicateMap.items) {
    const id = scalar(pair.key);
    if (typeof id !== 'string') {
      warnings.push('predicates contains a non-string identifier');
      continue;
    }
    predicates.push(projectPredicate(id, pair.value, counter, unknown, warnings));
  }
  if (!predicates.length) warnings.push('predicates is empty');
  const skill = field(get(root, 'metadata', 'skill'), counter, 'metadata.skill', warnings);
  const apiVersion = field(get(root, 'apiVersion'), counter, 'apiVersion', warnings);
  const state = unknown.length || warnings.length ? 'PARTIAL' : 'READY';
  return {
    state, kind: 'PredicateSet', apiVersion, skill,
    predicates, predicateCount: predicates.length,
    unprojectedPaths: unknown, projectionWarnings: warnings
  };
}
