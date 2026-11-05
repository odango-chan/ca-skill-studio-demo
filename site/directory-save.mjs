// E4-A2: explicitly approved, best-effort in-place save. This is NOT a
// filesystem CAS, watcher, lock, or multi-file atomic transaction.
const enc=new TextEncoder();
const LIMIT_FILES=64,LIMIT_BYTES=8*1024*1024,LIMIT_FILE=1024*1024;
const ROOT=/^[A-Za-z0-9._-]{1,100}$/;
function validPath(path){
  return typeof path==="string"&&path.length>0&&path.length<=240&&
    !path.startsWith("/")&&path.split("/").every(p=>p&&p!=="."&&p!==".."&&
      !/[\\\u0000-\u001f:<>|?*]/.test(p));
}
function identity(path){return path.normalize("NFC").toLowerCase();}
function same(a,b){
  if(!(a instanceof Uint8Array)||!(b instanceof Uint8Array)||a.length!==b.length)
    return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}
function failure(code,detail){
  const error=new Error(detail);error.code=code;return error;
}
function result(status,paths,saved,error="",uncertain=[]){
  return Object.freeze({status,saved:Object.freeze([...saved]),
    pending:Object.freeze(paths.filter(p=>!saved.includes(p))),
    uncertain:Object.freeze([...uncertain]),error});
}
function workspacePlan(workspace){
  if(!(workspace?.files instanceof Map)||!ROOT.test(workspace.name??"")||
     workspace.files.size<1||workspace.files.size>LIMIT_FILES)
    throw failure("BLOCKED","工作区不是有效的有界目录导入");
  const paths=new Map(),seen=new Set(),changes=[];
  let total=0;
  for(const [path,item] of workspace.files){
    const raw=item?.originalBytes;
    if(!validPath(path)||path!==item?.path||seen.has(identity(path))||
       !(raw instanceof Uint8Array)||raw.length>LIMIT_FILE)
      throw failure("BLOCKED","工作区存在无来源或不安全的文件："+path);
    seen.add(identity(path));total+=raw.length;
    if(total>LIMIT_BYTES)throw failure("BLOCKED","Package 超出 8 MiB 上限");
    if(item.editable){
      if(typeof item.text!=="string"||typeof item.initialText!=="string")
        throw failure("BLOCKED","工作区文本来源不完整："+path);
      if(item.text!==item.initialText){
        const bytes=enc.encode(item.text);
        if(bytes.length>LIMIT_FILE)
          throw failure("BLOCKED","待保存文件超出 1 MiB："+path);
        changes.push(Object.freeze({path,text:item.text,bytes}));
      }
    }else if(item.text!==null)throw failure("BLOCKED","资源类型不明确："+path);
    paths.set(path,item);
  }
  if(!paths.has("SKILL.md")||!paths.get("SKILL.md").editable)
    throw failure("BLOCKED","工作区缺少可编辑的根 SKILL.md");
  return {paths,changes};
}
async function readFile(fileHandle,path){
  if(fileHandle?.kind!=="file"||typeof fileHandle.getFile!=="function")
    throw failure("BLOCKED","不支持的文件句柄："+path);
  const file=await fileHandle.getFile();
  if(!Number.isSafeInteger(file?.size)||file.size>LIMIT_FILE||file.size<0)
    throw failure("CONFLICT","磁盘文件尺寸已改变或超过限制："+path);
  const buf=await file.arrayBuffer();
  if(!(buf instanceof ArrayBuffer)||buf.byteLength!==file.size)
    throw failure("CONFLICT","磁盘文件读取不完整："+path);
  return new Uint8Array(buf);
}
async function diskManifest(root){
  const files=new Map(),identities=new Set();
  let total=0,visited=0;
  async function walk(handle,prefix="",depth=0){
    if(++visited>256||depth>16||typeof handle?.entries!=="function")
      throw failure("BLOCKED","目录结构过深或无法完整枚举");
    for await(const [name,child] of handle.entries()){
      const path=prefix+name;
      if(!validPath(path)||name!==child?.name||identities.has(identity(path)))
        throw failure("CONFLICT","磁盘目录路径不安全或发生名称冲突："+path);
      identities.add(identity(path));
      if(child.kind==="directory"){
        await walk(child,path+"/",depth+1);
      }else if(child.kind==="file"){
        if(files.size>=LIMIT_FILES)
          throw failure("CONFLICT","磁盘文件数量超出 64");
        const bytes=await readFile(child,path);
        total+=bytes.length;
        if(total>LIMIT_BYTES)throw failure("CONFLICT","磁盘 Package 超出 8 MiB");
        files.set(path,{handle:child,bytes});
      }else{
        throw failure("BLOCKED","浏览器返回不支持的磁盘条目："+path);
      }
    }
  }
  await walk(root);
  return files;
}
async function verifyDirectory(root,plan){
  const disk=await diskManifest(root);
  if(disk.size!==plan.paths.size)
    throw failure("CONFLICT","磁盘文件列表与导入快照不一致（新增/删除文件）");
  for(const [path,item] of plan.paths){
    const actual=disk.get(path);
    if(!actual||!same(actual.bytes,item.originalBytes))
      throw failure("CONFLICT","磁盘文件发生外部变更："+path);
  }
  return disk;
}

// The caller must acquire a handle through a *fresh user-gesture picker*,
// with {mode:"readwrite"}, and supply a separate explicit confirmation.
// No handles are persisted, no files are created, removed, or renamed.
export async function saveDirectoryChanges({workspace,handle,confirmWrite}={}){
  let paths=[],saved=[],uncertain=[],attempted=null;
  try{
    const plan=workspacePlan(workspace);
    paths=plan.changes.map(x=>x.path);
    if(!paths.length)return result("NO_CHANGES",paths,saved);
    if(typeof confirmWrite!=="function"||handle?.kind!=="directory"||
       handle.name!==workspace.name)
      throw failure("BLOCKED","保存目录身份不符或缺少用户确认");
    if(typeof handle.queryPermission!=="function"||
       await handle.queryPermission({mode:"readwrite"})!=="granted")
      throw failure("BLOCKED","浏览器未授予本次目录的读写权限；请改用 ZIP 导出");
    // All files, including untouched opaque assets, must still be identical.
    await verifyDirectory(handle,plan);
    const approved=await confirmWrite(Object.freeze({
      directory:workspace.name,paths:Object.freeze([...paths])
    }));
    if(approved!==true)return result("CANCELLED",paths,saved);
    for(const change of plan.changes){
      // If edits occurred while awaiting the chooser/permission/confirmation,
      // abort rather than silently committing a stale text snapshot.
      if(plan.changes.some(c=>plan.paths.get(c.path).text!==c.text))
        throw failure("CONFLICT","保存期间工作区又被修改，请重新确认");
      // Re-enumerate and compare every file before EACH write. Even so,
      // another process can race between this check and writer.close().
      const disk=await verifyDirectory(handle,plan);
      const fileHandle=disk.get(change.path)?.handle;
      if(typeof fileHandle?.createWritable!=="function")
        throw failure("BLOCKED","浏览器不支持目标文件写入："+change.path);
      attempted=change.path;
      let writer,closed=false;
      try{
        // Full replacement: never retain an old tail if new text is shorter.
        writer=await fileHandle.createWritable({keepExistingData:false});
        await writer.write(change.bytes);
        await writer.truncate(change.bytes.length);
        await writer.close();
        closed=true;
      }finally{
        if(writer&&!closed){
          try{await writer.abort?.();}catch{/* do not hide the original error */}
        }
      }
      // A successful close is not by itself proof of durable bytes.
      const verify=await readFile(fileHandle,change.path);
      if(!same(verify,change.bytes))
        throw failure("CONFLICT","写入后核对失败，磁盘状态不确定："+change.path);
      const item=plan.paths.get(change.path);
      item.initialText=change.text;
      item.originalBytes=change.bytes.slice();
      saved.push(change.path);
      attempted=null;
    }
    // A changed untouched file (including opaque assets) after the final
    // write must not be reported as a clean whole-Package save. There is
    // still no kernel-level CAS: this is an additional best-effort check.
    await verifyDirectory(handle,plan);
    return result("SAVED",paths,saved);
  }catch(error){
    const status=saved.length?"PARTIAL":
      error?.code==="CONFLICT"?"CONFLICT":
      error?.code==="BLOCKED"?"BLOCKED":"FAILED";
    if(attempted&&!saved.includes(attempted))uncertain.push(attempted);
    return result(status,paths,saved,String(error?.message??error),uncertain);
  }
}
