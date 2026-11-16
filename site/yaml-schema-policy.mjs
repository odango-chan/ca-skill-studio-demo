// Schema ownership and applicability are derived only from the pinned owner snapshot.
export const OWNER_SCHEMA_PIN = Object.freeze({
  repository: "odango-chan/ca-agent-demo",
  skillCommit: "7570b309a998580a6952352e2bf4b1c19e5c710d",
  toolchainSnapshot: "03a42764ee2a67e39f57ab550b63c7a5d7966199",
  files: Object.freeze({
    common: "ac6c3cb259b6d303adee44229b36946ab38b1e13",
    contract: "bfe688be2d44ce26c621c9a4d6e78af3d933381d",
    predicates: "e01af3b6bb803e9632eb5ff6ba99bbb87da0bc4e"
  })
});

export function yamlSchemaCapability(path = "") {
  if (!/\.ya?ml$/i.test(path)) return "not-yaml";
  if (path === "assurance/contract.yaml" ||
      path === "assurance/predicates.yaml") return "owner-schema-v1alpha1";
  if (path === "assurance/procedure.yaml") return "procedure-schema-incompatible";
  return "syntax-only";
}
