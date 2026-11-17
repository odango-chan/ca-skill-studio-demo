import { CONTEXT_PACK_SCHEMA } from "./context-pack.mjs";
import {
  MODEL_PROPOSAL_SCHEMA,
  ALLOWED_SEMANTIC_OPERATIONS,
  parseModelProposal,
} from "./model-proposal.mjs";

const SYSTEM_PROMPT = [
  "You are the proposal component of CA Skill Studio AI Authoring.",
  "You do not edit files, execute tools, run scripts, call a Runtime, or claim qualification.",
  "You receive one bounded Context Pack for an existing CA-SL v1alpha4 Procedure.",
  "Use only facts and references present in that Context Pack. Do not invent Tool, Predicate, Schema, Capability, Owner, dependency or Evidence contracts.",
  "Preserve the existing Procedure structure and its 3GPP action boundaries. Do not merge distinct request/response actions into one Node merely to shorten the graph.",
  "Use only these semantic operation types: " + ALLOWED_SEMANTIC_OPERATIONS.join(", ") + ".",
  "Return one JSON object matching schema " + MODEL_PROPOSAL_SCHEMA + ".",
  "Top-level fields: schema, summary, plan, operations, assumptions, blockers.",
  "Each operation has exactly: type, target, payload, rationale, references.",
  "Target contains semantic identifiers only. References must use IDs from the supplied Context Pack.",
  "Do not return operation IDs, atomic groups, file paths, source offsets, source spans, raw YAML, candidate Source, WorkspaceEdit, validation state, shell commands or tool calls.",
  "If required information is missing or cannot be resolved from the Context Pack, explain it in blockers instead of guessing.",
  "Output JSON only. Do not wrap it in Markdown fences or add prose outside the JSON object.",
].join("\n");

function validateContextPack(pack, manifest) {
  if (!pack || typeof pack !== "object" || pack.schema !== CONTEXT_PACK_SCHEMA ||
    typeof pack.taskId !== "string" || !Number.isSafeInteger(pack.revision) ||
    pack.revision < 1 || pack.languageTarget !== "connectionagent.io/v1alpha4" ||
    !pack.procedure || !Array.isArray(pack.resources) || !Array.isArray(manifest)) {
    throw new TypeError("Invalid or unsupported Context Pack.");
  }

  const packItems = [pack.procedure, ...pack.resources];
  if (packItems.length !== manifest.length) {
    throw new TypeError("Context Pack manifest does not match the supplied content.");
  }

  const ids = new Set();
  for (let index = 0; index < packItems.length; index += 1) {
    const item = packItems[index];
    const disclosed = manifest[index];
    if (!item || !disclosed || typeof item.id !== "string" || ids.has(item.id) ||
      item.id !== disclosed.id || item.kind !== disclosed.kind ||
      item.label !== disclosed.label || item.digest !== disclosed.digest ||
      typeof item.text !== "string" || !/^[a-f0-9]{64}$/.test(item.digest)) {
      throw new TypeError("Context Pack manifest does not match the supplied content.");
    }
    ids.add(item.id);
  }
  if (pack.procedure.id !== "procedure-current" || pack.procedure.kind !== "procedure") {
    throw new TypeError("Context Pack is missing its live Procedure source.");
  }
  return ids;
}

export function createProcedureAgent({ modelClient } = {}) {
  if (!modelClient || typeof modelClient.complete !== "function") {
    throw new TypeError("A compatible model client must be supplied.");
  }

  return Object.freeze({
    async propose({
      task,
      contextPack,
      contextManifest,
      contextDisclosureAccepted = false,
      signal,
      maxTokens,
    } = {}) {
      if (contextDisclosureAccepted !== true) {
        throw new Error("Context disclosure must be explicitly accepted before proposal generation.");
      }
      if (typeof task !== "string" || task.trim().length === 0 || task.length > 4000) {
        throw new TypeError("A non-empty authoring request of at most 4000 characters is required.");
      }

      const allowedContextIds = validateContextPack(contextPack, contextManifest);
      const userContent = JSON.stringify({
        request: task,
        contextPack,
      });

      const content = await modelClient.complete({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        contextDisclosureAccepted: true,
        responseFormat: { type: "json_object" },
        maxTokens,
        signal,
      });

      const proposal = parseModelProposal(content, { allowedContextIds });
      return Object.freeze({
        taskId: contextPack.taskId,
        revision: contextPack.revision,
        languageTarget: contextPack.languageTarget,
        manifest: contextManifest,
        proposal,
      });
    },
  });
}
