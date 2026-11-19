import {mkdir,realpath,rm,symlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";

const appArgument=process.argv[2];
if(!appArgument)throw Error("Usage: node link-fixed-workbench-core.mjs <theia-app-directory>");
const app=resolve(appArgument);
const core=resolve(app,"node_modules/@theia/core");
const target=resolve("experiments/ide-host/theia-fixed-workbench/node_modules/@theia/core");
await mkdir(dirname(target),{recursive:true});
await rm(target,{recursive:true,force:true});
await symlink(core,target,"junction");
const [actualCore,actualTarget]=await Promise.all([realpath(core),realpath(target)]);
if(actualCore!==actualTarget)
  throw Error("Fixed workbench must resolve the exact same @theia/core instance as the target Theia app");
console.log("STUDIO_FIXED_WORKBENCH_CORE_LINK",JSON.stringify({app,core:actualCore,target:actualTarget}));
