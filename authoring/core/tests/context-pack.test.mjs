import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextPack,
  CONTEXT_PACK_SCHEMA,
  ContextPackError,
  MAX_CONTEXT_PACK_BYTES,
} from "../context-pack.mjs";

function base(overrides = {}) {
  return {
    taskId: "task-1",
    revision: 1,
    languageTarget: "connectionagent.io/v1alpha4",
    procedure: {
      path: "assurance/procedure.yaml",
      documentVersion: 7,
      text: "start: create-session\nnodes: {}\n",
    },
    resources: [],
    maxBytes: 131072,
    ...overrides,
  };
}

test("Context Pack uses the live Procedure and returns a matching disclosure manifest", async () => {
  const result = await buildContextPack(base({
    resources: [{
      id: "contract-goal",
      kind: "contract",
      path: "assurance/contract.yaml",
      selected: true,
      content: "goal: session.established\n",
    }, {
      id: "predicate-defs",
      kind: "predicate",
      path: "assurance/predicates.yaml",
      selected: true,
      content: "predicates: {}\n",
    }],
  }));
  assert.equal(result.pack.schema, CONTEXT_PACK_SCHEMA);
  assert.equal(result.pack.procedure.text, "start: create-session\nnodes: {}\n");
  assert.equal(result.pack.resources.length, 2);
  assert.equal(result.manifest.length, 3);
  assert.equal(result.contentBytes, result.manifest.reduce((sum, item) => sum + item.bytes, 0));
  assert.ok(result.byteCount >= result.contentBytes);
  assert.equal(result.pack.procedure.label, "assurance/procedure.yaml");
  assert.equal("documentVersion" in result.pack, false);
  assert.equal("path" in result.pack.procedure, false);
});

test("Context Pack excludes unselected resources", async () => {
  const result = await buildContextPack(base({
    resources: [{
      id: "unselected-reference",
      kind: "reference",
      path: "references/3gpp.md",
      selected: false,
      explicitlyIncluded: false,
      content: "not sent",
    }],
  }));
  assert.equal(result.pack.resources.length, 0);
  assert.equal(result.manifest.length, 1);
});

test("Reference and Script sources require explicit per-task opt-in", async () => {
  await assert.rejects(
    buildContextPack(base({
      resources: [{
        id: "ref-1",
        kind: "reference",
        path: "references/3gpp.md",
        selected: true,
        explicitlyIncluded: false,
        content: "3GPP reference",
      }],
    })),
    (error) => error instanceof ContextPackError && error.code === "explicit_opt_in_required",
  );
});

test("Context Pack rejects path traversal, absolute paths and excluded directories", async () => {
  for (const path of [
    "../outside.md",
    "/tmp/private.md",
    "lib/provider.yaml",
    "output/result.yaml",
    "references/../../.env",
    "references/.env.local",
    "references/.git/config",
    "references/output/private.md",
  ]) {
    await assert.rejects(
      buildContextPack(base({
        resources: [{
          id: "bad-path",
          kind: "reference",
          path,
          selected: true,
          explicitlyIncluded: true,
          content: "must not be sent",
        }],
      })),
      ContextPackError,
      path,
    );
  }
});

test("Context Pack accepts only verified dependency metadata", async () => {
  await assert.rejects(
    buildContextPack(base({
      resources: [{
        id: "provider-session-read",
        kind: "dependency",
        version: "1.2.3",
        verified: false,
        selected: true,
        content: "capability metadata",
      }],
    })),
    (error) => error instanceof ContextPackError && error.code === "unverified_dependency",
  );
});

test("Context Pack rejects oversized input without silently truncating", async () => {
  await assert.rejects(
    buildContextPack(base({
      maxBytes: 10,
      resources: [{
        id: "contract-goal",
        kind: "contract",
        path: "assurance/contract.yaml",
        selected: true,
        content: "goal: session.established\n",
      }],
    })),
    (error) => error instanceof ContextPackError &&
      error.code === "context_too_large" &&
      error.details.byteCount > error.details.maxBytes &&
      error.details.items.length === 2,
  );
});

test("Context Pack rejects duplicate IDs and unsupported language targets", async () => {
  await assert.rejects(
    buildContextPack(base({
      resources: [{
        id: "procedure-current",
        kind: "contract",
        path: "assurance/contract.yaml",
        selected: true,
        content: "goal: x",
      }],
    })),
    (error) => error instanceof ContextPackError && error.code === "invalid_or_duplicate_resource_id",
  );
  await assert.rejects(
    buildContextPack(base({ languageTarget: "legacy" })),
    (error) => error instanceof ContextPackError && error.code === "unsupported_language_target",
  );
});

test("Context Pack hashes UTF-8 bytes and keeps all source paths Package-relative", async () => {
  const result = await buildContextPack(base({
    procedure: {
      path: "assurance/procedure.yaml",
      documentVersion: 2,
      text: "summary: 会话建立\n",
    },
    resources: [{
      id: "schema-1",
      kind: "schema",
      path: "schemas/request.schema.yaml",
      selected: true,
      content: "type: object\n",
    }],
  }));
  assert.ok(result.manifest[0].bytes > result.pack.procedure.text.length);
  assert.match(result.manifest[0].digest, /^[a-f0-9]{64}$/);
  assert.ok(result.pack.resources.every((item) => !item.label.startsWith("/")));
});


test("Context Pack rejects secret and token filenames even under an otherwise allowed directory", async () => {
  for (const path of ["references/api-secret.md", "scripts/access-token.txt", "schemas/private-key.json"]) {
    const kind = path.startsWith("references/") ? "reference" :
      path.startsWith("scripts/") ? "script" : "schema";
    await assert.rejects(
      buildContextPack(base({
        resources: [{
          id: "sensitive-file",
          kind,
          path,
          selected: true,
          explicitlyIncluded: true,
          content: "sensitive",
        }],
      })),
      (error) => error instanceof ContextPackError && error.code === "sensitive_path",
      path,
    );
  }
});


test("Context Pack enforces the initial 128 KiB budget ceiling", async () => {
  assert.equal(MAX_CONTEXT_PACK_BYTES, 131072);
  await assert.rejects(
    buildContextPack(base({ maxBytes: MAX_CONTEXT_PACK_BYTES + 1 })),
    (error) => error instanceof ContextPackError && error.code === "invalid_byte_limit",
  );
});
