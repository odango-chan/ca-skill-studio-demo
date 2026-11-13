// Native Markdown preview policy for the built-in VS Code Markdown extension.
// Package navigation is constrained to an exact, pre-inventoried root. Images
// and raw HTML are deliberately disabled to match the existing Studio preview.
const policies=new Map();
const allowedExtensions=new Set([".md",".markdown",".yaml",".yml",".py",".json"]);

const uriKey=uri=>uri?.toString?.()??String(uri??"");

export function setNativeMarkdownPackagePolicies(uris,policy){
  const allowedFiles=new Set(policy.allowedFiles??[]);
  for(const uri of uris){
    if(!uri)continue;
    const relative=uri.path.slice(policy.rootPath.length+1);
    const slash=relative.lastIndexOf("/");
    policies.set(uriKey(uri),{
      rootPath:policy.rootPath,
      allowedFiles,
      currentDirRelative:slash<0?"":relative.slice(0,slash),
      denyAll:Boolean(policy.denyAll)
    });
  }
}

export function isAllowedPackageRelativeLink(href,currentDirRelative,allowedFiles){
  if(typeof href!=="string"||!href)return false;
  if(href.startsWith("#"))return true;
  if(/^(?:https?:|mailto:|tel:)/i.test(href))return true;
  if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)||href.startsWith("//"))return false;
  const rawPath=href.split(/[?#]/,1)[0];
  if(!rawPath||rawPath.startsWith("/")||rawPath.includes("\\")||
     /%(?:2f|5c)/i.test(rawPath))return false;
  const segments=(currentDirRelative??"").split("/").filter(Boolean);
  try{
    for(const raw of rawPath.split("/")){
      if(!raw||raw===".")continue;
      const part=decodeURIComponent(raw);
      if(part===".."){
        if(!segments.length)return false;
        segments.pop();
        continue;
      }
      if(!/^[A-Za-z0-9_.-]+$/.test(part))return false;
      segments.push(part);
    }
  }catch{
    return false;
  }
  if(!segments.length)return false;
  const relative=segments.join("/");
  const dot=relative.lastIndexOf(".");
  const extension=dot<0?"":relative.slice(dot).toLowerCase();
  return allowedExtensions.has(extension)&&allowedFiles?.has(relative)===true;
}

function blockedRelativeLink(href,policy){
  if(!href)return true;
  if(href.startsWith("#")||/^(?:https?:|mailto:|tel:)/i.test(href))return false;
  if(!policy||policy.denyAll)return true;
  return !isAllowedPackageRelativeLink(
    href,policy.currentDirRelative,policy.allowedFiles);
}

function setToken(token,changes,content=""){
  changes.push([token,{
    type:token.type,tag:token.tag,attrs:token.attrs,
    content:token.content,nesting:token.nesting,children:token.children
  }]);
  token.type="text";
  token.tag="";
  token.attrs=null;
  token.content=content;
  token.nesting=0;
  token.children=null;
}

function restoreTokens(changes){
  for(let index=changes.length-1;index>=0;index--){
    const [token,previous]=changes[index];
    Object.assign(token,previous);
  }
}

export function extendMarkdownIt(md){
  // Markdown source must never opt into raw HTML rendering through the preview.
  md.set({html:false});
  const originalRender=md.renderer.render.bind(md.renderer);
  md.renderer.render=(tokens,options,env)=>{
    const policy=policies.get(uriKey(env?.currentDocument));
    const changes=[];
    const visit=list=>{
      const blockedLinks=[];
      for(const token of list??[]){
        if(token.type==="link_open"){
          const blocked=blockedRelativeLink(token.attrGet?.("href"),policy);
          blockedLinks.push(blocked);
          if(blocked)setToken(token,changes);
        }else if(token.type==="link_close"){
          if(blockedLinks.pop()===true)setToken(token,changes);
        }else if(token.type==="image"){
          // The old Studio renderer uses img-src 'none'. Keep the same
          // guarantee rather than allowing workspace or remote image fetches.
          setToken(token,changes,token.content??"");
        }
        if(token.children?.length)visit(token.children);
      }
    };
    visit(tokens);
    try{
      return originalRender(tokens,options,env);
    }finally{
      restoreTokens(changes);
    }
  };
  return md;
}

export async function prepareNativeMarkdownPackagePolicy(vscode,uri){
  const deny=()=>{
    setNativeMarkdownPackagePolicies([uri],{
      rootPath:uri.path,allowedFiles:[],denyAll:true
    });
    return false;
  };
  try{
    const workspaceFolder=vscode.workspace.getWorkspaceFolder(uri);
    if(!workspaceFolder)return deny();
    const workspaceRoot=workspaceFolder.uri.path.replace(/\/$/,"");
    let rootPath=workspaceRoot;
    const skillFiles=await vscode.workspace.findFiles(
      "**/SKILL.md","**/node_modules/**",5001);
    if(skillFiles.length>5000)return deny();
    const containing=skillFiles
      .filter(file=>{
        const candidate=file.path.slice(0,-"/SKILL.md".length);
        return uri.path===file.path||uri.path.startsWith(candidate+"/");
      })
      .map(file=>file.path.slice(0,-"/SKILL.md".length))
      .sort((a,b)=>b.length-a.length);
    if(containing.length)rootPath=containing[0];
    if(!rootPath||(!uri.path.startsWith(rootPath+"/")&&uri.path!==rootPath))
      return deny();

    const rootUri=uri.with({path:rootPath});
    // A package root reached through a symlink is not an admissible boundary.
    let current=workspaceRoot;
    const rootSegments=rootPath.slice(workspaceRoot.length).split("/").filter(Boolean);
    for(const segment of rootSegments){
      current+="/"+segment;
      const stat=await vscode.workspace.fs.stat(uri.with({path:current}));
      if(stat.type&vscode.FileType.SymbolicLink)return deny();
      if(!(stat.type&vscode.FileType.Directory))return deny();
    }

    const files=await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootUri,"**/*"),"**/node_modules/**",5001);
    if(files.length>5000)return deny();
    const allowedFiles=new Set();
    const markdownUris=[];
    for(const file of files){
      if(!file.path.startsWith(rootPath+"/"))continue;
      const relative=file.path.slice(rootPath.length+1);
      if(/\.(?:md|markdown)$/i.test(relative))markdownUris.push(file);
      const extension=relative.slice(relative.lastIndexOf(".")).toLowerCase();
      if(!allowedExtensions.has(extension))continue;
      const segments=relative.split("/");
      let target=rootPath,safe=true;
      for(let index=0;index<segments.length;index++){
        target+="/"+segments[index];
        const stat=await vscode.workspace.fs.stat(uri.with({path:target}));
        if(stat.type&vscode.FileType.SymbolicLink){safe=false;break;}
        if(index<segments.length-1&&!(stat.type&vscode.FileType.Directory)){
          safe=false;break;
        }
        if(index===segments.length-1&&(stat.type&vscode.FileType.Directory)){
          safe=false;break;
        }
      }
      if(safe)allowedFiles.add(relative);
    }
    const currentRelative=uri.path.slice(rootPath.length+1);
    if(!allowedFiles.has(currentRelative))return deny();
    if(!markdownUris.some(file=>file.toString()===uri.toString()))
      markdownUris.push(uri);
    setNativeMarkdownPackagePolicies(markdownUris,{
      rootPath,allowedFiles,denyAll:false
    });
    return true;
  }catch{
    return deny();
  }
}
