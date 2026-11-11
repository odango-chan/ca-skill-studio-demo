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
export async function runPackageOverviewAcceptance({command,evalJS,sleep,requireEditor}) {
  if (!requireEditor) return {required:false};
  const click=async(x,y,count=1)=>{
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,pointerType:'mouse'});
    await sleep(100);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:count,pointerType:'mouse'});
    await sleep(100);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:count,pointerType:'mouse'});
    await sleep(180);
  };
  const invoke=async(id,...args)=>{
    const expression="(async()=>{const c=window.theia.container;"+
      "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
      "typeof k==='function'&&k.prototype?.executeCommand&&"+
      "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
      "if(!key)throw Error('Native command registry missing');"+
      "const registry=c.get(key);window.__skillStudioLastCommandResult="+
      "await registry.executeCommand("+JSON.stringify(id)+",..."+
      JSON.stringify(args)+");return true;})()";
    await evalJS(expression);
    await sleep(320);
  };
  const activityState=await evalJS(
    "(()=>{const tabs=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')]"+
    ".filter(x=>x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&"+
    "x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&"+
    "x.getBoundingClientRect().y<innerHeight);"+
    "const active=tabs.find(x=>x.classList.contains('theia-mod-active'));"+
    "const r=active?.getBoundingClientRect();"+
    "const target=tabs.find(x=>x.textContent.trim()==='Skill Studio');"+
    "const tr=target?.getBoundingClientRect();"+
    "return {previous:active?{label:active.textContent.trim(),x:r.x+r.width/2,y:r.y+r.height/2}:null,"+
    "activity:tr?{x:tr.x+tr.width/2,y:tr.y+tr.height/2}:null};})()");
  const activity=activityState?.activity;
  if(!activity)throw Error('Package Overview Activity Bar entry missing');
  await click(activity.x,activity.y);
  await sleep(400);
  const readTreeRows=()=>evalJS(
    "(()=>{const header=[...document.querySelectorAll('.theia-view-container-part-header')]"+
    ".find(x=>x.textContent.trim().toLowerCase()==='packages'&&"+
    "x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0);"+
    "const part=header?.closest('.part');"+
    "return [...(part?.querySelectorAll('.theia-TreeNode')??[])].map((el,index)=>{"+
    "const toggle=el.querySelector('.theia-ExpansionToggle');"+
    "const content=el.querySelector('.theia-TreeNodeContent')??el;"+
    "const r=(toggle??content).getBoundingClientRect();"+
    "const cr=content.getBoundingClientRect();"+
    "const hit=r.width>0&&r.height>0?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;"+
    "return {index,text:el.innerText.replace(/\\s+/g,' ').trim(),className:el.className,"+
    "nodeIds:[...el.querySelectorAll('[data-node-id]')].map(x=>x.getAttribute('data-node-id')),"+
    "hasToggle:Boolean(toggle),toggleClass:toggle?.className??null,"+
    "hitWithinToggle:Boolean(toggle&&(hit===toggle||toggle.contains(hit))),"+
    "hitTag:hit?.tagName??null,hitClass:typeof hit?.className==='string'?hit.className:'',"+
    "togglePos:r.width>0&&r.height>0?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null,"+
    "contentPos:cr.width>0&&cr.height>0?{x:Math.round(cr.x+cr.width/2),y:Math.round(cr.y+cr.height/2)}:null,"+
    "visible:cr.width>0&&cr.height>0&&cr.x<innerWidth&&cr.y<innerHeight&&cr.right>0&&cr.bottom>0};"+
    "});})()");
  // Resolve the exact live TreeView node after scrolling it into view. A
  // stale centre point can hit an overlapping selected row instead of the
  // requested Theia expansion toggle, particularly in the second Package.
  async function clickVisibleToggle(row,label){
    const id=row.nodeIds?.[0];
    if(!id)throw Error('Native tree row has no node ID: '+label+' '+JSON.stringify(row));
    const target=await evalJS(`(()=>{
      const anchor=[...document.querySelectorAll('[data-node-id]')]
        .find(el=>el.getAttribute('data-node-id')===${JSON.stringify(id)});
      const toggle=anchor?.closest('.theia-TreeNode')?.querySelector('.theia-ExpansionToggle');
      if(!toggle)return {found:false};
      toggle.scrollIntoView({block:'center',inline:'nearest'});
      const r=toggle.getBoundingClientRect();
      const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
      const hit=document.elementFromPoint(x,y);
      return {found:true,x,y,hitWithinToggle:hit===toggle||toggle.contains(hit),
        hitClass:typeof hit?.className==='string'?hit.className:'',
        toggleClass:toggle.className,nodeId:toggle.getAttribute('data-node-id'),
        pointerEvents:getComputedStyle(toggle).pointerEvents};
    })()`);
    if(!target?.found||!target.hitWithinToggle)
      throw Error('Native Package toggle is not reachable by mouse: '+label+' '+
        JSON.stringify({target,row}));
    await click(target.x,target.y);
  }
  let rows=[];
  for(let attempt=0;attempt<100;attempt++){
    rows=await readTreeRows();
    if(rows.some(x=>x.visible&&x.text.includes('2 SKILL Packages'))&&
       rows.some(x=>x.visible&&x.text.includes('establish-pdu-session · 3/3 core ·')))break;
    await sleep(100);
  }
  if(!rows.some(x=>x.visible&&x.text.includes('establish-pdu-session · 3/3 core ·')))
    throw Error('Package Overview did not populate after opening its native Activity Bar view: '+JSON.stringify(rows));
  await invoke('skillStudio.refreshPackages');
  const scan=await evalJS('window.__skillStudioLastCommandResult??null');
  console.log('STUDIO_PACKAGE_SCAN_RESULT',JSON.stringify(scan));
  await evalJS(`(()=>{
    window.__packageOverviewClickEvents=[];
    document.addEventListener('click',event=>{
      const toggle=event.target?.closest?.('.theia-ExpansionToggle');
      if(!toggle)return;
      window.__packageOverviewClickEvents.push({
        trusted:event.isTrusted,nodeId:toggle.getAttribute('data-node-id'),
        className:toggle.className,defaultPrevented:event.defaultPrevented,
        x:event.clientX,y:event.clientY
      });
      if(window.__packageOverviewClickEvents.length>60)
        window.__packageOverviewClickEvents.shift();
    },true);
    return true;
  })()`);
  const expectedNames=['establish-pdu-session','establish-pdu-session-mas'];
  const discovered=(scan?.packages??[]).map(x=>x.name).sort();
  if(scan?.state!=='ready'||JSON.stringify(discovered)!==JSON.stringify(expectedNames.slice().sort()))
    throw Error('Package Overview must discover both sample Skills in one Workspace: '+
      JSON.stringify({scan,expectedNames}));
  const classic=scan.packages.find(x=>x.name==='establish-pdu-session');
  const mas=scan.packages.find(x=>x.name==='establish-pdu-session-mas');
  if(classic?.fileCount!==22||classic?.corePresent!==3||
     mas?.fileCount!==5||mas?.corePresent!==3)
    throw Error('Two-SKILL inventory does not match the pinned sample manifest: '+
      JSON.stringify({classic,mas}));
  const packageNames=expectedNames;
  const isPackageRow=row=>packageNames.some(name=>
    row.text.includes(name+' · 3/3 core ·'));
  const packageRange=(currentRows,name)=>{
    const index=currentRows.findIndex(row=>row.visible&&
      row.text.includes(name+' · 3/3 core ·'));
    if(index<0)return null;
    let end=currentRows.length;
    for(let i=index+1;i<currentRows.length;i++)
      if(currentRows[i].visible&&isPackageRow(currentRows[i])){end=i;break;}
    return {index,end};
  };
  async function ensurePackageExpanded(name){
    for(let attempt=0;attempt<24;attempt++){
      rows=await readTreeRows();
      const range=packageRange(rows,name);
      if(!range){await sleep(120);continue;}
      const group=rows.slice(range.index+1,range.end).find(row=>
        row.visible&&row.text.includes('Assurance · 3/3 core'));
      if(group)return {rows,range};
      const packageRow=rows[range.index];
      const toggle=packageRow.togglePos;
      if(!toggle)throw Error('Package row has no visible expansion toggle: '+
        JSON.stringify(packageRow));
      // A provider can publish the parent row before its children. Do not
      // toggle an already-expanded Package closed while waiting for groups.
      if(String(packageRow.toggleClass??'').includes('theia-mod-collapsed'))
        await clickVisibleToggle(packageRow,name);
      await sleep(120);
    }
    throw Error('Package did not expand in the native TreeView: '+name+
      ' '+JSON.stringify(rows));
  }
  async function ensureAssuranceFile(name,filePath){
    for(let attempt=0;attempt<24;attempt++){
      const expanded=await ensurePackageExpanded(name);
      rows=expanded.rows;
      const range=expanded.range;
      const groupIndex=rows.findIndex((row,index)=>index>range.index&&index<range.end&&
        row.visible&&row.text.includes('Assurance · 3/3 core'));
      if(groupIndex<0){await sleep(120);continue;}
      let nextGroup=range.end;
      for(let i=groupIndex+1;i<range.end;i++){
        if(rows[i].visible&&/^(Skill Definition|Assurance ·|Schemas ·|Scripts ·|References ·|Other ·)/.test(rows[i].text)){
          nextGroup=i;break;
        }
      }
      const file=rows.slice(groupIndex+1,nextGroup).find(row=>
        row.visible&&row.text.includes(filePath.split('/').at(-1))&&
        row.text.includes(filePath));
      if(file)return {rows,range,groupIndex,file};
      const groupRow=rows[groupIndex];
      const toggle=groupRow.togglePos;
      if(!toggle)throw Error('Assurance group has no visible expansion toggle: '+
        JSON.stringify(groupRow));
      // TreeView children may arrive asynchronously after the expansion
      // event. If Theia reports the group expanded but publishes no children,
      // force one collapse/re-expand cycle so the provider is asked again.
      // Never repeatedly toggle a healthy expanded group while its rows load.
      if(String(groupRow.toggleClass??'').includes('theia-mod-collapsed'))
        await clickVisibleToggle(groupRow,name+' Assurance');
      else if(attempt===0){
        await clickVisibleToggle(groupRow,name+' Assurance recheck');
        await sleep(120);
        const collapsedRows=await readTreeRows();
        const collapsedRange=packageRange(collapsedRows,name);
        const current=collapsedRange?collapsedRows.slice(
          collapsedRange.index+1,collapsedRange.end).find(row=>
            row.visible&&row.text.includes('Assurance · 3/3 core')):null;
        if(current&&String(current.toggleClass??'').includes('theia-mod-collapsed'))
          await clickVisibleToggle(current,name+' Assurance retry');
      }
      await sleep(120);
    }
    const clickEvents=await evalJS('window.__packageOverviewClickEvents??[]');
    throw Error('Package Assurance group did not reveal '+filePath+': '+name+
      ' '+JSON.stringify({rows,clickEvents}));
  }
  async function readContractFrames(){
    const tree=await command('Page.getFrameTree');
    const frames=[];
    const walk=node=>{
      if(!node)return;
      frames.push(node.frame);
      for(const child of node.childFrames??[])walk(child);
    };
    walk(tree.frameTree);
    const candidates=frames.filter(frame=>
      frame.url.includes('/webview/index.html')||frame.url.includes('.webview.'));
    const snapshots=[];
    for(const frame of candidates){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'skill-studio-package-contract-acceptance',
          grantUniveralAccess:true
        });
        const result=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,awaitPromise:true,
          expression:"(()=>({name:document.querySelector('#name')?.textContent?.trim()??'',"+
            "title:document.title,heading:document.querySelector('h1')?.innerText??'',"+
            "status:document.querySelector('#status')?.textContent??''}))()"
        });
        snapshots.push({frameUrl:frame.url,...(result.result?.value??{})});
      }catch(error){snapshots.push({frameUrl:frame.url,error:String(error)});}
    }
    return snapshots;
  }
  async function openPackageContract(name){
    const result=await ensureAssuranceFile(name,'assurance/contract.yaml');
    const file=result.file;
    if(!file.contentPos)
      throw Error('Contract file row is not clickable: '+JSON.stringify(file));
    await click(file.contentPos.x,file.contentPos.y);
    let snapshot=null;
    for(let attempt=0;attempt<35;attempt++){
      const frames=await readContractFrames();
      snapshot=frames.find(frame=>frame.name===name)??null;
      if(snapshot)return {package:name,contractName:snapshot.name,
        frameUrl:snapshot.frameUrl,fileRow:file.text,nodeIds:file.nodeIds};
      await sleep(150);
    }
    // Some Theia TreeView hosts invoke TreeItem.command on the double-click
    // open gesture. Retry once without changing the selected package context.
    await click(file.contentPos.x,file.contentPos.y,2);
    for(let attempt=0;attempt<35;attempt++){
      const frames=await readContractFrames();
      snapshot=frames.find(frame=>frame.name===name)??null;
      if(snapshot)return {package:name,contractName:snapshot.name,
        frameUrl:snapshot.frameUrl,fileRow:file.text,nodeIds:file.nodeIds};
      await sleep(150);
    }
    throw Error('Opening '+name+' assurance/contract.yaml from Package Overview did not load its exact Contract Designer Source: '+
      JSON.stringify({file,frames:await readContractFrames(),rows:await readTreeRows()}));
  }
  const classicGroups=['Skill Definition','Assurance · 3/3 core','Schemas · 10','Scripts · 5','References · 3'];
  const masGroups=['Skill Definition','Assurance · 3/3 core','Schemas · 1'];
  const classicView=await ensurePackageExpanded('establish-pdu-session');
  const classicRange=classicView.range;
  const classicVisible=classicView.rows.slice(classicRange.index+1,classicRange.end)
    .filter(row=>row.visible).map(row=>row.text);
  for(const group of classicGroups)
    if(!classicVisible.some(text=>text.includes(group)))
      throw Error('Traditional 5GC Package is missing group '+group+': '+JSON.stringify(classicVisible));
  const classicContract=await openPackageContract('establish-pdu-session');
  const masView=await ensurePackageExpanded('establish-pdu-session-mas');
  const masVisible=masView.rows.slice(masView.range.index+1,masView.range.end)
    .filter(row=>row.visible).map(row=>row.text);
  for(const group of masGroups)
    if(!masVisible.some(text=>text.includes(group)))
      throw Error('MAS Package is missing group '+group+': '+JSON.stringify(masVisible));
  const masContract=await openPackageContract('establish-pdu-session-mas');
  if(classicContract.contractName!=='establish-pdu-session'||
     masContract.contractName!=='establish-pdu-session-mas'||
     classicContract.contractName===masContract.contractName)
    throw Error('Package file navigation did not preserve each exact Contract URI: '+
      JSON.stringify({classicContract,masContract}));
  await invoke('skillStudio.refreshPackages');
  await invoke('skillStudio.refreshPackages');
  const postExpansion=await evalJS('window.__skillStudioLastCommandResult??null');
  if(!postExpansion?.treeReadsByKind||
     postExpansion.treeReadsByKind.package<2||
     postExpansion.treeReadsByKind.group<2)
    throw Error('Both Package and Assurance children must be requested by Theia TreeView: '+
      JSON.stringify({postExpansion,classicVisible,masVisible}));
  const previous=activityState?.previous;
  let restoredActivity=null;
  if(previous&&previous.label!=='Skill Studio'){
    restoredActivity=await evalJS(
      "(()=>{const tabs=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')]"+
      ".filter(x=>x.textContent.trim()==="+JSON.stringify(previous.label)+"&&"+
      "x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&"+
      "x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&"+
      "x.getBoundingClientRect().y<innerHeight);"+
      "const el=tabs.sort((a,b)=>Math.abs(a.getBoundingClientRect().x+"+
      "a.getBoundingClientRect().width/2-"+previous.x+")-"+
      "Math.abs(b.getBoundingClientRect().x+b.getBoundingClientRect().width/2-"+previous.x+"))[0];"+
      "const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,label:el.textContent.trim()}:null;})()");
    if(restoredActivity){
      await click(restoredActivity.x,restoredActivity.y);
      await sleep(250);
    }
  }
  const restored=await evalJS(
    "(()=>[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')]"+
    ".find(x=>x.classList.contains('theia-mod-active'))?.textContent.trim()??null)()");
  if(previous&&previous.label!=='Skill Studio'&&restored!==previous.label)
    throw Error('Package Overview did not restore the previous Activity Bar view: '+
      JSON.stringify({previous,restored,restoredActivity}));
  const evidence={
    skills:[{
      name:'establish-pdu-session',files:classic.fileCount,core:'3/3',
      groups:classicGroups,contract:classicContract
    },{
      name:'establish-pdu-session-mas',files:mas.fileCount,core:'3/3',
      groups:masGroups,contract:masContract
    }],
    treeVisible:true,scanState:scan.state,
    treeReadsByKind:postExpansion.treeReadsByKind,
    exactPackageUris:true,restoredActivity:restored
  };
  console.log('STUDIO_PACKAGE_OVERVIEW_TWO_SKILLS_CHROMIUM',JSON.stringify(evidence));
  return {required:true,twoSkills:true,evidence};
}


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
    try{await evalJS(`(async()=>{const c=window.theia.container;const key=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&k.prototype?.executeCommand&&k.prototype?.registerCommand&&k.prototype?.getCommand);if(!key)throw Error('Native command registry missing');const registry=c.get(key),id=${JSON.stringify(id)};if(id==="navigator.reveal"){const openerKey=[...c._bindingDictionary._map.keys()].find(k=>String(k)==="Symbol(OpenerService)");const openers=await c.get(openerKey).getOpeners();const custom=openers.find(x=>x.id==="custom-editor-skillStudio.procedurePreview");const resource=custom?.widgetManager.getWidgets("plugin-custom-editor").find(w=>w.resource?.path.toString().endsWith("/assurance/procedure.yaml"))?.resource;if(!resource)throw Error("Procedure native resource missing");await registry.executeCommand(id,resource);}else window.__skillStudioLastCommandResult=await registry.executeCommand(id,...${JSON.stringify(args)});})()`);}
    catch(error){throw Error("Native command "+id+": "+error.message);}
    await sleep(300);
  }
  async function invokeSkillPackageFile(id,relativePath){
    console.log("STUDIO_NATIVE_ACTION",id,relativePath);
    await evalJS(`(async()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      if(!key)throw Error('Native command registry missing');
      const registry=c.get(key);
      const openerKey=[...c._bindingDictionary._map.keys()].find(k=>
        String(k)==='Symbol(OpenerService)');
      const openers=await c.get(openerKey).getOpeners();
      const custom=openers.find(x=>x.id==='custom-editor-skillStudio.procedurePreview');
      const widget=custom?.widgetManager.getWidgets('plugin-custom-editor').find(w=>
        w.resource?.path.toString().includes(
          '/skills/establish-pdu-session/assurance/procedure.yaml'));
      const procedureUri=widget?.resource;
      if(!procedureUri)throw Error('Conventional 5GC Procedure URI missing');
      const procedureUriString=procedureUri.toString();
      const procedureSuffix='/assurance/procedure.yaml';
      if(!procedureUriString.endsWith(procedureSuffix))
        throw Error('Conventional Procedure URI has an unexpected path');
      const targetUriString=procedureUriString.slice(0,-procedureSuffix.length)+
        '/'+${JSON.stringify(relativePath)};
      await registry.executeCommand(${JSON.stringify(id)},targetUriString);
    })()`);
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
  const activity=await evalJS(`(()=>{const candidates=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')].filter(x=>x.textContent.trim()==='Skill Studio'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().y>=0&&x.getBoundingClientRect().x<innerWidth&&x.getBoundingClientRect().y<innerHeight);const el=candidates.find(x=>x.classList.contains('lm-mod-current'))??candidates[0];const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,active:el.classList.contains('lm-mod-current')}:null;})()`);
  if(!activity)throw Error('Native Skill Studio Activity Bar entry missing');
  // C4 may already have opened this Activity Bar container. Clicking an
  // active Theia viewlet toggles it closed, so only open it when inactive.
  if(!activity.active){await click(activity.x,activity.y);await sleep(500);}
  const views=await evalJS(`({text:document.body.innerText,trees:document.querySelectorAll('.theia-Tree').length})`);
  for(const name of ['Packages','Inspection','Outline','Evidence','Problems'])if(!views.text.toLowerCase().includes(name.toLowerCase()))throw Error('Native view missing: '+name);
  const problemsHeader=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-view-container-part-header')].find(x=>x.textContent.trim().toLowerCase()==='problems'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0);el?.scrollIntoView({block:'center'});const r=el?.getBoundingClientRect();const part=el?.closest('.part');const collapsed=el?.getAttribute('aria-expanded')==='false'||/collapsed/.test(part?.className??'');return r?{x:r.x+r.width/2,y:r.y+r.height/2,collapsed}:null;})()`);
  const problemHeaderDiagnostics=await evalJS(`[...document.querySelectorAll('.theia-view-container-part-header')].filter(x=>x.textContent.trim().toLowerCase()==='problems').map(x=>({className:x.className,ariaExpanded:x.getAttribute('aria-expanded'),parent:x.parentElement?.className,part:x.closest('.part')?.className,view:x.closest('.theia-view-container')?.id,rect:(()=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()}))`);
  console.log('STUDIO_PROBLEMS_HEADERS',JSON.stringify(problemHeaderDiagnostics));
  if(problemsHeader?.collapsed){await click(problemsHeader.x,problemsHeader.y);await sleep(250);}
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
  // The preview/pin probe can leave both preview and pinned editors alive.
  // Close that pair and reopen one pinned Procedure before Source/Evidence
  // checks so the active Webview frame and its selection are unambiguous.
  await invoke('core.close.all.main.tabs');
  await invoke('workbench.files.action.focusFilesExplorer');
  file=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.trim()==='procedure.yaml'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().x<innerWidth);el?.scrollIntoView({block:'center',inline:'nearest'});const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
  if(!file)throw Error('Procedure file disappeared after closing preview/pinned tabs');
  await click(file.x,file.y,2);
  let singlePinned=null;
  for(let attempt=0;attempt<100&&!singlePinned;attempt++){
    singlePinned=await graph('ue-requested-pdu-session-establishment');
    if(!singlePinned)await sleep(100);
  }
  if(!singlePinned)throw Error('Could not reopen one pinned 5GC Procedure editor');
  const remainingProcedureTabs=await evalJS(`[...document.querySelectorAll('.lm-TabBar-tab')].filter(tab=>
    tab.textContent.trim()==='procedure.yaml'&&tab.getBoundingClientRect().width>0).length`);
  if(remainingProcedureTabs!==1)
    throw Error('Procedure Source/Evidence acceptance requires one unambiguous editor tab: '+
      JSON.stringify({remainingProcedureTabs,singlePinned}));
  // Theia CustomEditor tabs do not necessarily activate a VS Code TextEditor.
  // Package Audit consumes the active Procedure TextDocument, so open Source
  // from this freshly reopened CustomEditor only now (after the Explorer path).
  const sourceOpenedForAudit=await evalWebviewJS(`(()=>{const button=document.querySelector('#openSource');if(!button)return false;button.click();return true;})()`);
  if(!sourceOpenedForAudit)throw Error('Reopened Procedure Webview did not expose its native Source action');
  console.log('STUDIO_NATIVE_SOURCE_OPENED_FOR_AUDIT',sourceOpenedForAudit);
  await sleep(500);
  // Explorer is active after the native file-open path. Re-activate Skill
  // Studio so the Problems-owned Package Audit status is actually visible.
  const skillStudioActivityAfterOpen=await evalJS(`(()=>{
    const el=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')]
      .find(x=>x.textContent.trim()==='Skill Studio'&&
        x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&
        x.getBoundingClientRect().x<innerWidth);
    const r=el?.getBoundingClientRect();
    return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;
  })()`);
  if(!skillStudioActivityAfterOpen)
    throw Error('Skill Studio Activity Bar entry missing after CustomEditor open');
  await click(skillStudioActivityAfterOpen.x,skillStudioActivityAfterOpen.y);
  await sleep(350);
  const auditProblemsHeader=await evalJS(`(()=>{
    const container=[...document.querySelectorAll('.theia-view-container')]
      .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
    const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
      .find(x=>x.textContent.trim().toLowerCase()==='problems');
    header?.scrollIntoView({block:'center'});
    const r=header?.getBoundingClientRect(),part=header?.closest('.part');
    return r?{x:r.x+r.width/2,y:r.y+r.height/2,
      collapsed:part?.classList.contains('collapsed')??false,
      containerFound:!!container}:null;
  })()`);
  if(!auditProblemsHeader)
    throw Error('Skill Studio Problems view is missing after reactivation');
  if(auditProblemsHeader.collapsed){
    await click(auditProblemsHeader.x,auditProblemsHeader.y);await sleep(250);
  }
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
  // Resolve the Evidence part inside the exact Skill Studio view container.
  // Avoid matching an unrelated tab/label when Theia has multiple split panels.
  const readEvidenceHeader=()=>evalJS(`(()=>{
    const container=[...document.querySelectorAll('.theia-view-container')]
      .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
    const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
      .find(x=>x.textContent.trim().toLowerCase()==='evidence');
    if(!container||!header)return {found:false,containerFound:!!container,
      headers:[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .map(x=>x.textContent.trim())};
    header.scrollIntoView({block:'center',inline:'nearest'});
    const r=header.getBoundingClientRect(),part=header.closest('.part');
    const rootPresent=[...(part?.querySelectorAll('.theia-TreeNode')??[])].some(x=>
      x.innerText.includes('Source evidence only')&&x.getBoundingClientRect().height>0);
    // The last panel header can be partially covered by the status bar.
    // Pick an on-screen, hit-tested point instead of assuming its centre is clickable.
    const xs=[r.x+Math.min(12,r.width/4),r.x+r.width/2,r.right-Math.min(12,r.width/4)];
    const ys=[r.y+Math.min(4,r.height/3),r.y+r.height/2,r.bottom-Math.min(4,r.height/3)];
    const points=ys.flatMap(y=>xs.map(x=>({x,y})));
    const point=points.find(({x,y})=>x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&
      ((hit)=>hit===header||header.contains(hit))(document.elementFromPoint(x,y)));
    return {found:true,x:point?.x??null,y:point?.y??null,
      hitWithinHeader:!!point,collapsed:part?.classList.contains('collapsed')??false,
      rootPresent,partClass:part?.className??'',headerText:header.textContent.trim(),
      containerId:container.id,rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      viewportHeight:innerHeight};
  })()`);
  let evidenceHeader=null;
  for(let attempt=0;attempt<12;attempt++){
    evidenceHeader=await readEvidenceHeader();
    if(!evidenceHeader?.found)
      throw Error('Native Evidence view header is missing from Skill Studio container: '+
        JSON.stringify(evidenceHeader));
    if(!evidenceHeader.collapsed)break;
    if(!evidenceHeader.hitWithinHeader)
      throw Error('Native Evidence header is obscured and cannot be expanded by mouse: '+
        JSON.stringify(evidenceHeader));
    await click(evidenceHeader.x,evidenceHeader.y);
    await sleep(200);
  }
  evidenceHeader=await readEvidenceHeader();
  if(evidenceHeader?.collapsed)
    throw Error('Native Evidence header stayed collapsed after trusted mouse clicks: '+
      JSON.stringify(evidenceHeader));
  await invoke('skillStudio.auditPackage');
  // auditPackage publishes the refreshed owner-file snapshot. Its source
  // projection refreshes Evidence when that snapshot changes; wait for the
  // Evidence root and dataflow row rather than scheduling another audit.
  let evidenceTreeState=null;
  for(let attempt=0;attempt<100;attempt++){
    evidenceTreeState=await evalJS(`(()=>{
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const rows=[...(part?.querySelectorAll('.theia-TreeNode')??[])].map(node=>{
        const content=[...node.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return {node,content,text:content?.innerText?.trim()??''};
      }).filter(row=>row.content?.getBoundingClientRect().height>0);
      return {containerFound:!!container,headerFound:!!header,
        partClass:part?.className??'',rootPresent:rows.some(row=>
          row.text.includes('Source evidence only')),
        labels:rows.map(row=>row.text).slice(-24),
        partText:part?.innerText?.slice(-1800)??''};
    })()`);
    if(evidenceTreeState?.rootPresent)break;
    await sleep(100);
  }
  if(!evidenceTreeState?.rootPresent)
    throw Error('Native Evidence tree root did not appear after refresh: '+
      JSON.stringify(evidenceTreeState));
  // Re-select the Phase Binding Node after activating the native Evidence
  // container; Theia may replace the active Webview context during the switch.
  // Resolve the active Procedure Webview again after activating the native
  // Evidence container. The earlier graphContext can belong to a disposed or
  // background CustomEditor when Theia has multiple procedure.yaml tabs.
  const evidenceNodeTarget=await evalWebviewJS(
    `(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='nudm-sdm-subscribe');if(!node)throw Error('Evidence binding Node is not in the active Procedure graph');const r=node.getBoundingClientRect(),frame=window.frameElement?.getBoundingClientRect();return {node:node.getAttribute('data-id'),procedure:document.querySelector('#procedureList')?.value,nodeRect:{x:r.x,y:r.y,width:r.width,height:r.height},frameRect:frame?{x:frame.x,y:frame.y,width:frame.width,height:frame.height}:null,point:frame?{x:frame.x+r.x+r.width/2,y:frame.y+r.y+r.height/2}:null};})()`
  );
  if(!evidenceNodeTarget?.node||!evidenceNodeTarget.point)
    throw Error('Could not resolve the active 5GC Phase Binding node hit target: '+
      JSON.stringify(evidenceNodeTarget));
  // Use a real trusted Chromium click in the visible editor instead of
  // HTMLElement.click(), so React Flow and the host selection bridge receive
  // the same pointer/click sequence as a user action.
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',
    x:evidenceNodeTarget.point.x,y:evidenceNodeTarget.point.y});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',
    x:evidenceNodeTarget.point.x,y:evidenceNodeTarget.point.y,
    button:'left',buttons:1,clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',
    x:evidenceNodeTarget.point.x,y:evidenceNodeTarget.point.y,
    button:'left',buttons:0,clickCount:1});
  console.log('STUDIO_EVIDENCE_NODE_TRUSTED_CLICK',JSON.stringify(evidenceNodeTarget));
  await sleep(350);
  let phaseEvidenceText='';
  for(let i=0;i<100;i++){
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(phaseEvidenceText.includes('Producer / Consumer dataflow'))break;
    await sleep(100);
  }
  // The native TreeDataProvider can publish its rows after the visible
  // summary text. Await the actual row inside the Evidence part, not another
  // TreeView that happens to contain similarly named items.
  let dataflowTreeRow=null,evidenceRows=null;
  for(let attempt=0;attempt<100&&!dataflowTreeRow;attempt++){
    evidenceRows=await evalJS(`(()=>{
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const rows=[...(part?.querySelectorAll('.theia-TreeNode')??[])].map(node=>{
        const content=[...node.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return {node,content,text:content?.innerText?.trim()??''};
      }).filter(row=>row.text.includes('Producer / Consumer dataflow')&&
        row.content?.getBoundingClientRect().height>0);
      const row=rows[0];
      if(!row?.content)return {found:false,candidateCount:rows.length,
        labels:[...(part?.querySelectorAll('.theia-TreeNode')??[])].map(node=>{
          const child=[...node.children].find(x=>x.classList?.contains('theia-TreeNodeContent'));
          return child?.innerText?.trim()??'';
        }).slice(-24),partClass:part?.className??''};
      row.content.scrollIntoView({block:'center',inline:'nearest'});
      const r=row.content.getBoundingClientRect();
      if(!r.width||!r.height)return {found:false,candidateCount:rows.length,
        rowText:row.text,partClass:part?.className??''};
      const toggle=row.node.querySelector('.theia-ExpansionToggle');
      const tr=toggle?.getBoundingClientRect();
      const x=tr?tr.x+tr.width/2:r.x+12;
      const y=tr?tr.y+tr.height/2:r.y+r.height/2;
      const hit=document.elementFromPoint(x,y);
      const describe=element=>{
        if(!element)return null;
        const style=getComputedStyle(element),box=element.getBoundingClientRect();
        return {tag:element.tagName,id:element.id,className:typeof element.className==='string'?element.className:'',
          nodeId:element.getAttribute('data-node-id'),text:element.textContent?.trim().slice(0,100)??'',
          pointerEvents:style.pointerEvents,visibility:style.visibility,display:style.display,
          zIndex:style.zIndex,rect:{x:box.x,y:box.y,width:box.width,height:box.height}};
      };
      return r?{found:true,x,y,
        toggleFound:!!toggle,toggleClass:toggle?.className??null,
        toggleRect:tr?{x:tr.x,y:tr.y,width:tr.width,height:tr.height}:null,
        hit:describe(hit),hitIsToggle:hit===toggle,hitWithinToggle:!!toggle&&toggle.contains(hit),
        hitStack:document.elementsFromPoint(x,y).slice(0,6).map(describe),
        expanded:!!toggle&&!toggle.classList.contains('theia-mod-collapsed'),
        rowHeight:r.height,rowText:row.text,viewportHeight:innerHeight,
        candidateCount:rows.length}:{
          found:false,candidateCount:rows.length,
          labels:[...(part?.querySelectorAll('.theia-TreeNode')??[])].map(node=>{
            const child=[...node.children].find(x=>x.classList?.contains('theia-TreeNodeContent'));
            return child?.innerText?.trim()??'';
          }).slice(-24),
          partClass:part?.className??''
        };
    })()`);
    if(evidenceRows?.found)dataflowTreeRow=evidenceRows;
    else {
      // The Evidence root can be expanded while its Phase group remains
      // collapsed. Expand that actual parent row before waiting for the
      // nested Producer / Consumer dataflow item; do not mistake hidden
      // descendants for a provider-refresh race.
      const phaseGroup=await evalJS(`(()=>{
        const container=[...document.querySelectorAll('.theia-view-container')]
          .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
        const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
          .find(x=>x.textContent.trim().toLowerCase()==='evidence');
        const part=header?.closest('.part');
        const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(node=>{
          const content=[...node.children].find(child=>
            child.classList?.contains('theia-TreeNodeContent'));
          return content?.innerText?.replace(/\\s+/g,' ').trim()
            .includes('await-initial-resources · postconditions');
        });
        const toggle=row?.querySelector('.theia-ExpansionToggle');
        const r=toggle?.getBoundingClientRect();
        return toggle&&r?.width&&r?.height&&
          toggle.classList.contains('theia-mod-collapsed')
          ?{x:r.x+r.width/2,y:r.y+r.height/2,label:row.innerText.trim()}
          :null;
      })()`);
      if(phaseGroup){
        await click(phaseGroup.x,phaseGroup.y);
        await sleep(120);
      }else await sleep(100);
    }
  }
  if(!dataflowTreeRow)throw Error('Native Evidence dataflow row is missing after scoped readiness wait: '+
    JSON.stringify({evidenceHeader,evidenceTreeState,evidenceRows,
      bodyTail:(await evalJS('document.body.innerText')).slice(-1600)}));
  if(!dataflowTreeRow.toggleFound)
    throw Error('Native Evidence dataflow row has no Theia expansion toggle: '+
      JSON.stringify(dataflowTreeRow));
  let evidenceModelSetup=null,liveToggle=null,toggleInstrumentation=null;
  if(!dataflowTreeRow.expanded){
    if(!dataflowTreeRow.hitWithinToggle)
      throw Error('Native Evidence toggle is obscured at its click point: '+JSON.stringify(dataflowTreeRow));
    evidenceModelSetup=await evalJS(`(()=>{
      const c=window.theia?.container;
      const serviceKeys=[...(c?._bindingDictionary?._map?.keys()??[])];
      const managerKey=serviceKeys.find(key=>typeof key==='function'&&
        typeof key.prototype?.getWidgets==='function'&&
        typeof key.prototype?.getOrCreateWidget==='function');
      if(!managerKey)return {found:false,reason:'WidgetManager unavailable'};
      const manager=c.get(managerKey);
      const widget=manager.getWidgets('plugin-view-data')?.find(item=>item.id==='skillStudio.evidence');
      if(!widget)return {found:false,reason:'Evidence widget unavailable'};
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(item=>{
        const caption=[...item.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return caption?.innerText?.includes('Producer / Consumer dataflow');
      });
      const toggle=row?.querySelector('.theia-ExpansionToggle');
      const node=widget.model?.getNode(toggle?.getAttribute('data-node-id'));
      const model=widget.model,tree=model?.tree;
      const trace=window.__skillStudioEvidenceModelTrace={
        toggleCalls:[],refreshCalls:[],fetchCalls:[],expansionEvents:[]
      };
      if(model&&typeof model.toggleNodeExpansion==='function'){
        const original=model.toggleNodeExpansion.bind(model);
        model.toggleNodeExpansion=async function(target){
          const record={id:target?.id??null,before:target?.expanded??null,
            sameNode:target===node,expandOnly:widget.props?.expandOnlyOnExpansionToggleClick};
          trace.toggleCalls.push(record);
          try{await original(target);record.after=target?.expanded??null;record.childCount=target?.children?.length??null;}
          catch(error){record.error=String(error?.message??error);throw error;}
        };
      }
      if(tree&&typeof tree.refresh==='function'){
        const original=tree.refresh.bind(tree);
        tree.refresh=async function(parent,...args){
          const record={id:parent?.id??null,before:parent?.expanded??null,childCount:parent?.children?.length??null};
          trace.refreshCalls.push({...record,stage:'start'});
          try{const result=await original(parent,...args);trace.refreshCalls.push({...record,stage:'end',result:!!result,after:parent?.expanded??null,afterChildren:parent?.children?.length??null});return result;}
          catch(error){trace.refreshCalls.push({...record,stage:'error',error:String(error?.message??error)});throw error;}
        };
      }
      if(tree&&typeof tree.fetchChildren==='function'){
        const original=tree.fetchChildren.bind(tree);
        tree.fetchChildren=async function(proxy,parent,...args){
          const record={id:parent?.id??null,hasProxy:!!proxy};
          trace.fetchCalls.push({...record,stage:'start'});
          try{const children=await original(proxy,parent,...args);trace.fetchCalls.push({...record,stage:'end',count:children?.length??null,labels:(children??[]).map(item=>item.label??item.name??'').slice(0,8)});return children;}
          catch(error){trace.fetchCalls.push({...record,stage:'error',error:String(error?.message??error)});throw error;}
        };
      }
      model?.onExpansionChanged?.(target=>trace.expansionEvents.push({id:target?.id??null,expanded:target?.expanded??null,childCount:target?.children?.length??null}));
      return {found:true,widgetId:widget.id,expandOnlyOnExpansionToggleClick:widget.props?.expandOnlyOnExpansionToggleClick??null,
        hasProxy:!!tree?.proxy,nodeFound:!!node,nodeExpandable:!!node&&'children'in node&&'expanded'in node,
        nodeId:node?.id??null,nodeExpanded:node?.expanded??null,nodeChildren:node?.children?.length??null};
    })()`);
    console.log('STUDIO_EVIDENCE_MODEL_SETUP',JSON.stringify(evidenceModelSetup));
    if(!evidenceModelSetup?.nodeFound)throw Error('Native Evidence TreeView row could not be resolved to its live model node: '+JSON.stringify(evidenceModelSetup));
    await evalJS(`(()=>{
      window.__skillStudioEvidenceClickEvents=[];
      window.__skillStudioEvidenceBubbleEvents=[];
      const record=event=>{
        const toggle=event.target?.closest?.('.theia-ExpansionToggle');
        if(!toggle)return null;
        return {
          trusted:event.isTrusted,button:event.button,x:event.clientX,y:event.clientY,
          nodeId:toggle.getAttribute('data-node-id'),className:toggle.className,
          defaultPrevented:event.defaultPrevented,
          path:[...event.composedPath()].slice(0,10).map(item=>({
            tag:item?.tagName??'',id:item?.id??'',
            className:typeof item?.className==='string'?item.className:''
          }))
        };
      };
      document.addEventListener('click',event=>{
        const detail=record(event);
        if(detail)window.__skillStudioEvidenceClickEvents.push(detail);
      },true);
      document.addEventListener('click',event=>{
        const detail=record(event);
        if(detail)window.__skillStudioEvidenceBubbleEvents.push(detail);
      },false);
    })()`);
    // Resolve the live target after any layout/scroll work. Do not hover a
    // stale coordinate: the mousemove itself can trigger Theia SplitPanel
    // reflow and move the virtualized Evidence row underneath the pointer.
    let stableHit=0,lastPos=null;
    // Mouse hover and native SplitPanel resize may move the Evidence part
    // after the first successful hit-test. Only press once the live toggle
    // remains visible and hit-testable in consecutive browser frames.
    for(let attempt=0;attempt<24;attempt++){
      liveToggle=await evalJS(`(()=>{
        const container=[...document.querySelectorAll('.theia-view-container')]
          .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
        const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
          .find(x=>x.textContent.trim().toLowerCase()==='evidence');
        const part=header?.closest('.part');
        const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(node=>{
          const caption=[...node.children].find(child=>
            child.classList?.contains('theia-TreeNodeContent'));
          return caption?.innerText?.includes('Producer / Consumer dataflow');
        });
        const toggle=row?.querySelector('.theia-ExpansionToggle');
        if(!toggle)return null;
        const before=toggle.getBoundingClientRect();
        const firstHit=document.elementFromPoint(
          before.x+before.width/2,before.y+before.height/2);
        if(firstHit!==toggle&&!toggle.contains(firstHit))
          toggle.scrollIntoView({block:'center',inline:'nearest'});
        const rect=toggle.getBoundingClientRect();
        const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
        const hit=document.elementFromPoint(x,y);
        return {x,y,expanded:!toggle.classList.contains('theia-mod-collapsed'),
          hitWithinToggle:hit===toggle||toggle.contains(hit),
          hitTag:hit?.tagName??null,hitClass:typeof hit?.className==='string'?hit.className:'',
          viewport:{width:innerWidth,height:innerHeight}};
      })()`);
      if(liveToggle?.hitWithinToggle&&
        lastPos&&Math.abs(liveToggle.x-lastPos.x)<1&&
        Math.abs(liveToggle.y-lastPos.y)<1)stableHit++;
      else stableHit=0;
      if(liveToggle?.hitWithinToggle&&stableHit>=1)break;
      lastPos=liveToggle?.hitWithinToggle?{x:liveToggle.x,y:liveToggle.y}:null;
      // Keep the pointer untouched until the final press/release. This
      // avoids a hover-induced resize between hit-test and click.
      await sleep(120);
    }
    if(!liveToggle?.hitWithinToggle||stableHit<1)
      throw Error('Native Evidence expansion toggle remained obstructed after scroll/hover stabilization: '+
        JSON.stringify({dataflowTreeRow,liveToggle,stableHit}));
    toggleInstrumentation=await evalJS(`(()=>{
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(node=>{
        const caption=[...node.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return caption?.innerText?.includes('Producer / Consumer dataflow');
      });
      const toggle=row?.querySelector('.theia-ExpansionToggle');
      const c=window.theia?.container,keys=[...(c?._bindingDictionary?._map?.keys()??[])];
      const managerKey=keys.find(key=>typeof key==='function'&&
        typeof key.prototype?.getWidgets==='function'&&
        typeof key.prototype?.getOrCreateWidget==='function');
      const manager=managerKey?c.get(managerKey):null;
      const widget=manager?.getWidgets('plugin-view-data')?.find(item=>item.id==='skillStudio.evidence');
      const model=widget?.model,id=toggle?.getAttribute('data-node-id');
      const originalGet=model?.getNode?.bind(model);
      const originalToggle=model?.toggleNodeExpansion?.bind(model);
      window.__skillStudioEvidenceModelCalls=[];
      if(model&&originalGet)model.getNode=function(nodeId){
        const value=originalGet(nodeId);
        if(nodeId===id)window.__skillStudioEvidenceModelCalls.push({
          method:'getNode',found:!!value,expanded:value?.expanded,
          childCount:value?.children?.length??null
        });
        return value;
      };
      if(model&&originalToggle)model.toggleNodeExpansion=function(node){
        const record={method:'toggleNodeExpansion',nodeId:node?.id??null,
          expandedBefore:node?.expanded??null,childCountBefore:node?.children?.length??null};
        window.__skillStudioEvidenceModelCalls.push(record);
        let result;
        try{result=originalToggle(node);}
        catch(error){record.error=String(error?.message??error);throw error;}
        return Promise.resolve(result).then(value=>{
          record.resolved=true;record.value=value;
          const latest=originalGet(node?.id);
          record.expandedAfter=latest?.expanded??null;
          record.childCountAfter=latest?.children?.length??null;
          return value;
        },error=>{
          record.rejected=String(error?.message??error);throw error;
        });
      };
      return {widgetFound:!!widget,widgetType:widget?.constructor?.name??null,
        props:{expandOnlyOnExpansionToggleClick:widget?.props?.expandOnlyOnExpansionToggleClick,
          multiSelect:widget?.props?.multiSelect},
        nodeFound:!!originalGet?.(id),nodeId:id,
        node:{expanded:originalGet?.(id)?.expanded,
          childCount:originalGet?.(id)?.children?.length??null,
          hasExpanded:'expanded' in (originalGet?.(id)??{})},
        methods:{getNode:typeof model?.getNode,toggleNodeExpansion:typeof model?.toggleNodeExpansion,
          isExpandable:typeof widget?.isExpandable},
        isExpandable:typeof widget?.isExpandable==='function'
          ?widget.isExpandable(originalGet?.(id)):null};
    })()`);
    if(!toggleInstrumentation.widgetFound||!toggleInstrumentation.nodeFound)
      throw Error('Evidence TreeWidget instrumentation could not resolve the live model: '+
        JSON.stringify(toggleInstrumentation));
    if(!liveToggle.expanded){
      // CDP requires the pressed-button bitmask as well as the button name;
      // without it Chromium emits no trusted click event for this native row.
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:liveToggle.x,y:liveToggle.y,
        button:'left',buttons:0,clickCount:1,pointerType:'mouse'});
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:liveToggle.x,y:liveToggle.y,
        button:'none',buttons:0,pointerType:'mouse'});
      await sleep(100);
      const postHoverToggle=await evalJS(`(()=>{
        const container=[...document.querySelectorAll('.theia-view-container')]
          .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
        const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
          .find(x=>x.textContent.trim().toLowerCase()==='evidence');
        const part=header?.closest('.part');
        const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(node=>{
          const caption=[...node.children].find(child=>
            child.classList?.contains('theia-TreeNodeContent'));
          return caption?.innerText?.includes('Producer / Consumer dataflow');
        });
        const toggle=row?.querySelector('.theia-ExpansionToggle');
        const rect=toggle?.getBoundingClientRect();
        const x=rect?rect.x+rect.width/2:0,y=rect?rect.y+rect.height/2:0;
        const hit=rect?document.elementFromPoint(x,y):null;
        const ancestors=[];
        for(let element=toggle;element;element=element.parentElement){
          const style=getComputedStyle(element),box=element.getBoundingClientRect();
          if(element.scrollHeight>element.clientHeight+1||
             /auto|scroll|overlay/.test(style.overflowY))
            ancestors.push({tag:element.tagName,id:element.id,
              className:typeof element.className==='string'?element.className:'',
              top:box.top,bottom:box.bottom,height:box.height,
              scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,
              clientHeight:element.clientHeight,overflowY:style.overflowY});
        }
        return {x,y,expanded:!toggle?.classList.contains('theia-mod-collapsed'),
          hitWithinToggle:!!toggle&&(hit===toggle||toggle.contains(hit)),
          hitTag:hit?.tagName??null,hitClass:typeof hit?.className==='string'?hit.className:'',
          ancestors};
      })()`);
      if(!postHoverToggle?.hitWithinToggle)
        throw Error('Evidence toggle moved out of hit target after hover: '+
          JSON.stringify({liveToggle,postHoverToggle}));
      liveToggle=postHoverToggle;
      await command('Input.dispatchMouseEvent',{type:'mousePressed',x:liveToggle.x,y:liveToggle.y,
        button:'left',buttons:1,clickCount:1,pointerType:'mouse'});
      await sleep(60);
      await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:liveToggle.x,y:liveToggle.y,
        button:'left',buttons:0,clickCount:1,pointerType:'mouse'});
    }
  }
  let dataflowExpansion=null;
  for(let attempt=0;attempt<50;attempt++){
    dataflowExpansion=await evalJS(`(()=>{
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const node=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(item=>{
        const caption=[...item.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return caption?.innerText?.includes('Producer / Consumer dataflow');
      });
      const toggle=node?.querySelector('.theia-ExpansionToggle');
      const labels=[...(part?.querySelectorAll('.theia-TreeNode')??[])].map(item=>{
        const caption=[...item.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return caption?.innerText?.trim()??'';
      }).filter(Boolean);
      const c=window.theia?.container;
      let serviceKeys=[],matchingServiceKeys=[],manager=null,managerError=null;
      let registry=null,registryError=null,treeWidgets=[],treeWidgetsError=null;
      let evidenceWidget=null,modelNode=null,modelError=null,reactPropsKey=null,reactProps=null;
      try{serviceKeys=[...(c?._bindingDictionary?._map?.keys()??[])];}
      catch(error){managerError='service keys: '+String(error?.message??error);}
      try{
        matchingServiceKeys=serviceKeys.filter(key=>
          /WidgetManager|PluginViewRegistry/.test((key?.name??'')+' '+String(key))
        ).map(key=>({name:key?.name??'',text:String(key).slice(0,180)}));
      }catch(error){managerError='service key match: '+String(error?.message??error);}
      try{
        // The production bundle minifies DI class names, so locate the real
        // WidgetManager by its public method rather than constructor.name.
        const managerKey=serviceKeys.find(key=>
          typeof key==='function'&&typeof key.prototype?.getWidgets==='function'&&
          typeof key.prototype?.getOrCreateWidget==='function');
        if(managerKey){
          manager=c.get(managerKey);
          matchingServiceKeys.push({name:managerKey.name??'',text:'WidgetManager#getWidgets'});
        }
      }catch(error){managerError=String(error?.message??error);}
      try{
        const registryKey=serviceKeys.find(key=>
          typeof key==='function'&&typeof key.prototype?.getView==='function');
        if(registryKey){
          registry=c.get(registryKey);
          matchingServiceKeys.push({name:registryKey.name??'',text:'PluginViewRegistry#getView'});
        }
      }catch(error){registryError=String(error?.message??error);}
      try{manager=manager??registry?.widgetManager??null;}
      catch(error){registryError='widgetManager: '+String(error?.message??error);}
      try{
        if(manager&&typeof manager.getWidgets==='function')
          treeWidgets=manager.getWidgets('plugin-view-data')??[];
        else treeWidgetsError='WidgetManager/getWidgets unavailable';
      }catch(error){treeWidgetsError=String(error?.message??error);}
      try{evidenceWidget=treeWidgets.find(widget=>widget.id==='skillStudio.evidence')??null;}
      catch(error){treeWidgetsError='find Evidence widget: '+String(error?.message??error);}
      try{modelNode=evidenceWidget?.model?.getNode(toggle?.getAttribute('data-node-id'))??null;}
      catch(error){modelError=String(error?.message??error);}
      try{
        reactPropsKey=toggle&&Object.keys(toggle).find(key=>key.startsWith('__reactProps$'));
        reactProps=reactPropsKey?toggle[reactPropsKey]:null;
      }catch(error){modelError='React props: '+String(error?.message??error);}
      return {found:!!node,toggleFound:!!toggle,
        toggleClass:toggle?.className??null,
        expanded:!!toggle&&!toggle.classList.contains('theia-mod-collapsed'),
        consumerAbi:labels.some(label=>label.includes('Consumer ABI')),
        clickEvents:window.__skillStudioEvidenceClickEvents??[],
        bubbleEvents:window.__skillStudioEvidenceBubbleEvents??[],
        modelCalls:window.__skillStudioEvidenceModelCalls??[],
        treeWidgets:treeWidgets.map(widget=>({id:widget.id,type:widget.constructor?.name,
          disposed:widget.isDisposed,visible:widget.isVisible,attached:widget.isAttached})),
        evidenceWidgetFound:!!evidenceWidget,modelType:evidenceWidget?.model?.constructor?.name??null,
        managerError,registryError,treeWidgetsError,matchingServiceKeys,
        modelNode:modelNode?{id:modelNode.id,name:modelNode.name,expanded:modelNode.expanded,
          childCount:modelNode.children?.length,parentId:modelNode.parent?.id??null,
          type:modelNode.constructor?.name??null}:null,
        reactPropsKey:reactPropsKey??null,reactOnClick:typeof reactProps?.onClick,
        labels:labels.slice(-16)};
    })()`);
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(dataflowExpansion?.expanded&&
       (dataflowExpansion.consumerAbi||phaseEvidenceText.includes('Consumer ABI')))break;
    await sleep(100);
  }
  if(!dataflowExpansion?.expanded){
    const directExpansionDiagnostic=await evalJS(`(async()=>{
      const c=window.theia?.container,keys=[...(c?._bindingDictionary?._map?.keys()??[])];
      const key=keys.find(item=>typeof item==='function'&&typeof item.prototype?.getWidgets==='function'&&typeof item.prototype?.getOrCreateWidget==='function');
      const widget=key?c.get(key).getWidgets('plugin-view-data')?.find(item=>item.id==='skillStudio.evidence'):null;
      const container=[...document.querySelectorAll('.theia-view-container')]
        .find(x=>x.id==='plugin-view-container:workbench.view.extension.skillStudio');
      const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
        .find(x=>x.textContent.trim().toLowerCase()==='evidence');
      const part=header?.closest('.part');
      const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(item=>{
        const caption=[...item.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        return caption?.innerText?.includes('Producer / Consumer dataflow');
      });
      const id=row?.querySelector('.theia-ExpansionToggle')?.getAttribute('data-node-id');
      const node=widget?.model?.getNode(id),before={found:!!node,expanded:node?.expanded??null,children:node?.children?.length??null,proxy:!!widget?.model?.tree?.proxy};
      try{if(node)await widget.model.expandNode(node);return {before,after:{expanded:node?.expanded??null,children:node?.children?.length??null}};}
      catch(error){return {before,error:String(error?.message??error),after:{expanded:node?.expanded??null,children:node?.children?.length??null}};}
    })()`);
    const modelTrace=await evalJS('window.__skillStudioEvidenceModelTrace??null');
    throw Error('Native Evidence dataflow arrow did not expand: '+
      JSON.stringify({dataflowTreeRow,liveToggle,toggleInstrumentation,dataflowExpansion,evidenceModelSetup,modelTrace,directExpansionDiagnostic}));
  }
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
  // A prior TextDocument edit may have scheduled a debounced Package Audit.
  // Do not start another native edit while that audit still owns the current
  // snapshot; wait for the exact Package Audit terminal state first.
  for(let attempt=0;attempt<100;attempt++){
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(/Package Audit · [0-9]+ editor warnings/.test(phaseEvidenceText))break;
    if(phaseEvidenceText.includes('Package Audit · unavailable'))
      throw Error('Package Audit became unavailable before Phase binding edit: '+
        phaseEvidenceText.slice(-1000));
    await sleep(100);
  }
  if(!/Package Audit · [0-9]+ editor warnings/.test(phaseEvidenceText))
    throw Error('Package Audit did not settle before Phase binding edit: '+
      phaseEvidenceText.slice(-1000));
  console.log('STUDIO_PHASE_DATAFLOW_EVIDENCE_CHROMIUM',JSON.stringify({
    ...phaseEvidence,auditReady:true
  }));
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
  const bindingResult=await evalJS(`window.__skillStudioCommandResult`);
  const afterBinding=await waitForRevisionChange(graphContext,beforeBinding.result?.value,
    'Native Phase Binding edit');
  if(bindingResult!==true||!afterBinding.result?.value||
     afterBinding.result.value===beforeBinding.result?.value)
    throw Error('Native Phase Binding edit did not commit a Source revision: '+
      JSON.stringify({bindingResult,before:beforeBinding.result?.value,
        after:afterBinding.result?.value}));
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
  // The LSP regression intentionally opens native Python Source. Re-select
  // the exact active Procedure's Source before the Outcome line/Undo probe;
  // never pick the first Monaco editor merely because it is visible.
  await evalWebviewJS(`document.querySelector("#openSource")?.click();true`);
  await sleep(350);
  const nativeEditor=await evalJS(`(()=>{
    const editors=[...document.querySelectorAll('.monaco-editor')];
    const chosen=editors.map((node,index)=>{
      const rect=node.getBoundingClientRect();
      const text=node.querySelector('.view-lines')?.innerText??'';
      return {index,x:rect.x,y:rect.y,width:rect.width,height:rect.height,text};
    }).find(rect=>rect.width>80&&rect.height>100&&rect.x>=0&&rect.y>=0&&
      rect.x+rect.width/2<innerWidth&&rect.y+rect.height/2<innerHeight&&
      rect.text.includes('ue-requested-pdu-session-establishment'));
    return chosen?{index:chosen.index,x:chosen.x,y:chosen.y,
      width:chosen.width,height:chosen.height,preview:chosen.text.slice(0,500)}:null;
  })()`);
  if(!nativeEditor)throw Error('Exact 5GC Procedure YAML Source editor was not activated for Outcome acceptance: '+
    JSON.stringify(await evalJS(`({tabs:[...document.querySelectorAll('.lm-TabBar-tab')].map(x=>({text:x.textContent.trim(),className:x.className})),editors:[...document.querySelectorAll('.monaco-editor')].map((node,index)=>({index,text:node.querySelector('.view-lines')?.innerText?.slice(0,300)??'',rect:(()=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()}))})`)));
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
  let markdown=false,markdownStyled=false,markdownStyleInfo=null;
  async function inspect(n){
    try{const w=await command('Page.createIsolatedWorld',{frameId:n.frame.id,worldName:'markdown-acceptance',grantUniveralAccess:true});
      const r=await command('Runtime.evaluate',{contextId:w.executionContextId,returnByValue:true,expression:`Boolean(document.querySelector('article h1')&&!document.querySelector('article script,article img'))`});
      markdown ||= r.result?.value===true;
      const styled=await command('Runtime.evaluate',{contextId:w.executionContextId,returnByValue:true,
        expression:`(()=>{const article=document.querySelector('article.markdown-preview');if(!article)return null;const css=getComputedStyle(article);const link=document.querySelector('link[href*="markdown-preview.css"]');return {href:link?.href??null,maxWidth:css.maxWidth,paddingLeft:css.paddingLeft,applied:Boolean(link&&css.maxWidth==='920px'&&parseFloat(css.paddingLeft)>0)};})()`});
      const info=styled.result?.value;
      if(info)markdownStyleInfo=info;
      markdownStyled ||= info?.applied===true;
    }catch{}
    for(const c of n.childFrames??[])await inspect(c);
  }
  // Stylesheets load asynchronously in browser-only Theia. Wait for computed
  // styles instead of trusting the mere presence of a <link> element.
  for(let attempt=0;attempt<20&&!markdownStyled;attempt++){
    const tree=await command('Page.getFrameTree');
    await inspect(tree.frameTree);
    if(!markdownStyled)await sleep(150);
  }
  if(!markdown)throw Error('Shared safe Markdown Preview did not render');
  if(!markdownStyled)throw Error('Theia Markdown preview did not apply packaged theme CSS: '+
    JSON.stringify(markdownStyleInfo));
  // Contract is a distinct source-backed CustomEditor, not a second Procedure graph.
  await invokeSkillPackageFile('skillStudio.openContract','assurance/contract.yaml');
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
  await invokeSkillPackageFile('skillStudio.openPredicates','assurance/predicates.yaml');
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
  // C3: real, source-backed JSON Schema field tree in the same Theia host.
  await invokeSkillPackageFile('skillStudio.openSchema','schemas/establishment-request.schema.yaml');
  let schemaView=null;
  for(let attempt=0;attempt<100&&!schemaView;attempt++){
    const schemaTree=await command('Page.getFrameTree');
    const frames=[];
    const collect=node=>{
      if(!node)return;
      frames.push(node.frame);
      for(const child of node.childFrames??[])collect(child);
    };
    collect(schemaTree.frameTree);
    for(const frame of frames.filter(x=>
        x.url.includes('/webview/index.html')||x.url.includes('.webview.'))){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'schema-designer-acceptance',
          grantUniveralAccess:true
        });
        const result=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,
          expression:"({title:document.title,fields:document.querySelectorAll('.field').length,names:[...document.querySelectorAll('.field-name')].map(x=>x.textContent.trim()),required:document.querySelectorAll('.required').length,text:document.querySelector('#tree')?.textContent??'',status:document.querySelector('#status')?.textContent??''})"
        });
        const candidate=result.result?.value;
        if(candidate?.title==='SKILL Schema Visual'&&candidate.fields>0){
          schemaView=candidate;break;
        }
      }catch{/* webview frames can disappear during editor activation */}
    }
    if(!schemaView)await sleep(100);
  }
  if(!schemaView || schemaView.fields<12 || schemaView.required<8 ||
     !schemaView.names.includes('sNssai') ||
     !schemaView.names.includes('sst') ||
     !schemaView.names.includes('requestedPduSessionType') ||
     !schemaView.text.includes('maximum: 16777214') ||
     !schemaView.text.includes('const: IPV4') ||
     !schemaView.status.includes('SOURCE VERSION'))
    throw Error('Schema Designer did not render real owner request fields: '+
      JSON.stringify(schemaView).slice(0,3000));
  console.log('STUDIO_SCHEMA_DESIGNER_CHROMIUM',JSON.stringify({
    title:schemaView.title,fields:schemaView.fields,required:schemaView.required,
    sourceVersion:schemaView.status,
    nestedSst:schemaView.names.includes('sst'),
    enumOrConst:schemaView.text.includes('const: IPV4')
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
  // Run dual-Skill Explorer acceptance last. Opening MAS switches the active
  // Procedure CustomEditor; running it earlier can stale later 5GC Inspector
  // selections even after the conventional editor has been restored.
  await invoke('workbench.files.action.focusFilesExplorer');
  const explorerRow=async(label,which='last')=>evalJS(
    "(()=>{const label="+JSON.stringify(label)+";const rows=[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return {node,content,text:content?.innerText?.trim()??''};}).filter(row=>row.text===label);const row="+(which==='first'?'rows[0]':'rows.at(-1)')+";if(!row)return {found:false,count:rows.length,labels:[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return content?.innerText?.trim()??'';}).slice(-30)};row.content.scrollIntoView({block:'center',inline:'nearest'});const r=row.content.getBoundingClientRect();const toggle=row.node.querySelector('.theia-ExpansionToggle');const tr=toggle?.getBoundingClientRect();const tx=tr?tr.x+tr.width/2:null,ty=tr?tr.y+tr.height/2:null;const hit=tr?document.elementFromPoint(tx,ty):null;return {found:true,x:r.x+r.width/2,y:r.y+r.height/2,expanded:row.node.getAttribute('aria-expanded'),className:row.node.className,ariaLevel:row.node.getAttribute('aria-level'),dataNodeId:row.node.getAttribute('data-node-id'),count:rows.length,toggleX:tx,toggleY:ty,toggleHit:!!toggle&&(hit===toggle||toggle.contains(hit)),toggleClass:toggle?.className??null};})()"
  );
  // Compiler-style project root: the Explorer owns skills/, lib/, output/.
  // Expand only the source directory before looking for the two Skill folders.
  let skillsFolder=null;
  for(let attempt=0;attempt<60;attempt++){
    skillsFolder=await explorerRow('skills');
    if(skillsFolder?.found)break;
    await sleep(100);
  }
  if(!skillsFolder?.found)
    throw Error('Project Explorer is missing the skills/ source directory: '+
      JSON.stringify(skillsFolder));
  if(String(skillsFolder.toggleClass).includes('theia-mod-collapsed')){
    await click(skillsFolder.x,skillsFolder.y);
    await sleep(180);
    const current=await explorerRow('skills');
    if(current?.toggleHit&&String(current.toggleClass).includes('theia-mod-collapsed'))
      await click(current.toggleX,current.toggleY);
  }
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
    // Theia Explorer can expand a directory from its row gesture even when
    // its arrow receives a click without changing the tree model. Exercise
    // that normal interaction first, then retry the arrow only if still collapsed.
    await click(masFolder.x,masFolder.y);
    for(let attempt=0;attempt<30;attempt++){
      assuranceRows=await explorerRow('assurance');
      if((assuranceRows?.count??0)>=2)break;
      await sleep(100);
    }
    if((assuranceRows?.count??0)<2){
      const current=await explorerRow('establish-pdu-session-mas');
      if(current?.toggleHit&&
         String(current.toggleClass).includes('theia-mod-collapsed')){
        await click(current.toggleX,current.toggleY);
        for(let attempt=0;attempt<30;attempt++){
          assuranceRows=await explorerRow('assurance');
          if((assuranceRows?.count??0)>=2)break;
          await sleep(100);
        }
      }
    }
  }
  if((assuranceRows?.count??0)<2)throw Error('MAS assurance folder did not expand in native Explorer: '+JSON.stringify({masFolder,assuranceRows}));
  let procedureRows=await explorerRow('procedure.yaml');
  if((procedureRows?.count??0)<2){
    const masAssurance=await explorerRow('assurance','last');
    if(!masAssurance?.found)throw Error('MAS assurance row missing after folder expansion');
    await click(masAssurance.x,masAssurance.y);
    for(let attempt=0;attempt<30;attempt++){
      procedureRows=await explorerRow('procedure.yaml');
      if((procedureRows?.count??0)>=2)break;
      await sleep(100);
    }
    if((procedureRows?.count??0)<2){
      const current=await explorerRow('assurance','last');
      if(current?.toggleHit&&
         String(current.toggleClass).includes('theia-mod-collapsed')){
        await click(current.toggleX,current.toggleY);
        for(let attempt=0;attempt<30;attempt++){
          procedureRows=await explorerRow('procedure.yaml');
          if((procedureRows?.count??0)>=2)break;
          await sleep(100);
        }
      }
    }
  }
  // A nested project can virtualize the first Skill's file row off-screen.
  // Do not require both identical filenames to be mounted in the DOM at once;
  // the opened CustomEditor URI and MAS graph below prove exact ownership.
  if(!procedureRows?.found)
    throw Error('Explorer did not expose a visible procedure.yaml file: '+
      JSON.stringify({masFolder,assuranceRows,procedureRows}));
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
  // Keep the Explorer proof isolated, then restore the conventional Procedure
  // so the final browser session remains on the primary example.
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
    root:'skill-studio-demo/skills',conventionalFolder:'establish-pdu-session',masFolder,
    assuranceRows,procedureRows,masProcedure,masProcedureGraph,masResourcePaths,
    conventionalProcedure,conventionalGraph
  };
  console.log('STUDIO_DUAL_SKILL_EXPLORER_CHROMIUM',JSON.stringify(dualSkillExplorer));
  console.log('STUDIO_LAYOUT_TIMING',JSON.stringify({initialTiming,warmTiming}));
  console.log('STUDIO_WORKBENCH_CHROMIUM' ,JSON.stringify({views:true,packageAudit:true,languageServiceStatus,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs}));
  return {views:true,packageAudit:true,languageServiceStatus,phaseEvidence,packageZip:packageZipEvidence,markdown:true,restored,initialTiming,warmTiming,nativeSingleClick:opened,nativeDoubleClick:pinned,reopenMs:openMs,dualSkillExplorer,namedStepRename:{accepted:namedRenameAccepted,applied:afterNamedRename.result?.value,undo:afterNamedRenameUndo.result?.value,oldStepName,newStepName},namedVerifyName:verifyName,outputReference,phaseRoute,phaseOutcome,workerFailureEvidence,recoveryEvidence};
}

// Keep native Explorer acceptance independent of the user's scroll position.
