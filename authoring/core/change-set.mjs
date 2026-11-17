import {
  MODEL_PROPOSAL_SCHEMA,
  validateModelProposal,
} from "./model-proposal.mjs";

export const CHANGE_SET_SCHEMA = "ca-studio.ai-change-set/v1";

export class ChangeSetConstructionError extends Error {
  constructor(code, message) {
    super(message || ("Change Set construction failed: " + code));
    this.name = "ChangeSetConstructionError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new ChangeSetConstructionError(code, message);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0 || manifest.length > 129) {
    reject("invalid_manifest", "A non-empty bounded Context Pack manifest is required.");
  }
  const ids = new Set();
  for (const item of manifest) {
    if (!plain(item) ||
      Object.keys(item).sort().join(",") !== "bytes,digest,id,kind,label" ||
      typeof item.id !== "string" || ids.has(item.id) ||
      typeof item.kind !== "string" || typeof item.label !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.digest) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 1) {
      reject("invalid_manifest", "Context Pack manifest entries are invalid or duplicated.");
    }
    ids.add(item.id);
  }
  const procedure = manifest[0];
  if (procedure.id !== "procedure-current" ||
    procedure.kind !== "procedure" ||
    procedure.label !== "assurance/procedure.yaml") {
    reject("procedure_manifest_missing", "The live Procedure must be the first Context Pack manifest item.");
  }
  return procedure;
}

function validateHostBase(hostBase, procedureDigest) {
  if (!plain(hostBase)) reject("invalid_host_base", "Host base metadata is required.");
  const allowed = new Set(["documentUri", "documentVersion", "packageGeneration", "sourceDigest"]);
  if (Object.keys(hostBase).some((key) => !allowed.has(key))) {
    reject("invalid_host_base", "Host base metadata contains unsupported fields.");
  }
  if (typeof hostBase.documentUri !== "string" ||
    hostBase.documentUri.trim().length === 0 ||
    hostBase.documentUri.length > 2048 ||
    /[\u0000-\u001f]/.test(hostBase.documentUri) ||
    !Number.isSafeInteger(hostBase.documentVersion) || hostBase.documentVersion < 1 ||
    !Number.isSafeInteger(hostBase.packageGeneration) || hostBase.packageGeneration < 1) {
    reject("invalid_host_base", "Host document URI, version and Package generation are required.");
  }
  const expectedDigest = "sha256:" + procedureDigest;
  if (hostBase.sourceDigest !== undefined && hostBase.sourceDigest !== expectedDigest) {
    reject("stale_source_digest", "Host source digest does not match the disclosed live Procedure.");
  }
  return {
    documentUri: hostBase.documentUri,
    documentVersion: hostBase.documentVersion,
    sourceDigest: expectedDigest,
    packageGeneration: hostBase.packageGeneration,
  };
}

export function createChangeSet({
  proposalResult,
  hostBase,
  operationIdFactory = () => "op-" + globalThis.crypto.randomUUID(),
} = {}) {
  if (!plain(proposalResult) ||
    typeof proposalResult.taskId !== "string" ||
    !Number.isSafeInteger(proposalResult.revision) || proposalResult.revision < 1 ||
    proposalResult.languageTarget !== "connectionagent.io/v1alpha5" ||
    !Array.isArray(proposalResult.manifest)) {
    reject("invalid_proposal_result", "A validated Procedure proposal result is required.");
  }
  if (typeof operationIdFactory !== "function") {
    reject("invalid_id_factory", "A host operation ID factory is required.");
  }

  const procedureManifest = validateManifest(proposalResult.manifest);
  const allowedContextIds = proposalResult.manifest.map((item) => item.id);
  const proposal = validateModelProposal(proposalResult.proposal, { allowedContextIds });
  if (proposal.schema !== MODEL_PROPOSAL_SCHEMA) {
    reject("invalid_proposal", "Unsupported ModelProposal schema.");
  }

  const base = validateHostBase(hostBase, procedureManifest.digest);
  const operationIds = new Set();
  const operations = proposal.operations.map((operation, index) => {
    const id = operationIdFactory(index, operation);
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id) || operationIds.has(id)) {
      reject("invalid_operation_id", "Host-generated operation IDs must be valid and unique.");
    }
    operationIds.add(id);
    return {
      id,
      type: operation.type,
      target: operation.target,
      payload: operation.payload,
      rationale: operation.rationale,
      references: operation.references,
    };
  });

  const readPaths = [...new Set(proposalResult.manifest
    .filter((item) => item.kind !== "procedure" && !item.label.startsWith("dependency:"))
    .map((item) => item.label))];

  const changeSet = {
    schema: CHANGE_SET_SCHEMA,
    taskId: proposalResult.taskId,
    revision: proposalResult.revision,
    base: {
      ...base,
      languageTarget: proposalResult.languageTarget,
    },
    scope: {
      writePaths: ["assurance/procedure.yaml"],
      readPaths,
    },
    operations,
    groups: [],
    summary: proposal.summary,
    plan: proposal.plan,
    assumptions: proposal.assumptions,
    blockers: proposal.blockers,
    validation: {
      state: "NOT_RUN",
      diagnostics: [],
    },
  };

  return freezeDeep(changeSet);
}
