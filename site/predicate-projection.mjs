import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// Read-only CA-SL v1alpha5 Predicate projection. Parameters and Evidence
// declarations are source metadata; CEL and Script evaluators are never run.
const LIMIT = 1024 * 1024;
const MAX_NODES = 30000;
const ROOT_KEYS = new Set(['predicates']);
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
function projectParameters(node, counter, prefix, warnings) {
  if (!node) {
    warnings.push(prefix + 'parameters is missing');
    return [];
  }
  if (!isSeq(node)) {
    warnings.push(prefix + 'parameters is not a sequence');
    return [];
  }
  const parameters = [];
  node.items.forEach((item, index) => {
    const path = prefix + 'parameters[' + index + ']';
    if (!isMap(item) || item.items.length !== 1) {
      warnings.push(path + ' must be a single-entry parameter mapping');
      return;
    }
    const pair = item.items[0];
    const name = scalar(pair.key);
    const type = scalar(pair.value);
    if (typeof name !== 'string' || !name.trim() ||
        typeof type !== 'string' || !type.trim()) {
      warnings.push(path + ' must map a parameter name to a type or Schema identity');
      return;
    }
    parameters.push({
      name,
      type,
      path: path + '.' + name,
      line: nodeAt(pair.value, counter),
      nameLine: nodeAt(pair.key, counter)
    });
  });
  if (!parameters.length) warnings.push(prefix + 'parameters is empty');
  const names = new Set();
  for (const parameter of parameters) {
    if (names.has(parameter.name)) warnings.push(prefix + 'parameters contains duplicate ' + parameter.name);
    names.add(parameter.name);
  }
  return parameters;
}
function projectEvidence(node, counter, prefix, parameterNames, unknown, warnings) {
  if (!node) return [];
  if (!isMap(node)) {
    warnings.push(prefix + 'evidence is not a mapping');
    return [];
  }
  unknownFields(node, new Set(['requires']), prefix + 'evidence.', unknown);
  const requires = get(node, 'requires');
  if (!requires) {
    warnings.push(prefix + 'evidence.requires is missing');
    return [];
  }
  if (!isMap(requires)) {
    warnings.push(prefix + 'evidence.requires is not a mapping');
    return [];
  }
  return requires.items.map(pair => {
    const parameter = scalar(pair.key);
    const path = prefix + 'evidence.requires.' + String(parameter);
    if (typeof parameter !== 'string' || !parameter.trim()) {
      warnings.push(prefix + 'evidence.requires contains a non-string parameter');
      return null;
    }
    if (!parameterNames.has(parameter))
      warnings.push(path + ' refers to an undeclared parameter');
    if (!isSeq(pair.value)) {
      warnings.push(path + ' is not a sequence');
      return null;
    }
    const guarantees = pair.value.items.map((item, index) => {
      if (!isScalar(item) || typeof scalar(item) !== 'string' || !scalar(item).trim()) {
        warnings.push(path + '[' + index + '] must be a non-empty Evidence identity');
        return null;
      }
      return {value: scalar(item), path: path + '[' + index + ']', line: nodeAt(item, counter)};
    }).filter(Boolean);
    if (!guarantees.length) warnings.push(path + ' is empty');
    return {parameter, guarantees, path, line: nodeAt(pair.value, counter)};
  }).filter(Boolean);
}
function safeScriptPath(value) {
  return typeof value === 'string' && value.startsWith('scripts/') &&
    !value.startsWith('/') && !value.includes('\\') &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function projectEvaluator(node, counter, prefix, unknown, warnings) {
  if (!isMap(node)) {
    warnings.push(prefix + 'evaluator is not a mapping');
    return null;
  }
  const type = stringField(get(node, 'type'), counter, prefix + 'evaluator.type', warnings, true);
  const variant = type?.value;
  const allowed = variant === 'cel' ? new Set(['type', 'expression'])
    : variant === 'script' ? new Set(['type', 'script']) : new Set(['type']);
  unknownFields(node, allowed, prefix + 'evaluator.', unknown);
  if (variant === 'cel') {
    return {
      type,
      expression: stringField(get(node, 'expression'), counter,
        prefix + 'evaluator.expression', warnings, true),
      script: null,
      line: nodeAt(node, counter)
    };
  }
  if (variant === 'script') {
    const script = stringField(get(node, 'script'), counter,
      prefix + 'evaluator.script', warnings, true);
    if (script && !safeScriptPath(script.value))
      warnings.push(prefix + 'evaluator.script is not a safe scripts/ package-relative path');
    return {type, expression: null, script, line: nodeAt(node, counter)};
  }
  if (variant !== undefined)
    warnings.push(prefix + 'evaluator.type is not a supported cel/script variant');
  return {type, expression: null, script: null, line: nodeAt(node, counter)};
}
function projectPredicate(id, node, counter, unknown, warnings) {
  const prefix = 'predicates.' + id + '.';
  if (!isMap(node)) {
    warnings.push(prefix + 'definition is not a mapping');
    return {id, line: nodeAt(node, counter), parameters: [], evidence: [], evaluator: null};
  }
  unknownFields(node, new Set(['parameters', 'evidence', 'evaluator']), prefix, unknown);
  const parameters = projectParameters(get(node, 'parameters'), counter, prefix, warnings);
  const parameterNames = new Set(parameters.map(parameter => parameter.name));
  const evidence = projectEvidence(get(node, 'evidence'), counter, prefix,
    parameterNames, unknown, warnings);
  const evaluator = projectEvaluator(get(node, 'evaluator'), counter, prefix, unknown, warnings);
  return {id, line: nodeAt(node, counter), path: 'predicates.' + id,
    parameters, evidence, evaluator};
}
export function projectPredicateSet(source, options = {}) {
  if (typeof source !== 'string' || source.length > LIMIT)
    return fallback('Predicate Source is unavailable or exceeds the preview limit');
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
  const predicateMap = get(root, 'predicates');
  const predicates = [];
  if (!isMap(predicateMap)) {
    warnings.push('predicates is not a mapping');
  } else {
    for (const pair of predicateMap.items) {
      const id = scalar(pair.key);
      if (typeof id !== 'string' || !id.trim()) {
        warnings.push('predicates contains a non-string identifier');
        continue;
      }
      predicates.push(projectPredicate(id, pair.value, counter, unknown, warnings));
    }
  }
  if (!predicates.length) warnings.push('predicates is empty');
  const skillName = typeof options.skillName === 'string' && options.skillName.trim()
    ? {value: options.skillName, path: 'package', line: 1} : null;
  const state = unknown.length || warnings.length ? 'PARTIAL' : 'READY';
  return {
    state,
    kind: 'PredicateSet',
    language: 'CA-SL v1alpha5',
    skill: skillName,
    predicates,
    predicateCount: predicates.length,
    unprojectedPaths: unknown,
    projectionWarnings: warnings
  };
}
