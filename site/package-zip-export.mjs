import {importDirectoryFiles,packageZipEntries} from "./directory-import.mjs";
import {zipPackage} from "./zip.mjs";

// Export the same bounded Package model as the Classic Studio. This adapter
// accepts a complete immutable byte snapshot and optional unsaved TextDocument
// contents; it never reads from or writes to a host filesystem itself.
export async function buildPackageZip({name,files,currentTextByPath=new Map()}){
  if(!(currentTextByPath instanceof Map))
    throw new Error("Unsaved Package text must be a Map");
  if(!Array.isArray(files)||!files.length||files.length>64)
    throw new Error("Package ZIP file count out of bounds");
  const inputs=files.map(item=>{
    if(!item||typeof item.path!=="string"||!(item.bytes instanceof Uint8Array))
      throw new Error("Invalid Package ZIP snapshot entry");
    const pathParts=item.path.split("/");
    const copy=item.bytes.slice();
    return {
      name:pathParts.at(-1),
      size:copy.byteLength,
      webkitRelativePath:name+"/"+item.path,
      arrayBuffer:async()=>copy.buffer.slice(copy.byteOffset,copy.byteOffset+copy.byteLength)
    };
  });
  const {workspace,opaqueCount}=await importDirectoryFiles(inputs);
  for(const [path,text] of currentTextByPath){
    const file=workspace.files.get(path);
    if(!file?.editable||typeof text!=="string")
      throw new Error("Unsaved Source is not an editable Package file: "+path);
    file.text=text;
  }
  const entries=packageZipEntries(workspace);
  const bytes=zipPackage(entries);
  return {filename:name+".zip",bytes,fileCount:entries.length,opaqueCount};
}

// Use a bounded, dependency-free encoder for the extension-host → Webview
// message. The Webview owns the actual browser download gesture.
export function bytesToBase64(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length>12*1024*1024)
    throw new Error("Package ZIP message payload is out of bounds");
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chunks=[];
  const chunkBytes=3*8192;
  for(let start=0;start<bytes.length;start+=chunkBytes){
    const end=Math.min(bytes.length,start+chunkBytes);
    let out="";
    for(let i=start;i<end;i+=3){
      const a=bytes[i],hasB=i+1<end,hasC=i+2<end;
      const b=hasB?bytes[i+1]:0,c=hasC?bytes[i+2]:0;
      const n=(a<<16)|(b<<8)|c;
      out+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+
        (hasB?alphabet[(n>>>6)&63]:"=")+(hasC?alphabet[n&63]:"=");
    }
    chunks.push(out);
  }
  return chunks.join("");
}
