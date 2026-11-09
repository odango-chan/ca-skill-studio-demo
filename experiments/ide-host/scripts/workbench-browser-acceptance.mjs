// Runs against actual Theia DOM and CustomEditor frames, never a host mock.
export async function runWorkbenchAcceptance({command,evalJS,sleep,requireEditor}){
  if(!requireEditor)return {required:false};
  const click=async(x,y,count=1)=>{
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:count});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:count});
  };
  async function palette(text){
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'F1',code:'F1',windowsVirtualKeyCode:112});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'F1',code:'F1',windowsVirtualKeyCode:112});
    await sleep(200);await command('Input.insertText',{text});await sleep(350);
    const pos=await evalJS(`(()=>{const el=[...document.querySelectorAll('.monaco-list-row')].find(x=>x.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
    if(!pos)throw Error('Command missing: '+text);await click(pos.x,pos.y);await sleep(500);
  }
  await palette('Skill Studio: Refresh Inspection');
  const activity=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-app-sides [title],.theia-app-sides [aria-label]')].find(x=>(x.title+' '+x.getAttribute('aria-label')).includes('Skill Studio'));const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!activity)throw Error('Native Skill Studio Activity Bar entry missing');
  await click(activity.x,activity.y);await sleep(500);
  const views=await evalJS(`({text:document.body.innerText,trees:document.querySelectorAll('.theia-Tree').length})`);
  for(const name of ['Inspection','Outline','Evidence','Problems'])if(!views.text.toLowerCase().includes(name.toLowerCase()))throw Error('Native view missing: '+name);
  await palette('Skill Studio: Audit Current Package');
  const audit=await evalJS(`document.body.innerText`);
  if(audit.includes('Audit unavailable'))throw Error('Package Audit did not run: '+audit.slice(-1000));
  // Re-open through Explorer rather than extension openWith command.
  await palette('Close All Editors');
  await palette('View: Show Explorer');
  let file=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='procedure.yaml');const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!file)throw Error('Procedure file not available in native Explorer');
  const start=performance.now();await click(file.x,file.y);await sleep(800);
  let graphContext;
  async function graph(){
    const tree=await command('Page.getFrameTree'),frames=[];
    const walk=n=>{frames.push(n.frame);for(const c of n.childFrames??[])walk(c);};walk(tree.frameTree);
    for(const f of frames.filter(f=>f.url.includes('/webview/index.html')||f.url.includes('.webview.'))){
      try{const world=await command('Page.createIsolatedWorld',{frameId:f.id,worldName:'workbench-native-open',grantUniveralAccess:true});
        graphContext=world.executionContextId;
        const result=await command('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,expression:`({nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,revision:document.querySelector('#revision')?.textContent,timing:document.querySelector('#reactFlowRoot')?.dataset.studioTiming})`});
        if(result.result?.value?.nodes>0)return result.result.value;
      }catch{}
    }
    return null;
  }
  let opened=null;
  for(let i=0;i<100&&!opened;i++){opened=await graph();if(!opened)await sleep(100);}
  if(!opened)throw Error('Explorer single-click did not open native associated CustomEditor');
  const openMs=performance.now()-start;
  const preview=await evalJS(`Boolean([...document.querySelectorAll(".theia-editor-preview-title-unpinned")].find(el=>el.textContent.includes("procedure.yaml")))`);
  if(!preview)throw Error("Single-click CustomEditor was not a native preview tab");
  await click(file.x,file.y,2);await sleep(250);
  const stillPreview=await evalJS(`Boolean([...document.querySelectorAll(".theia-editor-preview-title-unpinned")].find(el=>el.textContent.includes("procedure.yaml")))`);
  if(stillPreview)throw Error("Double-click did not pin native preview tab");
  const pinned=await graph();if(!pinned)throw Error('Explorer double-click lost CustomEditor');
  const initialTiming=JSON.parse(pinned.timing??'null');
  await command('Runtime.evaluate',{contextId:graphContext,expression:`(()=>{const s=document.querySelector('#procedureList');window.__acceptanceProcedure=s.value;s.selectedIndex=1;s.dispatchEvent(new Event('change'));})()`});
  await sleep(500);
  await command('Runtime.evaluate',{contextId:graphContext,expression:`(()=>{const s=document.querySelector('#procedureList');s.value=window.__acceptanceProcedure;s.dispatchEvent(new Event('change'));})()`});
  await sleep(500);
  const warm=await graph(),warmTiming=JSON.parse(warm?.timing??'null');
  if(!initialTiming||!warmTiming?.cacheHit)throw Error('Version-scoped warm layout cache was not exercised: '+JSON.stringify({initialTiming,warmTiming}));
  // Safe Markdown uses the actual native source document and shared renderer.
  const markdownFile=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='SKILL.md');const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!markdownFile)throw Error('SKILL.md missing from native Explorer');
  await click(markdownFile.x,markdownFile.y,2);await sleep(400);
  await palette('Skill Studio: Preview Markdown');
  const tree=await command('Page.getFrameTree');let markdown=false;
  async function inspect(n){
    try{const w=await command('Page.createIsolatedWorld',{frameId:n.frame.id,worldName:'markdown-acceptance',grantUniveralAccess:true});
      const r=await command('Runtime.evaluate',{contextId:w.executionContextId,returnByValue:true,expression:`Boolean(document.querySelector('article h1')&&!document.querySelector('article script,article img'))`});
      markdown ||= r.result?.value===true;
    }catch{}
    for(const c of n.childFrames??[])await inspect(c);
  }
  await inspect(tree.frameTree);if(!markdown)throw Error('Shared safe Markdown Preview did not render');
  console.log('STUDIO_LAYOUT_TIMING',JSON.stringify({initialTiming,warmTiming}));
  console.log('STUDIO_WORKBENCH_CHROMIUM' ,JSON.stringify({views:true,packageAudit:true,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs}));
  return {views:true,packageAudit:true,markdown:true,initialTiming,warmTiming,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs};
}
