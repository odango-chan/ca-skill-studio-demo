import {parse} from "yaml";
import commonSource from "./schemas/connectionagent/v1alpha1/common.schema.yaml";
import contractSource from "./schemas/connectionagent/v1alpha1/skill-contract.schema.yaml";
import predicateSource from "./schemas/connectionagent/v1alpha1/predicate-set.schema.yaml";
import {OWNER_SCHEMA_PIN} from "./yaml-schema-policy.mjs";

const sourcePrefix =
  "https://github.com/odango-chan/ca-agent-demo/blob/" +
  OWNER_SCHEMA_PIN.skillCommit +
  "/tests/contracts/ca-skill-toolchain/" +
  OWNER_SCHEMA_PIN.toolchainSnapshot + "/";

function parseOwnerSchema(source, fileName) {
  const value = parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid pinned Owner JSON Schema: " + fileName);
  }
  // The checked-in source remains byte-for-byte identical to the owner file.
  // Normalizing only $id gives relative common.schema.yaml refs a deterministic
  // local registry URI; it does not change any validation constraint.
  return {...value, $id: sourcePrefix + fileName};
}

const commonUri = sourcePrefix + "common.schema.yaml";
const contractUri = sourcePrefix + "skill-contract.schema.yaml";
const predicateUri = sourcePrefix + "predicate-set.schema.yaml";
const commonSchema = parseOwnerSchema(commonSource, "common.schema.yaml");
const contractSchema = parseOwnerSchema(contractSource, "skill-contract.schema.yaml");
const predicateSchema = parseOwnerSchema(predicateSource, "predicate-set.schema.yaml");

export function createOwnerYamlSchemas() {
  return [
    // Registered for local $ref resolution only; never associated to a file.
    {uri: commonUri, fileMatch: [], schema: commonSchema},
    {
      uri: contractUri,
      fileMatch: ["inmemory:/assurance/contract.yaml"],
      schema: contractSchema
    },
    {
      uri: predicateUri,
      fileMatch: ["inmemory:/assurance/predicates.yaml"],
      schema: predicateSchema
    }
  ];
}
