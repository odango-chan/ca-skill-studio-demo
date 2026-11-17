export const MODEL_PROPOSAL_SCHEMA = "ca-studio.ai-model-proposal/v1";

export const ALLOWED_SEMANTIC_OPERATIONS = Object.freeze([
  "node.add",
  "node.stage.add",
  "node.wait.set",
  "node.wait.event.set",
  "node.wait.timeout.set",
  "node.wait.timeout-route.set",
  "node.wait.response.set",
  "stage.callable.set",
  "stage.argument.set",
  "predicate.call.add",
  "predicate.call.arguments.set",
  "stage.route.set",
  "procedure.start.set",
]);

const TOP_LEVEL_KEYS = new Set(["schema", "summary", "plan", "operations", "assumptions", "blockers"]);
const OPERATION_KEYS = new Set(["type", "target", "payload", "rationale", "references"]);
const TARGET_KEYS = new Set(["nodeId", "stage", "predicateId", "outcome", "argumentName", "callIndex"]);
const FORBIDDEN_PAYLOAD_KEYS = new Set(["__proto__", "constructor", "prototype",
  "source", "sourceText", "candidateSource", "rawYaml", "yaml", "sourceSpan", "span",
  "offset", "startOffset", "endOffset", "line", "column", "file", "filePath", "path",
  "uri", "documentUri", "writePaths", "readPaths", "sourceDigest", "base", "scope",
  "groups", "validation", "operationId", "workspaceEdit", "patch", "command", "shell",
  "tool_calls", "tools", "scriptSource", "packageGeneration", "documentVersion", "ingressCatalog", "ingressCatalogRef",
  "correlationBinding", "armInputSchema", "expectedIngressRef", "deliveryRef", "responseObligationRef",
  "trustedOwner", "ownerBinding", "normalizedSchemaRef",
]);

export class ModelProposalValidationError extends Error {
  constructor(code, path) {
    super("Invalid ModelProposal (" + code + ") at " + path + ".");
    this.name = "ModelProposalValidationError";
    this.code = code;
    this.path = path;
  }
}

function fail(code, path) { throw new ModelProposalValidationError(code, path); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value, allowed, path) {
  if (!plain(value)) fail("expected_object", path);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("unknown_field", path + "." + key);
}
function string(value, path, max) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) fail("invalid_string", path);
}
function stringArray(value, path, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) fail("invalid_array", path);
  value.forEach((item, index) => string(item, path + "[" + index + "]", maxLength));
}
function jsonValue(value, path, depth = 0, allowWaitEventSource = false) {
  if (depth > 8) fail("payload_too_deep", path);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 8192) fail("payload_string_too_long", path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_number", path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail("payload_array_too_large", path);
    value.forEach((item, index) => jsonValue(item, path + "[" + index + "]", depth + 1));
    return;
  }
  if (!plain(value)) fail("invalid_payload_value", path);
  for (const [key, child] of Object.entries(value)) {
    const isWaitEventSource = allowWaitEventSource && key === "source" && path.endsWith(".event");
    if (FORBIDDEN_PAYLOAD_KEYS.has(key) && !isWaitEventSource) fail("forbidden_authority_field", path + "." + key);
    jsonValue(child, path + "." + key, depth + 1, allowWaitEventSource);
  }
}
function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

export function validateModelProposal(input, {
  allowedContextIds = [],
  maxSerializedBytes = 65536,
} = {}) {
  exactKeys(input, TOP_LEVEL_KEYS, "$");
  if (input.schema !== MODEL_PROPOSAL_SCHEMA) fail("unsupported_schema", "$.schema");
  string(input.summary, "$.summary", 2000);
  if (input.plan !== undefined) stringArray(input.plan, "$.plan", 20, 1000);
  if (input.assumptions !== undefined) stringArray(input.assumptions, "$.assumptions", 20, 1000);
  if (input.blockers !== undefined) stringArray(input.blockers, "$.blockers", 20, 1000);
  if (!Array.isArray(input.operations) || input.operations.length > 40) fail("invalid_operations", "$.operations");

  const allowedRefs = new Set(allowedContextIds);
  input.operations.forEach((operation, index) => {
    const path = "$.operations[" + index + "]";
    exactKeys(operation, OPERATION_KEYS, path);
    if (!ALLOWED_SEMANTIC_OPERATIONS.includes(operation.type)) fail("unsupported_operation", path + ".type");
    exactKeys(operation.target, TARGET_KEYS, path + ".target");
    if (Object.keys(operation.target).length === 0) fail("missing_target", path + ".target");
    for (const [key, value] of Object.entries(operation.target)) {
      if (key === "callIndex") {
        if (!Number.isSafeInteger(value) || value < 0) fail("invalid_target", path + ".target." + key);
      } else {
        string(value, path + ".target." + key, 256);
      }
    }
    if (!plain(operation.payload)) fail("invalid_payload", path + ".payload");
    jsonValue(operation.payload, path + ".payload", 0,
      ["node.add", "node.wait.set", "node.wait.event.set"].includes(operation.type));
    string(operation.rationale, path + ".rationale", 1000);
    if (!Array.isArray(operation.references) || operation.references.length > 40) {
      fail("invalid_references", path + ".references");
    }
    operation.references.forEach((reference, referenceIndex) => {
      const referencePath = path + ".references[" + referenceIndex + "]";
      string(reference, referencePath, 256);
      if (!allowedRefs.has(reference)) fail("unknown_context_reference", referencePath);
    });
  });

  const serialized = JSON.stringify(input);
  if (new TextEncoder().encode(serialized).byteLength > maxSerializedBytes) fail("proposal_too_large", "$");
  const clone = JSON.parse(serialized);
  if (clone.plan === undefined) clone.plan = [];
  if (clone.assumptions === undefined) clone.assumptions = [];
  if (clone.blockers === undefined) clone.blockers = [];
  return freezeDeep(clone);
}

export function parseModelProposal(content, options = {}) {
  if (typeof content !== "string") fail("invalid_model_content", "$");
  let value;
  try { value = JSON.parse(content); }
  catch { fail("invalid_json", "$"); }
  return validateModelProposal(value, options);
}
