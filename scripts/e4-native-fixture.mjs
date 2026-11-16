// E4-A2 native acceptance fixtures: only allocate a new sandbox under caller's
// .agent-tmp, never enumerate, copy, or overwrite an existing Skill directory.
import {randomBytes,createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,readdir,writeFile} from "node:fs/promises";
import {join,relative,sep} from "node:path";

const enc=new TextEncoder();
export const NATIVE_FOLDER="studio-e4-native-fixture";
export function fixtureFiles(token){
  if(!/^[a-f0-9]{32}$/.test(token))throw Error("Invalid fixture marker token");
  return new Map([
    ["SKILL.md",Uint8Array.from([0xef,0xbb,0xbf,...enc.encode("# Native acceptance\r\n")])],
    ["scripts/check.py",enc.encode("print('source originally longer')\r\n")],
    ["references/note.md",enc.encode("# Unchanged reference\r\n")],
    ["assets/opaque.bin",Uint8Array.from([0,255,137,80,78,71,0])],
    [".e4-test-token",enc.encode(token)]
  ]);
}
export function expectedFinalFiles(token){
  const files=fixtureFiles(token);
  files.set("SKILL.md",Uint8Array.from([...files.get("SKILL.md"),
    ...enc.encode("# Saved on disk\r\n")]));
  files.set("scripts/check.py",enc.encode("pass\n"));
  return files;
}
export async function createNativeFixture(scratch){
  await mkdir(scratch,{recursive:true});
  const root=await mkdtemp(join(scratch,"e4-native-"));
  const folder=join(root,NATIVE_FOLDER);
  const token=randomBytes(16).toString("hex");
  const originals=fixtureFiles(token);
  await mkdir(folder);
  for(const [path,bytes] of originals){
    const target=join(folder,...path.split("/"));
    await mkdir(join(target,".."),{recursive:true});
    await writeFile(target,bytes,{flag:"wx"});
  }
  return {root,folder,token,name:NATIVE_FOLDER,originals};
}
export async function verifyNativeFixture(folder,token,{final=true}={}){
  const expected=final?expectedFinalFiles(token):fixtureFiles(token);
  const actual=new Map(),unsupported=[];
  async function visit(dir){
    const names=await readdir(dir,{withFileTypes:true});
    for(const ent of names){
      const abs=join(dir,ent.name),p=relative(folder,abs).split(sep).join("/");
      if(ent.isDirectory())await visit(abs);
      else if(ent.isFile())actual.set(p,new Uint8Array(await readFile(abs)));
      else unsupported.push(p);
    }
  }
  await visit(folder);
  const wrong=[];
  for(const [p,bytes] of expected){
    const found=actual.get(p);
    if(!found||found.length!==bytes.length||found.some((x,i)=>x!==bytes[i]))
      wrong.push(p);
  }
  const extras=[...actual.keys()].filter(p=>!expected.has(p));
  const hashes=Object.fromEntries([...actual].map(([p,b])=>[p,{
    size:b.length,sha256:createHash("sha256").update(b).digest("hex")
  }]));
  return {pass:!wrong.length&&!extras.length&&!unsupported.length,
    missingOrChanged:wrong,extraFiles:extras,unsupported,hashes};
}
