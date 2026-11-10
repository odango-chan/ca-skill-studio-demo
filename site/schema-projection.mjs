import {parseDocument, LineCounter, isMap, isSeq, isScalar, isAlias} from 'yaml';

// JSON Schema 2020-12 source projection only. It is not a validator.
// Do not fetch external $schema/$ref resources or infer Runtime qualification.
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const MAX_BYTES = 1024 * 1024;
const MAX_NODES = 20000;
const MAX_FIELDS = 500;
const MAX_DEPTH = 16;
const CONSTRAINTS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems',
  'minProperties', 'maxProperties', 'uniqueItems', 'default', 'const', 'enum'
]);
const FIELDS = new Set([
  '$schema', '$id', 'title', 'description', 'type', '$ref', '$defs', 'properties',
  'required', 'items', 'additionalProperties', ...CONSTRAINTS
]);
const scalar = n => isScalar(n) ? n.value : undefined;
const pathOf = (...parts) => '#/' + parts.map(part =>
  String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const lineOf = (n, counter) => counter.linePos(n?.range?.[0] ?? 0).line || 1;
const child = (map, key) => isMap(map) ? map.get(key, true) : undefined;
const sourceField = (n, counter, pointer) => isScalar(n)
  ? {value: n.value, line: lineOf(n, counter), pointer} : null;

function fallback(reason, line = 1) {
  return {state: 'SOURCE_ONLY', reason, line};
}
function structurallyUnsafe(root) {
  const stack = [root];
  let count = 0;
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (++count > MAX_NODES || n.anchor || n.tag || isAlias(n)) return true;
    if (isMap(n)) {
      for (const pair of n.items) stack.push(pair.key, pair.value);
    } else if (isSeq(n)) {
      for (const item of n.items) stack.push(item);
    }
  }
  return false;
}
function summaryValue(n, counter, ptr, warnings, required = false) {
  if (n === undefined) {
    if (required) warnings.push(ptr + ' missing');
    return null;
  }
  if (!isScalar(n) || n.value === null || typeof n.value === 'object') {
    warnings.push(ptr + ' is not scalar');
    return null;
  }
  return sourceField(n, counter, ptr);
}
function stringSequence(n, counter, ptr, warnings) {
  if (!isSeq(n)) {
    warnings.push(ptr + ' must be an array');
    return [];
  }
  const ret = [];
  for (const [i,item] of n.items.entries()) {
    if (!isScalar(item) || typeof item.value !== 'string') {
      warnings.push(ptr + '/' + i + ' is not a string');
      continue;
    }
    ret.push(item.value);
  }
  return ret;
}
function projectionContext(source) {
  const lines = new LineCounter();
  const doc = parseDocument(source, {
    version: '1.2', schema: 'core', strict: true,
    uniqueKeys: true, stringKeys: true, lineCounter: lines, logLevel: 'silent'
  });
  return {lines, doc};
}
export function projectJsonSchema(source) {
  if (typeof source !== 'string' || source.length > MAX_BYTES)
    return fallback('Schema source is missing or exceeds preview size');
  const {lines, doc} = projectionContext(source);
  if (doc.errors.length) {
    const e = doc.errors[0];
    return fallback('Invalid YAML: ' + e.message,
      lines.linePos(e.pos?.[0] ?? 0).line || 1);
  }
  const root = doc.contents;
  if (!isMap(root) || structurallyUnsafe(root))
    return fallback('Unsupported YAML structure, alias, anchor or explicit tag');
  const declaredDraft = scalar(child(root, '$schema'));
  if (declaredDraft !== DRAFT && declaredDraft !== DRAFT + '#')
    return fallback('Only explicitly declared JSON Schema Draft 2020-12 is visualized');

  const warnings = [], unprojectedPaths = [], allRefs = [];
  let fieldCount = 0, overBudget = false;
  const schemaNode = (node, name, pointerParts, depth, required = false, lineNode = node) => {
    if (++fieldCount > MAX_FIELDS || depth > MAX_DEPTH) {
      overBudget = true;
      return null;
    }
    const pointer = pathOf(...pointerParts), line = lineOf(lineNode, lines);
    if (isScalar(node) && typeof node.value === 'boolean')
      return {name, pointer, line, depth, required, type: 'boolean-schema',
        booleanValue: node.value, title: null, description: null, ref: null,
        constraints: [], children: []};
    if (!isMap(node)) {
      warnings.push(pointer + ' is not a JSON Schema object/boolean');
      return {name, pointer, line, depth, required, type: 'unsupported', title: null,
        description: null, ref: null, constraints: [], children: []};
    }
    for (const pair of node.items) {
      const key = scalar(pair.key);
      if (typeof key !== 'string' || !FIELDS.has(key))
        unprojectedPaths.push(pointer + '/' + String(key));
    }
    const t = child(node, 'type');
    let type = 'any';
    if (t !== undefined) {
      if (isScalar(t) && typeof t.value === 'string') type = t.value;
      else if (isSeq(t)) type = stringSequence(t, lines, pointer + '/type', warnings).join(' | ');
      else {warnings.push(pointer + '/type must be string or array');type = 'unsupported';}
    }
    const ref = summaryValue(child(node,'$ref'),lines,pointer+'/$ref',warnings);
    const title = summaryValue(child(node,'title'),lines,pointer+'/title',warnings);
    const description = summaryValue(child(node,'description'),lines,pointer+'/description',warnings);
    if (ref) allRefs.push({sourcePointer: pointer, reference: ref.value, line: ref.line});
    const constraints = [];
    for (const key of CONSTRAINTS) {
      const value = child(node,key);
      if (value === undefined) continue;
      if (key === 'enum') {
        if (!isSeq(value)) {warnings.push(pointer+'/enum must be an array');continue;}
        const values = value.items.map(v=>scalar(v));
        if (values.some(v => v === undefined || (v !== null && typeof v === 'object'))) {
          warnings.push(pointer+'/enum contains complex values; inspect Source');
          continue;
        }
        constraints.push({key, value: values, line:lineOf(value,lines)});
      } else {
        const datum = summaryValue(value,lines,pointer+'/'+key,warnings);
        if (datum) constraints.push({key, value:datum.value, line:datum.line});
      }
    }
    const children = [], props = child(node,'properties');
    const requirements = child(node,'required');
    const requiredNames = requirements === undefined ? [] :
      stringSequence(requirements, lines, pointer+'/required',warnings);
    if (requirements !== undefined)
      constraints.push({key:'required',value:requiredNames,line:lineOf(requirements,lines)});
    if (props !== undefined && !isMap(props))
      warnings.push(pointer+'/properties must be a mapping');
    if (isMap(props)) for (const pair of props.items) {
      const key = scalar(pair.key);
      if (typeof key !== 'string') {warnings.push(pointer+'/properties non-string name');continue;}
      const next = schemaNode(pair.value,key,[...pointerParts,'properties',key],
        depth+1,requiredNames.includes(key),pair.key);
      if (next) children.push(next);
    }
    const definitions = child(node,'$defs');
    if (definitions !== undefined && !isMap(definitions))
      warnings.push(pointer+'/$defs must be a mapping');
    if (isMap(definitions)) for (const pair of definitions.items) {
      const key = scalar(pair.key);
      if (typeof key !== 'string') {warnings.push(pointer+'/$defs non-string name');continue;}
      const next = schemaNode(pair.value,'$defs / '+key,[...pointerParts,'$defs',key],
        depth+1,false,pair.key);
      if (next) children.push(next);
    }
    const items = child(node,'items');
    if (items !== undefined) {
      const next = schemaNode(items,'items',[...pointerParts,'items'],depth+1);
      if (next) children.push(next);
    }
    const additional = child(node,'additionalProperties');
    if (additional !== undefined) {
      if (isScalar(additional) && typeof additional.value === 'boolean')
        constraints.push({key:'additionalProperties',value:additional.value,
          line:lineOf(additional,lines)});
      else {
        const next = schemaNode(additional,'additionalProperties',
          [...pointerParts,'additionalProperties'],depth+1);
        if (next) children.push(next);
      }
    }
    return {name,pointer,line,depth,required,type,title,description,ref,
      constraints,children};
  };
  const tree = schemaNode(root,'Root',[],0);
  if (overBudget) return fallback('Schema exceeds safe field count or nesting depth');
  return {
    state: unprojectedPaths.length || warnings.length ? 'PARTIAL' : 'READY',
    kind: 'JsonSchema202012', draft: declaredDraft,
    title: scalar(child(root,'title')) ?? null,
    schemaId: scalar(child(root,'$id')) ?? null,
    tree, fieldCount, allRefs, unprojectedPaths, projectionWarnings:warnings
  };
}

// No external fetch. Parse only document-local JSON Pointers, preserving the
// exact referenced YAML source line. Cycles never expand: only navigate.
export function resolveSchemaPointer(source, ref) {
  if (typeof ref !== 'string' || !(ref === '#' || ref.startsWith('#/')) ||
      ref.length > 2048) return null;
  if (typeof source !== 'string' || source.length > MAX_BYTES) return null;
  const {lines,doc} = projectionContext(source);
  if (doc.errors.length || !isMap(doc.contents) || structurallyUnsafe(doc.contents))
    return null;
  const parts = ref === '#' ? [] : ref.slice(2).split('/').map(x => {
    if (/~(?![01])/.test(x)) return null;
    return x.replaceAll('~1','/').replaceAll('~0','~');
  });
  if (parts.includes(null)) return null;
  let node = doc.contents;
  for (const key of parts) {
    if (isMap(node)) node = node.get(key,true);
    else if (isSeq(node) && /^(0|[1-9]\d*)$/.test(key))
      node = node.items[Number(key)];
    else return null;
    if (node === undefined) return null;
  }
  return {line:lineOf(node,lines), pointer:ref};
}
