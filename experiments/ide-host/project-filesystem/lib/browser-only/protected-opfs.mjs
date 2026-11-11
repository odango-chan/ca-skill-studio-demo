// Project-scoped OPFS guard. This runs inside Theia's native filesystem
// provider, below native Explorer, text editors and the VS Code plugin RPC.
// No network, DOM, UI state, global patching or per-file business knowledge.
const ROLES=new Set(["skills","lib","output"]);
const posix=uri=>{
  const raw=uri?.path;
  const path=typeof raw==="string"?raw:raw?.toString?.();
  if(typeof path!=="string"||!path.startsWith("/")||
     path.split("/").some(s=>s==="."||s===".."||/%2e/i.test(s)))return null;
  return path.replace(/\/+$/,"")||"/";
};
const parent=path=>path.slice(0,path.lastIndexOf("/"))||"/";
const descendants=(path,root)=>path===root||path.startsWith(root+"/");
const child=(root,name)=>root.replace(/\/$/,"")+"/"+name;
const relative=(path,root)=>path.slice(root.length).replace(/^\//,"");

export function projectAccess(path,root){
  if(!path||!root||!descendants(path,root))return {role:"outside",protected:false,readonly:false};
  if(path===root)return {role:"project-root",protected:true,readonly:true};
  const [top,...tail]=relative(path,root).split("/");
  if(!ROLES.has(top))return {role:"other",protected:false,readonly:false};
  return {role:top,protected:tail.length===0,
    readonly:top!=="skills"||tail.length===0};
}

// Must find an actual project (all three distinct directories), rather than
// globally locking any unrelated folder named lib or output. The importer
// creates this triad before exposing its project as a Workspace.
export function protectOpfsProvider(base,{
  deny=reason=>{const error=new Error(reason);error.name="NoPermissions";throw error;},
  readonlyPermission=1, directoryType=2
}={}){
  if(!base||typeof base.stat!=="function")throw Error("OPFS provider required");
  const confirmed=new Set(),fds=new Map();
  const candidateRoots=path=>{
    if(!path)return [];
    const segments=path.split("/").filter(Boolean);
    const roots=[path];
    for(let i=0;i<segments.length;i++)
      if(ROLES.has(segments[i]))
        roots.push("/"+segments.slice(0,i).join("/"));
    return [...new Set(roots.map(x=>x||"/"))].sort((a,b)=>b.length-a.length);
  };
  const hasProject=async(uri,root)=>{
    if(confirmed.has(root))return true;
    for(const role of ROLES){
      try {
        const stat=await base.stat(uri.withPath(child(root,role)));
        if(stat?.type!==directoryType)return false;
      }catch{return false;}
    }
    confirmed.add(root);
    return true;
  };
  const classify=async uri=>{
    const path=posix(uri);
    if(!path)return {role:"invalid",readonly:true,protected:true};
    for(const root of candidateRoots(path))
      if(await hasProject(uri,root)){
        const entry=projectAccess(path,root);
        if(entry.role!=="outside")return {...entry,root};
      }
    return {role:"outside",readonly:false,protected:false};
  };
  const allowed=async(uri,action)=>{
    const entry=await classify(uri);
    if(entry.readonly)deny("Project "+entry.role+" is read-only: "+posix(uri)+" ("+action+")");
    return entry;
  };
  let proxy;
  const overrides={
    async stat(uri){const stat=await base.stat.call(proxy,uri);
      const entry=await classify(uri);
      return entry.readonly?{...stat,permissions:readonlyPermission}:stat;},
    async writeFile(uri,...args){await allowed(uri,"writeFile");return base.writeFile.call(proxy,uri,...args);},
    async updateFile(uri,...args){await allowed(uri,"updateFile");return base.updateFile.call(proxy,uri,...args);},
    async mkdir(uri,...args){
      const entry=await classify(uri);
      if(entry.readonly){
        // Existing structural roots need to be idempotent so repeat sample
        // imports can call mkdir without generating a new file system mutation.
        if(entry.protected){
          try{const st=await base.stat.call(proxy,uri);
            if(st?.type===directoryType)return;}
          catch{}
        }
        deny("Project "+entry.role+" cannot be created or changed");
      }
      return base.mkdir.call(proxy,uri,...args);
    },
    async delete(uri,...args){await allowed(uri,"delete");return base.delete.call(proxy,uri,...args);},
    async rename(from,to,...args){
      await allowed(from,"rename-source");
      await allowed(to,"rename-target");
      return base.rename.call(proxy,from,to,...args);
    },
    async copy(from,to,...args){
      const source=await classify(from);
      if(source.protected)deny("Cannot copy a structural project root");
      await allowed(to,"copy-target");
      return base.copy.call(proxy,from,to,...args);
    },
    async open(uri,opts,...args){
      if(opts?.create)await allowed(uri,"open-create");
      const fd=await base.open.call(proxy,uri,opts,...args);
      fds.set(fd,uri);return fd;
    },
    async write(fd,...args){
      const uri=fds.get(fd);
      if(!uri)deny("Unknown OPFS write descriptor");
      await allowed(uri,"write-descriptor");
      return base.write.call(proxy,fd,...args);
    },
    async close(fd,...args){try{return await base.close.call(proxy,fd,...args);}
      finally{fds.delete(fd);}},
    async clear(){deny("Direct OPFS clear is not allowed in Skill Studio");}
  };
  proxy=new Proxy(base,{get(target,key){
    if(Object.hasOwn(overrides,key))return overrides[key];
    const value=Reflect.get(target,key,target);
    return typeof value==="function"?value.bind(proxy):value;
  }});
  return proxy;
}
