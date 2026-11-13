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
    "return {previous:active?{label:active.textContent.trim(),x:r.x+r.width/2,y:r.y+r.height/2}:null};})()");
  // Package Explorer now belongs to the native Explorer, not a custom Activity Bar.
  await invoke('workbench.files.action.focusFilesExplorer');
  await sleep(400);
  const readTreeRows=()=>evalJS(
    "(()=>{const header=[...document.querySelectorAll('.theia-view-container-part-header')]"+
    ".find(x=>x.textContent.trim().toLowerCase()==='package explorer'&&"+
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
    throw Error('Package Overview did not populate inside the native Explorer: '+JSON.stringify(rows));
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
  if(classic?.fileCount!==13||classic?.corePresent!==3||
     mas?.fileCount!==5||mas?.corePresent!==3)
    throw Error('Two-SKILL inventory does not match the pinned sample manifest: '+
      JSON.stringify({classic,mas}));
  function assertGroupInventory(result,packageName,expected){
    const pkg=result?.packages?.find(item=>item.name===packageName);
    if(!pkg)throw Error('Package scan omitted '+packageName);
    const actual=Object.fromEntries((pkg.groups??[]).map(group=>[group.key,group.count]));
    const missing=(pkg.groups??[]).flatMap(group=>
      (group.missing??[]).map(file=>group.key+'/'+file));
    if(JSON.stringify(actual)!==JSON.stringify(expected)||missing.length)
      throw Error('Package group inventory mismatch for '+packageName+': '+
        JSON.stringify({actual,expected,missing}));
  }
  assertGroupInventory(scan,'establish-pdu-session',{
    definition:1,assurance:3,schemas:1,scripts:5,references:3
  });
  assertGroupInventory(scan,'establish-pdu-session-mas',{
    definition:1,assurance:3,schemas:1
  });

  // Dependencies must be a real section in the same native TreeView in both
  // backend and browser-only Theia. It starts collapsed and expands to the
  // owner-provided empty state; no second Dependencies view is permitted.
  const dependenciesRow=rows.find(row=>row.visible&&
    row.text.includes('Dependencies')&&
    row.text.includes('Plugin-managed snapshots and contracts'));
  if(!dependenciesRow)
    throw Error('Package Explorer is missing its composed Dependencies section: '+
      JSON.stringify(rows));
  if(!String(dependenciesRow.toggleClass??'').includes('theia-mod-collapsed'))
    throw Error('Dependencies must be collapsed by default: '+JSON.stringify(dependenciesRow));
  await clickVisibleToggle(dependenciesRow,'Dependencies section');
  let dependencyEmptyState=null;
  for(let attempt=0;attempt<40;attempt++){
    rows=await readTreeRows();
    dependencyEmptyState=rows.find(row=>row.visible&&
      row.text.includes('No dependencies'));
    if(dependencyEmptyState)break;
    await sleep(100);
  }
  if(!dependencyEmptyState)
    throw Error('Expanded Dependencies section did not show its real empty state: '+
      JSON.stringify(rows));
  const expandedDependencies=rows.find(row=>row.visible&&
    row.text.includes('Dependencies')&&
    row.text.includes('Plugin-managed snapshots and contracts'));
  if(!expandedDependencies)
    throw Error('Dependencies section disappeared after expansion');
  await clickVisibleToggle(expandedDependencies,'Dependencies collapse');
  let collapsedDependencies=null;
  for(let attempt=0;attempt<20;attempt++){
    rows=await readTreeRows();
    collapsedDependencies=rows.find(row=>row.visible&&
      row.text.includes('Dependencies')&&
      row.text.includes('Plugin-managed snapshots and contracts'));
    if(collapsedDependencies&&
       String(collapsedDependencies.toggleClass??'').includes('theia-mod-collapsed'))break;
    await sleep(100);
  }
  if(!collapsedDependencies||
     !String(collapsedDependencies.toggleClass??'').includes('theia-mod-collapsed'))
    throw Error('Dependencies section did not return to its collapsed state');

  const compositeEvidence={
    dependenciesVisible:true,
    dependenciesCollapsedByDefault:true,
    dependenciesExpandedToOwnerEmptyState:true,
    dependenciesCanCollapseAgain:true
  };
  if(!requireEditor){
    const evidence={
      skills:[
        {name:'establish-pdu-session',files:classic.fileCount,core:'3/3'},
        {name:'establish-pdu-session-mas',files:mas.fileCount,core:'3/3'}
      ],
      treeVisible:true,scanState:scan.state,composite:compositeEvidence
    };
    console.log('STUDIO_PACKAGE_EXPLORER_BROWSER_ONLY_CHROMIUM',JSON.stringify(evidence));
    return {required:true,twoSkills:true,browserOnlyInventory:true,evidence};
  }
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
  async function clickTreeContent(row,label,count=1){
    const target=await evalJS(`(()=>{
      const header=[...document.querySelectorAll('.theia-view-container-part-header')]
        .find(x=>x.textContent.trim().toLowerCase()==='package explorer'&&
          x.getBoundingClientRect().width>0);
      const part=header?.closest('.part');
      const nodes=[...(part?.querySelectorAll('.theia-TreeNode')??[])];
      const normalize=value=>value.replace(/\\s+/g,' ').trim();
      const el=nodes[${JSON.stringify(row.index)}];
      if(!el||normalize(el.innerText)!==${JSON.stringify(row.text)})
        return {found:false,index:${JSON.stringify(row.index)},
          actual:el?normalize(el.innerText):null,
          rows:nodes.map(node=>normalize(node.innerText)).slice(-12)};
      el.scrollIntoView({block:'center',inline:'nearest'});
      const content=el.querySelector('.theia-TreeNodeContent')??el;
      const r=content.getBoundingClientRect();
      const fractions=[.4,.55,.7,.85];
      const points=fractions.map(f=>({x:Math.round(r.x+r.width*f),y:Math.round(r.y+r.height/2)}));
      const point=points.find(({x,y})=>{
        if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
        const hit=document.elementFromPoint(x,y);
        return hit&&(hit===el||el.contains(hit))&&!hit.closest('.lm-SplitPanel-handle');
      });
      return {found:true,point:point??null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},
        className:el.className,hitClass:point?document.elementFromPoint(point.x,point.y)?.className??'':null};
    })()`);
    if(!target?.found||!target.point)
      throw Error('Package file row has no unobstructed native click target: '+label+' '+
        JSON.stringify({target,row}));
    await click(target.point.x,target.point.y,count);
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
    await clickTreeContent(file,name+' Contract');
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
    await clickTreeContent(file,name+' Contract retry',2);
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
  // Group membership and counts are asserted from the Package scan model
  // above. Theia virtualizes TreeView rows, so DOM visibility is not a
  // completeness signal. Here we verify the real Package row and Assurance
  // navigation path only.
  const conventionalPackageTop=await evalJS(`(()=>{
    const header=[...document.querySelectorAll('.theia-view-container-part-header')]
      .find(x=>x.textContent.trim().toLowerCase()==='package explorer'&&
        x.getBoundingClientRect().width>0);
    const part=header?.closest('.part');
    const row=[...(part?.querySelectorAll('.theia-TreeNode')??[])].find(el=>
      el.innerText.replace(/\\s+/g,' ').includes(
        'establish-pdu-session · 3/3 core ·'));
    row?.scrollIntoView({block:'start',inline:'nearest'});
    return Boolean(row);
  })()`);
  if(!conventionalPackageTop)
    throw Error('Traditional 5GC Package row disappeared after Dependencies interaction');
  await sleep(150);
  await ensurePackageExpanded('establish-pdu-session');
  const classicContract=await openPackageContract('establish-pdu-session');
  await ensurePackageExpanded('establish-pdu-session-mas');
  const masContract=await openPackageContract('establish-pdu-session-mas');
  if(classicContract.contractName!=='establish-pdu-session'||
     masContract.contractName!=='establish-pdu-session-mas'||
     classicContract.contractName===masContract.contractName)
    throw Error('Package file navigation did not preserve each exact Contract URI: '+
      JSON.stringify({classicContract,masContract}));
  await invoke('skillStudio.refreshPackages');
  await invoke('skillStudio.refreshPackages');
  const postExpansion=await evalJS('window.__skillStudioLastCommandResult??null');
  if(postExpansion?.state!=='ready'||postExpansion.packages?.length!==2)
    throw Error('Package Explorer refresh did not preserve both Package inventories: '+
      JSON.stringify(postExpansion));
  assertGroupInventory(postExpansion,'establish-pdu-session',{
    definition:1,assurance:3,schemas:1,scripts:5,references:3
  });
  assertGroupInventory(postExpansion,'establish-pdu-session-mas',{
    definition:1,assurance:3,schemas:1
  });
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
      groups:classic.groups.map(group=>({key:group.key,count:group.count})),contract:classicContract
    },{
      name:'establish-pdu-session-mas',files:mas.fileCount,core:'3/3',
      groups:mas.groups.map(group=>({key:group.key,count:group.count})),contract:masContract
    }],
    treeVisible:true,scanState:scan.state,
    composite:compositeEvidence,
    treeReadsByKind:postExpansion.treeReadsByKind,
    exactPackageUris:true,restoredActivity:restored
  };
  console.log('STUDIO_PACKAGE_OVERVIEW_TWO_SKILLS_CHROMIUM',JSON.stringify(evidence));
  return {required:true,twoSkills:true,evidence};
}


export async function runWorkbenchAcceptance({command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp=false}){
  if(!requireEditor)return {required:false};
  const click=async(x,y,count=1)=>{
    // Match the verified Package Explorer gesture: clear any stale button
    // state, move with an explicit pointer type, then send a complete press/release.
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,
      button:'left',buttons:0,clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,
      button:'none',buttons:0,pointerType:'mouse'});
    await sleep(100);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,
      button:'left',buttons:1,clickCount:count,pointerType:'mouse'});
    await sleep(100);
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,
      button:'left',buttons:0,clickCount:count,pointerType:'mouse'});
    await sleep(180);
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
  async function waitNativeMarkdown(predicate,label,attempts=100){
    let latest={frames:[],candidates:[]};
    for(let attempt=0;attempt<attempts;attempt++){
      try{
        const tree=await command('Page.getFrameTree');
        const frames=[];
        const walk=node=>{
          if(!node)return;
          frames.push(node.frame);
          for(const child of node.childFrames??[])walk(child);
        };
        walk(tree.frameTree);
        latest={frames:frames.map(frame=>({id:frame.id,url:frame.url})),candidates:[]};
        for(const frame of frames.filter(item=>/webview/i.test(item.url??''))){
          try{
            const world=await command('Page.createIsolatedWorld',{
              frameId:frame.id,worldName:'studio-native-markdown-acceptance',
              grantUniveralAccess:true
            });
            const evaluated=await command('Runtime.evaluate',{
              contextId:world.executionContextId,returnByValue:true,
              expression:`(()=> {
                const styles=[...document.querySelectorAll('link[rel~="stylesheet"]')]
                  .map(link=>link.href||link.getAttribute('href')||'');
                const headingNode=document.querySelector('h1');
                const heading=headingNode?.textContent?.trim()??null;
                const body=document.body;
                const csp=document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content??'';
                return {
                  url:location.href,
                  heading,
                  nativePreviewRoot:Boolean(body&&styles.some(url=>url.includes('/media/native-markdown-preview.css'))),
                  styles,
                  headingColor:headingNode?getComputedStyle(headingNode).color:null,
                  maxWidth:body?getComputedStyle(body).maxWidth:null,
                  anchorDetails:[...document.querySelectorAll('a')].map(anchor=>({
                    text:anchor.textContent.trim(),
                    href:anchor.getAttribute('href'),
                    resolvedHref:anchor.href
                  })),
                  imageCount:document.querySelectorAll('img').length,
                  scriptMarkers:[...document.scripts].filter(script=>
                    script.textContent.includes('skillStudioNativeMarkdownXss')).length,
                  scriptExecuted:window.skillStudioNativeMarkdownXss===true,
                  csp
                };
              })()`
            });
            const view=evaluated.result?.value;
            if(!view)continue;
            view.contextId=world.executionContextId;
            view.frameId=frame.id;
            latest.candidates.push({
              url:frame.url,heading:view.heading,nativePreviewRoot:view.nativePreviewRoot,
              styles:view.styles
            });
            if(predicate(view)){
              try{
                view.previewSettings=await nativeCommand(
                  'skillStudio.internal.nativeMarkdownSettingsAcceptance');
              }catch(error){
                view.previewSettings={error:String(error?.message??error)};
              }
              return {view,contextId:world.executionContextId,frameId:frame.id};
            }
          }catch{/* Preview frames can be replaced while Theia activates the extension. */}
        }
      }catch(error){
        latest.error=String(error?.message??error);
      }
      await sleep(100);
    }
    throw Error(label+' did not produce the expected native Markdown Preview in real Chromium: '+
      JSON.stringify(latest));
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
  if(requireBrowserLsp){
    const markdownStartup=await nativeCommand(
      'skillStudio.internal.nativeMarkdownWorkerStartupAcceptance');
    console.log('STUDIO_NATIVE_MARKDOWN_WORKER_STARTUP_CHROMIUM',
      JSON.stringify(markdownStartup));
    if(!markdownStartup?.isActive||markdownStartup.activationResult!=='ready'||
       !markdownStartup.workerAvailable||markdownStartup.workerProbe?.ok!==true||
       markdownStartup.workerProbe?.status!==200)
      throw Error('Native Markdown Language Server did not activate before workbench regression: '+
        JSON.stringify(markdownStartup));
  }
  await invoke('workbench.files.action.focusFilesExplorer');
  await sleep(350);
  // Authoring views belong to native Explorer; semantic Procedure Outline
  // remains distinct from Theia's built-in document-symbol Outline.
  const views=await evalJS(`(()=>{
    const headers=[...document.querySelectorAll('.theia-view-container-part-header')]
      .map(x=>({name:x.textContent.trim(),view:x.closest('.theia-view-container')?.id??''}))
      .filter(x=>x.name);
    const studioActivity=[...document.querySelectorAll('.theia-app-sides .lm-TabBar-tab')]
      .some(x=>x.textContent.trim()==='Skill Studio'&&x.getBoundingClientRect().width>0);
    return {text:document.body.innerText,headers,trees:document.querySelectorAll('.theia-Tree').length,studioActivity};
  })()`);
  for(const name of ['Package Explorer','Procedure Outline','Problems'])
    if(!views.headers.some(x=>x.name.toLowerCase()===name.toLowerCase()))
      throw Error('Native Explorer view missing '+name+': '+JSON.stringify(views));
  if(views.studioActivity)
    throw Error('A separate Skill Studio Activity Bar container must not compete with Explorer');
  const inspectorPlacement=await evalJS(`(()=>{const tabs=[...document.querySelectorAll('.lm-TabBar-tab')].filter(x=>x.textContent.trim().toLowerCase()==='inspector').map(x=>{const r=x.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,parent:x.parentElement?.className??'',container:x.closest('.theia-view-container')?.id??null};}).filter(x=>x.width>0);return {found:tabs.some(x=>x.x>innerWidth/2),tabs,viewportWidth:innerWidth};})()`);
  const rightInspector=inspectorPlacement.tabs.find(x=>x.x>inspectorPlacement.viewportWidth/2);
  if(!rightInspector)throw Error('Inspector was not placed in the native right-side secondary sidebar: '+JSON.stringify(inspectorPlacement));
  await click(rightInspector.x,rightInspector.y);await sleep(300);
  const readRightPanel=()=>evalJS(`(()=>{const panel=document.querySelector('#theia-right-content-panel');const r=panel?.getBoundingClientRect();const content=panel?.querySelector('.theia-side-panel');const cr=content?.getBoundingClientRect();return {found:!!panel,width:r?.width??0,height:r?.height??0,className:panel?.className??'',contentWidth:cr?.width??0,contentClass:content?.className??''};})()`);
  let rightPanelState=await readRightPanel();
  if(!rightPanelState.found)throw Error('Theia right-side panel shell is missing: '+JSON.stringify(rightPanelState));
  if(rightPanelState.width<120||rightPanelState.contentWidth<100){
    await invoke('core.toggle.right.panel');
    await sleep(350);
    rightPanelState=await readRightPanel();
  }
  console.log('STUDIO_INSPECTOR_RIGHT_PANEL_STATE',JSON.stringify(rightPanelState));
  if(rightPanelState.width<120||rightPanelState.contentWidth<100)
    throw Error('Theia secondary sidebar remains collapsed after core.toggle.right.panel: '+JSON.stringify(rightPanelState));
  await click(rightInspector.x,rightInspector.y);await sleep(250);
  await invoke('skillStudio.inspection.open');
  await sleep(300);
  const inspectorPartState=await evalJS(`(()=>{const container=document.getElementById('plugin-view-container:workbench.view.extension.skillStudioInspector');const tabs=[...(container?.querySelectorAll('.lm-TabBar-tab')??[])].filter(x=>x.textContent.trim().toLowerCase()==='inspector').map(x=>{const r=x.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,className:x.className};});const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])].find(x=>x.textContent.trim().toLowerCase()==='inspector');const part=header?.closest('.part');const before={tabs,headerRect:(()=>{const r=header?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;})(),partClass:part?.className??null};return {before,containerRect:(()=>{const r=container?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;})()};})()`);
  const innerInspectorTab=inspectorPartState.before.tabs.find(x=>x.width>0);
  if(innerInspectorTab)await click(innerInspectorTab.x,innerInspectorTab.y);
  await sleep(250);
  console.log('STUDIO_INSPECTOR_PART_EXPANSION',JSON.stringify(inspectorPartState));
  console.log('STUDIO_INSPECTOR_SECONDARY_SIDEBAR_CHROMIUM',JSON.stringify({found:true,rightInspector,viewportWidth:inspectorPlacement.viewportWidth}));
  const problemsHeader=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-view-container-part-header')].find(x=>x.textContent.trim().toLowerCase()==='problems'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0);el?.scrollIntoView({block:'center'});const r=el?.getBoundingClientRect();const part=el?.closest('.part');const collapsed=el?.getAttribute('aria-expanded')==='false'||/collapsed/.test(part?.className??'');return r?{x:r.x+r.width/2,y:r.y+r.height/2,collapsed}:null;})()`);
  const problemHeaderDiagnostics=await evalJS(`[...document.querySelectorAll('.theia-view-container-part-header')].filter(x=>x.textContent.trim().toLowerCase()==='problems').map(x=>({className:x.className,ariaExpanded:x.getAttribute('aria-expanded'),parent:x.parentElement?.className,part:x.closest('.part')?.className,view:x.closest('.theia-view-container')?.id,rect:(()=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()}))`);
  console.log('STUDIO_PROBLEMS_HEADERS',JSON.stringify(problemHeaderDiagnostics));
  if(problemsHeader?.collapsed){await click(problemsHeader.x,problemsHeader.y);await sleep(250);}
  // Re-open through Explorer rather than extension openWith command.
  await invoke('navigator.reveal');
  await invoke('core.saveAll');
  await invoke('core.close.all.main.tabs');
  await invoke('workbench.files.action.focusFilesExplorer');
  let file=await evalJS(`(()=>{
    const root=document.querySelector('.theia-Files')??document;
    const nodes=[...root.querySelectorAll('.theia-TreeNode')];
    const normalize=value=>value.replace(/\\s+/g,' ').trim();
    const el=nodes.find(node=>normalize(node.innerText).replace(/\\s+\\d+$/,'')==='procedure.yaml'&&
      node.getBoundingClientRect().width>0);
    if(!el)return {found:false,nodeCount:nodes.length,
      fileRows:nodes.map(node=>normalize(node.innerText)).filter(name=>name.includes('procedure.yaml')).slice(0,12)};
    el.scrollIntoView({block:'center',inline:'nearest'});
    // Click the actual label segment, not the indentation/icon gutter.
    const content=el.querySelector('.theia-TreeNodeSegmentGrow')??
      el.querySelector('.theia-TreeNodeContent')??el;
    const r=content.getBoundingClientRect();
    const points=[.5,.65,.8,.9].map(f=>({
      x:Math.round(r.x+r.width*f),y:Math.round(r.y+r.height/2)
    }));
    const point=points.find(({x,y})=>{
      if(x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
      const hit=document.elementFromPoint(x,y);
      return hit&&(hit===el||el.contains(hit))&&!hit.closest('.lm-SplitPanel-handle');
    });
    return {found:true,point:point??null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      nodeClass:el.className,
      hitClass:point?document.elementFromPoint(point.x,point.y)?.className??'':null,
      ancestorLabels:[...nodes].filter(node=>node.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)
        .slice(-4).map(node=>normalize(node.innerText))};
  })()`);
  if(!file?.found||!file.point)
    throw Error('Procedure file has no unobstructed native Explorer click target: '+JSON.stringify(file));
  console.log('STUDIO_EXPLORER_FILE_CLICK_TARGET',JSON.stringify(file));
  file={x:file.point.x,y:file.point.y};
  // Measure the actual Explorer click → CustomEditor render path. Do not
  // insert a fixed sleep before polling; it would dominate the reported time.
  const start=performance.now();await click(file.x,file.y);
  let graphContext,graphDiagnostics={frames:[]};
  async function graph(expectedProcedure=null){
    const tree=await command('Page.getFrameTree'),frames=[];
    const walk=n=>{frames.push(n.frame);for(const child of n.childFrames??[])walk(child);};
    walk(tree.frameTree);
    const rootFrameId=tree.frameTree?.frame?.id;
    const candidates=frames.filter(frame=>frame.id!==rootFrameId&&
      frame.url&&frame.url!=='about:blank');
    const evidence=[];
    for(const frame of candidates){
      try{
        const world=await command('Page.createIsolatedWorld',{
          frameId:frame.id,worldName:'workbench-native-open',
          grantUniveralAccess:true
        });
        graphContext=world.executionContextId;
        const result=await command('Runtime.evaluate',{
          contextId:world.executionContextId,returnByValue:true,
          expression:`({
            url:location.href,readyState:document.readyState,
            title:document.title,
            hasRoot:Boolean(document.querySelector('#reactFlowRoot')),
            nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,
            procedureValue:document.querySelector('#procedureList')?.value??null,
            bodyText:document.body?.innerText?.slice(0,1200)??'',
            revision:document.querySelector('#revision')?.textContent??null,
            timing:document.querySelector('#reactFlowRoot')?.dataset.studioTiming??null
          })`
        });
        const view=result.result?.value??null;
        evidence.push({id:frame.id,url:frame.url,view});
        if(view?.nodes>0&&(!expectedProcedure||
           view.procedureValue===expectedProcedure)){
          graphDiagnostics={frames:evidence,matchedFrame:frame.id};
          return view;
        }
      }catch(error){
        evidence.push({id:frame.id,url:frame.url,error:String(error)});
      }
    }
    graphDiagnostics={frames:evidence,matchedFrame:null};
    return null;
  }
  let opened=null;
  for(let i=0;i<100&&!opened;i++){opened=await graph();if(!opened)await sleep(100);}
  // Closing editor groups and opening the secondary sidebar can cause Theia's
  // Explorer to remount while the first pointer event is being dispatched.
  // Retry only genuine on-screen single-clicks against a freshly hit-tested
  // live file row; never substitute the extension openWith command here.
  const explorerRetries=[];
  for(let retry=0;retry<2&&!opened;retry++){
    await invoke('workbench.files.action.focusFilesExplorer');
    const current=await evalJS(`(()=>{
      const roots=[...document.querySelectorAll('.theia-Files')];
      const rows=(roots.length?roots:[document]).flatMap(root=>
        [...root.querySelectorAll('.theia-TreeNode')]);
      const row=rows.find(node=>node.innerText.replace(/\\s+/g,' ').trim().replace(/\\s+\\d+$/,'')==='procedure.yaml'&&
        node.getBoundingClientRect().width>0);
      if(!row)return {found:false,reason:'procedure row unavailable'};
      row.scrollIntoView({block:'center',inline:'nearest'});
      const label=row.querySelector('.theia-TreeNodeSegmentGrow')??
        row.querySelector('.theia-TreeNodeContent')??row;
      const box=label.getBoundingClientRect();
      const candidates=[.5,.65,.8,.9].map(f=>({
        x:Math.round(box.x+box.width*f),y:Math.round(box.y+box.height/2)
      }));
      const point=candidates.find(p=>p.x>=0&&p.y>=0&&p.x<innerWidth&&p.y<innerHeight&&
        ((hit)=>hit&&(hit===row||row.contains(hit))&&
          !hit.closest('.lm-SplitPanel-handle'))(document.elementFromPoint(p.x,p.y)));
      return {found:true,point:point??null,
        rect:{x:box.x,y:box.y,width:box.width,height:box.height}};
    })()`);
    explorerRetries.push({retry,current});
    if(!current?.point)break;
    file={x:current.point.x,y:current.point.y};
    await click(file.x,file.y);
    for(let i=0;i<40&&!opened;i++){opened=await graph();if(!opened)await sleep(100);}
  }
  if(!opened){
    const workbenchState=await evalJS(`({
      tabs:[...document.querySelectorAll('.lm-TabBar-tab')].map(tab=>({
        text:tab.textContent.trim(),className:tab.className,
        visible:tab.getBoundingClientRect().width>0
      })).filter(tab=>tab.visible),
      iframes:[...document.querySelectorAll('iframe')].map(frame=>({
        src:frame.getAttribute('src'),title:frame.title,
        rect:(()=>{const r=frame.getBoundingClientRect();return {
          x:r.x,y:r.y,width:r.width,height:r.height
        };})()
      })),
      monacoEditors:[...document.querySelectorAll('.monaco-editor')].map(editor=>({
        visible:editor.getBoundingClientRect().width>0,
        text:editor.innerText?.slice(0,500)??''
      })),
      bodyText:document.body?.innerText?.slice(-1400)??''
    })`);
    // Diagnostic only: distinguish a broken Explorer default association from
    // a broken CustomEditor provider. Explicit openProcedure must not turn a
    // failed single-click acceptance into a pass.
    let explicitOpenError=null,explicitOpenGraph=null;
    try{
      await nativeCommand('skillStudio.openProcedure');
      for(let attempt=0;attempt<50&&!explicitOpenGraph;attempt++){
        explicitOpenGraph=await graph();
        if(!explicitOpenGraph)await sleep(100);
      }
    }catch(error){explicitOpenError=String(error);}
    throw Error('Explorer click did not produce a React Flow CustomEditor; '+
      JSON.stringify({originalTarget:file,retries:explorerRetries,
        graphDiagnostics,workbenchState,
        explicitOpenDiagnostic:{error:explicitOpenError,graph:explicitOpenGraph,
          graphDiagnostics}}));
  }
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
  file=await evalJS(`(()=>{const el=[...document.querySelectorAll('.theia-TreeNode')].find(x=>x.innerText.replace(/\\s+\\d+$/,'').trim()==='procedure.yaml'&&x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0&&x.getBoundingClientRect().x<innerWidth);el?.scrollIntoView({block:'center',inline:'nearest'});const r=el?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
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
  // Package Audit is surfaced by the Problems view now contributed to
  // the native Explorer. Re-focus Explorer; there is no Skill Studio Activity Bar.
  await invoke('workbench.files.action.focusFilesExplorer');
  await sleep(350);
  const auditProblemsHeader=await evalJS(`(()=>{
    const container=document.getElementById('explorer-view-container');
    const header=[...(container?.querySelectorAll('.theia-view-container-part-header')??[])]
      .find(x=>x.textContent.trim().toLowerCase()==='problems');
    header?.scrollIntoView({block:'center'});
    const r=header?.getBoundingClientRect(),part=header?.closest('.part');
    return r?{x:r.x+r.width/2,y:r.y+r.height/2,
      collapsed:part?.classList.contains('collapsed')??false,
      containerFound:!!container}:null;
  })()`);
  if(!auditProblemsHeader)
    throw Error('Explorer Problems view is missing after CustomEditor open');
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
      !languageFeatureEvidence.yamlDefinitions?.entryProcedure?.endsWith(
        "/assurance/procedure.yaml")||
      !languageFeatureEvidence.yamlDefinitions?.predicate?.endsWith(
        "/assurance/predicates.yaml")||
      !languageFeatureEvidence.yamlDefinitions?.schema||
      !languageFeatureEvidence.yamlHover||
      !languageFeatureEvidence.yamlReferences||
      !languageFeatureEvidence.yamlProcedureOutline?.length||
      !languageFeatureEvidence.yamlProcedureOutline.includes(
        "ue-requested-pdu-session-establishment")||
      !languageFeatureEvidence.yamlPredicateOutline?.includes(
        "createdsession.ingress.eligible")||
      !languageFeatureEvidence.hover||
      !languageFeatureEvidence.references||
      !languageFeatureEvidence.reverseDefinition||
      !languageFeatureEvidence.reverseDefinitionTargets?.some(uri=>
        uri.endsWith("/assurance/procedure.yaml"))||
      !languageFeatureEvidence.symbols?.includes("main")||
      !["EstablishmentSelectionInput","N/A: Python source annotations"].includes(
        languageFeatureEvidence.schemaCompletion))
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
  const inspectorSourceVersionProbe=await nativeCommand('skillStudio.internal.sourceVersionAcceptance');
  const sourceVersion=inspectorSourceVersionProbe?.version;
  if(!Number.isSafeInteger(sourceVersion)||!inspectorSourceVersionProbe.uri)
    throw Error('Could not read authoritative native Source version: '+JSON.stringify(inspectorSourceVersionProbe));
  await startNativeCommand('skillStudio.editNodeOperatorValue',{
    procedureId:selectionResult.result.value.procedure,nodeId:'nudm-sdm-get',sourceVersion
  },'sbi.udm.sm_data.get.preview');
  await confirmNativePreview('call: sbi.udm.sm_data.get','call: sbi.udm.sm_data.get.preview');
  const afterEdit=await waitForRevisionChange(graphContext,beforeEdit.result?.value,
    'Native Inspector edit');
  const inspectorAfterSourceVersion=await nativeCommand('skillStudio.internal.sourceVersionAcceptance');
  const editResult=await evalJS(`window.__skillStudioCommandResult`);
  if(editResult!==true||!afterEdit.result?.value||inspectorAfterSourceVersion?.version<=sourceVersion)
    throw Error('Native Inspector edit did not commit a Source revision: '+JSON.stringify({
      editResult,before:beforeEdit.result?.value,after:afterEdit.result?.value,
      sourceVersion,inspectorAfterSourceVersion
    }));
  await invoke('core.undo');
  const afterUndo=await waitForRevisionChange(graphContext,afterEdit.result?.value,
    'Native Inspector Undo');
  const inspectorUndoSourceVersion=await nativeCommand('skillStudio.internal.sourceVersionAcceptance');
  if(!afterUndo.result?.value||afterUndo.result.value===afterEdit.result?.value||
     inspectorUndoSourceVersion?.version<=inspectorAfterSourceVersion?.version)
    throw Error('Native Inspector edit did not round-trip through native Undo: '+JSON.stringify({
      after:afterEdit.result?.value,undo:afterUndo.result?.value,
      inspectorAfterSourceVersion,inspectorUndoSourceVersion
    }));
  console.log('STUDIO_INSPECTOR_AUTHORING_CHROMIUM',JSON.stringify({
    node:selectionResult.result.value.node,procedure:selectionResult.result.value.procedure,
    before:beforeEdit.result?.value,after:afterEdit.result?.value,undo:afterUndo.result?.value
  }));
  // Use a trusted browser click so React Flow and the host selection bridge
  // publish the same Source-backed selection a user would make.
  const bindingClick=await command('Runtime.evaluate',{
    contextId:graphContext,returnByValue:true,
    expression:`(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')].find(x=>x.getAttribute('data-id')==='nudm-sdm-subscribe');if(!node)throw Error('Phase binding Node is not in the active graph');node.click();return {node:node.getAttribute('data-id'),revision:document.querySelector('#revision')?.textContent};})()`
  });
  if(bindingClick.result?.value?.node!=='nudm-sdm-subscribe')
    throw Error('Could not activate the Phase binding Node in the real Procedure Webview');
  let selectionState=null,graphSelectionPayload=null;
  for(let attempt=0;attempt<40;attempt++){
    graphSelectionPayload=await evalWebviewJS('document.body.dataset.studioSelection??null');
    selectionState=await nativeCommand('skillStudio.internal.selectionAcceptance');
    if(selectionState?.nodeId==='nudm-sdm-subscribe')break;
    await sleep(100);
  }
  console.log('STUDIO_INSPECTOR_SELECTION_STATE_CHROMIUM',JSON.stringify({bindingClick:bindingClick.result?.value,graphSelectionPayload,selectionState}));
  if(selectionState?.nodeId!=='nudm-sdm-subscribe'||
     selectionState?.procedureId!==selectionResult.result.value.procedure)
    throw Error('Host did not retain the exact selected Phase binding Node: '+JSON.stringify(selectionState));
  const bindingSelection={result:{value:{
    procedure:selectionState.procedureId,node:selectionState.nodeId
  }}};
  let inspectorDataFlow=null;
  for(let attempt=0;attempt<60;attempt++){
    inspectorDataFlow=await evalJS(`(()=>{const container=document.getElementById('plugin-view-container:workbench.view.extension.skillStudioInspector');const r=container?.getBoundingClientRect();const rows=[...(container?.querySelectorAll('.theia-TreeNode')??[])].map(x=>{const b=x.getBoundingClientRect();return {text:x.innerText.replace(/\\s+/g,' ').trim(),visible:b.width>0&&b.height>0&&b.x<innerWidth&&b.right>0&&b.y<innerHeight&&b.bottom>0};});return {found:!!container,rightSide:!!r&&r.x>innerWidth/2,containerRect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,text:container?.innerText??'',rows};})()`);
    if(inspectorDataFlow?.rightSide&&inspectorDataFlow.text.includes('Data Flow · Producer / Consumer'))break;
    await sleep(100);
  }
  if(!inspectorDataFlow?.rightSide||!inspectorDataFlow.text.includes('Data Flow · Producer / Consumer'))
    throw Error('Inspector is missing contextual Source Data Flow: '+JSON.stringify({graphSelectionPayload,selectionState,inspectorDataFlow}));
  console.log('STUDIO_INSPECTOR_DATA_FLOW_CHROMIUM',JSON.stringify({
    found:inspectorDataFlow.found,rightSide:inspectorDataFlow.rightSide,
    hasDataFlow:true,containerRect:inspectorDataFlow.containerRect,
    visibleRows:inspectorDataFlow.rows.filter(x=>x.visible).length
  }));
  // The duplicate Explorer Evidence view is retired. Verify the exact same
  // Source-derived Producer / Consumer and ABI information inside the native
  // right-side Inspector, without confusing it with Runtime Evidence.
  await invoke('skillStudio.auditPackage');
  // Audit refreshes Source-derived tree models. Wait for its exact terminal
  // state before interacting with the Inspector expansion arrow; otherwise a
  // late model refresh can immediately collapse the row after a trusted click.
  let initialAuditText='';
  for(let attempt=0;attempt<100;attempt++){
    initialAuditText=await evalJS('document.body.innerText');
    if(/Package Audit · [0-9]+ editor warnings/.test(initialAuditText))break;
    if(initialAuditText.includes('Package Audit · unavailable'))
      throw Error('Package Audit became unavailable before Data Flow expansion: '+
        initialAuditText.slice(-1000));
    await sleep(100);
  }
  if(!/Package Audit · [0-9]+ editor warnings/.test(initialAuditText))
    throw Error('Package Audit did not settle before Data Flow expansion: '+
      initialAuditText.slice(-1000));
  let inspectorFlowState=null;
  for(let attempt=0;attempt<100;attempt++){
    inspectorFlowState=await evalJS(`(()=>{
      const container=document.getElementById(
        'plugin-view-container:workbench.view.extension.skillStudioInspector');
      const rect=container?.getBoundingClientRect();
      const rows=[...(container?.querySelectorAll('.theia-TreeNode')??[])].map(node=>{
        const content=[...node.children].find(child=>
          child.classList?.contains('theia-TreeNodeContent'));
        const text=content?.innerText?.replace(/\\s+/g,' ').trim()??'';
        const b=content?.getBoundingClientRect();
        return {node,content,text,b,
          visible:!!b&&b.width>0&&b.height>0};
      });
      const dataflow=rows.find(row=>row.text.includes('Data Flow · Producer / Consumer'));
      const toggle=dataflow?.node?.querySelector('.theia-ExpansionToggle');
      if(dataflow?.content)dataflow.content.scrollIntoView({block:'center',inline:'nearest'});
      const t=toggle?.getBoundingClientRect();
      const x=t?t.x+t.width/2:null,y=t?t.y+t.height/2:null;
      const hit=x!==null&&y!==null?document.elementFromPoint(x,y):null;
      return {
        containerPresent:!!container,rightSide:!!rect&&rect.x>innerWidth/2,
        hasDataflow:!!dataflow,hasToggle:!!toggle,
        expanded:!!toggle&&!toggle.classList.contains('theia-mod-collapsed'),
        toggleHit:!!toggle&&(hit===toggle||toggle.contains(hit)),
        togglePoint:{x,y},
        labels:rows.filter(row=>row.visible).map(row=>row.text).slice(-60),
        containsAbi:rows.some(row=>row.visible&&row.text.includes('Consumer ABI')),
        containsLineage:rows.some(row=>row.visible&&row.text.includes('Source lineage')),
        sourceBoundary:container?.innerText?.includes('Runtime NOT_RUN')??false
      };
    })()`);
    if(inspectorFlowState?.rightSide&&inspectorFlowState.hasDataflow)break;
    await sleep(100);
  }
  if(!inspectorFlowState?.rightSide||!inspectorFlowState.hasDataflow||
     !inspectorFlowState.hasToggle)
    throw Error('Native right-side Inspector Data Flow root unavailable after scoped Audit: '+
      JSON.stringify(inspectorFlowState));
  if(!inspectorFlowState.expanded){
    if(!inspectorFlowState.toggleHit)
      throw Error('Native Inspector Data Flow expansion arrow is obscured: '+
        JSON.stringify(inspectorFlowState));
    await evalJS(`(()=>{
      window.__inspectorDataFlowClicks=[];
      document.addEventListener('click',event=>{
        const toggle=event.target?.closest?.('.theia-ExpansionToggle');
        const node=toggle?.closest('.theia-TreeNode');
        if(!toggle||!node?.innerText?.includes('Data Flow · Producer / Consumer'))return;
        window.__inspectorDataFlowClicks.push({trusted:event.isTrusted,
          toggleClass:toggle.className,nodeText:node.innerText.replace(/\\s+/g,' ').trim()});
      },true);
      return true;
    })()`);
    await click(inspectorFlowState.togglePoint.x,inspectorFlowState.togglePoint.y);
    let expandedAfterClick=false;
    for(let attempt=0;attempt<30;attempt++){
      expandedAfterClick=await evalJS(`(()=>{
        const container=document.getElementById(
          'plugin-view-container:workbench.view.extension.skillStudioInspector');
        const row=[...(container?.querySelectorAll('.theia-TreeNode')??[])].find(node=>
          node.innerText.replace(/\\s+/g,' ').includes('Data Flow · Producer / Consumer'));
        const toggle=row?.querySelector('.theia-ExpansionToggle');
        return !!toggle&&!toggle.classList.contains('theia-mod-collapsed');
      })()`);
      if(expandedAfterClick)break;
      await sleep(100);
    }
    if(!expandedAfterClick){
      const clicks=await evalJS('window.__inspectorDataFlowClicks??[]');
      throw Error('Trusted Inspector Data Flow click did not expand the row: '+
        JSON.stringify({inspectorFlowState,clicks}));
    }
  }
  let phaseEvidenceText='';
  for(let attempt=0;attempt<100;attempt++){
    const detail=await evalJS(`(()=>{
      const container=document.getElementById(
        'plugin-view-container:workbench.view.extension.skillStudioInspector');
      const text=container?.innerText??'';
      const visible=[...(container?.querySelectorAll('.theia-TreeNode')??[])].filter(node=>{
        const r=node.getBoundingClientRect();return r.width>0&&r.height>0;
      }).map(node=>node.innerText.replace(/\\s+/g,' ').trim());
      return {text,visible};
    })()`);
    phaseEvidenceText=detail.text;
    if(detail.visible.some(x=>x.includes('Source lineage'))&&
       detail.visible.some(x=>x.includes('Consumer ABI')))break;
    await sleep(100);
  }
  const phaseEvidence={
    ready:phaseEvidenceText.includes('Data Flow · Producer / Consumer')&&
      phaseEvidenceText.includes('Consumer ABI')&&
      phaseEvidenceText.includes('Source lineage'),
    dataflowRows:phaseEvidenceText.split('Data Flow · Producer / Consumer').length-1,
    consumerAbiRows:(phaseEvidenceText.match(/Consumer ABI/g)||[]).length,
    readOnly:phaseEvidenceText.includes('no write authority')&&
      phaseEvidenceText.includes('Runtime NOT_RUN')
  };
  if(!phaseEvidence.ready||!phaseEvidence.readOnly)
    throw Error('Inspector Data Flow lost read-only Producer / Consumer / ABI parity: '+
      JSON.stringify({phaseEvidence,inspectorFlowState})+' · '+
      phaseEvidenceText.slice(-1500));
  const oldEvidenceHeader=await evalJS(`[...document.querySelectorAll(
    '#explorer-view-container .theia-view-container-part-header')]
    .some(header=>header.textContent.trim().toLowerCase()==='evidence')`);
  if(oldEvidenceHeader)
    throw Error('Retired standalone Evidence view still appears in Explorer');
  console.log('STUDIO_INSPECTOR_DATA_FLOW_PARITY_CHROMIUM',JSON.stringify({
    ...phaseEvidence,rightSide:true,retiredEvidenceAbsent:true
  }));
  // A prior TextDocument edit may have scheduled a debounced Package Audit.
  // Do not start another native edit while that audit still owns the current
  // snapshot; wait for the exact Package Audit terminal state first.
  let phaseAuditRetryCount=0;
  for(let attempt=0;attempt<100;attempt++){
    phaseEvidenceText=await evalJS('document.body.innerText');
    if(/Package Audit · [0-9]+ editor warnings/.test(phaseEvidenceText))break;
    if(phaseEvidenceText.includes('Package Audit · unavailable')){
      if(phaseAuditRetryCount===0){
        phaseAuditRetryCount++;
        await invoke('skillStudio.auditPackage');
        await sleep(150);
        continue;
      }
      throw Error('Package Audit remained unavailable after one explicit retry before Phase binding edit: '+
        phaseEvidenceText.slice(-1000));
    }
    await sleep(100);
  }
  if(!/Package Audit · [0-9]+ editor warnings/.test(phaseEvidenceText))
    throw Error('Package Audit did not settle before Phase binding edit: '+
      phaseEvidenceText.slice(-1000));
  console.log('STUDIO_PHASE_DATAFLOW_EVIDENCE_CHROMIUM',JSON.stringify({
    ...phaseEvidence,auditReady:true
  }));
  // After native Inspector Data Flow expansion, reopen the authoritative
  // Source editor before testing bounded edits and native Undo.
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
  const sourceVersionProbe=await nativeCommand('skillStudio.internal.sourceVersionAcceptance');
  const typoVersion=sourceVersionProbe?.version;
  if(!Number.isSafeInteger(typoVersion)||!sourceVersionProbe.uri)
    throw Error('Outcome typo lost authoritative VS Code TextDocument version: '+
      JSON.stringify({sourceVersionProbe,displayRevision:afterTypo.result?.value}));
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
  // opened the native Explorer and intentionally kept it selected.
  await invoke('workbench.files.action.focusFilesExplorer');
  // Open the exact owner-pinned conventional Skill guide through the real
  // Theia command registry, then exercise package-local navigation in Chromium.
  // The legacy Studio-owned Markdown renderer has been retired from the default path.
  // Native Markdown Preview acceptance below now owns rendering, navigation and security checks.
  const nativeMarkdownUri=await nativeCommand(
    'skillStudio.internal.nativeMarkdownPreviewAcceptance','establish-pdu-session');
  if(typeof nativeMarkdownUri!=='string'||!nativeMarkdownUri.endsWith('/SKILL.md'))
    throw Error('Native Markdown preview command did not open the exact Skill Source URI: '+
      JSON.stringify(nativeMarkdownUri));
  const nativeMarkdown=await waitNativeMarkdown(view=>
    view.heading==='Establish PDU Session'&&view.nativePreviewRoot&&
    view.styles.some(url=>url.includes('/media/native-markdown-preview.css')),
    'Studio-themed native Markdown preview');
  const nativeMarkdownWorkerDiagnostics=await nativeCommand('skillStudio.internal.nativeMarkdownWorkerDiagnostics');
  console.log('STUDIO_NATIVE_MARKDOWN_WORKER_URI_DIAGNOSTIC',JSON.stringify(nativeMarkdownWorkerDiagnostics));
  if(nativeMarkdown.view.headingColor!=='rgb(12, 142, 123)'||
     nativeMarkdown.view.maxWidth!=='980px')
    throw Error('Native Markdown preview did not apply the shared Studio theme: '+
      JSON.stringify(nativeMarkdown.view));
  const nativeMarkdownGroups=await evalJS(
    "(()=>{const tabs=[...document.querySelectorAll('.lm-TabBar-tab')].filter(tab=>"+
    "tab.textContent.trim().includes('SKILL.md'));const groups=new Map();for(const tab of tabs){"+
    "const bar=tab.parentElement;if(!groups.has(bar)){const r=bar.getBoundingClientRect();"+
    "groups.set(bar,{index:groups.size,labels:[],rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}"+
    "groups.get(bar).labels.push(tab.textContent.trim());}return [...groups.values()];})()");
  const nativeSourceGroup=nativeMarkdownGroups.find(group=>
    group.labels.some(label=>/^SKILL\.md/.test(label)));
  const nativePreviewGroup=nativeMarkdownGroups.find(group=>
    group.labels.some(label=>/^Preview(?:\s|·).*SKILL\.md/i.test(label)));
  if(!nativeSourceGroup||!nativePreviewGroup||
     nativeSourceGroup.index===nativePreviewGroup.index)
    throw Error('Native Markdown must keep editable Source and Preview in separate editor groups: '+
      JSON.stringify(nativeMarkdownGroups));
  const nativeMarkdownEvidence={
    uri:nativeMarkdownUri,preview:nativeMarkdown.view,
    sourceGroup:nativeSourceGroup,previewGroup:nativePreviewGroup
  };
  console.log('STUDIO_NATIVE_MARKDOWN_PREVIEW_CHROMIUM',JSON.stringify(nativeMarkdownEvidence));

  // Prove native Markdown refreshes the existing preview from an unsaved
  // Source edit, then exercise both scroll-sync directions through Monaco and
  // the actual Markdown webview in Chromium.
  const nativeLiveUri=await nativeCommand(
    'skillStudio.internal.nativeMarkdownLiveUpdateAcceptance');
  try{
    const nativeLive=await waitNativeMarkdown(
      view=>view.heading==='Native Markdown Live Update Probe'&&view.nativePreviewRoot,
      'native Markdown unsaved Source edit');
    const nativeSettings=await nativeCommand('skillStudio.internal.nativeMarkdownSettingsAcceptance');
    if(nativeSettings?.scrollEditorWithPreview!==true||
       nativeSettings?.scrollPreviewWithEditor!==true)
      throw Error('Native Markdown bidirectional scroll settings are not enabled: '+
        JSON.stringify(nativeSettings));
    if(nativeLive.view.contextId!==nativeMarkdown.view.contextId)
      throw Error('Native Markdown recreated its Preview webview instead of updating it in place: '+
        JSON.stringify({before:nativeMarkdown.view.contextId,after:nativeLive.view.contextId}));
    const sourceViewport=nativeSettings.visibleEditors?.find(
      editor=>editor.uri===nativeMarkdownUri)??null;
    if(!sourceViewport)
      throw Error('Native Markdown Source is not present in the host visible-editor snapshot: '+
        JSON.stringify(nativeSettings.visibleEditors));
    const readPreviewViewport=async()=>(await command('Runtime.evaluate',{
      contextId:nativeLive.view.contextId,returnByValue:true,
      expression:'({scrollY:window.scrollY,scrollHeight:document.scrollingElement?.scrollHeight??0,'+
        'clientHeight:document.scrollingElement?.clientHeight??0})'
    })).result?.value;
    const previewViewport=await readPreviewViewport();
    const nativeMarkdownScrollEvidence={
      sourceViewport,previewViewport,
      nativePreferences:{scrollEditorWithPreview:nativeSettings.scrollEditorWithPreview,
        scrollPreviewWithEditor:nativeSettings.scrollPreviewWithEditor},
      acceptance:'manual user inspection required; automated tests do not synthesize or assert scrolling'
    };
    const nativeMarkdownLiveEvidence={
      previewContextRetained:true,
      nativeMarkdownScrollEvidence,
      finalPreviewScroll:previewViewport.scrollY
    };
    console.log('STUDIO_NATIVE_MARKDOWN_LIVE_SYNC_CHROMIUM',
      JSON.stringify(nativeMarkdownLiveEvidence));
  }finally{
    await nativeCommand(
      'skillStudio.internal.restoreNativeMarkdownLiveUpdateAcceptance',nativeLiveUri);
  }
  const restoredNativeMarkdown=await waitNativeMarkdown(
    view=>view.heading==='Establish PDU Session'&&view.nativePreviewRoot,
    'native Markdown Source restoration');
  if(restoredNativeMarkdown.view.contextId!==nativeMarkdown.view.contextId)
    throw Error('Restoring the Markdown Source recreated the existing Preview webview');

  const nativeSecurityUri=await nativeCommand(
    'skillStudio.internal.nativeMarkdownSecurityAcceptance');
  if(typeof nativeSecurityUri!=='string'||
     !nativeSecurityUri.endsWith('/SKILL.md'))
    throw Error('Native Markdown security fixture was not created inside the 5GC Skill Package');
  try{
    const nativeSecurity=await waitNativeMarkdown(view=>
      view.heading==='Native Markdown Security Probe'&&view.nativePreviewRoot,
      'native Markdown Package security probe');
    const evidence=nativeSecurity.view;
    if(evidence.imageCount!==0||evidence.scriptMarkers!==0||evidence.scriptExecuted)
      throw Error('Native Markdown allowed raw HTML or an image fetch: '+JSON.stringify(evidence));
    const safeLink=evidence.anchorDetails.find(anchor=>
      anchor.text==='Safe package reference');
    const blockedLinks=evidence.anchorDetails.filter(anchor=>
      anchor.text==='Escaping package link'||anchor.text==='Missing package link');
    if(!safeLink||!safeLink.href||safeLink.href==='#'||blockedLinks.length)
      throw Error('Native Markdown must retain the exact safe Package-local link and omit escaping/missing targets: '+
        JSON.stringify({safeLink,blockedLinks,evidence}));
    if(safeLink.href!=='references/3gpp-procedure.md')
      throw Error('Native Markdown changed the exact safe Package-local link target: '+
        JSON.stringify({href:safeLink.href,evidence}));
    // Runtime.evaluate(link.click()) is a synthetic DOM click, not a trusted
    // user gesture. Theia's native opener may intentionally ignore it. Verify
    // the rendered safe target and the blocked-target policy here; real link
    // navigation remains a manual workbench interaction, not a CI assertion.
    if(!evidence.csp.includes("default-src 'none'")||
       /script-src[^;]*unsafe-inline/.test(evidence.csp))
      throw Error('Native Markdown preview is not using a strict script Content Security Policy: '+
        JSON.stringify(evidence.csp));
    console.log('STUDIO_NATIVE_MARKDOWN_SECURITY_CHROMIUM',JSON.stringify(evidence));
  }finally{
    await nativeCommand(
      'skillStudio.internal.removeNativeMarkdownSecurityAcceptance',nativeSecurityUri);
  }

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
     !contractView.text.includes('lib/host/subject.schema.yaml')||
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
     !predicateView.text.includes('scripts/evaluate_udm_read.py')||
     !predicateView.text.includes('Observation → Evaluator')||
     !predicateView.text.includes('不是当前运行证据'))
    throw Error('Predicate Designer did not render the real PredicateSet declarations: '+
      JSON.stringify(predicateView).slice(0,3000));
  console.log('STUDIO_PREDICATE_DESIGNER_CHROMIUM',JSON.stringify({
    title:predicateView.title,status:predicateView.status,
    predicates:predicateView.predicates,observations:predicateView.observations,
    realPredicateVisible:predicateView.ids.includes('createdsession.ran.setup_accepted'),
    scriptEvaluatorVisible:predicateView.text.includes('scripts/evaluate_udm_read.py'),
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
    "(()=>{const label="+JSON.stringify(label)+";const rows=[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return {node,content,text:content?.innerText?.trim()??''};}).filter(row=>row.text===label||(label==='skills'&&row.text.endsWith('/skills')));const row="+(which==='first'?'rows[0]':'rows.at(-1)')+";if(!row)return {found:false,count:rows.length,labels:[...document.querySelectorAll('.theia-TreeNode')].map(node=>{const content=[...node.children].find(child=>child.classList?.contains('theia-TreeNodeContent'));return content?.innerText?.trim()??'';}).slice(-30)};row.content.scrollIntoView({block:'center',inline:'nearest'});const r=row.content.getBoundingClientRect();const toggle=row.node.querySelector('.theia-ExpansionToggle');const tr=toggle?.getBoundingClientRect();const tx=tr?tr.x+tr.width/2:null,ty=tr?tr.y+tr.height/2:null;const hit=tr?document.elementFromPoint(tx,ty):null;return {found:true,x:r.x+r.width/2,y:r.y+r.height/2,expanded:row.node.getAttribute('aria-expanded'),className:row.node.className,ariaLevel:row.node.getAttribute('aria-level'),dataNodeId:row.node.getAttribute('data-node-id'),count:rows.length,toggleX:tx,toggleY:ty,toggleHit:!!toggle&&(hit===toggle||toggle.contains(hit)),toggleClass:toggle?.className??null};})()"
  );
  // Expand the authored skills/ source directory before looking for the two
  // Skill folders. Theia may compact the parent + skills into one row such as
  // skill-studio-demo/skills; dependency and Build stores are not in this tree.
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
