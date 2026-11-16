import {createFileWorkspace} from "./sample-packages.mjs";

// E4-A1: one-shot, read-only directory picker import. No File System Access
// handle, disk watcher, write permission or persistence authority.
const MAX_FILES=64,MAX_FILE=1024*1024,MAX_TOTAL=8*1024*1024;
const ROOT=/^[a-zA-Z0-9._-]{1,100}$/;
const TEXT=/(^SKILL\.md$|\.(?:md|markdown|ya?ml|py|json|jsonl|txt|js|ts|sh|toml|ini|cfg|csv|xml|html|css|cel|proto))$/i;
const decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});

function validPath(path) {
  return typeof path==="string"&&path.length>0&&path.length<=240&&
    !path.startsWith("/")&&path.split("/").every(p=>p&&p!=="."&&p!==".."&&
      !/[\\\u0000-\u001f:<>|?*]/.test(p));
}

export async function importDirectoryFiles(fileList) {
  const files=Array.from(fileList??[]);
  if(!files.length||files.length>MAX_FILES)
    throw new Error("目录文件数量超出 1–64 的有界导入范围");
  const plan=[],seen=new Set();
  let root=null,total=0;
  for(const file of files) {
    const full=file?.webkitRelativePath;
    if(!validPath(full))throw new Error("浏览器没有提供安全的目录相对路径");
    const parts=full.split("/");
    if(parts.length<2||!ROOT.test(parts[0]))
      throw new Error("请选择单个有效的 SKILL 根目录");
    if(root!==null&&root!==parts[0])throw new Error("不能混合多个根目录");
    root=parts[0];
    const path=parts.slice(1).join("/");
    if(!validPath(path)||file.name!==parts.at(-1))
      throw new Error("目录路径与文件名不匹配");
    // Fail rather than exporting a ZIP that overwrites names on insensitive
    // host filesystems. Never normalize or rewrite the actual authored path.
    const key=path.normalize("NFC").toLowerCase();
    if(seen.has(key))throw new Error("目录包含重复或大小写冲突的文件名");
    seen.add(key);
    if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE)
      throw new Error("单文件超出 1 MiB 的导入上限："+path);
    total+=file.size;
    if(total>MAX_TOTAL)throw new Error("Package 超出 8 MiB 的导入上限");
    if(typeof file.arrayBuffer!=="function")
      throw new Error("无法读取所选目录的文件："+path);
    plan.push({path,file});
  }
  if(!seen.has("skill.md"))throw new Error("所选目录缺少根 SKILL.md");
  const entries=[];
  let opaqueCount=0;
  for(const {path,file} of plan) {
    const buffer=await file.arrayBuffer();
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size)
      throw new Error("文件读取不完整："+path);
    const bytes=new Uint8Array(buffer);
    let text=null;
    if(TEXT.test(path)) {
      try{
        const decoded=decoder.decode(bytes);
        if(!decoded.includes("\u0000"))text=decoded;
      }catch{/* Non-UTF-8 asset remains opaque, never silently replaced. */}
    }
    if(text===null)opaqueCount++;
    entries.push(text===null?{path,bytes}:{path,text,bytes});
  }
  const workspace=createFileWorkspace(root,entries);
  const entry=workspace.files.get("assurance/procedure.yaml")?.editable?
    "assurance/procedure.yaml":"SKILL.md";
  if(!workspace.files.get(entry)?.editable)
    throw new Error("SKILL.md 不是可编辑的 UTF-8 文本");
  return {workspace,entry,opaqueCount};
}

// Preserve untouched imported bytes; only changed Source is re-encoded.
// Unknown and opaque files are exported unchanged, not silently discarded.
export function packageZipEntries(workspace) {
  if(!(workspace?.files instanceof Map)||!workspace.files.size)
    throw new Error("No Package to export");
  return [...workspace.files.values()].map(file=>
    file.editable
      ? {path:file.path,text:file.text,originalText:file.initialText,
         originalBytes:file.originalBytes}
      : {path:file.path,bytes:file.originalBytes});
}
