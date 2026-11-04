import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseDocument} from "yaml";
import {OWNER_SCHEMA_PIN,yamlSchemaCapability,diagnoseYamlSyntax} from "../site/yaml-source-diagnostics.mjs";

test("E2-A1 parses owner establish-pdu-session Phase YAML with no false errors",()=>{
  const example=readFileSync(new URL("../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
  assert.match(example,/preconditions:/);
  assert.match(example,/postconditions:/);
  assert.deepEqual(diagnoseYamlSyntax("assurance/procedure.yaml",example),[]);
  assert.equal(yamlSchemaCapability("assurance/procedure.yaml"),"procedure-schema-incompatible");
  assert.equal(example,readFileSync(new URL("../site/samples/packages/establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8"));
});

test("E2-A1 'on' is a YAML 1.2 string key, even without quoting",()=>{
  const source=[
    "procedures:",
    "  setup:",
    "    start: lookup",
    "    nodes:",
    "      lookup:",
    "        call: sbi.udm.sm_data.get",
    "        preconditions:",
    "          steps:",
    "            - verify: createdsession.ingress.eligible",
    "          on:",
    "            FAILED: failed",
    "        postconditions:",
    "          steps:",
    "            - verify: createdsession.udm.subscription_usable",
    "          on:",
    "            PASS: done",
    "        on:",
    "          COMMITTED: done",
    "      done:",
    "        terminal: SUCCEEDED",
    "      failed:",
    "        terminal: FAILED",
    ""
  ].join("\n");
  const before=source;
  assert.deepEqual(diagnoseYamlSyntax("assurance/procedure.yaml",source),[]);
  const json=parseDocument(source,{version:"1.2"}).toJS();
  const node=json.procedures.setup.nodes.lookup;
  assert.equal(node.on.COMMITTED,"done");
  assert.equal(node.preconditions.on.FAILED,"failed");
  assert.equal(node.postconditions.on.PASS,"done");
  assert.equal(source,before,"diagnostics are read-only");
});

test("E2-A1 reports invalid and duplicated YAML keys with precise editor coordinates",()=>{
  const invalid="procedures:\n  lookup: [\n";
  const messages=diagnoseYamlSyntax("assurance/procedure.yaml",invalid);
  assert.ok(messages.length>0);
  assert.equal(messages[0].severity,"error");
  assert.ok(messages[0].startLineNumber>=1&&messages[0].startColumn>=1);
  assert.ok(messages[0].endLineNumber>=1);
  assert.ok(messages[0].message.length>0);
  const duplicate="on: PASS\non: FAIL\n";
  assert.ok(diagnoseYamlSyntax("assurance/procedure.yaml",duplicate).length>0);
});

test("E2-A1 conservatively classifies Schema candidates and never invents Procedure Schema",()=>{
  assert.equal(yamlSchemaCapability("assurance/contract.yaml"),"schema-candidate-not-attached");
  assert.equal(yamlSchemaCapability("assurance/predicates.yaml"),"schema-candidate-not-attached");
  assert.equal(yamlSchemaCapability("schemas/example.schema.yaml"),"syntax-only");
  assert.equal(yamlSchemaCapability("references/failure-handling.md"),"not-yaml");
  assert.deepEqual(diagnoseYamlSyntax("scripts/helper.py","bad: ["),[]);
  assert.match(OWNER_SCHEMA_PIN.schemaSnapshot,/^[0-9a-f]{40}$/);
});

test("E2-A1 remains source-only on untrusted aliases and valid comments",()=>{
  const source="# example\r\non: PASS\r\nquoted: 'on'\r\nref: &v foo\r\ncopy: *v\r\n";
  assert.deepEqual(diagnoseYamlSyntax("assurance/procedure.yaml",source),[]);
  assert.equal(yamlSchemaCapability("assurance/procedure.yaml"),"procedure-schema-incompatible");
});
