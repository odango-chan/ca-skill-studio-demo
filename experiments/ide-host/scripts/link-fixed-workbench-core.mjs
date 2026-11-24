import {lstat,mkdir,realpath,symlink,unlink} from "node:fs/promises";
import {dirname,resolve} from "node:path";

const appArgument=process.argv[2];
if(!appArgument)throw Error("Usage: node link-fixed-workbench-core.mjs <theia-app-directory>");
const app=resolve(appArgument);
for(const name of ["core","editor"]){
  const dependency=resolve(app,"node_modules/@theia",name);
  const target=resolve("experiments/ide-host/theia-fixed-workbench/node_modules/@theia",name);
  await mkdir(dirname(target),{recursive:true});
  const existing=await lstat(target).catch(error=>{
    if(error.code!=="ENOENT")throw error;
    return null;
  });
  if(existing){
    if(!existing.isSymbolicLink())throw Error("Expected a dependency junction: "+target);
    await unlink(target);
  }
  await symlink(dependency,target,"junction");
  const [actualDependency,actualTarget]=await Promise.all([realpath(dependency),realpath(target)]);
  if(actualDependency!==actualTarget)
    throw Error("Fixed workbench must resolve the same Theia dependency as the app: "+name);
  console.log("STUDIO_FIXED_WORKBENCH_DEPENDENCY_LINK",JSON.stringify({app,name,dependency:actualDependency,target:actualTarget}));
}
