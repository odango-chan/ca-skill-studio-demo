import {
  parseDocument,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  stringify,
} from "yaml";

export const V1ALPHA4_PATCH_ENGINE = "ca-studio.v1alpha4-semantic-patch/v1";

const STAGES = ["precondition", "operation", "observation", "postcondition"];
const TERMINALS = new Set(["SUCCEEDED", "FAILED", "UNRESOLVED", "SAFE_STOPPED"]);
const NODE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const ARGUMENT_ID = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;

export class PatchPlanningError extends Error {
  constructor(code, message, operationId = null) {
    super(message || ("v1alpha4 Patch Engine rejected the Change Set: " + code));
    this.name = "PatchPlanningError";
    this.code = code;
    this.operationId = operationId;
  }
}

function reject(code, message, operationId) {
  throw new PatchPlanningError(code, message, operationId);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys, operationId) {
  if (!plain(value) || Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) {
    reject("operation_payload_invalid", "Semantic operation payload has an unsupported shape.", operationId);
  }
}

function nonEmptyString(value, field, operationId, max = 2048) {
  if (typeof value !== "string" || value.trim().length === 0 ||
    value.length > max || /[\r\n\u0000-\u001f]/.test(value)) {
    reject("operation_value_invalid", "Invalid " + field + ".", operationId);
  }
  return value;
}

function parseSource(source) {
  if (typeof source !== "string" || source.length === 0 ||
    new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    reject("source_invalid", "Procedure Source is empty or exceeds the 1 MiB patch limit.");
  }
  if (/^\s*(?:%YAML|%TAG|---|\.\.\.)/m.test(source)) {
    reject("source_profile_unsupported", "YAML directives and multi-document streams are outside the v1alpha4 patch profile.");
  }
  let document;
  try {
    document = parseDocument(source, {
      version: "1.2",
      schema: "core",
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
      keepSourceTokens: true,
      logLevel: "silent",
    });
  } catch (error) {
    reject("yaml_parse_failed", "YAML parser rejected the Procedure Source: " + String(error));
  }
  if (document.errors.length) {
    reject("yaml_parse_failed", "Procedure Source contains YAML parse errors.");
  }
  if (!isMap(document.contents)) reject("procedure_root_invalid", "v1alpha4 Procedure must have a mapping root.");
  const root = document.contents;
  const startPair = findPair(root, "start");
  const nodesPair = findPair(root, "nodes");
  if (!startPair || !isScalar(startPair.value) || typeof startPair.value.value !== "string" ||
    !nodesPair || !isMap(nodesPair.value) || nodesPair.value.items.length === 0) {
    reject("procedure_root_invalid", "v1alpha4 Procedure requires a scalar start and a nonempty nodes mapping.");
  }
  const nodes = new Map();
  for (const pair of nodesPair.value.items) {
    const id = scalar(pair.key);
    if (!id || !NODE_ID.test(id) || TERMINALS.has(id) || id === "context" ||
      nodes.has(id) || !isMap(pair.value)) {
      reject("node_mapping_invalid", "Procedure contains an invalid or reserved Node identifier.");
    }
    nodes.set(id, pair.value);
  }
  return {
    document,
    root,
    startPair,
    nodesPair,
    nodesMap: nodesPair.value,
    start: scalar(startPair.value),
    nodes,
    source,
  };
}

function findPair(map, key) {
  if (!isMap(map)) return null;
  return map.items.find((pair) => scalar(pair.key) === key) || null;
}

function scalar(node) {
  return isScalar(node) && typeof node.value === "string" ? node.value : "";
}

function getMapValue(map, key, operationId) {
  const pair = findPair(map, key);
  if (!pair || !isMap(pair.value)) {
    reject("target_not_found", "Expected mapping " + key + " was not found.", operationId);
  }
  return { pair, map: pair.value };
}

function getNode(parsed, nodeId, operationId) {
  const node = parsed.nodes.get(nodeId);
  if (!node) reject("target_not_found", "Node " + nodeId + " does not exist in the base Procedure.", operationId);
  return node;
}

function getStage(parsed, nodeId, stageName, operationId) {
  if (!STAGES.includes(stageName)) reject("stage_invalid", "Unsupported v1alpha4 stage.", operationId);
  const node = getNode(parsed, nodeId, operationId);
  return getMapValue(node, stageName, operationId);
}

function rangeOf(node, operationId) {
  if (!node || isAlias(node) || !Array.isArray(node.range) ||
    !Number.isSafeInteger(node.range[0]) || !Number.isSafeInteger(node.range[1]) ||
    node.range[0] < 0 || node.range[1] < node.range[0]) {
    reject("source_range_unavailable", "YAML source range is unavailable for the requested semantic target.", operationId);
  }
  return { start: node.range[0], end: node.range[1] };
}

function encodedScalar(value, originalRaw) {
  if (originalRaw.startsWith('"')) return JSON.stringify(value);
  if (originalRaw.startsWith("'")) return "'" + value.replace(/'/g, "''") + "'";
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

function mapIndent(source, map, operationId) {
  if (!isMap(map) || map.items.length === 0) {
    reject("empty_collection_unsupported", "Appending to an empty YAML mapping is not supported by this source-preserving patch profile.", operationId);
  }
  const offset = rangeOf(map.items[0].key, operationId).start;
  const lineStart = Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
  const prefix = source.slice(lineStart, offset);
  if (!/^[ \t]*$/.test(prefix)) reject("indentation_unavailable", "YAML mapping indentation is ambiguous.", operationId);
  return prefix;
}

function sequenceIndent(source, sequence, operationId) {
  if (!isSeq(sequence) || sequence.items.length === 0) {
    reject("empty_collection_unsupported", "Appending to an empty YAML sequence is not supported by this source-preserving patch profile.", operationId);
  }
  const offset = rangeOf(sequence.items[0], operationId).start;
  const lineStart = Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
  const prefix = source.slice(lineStart, offset);
  const match = prefix.match(/^([ \t]*)(?:-\s*)?$/);
  if (!match) reject("indentation_unavailable", "YAML sequence indentation is ambiguous.", operationId);
  return match[1];
}

function collectionEnd(source, collection, operationId) {
  if (!Array.isArray(collection?.range) || !Number.isSafeInteger(collection.range[2])) {
    reject("source_range_unavailable", "YAML collection insertion range is unavailable.", operationId);
  }
  let offset = collection.range[2];
  const lineEnd = source.indexOf("\n", offset);
  if (lineEnd >= 0 && /^\s*#/.test(source.slice(offset, lineEnd))) offset = lineEnd + 1;
  return offset;
}

function insertionEdit(source, collection, snippet, indent, operationIndexes, operationIds, operationId) {
  const offset = collectionEnd(source, collection, operationId);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const before = source.slice(0, offset);
  const after = source.slice(offset);
  const needsPrefix = before.length > 0 && !/[\r\n]$/.test(before);
  const needsSuffix = after.length === 0 || !/^[\r\n]/.test(after);
  const indented = snippet.split(/\r\n|\n|\r/).map((line) => indent + line).join(newline);
  return {
    start: offset,
    end: offset,
    text: (needsPrefix ? newline : "") + indented + (needsSuffix ? newline : ""),
    operationIndexes: [...operationIndexes],
    operationIds: [...operationIds],
  };
}

function allowedOutcomes(stage, isScript) {
  if (stage === "precondition" || stage === "postcondition") return new Set(["PASS", "FAIL", "UNKNOWN"]);
  if (stage === "observation") return new Set(["SUCCEEDED", "FAILED", "DENIED", "UNKNOWN"]);
  return isScript
    ? new Set(["SUCCEEDED", "FAILED"])
    : new Set(["SUCCEEDED", "FAILED", "DENIED", "UNKNOWN", "NOT_COMMITTED", "OUTCOME_UNKNOWN", "COMMITTED"]);
}

function validateRouteTarget(target, knownNodeIds, operationId) {
  if (typeof target !== "string" || (!TERMINALS.has(target) && !knownNodeIds.has(target))) {
    reject("route_target_invalid", "Route target must be a declared Node or terminal status.", operationId);
  }
}

function validateStageDefinition(stage, definition, operationId) {
  if (!plain(definition)) reject("stage_definition_invalid", "New stage definition must be a mapping.", operationId);
  const keys = Object.keys(definition);
  if (stage === "precondition" || stage === "postcondition") {
    if (keys.some((key) => !["predicates", "routes"].includes(key)) ||
      !Array.isArray(definition.predicates) || definition.predicates.length === 0 ||
      !plain(definition.routes)) {
      reject("stage_definition_invalid", "Predicate stage requires predicates and routes mappings.", operationId);
    }
    for (const call of definition.predicates) {
      if (!plain(call) || Object.keys(call).length !== 2 ||
        typeof call.predicate !== "string" || !Array.isArray(call.arguments) ||
        call.arguments.some((value) => typeof value !== "string")) {
        reject("stage_definition_invalid", "Predicate calls require a predicate ID and positional string arguments.", operationId);
      }
    }
  } else {
    const allowed = stage === "observation"
      ? ["tool", "arguments", "routes"]
      : ["tool", "script", "arguments", "retryOf", "routes"];
    if (keys.some((key) => !allowed.includes(key)) ||
      ((definition.tool === undefined) === (definition.script === undefined)) ||
      (stage === "observation" && definition.script !== undefined) ||
      !plain(definition.arguments)) {
      reject("stage_definition_invalid", "Tool / Script stage definition is invalid.", operationId);
    }
    if (definition.tool !== undefined) nonEmptyString(definition.tool, "tool", operationId);
    if (definition.script !== undefined) nonEmptyString(definition.script, "script", operationId);
    if (definition.retryOf !== undefined) nonEmptyString(definition.retryOf, "retryOf", operationId);
    for (const value of Object.values(definition.arguments)) nonEmptyString(value, "argument expression", operationId, 4096);
  }
  if (definition.routes !== undefined) {
    if (!plain(definition.routes)) reject("stage_definition_invalid", "Stage routes must be a mapping.", operationId);
    const script = definition.script !== undefined;
    const allowed = allowedOutcomes(stage, script);
    for (const [outcome, target] of Object.entries(definition.routes)) {
      if (!allowed.has(outcome)) reject("route_outcome_invalid", "Outcome is invalid for " + stage + ".", operationId);
      nonEmptyString(target, "route target", operationId, 128);
    }
  }
}

function validateNodeDefinition(stages, operationId) {
  if (!plain(stages) || Object.keys(stages).length === 0 ||
    Object.keys(stages).some((stage) => !STAGES.includes(stage))) {
    reject("node_definition_invalid", "New Node must contain at least one known v1alpha4 stage.", operationId);
  }
  for (const [stage, definition] of Object.entries(stages)) {
    validateStageDefinition(stage, definition, operationId);
  }
}

function addMapEntry(groupMap, mapNode, key, value, operationIndex, operationId) {
  let group = groupMap.get(mapNode);
  if (!group) {
    group = { collection: mapNode, entries: [], operationIndexes: [], operationIds: [] };
    groupMap.set(mapNode, group);
  }
  const existing = group.entries.find((entry) => entry.key === key);
  if (existing) {
    if (plain(existing.value) && plain(value)) Object.assign(existing.value, value);
    else reject("duplicate_append_key", "Two operations attempt to add the same YAML mapping key.", operationId);
  } else {
    group.entries.push({ key, value });
  }
  group.operationIndexes.push(operationIndex);
  group.operationIds.push(operationId);
}

function addSequenceItem(groupMap, sequenceNode, value, operationIndex, operationId) {
  let group = groupMap.get(sequenceNode);
  if (!group) {
    group = { collection: sequenceNode, items: [], operationIndexes: [], operationIds: [] };
    groupMap.set(sequenceNode, group);
  }
  group.items.push(value);
  group.operationIndexes.push(operationIndex);
  group.operationIds.push(operationId);
}

function assertPayload(operation, keys) {
  exactKeys(operation.payload, keys, operation.id);
}

function assertTarget(operation, keys) {
  exactKeys(operation.target, keys, operation.id);
}

function operationEditContext(parsed, operation, operationIndex, knownNodeIds, appendMaps, appendSequences, edits) {
  const { type, target, payload, id } = operation;
  if (!plain(target) || !plain(payload)) reject("operation_payload_invalid", "Operation target and payload must be mappings.", id);

  if (type === "procedure.start.set") {
    assertTarget(operation, ["nodeId"]);
    assertPayload(operation, []);
    const nodeId = nonEmptyString(target.nodeId, "start Node ID", id, 128);
    if (!knownNodeIds.has(nodeId)) reject("start_node_invalid", "New start must identify an existing or newly added Node.", id);
    edits.push({ ...scalarEditFromPair(parsed, parsed.startPair.value, nodeId, id), operationIndexes: [operationIndex], operationIds: [id] });
    return;
  }

  if (type === "node.add") {
    assertTarget(operation, ["nodeId"]);
    assertPayload(operation, ["stages"]);
    const nodeId = nonEmptyString(target.nodeId, "Node ID", id, 128);
    if (!NODE_ID.test(nodeId) || TERMINALS.has(nodeId) || nodeId === "context" || parsed.nodes.has(nodeId)) {
      reject("node_id_conflict", "New Node ID is invalid, reserved or already exists.", id);
    }
    validateNodeDefinition(payload.stages, id);
    addMapEntry(appendMaps, parsed.nodesMap, nodeId, payload.stages, operationIndex, id);
    knownNodeIds.add(nodeId);
    return;
  }

  if (type === "node.stage.add") {
    assertTarget(operation, ["nodeId", "stage"]);
    assertPayload(operation, ["definition"]);
    const nodeId = nonEmptyString(target.nodeId, "Node ID", id, 128);
    const stage = nonEmptyString(target.stage, "stage", id, 32);
    if (!STAGES.includes(stage)) reject("stage_invalid", "Unsupported v1alpha4 stage.", id);
    const node = getNode(parsed, nodeId, id);
    if (findPair(node, stage)) reject("stage_already_exists", "Target Node already contains this stage.", id);
    validateStageDefinition(stage, payload.definition, id);
    addMapEntry(appendMaps, node, stage, payload.definition, operationIndex, id);
    return;
  }

  const nodeId = nonEmptyString(target.nodeId, "Node ID", id, 128);
  const stage = nonEmptyString(target.stage, "stage", id, 32);
  const stageResult = getStage(parsed, nodeId, stage, id);
  const stageMap = stageResult.map;

  if (type === "stage.route.set") {
    assertTarget(operation, ["nodeId", "stage", "outcome"]);
    assertPayload(operation, ["targetNodeId"]);
    const outcome = nonEmptyString(target.outcome, "route outcome", id, 64);
    const targetNodeId = nonEmptyString(payload.targetNodeId, "route target", id, 128);
    const script = findPair(stageMap, "script");
    const allowed = allowedOutcomes(stage, Boolean(script));
    if (!allowed.has(outcome)) reject("route_outcome_invalid", "Outcome is invalid for " + stage + ".", id);
    validateRouteTarget(targetNodeId, knownNodeIds, id);
    if (outcome === "OUTCOME_UNKNOWN" && !["UNRESOLVED", "SAFE_STOPPED"].includes(targetNodeId)) {
      reject("unsafe_unknown_route", "OUTCOME_UNKNOWN may only route to UNRESOLVED or SAFE_STOPPED.", id);
    }
    const routesPair = findPair(stageMap, "routes");
    if (!routesPair) {
      addMapEntry(appendMaps, stageMap, "routes", { [outcome]: targetNodeId }, operationIndex, id);
    } else if (!isMap(routesPair.value)) {
      reject("routes_invalid", "Stage routes must be a YAML mapping.", id);
    } else {
      const routePair = findPair(routesPair.value, outcome);
      if (routePair) {
        edits.push({ ...scalarEditFromPair(parsed, routePair.value, targetNodeId, id), operationIndexes: [operationIndex], operationIds: [id] });
      } else {
        addMapEntry(appendMaps, routesPair.value, outcome, targetNodeId, operationIndex, id);
      }
    }
    return;
  }

  if (type === "stage.callable.set") {
    assertTarget(operation, ["nodeId", "stage"]);
    assertPayload(operation, ["kind", "id"]);
    const kind = payload.kind;
    const value = nonEmptyString(payload.id, "callable ID", id, 512);
    if (!["tool", "script"].includes(kind) ||
      (stage !== "operation" && stage !== "observation") ||
      (stage === "observation" && kind !== "tool")) {
      reject("callable_kind_invalid", "Callable kind is invalid for this stage.", id);
    }
    const existingTool = findPair(stageMap, "tool");
    const existingScript = findPair(stageMap, "script");
    const existing = kind === "tool" ? existingTool : existingScript;
    if (!existing || (kind === "tool" && existingScript) || (kind === "script" && existingTool)) {
      reject("callable_kind_change_unsupported", "Changing a stage between Tool and Script requires a separate structural operation.", id);
    }
    edits.push({ ...scalarEditFromPair(parsed, existing.value, value, id), operationIndexes: [operationIndex], operationIds: [id] });
    return;
  }

  if (type === "stage.argument.set") {
    assertTarget(operation, ["nodeId", "stage", "argumentName"]);
    assertPayload(operation, ["expression"]);
    if (stage !== "operation" && stage !== "observation") {
      reject("arguments_stage_invalid", "Named arguments can only be changed on Operation or Observation stages.", id);
    }
    const argumentName = nonEmptyString(target.argumentName, "argument name", id, 128);
    if (!ARGUMENT_ID.test(argumentName)) reject("argument_name_invalid", "Argument name is invalid.", id);
    const expression = nonEmptyString(payload.expression, "argument expression", id, 4096);
    const argsPair = findPair(stageMap, "arguments");
    if (!argsPair || !isMap(argsPair.value)) reject("arguments_mapping_missing", "Target stage has no arguments mapping.", id);
    const argumentPair = findPair(argsPair.value, argumentName);
    if (argumentPair) {
      edits.push({ ...scalarEditFromPair(parsed, argumentPair.value, expression, id), operationIndexes: [operationIndex], operationIds: [id] });
    } else {
      addMapEntry(appendMaps, argsPair.value, argumentName, expression, operationIndex, id);
    }
    return;
  }

  if (type === "predicate.call.add") {
    assertTarget(operation, ["nodeId", "stage"]);
    assertPayload(operation, ["predicateId", "arguments"]);
    if (stage !== "precondition" && stage !== "postcondition") {
      reject("predicate_stage_invalid", "Predicate calls can only be added to Precondition or Postcondition stages.", id);
    }
    const predicateId = nonEmptyString(payload.predicateId, "Predicate ID", id, 256);
    if (!Array.isArray(payload.arguments) || payload.arguments.some((value) => typeof value !== "string" || value.length > 4096)) {
      reject("predicate_arguments_invalid", "Predicate arguments must be an ordered list of expression strings.", id);
    }
    const predicatesPair = findPair(stageMap, "predicates");
    if (!predicatesPair || !isSeq(predicatesPair.value)) {
      reject("predicate_sequence_missing", "Target stage has no predicates sequence.", id);
    }
    addSequenceItem(appendSequences, predicatesPair.value, {
      predicate: predicateId,
      arguments: payload.arguments,
    }, operationIndex, id);
    return;
  }

  if (type === "predicate.call.arguments.set") {
    assertTarget(operation, ["nodeId", "stage", "predicateId", "callIndex"]);
    assertPayload(operation, ["arguments"]);
    if (stage !== "precondition" && stage !== "postcondition") {
      reject("predicate_stage_invalid", "Predicate arguments can only be changed in Precondition or Postcondition stages.", id);
    }
    if (!Number.isSafeInteger(target.callIndex) || target.callIndex < 0 ||
      !Array.isArray(payload.arguments) || payload.arguments.some((value) => typeof value !== "string" || value.length > 4096)) {
      reject("predicate_arguments_invalid", "Predicate call index or arguments are invalid.", id);
    }
    const predicateId = nonEmptyString(target.predicateId, "Predicate ID", id, 256);
    const predicatesPair = findPair(stageMap, "predicates");
    if (!predicatesPair || !isSeq(predicatesPair.value) || !predicatesPair.value.items[target.callIndex]) {
      reject("predicate_call_not_found", "Target Predicate call does not exist.", id);
    }
    const call = predicatesPair.value.items[target.callIndex];
    if (!isMap(call) || scalar(findPair(call, "predicate")?.value) !== predicateId) {
      reject("predicate_call_mismatch", "Target Predicate call does not match the requested Predicate ID.", id);
    }
    const argsPair = findPair(call, "arguments");
    if (!argsPair || !isSeq(argsPair.value) || argsPair.value.items.length !== payload.arguments.length) {
      reject("predicate_arity_change_unsupported", "Predicate argument edits must preserve the declared positional arity.", id);
    }
    argsPair.value.items.forEach((item, index) => {
      edits.push({ ...scalarEditFromPair(parsed, item, payload.arguments[index], id), operationIndexes: [operationIndex], operationIds: [id] });
    });
    return;
  }

  reject("operation_unsupported", "Semantic operation is not supported by the current v1alpha4 Patch Engine.", id);
}

function scalarEditFromPair(parsed, node, value, operationId) {
  const range = rangeOf(node, operationId);
  const raw = parsed.source.slice(range.start, range.end);
  return { start: range.start, end: range.end, text: encodedScalar(value, raw) };
}

function materializeAppendEdits(source, appendMaps, appendSequences) {
  const edits = [];
  for (const group of appendMaps.values()) {
    const entries = group.entries.map((entry) => [entry.key, entry.value]);
    const snippet = stringify(Object.fromEntries(entries), { indent: 2, lineWidth: 0 }).trimEnd();
    edits.push(insertionEdit(
      source, group.collection, snippet, mapIndent(source, group.collection, group.operationIds[0]),
      group.operationIndexes, group.operationIds, group.operationIds[0],
    ));
  }
  for (const group of appendSequences.values()) {
    const snippet = stringify(group.items, { indent: 2, lineWidth: 0 }).trimEnd();
    edits.push(insertionEdit(
      source, group.collection, snippet, sequenceIndent(source, group.collection, group.operationIds[0]),
      group.operationIndexes, group.operationIds, group.operationIds[0],
    ));
  }
  return edits;
}

function mergeCoincidentInsertions(edits) {
  const result = [];
  const byOffset = new Map();
  for (const edit of edits) {
    if (edit.start !== edit.end) {
      result.push(edit);
      continue;
    }
    const existing = byOffset.get(edit.start);
    if (!existing) {
      const copy = { ...edit, operationIndexes: [...edit.operationIndexes], operationIds: [...edit.operationIds] };
      byOffset.set(edit.start, copy);
      result.push(copy);
    } else {
      existing.text += edit.text;
      existing.operationIndexes.push(...edit.operationIndexes);
      existing.operationIds.push(...edit.operationIds);
    }
  }
  return result;
}

function applyEdits(source, edits) {
  const ascending = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ascending.length; index += 1) {
    const current = ascending[index];
    const previous = ascending[index - 1];
    if (current.start < previous.end || current.start === previous.start) {
      reject("patch_overlap", "Two semantic operations produce overlapping Source edits.");
    }
  }
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function digestHex(text) {
  return globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    .then((value) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join(""));
}

function validateCandidate(source) {
  const parsed = parseSource(source);
  const start = scalar(parsed.startPair.value);
  if (!parsed.nodes.has(start)) reject("candidate_start_invalid", "Candidate Procedure start does not name a declared Node.");
  for (const [nodeId, node] of parsed.nodes) {
    for (const stage of STAGES) {
      const stagePair = findPair(node, stage);
      if (!stagePair) continue;
      if (!isMap(stagePair.value)) reject("candidate_stage_invalid", "Candidate stage must be a mapping.");
      const routesPair = findPair(stagePair.value, "routes");
      if (!routesPair) continue;
      if (!isMap(routesPair.value)) reject("candidate_routes_invalid", "Candidate routes must be a mapping.");
      for (const route of routesPair.value.items) {
        const target = scalar(route.value);
        if (!target || (!TERMINALS.has(target) && !parsed.nodes.has(target))) {
          reject("candidate_route_target_invalid", "Candidate contains a route to an undeclared Node or terminal.");
        }
      }
    }
    void nodeId;
  }
  return parsed;
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (value) => {
    if (parent[value] !== value) parent[value] = find(parent[value]);
    return parent[value];
  };
  const union = (a, b) => {
    const left = find(a), right = find(b);
    if (left !== right) parent[right] = left;
  };
  return { find, union };
}

function buildGroups(operations, editRecords) {
  const uf = unionFind(operations.length);
  const nodeAdds = new Map();
  const stageAdds = new Map();

  operations.forEach((operation, index) => {
    if (operation.type === "node.add") nodeAdds.set(operation.target.nodeId, index);
    if (operation.type === "node.stage.add") stageAdds.set(operation.target.nodeId + "." + operation.target.stage, index);
  });

  operations.forEach((operation, index) => {
    if (operation.type === "procedure.start.set" && nodeAdds.has(operation.target.nodeId)) {
      uf.union(index, nodeAdds.get(operation.target.nodeId));
    }
    if (operation.type === "stage.route.set" && nodeAdds.has(operation.payload.targetNodeId)) {
      uf.union(index, nodeAdds.get(operation.payload.targetNodeId));
    }
    const stageKey = operation.target?.nodeId + "." + operation.target?.stage;
    if (stageAdds.has(stageKey) && index !== stageAdds.get(stageKey)) {
      uf.union(index, stageAdds.get(stageKey));
    }
  });

  for (const edit of editRecords) {
    const indexes = edit.operationIndexes;
    for (let index = 1; index < indexes.length; index += 1) uf.union(indexes[0], indexes[index]);
  }

  const buckets = new Map();
  operations.forEach((operation, index) => {
    const root = uf.find(index);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(index);
  });

  const groups = [];
  for (const indexes of buckets.values()) {
    const id = "group-" + (groups.length + 1);
    const members = indexes.map((index) => operations[index]);
    const nodeAdd = members.find((operation) => operation.type === "node.add");
    const stageAdd = members.find((operation) => operation.type === "node.stage.add");
    const label = nodeAdd
      ? "Add Node " + nodeAdd.target.nodeId + " and dependent routes"
      : stageAdd
        ? "Add " + stageAdd.target.stage + " stage to " + stageAdd.target.nodeId
        : members.length === 1
          ? "Update " + members[0].target.nodeId + (members[0].target.stage ? "." + members[0].target.stage : "")
          : "Related Procedure changes";
    const operationIds = members.map((operation) => operation.id);
    groups.push({ id, label, operationIds, operationIndexes: indexes });
  }

  const groupedEdits = groups.map((group) => ({
    ...group,
    edits: editRecords.filter((edit) => edit.operationIndexes.some((index) => group.operationIndexes.includes(index)))
      .map(({ start, end, text, operationIds }) => ({ start, end, text, operationIds })),
  }));
  return { groups: groupedEdits };
}

export async function planV1Alpha4Patch({
  source,
  changeSet,
  currentDocumentUri,
  currentDocumentVersion,
  currentPackageGeneration,
} = {}) {
  if (!plain(changeSet) || changeSet.schema !== "ca-studio.ai-change-set/v1" ||
    !plain(changeSet.base) || !plain(changeSet.scope) || !Array.isArray(changeSet.operations) ||
    !Array.isArray(changeSet.groups) || changeSet.validation?.state !== "NOT_RUN") {
    reject("change_set_invalid", "A Host-owned unvalidated Change Set is required.");
  }
  if (changeSet.base.languageTarget !== "connectionagent.io/v1alpha4" ||
    changeSet.scope.writePaths?.length !== 1 ||
    changeSet.scope.writePaths[0] !== "assurance/procedure.yaml") {
    reject("change_set_scope_invalid", "Patch Engine only accepts v1alpha4 Procedure-only write scope.");
  }
  if (changeSet.base.documentUri !== currentDocumentUri ||
    changeSet.base.documentVersion !== currentDocumentVersion ||
    changeSet.base.packageGeneration !== currentPackageGeneration) {
    reject("stale_change_set", "Live document or Package revision changed after proposal generation.");
  }
  if (typeof source !== "string") reject("source_invalid", "Live Procedure source is required.");

  const baseDigest = "sha256:" + await digestHex(source);
  if (changeSet.base.sourceDigest !== baseDigest) {
    reject("stale_source_digest", "Live Procedure bytes do not match the Change Set base digest.");
  }

  const parsed = parseSource(source);
  const knownNodeIds = new Set(parsed.nodes.keys());
  const operationIds = new Set();
  const operations = changeSet.operations;
  const edits = [];
  const appendMaps = new Map();
  const appendSequences = new Map();

  if (operations.length > 128) reject("operation_limit_exceeded", "A Change Set may contain at most 128 operations.");
  for (const operation of operations) {
    if (operation?.type === "node.add" && plain(operation.target) &&
      typeof operation.target.nodeId === "string") {
      if (!NODE_ID.test(operation.target.nodeId) || TERMINALS.has(operation.target.nodeId) ||
        operation.target.nodeId === "context" || knownNodeIds.has(operation.target.nodeId)) {
        reject("node_id_conflict", "Proposed Node ID is invalid, reserved or already exists.", operation.id);
      }
      knownNodeIds.add(operation.target.nodeId);
    }
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!plain(operation) || typeof operation.id !== "string" ||
      operationIds.has(operation.id) || !operation.id) {
      reject("operation_id_invalid", "Change Set operation IDs must be unique and non-empty.");
    }
    operationIds.add(operation.id);
    operationEditContext(parsed, operation, index, knownNodeIds, appendMaps, appendSequences, edits);
  }

  const insertionEdits = materializeAppendEdits(source, appendMaps, appendSequences);
  const editRecords = mergeCoincidentInsertions([...edits, ...insertionEdits]);
  const { groups } = buildGroups(operations, editRecords);
  const allEdits = groups.flatMap((group) => group.edits.map((edit) => ({
    ...edit,
    operationIndexes: group.operationIndexes,
  })));
  const candidateSource = applyEdits(source, allEdits);
  validateCandidate(candidateSource);
  const candidateDigest = "sha256:" + await digestHex(candidateSource);

  return Object.freeze({
    schema: V1ALPHA4_PATCH_ENGINE,
    state: "READY",
    baseDigest,
    candidateDigest,
    candidateSource,
    groups: Object.freeze(groups.map((group) => Object.freeze({
      id: group.id,
      label: group.label,
      operationIds: Object.freeze(group.operationIds),
      edits: Object.freeze(group.edits.map((edit) => Object.freeze(edit))),
    }))),
    editCount: allEdits.length,
  });
}

export async function materializeAcceptedPatchGroups({
  source,
  plan,
  acceptedGroupIds,
} = {}) {
  if (!plan || plan.schema !== V1ALPHA4_PATCH_ENGINE || plan.state !== "READY" ||
    !Array.isArray(acceptedGroupIds)) {
    reject("patch_plan_invalid", "A READY v1alpha4 Patch Plan and accepted group IDs are required.");
  }
  const currentDigest = "sha256:" + await digestHex(source);
  if (currentDigest !== plan.baseDigest) reject("stale_patch_plan", "Procedure source changed after Patch Planning.");

  const known = new Map(plan.groups.map((group) => [group.id, group]));
  const selected = new Set(acceptedGroupIds);
  if (selected.size !== acceptedGroupIds.length || [...selected].some((id) => !known.has(id))) {
    reject("accepted_groups_invalid", "Accepted group IDs must be unique and belong to this Patch Plan.");
  }
  const edits = [...selected].flatMap((id) => known.get(id).edits);
  const candidateSource = applyEdits(source, edits);
  validateCandidate(candidateSource);
  return Object.freeze({
    source: candidateSource,
    digest: "sha256:" + await digestHex(candidateSource),
    acceptedGroupIds: Object.freeze([...selected]),
  });
}
