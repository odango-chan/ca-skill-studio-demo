// Markdown rendering belongs to the right-side Preview Host, never an EditorGroup.
// The pinned VS Code Markdown extension still owns native Source language support.
import {renderStudioMarkdown} from "./markdown-preview-renderer.mjs";
import {prepareNativeMarkdownPackagePolicy,resolveNativeMarkdownPackageLink} from "./markdown-link-policy.mjs";
import {revealNativeSourceLine} from "./native-source.mjs";
import {staticPreviewResourceUrl} from "./webview-resource-url.mjs";

const esc=value=>String(value).replace(/[&<>"']/g,ch=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[ch]));
function nonce(){
  if(!globalThis.crypto?.getRandomValues)throw Error("Secure randomness unavailable");
  const bytes=new Uint8Array(20);globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join("");
}

function markdownViewHtml(webview,style,sessionKey){
  const csp="default-src 'none'; img-src 'none'; connect-src 'none'; "+
    "media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; "+
    "script-src 'nonce-"+sessionKey+"'; style-src 'nonce-"+sessionKey+"' "+webview.cspSource+";";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${esc(style)}">
    <style nonce="${sessionKey}">.studio-markdown-block{display:flow-root}
    .studio-markdown-image-disabled{opacity:.65}
    [data-studio-href]{cursor:pointer}
    [data-studio-href]:focus-visible{outline:2px solid currentColor}
    #studio-status{font:11px system-ui;opacity:.65;margin-bottom:8px}
    </style></head>
    <body><div id="studio-status" role="status">Loading Markdown preview…</div>
    <main id="studio-content"></main>
    <script nonce="${sessionKey}">
    (() => {
      const api=acquireVsCodeApi(),key="${sessionKey}";
      const content=document.getElementById("studio-content");
      const status=document.getElementById("studio-status");
      let uri=null,version=-1,lastHostScroll=0,lastPreviewSent=0,scrollFrame=0;
      const blocks=()=>Array.from(content.querySelectorAll("[data-source-line]"));
      const blockAt=(line)=>{
        let candidate=null;
        for(const el of blocks()){
          const n=Number(el.dataset.sourceLine);
          if(n>line)break;
          candidate=el;
        }
        return candidate;
      };
      const firstVisible=()=>{
        let current=1;
        for(const el of blocks()){
          if(el.getBoundingClientRect().top>68)break;
          current=Number(el.dataset.sourceLine)||current;
        }
        return current;
      };
      const scrollToLine=line=>{
        const anchor=blockAt(line);
        if(!anchor)return;
        lastHostScroll=Date.now();
        window.scrollTo({top:window.scrollY+anchor.getBoundingClientRect().top-24,behavior:"instant"});
      };
      const scrollFragment=fragment=>{
        let slug;
        try{slug=decodeURIComponent(fragment).toLowerCase();}catch{return;}
        const headings=content.querySelectorAll("h1,h2,h3,h4,h5,h6");
        for(const heading of headings){
          const candidate=(heading.textContent||"").trim().toLowerCase()
            .replace(/[^\\p{L}\\p{N} -]/gu,"").replace(/ +/g,"-");
          if(candidate===slug){
            lastHostScroll=Date.now();
            heading.scrollIntoView({block:"start",behavior:"instant"});
            return;
          }
        }
      };
      window.addEventListener("message",event=>{
        const data=event.data;
        if(!data||data.sessionKey!==key)return;
        if(data.type==="snapshot"){
          if(uri!==null&&uri!==data.uri)return;
          if(data.version<version)return;
          const priorLine=firstVisible();
          uri=data.uri;version=data.version;
          content.innerHTML=data.html;
          status.textContent=data.warning||"";
          if(data.sourceLine>0)scrollToLine(data.sourceLine);
          else if(priorLine>1)scrollToLine(priorLine);
        }else if(data.type==="sourceScroll"&&uri===data.uri&&version===data.version){
          scrollToLine(data.line);
        }else if(data.type==="fragment"&&uri===data.uri){
          scrollFragment(data.fragment);
        }else if(data.type==="error"&&uri===data.uri){
          status.textContent=data.message;
        }
      });
      const activate=element=>{
        const raw=element?.closest?.("[data-studio-href]")?.dataset?.studioHref;
        if(!raw||uri===null)return false;
        if(raw.startsWith("#"))scrollFragment(raw.slice(1));
        else api.postMessage({type:"link",sessionKey:key,uri,version,href:raw});
        return true;
      };
      document.addEventListener("click",event=>{
        if(activate(event.target))event.preventDefault();
      });
      document.addEventListener("keydown",event=>{
        if((event.key==="Enter"||event.key===" ")&&activate(event.target))
          event.preventDefault();
      });
      window.addEventListener("scroll",()=>{
        if(Date.now()-lastHostScroll<450||!uri||version<0)return;
        if(scrollFrame)cancelAnimationFrame(scrollFrame);
        scrollFrame=requestAnimationFrame(()=>{
          scrollFrame=0;
          const line=firstVisible(),now=Date.now();
          if(now-lastPreviewSent<80)return;
          lastPreviewSent=now;
          api.postMessage({type:"previewScroll",sessionKey:key,uri,version,line});
        });
      },{passive:true});
      api.postMessage({type:"ready",sessionKey:key});
    })();
    </script></body></html>`;
}

/**
 * Shared WebviewView mount. A stale session cannot navigate a newer source,
 * and the sole native TextDocument remains the write/undo authority.
 */
export function mountMarkdownPreview(vscode,context,document,panel,{isCurrent=()=>true}={}){
  const webview=panel.webview,media=vscode.Uri.joinPath(context.extensionUri,"media");
  const sessionKey=nonce(),uri=document.uri.toString();
  const css=staticPreviewResourceUrl(
    webview.asWebviewUri(vscode.Uri.joinPath(media,"native-markdown-preview.css")),
    context.extensionUri);
  webview.options={enableScripts:true,localResourceRoots:[media]};
  webview.html=markdownViewHtml(webview,css,sessionKey);
  let disposed=false,ready=false,ticket=0,policyReady=false,blocked=false;
  const stillCurrent=()=>!disposed&&isCurrent()&&
    document.uri.toString()===uri;

  const send=message=>{
    if(stillCurrent())void webview.postMessage({...message,sessionKey,uri});
  };
  const push=async()=>{
    if(!ready||!stillCurrent())return;
    const n=++ticket,version=document.version,source=document.getText();
    try{
      const readyPolicy=await prepareNativeMarkdownPackagePolicy(vscode,document.uri);
      if(!stillCurrent()||n!==ticket||document.version!==version)return;
      policyReady=readyPolicy;blocked=!readyPolicy;
      const result=renderStudioMarkdown(source);
      send({type:"snapshot",version,html:result.html,sourceLine:0,
        warning:blocked?"Package inventory unavailable: preview links disabled.":""});
    }catch(error){
      if(!stillCurrent()||n!==ticket)return;
      send({type:"error",message:"Markdown preview unavailable: "+String(error?.message??error)});
    }
  };
  const changed=vscode.workspace.onDidChangeTextDocument(event=>{
    if(event.document.uri.toString()===uri)void push();
  });
  const visible=vscode.window.onDidChangeTextEditorVisibleRanges?.(event=>{
    if(!stillCurrent()||!ready||event.textEditor?.document?.uri?.toString()!==uri)return;
    const line=(event.visibleRanges?.[0]?.start?.line??0)+1;
    if(Number.isSafeInteger(line))send({type:"sourceScroll",version:document.version,line});
  });
  const incoming=webview.onDidReceiveMessage(async message=>{
    if(!stillCurrent()||!message||message.sessionKey!==sessionKey||message.uri&&message.uri!==uri)
      return;
    if(message.type==="ready"){ready=true;await push();return;}
    if(message.version!==document.version)return;
    if(message.type==="previewScroll"){
      const line=message.line;
      if(!Number.isSafeInteger(line)||line<1||line>document.lineCount)return;
      const editor=(vscode.window.visibleTextEditors??[]).find(e=>e.document.uri.toString()===uri);
      if(editor){
        const position=new vscode.Position(line-1,0);
        editor.revealRange(new vscode.Range(position,position),
          vscode.TextEditorRevealType.AtTop);
      }
      return;
    }
    if(message.type!=="link"||typeof message.href!=="string")return;
    const target=policyReady&&!blocked
      ?resolveNativeMarkdownPackageLink(document.uri,message.href):null;
    if(!target){
      send({type:"error",message:"Blocked unverified Package link."});
      return;
    }
    try{
      if(target.kind==="external"){
        await vscode.env.openExternal(vscode.Uri.parse(target.href));
      }else if(target.kind==="fragment"){
        send({type:"fragment",fragment:target.fragment});
      }else if(target.kind==="package"){
        await revealNativeSourceLine(vscode,document.uri.with({path:target.path}),1);
      }
    }catch(error){send({type:"error",message:String(error?.message??error)});}
  });
  let panelRelease=null;
  const cleanup=()=>{
    if(disposed)return;
    disposed=true;ticket++;
    changed.dispose();visible?.dispose?.();incoming.dispose();
    panelRelease?.dispose?.();
  };
  panelRelease=panel.onDidDispose(cleanup);
  return {dispose:cleanup};
}
