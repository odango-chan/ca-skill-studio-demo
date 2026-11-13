import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

export function pagesBuildInfo({sourceSha,expectedSha,ref,runId}){
  if(!/^[0-9a-f]{40}$/.test(sourceSha??"")||
     !/^[0-9a-f]{40}$/.test(expectedSha??""))
    throw Error("Missing exact Pages source SHA");
  if(sourceSha!==expectedSha)
    throw Error("Pages checkout moved: refusing to publish a different source SHA");
  return {schemaVersion:2,sourceSha,workflowSha:expectedSha,
    workflowRunId:String(runId??""),defaultHost:"theia-browser-only",
    classicPublished:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error("Missing "+name);return process.argv[i+1];};
  const sha=cwd=>execFileSync("git",["rev-parse","HEAD"],{cwd,encoding:"utf8"}).trim();
  const info=pagesBuildInfo({sourceSha:sha(arg("--source")),expectedSha:process.env.GITHUB_SHA,
    ref:process.env.GITHUB_REF,runId:process.env.GITHUB_RUN_ID});
  writeFileSync(arg("--output"),JSON.stringify(info,null,2)+"\n");
  console.log("STUDIO_PAGES_EXACT_SOURCE",JSON.stringify(info));
}
