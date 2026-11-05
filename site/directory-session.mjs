import {importDirectoryFiles} from "./directory-import.mjs";

// E4: the user explicitly chooses a readable directory in this browser tab.
// A FileList cannot carry its original OS directory handle; the picker can.
// The handle is never persisted or used to write without another user click.
const MAX_FILES=64,MAX_ENTRIES=256,MAX_DEPTH=16;
const LIMIT_FILE=1024*1024,LIMIT_TOTAL=8*1024*1024;
const ROOT=/^[A-Za-z0-9._-]{1,100}$/;
function validPath(path){
  return typeof path==="string"&&path.length>0&&path.length<=240&&
    !path.startsWith("/")&&path.split("/").every(x=>x&&x!=="."&&x!==".."&&
      !/[\\\u0000-\u001f:<>|?*]/.test(x));
}
export async function importDirectoryHandle(handle){
  if(handle?.kind!=="directory"||!ROOT.test(handle.name??"")||
     typeof handle.entries!=="function")
    throw new Error("浏览器没有返回有效的 SKILL 目录句柄");
  const files=[];let visited=0,total=0;
  async function collect(parent,prefix="",depth=0){
    if(depth>MAX_DEPTH)throw new Error("SKILL 目录层级超出限制");
    for await(const [name,entry] of parent.entries()){
      if(++visited>MAX_ENTRIES)throw new Error("SKILL 目录条目超出限制");
      if(typeof name!=="string"||name!==entry?.name)
        throw new Error("目录路径与文件句柄名称不一致");
      const path=prefix+name;
      if(!validPath(path))throw new Error("不安全的目录相对路径");
      if(entry.kind==="directory"){
        if(typeof entry.entries!=="function")
          throw new Error("无法枚举子目录："+path);
        await collect(entry,path+"/",depth+1);
      }else if(entry.kind==="file"){
        if(files.length>=MAX_FILES)
          throw new Error("SKILL 文件数量超出 64 个上限");
        if(typeof entry.getFile!=="function")
          throw new Error("无法读取目录文件："+path);
        const file=await entry.getFile();
        if(file?.name!==name||!Number.isSafeInteger(file.size)||
           file.size<0||file.size>LIMIT_FILE||
           typeof file.arrayBuffer!=="function")
          throw new Error("SKILL 文件不可读取或超出 1 MiB："+path);
        total+=file.size;
        if(total>LIMIT_TOTAL)throw new Error("SKILL 目录超出 8 MiB 上限");
        files.push({
          name,size:file.size,
          webkitRelativePath:handle.name+"/"+path,
          arrayBuffer:()=>file.arrayBuffer()
        });
      }else{
        throw new Error("目录包含不支持的条目："+path);
      }
    }
  }
  await collect(handle);
  const imported=await importDirectoryFiles(files);
  return {...imported,handle};
}
