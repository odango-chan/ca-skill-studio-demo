// Runs against actual Theia DOM and CustomEditor frames, never a host mock.
export async function runWorkbenchAcceptance({command,evalJS,sleep,requireEditor}){
  if(!requireEditor)return {required:false};
  const click=async(x,y,count=1)=>{
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await sleep(100);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:count});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:count});
  };
  // Use the real native command registry for setup/actions. Explorer gestures
  // below remain actual Chromium input; no host or TextDocument is mocked.
  async function invoke(id,...args){
    console.log("STUDIO_NATIVE_ACTION",id);
    try{await evalJS(`(async()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.registerCommand&&k.prototype?.getCommand);if(!key)throw Error('Native command registry missing');const registry=c.get(key),id=${JSON.stringify(id)};if(id==="navigator.reveal"){const openerKey=[...c._bindingDictionary._map.keys()].find(k=>String(k)==="Symbol(OpenerService)");const openers=await c.get(openerKey).getOpeners();const custom=openers.find(x=>x.id==="custom-editor-skillStudio.procedurePreview");const resource=custom?.widgetManager.getWidgets("plugin-custom-editor").find(w=>w.resource?.path.toString().endsWith("/assurance/procedure.yaml"))?.resource;if(!resource)throw Error("Procedure native resource missing");await registry.executeCommand(id,resource);}else await registry.executeCommand(id,...${JSON.stringify(args)});})()`);}
    catch(error){throw Error("Native command "+id+": "+error.message);}
    await sleep(300);
  }
  async function startNativeCommand(id,...args){
    console.log("STUDIO_NATIVE_ACTION",id);
    await evalJS(`(()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.registerCommand&&k.prototype?.getCommand);if(!key)throw Error('Native command registry missing');const registry=c.get(key);window.__skillStudioPendingCommand=registry.executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)});return true;})()`);
  }
  async function confirmNativePreview(){
    let target=null;
    for(let i=0;i<40&&!target;i++){
      target=await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='确认并应用'&&x.getBoundingClientRect().width>0);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,text:document.body.innerText}:null;})()`);
      if(!target)await sleep(100);
    }
    if(!target)throw Error('Native Inspector Diff confirmation dialog did not appear');
    if(!target.text.includes('call: sbi.udm.sm_data.get')||!target.text.includes('sbi.udm.sm_data.get.preview'))
      throw Error('Native Inspector confirmation did not show the expected Source Diff');
    await click(target.x,target.y);await sleep(250);
    await evalJS(`(async()=>{window.__skillStudioCommandResult=await window.__skillStudioPendingCommand;window.__skillStudioPendingCommand=null;return true})()`);
  }
  await invoke('skillStudio.refreshInspection');
  const activity=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')].find(x=>x.textContent.trim()==='Skill Studio'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&x.getBoundingClientRect().y<innerHeight);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!activity)throw Error('Native Skill Studio Activity Bar entry missing');
  await click(activity.x,activity.y);await sleep(500);
  const views=await evalJS(`({text:document.body.innerText,trees:document.querySelectorAll('.theia-Tree').length})`);
  for(const name of ['Inspection','Outline','Evidence','Problems'])if(!views.text.toLowerCase().includes(name.toLowerCase()))throw Error('Native view missing: '+name);
  const problemsHeader=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-view-container-part-header')].find(x=>x.textContent.trim().toLowerCase()==='problems'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.closest('.part')?.classList.contains('collapsed'));const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(problemsHeader){await click(problemsHeader.x,problemsHeader.y);await sleep(200);}
  await invoke('skillStudio.auditPackage');
  const audit=await evalJS(`document.body.innerText`);
  if(!/Package Audit · \d+ editor warnings/.test(audit))throw Error('Package Audit did not run: '+audit.slice(-1000));
  // Re-open through Explorer rather than extension openWith command.
  await invoke('navigator.reveal');
  await invoke('core.saveAll');
  await invoke('core.close.all.main.tabs');
  await invoke('workbench.files.action.focusFilesExplorer');
  let file=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='procedure.yaml'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&x.getBoundingClientRect().y<innerHeight);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
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
  // Exercise a real native Inspector edit. The command is invoked through
  // Theia's command registry, presents a native Diff confirmation, and writes
  // through the host TextDocument/WorkspaceEdit rather than the Webview.
  const selectionResult=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='nudm-sdm-get');if(!node)throw Error('Expected Node is not in the current graph');node.click();return {node:node.getAttribute('data-id'),procedure:document.querySelector('#procedureList')?.value,revision:document.querySelector('#revision')?.textContent};})()`
  });
  if(!selectionResult.result?.value?.node)throw Error('Could not select Node for native Inspector editing');
  await sleep(250);
  const beforeEdit=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const sourceVersion=Number(/v(\\d+)/.exec(beforeEdit.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(sourceVersion))throw Error('Could not read native Source version');
  await startNativeCommand('skillStudio.editNodeOperatorValue',{
    procedureId:selectionResult.result.value.procedure,nodeId:'nudm-sdm-get',sourceVersion
  },'sbi.udm.sm_data.get.preview');
  await confirmNativePreview();
  const afterEdit=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const editResult=await evalJS(`window.__skillStudioCommandResult`);
  if(editResult!==true||!afterEdit.result?.value||afterEdit.result.value===beforeEdit.result?.value)
    throw Error('Native Inspector edit did not commit a Source revision: '+JSON.stringify({editResult,before:beforeEdit.result?.value,after:afterEdit.result?.value}));
  await invoke('core.undo');
  const afterUndo=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  if(!afterUndo.result?.value||afterUndo.result.value===afterEdit.result?.value)
    throw Error('Native Inspector edit did not round-trip through native Undo: '+JSON.stringify({after:afterEdit.result?.value,undo:afterUndo.result?.value}));
  console.log('STUDIO_INSPECTOR_AUTHORING_CHROMIUM',JSON.stringify({
    node:selectionResult.result.value.node,procedure:selectionResult.result.value.procedure,
    before:beforeEdit.result?.value,after:afterEdit.result?.value,undo:afterUndo.result?.value
  }));
  // Safe Markdown uses the actual native source document and shared renderer.
  const markdownFile=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='SKILL.md'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&x.getBoundingClientRect().y<innerHeight);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!markdownFile)throw Error('SKILL.md missing from native Explorer');
  await click(markdownFile.x,markdownFile.y,2);await sleep(400);
  await invoke('skillStudio.previewMarkdown');
  const tree=await command('Page.getFrameTree');let markdown=false;
  async function inspect(n){
    try{const w=await command('Page.createIsolatedWorld',{frameId:n.frame.id,worldName:'markdown-acceptance',grantUniveralAccess:true});
      const r=await command('Runtime.evaluate',{contextId:w.executionContextId,returnByValue:true,expression:`Boolean(document.querySelector('article h1')&&!document.querySelector('article script,article img'))`});
      markdown ||= r.result?.value===true;
    }catch{}
    for(const c of n.childFrames??[])await inspect(c);
  }
  await inspect(tree.frameTree);if(!markdown)throw Error('Shared safe Markdown Preview did not render');
  // Native layout restoration must retain the CustomEditor across a reload.
  console.log("STUDIO_NATIVE_ACTION","reload");
  await sleep(1200);await command('Page.reload');await sleep(800);
  let restored=null;
  for(let i=0;i<120&&!restored;i++){
    const tab=await evalJS(`(()=>{const el=[...document.querySelectorAll('.lm-TabBar-tab')].find(x=>x.textContent.trim()==='procedure.yaml'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().y<innerHeight);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
    if(tab){await click(tab.x,tab.y);restored=await graph();}
    if(!restored)await sleep(150);
  }
  if(!restored)throw Error('Native workspace restore lost the Procedure CustomEditor');
  console.log('STUDIO_LAYOUT_TIMING',JSON.stringify({initialTiming,warmTiming}));
  console.log('STUDIO_WORKBENCH_CHROMIUM' ,JSON.stringify({views:true,packageAudit:true,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs}));
  return {views:true,packageAudit:true,markdown:true,restored,initialTiming,warmTiming,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs};
}
