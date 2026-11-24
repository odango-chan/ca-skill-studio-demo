// Browser-local Interface ZIP picker. Theia's native showOpenDialog selects
// workspace files, whereas this HTML File API picker chooses a user's device
// file without server upload, GitHub CORS, or an unpinned network fallback.
import {decodeBase64} from './dependency-snapshot.mjs';

export const MAX_BROWSER_INTERFACE_ZIP_BYTES=24*1024*1024;
const CHUNK=96*1024;
const CLIENT_SCRIPT="(()=>{\n  const api=acquireVsCodeApi();\n  const input=document.getElementById('zip');\n  const status=document.getElementById('status');\n  const CHUNK=96*1024,MAX=24*1024*1024;\n  let file=null,position=0,busy=false;\n  function toBase64(bytes){\n    let string='';\n    for(let i=0;i<bytes.length;i+=8192)\n      string+=String.fromCharCode(...bytes.subarray(i,i+8192));\n    return btoa(string);\n  }\n  async function sendNext(){\n    if(!busy||!file)return;\n    if(position===file.size){\n      api.postMessage({type:'done'});\n      status.textContent='Verifying ZIP…';\n      return;\n    }\n    try{\n      const part=new Uint8Array(await file.slice(position,\n        Math.min(file.size,position+CHUNK)).arrayBuffer());\n      api.postMessage({type:'chunk',offset:position,base64:toBase64(part)});\n    }catch(error){\n      status.textContent='Read failed: '+String(error?.message??error);\n      api.postMessage({type:'cancel'});\n    }\n  }\n  window.addEventListener('message',event=>{\n    const message=event.data??{};\n    if(message.type==='ack'&&busy){\n      position=message.offset;\n      status.textContent='Importing '+file.name+' · '+position+' / '+file.size+' bytes';\n      void sendNext();\n    }else if(message.type==='error'){\n      busy=false;file=null;position=0;\n      input.disabled=false;input.value='';\n      status.textContent='BLOCKED: '+String(message.message??'invalid ZIP transfer');\n    }\n  });\n  input.addEventListener('change',()=>{\n    const selected=input.files?.[0];\n    if(!selected)return;\n    if(!/\\.zip$/i.test(selected.name)||selected.size<22||selected.size>MAX){\n      status.textContent='BLOCKED: choose a ZIP of at most 24 MiB.';\n      input.value='';return;\n    }\n    file=selected;position=0;busy=true;input.disabled=true;\n    status.textContent='Reading '+file.name+'…';\n    api.postMessage({type:'start',name:file.name,size:file.size});\n  });\n  document.getElementById('cancel').addEventListener('click',()=>{\n    api.postMessage({type:'cancel'});\n  });\n})();";
function webviewHtml(nonce){
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="'+
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"';"+'">'+
    '<style>body{font:14px system-ui,sans-serif;margin:28px;color:var(--vscode-foreground)}'+
    'p{line-height:1.55}button,input{font:inherit;padding:8px}'+
    '#status{min-height:28px;white-space:pre-wrap;margin-top:14px}'+
    '</style></head><body>'+
    '<h2>Import Interface Package ZIP</h2>'+
    '<p>Select an independently published Interface Package ZIP from this device. '+
    'Studio validates its manifest and SHA-256 files before an explicit lock confirmation. '+
    'Authored YAML Schema files are never rewritten.</p>'+
    '<input id="zip" aria-label="Choose Interface Package ZIP" type="file" accept=".zip,application/zip">'+
    '<p>Maximum file size: 24 MiB. Only one ZIP is imported.</p>'+
    '<button id="cancel">Cancel</button><div id="status" role="status" aria-live="polite"></div>'+
    '<script nonce="'+nonce+'">'+CLIENT_SCRIPT+'</script></body></html>';
}
export async function pickBrowserInterfaceZip(vscode){
  if(typeof vscode?.window?.createWebviewPanel!=='function')return undefined;
  const entropy=crypto.getRandomValues(new Uint8Array(16));
  const nonce=[...entropy].map(x=>x.toString(16).padStart(2,'0')).join('');
  const panel=vscode.window.createWebviewPanel(
    'skillStudio.interfacePackageUpload','Import Interface Package ZIP',
    vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:false}
  );
  panel.webview.html=webviewHtml(nonce);
  return new Promise(resolve=>{
    let done=false,buffer=null,expected=0,received=0,filename='';
    let subscription,disposeSubscription;
    const settle=result=>{
      if(done)return;
      done=true;
      subscription?.dispose();
      disposeSubscription?.dispose();
      try{panel.dispose();}catch{}
      resolve(result);
    };
    const blocked=message=>{
      buffer=null;expected=0;received=0;filename='';
      void panel.webview.postMessage({type:'error',message});
    };
    subscription=panel.webview.onDidReceiveMessage(message=>{
      try{
        if(done||!message||typeof message!=='object')return;
        if(message.type==='cancel'){settle(null);return;}
        if(message.type==='start'){
          if(buffer)throw Error('overlapping upload sessions');
          if(typeof message.name!=='string'||!/\.zip$/i.test(message.name)||
             message.name.length>240||!Number.isSafeInteger(message.size)||
             message.size<22||message.size>MAX_BROWSER_INTERFACE_ZIP_BYTES)
            throw Error('invalid ZIP name or size');
          filename=message.name;expected=message.size;
          buffer=new Uint8Array(expected);received=0;
          void panel.webview.postMessage({type:'ack',offset:0});
          return;
        }
        if(message.type==='chunk'){
          if(!buffer||!Number.isSafeInteger(message.offset)||
             message.offset!==received||typeof message.base64!=='string')
            throw Error('out-of-order or unexpected upload chunk');
          if(message.base64.length>CHUNK*4/3+8)
            throw Error('chunk transfer exceeds bound');
          const bytes=decodeBase64(message.base64);
          if(!bytes.length||bytes.length>CHUNK||received+bytes.length>expected)
            throw Error('chunk bytes exceed declared size');
          buffer.set(bytes,received);received+=bytes.length;
          void panel.webview.postMessage({type:'ack',offset:received});
          return;
        }
        if(message.type==='done'){
          if(!buffer||received!==expected)throw Error('incomplete ZIP upload');
          settle({name:filename,bytes:buffer});return;
        }
        throw Error('unknown ZIP transfer message');
      }catch(error){
        blocked(String(error?.message??error));
      }
    });
    disposeSubscription=panel.onDidDispose(()=>settle(null));
  });
}
