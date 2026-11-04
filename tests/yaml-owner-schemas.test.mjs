import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parse} from "yaml";
import {OWNER_SCHEMA_PIN,yamlSchemaCapability} from "../site/yaml-schema-policy.mjs";

const base=new URL("../site/schemas/connectionagent/v1alpha1/",import.meta.url);
const sample=new URL("../site/samples/packages/establish-pdu-session/assurance/",import.meta.url);
const read=url=>readFileSync(url,"utf8");
const parseYaml=url=>parse(read(url));

function gitBlobSha(content){
  const bytes=Buffer.from(content,"utf8");
  return createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
}
function refs(value,out=[]){
  if(!value||typeof value!=="object")return out;
  if(Array.isArray(value)){for(const child of value)refs(child,out);return out;}
  for(const [key,child] of Object.entries(value)){
    if(key==="$ref")out.push(child);
    else refs(child,out);
  }
  return out;
}
function resolvePointer(root,pointer){
  assert.ok(pointer.startsWith("#/"),"expected local JSON Pointer");
  return pointer.slice(2).split("/").map(x=>x.replace(/~1/g,"/").replace(/~0/g,"~"))
    .reduce((value,key)=>value?.[key],root);
}

test("E2-A2 schema vendor files are byte-identical to the pinned Toolchain snapshot",()=>{
  const manifest=JSON.parse(read(new URL("manifest.json",base)));
  assert.equal(manifest.ownerRepository,OWNER_SCHEMA_PIN.repository);
  assert.equal(manifest.ownerSkillCommit,OWNER_SCHEMA_PIN.skillCommit);
  assert.equal(manifest.toolchainSchemaSnapshot,OWNER_SCHEMA_PIN.toolchainSnapshot);
  for(const [name,entry] of Object.entries(manifest.files)){
    const content=read(new URL(name,base));
    assert.equal(gitBlobSha(content),entry.gitBlobSha,name+" owner blob SHA");
  }
});

test("E2-A2 Contract and Predicate schemas are v1alpha1 and resolve only pinned common refs",()=>{
  const common=parseYaml(new URL("common.schema.yaml",base));
  const contract=parseYaml(new URL("skill-contract.schema.yaml",base));
  const predicates=parseYaml(new URL("predicate-set.schema.yaml",base));
  for(const schema of [common,contract,predicates])
    assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.$id,"skill-contract.schema.yaml");
  assert.equal(predicates.$id,"predicate-set.schema.yaml");
  for(const [name,schema] of [["Contract",contract],["PredicateSet",predicates]]){
    const all=refs(schema);
    assert.ok(all.length>0,name+" must reference common owner definitions");
    for(const ref of all){
      const [file,pointer]=ref.split("#");
      if(file==="common.schema.yaml")assert.ok(resolvePointer(common,"#"+pointer),name+" common ref "+ref);
      else if(file==="")assert.ok(resolvePointer(schema,"#"+pointer),name+" local ref "+ref);
      else assert.fail(name+" contains unpinned/external reference "+ref);
    }
  }
});

test("E2-A2 actual owner Contract and Predicate sample files match their schema roots",()=>{
  const contract=parseYaml(new URL("contract.yaml",sample));
  const predicates=parseYaml(new URL("predicates.yaml",sample));
  assert.equal(contract.apiVersion,"connectionagent.io/v1alpha1");
  assert.equal(contract.kind,"SkillContract");
  assert.equal(contract.metadata.name,"establish-pdu-session");
  assert.ok(contract.spec.allowedResources.capabilities.length>0);
  assert.ok(contract.spec.postconditions.length>0);
  assert.equal(predicates.apiVersion,"connectionagent.io/v1alpha1");
  assert.equal(predicates.kind,"PredicateSet");
  assert.equal(predicates.metadata.skill,"establish-pdu-session");
  assert.ok(Object.keys(predicates.predicates).length>0);
});

test("E2-A2 applies only the two proven Owner schemas and refuses Procedure Schema",()=>{
  assert.equal(yamlSchemaCapability("assurance/contract.yaml"),"owner-schema-v1alpha1");
  assert.equal(yamlSchemaCapability("assurance/predicates.yaml"),"owner-schema-v1alpha1");
  assert.equal(yamlSchemaCapability("assurance/procedure.yaml"),"procedure-schema-incompatible");
  assert.equal(yamlSchemaCapability("schemas/establishment-request.schema.yaml"),"syntax-only");
  assert.equal(yamlSchemaCapability("references/failure-handling.md"),"not-yaml");
});
