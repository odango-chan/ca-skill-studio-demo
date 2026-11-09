import {existsSync,readFileSync,readdirSync,statSync} from "node:fs";
import {join} from "node:path";
const root="experiments/ide-host/theia-online/lib/frontend";
if(!existsSync(root))throw Error("Theia did not create lib/frontend");
function scan(dir,depth=0){
  if(depth>7)return [];
  const files=[];
  for(const ent of readdirSync(dir,{withFileTypes:true})){
    const p=join(dir,ent.name);
    if(ent.isDirectory())files.push(...scan(p,depth+1));
    else if(ent.isFile())files.push(p);
  }
  return files;
}
const files=scan(root);
const index=files.find(p=>p.endsWith("/index.html"));
if(!index)throw Error("Browser-only frontend index.html was not emitted");
if(statSync(index).size<200)throw Error("Empty HTML");
const pluginLists=files.filter(p=>p.endsWith("/hostedPlugin/list.json"));
const pluginListEvidence=pluginLists.map(p=>({path:p,text:readFileSync(p,"utf8").slice(0,1000)}));
const pluginName="ca-skill-studio-ide-spike";
const hasPlugin=files.some(p=>p.includes(pluginName))||
  pluginListEvidence.some(p=>p.text.includes(pluginName));
console.log("STUDIO_THEIA_FRONTEND_ARTIFACT",JSON.stringify({
  index,files:files.length,pluginLists:pluginLists.map(p=>p.path),
  pluginEntries:hasPlugin,sample:files.slice(0,12)
}));
if(!hasPlugin)throw Error("Theia browser-only build lacks prepared SKILL Studio Web extension");
