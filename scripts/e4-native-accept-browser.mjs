// Browser half of the E4-A2 *native OS picker* acceptance. It imports
// Studio's own E4-A1/E4-A2 modules; no mocked handle or OPFS is used here.
// Writes are impossible until the nonce-bearing disposable fixture is matched.
import {importDirectoryFiles} from "/site/directory-import.mjs";
import {saveDirectoryChanges} from "/site/directory-save.mjs";
import {markFileEdited,hasUnsavedEdits} from "/site/sample-packages.mjs";

const spec=await (await fetch("/spec",{cache:"no-store"})).json();
const enc=new TextEncoder(),dec=new TextDecoder();
const expected=new Map(Object.entries(spec.files).map(([path,b64])=>
  [path,Uint8Array.from(atob(b64),c=>c.charCodeAt(0))]));
const start=document.querySelector("#start");
const state=document.querySelector("#state");
const log=document.querySelector("#log");
function show(s){state.textContent=s;log.textContent+=s+"\n";}
function requireCheck(condition,label){if(!condition)throw Error(label);}
function bytesEqual(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
async function getHandle(root,path){
  const pieces=path.split("/"),name=pieces.pop();
  let d=root;
  for(const part of pieces)d=await d.getDirectoryHandle(part,{create:false});
  return d.getFileHandle(name,{create:false});
}
async function readBytes(root,path){
  const f=await (await getHandle(root,path)).getFile();
  return new Uint8Array(await f.arrayBuffer());
}
async function writeExisting(root,path,bytes){
  const h=await getHandle(root,path);
  const writer=await h.createWritable({keepExistingData:false});
  try{
    await writer.write(bytes);
    await writer.truncate(bytes.length);
    await writer.close();
  }catch(error){try{await writer.abort();}catch{}throw error;}
}
async function listFiles(root){
  const files=[];
  async function walk(d,prefix=""){
    for await(const [name,item] of d.entries()){
      const p=prefix+name;
      if(item.kind==="directory")await walk(item,p+"/");
      else if(item.kind==="file")files.push(p);
      else throw Error("Unsupported entry: "+p);
    }
  }
  await walk(root);
  return files.sort();
}
async function verifyInitial(root){
  requireCheck(root?.kind==="directory"&&root.name===spec.name,
    "Selected folder name is not the disposable fixture");
  const marker=await readBytes(root,".e4-test-token");
  requireCheck(bytesEqual(marker,enc.encode(spec.token)),
    "Fixture nonce mismatch: refusing writes to this folder");
  const actual=await listFiles(root);
  requireCheck(JSON.stringify(actual)===JSON.stringify([...expected.keys()].sort()),
    "Selected folder contains missing or additional files");
  for(const [p,bytes] of expected){
    requireCheck(bytesEqual(await readBytes(root,p),bytes),
      "Fixture before-image mismatch: "+p);
  }
}
async function postReport(report){
  const response=await fetch("/report",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({token:spec.token,...report})
  });
  return response.json();
}
start.addEventListener("click",async()=>{
  start.disabled=true;
  const checks=[];
  const pass=k=>{checks.push(k);show("PASS "+k);};
  try{
    requireCheck(window.isSecureContext&&typeof window.showDirectoryPicker==="function",
      "This Chrome does not expose a secure-context directory picker");
    show("请在弹出的窗口中只选择脚本新建的测试目录；不要选择真实 SKILL。");
    // MUST be the first awaited operation from this trusted click gesture.
    const root=await window.showDirectoryPicker({mode:"readwrite"});
    await verifyInitial(root);
    pass("DISPOSABLE_NONCE_AND_ALL_ORIGINAL_BYTES");
    requireCheck(await root.queryPermission({mode:"readwrite"})==="granted",
      "Native readwrite permission was not granted");
    pass("NATIVE_READWRITE_PERMISSION");

    // FileList-shaped E4-A1 import from *actual OS files* (not synthetic data).
    // The explicit directory chooser above is the only OS folder selection.
    const fileList=[];
    for(const path of expected.keys()){
      const file=await (await getHandle(root,path)).getFile();
      fileList.push({webkitRelativePath:spec.name+"/"+path,
        name:file.name,size:file.size,arrayBuffer:()=>file.arrayBuffer()});
    }
    const {workspace}=await importDirectoryFiles(fileList);
    requireCheck(workspace.files.size===expected.size,
      "E4-A1 import omitted a file");
    pass("REAL_DISK_E4_A1_IMPORT");

    const prevSkill=workspace.files.get("SKILL.md").text;
    const editedSkill=prevSkill+"# Saved on disk\r\n";
    const editedPython="pass\n";
    markFileEdited(workspace,"SKILL.md",editedSkill);
    markFileEdited(workspace,"scripts/check.py",editedPython);
    const before=expected.get("SKILL.md");
    requireCheck(bytesEqual(enc.encode(prevSkill),before),
      "Original BOM was changed by import");
    const filesForConsent=["SKILL.md","scripts/check.py"];
    const save=await saveDirectoryChanges({
      workspace,handle:root,confirmWrite:({directory,paths})=>
        directory===spec.name&&JSON.stringify([...paths].sort())===
        JSON.stringify([...filesForConsent].sort())&&window.confirm(
          "只写入脚本生成且随机标记已验证的测试目录："+
          directory+"\n变更文件："+paths.join("、")+
          "\n本次是真实 Windows Chrome 文件写入；确认？")
    });
    requireCheck(save.status==="SAVED"&&save.saved.length===2,
      "Native save was not verified: "+JSON.stringify(save));
    requireCheck(bytesEqual(await readBytes(root,"SKILL.md"),enc.encode(editedSkill)),
      "Native SKILL.md bytes mismatch");
    requireCheck(bytesEqual(await readBytes(root,"scripts/check.py"),enc.encode(editedPython)),
      "Shorter native Python file retained an old tail");
    requireCheck(!hasUnsavedEdits(workspace),
      "Editor baseline not committed after verified writes");
    pass("NATIVE_WRITE_READBACK_BOM_CRLF_AND_SHORTENING");

    for(const p of [".e4-test-token","references/note.md","assets/opaque.bin"]){
      requireCheck(bytesEqual(await readBytes(root,p),expected.get(p)),
        "Unchanged or opaque file mutated: "+p);
    }
    pass("UNTOUCHED_AND_BINARY_BYTES");

    // Emulate an external editor changing an untouched reference file.
    const refPath="references/note.md";
    await writeExisting(root,refPath,enc.encode("# EXTERNAL EDIT\r\n"));
    markFileEdited(workspace,"SKILL.md",editedSkill+"# unsaved next\r\n");
    const conflict=await saveDirectoryChanges({
      workspace,handle:root,confirmWrite:async()=>true
    });
    requireCheck(conflict.status==="CONFLICT"&&conflict.saved.length===0,
      "External drift was not refused");
    requireCheck(bytesEqual(await readBytes(root,"SKILL.md"),enc.encode(editedSkill)),
      "External drift caused silent overwrite");
    await writeExisting(root,refPath,expected.get(refPath));
    pass("NATIVE_EXTERNAL_CONTENT_CONFLICT_NO_OVERWRITE");

    // An external added file blocks saving; remove ONLY the file just created.
    const rogue="e4-unexpected.tmp";
    await root.getFileHandle(rogue,{create:true});
    try{
      const added=await saveDirectoryChanges({
        workspace,handle:root,confirmWrite:async()=>true
      });
      requireCheck(added.status==="CONFLICT"&&added.saved.length===0,
        "Added disk entry was not refused");
      requireCheck(bytesEqual(await readBytes(root,"SKILL.md"),enc.encode(editedSkill)),
        "Added file conflict caused overwrite");
    }finally{await root.removeEntry(rogue);}
    pass("NATIVE_ADDED_FILE_CONFLICT_NO_OVERWRITE");
    requireCheck(JSON.stringify(await listFiles(root))===
      JSON.stringify([...expected.keys()].sort()),
      "Acceptance left a sidecar file");
    pass("NO_SIDECAR_FILES");
    const result=await postReport({status:"PASS",checks,chrome:navigator.userAgent});
    requireCheck(result.accepted&&result.diskVerification?.pass,
      "Independent Node disk verification failed");
    show("NATIVE_OS_ACCEPTANCE_PASS · "+result.reportPath);
  }catch(error){
    show("NOT_PASS · "+String(error?.message??error));
    try{
      const report=await postReport({status:"NOT_PASS",checks,
        failure:String(error?.message??error),chrome:navigator.userAgent});
      show("诊断报告："+report.reportPath);
    }catch(e){show("报告提交失败："+String(e));}
  }
});
