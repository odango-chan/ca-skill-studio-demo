export const CONTEXT_PACK_SCHEMA = "ca-studio.ai-context-pack/v1";
const PROCEDURE_PATH = "assurance/procedure.yaml";
const BLOCKED_ROOTS = new Set([
  ".git", "node_modules", "lib", "output", "dist", "build", "artifacts", "logs",
]);
const ALLOWED_KINDS = new Set(["contract", "predicate", "schema", "dependency", "reference", "script"]);

export class ContextPackError extends Error {
  constructor(code, message, details = {}) {
    super(message || ("Context Pack rejected: " + code));
    this.name = "ContextPackError";
    this.code = code;
    this.details = details;
  }
}

function reject(code, message, details) {
  throw new ContextPackError(code, message, details);
}

function assertString(value, field, maxLength = 512) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    reject("invalid_" + field, "Invalid Context Pack " + field + ".");
  }
}

function assertSafeRelativePath(path) {
  assertString(path, "path", 512);
  if (path.startsWith("/") || path.includes("\\") || path.includes(":") ||
    path.includes("?") || path.includes("#") || path.includes("%")) {
    reject("unsafe_path", "Context source path must be a normalized Package-relative path.", { path });
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    reject("unsafe_path", "Context source path contains an unsafe segment.", { path });
  }
  if (BLOCKED_ROOTS.has(parts[0].toLowerCase())) {
    reject("excluded_path", "Context source is outside the allowed authoring surface.", { path });
  }
  const basename = parts[parts.length - 1];
  if (/^\.env(?:\.|$)/i.test(basename) ||
    /^(?:secret|secrets|credentials?|private[-_]?key|access[-_]?token|token)$/i.test(basename)) {
    reject("sensitive_path", "Sensitive files cannot be added to the Context Pack.", { path });
  }
  return path;
}

function assertKindPath(kind, path) {
  if (kind === "contract" && path !== "assurance/contract.yaml") {
    reject("invalid_contract_path", "Only the Package Contract may be included as contract context.", { path });
  }
  if (kind === "predicate" && path !== "assurance/predicates.yaml") {
    reject("invalid_predicate_path", "Only the Package PredicateSet may be included as predicate context.", { path });
  }
  if (kind === "schema" && !path.startsWith("schemas/")) {
    reject("invalid_schema_path", "Schema context must come from the selected Package schemas directory.", { path });
  }
  if (kind === "reference" && !path.startsWith("references/")) {
    reject("invalid_reference_path", "Reference context must come from the Package references directory.", { path });
  }
  if (kind === "script" && !path.startsWith("scripts/")) {
    reject("invalid_script_path", "Script context must come from the Package scripts directory.", { path });
  }
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

async function sha256(text) {
  if (!globalThis.crypto?.subtle) {
    reject("crypto_unavailable", "Web Crypto is required to identify Context Pack items.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

export async function buildContextPack({
  taskId,
  revision,
  languageTarget,
  procedure,
  resources = [],
  maxBytes,
} = {}) {
  assertString(taskId, "task_id", 128);
  if (!Number.isSafeInteger(revision) || revision < 1) reject("invalid_revision", "Context revision must be positive.");
  if (languageTarget !== "connectionagent.io/v1alpha4") {
    reject("unsupported_language_target", "AI Authoring currently accepts only CA-SL v1alpha4.");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) {
    reject("invalid_byte_limit", "Context Pack byte limit must be between 1 and 1048576.");
  }
  if (!procedure || procedure.path !== PROCEDURE_PATH ||
    !Number.isSafeInteger(procedure.documentVersion) || procedure.documentVersion < 1 ||
    typeof procedure.text !== "string" || procedure.text.length === 0) {
    reject("invalid_live_procedure", "The live assurance/procedure.yaml buffer is required.");
  }
  if (!Array.isArray(resources) || resources.length > 128) {
    reject("invalid_resources", "Context Pack accepts at most 128 candidate resources.");
  }

  const encoder = new TextEncoder();
  const procedureBytes = encoder.encode(procedure.text).byteLength;
  const procedureDigest = await sha256(procedure.text);
  const procedureItem = {
    id: "procedure-current",
    kind: "procedure",
    label: PROCEDURE_PATH,
    digest: procedureDigest,
    bytes: procedureBytes,
    text: procedure.text,
  };

  const seen = new Set(["procedure-current"]);
  const included = [];
  for (const resource of resources) {
    if (!resource || resource.selected !== true) continue;
    if (!ALLOWED_KINDS.has(resource.kind)) {
      reject("unsupported_resource_kind", "Unsupported Context Pack resource kind.");
    }
    if (!validId(resource.id) || seen.has(resource.id)) {
      reject("invalid_or_duplicate_resource_id", "Context Pack resource IDs must be unique and stable.", { id: resource.id });
    }
    seen.add(resource.id);
    if (typeof resource.content !== "string" || resource.content.length === 0) {
      reject("invalid_resource_content", "Selected Context Pack resources must contain text.", { id: resource.id });
    }

    let label;
    if (resource.kind === "dependency") {
      if (resource.path !== undefined) {
        reject("dependency_path_forbidden", "Dependency context is identified by verified metadata, not arbitrary file paths.", { id: resource.id });
      }
      if (resource.verified !== true) {
        reject("unverified_dependency", "Unverified dependency metadata cannot enter the Context Pack.", { id: resource.id });
      }
      assertString(resource.version, "dependency_version", 128);
      label = "dependency:" + resource.id + "@" + resource.version;
    } else {
      const path = assertSafeRelativePath(resource.path);
      assertKindPath(resource.kind, path);
      if ((resource.kind === "reference" || resource.kind === "script") &&
        resource.explicitlyIncluded !== true) {
        reject("explicit_opt_in_required", "Reference and Script sources require explicit per-task opt-in.", { id: resource.id });
      }
      label = path;
    }

    const bytes = encoder.encode(resource.content).byteLength;
    included.push({
      id: resource.id,
      kind: resource.kind,
      label,
      digest: await sha256(resource.content),
      bytes,
      text: resource.content,
    });
  }

  const byteCount = procedureBytes + included.reduce((total, item) => total + item.bytes, 0);
  if (byteCount > maxBytes) {
    const oversizedItems = [procedureItem, ...included]
      .sort((left, right) => right.bytes - left.bytes)
      .map(({ id, label, bytes }) => ({ id, label, bytes }));
    reject("context_too_large", "Context Pack exceeds its byte limit; remove items or narrow the selection. Content was not truncated.", {
      maxBytes,
      byteCount,
      items: oversizedItems,
    });
  }

  const pack = {
    schema: CONTEXT_PACK_SCHEMA,
    taskId,
    revision,
    languageTarget,
    procedure: {
      id: procedureItem.id,
      kind: procedureItem.kind,
      label: procedureItem.label,
      digest: procedureItem.digest,
      text: procedureItem.text,
    },
    resources: included.map(({ id, kind, label, digest, text }) => ({
      id, kind, label, digest, text,
    })),
  };

  const manifest = [procedureItem, ...included].map(({ id, kind, label, digest, bytes }) => ({
    id, kind, label, digest, bytes,
  }));

  return freezeDeep({ pack, manifest, byteCount, maxBytes });
}
