// Runs against actual Theia DOM and CustomEditor frames, never a host mock.
import {readFile} from 'node:fs/promises';
const publishedProcedure=await readFile(new URL(
  '../../../site/samples/skills/establish-pdu-session/assurance/procedure.yaml',
  import.meta.url),'utf8');
const pcfOutcomeHeader="          'on':\n            FAILED: finalize-failed\n            UNRESOLVED: finalize-unresolved\n";
const pcfOutcomeStart=publishedProcedure.indexOf(pcfOutcomeHeader);
if(pcfOutcomeStart<0)throw Error('Published PCF Outcome test anchor missing');
const pcfOutcomeLine=publishedProcedure.slice(0,
  pcfOutcomeStart+pcfOutcomeHeader.indexOf('            FAILED:'))
  .split('\n').length;
export async function runWorkbenchAcceptance({command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp=false}){
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
  async function nativeCommand(id,...args){
    return evalJS(`(async()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.registerCommand&&k.prototype?.getCommand);if(!key)throw Error('Native command registry missing');return c.get(key).executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)});})()`);
  }
  async function startNativeCommand(id,...args){
    console.log("STUDIO_NATIVE_ACTION",id);
    await evalJS(`(()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.registerCommand&&k.prototype?.getCommand);if(!key)throw Error('Native command registry missing');const registry=c.get(key);window.__skillStudioCommandState={status:"pending",id:${JSON.stringify(id)}};window.__skillStudioPendingCommand=Promise.resolve(registry.executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)})).then(value=>{window.__skillStudioCommandState={status:"resolved",id:${JSON.stringify(id)},value};return value;},error=>{window.__skillStudioCommandState={status:"rejected",id:${JSON.stringify(id)},error:String(error?.message??error)};throw error;});return true;})()`);
  }
  async function waitForRevisionChange(contextId,previous,label){
    let latest=null,refreshed=null;
    for(let i=0;i<50;i++){
      try{
        latest=await command('Runtime.evaluate',{
          contextId,returnByValue:true,
          expression:`document.querySelector('#revision')?.textContent`
        });
        if(latest.result?.value&&latest.result.value!==previous)return latest;
      }catch{/* the CustomEditor iframe can be replaced by native Undo */}
      try{
        refreshed=await graph();
        if(refreshed?.revision&&refreshed.revision!==previous)
          return {result:{value:refreshed.revision}};
      }catch{/* retry until the replacement frame is ready */}
      await sleep(100);
    }
    throw Error(label+' did not produce a native Source revision within 5s: '+
      JSON.stringify({previous,latest:latest?.result?.value??null,
        refreshed:refreshed?.revision??null}));
  }
  async function confirmNativePreview(oldText,newText,{attempts=40}={}){
    let target=null;
    for(let i=0;i<attempts&&!target;i++){
      target=await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='确认并应用'&&x.getBoundingClientRect().width>0);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,text:document.body.innerText}:null;})()`);
      if(!target)await sleep(100);
    }
    if(!target){
      const state=await evalJS(`({
        command:window.__outcomeCommandState??null,
        lspCommand:window.__skillStudioCommandState??null,
        pending:typeof window.__skillStudioPendingCommand,
        tail:document.body.innerText.slice(-1400),
        visibleButtons:[...document.querySelectorAll('button')]
          .filter(x=>x.getBoundingClientRect().width>0)
          .map(x=>x.textContent?.trim()).filter(Boolean).slice(-12)
      })`);
      throw Error('Native Inspector Diff confirmation dialog did not appear: '+
        JSON.stringify(state));
    }
    if(!target.text.includes(oldText)||!target.text.includes(newText))
      throw Error('Native Inspector confirmation did not show the expected Source Diff: '+target.text.slice(-1200));
    await click(target.x,target.y);await sleep(250);
    await evalJS(`(async()=>{window.__skillStudioCommandResult=await window.__skillStudioPendingCommand;window.__skillStudioPendingCommand=null;return true})()`);
  }
  await invoke('skillStudio.refreshInspection');
  const activity=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')].find(x=>x.textContent.trim()==='Skill Studio'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&x.getBoundingClientRect().y<innerHeight);const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!activity)throw Error('Native Skill Studio Activity Bar entry missing');
  await click(activity.x,activity.y);await sleep(500);
  const views=await evalJS(`({text:document.body.innerText,trees:document.querySelectorAll('.theia-Tree').length})`);
  for(const name of ['Inspection','Outline','Evidence','Problems'])if(!views.text.toLowerCase().includes(name.toLowerCase()))throw Error('Native view missing: '+name);
  const problemsHeader=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-view-container-part-header')].find(x=>x.textContent.trim().toLowerCase()==='problems'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0);el?.scrollIntoView({block:'center'});const r=el?.getBoundingClientRect();const part=el?.closest('.part');const collapsed=el?.getAttribute('aria-expanded')==='false'||/collapsed/.test(part?.className??'');return r?{x:r.x+r.width/2,y:r.y+r.height/2,collapsed}:null;})()`);
  const problemHeaderDiagnostics=await evalJS(`[...document.querySelectorAll('.theia-view-container-part-header')].filter(x=>x.textContent.trim().toLowerCase()==='problems').map(x=>({className:x.className,ariaExpanded:x.getAttribute('aria-expanded'),parent:x.parentElement?.className,part:x.closest('.part')?.className,view:x.closest('.theia-view-container')?.id,rect:(()=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()}))`);
  console.log('STUDIO_PROBLEMS_HEADERS',JSON.stringify(problemHeaderDiagnostics));
  if(problemsHeader?.collapsed){await click(problemsHeader.x,problemsHeader.y);await sleep(250);}
  await invoke('skillStudio.auditPackage');
  let audit='';
  for(let i=0;i<100;i++){
    audit=await evalJS(`document.body.innerText`);
    if(/Package Audit · \d+ editor warnings/.test(audit))break;
    if(/Package Audit · unavailable|Audit unavailable:/.test(audit))
      throw Error('Package Audit reported unavailable: '+audit.slice(-1000));
    await sleep(100);
  }
  if(!/Package Audit · \d+ editor warnings/.test(audit))throw Error('Package Audit did not render within 10s: '+audit.slice(-1000));
  // Re-open through Explorer rather than extension openWith command.
  await invoke('navigator.reveal');
  await invoke('core.saveAll');
  await invoke('core.close.all.main.tabs');
  await invoke('workbench.files.action.focusFilesExplorer');
  let file=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='procedure.yaml'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().x<innerWidth);el?.scrollIntoView({block:'center',inline:'nearest'});const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!file)throw Error('Procedure file not available in native Explorer');
  // Measure the actual Explorer click → CustomEditor render path. Do not
  // insert a fixed sleep before polling; it would dominate the reported time.
  const start=performance.now();await click(file.x,file.y);
  let graphContext;
  async function graph(expectedProcedure=null){
    const tree=await command('Page.getFrameTree'),frames=[];
    const walk=n=>{frames.push(n.frame);for(const c of n.childFrames??[])walk(c);};walk(tree.frameTree);
    for(const f of frames.filter(f=>f.url.includes('/webview/index.html')||f.url.includes('.webview.'))){
      try{const world=await command('Page.createIsolatedWorld',{frameId:f.id,worldName:'workbench-native-open',grantUniveralAccess:true});
        graphContext=world.executionContextId;
        const result=await command('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,expression:`({nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,procedureValue:document.querySelector('#procedureList')?.value??null,bodyText:document.body?.innerText?.slice(0,1600)??'',revision:document.querySelector('#revision')?.textContent,timing:document.querySelector('#reactFlowRoot')?.dataset.studioTiming})`});
        if(result.result?.value?.nodes>0&&(!expectedProcedure||result.result.value.procedureValue===expectedProcedure))return result.result.value;
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
  // The online sample is a two-SKILL workspace. Prove the MAS sibling can be
  // expanded and its own Procedure opened through the native Explorer, then
  // restore the conventional 5GC Procedure for the remaining regression suite.
  await invoke('workbench.files.action.focusFilesExplorer');
  const explorerRow=async(label,which='last')=>evalJS(
    "(()=>{const label="+JSON.stringify(label)+";const rows=[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return {node,content,text:content?.innerText?.trim()??''};}).filter(row=>row.text===label);const row="+(which==='first'?'rows[0]':'rows.at(-1)')+";if(!row)return {found:false,count:rows.length,labels:[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return content?.innerText?.trim()??'';}).slice(-30)};row.content.scrollIntoView({block:'center',inline:'nearest'});const r=row.content.getBoundingClientRect();return {found:true,x:r.x+r.width/2,y:r.y+r.height/2,expanded:row.node.getAttribute('aria-expanded'),className:row.node.className,ariaLevel:row.node.getAttribute('aria-level'),dataNodeId:row.node.getAttribute('data-node-id'),count:rows.length};})()"
  );
  let masFolder=null;
  for(let attempt=0;attempt<60;attempt++){
    masFolder=await explorerRow('establish-pdu-session-mas');
    if(masFolder?.found)break;
    await evalJS("(()=>{for(const root of document.querySelectorAll('.theia-Tree')){let el=root;while(el){if(el.scrollHeight>el.clientHeight+4){el.scrollTop=el.scrollHeight;break;}el=el.parentElement;}}return true;})()");
    await sleep(100);
  }
  if(!masFolder?.found)throw Error('MAS Skill folder missing from native Explorer: '+JSON.stringify(masFolder));
  let assuranceRows=await explorerRow('assurance');
  if((assuranceRows?.count??0)<2){
    await click(masFolder.x,masFolder.y);
    for(let attempt=0;attempt<60;attempt++){
      assuranceRows=await explorerRow('assurance');
      if((assuranceRows?.count??0)>=2)break;
      await sleep(100);
    }
  }
  if((assuranceRows?.count??0)<2)throw Error('MAS assurance folder did not expand in native Explorer: '+JSON.stringify({masFolder,assuranceRows}));
  let procedureRows=await explorerRow('procedure.yaml');
  if((procedureRows?.count??0)<2){
    const masAssurance=await explorerRow('assurance','last');
    if(!masAssurance?.found)throw Error('MAS assurance row missing after folder expansion');
    await click(masAssurance.x,masAssurance.y);
    for(let attempt=0;attempt<60;attempt++){
      procedureRows=await explorerRow('procedure.yaml');
      if((procedureRows?.count??0)>=2)break;
      await sleep(100);
    }
  }
  if((procedureRows?.count??0)<2)throw Error('Explorer did not expose both Skill procedure.yaml files: '+JSON.stringify(procedureRows));
  const masProcedure=await explorerRow('procedure.yaml','last');
  if(!masProcedure?.found)throw Error('MAS procedure.yaml row missing from Explorer');
  await click(masProcedure.x,masProcedure.y);
  let masProcedureGraph=null;
  for(let attempt=0;attempt<100;attempt++){
    masProcedureGraph=await graph('establish-session');
    if(masProcedureGraph)break;
    await sleep(100);
  }
  const masResourcePaths=await evalJS("(async()=>{const c=window.theia.container;const openerKey=[...c._bindingDictionary._map.keys()].find(k=>String(k)==='Symbol(OpenerService)');const openers=await c.get(openerKey).getOpeners();const custom=openers.find(x=>x.id==='custom-editor-skillStudio.procedurePreview');return custom?.widgetManager.getWidgets('plugin-custom-editor').map(w=>w.resource?.path.toString()??'').filter(p=>p.includes('/establish-pdu-session-mas/'))??[];})()");
  if(!masProcedureGraph||masProcedureGraph.procedureValue!=='establish-session'||!masProcedureGraph.bodyText?.includes('verify-eligible')||!masProcedureGraph.bodyText?.includes('validate-subscription')||!masResourcePaths.some(p=>p.endsWith('/establish-pdu-session-mas/assurance/procedure.yaml')))
    throw Error('MAS Procedure did not open from native Explorer: '+JSON.stringify({masFolder,assuranceRows,procedureRows,masProcedure,masProcedureGraph,masResourcePaths}));
  // Dispose both test editors before resuming the older regression suite.
  // Several existing native-command probes intentionally expect one active
  // Procedure resource, so keep the MAS proof isolated from those probes.
  await invoke('core.close.all.main.tabs');
  await invoke('workbench.files.action.focusFilesExplorer');
  const conventionalProcedure=await explorerRow('procedure.yaml','first');
  if(!conventionalProcedure?.found)throw Error('Conventional 5GC procedure.yaml row missing after MAS open');
  await click(conventionalProcedure.x,conventionalProcedure.y);
  let conventionalGraph=null;
  for(let attempt=0;attempt<100;attempt++){
    conventionalGraph=await graph('ue-requested-pdu-session-establishment');
    if(conventionalGraph)break;
    await sleep(100);
  }
  if(!conventionalGraph)throw Error('Could not restore conventional 5GC Procedure after MAS Explorer acceptance');
  await click(conventionalProcedure.x,conventionalProcedure.y,2);
  await sleep(250);
  conventionalGraph=await graph('ue-requested-pdu-session-establishment');
  if(!conventionalGraph)throw Error('Conventional 5GC Procedure did not pin after MAS acceptance');
  const dualSkillExplorer={
    root:'skills',conventionalFolder:'establish-pdu-session',masFolder,
    assuranceRows,procedureRows,masProcedure,masProcedureGraph,masResourcePaths,
    conventionalProcedure,conventionalGraph
  };
  console.log('STUDIO_DUAL_SKILL_EXPLORER_CHROMIUM',JSON.stringify(dualSkillExplorer));
  // Guard the canvas controls that were present in Classic Studio but were
  // previously omitted from the Theia CustomEditor migration.
  const canvasToolbarEvidence=await evalWebviewJS(`(()=> {
    const ids=["layoutDirection","rootPathMode","neighborsOnly","showAllLabels",
      "centerSelection","zoomOut","zoomIn","fit","fitWidth","fitHeight",
      "pathFailure","pathUncertain","pathRecovery"];
    const controls=Object.fromEntries(ids.map(id=>[id,Boolean(document.getElementById(id))]));
    const direction=document.getElementById("layoutDirection")?.value??null;
    return {
      visible:document.getElementById("graphTools")?.hidden===false,
      direction,
      rootPathToolbarVisible:document.getElementById("rootPathToolbar")?.hidden===false,
      controls
    };
  })()`);
  if(!canvasToolbarEvidence?.visible||canvasToolbarEvidence.direction!=="DOWN"||
     !canvasToolbarEvidence.rootPathToolbarVisible||
     Object.values(canvasToolbarEvidence.controls??{}).some(value=>!value))
    throw Error("Theia Procedure canvas toolbar is incomplete or not vertically initialized: "+
      JSON.stringify(canvasToolbarEvidence));
  console.log("STUDIO_CANVAS_TOOLBAR_CHROMIUM",JSON.stringify(canvasToolbarEvidence));
  let languageServiceStatus="NOT_REQUIRED_NODE_HOST";
  if(requireBrowserLsp){
    languageServiceStatus="";
    for(let i=0;i<100;i++){
      languageServiceStatus=await evalJS(`(()=>{const text=document.body.innerText;return text.match(/SKILL LSP: (READY|PARTIAL|UNAVAILABLE|ERROR|ANALYZING|STARTED|STARTING|IDLE)/)?.[0]||""})()`);
      if(languageServiceStatus==="SKILL LSP: READY")break;
      if(languageServiceStatus==="SKILL LSP: ERROR"||languageServiceStatus==="SKILL LSP: UNAVAILABLE")
        throw Error("Browser LSP did not become healthy: "+languageServiceStatus);
      await sleep(100);
    }
    if(languageServiceStatus!=="SKILL LSP: READY")
      throw Error("Theia browser LanguageClient/Worker did not publish READY Package analysis: "+languageServiceStatus);
    console.log("STUDIO_LSP_CHROMIUM",JSON.stringify({status:languageServiceStatus}));
  }
  let languageFeatureEvidence=null;
  if(requireBrowserLsp){
    languageFeatureEvidence=await evalJS(`(async()=>{
      const container=window.theia.container;
      const commandKey=[...container._bindingDictionary._map.keys()].find(key=>
        typeof key==="function"&&key.prototype?.executeCommand&&
        key.prototype?.registerCommand&&key.prototype?.getCommand);
      if(!commandKey)throw Error("Native Theia command registry missing");
      const registry=container.get(commandKey);
      const openerKey=[...container._bindingDictionary._map.keys()].find(key=>
        String(key)==="Symbol(OpenerService)");
      if(!openerKey)throw Error("Native Theia OpenerService missing");
      const openers=await container.get(openerKey).getOpeners();
      const custom=openers.find(item=>item.id==="custom-editor-skillStudio.procedurePreview");
      const widget=custom?.widgetManager.getWidgets("plugin-custom-editor").find(item=>
        item.resource?.path.toString().endsWith("/assurance/procedure.yaml"));
      const procedureUri=widget?.resource;
      if(!procedureUri)throw Error("Active Skill Package Procedure URI missing");
      return registry.executeCommand(
        "skillStudio.internal.languageProviderAcceptance",procedureUri.toString());
    })()`);
    if(!languageFeatureEvidence?.definition?.endsWith(
      "/scripts/select_establishment_configuration.py")||
      !languageFeatureEvidence.hover||
      !languageFeatureEvidence.references||
      !languageFeatureEvidence.symbols?.includes("main")||
      languageFeatureEvidence.schemaCompletion!=="EstablishmentSelectionInput")
      throw Error("Theia public language-provider acceptance returned incomplete evidence: "+
        JSON.stringify(languageFeatureEvidence));
    console.log("STUDIO_LSP_EDITOR_FEATURES",JSON.stringify(languageFeatureEvidence));
    let diagnosticPublishEvidence=null,diagnosticRepairEvidence=null;
    try{
      diagnosticPublishEvidence=await evalJS(`(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>
          typeof k==="function"&&k.prototype?.executeCommand&&
          k.prototype?.registerCommand&&k.prototype?.getCommand);
        const registry=c.get(key);
        const openerKey=[...c._bindingDictionary._map.keys()].find(k=>
          String(k)==="Symbol(OpenerService)");
        const openers=await c.get(openerKey).getOpeners();
        const custom=openers.find(x=>x.id==="custom-editor-skillStudio.procedurePreview");
        const resource=custom?.widgetManager.getWidgets("plugin-custom-editor").find(w=>
          w.resource?.path.toString().endsWith("/assurance/procedure.yaml"))?.resource;
        if(!resource)throw Error("Procedure resource missing for Problems acceptance");
        return registry.executeCommand(
          "skillStudio.internal.languageDiagnosticsAcceptance",resource.toString(),"publish");
      })()`);
      if(!diagnosticPublishEvidence?.appeared||
         diagnosticPublishEvidence.code!=="PROCEDURE_PROJECTION"||
         diagnosticPublishEvidence.packageAuditDuplicates!==0)
        throw Error("Live LSP diagnostic did not publish exact evidence: "+
          JSON.stringify(diagnosticPublishEvidence));
      // The native Theia Problems view is the built-in "problems" widget
      // (ProblemContribution, command problemsView:toggle). The extension
      // separately contributes a Skill Studio tree also named "Problems";
      // that tree is NOT the LSP marker view, and can be hidden at 0x0.
      const problemsView=await evalJS(`(async()=>{
        const visible=el=>{
          if(!el)return false;
          const r=el.getBoundingClientRect();
          return r.width>0&&r.height>0&&
            getComputedStyle(el).visibility!=="hidden";
        };
        let native=document.getElementById("problems");
        if(!visible(native)){
          const c=window.theia.container;
          const key=[...c._bindingDictionary._map.keys()].find(k=>
            typeof k==="function"&&k.prototype?.executeCommand&&
            k.prototype?.registerCommand&&k.prototype?.getCommand);
          if(!key)throw Error("Native Theia command registry missing");
          await c.get(key).executeCommand("problemsView:toggle");
          native=document.getElementById("problems");
        }
        const r=native?.getBoundingClientRect();
        return {id:native?.id??null,visible:visible(native),
          rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,
          text:native?.innerText?.slice(0,1400)??"",
          source:"theia-markers/ProblemContribution"};
      })()`);
      if(!problemsView?.visible||problemsView.id!=="problems")
        throw Error("Native Theia Problems widget did not become visible: "+
          JSON.stringify(problemsView));
      let problemsText="";
      for(let i=0;i<100;i++){
        problemsText=await evalJS(`document.getElementById("problems")?.innerText??""`);
        if(problemsText.includes("YAML 解析失败"))break;
        await sleep(100);
      }
      if(!problemsText.includes("YAML 解析失败"))
        throw Error("Native Problems widget did not display the live Procedure diagnostic: "+
          JSON.stringify({widget:problemsView,problemsText:problemsText.slice(-1400)}));
    }finally{
      diagnosticRepairEvidence=await evalJS(`(async()=>{
        const c=window.theia.container;
        const key=[...c._bindingDictionary._map.keys()].find(k=>
          typeof k==="function"&&k.prototype?.executeCommand&&
          k.prototype?.registerCommand&&k.prototype?.getCommand);
        const registry=c.get(key);
        const openerKey=[...c._bindingDictionary._map.keys()].find(k=>
          String(k)==="Symbol(OpenerService)");
        const openers=await c.get(openerKey).getOpeners();
        const custom=openers.find(x=>x.id==="custom-editor-skillStudio.procedurePreview");
        const resource=custom?.widgetManager.getWidgets("plugin-custom-editor").find(w=>
          w.resource?.path.toString().endsWith("/assurance/procedure.yaml"))?.resource;
        if(!resource)throw Error("Procedure resource missing for diagnostic repair");
        return registry.executeCommand(
          "skillStudio.internal.languageDiagnosticsAcceptance",resource.toString(),"repair");
      })()`);
    }
    if(!diagnosticRepairEvidence?.cleared||!diagnosticRepairEvidence?.restored)
      throw Error("Live LSP diagnostic did not clear after Source repair: "+
        JSON.stringify(diagnosticRepairEvidence));
    let clearedProblemsText="";
    for(let i=0;i<100;i++){
      clearedProblemsText=await evalJS("document.body.innerText");
      if(!clearedProblemsText.includes("YAML 解析失败"))break;
      await sleep(100);
    }
    if(clearedProblemsText.includes("YAML 解析失败"))
      throw Error("Native Problems UI retained the stale Procedure diagnostic after repair");
    console.log("STUDIO_LSP_DIAGNOSTICS_CHROMIUM",JSON.stringify({
      published:diagnosticPublishEvidence,repaired:diagnosticRepairEvidence,
      nativeProblemsCleared:true
    }));

    // L2-D3: native TextDocuments, actual unsaved buffers, current-generation
    // Worker analysis and public Hover; no direct Worker shortcut.
    const unsavedEvidence=await evalJS("(async()=>{"+
      "const c=window.theia.container;"+
      "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!key)throw Error('L2-D3 native registry missing');"+
      "const registry=c.get(key);"+
      "const openerKey=[...c._bindingDictionary._map.keys()].find(k=>"+
      "String(k)==='Symbol(OpenerService)');"+
      "const openers=await c.get(openerKey).getOpeners();"+
      "const custom=openers.find(x=>x.id==='custom-editor-skillStudio.procedurePreview');"+
      "const uri=custom?.widgetManager.getWidgets('plugin-custom-editor').find(w=>"+
      "w.resource?.path.toString().endsWith('/assurance/procedure.yaml'))?.resource;"+
      "if(!uri)throw Error('L2-D3 Procedure URI missing');"+
      "return registry.executeCommand('skillStudio.internal.languageUnsavedAcceptance',"+
      "uri.toString());})()");
    if(!unsavedEvidence?.restored||!unsavedEvidence.latestPythonHover||
       !unsavedEvidence.originalDiskUnchanged||
       unsavedEvidence.covered?.length!==3)
      throw Error("L2-D3 native unsaved editor probe incomplete: "+
        JSON.stringify(unsavedEvidence));
    console.log("STUDIO_LSP_UNSAVED_CHROMIUM",JSON.stringify(unsavedEvidence));
    // The extension probe restores the Procedure CustomEditor after opening
    // Python Source. Reacquire its live Webview execution context before the
    // existing graph/Inspector/Undo regression continues.
    const restoredGraph=await graph();
    if(!restoredGraph)throw Error("Procedure CustomEditor did not regain its live graph after LSP provider acceptance");
    pinned.timing=restoredGraph.timing??pinned.timing;
  }
  const initialTiming=JSON.parse(pinned.timing??'null');
  await command('Runtime.evaluate',{contextId:graphContext,expression:`(()=>{const s=document.querySelector('#procedureList');window.__acceptanceProcedure=s.value;s.selectedIndex=1;s.dispatchEvent(new Event('change'));})()`});
  await sleep(500);
  await command('Runtime.evaluate',{contextId:graphContext,expression:`(()=>{const s=document.querySelector('#procedureList');s.value=window.__acceptanceProcedure;s.dispatchEvent(new Event('change'));})()`});
  await sleep(500);
  const warm=await graph(),warmTiming=JSON.parse(warm?.timing??'null');
  if(!initialTiming||!warmTiming?.cacheHit)throw Error('Version-scoped warm layout cache was not exercised: '+JSON.stringify({initialTiming,warmTiming}));
  // Export the complete imported Package through the native host snapshot and
  // require a second explicit browser gesture to download the generated ZIP.
  await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,awaitPromise:true,
    expression:`document.querySelector('#exportPackageZip')?.click();true`
  });
  let packageReady=null;
  for(let i=0;i<60;i++){
    packageReady=await command('Runtime.evaluate',{
      contextId:graphContext,returnByValue:true,
      expression:`({
        visible:!document.querySelector('#zipExportNotice')?.hidden,
        details:document.querySelector('#zipExportDetails')?.textContent??''
      })`
    });
    if(packageReady.result?.value?.visible)break;
    await sleep(100);
  }
  if(!packageReady.result?.value?.visible||
     !packageReady.result.value.details.includes('.zip')||
     !packageReady.result.value.details.includes('个文件'))
    throw Error('Native Package ZIP export did not prepare a bounded browser download: '+
      JSON.stringify(packageReady.result?.value));
  // Instrument the page's main JavaScript realm. Runtime.evaluate against
  // graphContext uses an isolated CDP world whose URL/DOM prototypes are not
  // the same objects used by the Webview's event listener.
  if(typeof evalWebviewJS!=="function")throw Error("Procedure Webview main-realm evaluator is unavailable");
  const zipEvidence=await evalWebviewJS(`(()=>{
      let blobMeta=null,linkMeta=null;
      const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
      URL.createObjectURL=function(blob){
        blobMeta={size:blob.size,type:blob.type};return create.call(URL,blob);
      };
      HTMLAnchorElement.prototype.click=function(){
        linkMeta={download:this.download,href:this.href};
      };
      document.querySelector('#downloadPackageZip').click();
      URL.createObjectURL=create;
      HTMLAnchorElement.prototype.click=click;
      return {blobMeta,linkMeta,noticeHidden:document.querySelector('#zipExportNotice')?.hidden};
    })()`);
  if(!(zipEvidence?.blobMeta?.size>22)||
     zipEvidence.blobMeta.type!=='application/zip'||
     !zipEvidence.linkMeta?.download?.endsWith('.zip')||
     !zipEvidence.linkMeta.href.startsWith('blob:')||
     !zipEvidence.noticeHidden)
    throw Error('Native Package ZIP download did not produce a browser Blob: '+
      JSON.stringify(zipEvidence));
  const packageZipEvidence={details:packageReady.result.value.details,...zipEvidence};
  console.log('STUDIO_PACKAGE_ZIP_CHROMIUM',JSON.stringify(packageZipEvidence));
  // The Theia canvas now defaults to Classic's proven success-path focus.
  // This Inspector structural-edit regression deliberately needs all 17
  // source-declared Nodes so its 17→18→17 assertions remain meaningful.
  await command('Runtime.evaluate',{contextId:graphContext,expression:`(()=>{
    const s=document.querySelector('#rootPathMode');
    if(!s)throw Error('Native Root path mode is missing');
    s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`});
  await sleep(700);
  const allPathGraph=await graph();
  if(allPathGraph?.nodes!==17)
    throw Error('Could not restore the 17-node original Root graph before structural editing: '+
      JSON.stringify(allPathGraph));
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
  const sourceVersion=Number(/v(\d+)/.exec(beforeEdit.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(sourceVersion))throw Error('Could not read native Source version');
  await startNativeCommand('skillStudio.editNodeOperatorValue',{
    procedureId:selectionResult.result.value.procedure,nodeId:'nudm-sdm-get',sourceVersion
  },'sbi.udm.sm_data.get.preview');
  await confirmNativePreview('call: sbi.udm.sm_data.get','call: sbi.udm.sm_data.get.preview');
  const afterEdit=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const editResult=await evalJS(`window.__skillStudioCommandResult`);
  if(editResult!==true||!afterEdit.result?.value||afterEdit.result.value===beforeEdit.result?.value)
    throw Error('Native Inspector edit did not commit a Source revision: '+JSON.stringify({editResult,before:beforeEdit.result?.value,after:afterEdit.result?.value}));
  await invoke('core.undo');
  const afterUndo=await waitForRevisionChange(graphContext,afterEdit.result?.value,
    'Native Inspector Undo');
  if(!afterUndo.result?.value||afterUndo.result.value===afterEdit.result?.value)
    throw Error('Native Inspector edit did not round-trip through native Undo: '+JSON.stringify({after:afterEdit.result?.value,undo:afterUndo.result?.value}));
  console.log('STUDIO_INSPECTOR_AUTHORING_CHROMIUM',JSON.stringify({
    node:selectionResult.result.value.node,procedure:selectionResult.result.value.procedure,
    before:beforeEdit.result?.value,after:afterEdit.result?.value,undo:afterUndo.result?.value
  }));
  const bindingSelection=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='nudm-sdm-subscribe');if(!node)throw Error('Phase binding Node is not in the current graph');node.click();return {node:node.getAttribute('data-id'),procedure:document.querySelector('#procedureList')?.value};})()`
  });
  if(!bindingSelection.result?.value?.node)throw Error('Could not select Phase binding Node');
  await sleep(250);
  const skillStudioTab=await evalJS(`(()=>{
    const el=[...document.querySelectorAll('.lm-TabBar-tab')].find(x=>
      x.textContent.trim()==='Skill Studio'&&x.getBoundingClientRect().width>0);
    const r=el?.getBoundingClientRect();
    return r?{x:r.x+r.width/2,y:r.y+r.height/2,
      active:el.classList.contains('lm-mod-current')}:null;
  })()`);
  if(!skillStudioTab)throw Error('Skill Studio native view container tab is missing');
  if(!skillStudioTab.active){await click(skillStudioTab.x,skillStudioTab.y);await sleep(350);}
  const evidenceHeader=await evalJS(`(()=>{
    const candidates=[...document.querySelectorAll('*')].filter(x=>
      x.textContent.trim()==='Evidence'&&x.getBoundingClientRect().width>0&&
      x.getBoundingClientRect().x>=0);
    const el=candidates.sort((a,b)=>{
      const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
      return ar.width*ar.height-br.width*br.height;
    })[0];
    el?.scrollIntoView({block:'center',inline:'nearest'});
    const r=el?.getBoundingClientRect();
    const root=[...document.querySelectorAll('.theia-TreeNode')].some(x=>
      x.innerText.includes('Source evidence only')&&x.getBoundingClientRect().height>0);
    return r?{x:r.x+r.width/2,y:r.y+r.height/2,needsOpen:!root}:null;
  })()`);
  if(!evidenceHeader)throw Error('Native Evidence view header is missing');
  if(evidenceHeader.needsOpen){await click(evidenceHeader.x,evidenceHeader.y);await sleep(250);}
  await invoke('skillStudio.auditPackage');
  let phaseEvidenceText='';
  for(let i=0;i<100;i++){
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(phaseEvidenceText.includes('Producer / Consumer dataflow'))break;
    await sleep(100);
  }
  // The native TreeDataProvider can publish its rows after the visible
  // summary text. Await the actual visible row, not a fixed post-click sleep.
  let dataflowTreeRow=null;
  for(let attempt=0;attempt<100&&!dataflowTreeRow;attempt++){
    dataflowTreeRow=await evalJS(`(()=>{
    // TreeNode.innerText includes nested descendants. Inspect only each
    // TreeNode's own content element so we expand the exact summary row.
    const rows=[...document.querySelectorAll('.theia-TreeNode')].map(node=>{
      const content=[...node.children].find(child=>
        child.classList?.contains('theia-TreeNodeContent'));
      return {node,content,text:content?.innerText?.trim()??''};
    }).filter(row=>row.text.includes('Producer / Consumer dataflow')&&
      row.content?.getBoundingClientRect().height>0);
    const row=rows[0];
    // The evidence view is below the large Inspector/Outline trees in the
    // default layout. A non-zero rect can still be outside the viewport.
    row?.content?.scrollIntoView({block:'center',inline:'nearest'});
    const r=row?.content?.getBoundingClientRect();
    return r?{x:r.x+12,y:r.y+r.height/2,
      expanded:row.node.getAttribute('aria-expanded')==='true',
      rowHeight:r.height,rowText:row.text,viewportHeight:innerHeight,
      candidateCount:rows.length}:null;
  })()`);
    if(!dataflowTreeRow)await sleep(100);
  }
  if(!dataflowTreeRow)throw Error('Native Evidence dataflow row is missing after readiness wait: '+(await evalJS('document.body.innerText')).slice(-1600));
  if(!dataflowTreeRow.expanded){await click(dataflowTreeRow.x,dataflowTreeRow.y);await sleep(250);}
  for(let i=0;i<50;i++){
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(phaseEvidenceText.includes('Consumer ABI'))break;
    await sleep(100);
  }
  const phaseEvidence={
    ready:phaseEvidenceText.includes('Producer / Consumer dataflow')&&
      phaseEvidenceText.includes('Consumer ABI'),
    dataflowRows:(phaseEvidenceText.match(/Producer \/ Consumer dataflow/g)||[]).length,
    consumerAbiRows:(phaseEvidenceText.match(/Consumer ABI/g)||[]).length,
    readOnly:phaseEvidenceText.includes('no write authority')
  };
  if(!phaseEvidence.ready||!phaseEvidence.dataflowRows||!phaseEvidence.consumerAbiRows||
     !phaseEvidence.readOnly)
    throw Error('Native Evidence view did not render bounded read-only Producer / Consumer evidence: '+
      JSON.stringify({phaseEvidence,dataflowTreeRow})+' · '+phaseEvidenceText.slice(-1400));
  console.log('STUDIO_PHASE_DATAFLOW_EVIDENCE_CHROMIUM',JSON.stringify(phaseEvidence));
  // Expanding the native Evidence tree moves focus away from the editor. Open
  // the authoritative Source editor before testing native Undo so the host's
  // undo command is bound to the edited TextDocument, not the tree widget.
  await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,awaitPromise:true,
    expression:`document.querySelector('#openSource')?.click();true`
  });
  await sleep(600);
  const sourceEditorReady=await evalJS(`({
    monacoEditors:document.querySelectorAll('.monaco-editor').length,
    activeText:document.activeElement?.closest('.monaco-editor')!==null
  })`);
  if(!(sourceEditorReady.monacoEditors>0))
    throw Error('Native Source editor did not open before Phase binding Undo regression: '+
      JSON.stringify(sourceEditorReady));
  const beforeBinding=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const bindingVersion=Number(/v(\d+)/.exec(beforeBinding.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(bindingVersion))throw Error('Could not read Source version before Phase binding edit');
  await startNativeCommand('skillStudio.editPhaseInputBinding',{
    kind:'phase-step',procedureId:bindingSelection.result.value.procedure,
    nodeId:'nudm-sdm-subscribe',phaseName:'preconditions',stepIndex:0,
    sourceVersion:bindingVersion
  },'dnn','input.ue-ref');
  await confirmNativePreview('from: input.dnn','from: input.ue-ref');
  const afterBinding=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const bindingResult=await evalJS(`window.__skillStudioCommandResult`);
  if(bindingResult!==true||!afterBinding.result?.value||afterBinding.result.value===beforeBinding.result?.value)
    throw Error('Native Phase Binding edit did not commit a Source revision');
  await invoke('core.undo');
  const afterBindingUndo=await waitForRevisionChange(graphContext,afterBinding.result?.value,
    'Native Phase Binding Undo');
  console.log('STUDIO_PHASE_BINDING_CHROMIUM',JSON.stringify({
    node:bindingSelection.result.value.node,procedure:bindingSelection.result.value.procedure,
    before:beforeBinding.result?.value,after:afterBinding.result?.value,undo:afterBindingUndo.result?.value
  }));
  // Rename a named Script Step and all proven local/qualified consumers through
  // the shared closed-world source-span planner, then verify native Undo.
  // Undo may replace the CustomEditor iframe; reacquire its live execution
  // world instead of reading a possibly detached Webview context.
  const beforeNamedGraph=await graph();
  const beforeNamedRename=beforeNamedGraph?.revision??afterBindingUndo.result?.value??null;
  const namedRenameVersion=Number(/v(\d+)/.exec(beforeNamedRename??'')?.[1]);
  if(!Number.isSafeInteger(namedRenameVersion))throw Error('Named Step rename missing native Source revision');
  const oldStepName='select-subscription-configuration';
  const newStepName='select-subscription-config-v2';
  await startNativeCommand('skillStudio.renameNamedPhaseStep',{
    kind:'phase-step',procedureId:bindingSelection.result.value.procedure,
    nodeId:'nudm-sdm-subscribe',phaseName:'preconditions',stepIndex:0,
    stepName:oldStepName,stepOperator:'script',sourceVersion:namedRenameVersion
  },newStepName);
  await confirmNativePreview(oldStepName,newStepName);
  const namedRenameAccepted=await evalJS(`window.__skillStudioCommandResult`);
  const afterNamedRename=await waitForRevisionChange(graphContext,beforeNamedRename,
    'Named Phase Step rename');
  if(namedRenameAccepted!==true)throw Error('Named Phase Step rename was not accepted');
  await invoke('core.undo');
  const afterNamedRenameUndo=await waitForRevisionChange(graphContext,
    afterNamedRename.result?.value,'Named Phase Step rename Undo');
  console.log('STUDIO_PHASE_NAMED_STEP_RENAME_CHROMIUM',JSON.stringify({
    before:beforeNamedRename,applied:afterNamedRename.result?.value,
    undo:afterNamedRenameUndo.result?.value,oldStepName,newStepName
  }));
  // Real Chromium + actual Theia extension command registry. Each Verify edit
  // must return to the unmodified Source through native TextDocument Undo.
  let lastKnownRevision=afterNamedRenameUndo.result?.value??beforeNamedRename;
  async function nativeVerifyRoundTrip(commandId,item,argument,oldText,newText){
    const currentGraph=await graph();
    const before=currentGraph?.revision??lastKnownRevision??null;
    const version=Number(/v(\d+)/.exec(before??'')?.[1]);
    if(!Number.isSafeInteger(version))throw Error('Verify command missing native Source revision');
    await startNativeCommand(commandId,{...item,
      procedureId:bindingSelection.result.value.procedure,
      nodeId:'nudm-sdm-subscribe',sourceVersion:version
    },argument);
    await confirmNativePreview(oldText,newText);
    const accepted=await evalJS(`window.__skillStudioCommandResult`);
    const after=await waitForRevisionChange(graphContext,before,commandId+' apply');
    if(accepted!==true)throw Error(commandId+' did not apply after confirmation');
    await invoke('core.undo');
    const undone=await waitForRevisionChange(graphContext,after.result?.value,commandId+' Undo');
    lastKnownRevision=undone.result?.value??lastKnownRevision;
    return {before,applied:after.result?.value,undone:undone.result?.value};
  }
  const verifyAppend=await nativeVerifyRoundTrip('skillStudio.addPhaseVerify',
    {kind:'phase',phaseName:'preconditions'},
    'createdsession.n4.initial_resources_ready',
    '新增','createdsession.n4.initial_resources_ready');
  const verifyName=await nativeVerifyRoundTrip('skillStudio.editPhaseVerifyStep',
    {kind:'phase-step',phaseName:'preconditions',stepIndex:4,stepOperator:'verify'},
    {action:'name',newName:'lifecycle-ready'},
    'verify: createdsession.lifecycle.ready','name: lifecycle-ready');
  const verifyDelete=await nativeVerifyRoundTrip('skillStudio.editPhaseVerifyStep',
    {kind:'phase-step',phaseName:'preconditions',stepIndex:4,stepOperator:'verify'},
    'delete','删除','createdsession.lifecycle.ready');
  const verifyReorder=await nativeVerifyRoundTrip('skillStudio.editPhaseVerifyStep',
    {kind:'phase-step',phaseName:'preconditions',stepIndex:4,stepOperator:'verify'},
    'move-up','调整','createdsession.ingress.eligible');
  console.log('STUDIO_PHASE_VERIFY_CHROMIUM',JSON.stringify({
    append:verifyAppend,name:verifyName,delete:verifyDelete,reorder:verifyReorder
  }));
  // Exercise D4-A2.1 against the current published sample, not a wholesale
  // Source replacement. The AMF delivery-context Verify consumes an earlier
  // same-Node output; its local and fully-qualified forms both occur in Source.
  // Multiple local occurrences remain after one normalization, allowing the
  // shared source-backed planner to reprove the producer identity.
  const beforeOutputGraph=await graph();
  if(!beforeOutputGraph?.revision)
    throw Error('Output reference test has no initial native Source revision');
  const outputVersion=Number(/v(\d+)/.exec(beforeOutputGraph.revision)?.[1]);
  if(!Number.isSafeInteger(outputVersion))
    throw Error('Could not read native Source version before output reference test');
  const outputProcedure='ue-requested-pdu-session-establishment';
  const outputNode='namf-communication-n1n2-message-transfer';
  const localOutput='preconditions.resolve-effective-session-configuration.output.contextRef';
  const qualifiedOutput=outputNode+'.'+localOutput;
  const outputItem={kind:'phase-output-reference',procedureId:outputProcedure,
    nodeId:outputNode,phaseName:'preconditions',stepIndex:1,
    bindingKey:'operationContextRef',sourceVersion:outputVersion};
  await startNativeCommand('skillStudio.editPhaseOutputReference',outputItem,
    'operationContextRef',qualifiedOutput);
  await confirmNativePreview(localOutput,qualifiedOutput);
  const outputAccepted=await evalJS('window.__skillStudioCommandResult');
  const afterOutput=await waitForRevisionChange(graphContext,beforeOutputGraph.revision,
    'Phase output reference normalization');
  if(outputAccepted!==true)throw Error('Phase output reference normalization was not accepted');
  await invoke('core.undo');
  const afterOutputUndo=await waitForRevisionChange(graphContext,
    afterOutput.result?.value,'Phase output reference native Undo');
  // Reapply after Undo to prove the original local spelling was restored and
  // that the same source-backed candidate is still eligible.
  const undoVersion=Number(/v(\d+)/.exec(afterOutputUndo.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(undoVersion))
    throw Error('Could not read Source version after output reference Undo');
  await startNativeCommand('skillStudio.editPhaseOutputReference',{
    ...outputItem,sourceVersion:undoVersion
  },'operationContextRef',qualifiedOutput);
  await confirmNativePreview(localOutput,qualifiedOutput);
  const outputReapply=await evalJS('window.__skillStudioCommandResult');
  const afterOutputReapply=await waitForRevisionChange(graphContext,
    afterOutputUndo.result?.value,'Phase output reference reapply');
  if(outputReapply!==true)
    throw Error('Output reference was not eligible again after native Undo');
  await invoke('core.undo');
  const afterOutputReapplyUndo=await waitForRevisionChange(graphContext,
    afterOutputReapply.result?.value,'Phase output reference second Undo');
  const restoredOutputGraph=await graph();
  if(!restoredOutputGraph?.revision||restoredOutputGraph.nodes!==beforeOutputGraph.nodes)
    throw Error('Native output-reference Undo lost the original graph');
  const outputReference={before:beforeOutputGraph.revision,
    applied:afterOutput.result?.value,undo:afterOutputUndo.result?.value,
    reapplied:afterOutputReapply.result?.value,
    undoAgain:afterOutputReapplyUndo.result?.value,
    restored:restoredOutputGraph.revision,localOutput,qualifiedOutput};
  console.log('STUDIO_PHASE_OUTPUT_REFERENCE_CHROMIUM',JSON.stringify(outputReference));
  // D4-A4a uses the existing owner Source. Only an already-observed
  // same-Phase/same-Outcome failure target is eligible, and Undo restores
  // the original failure cleanup route before the later graph regressions.
  const beforePhaseRoute=await graph();
  const routeVersion=Number(/v(\d+)/.exec(beforePhaseRoute?.revision??'')?.[1]);
  if(!Number.isSafeInteger(routeVersion))
    throw Error('Phase Route test has no native TextDocument revision');
  const phaseRouteItem={kind:'route',procedureId:'ue-requested-pdu-session-establishment',
    nodeId:'nudm-sdm-subscribe',routeId:'nudm-sdm-subscribe:preconditions:FAILED',
    sourceVersion:routeVersion};
  await startNativeCommand('skillStudio.editPhaseRouteTarget',phaseRouteItem,'finalize-failed');
  await confirmNativePreview('FAILED: failed','FAILED: finalize-failed');
  const phaseRouteAccepted=await evalJS('window.__skillStudioCommandResult');
  const afterPhaseRoute=await waitForRevisionChange(graphContext,beforePhaseRoute.revision,
    'Phase Route retarget');
  if(phaseRouteAccepted!==true)throw Error('Native Phase Route retarget was not accepted');
  await invoke('core.undo');
  const afterPhaseRouteUndo=await waitForRevisionChange(graphContext,
    afterPhaseRoute.result?.value,'Phase Route retarget Undo');
  const afterRouteGraph=await graph();
  if(!afterRouteGraph?.revision||afterRouteGraph.nodes!==beforePhaseRoute.nodes)
    throw Error('Phase Route native Undo lost the original Procedure graph');
  const phaseRoute={before:beforePhaseRoute.revision,
    applied:afterPhaseRoute.result?.value,undo:afterPhaseRouteUndo.result?.value,
    routeId:phaseRouteItem.routeId,target:'finalize-failed'};
  console.log('STUDIO_PHASE_ROUTE_TARGET_CHROMIUM',JSON.stringify(phaseRoute));
  const graphHasNode=async id=>{
    const result=await command('Runtime.evaluate',{
      contextId:graphContext,returnByValue:true,
      expression:`[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].some(x=>x.getAttribute('data-id')===${JSON.stringify(id)})`
    });
    return result.result?.value===true;
  };
  const insertSelection=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='nudm-sdm-get');if(!node)throw Error('Node insertion source is not in the current graph');node.click();return {node:node.getAttribute('data-id'),procedure:document.querySelector('#procedureList')?.value};})()`
  });
  if(!insertSelection.result?.value?.node)throw Error('Could not select Route source Node for insertion');
  await sleep(250);
  const beforeInsert=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const insertVersion=Number(/v(\d+)/.exec(beforeInsert.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(insertVersion))throw Error('Could not read Source version before Node insertion');
  await startNativeCommand('skillStudio.insertNode',{
    kind:'route',procedureId:insertSelection.result.value.procedure,
    nodeId:'nudm-sdm-get',routeId:'nudm-sdm-get:postconditions:PASS',
    sourceVersion:insertVersion
  },{
    nodeId:'ide-host-insert-probe',operator:'call',
    value:'sbi.demo.insert_probe',outcome:'COMMITTED'
  });
  await confirmNativePreview('PASS: nudm-sdm-subscribe','PASS: ide-host-insert-probe');
  const insertResult=await evalJS(`window.__skillStudioCommandResult`);
  const afterInsert=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  await sleep(400);
  const insertedGraph=await graph();
  const insertedPresent=await graphHasNode('ide-host-insert-probe');
  if(insertResult!==true||!afterInsert.result?.value||
     afterInsert.result.value===beforeInsert.result?.value||insertedGraph?.nodes!==18||!insertedPresent)
    throw Error('Native Node insertion did not add one Source-backed Node: '+JSON.stringify({insertResult,before:beforeInsert.result?.value,after:afterInsert.result?.value,graph:insertedGraph}));
  const deleteSelection=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='ide-host-insert-probe');if(!node)throw Error('Inserted Node is not in the current graph');node.click();return {node:node.getAttribute('data-id'),procedure:document.querySelector('#procedureList')?.value};})()`
  });
  if(!deleteSelection.result?.value?.node)throw Error('Could not select inserted Node for deletion');
  await sleep(250);
  const beforeDelete=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  const deleteVersion=Number(/v(\d+)/.exec(beforeDelete.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(deleteVersion))throw Error('Could not read Source version before Node deletion');
  await startNativeCommand('skillStudio.deleteNode',{
    kind:'node',procedureId:deleteSelection.result.value.procedure,
    nodeId:'ide-host-insert-probe',sourceVersion:deleteVersion
  },'nudm-sdm-subscribe');
  await confirmNativePreview('ide-host-insert-probe:','PASS: nudm-sdm-subscribe');
  const deleteResult=await evalJS(`window.__skillStudioCommandResult`);
  const afterDelete=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`document.querySelector('#revision')?.textContent`
  });
  await sleep(350);
  const deletedGraph=await graph();
  const deletedPresent=await graphHasNode('ide-host-insert-probe');
  if(deleteResult!==true||!afterDelete.result?.value||
     afterDelete.result.value===beforeDelete.result?.value||deletedGraph?.nodes!==17||deletedPresent)
    throw Error('Native Node deletion did not remove the Node and repair the Route: '+JSON.stringify({deleteResult,before:beforeDelete.result?.value,after:afterDelete.result?.value,graph:deletedGraph}));
  await invoke('core.undo');
  const afterDeleteUndo=await waitForRevisionChange(graphContext,afterDelete.result?.value,
    'Native Undo of Node deletion');
  await sleep(350);
  const restoredInsertGraph=await graph();
  const restoredInsertPresent=await graphHasNode('ide-host-insert-probe');
  if(!afterDeleteUndo.result?.value||afterDeleteUndo.result.value===afterDelete.result?.value||
     restoredInsertGraph?.nodes!==18||!restoredInsertPresent)
    throw Error('Native Undo did not restore the deleted Node');
  await invoke('core.undo');
  const afterInsertUndo=await waitForRevisionChange(graphContext,afterDeleteUndo.result?.value,
    'Native Undo of Node insertion');
  await sleep(350);
  const restoredOriginalGraph=await graph();
  const originalAbsent=!(await graphHasNode('ide-host-insert-probe'));
  if(!afterInsertUndo.result?.value||afterInsertUndo.result.value===afterDeleteUndo.result?.value||
     restoredOriginalGraph?.nodes!==17||!originalAbsent)
    throw Error('Native Undo did not remove the inserted Node and restore original graph');
  console.log('STUDIO_NODE_INSERT_DELETE_CHROMIUM',JSON.stringify({
    procedure:insertSelection.result.value.procedure,node:'ide-host-insert-probe',
    before:beforeInsert.result?.value,inserted:afterInsert.result?.value,
    deleted:afterDelete.result?.value,undoDelete:afterDeleteUndo.result?.value,
    undoInsert:afterInsertUndo.result?.value,
    nodeCounts:[insertedGraph?.nodes,deletedGraph?.nodes,
      restoredInsertGraph?.nodes,restoredOriginalGraph?.nodes],
    identity:[insertedPresent,deletedPresent,restoredInsertPresent,originalAbsent]
  }));
  // D4-A4b1: create a one-scalar typo in the actual native Monaco Source
  // editor, then exercise the real extension's guarded correction + Undo.
  // We never bulk-replace the Procedure or save a synthetic example Package.
  const key=async(keyName,code,modifiers=0,virtualKeyCode)=>{
    const event={key:keyName,code,modifiers,
      windowsVirtualKeyCode:virtualKeyCode,nativeVirtualKeyCode:virtualKeyCode};
    await command('Input.dispatchKeyEvent',{type:'keyDown',...event});
    await command('Input.dispatchKeyEvent',{type:'keyUp',...event});
  };
  const beforeOutcomeFixture=await graph();
  const nativeEditor=await evalJS(`(()=>{
    const editors=[...document.querySelectorAll('.monaco-editor')];
    const chosen=editors.map((node,index)=>{
      const rect=node.getBoundingClientRect();
      return {index,x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    }).find(rect=>rect.width>80&&rect.height>100&&rect.x>=0&&rect.y>=0&&
      rect.x+rect.width/2<innerWidth&&rect.y+rect.height/2<innerHeight);
    return chosen??null;
  })()`);
  if(!nativeEditor)throw Error('No native Monaco Source editor for Outcome acceptance');
  await click(nativeEditor.x+Math.min(90,nativeEditor.width/2),
    nativeEditor.y+Math.min(24,nativeEditor.height/2));
  await key('g','KeyG',2,71);await sleep(200);
  await command('Input.insertText',{text:String(pcfOutcomeLine)});
  const gotoInput=await evalJS('document.activeElement?.value??""');
  if(!String(gotoInput).includes(String(pcfOutcomeLine)))
    throw Error('Native Go to Line did not accept PCF Outcome line: '+JSON.stringify(gotoInput));
  await key('Enter','Enter',0,13);await sleep(250);
  const visiblePcfLine=await evalJS(`(()=>{
    const editor=document.querySelectorAll('.monaco-editor')[${nativeEditor.index}];
    return (editor?.querySelector('.view-lines')?.innerText??'').replace(/\\u00a0/g,' ');
  })()`);
  if(!visiblePcfLine.includes('FAILED: finalize-failed'))
    throw Error('Native Source editor did not reveal the PCF Outcome target: '+
      visiblePcfLine.slice(0,1400));
  await key('Home','Home',0,36);await key('Home','Home',0,36);
  await key('End','End',8,35);
  await command('Input.insertText',{text:'            MISTYPED: finalize-failed'});
  const afterTypo=await waitForRevisionChange(graphContext,
    beforeOutcomeFixture.revision,'Native Phase Outcome typo fixture');
  const typoVersion=Number(/v(\d+)/.exec(afterTypo.result?.value??'')?.[1]);
  if(!Number.isSafeInteger(typoVersion))throw Error('Outcome typo lost native Source version');
  const typoItem={kind:'phase-outcome-repair',
    procedureId:'ue-requested-pdu-session-establishment',
    nodeId:'npcf-sm-policy-control-create',
    phaseName:'preconditions',sourceVersion:typoVersion};
  await startNativeCommand('skillStudio.repairPhaseOutcome',typoItem,
    {mode:'rename',oldOutcome:'MISTYPED',newOutcome:'FAILED',target:'finalize-failed'});
  await evalJS(`(()=>{
    window.__outcomeCommandState={status:'pending'};
    window.__skillStudioPendingCommand.then(
      value=>{window.__outcomeCommandState={status:'resolved',value};},
      error=>{window.__outcomeCommandState={status:'rejected',error:String(error)};});
    return true;
  })()`);
  await sleep(450);
  const outcomeProbe=await evalJS(`({
    state:window.__outcomeCommandState,
    tail:document.body.innerText.slice(-800),
    modals:[...document.querySelectorAll('button')]
      .filter(x=>x.getBoundingClientRect().width>0)
      .map(x=>x.textContent?.trim()).filter(Boolean).slice(-25)
  })`);
  console.log('STUDIO_PHASE_OUTCOME_COMMAND_PROBE',JSON.stringify(outcomeProbe));
  if(outcomeProbe.state?.status==='resolved'&&outcomeProbe.state.value!==true)
    throw Error('Phase Outcome command rejected fixture before confirmation: '+
      JSON.stringify(outcomeProbe));
  await confirmNativePreview('MISTYPED: finalize-failed','FAILED: finalize-failed',
    {attempts:120});
  const outcomeAccepted=await evalJS('window.__skillStudioCommandResult');
  const outcomeApplied=await waitForRevisionChange(graphContext,
    afterTypo.result?.value,'Native Phase Outcome correction');
  if(outcomeAccepted!==true)throw Error('Native Phase Outcome repair was not accepted');
  await invoke('core.undo');
  const outcomeUndo=await waitForRevisionChange(graphContext,
    outcomeApplied.result?.value,'Native Phase Outcome repair Undo');
  const afterNativeUndo=await evalJS(`(()=>{
    const editor=document.querySelectorAll('.monaco-editor')[${nativeEditor.index}];
    return (editor?.querySelector('.view-lines')?.innerText??'').replace(/\\u00a0/g,' ');
  })()`);
  if(!afterNativeUndo.includes('MISTYPED: finalize-failed'))
    throw Error('Native Undo did not revert the Outcome repair back to the typed fixture: '+
      afterNativeUndo.slice(-1200));
  // The keyboard-created fixture can have its own Monaco edit/undo grouping.
  // Restore the original Source explicitly with one native editor line edit;
  // do not assume a second core.undo will undo exactly that fixture.
  await click(nativeEditor.x+Math.min(90,nativeEditor.width/2),
    nativeEditor.y+Math.min(24,nativeEditor.height/2));
  await key('g','KeyG',2,71);await sleep(160);
  await command('Input.insertText',{text:String(pcfOutcomeLine)});
  await key('Enter','Enter',0,13);await sleep(160);
  await key('Home','Home',0,36);await key('Home','Home',0,36);
  await key('End','End',8,35);
  await command('Input.insertText',{text:'            FAILED: finalize-failed'});
  const fixtureRestored=await waitForRevisionChange(graphContext,
    outcomeUndo.result?.value,'Native Phase Outcome fixture restoration');
  const restoredText=await evalJS(`(()=>{
    const editor=document.querySelectorAll('.monaco-editor')[${nativeEditor.index}];
    return (editor?.querySelector('.view-lines')?.innerText??'').replace(/\\u00a0/g,' ');
  })()`);
  if(!restoredText.includes('FAILED: finalize-failed')||
     restoredText.includes('MISTYPED: finalize-failed'))
    throw Error('Native Source fixture was not restored to its original scalar: '+
      restoredText.slice(-1200));
  const outcomeRestored=await graph();
  if(!outcomeRestored?.revision||outcomeRestored.nodes!==beforeOutcomeFixture.nodes)
    throw Error('Phase Outcome restoration lost the original Procedure graph');
  const phaseOutcome={line:pcfOutcomeLine,
    before:beforeOutcomeFixture.revision,seed:afterTypo.result?.value,
    repaired:outcomeApplied.result?.value,undo:outcomeUndo.result?.value,
    restored:fixtureRestored.result?.value,
    restoration:'native editor exact line replacement'};
  console.log('STUDIO_PHASE_OUTCOME_REPAIR_CHROMIUM',JSON.stringify(phaseOutcome));
  // Return the native Explorer to the foreground: the evidence acceptance
  // opened the Skill Studio Activity Bar and intentionally kept it selected.
  await invoke('workbench.files.action.focusFilesExplorer');
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
  // Contract is a distinct source-backed CustomEditor, not a second Procedure graph.
  await invoke('skillStudio.openContract');
  let contractView=null,contractFrame=null,contractContextId=null;
  for(let attempt=0;attempt<100&&!contractView;attempt++){
    const contractTree=await command('Page.getFrameTree');
    const contractFrames=[];
    const collectContractFrames=node=>{
      if(!node)return;
      contractFrames.push(node.frame);
      for(const child of node.childFrames??[])collectContractFrames(child);
    };
    collectContractFrames(contractTree.frameTree);
    for(const frame of contractFrames.filter(item=>
        item.url.includes('/webview/index.html')||item.url.includes('.webview.'))){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'contract-designer-acceptance',grantUniveralAccess:true
        });
        const result=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,
          expression:`({
            title:document.title,
            text:document.body?.innerText??'',
            cards:[...document.querySelectorAll('.card h2')].map(x=>x.textContent.trim()),
            status:document.querySelector('#status')?.textContent??''
          })`
        });
        const candidate=result.result?.value;
        if(candidate?.title==='SKILL Contract Visual'){
          contractView=candidate;contractFrame=frame;
          contractContextId=world.executionContextId;break;
        }
      }catch{/* another webview frame may be disposed while tabs activate */}
    }
    if(!contractView)await sleep(100);
  }
  const contractExpectedCards=['Skill Identity','Entry & Inputs','Required Context',
    'Allowed Resources','Preconditions','Requirements','Postconditions',
    'Planning','Failure Semantics','Dependencies'];
  if(!contractView||!contractFrame||
     !contractView.text.includes('establish-pdu-session')||
     !contractView.text.includes('sbi.udm.sm_data.get')||
     !contractView.text.includes('skill.evaluate-udm-read')||
     !contractView.text.includes('createdsession.ran.setup_accepted')||
     contractExpectedCards.some(title=>!contractView.cards.includes(title)))
    throw Error('Contract Designer did not render the current Package Source: '+
      JSON.stringify(contractView).slice(0,3000));
  console.log('STUDIO_CONTRACT_DESIGNER_CHROMIUM',JSON.stringify({
    title:contractView.title,status:contractView.status,cards:contractView.cards,
    capabilityVisible:contractView.text.includes('sbi.udm.sm_data.get'),
    predicateVisible:contractView.text.includes('createdsession.ran.setup_accepted'),
    readOnly:contractView.text.includes('Source 是唯一真源')
  }));
  // PredicateSet uses its own Observation -> Evaluator visual, never a live result graph.
  await invoke('skillStudio.openPredicates');
  let predicateView=null,predicateFrame=null;
  for(let attempt=0;attempt<100&&!predicateView;attempt++){
    const predicateTree=await command('Page.getFrameTree');
    const predicateFrames=[];
    const collectPredicateFrames=node=>{
      if(!node)return;
      predicateFrames.push(node.frame);
      for(const child of node.childFrames??[])collectPredicateFrames(child);
    };
    collectPredicateFrames(predicateTree.frameTree);
    for(const frame of predicateFrames.filter(item=>
        item.url.includes('/webview/index.html')||item.url.includes('.webview.'))){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'predicate-designer-acceptance',grantUniveralAccess:true
        });
        const result=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,
          expression:"({title:document.title,text:document.body?.textContent??'',predicates:document.querySelectorAll('details.predicate').length,ids:[...document.querySelectorAll('.predicate summary .pid')].map(x=>x.textContent.trim()),observations:document.querySelectorAll('.observation').length,status:document.querySelector('#status')?.textContent??''})"
        });
        const candidate=result.result?.value;
        if(candidate?.title==='SKILL Predicate Visual'){
          predicateView=candidate;predicateFrame=frame;break;
        }
      }catch{/* another webview frame may be disposed while tabs activate */}
    }
    if(!predicateView)await sleep(100);
  }
  if(!predicateView||!predicateFrame||
     predicateView.predicates!==17||predicateView.observations<17||
     !predicateView.text.includes('createdsession.ran.setup_accepted')||
     !predicateView.text.includes('createdsession.udm.hold_bound')||
     !predicateView.text.includes('skill.evaluate-udm-read')||
     !predicateView.text.includes('Observation → Evaluator')||
     !predicateView.text.includes('不是当前运行证据'))
    throw Error('Predicate Designer did not render the real PredicateSet declarations: '+
      JSON.stringify(predicateView).slice(0,3000));
  console.log('STUDIO_PREDICATE_DESIGNER_CHROMIUM',JSON.stringify({
    title:predicateView.title,status:predicateView.status,
    predicates:predicateView.predicates,observations:predicateView.observations,
    realPredicateVisible:predicateView.ids.includes('createdsession.ran.setup_accepted'),
    scriptEvaluatorVisible:predicateView.text.includes('skill.evaluate-udm-read'),
    noLiveResultClaim:predicateView.text.includes('不是当前运行证据')
  }));
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

  // D4a + D4b: prove real Worker termination, SDK-owned diagnostic cleanup,
  // degraded native editing, explicit restart and dirty-buffer rehydration.
  let workerFailureEvidence=null,recoveryEvidence=null;
  if(requireBrowserLsp){
    let procedureDiagnosticActive=false,ownershipProbeActive=false,
      recoveryBufferPrepared=false,packageLifecyclePrepared=false;
    let procedureUri=null;
    try{
    procedureUri=await evalJS(`(async()=>{const c=window.theia.container;const opKey=[...c._bindingDictionary._map.keys()].find(k=>String(k)==='Symbol(OpenerService)');if(!opKey)throw Error('L2-D4 Procedure OpenerService missing');const openers=await c.get(opKey).getOpeners();const custom=openers.find(x=>x.id==='custom-editor-skillStudio.procedurePreview');return custom?.widgetManager.getWidgets('plugin-custom-editor').find(w=>w.resource?.path.toString().endsWith('/assurance/procedure.yaml'))?.resource?.toString()??null;})()`);
    if(!procedureUri)throw Error("L2-D4 Procedure URI missing");

    const diagnostic=await nativeCommand(
      "skillStudio.internal.languageDiagnosticsAcceptance",procedureUri,"publish");
    if(!diagnostic?.appeared||diagnostic.code!=="PROCEDURE_PROJECTION")
      throw Error("L2-D4b real LSP diagnostic setup failed: "+JSON.stringify(diagnostic));
    procedureDiagnosticActive=true;
    const ownershipSetup=await nativeCommand(
      "skillStudio.internal.languageDiagnosticOwnershipAcceptance",procedureUri,"publish");
    if(!ownershipSetup?.lspDiagnosticPresent||!ownershipSetup?.hostProbePresent)
      throw Error("L2-D4b diagnostic ownership setup failed: "+JSON.stringify(ownershipSetup));
    ownershipProbeActive=true;

    const terminated=await nativeCommand(
      "skillStudio.internal.languageWorkerTerminationAcceptance");
    if(!terminated?.actualWorkerTerminated||
       terminated.workerName!=="skill-studio-language-server"||
       !terminated.scriptUri?.endsWith("/skill-language-server.js"))
      throw Error("L2-D4 did not terminate the real Language Worker: "+
        JSON.stringify(terminated));
    console.log("STUDIO_LSP_WORKER_TERMINATION_CHROMIUM",JSON.stringify(terminated));

    let observedStatus="";
    for(let i=0;i<100;i++){
      observedStatus=await evalJS('document.body.innerText.match(/SKILL LSP: (UNAVAILABLE|ERROR|READY|ANALYZING|IDLE)/)?.[0]??""');
      if(observedStatus==="SKILL LSP: UNAVAILABLE")break;
      await sleep(100);
    }
    if(observedStatus!=="SKILL LSP: UNAVAILABLE")
      throw Error("L2-D4 Worker termination was not surfaced: "+
        JSON.stringify({observedStatus,worker:terminated.scriptUri}));

    const ownership=await nativeCommand(
      "skillStudio.internal.languageDiagnosticOwnershipAcceptance",procedureUri,"verify");
    if(!ownership?.lspCollectionDisposed||!ownership?.lspDiagnosticCleared||
       !ownership?.independentHostCollectionPreserved)
      throw Error("L2-D4b SDK diagnostic ownership failed: "+JSON.stringify(ownership));
    await nativeCommand(
      "skillStudio.internal.languageDiagnosticOwnershipAcceptance",procedureUri,"restore");
    ownershipProbeActive=false;
    const procedureRestore=await nativeCommand(
      "skillStudio.internal.languageDiagnosticsAcceptance",procedureUri,"repair-after-failure");
    if(!procedureRestore?.restored||!procedureRestore?.originalDiskRestored)
      throw Error("L2-D4b degraded Procedure restoration failed: "+JSON.stringify(procedureRestore));
    procedureDiagnosticActive=false;

    const nativeEdit=await nativeCommand(
      "skillStudio.internal.languageDegradedEditingAcceptance",procedureUri);
    if(!nativeEdit?.nativePythonEditing||!nativeEdit?.workerUnavailable||
       !nativeEdit.restored||nativeEdit.status!=="SKILL LSP: UNAVAILABLE"||
       !/health request timed out|connection closed|stopped unexpectedly|crashed|could not be decoded/i.test(nativeEdit.failureReason??""))
      throw Error("L2-D4 native editor or real transport-failure evidence missing: "+
        JSON.stringify(nativeEdit));

    const packageLifecycle=await nativeCommand(
      "skillStudio.internal.languagePackageLifecycleAcceptance",procedureUri,"prepare");
    if(!packageLifecycle?.created||packageLifecycle.references!==2||
       !packageLifecycle.distinctNonNestedRoots||
       !packageLifecycle.packageARoot||!packageLifecycle.packageBRoot||
       packageLifecycle.packageBRoot.startsWith(packageLifecycle.packageARoot+"/")||
       packageLifecycle.packageARoot.startsWith(packageLifecycle.packageBRoot+"/"))
      throw Error("L2-D4b requires two truly separate Package roots: "+
        JSON.stringify(packageLifecycle));
    packageLifecyclePrepared=true;
    const prepared=await nativeCommand(
      "skillStudio.internal.languageRecoveryAcceptance",procedureUri,"prepare");
    if(!prepared?.dirtyBufferPrepared||!prepared?.originalDiskUnchanged)
      throw Error("L2-D4b unsaved-buffer recovery setup failed: "+JSON.stringify(prepared));
    recoveryBufferPrepared=true;
    const recovery=await nativeCommand("skillStudio.restartLanguageService");
    if(!recovery?.recovered||!Array.isArray(recovery.packages)||
       recovery.packages.length!==2||
       recovery.packages.some(item=>item.status!=="READY")||
       new Set(recovery.packages.map(item=>item.rootUri)).size!==2||
       !recovery.packages.some(item=>item.rootUri===packageLifecycle.packageARoot)||
       !recovery.packages.some(item=>item.rootUri===packageLifecycle.packageBRoot)||
       recovery.packages.some(item=>
         item.rootUri===packageLifecycle.packageARoot&&
         item.dirtyDocuments?.some(file=>file.path.startsWith("skill-studio-l2d4b-"))))
      throw Error("L2-D4b cross-Package isolation or recovery failed: "+
        JSON.stringify(recovery));
    const recovered=await nativeCommand(
      "skillStudio.internal.languageRecoveryAcceptance",procedureUri,"verify-and-restore");
    if(!recovered?.recovered||!recovered?.dirtyPythonRehydrated||
       !recovered?.hoverReflectsUnsavedMetadata||
       !recovered?.originalDiskUnchanged||!recovered?.restored)
      throw Error("L2-D4b replacement Worker did not rehydrate the unsaved buffer: "+
        JSON.stringify(recovered));
    recoveryBufferPrepared=false;
    let lifecycle=null;
    try{
      lifecycle=await nativeCommand(
        "skillStudio.internal.languagePackageLifecycleAcceptance",
        procedureUri,"verify-and-close");
    }finally{
      // The command's own finally always releases references and removes the
      // temporary Package, including when a lifecycle assertion fails.
      packageLifecyclePrepared=false;
    }
    if(!lifecycle?.twoPackageRecovery||!lifecycle?.firstReferenceRetained||
       !lifecycle?.finalCloseRemoved||!lifecycle?.generationMonotonic||
       !lifecycle?.cleaned)
      throw Error("L2-D4b host Package close/reopen acceptance failed: "+
        JSON.stringify(lifecycle));

    workerFailureEvidence={workerTarget:terminated.scriptUri,
      transportUnavailable:true,nativeEditing:nativeEdit,
      diagnosticOwnership:ownership};
    recoveryEvidence={...recovery,dirtyBuffer:recovered,packageLifecycle:lifecycle};
    console.log("STUDIO_LSP_WORKER_DEGRADED_CHROMIUM",
      JSON.stringify(workerFailureEvidence));
    console.log("STUDIO_LSP_WORKER_RECOVERY_CHROMIUM",
      JSON.stringify(recoveryEvidence));
    }finally{
      if(recoveryBufferPrepared){
        try{await nativeCommand("skillStudio.internal.languageRecoveryAcceptance",
          procedureUri,"abort-and-restore");}catch(error){
          console.warn("L2-D4b recovery abort cleanup",String(error?.message??error));
        }
      }
      if(packageLifecyclePrepared){
        try{await nativeCommand("skillStudio.internal.languagePackageLifecycleAcceptance",
          procedureUri,"abort-and-clean");}catch(error){
          console.warn("L2-D4b Package lifecycle cleanup",String(error?.message??error));
        }
      }
      if(ownershipProbeActive){
        try{await nativeCommand("skillStudio.internal.languageDiagnosticOwnershipAcceptance",
          procedureUri,"restore");}catch(error){
          console.warn("L2-D4b diagnostic ownership cleanup",String(error?.message??error));
        }
      }
      if(procedureDiagnosticActive){
        try{await nativeCommand("skillStudio.internal.languageDiagnosticsAcceptance",
          procedureUri,"repair-after-failure");}catch(error){
          console.warn("L2-D4b Procedure diagnostic cleanup",String(error?.message??error));
        }
      }
    }
  }
  console.log('STUDIO_LAYOUT_TIMING',JSON.stringify({initialTiming,warmTiming}));
  console.log('STUDIO_WORKBENCH_CHROMIUM' ,JSON.stringify({views:true,packageAudit:true,languageServiceStatus,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs}));
  return {views:true,packageAudit:true,languageServiceStatus,phaseEvidence,packageZip:packageZipEvidence,markdown:true,restored,initialTiming,warmTiming,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs,dualSkillExplorer,namedStepRename:{accepted:namedRenameAccepted,applied:afterNamedRename.result?.value,undo:afterNamedRenameUndo.result?.value,oldStepName,newStepName},namedVerifyName:verifyName,outputReference,phaseRoute,phaseOutcome,workerFailureEvidence,recoveryEvidence};
}

// Keep native Explorer acceptance independent of the user's scroll position.
