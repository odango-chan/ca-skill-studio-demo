// Runs against actual Theia DOM and CustomEditor frames, never a host mock.
// All browser acceptance fixtures use the pinned CA-SL v1alpha4 sample set.
export async function assertSourceVisualPair(evalJS,sleep,filename,label){
  let state;
  for(let attempt=0;attempt<30;attempt++){
    state=await evalJS(`(()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.activateWidget&&k.prototype?.addWidget);
      if(!key)throw Error('Theia shell missing');
      const shell=c.get(key),bars=shell.mainAreaTabBars;
      return shell.getWidgets('main').map(widget=>{
        const uri=widget.editor?.uri??widget.resource;
        if(!uri?.path?.toString().endsWith('/'+${JSON.stringify(filename)}))return null;
        const rect=widget.node.getBoundingClientRect();
        return {id:widget.id,uri:uri.toString(),
          kind:widget.editor?'source':widget.viewType??'unknown',
          column:bars.findIndex(bar=>bar.titles.some(title=>title.owner===widget))+1,
          visible:!widget.isHidden&&rect.width>0&&rect.height>0,
          rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
      }).filter(Boolean);
    })()`);
    // Theia may retain a hidden duplicate CodeEditor widget for the same
    // URI while the CustomEditor owns the visible second column. The contract
    // is exactly one VISIBLE native Source beside the visible Designer.
    const sources=state.filter(w=>w.kind==='source'&&w.visible);
    const visuals=state.filter(w=>w.kind.startsWith('skillStudio.')&&w.visible);
    if(sources.length===1&&visuals.length===1&&sources[0].uri===visuals[0].uri&&
       sources[0].column===1&&visuals[0].column===2&&
       sources[0].visible&&visuals[0].visible&&
       sources[0].rect.x+sources[0].rect.width<=visuals[0].rect.x+2){
      const evidence={filename,label,source:sources[0],visual:visuals[0]};
      console.log('STUDIO_YAML_SOURCE_VISUAL_PAIR_CHROMIUM',JSON.stringify(evidence));
      return evidence;
    }
    await sleep(100);
  }
  throw Error(label+' requires one visible native Source in column one and its Designer in column two: '+JSON.stringify(state));
}

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
  if(classic?.fileCount!==8||classic?.corePresent!==3||
     mas?.fileCount!==6||mas?.corePresent!==3)
    throw Error('Two-SKILL v1alpha4 inventory does not match the pinned sample manifest: '+
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
    definition:1,assurance:3,schemas:1,scripts:3
  });
  assertGroupInventory(scan,'establish-pdu-session-mas',{
    definition:1,assurance:4,schemas:1
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
    throw Error('v1alpha4 5GC Package row disappeared after Dependencies interaction');
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
    definition:1,assurance:3,schemas:1,scripts:3
  });
  assertGroupInventory(postExpansion,'establish-pdu-session-mas',{
    definition:1,assurance:4,schemas:1
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


export async function runWorkbenchAcceptance({
  command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp=false,procedureUri
}){
  if(!requireEditor)return {required:false};
  const defaultProcedureUri=String(procedureUri??"");
  const procedureSuffix="/skills/establish-pdu-session/assurance/procedure.yaml";
  if(!defaultProcedureUri.endsWith(procedureSuffix))
    throw Error("Browser acceptance must run against the active CA-SL v1alpha4 5GC Procedure: "+
      defaultProcedureUri);

  const nativeCommand=async(id,...args)=>evalJS(
    "(async()=>{const c=window.theia.container;"+
    "const key=[...c._bindingDictionary._map.keys()].find(k=>"+
    "typeof k==='function'&&k.prototype?.executeCommand&&"+
    "k.prototype?.registerCommand&&k.prototype?.getCommand);"+
    "if(!key)throw Error('Native Theia command registry missing');"+
    "return c.get(key).executeCommand("+JSON.stringify(id)+",..."+
    JSON.stringify(args)+");})()");
  const waitWebview=async(predicate,label,attempts=100)=>{
    let latest={frames:[],candidates:[]};
    for(let attempt=0;attempt<attempts;attempt++){
      const tree=await command("Page.getFrameTree");
      const frames=[];
      const walk=node=>{
        if(!node)return;
        frames.push(node.frame);
        for(const child of node.childFrames??[])walk(child);
      };
      walk(tree.frameTree);
      latest={frames:frames.map(frame=>({id:frame.id,url:frame.url})),candidates:[]};
      for(const frame of frames.filter(item=>/webview/i.test(item.url??""))){
        try{
          const world=await command("Page.createIsolatedWorld",{
            frameId:frame.id,worldName:"skill-studio-v1alpha4-acceptance",
            grantUniveralAccess:true
          });
          const evaluated=await command("Runtime.evaluate",{
            contextId:world.executionContextId,returnByValue:true,
            expression:"(()=>{const root=document.querySelector('#reactFlowRoot');"+
              "const heading=document.querySelector('h1');"+
              "const styles=[...document.querySelectorAll('link[rel~=\"stylesheet\"]')]."+
              "map(link=>link.href||link.getAttribute('href')||'');"+
              "return {url:location.href,title:document.title,"+
              "bodyText:document.body?.innerText??'',"+
              "procedureRoot:!!root,graphNodes:document.querySelectorAll('.react-flow__node').length,"+
              "graphEdges:document.querySelectorAll('.react-flow__edge').length,"+
              "procedureValue:document.querySelector('#procedureList')?.value??null,"+
              "revision:document.querySelector('#revision')?.textContent??null,"+
              "timing:root?.dataset.studioTiming??null,"+
              "cards:[...document.querySelectorAll('.card h2')].map(el=>el.textContent.trim()),"+
              "heading:heading?.textContent?.trim()??null,"+
              "nativePreviewRoot:Boolean(document.body&&styles.some(url=>url.includes('/media/native-markdown-preview.css'))),"+
              "styles,headingColor:heading?getComputedStyle(heading).color:null,"+
              "maxWidth:document.body?getComputedStyle(document.body).maxWidth:null,"+
              "anchorDetails:[...document.querySelectorAll('a')].map(anchor=>({"+
              "text:anchor.textContent.trim(),href:anchor.getAttribute('href'),resolvedHref:anchor.href})),"+
              "imageCount:document.querySelectorAll('img').length,"+
              "scriptMarkers:[...document.scripts].filter(script=>"+
              "script.textContent.includes('skillStudioNativeMarkdownXss')).length,"+
              "scriptExecuted:window.skillStudioNativeMarkdownXss===true,"+
              "csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\" i]')?.content??''"+
              "};})()"
          });
          const view=evaluated.result?.value;
          if(!view)continue;
          latest.candidates.push({url:frame.url,title:view.title,
            procedureValue:view.procedureValue,heading:view.heading,
            nodes:view.graphNodes,preview:view.nativePreviewRoot});
          if(predicate(view)){
            view.contextId=world.executionContextId;
            view.frameId=frame.id;
            return {view,contextId:world.executionContextId,frameId:frame.id};
          }
        }catch{/* Webview frames can be replaced during native editor activation. */}
      }
      await sleep(100);
    }
    throw Error(label+" did not appear in the real Theia workbench: "+JSON.stringify(latest));
  };
  const waitNativeMarkdown=(predicate,label,attempts=100)=>
    waitWebview(view=>view.nativePreviewRoot&&predicate(view),label,attempts);
  const openPackageFile=async(id,relativePath)=>{
    const packageRoot=defaultProcedureUri.replace(/\/assurance\/procedure\.yaml$/,"");
    const target=packageRoot+"/"+relativePath;
    await nativeCommand(id,target);
    await sleep(250);
    return target;
  };
  const waitForStatus=async(expected,attempts=120)=>{
    let status="";
    for(let i=0;i<attempts;i++){
      status=await evalJS("document.body.innerText.match(/SKILL LSP: (READY|PARTIAL|UNAVAILABLE|ERROR|ANALYZING|STARTED|STARTING|IDLE)/)?.[0]??''");
      if(status==="SKILL LSP: "+expected)return status;
      if(status==="SKILL LSP: ERROR"||status==="SKILL LSP: UNAVAILABLE")
        throw Error("Skill Language Service entered a terminal state: "+status);
      await sleep(100);
    }
    throw Error("Skill Language Service did not reach "+expected+": "+status);
  };

  const started=Date.now();
  const procedurePair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","CA-SL v1alpha4 Procedure Designer");
  const sourceState=await nativeCommand("skillStudio.internal.sourceVersionAcceptance");
  if(sourceState?.uri!==defaultProcedureUri||!Number.isSafeInteger(sourceState.version))
    throw Error("Native Source is not the exact v1alpha4 Procedure TextDocument: "+
      JSON.stringify({expected:defaultProcedureUri,sourceState,procedurePair}));
  const initialGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "default v1alpha4 Procedure graph");
  const initialTiming=initialGraph.view.timing?JSON.parse(initialGraph.view.timing):{
    type:"rendered",revision:initialGraph.view.revision,nodes:initialGraph.view.graphNodes
  };

  // The frozen v1alpha4 graph is intentionally read-only. Route changes belong
  // to explicit Source/Authoring workflows, not the legacy drag-to-rewire editor.
  const graphEditability=await evalWebviewJS("(()=>{"+
    "const patch=document.querySelector('#patch');"+
    "const commit=document.querySelector('#commit');"+
    "const preview=document.querySelector('#preview');"+
    "const routes=document.querySelector('#routeList');"+
    "const targets=document.querySelector('#targetList');"+
    "return {readOnly:patch?.hidden===true&&commit?.disabled===true,"+
    "patchHidden:patch?.hidden===true,commitDisabled:commit?.disabled===true,"+
    "previewDisabled:preview?.disabled===true,"+
    "routeOptions:routes?.options.length??0,targetOptions:targets?.options.length??0,"+
    "status:document.querySelector('#message')?.textContent??''};})()");
  if(!graphEditability?.readOnly)
    throw Error("v1alpha4 Procedure graph exposed legacy interactive Route editing: "+
      JSON.stringify(graphEditability));
  const sourceAfterGraph=await nativeCommand("skillStudio.internal.sourceVersionAcceptance");
  if(sourceAfterGraph?.uri!==defaultProcedureUri||
     sourceAfterGraph.version!==sourceState.version)
    throw Error("Read-only v1alpha4 graph interaction changed authoritative Source: "+
      JSON.stringify({sourceState,sourceAfterGraph,graphEditability}));
  graphEditability.sourceUnchanged=true;
  console.log("STUDIO_V1ALPHA4_GRAPH_READ_ONLY_CHROMIUM",JSON.stringify(graphEditability));

  // Toolbar defaults and layout/path controls are checked against the v1alpha4 graph.
  const toolbarInitial=await evalWebviewJS("(()=>({"+
    "layout:document.querySelector('#layoutDirection')?.value??null,"+
    "rootMode:document.querySelector('#rootPathMode')?.value??null,"+
    "rootVisible:document.querySelector('#rootPathToolbar')?.hidden===false,"+
    "rootFiltersVisible:document.querySelector('#rootPathFilters')?.hidden===false,"+
    "toolbarVisible:document.querySelector('#graphTools')?.hidden===false,"+
    "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
    "controls:['columns-2','network','eye','locate-fixed','zoom-out','zoom-in','maximize','fit-width','fit-height']"+
    ".map(name=>({name,found:[...document.querySelectorAll('#graphTools svg[data-icon]')].some(el=>el.getAttribute('data-icon')===name)}))"+
    "}))()");
  // Root-path filtering is a legacy Procedure control. v1alpha4 has its own
  // typed stage projection and must not expose that legacy path-editing surface.
  if(toolbarInitial?.layout!=="DOWN"||toolbarInitial.rootVisible||
     toolbarInitial.rootFiltersVisible||!toolbarInitial.toolbarVisible||
     toolbarInitial.controls.some(item=>!item.found))
    throw Error("v1alpha4 Procedure canvas toolbar is incomplete or exposes legacy path controls: "+
      JSON.stringify(toolbarInitial));
  await evalWebviewJS("(()=>{const s=document.querySelector('#layoutDirection');s.value='RIGHT';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(180);
  const horizontal=await evalWebviewJS("document.querySelector('#layoutDirection')?.value??null");
  await evalWebviewJS("(()=>{const s=document.querySelector('#layoutDirection');s.value='DOWN';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(350);
  const allPaths=await evalWebviewJS("(()=>({layout:document.querySelector('#layoutDirection')?.value??null,"+
    "rootMode:document.querySelector('#rootPathMode')?.value??null,"+
    "rootToolbarVisible:document.querySelector('#rootPathToolbar')?.hidden===false,"+
    "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
    "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length}))()");
  if(horizontal!=="RIGHT"||allPaths.layout!=="DOWN"||allPaths.rootMode!=="normal"||
     allPaths.rootToolbarVisible||!(allPaths.nodes>0)||!(allPaths.edges>0))
    throw Error("v1alpha4 canvas layout or legacy-control isolation failed: "+
      JSON.stringify({toolbarInitial,horizontal,allPaths}));
  const canvasToolbar={initial:toolbarInitial,horizontal,allPaths};
  console.log("STUDIO_V1ALPHA4_CANVAS_TOOLBAR_CHROMIUM",JSON.stringify(canvasToolbar));

  // Package ZIP must be produced from the exact active v1alpha4 Package snapshot.
  await evalWebviewJS("document.querySelector('#exportPackageZip')?.click();true");
  let zipNotice=null;
  for(let i=0;i<60;i++){
    zipNotice=await evalWebviewJS("({visible:!document.querySelector('#zipExportNotice')?.hidden,"+
      "details:document.querySelector('#zipExportDetails')?.textContent??''})");
    if(zipNotice?.visible)break;
    await sleep(100);
  }
  if(!zipNotice?.visible||!zipNotice.details.includes(".zip"))
    throw Error("v1alpha4 Package ZIP export did not prepare a download: "+JSON.stringify(zipNotice));
  const packageZip=await evalWebviewJS("(()=>{let blobMeta=null,linkMeta=null;"+
    "const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;"+
    "URL.createObjectURL=function(blob){blobMeta={size:blob.size,type:blob.type};return create.call(URL,blob);};"+
    "HTMLAnchorElement.prototype.click=function(){linkMeta={download:this.download,href:this.href};};"+
    "document.querySelector('#downloadPackageZip')?.click();URL.createObjectURL=create;"+
    "HTMLAnchorElement.prototype.click=click;return {blobMeta,linkMeta,noticeHidden:document.querySelector('#zipExportNotice')?.hidden};})()");
  if(!(packageZip?.blobMeta?.size>22)||packageZip.blobMeta.type!=="application/zip"||
     !packageZip.linkMeta?.download?.endsWith(".zip")||
     !packageZip.linkMeta.href.startsWith("blob:")||!packageZip.noticeHidden)
    throw Error("v1alpha4 Package ZIP did not produce a browser Blob download: "+
      JSON.stringify(packageZip));
  packageZip.details=zipNotice.details;
  console.log("STUDIO_V1ALPHA4_PACKAGE_ZIP_CHROMIUM",JSON.stringify(packageZip));

  let languageServiceStatus="NOT_REQUIRED_NODE_HOST";
  let v1alpha4LanguageFeatures=null,semanticTokenEvidence=null;
  if(requireBrowserLsp){
    // A v1alpha4 Package is intentionally PARTIAL until trusted Owner,
    // Capability and Schema snapshots are linked. PARTIAL is not a Worker
    // failure: verify the browser Language Client is alive and the exact
    // current Package generation parsed completely, without claiming
    // qualification that the bundled NOT_QUALIFIED Example does not have.
    languageServiceStatus=await waitForStatus("PARTIAL");
    const languageServiceDiagnostics=await nativeCommand(
      "skillStudio.internal.semanticTokenDiagnostics");
    const expectedPackageRoot=defaultProcedureUri.replace(
      /\/assurance\/procedure\.yaml$/,"");
    const languagePackage=languageServiceDiagnostics?.packageStatuses?.find(
      item=>item.rootUri===expectedPackageRoot);
    const packageSnapshot=languageServiceDiagnostics?.languagePackages?.find(
      item=>item.rootUri===expectedPackageRoot);
    const expectedPartialReason=
      "CA-SL v1alpha4 source parsed; trusted Owner/Capability/Schema linking requires v1alpha4 Compiler and published snapshots";
    if(languageServiceDiagnostics?.languageClientStarted!==true||
       languageServiceDiagnostics?.languageTransportFailure||
       !languagePackage||
       languagePackage.state!=="PARTIAL"||
       languagePackage.procedureState!=="READY"||
       languagePackage.packageAuditState!=="UNAVAILABLE"||
       !String(languagePackage.packageAuditReason??"").includes(expectedPartialReason)||
       packageSnapshot?.lastSentSnapshot?.completeness!=="complete")
      throw Error("v1alpha4 Language Service must be available while its unqualified Package remains PARTIAL: "+
        JSON.stringify({languageServiceDiagnostics,expectedPackageRoot,languagePackage,packageSnapshot}));
    console.log("STUDIO_V1ALPHA4_LSP_PARTIAL_IS_EXPECTED_CHROMIUM",JSON.stringify({
      status:languageServiceStatus,
      languageClientStarted:languageServiceDiagnostics.languageClientStarted,
      languagePackage,
      snapshot:packageSnapshot?.lastSentSnapshot
    }));
    v1alpha4LanguageFeatures=await nativeCommand(
      "skillStudio.internal.v1alpha4LanguageProviderAcceptance",defaultProcedureUri);
    if(v1alpha4LanguageFeatures?.status!=="PARTIAL"||
       v1alpha4LanguageFeatures?.snapshotCompleteness!=="complete"||
       !v1alpha4LanguageFeatures.contractPreconditionCompletion?.includes("check.precondition")||
       !v1alpha4LanguageFeatures.requestSchemaCompletion?.includes("schemas/request.schema.yaml")||
       !v1alpha4LanguageFeatures.startNodeCompletion?.includes("check")||
       !v1alpha4LanguageFeatures.predicateCompletion?.includes("demo.ready")||
       !v1alpha4LanguageFeatures.preconditionFields?.includes("predicates:")||
       !v1alpha4LanguageFeatures.observationFields?.includes("tool:")||
       !v1alpha4LanguageFeatures.operationFields?.includes("script:")||
       !v1alpha4LanguageFeatures.scriptPathCompletion?.includes("scripts/runner.py")||
       !v1alpha4LanguageFeatures.outcomeUnknownTargets?.includes("SAFE_STOPPED")||
       !v1alpha4LanguageFeatures.contractDefinition||
       !v1alpha4LanguageFeatures.predicateDefinition||
       !v1alpha4LanguageFeatures.predicateHoverSignature||
       !v1alpha4LanguageFeatures.predicateReferences||
       !v1alpha4LanguageFeatures.scriptDefinition||
       !v1alpha4LanguageFeatures.procedureOutline?.includes("run-script")||
       v1alpha4LanguageFeatures.ownerQualification!=="NOT_QUALIFIED")
      throw Error("Native v1alpha4 language-provider acceptance failed: "+
        JSON.stringify(v1alpha4LanguageFeatures));
    semanticTokenEvidence=await nativeCommand("skillStudio.internal.semanticTokenDiagnostics");
    if(semanticTokenEvidence?.registered!==true||
       !(semanticTokenEvidence?.lastTokenCount>0)||
       semanticTokenEvidence?.renderer!=="theia-text-editor-decoration"||
       !(semanticTokenEvidence?.renderedTokenCount>0)||
       !(semanticTokenEvidence?.renderedTypeCount>=2)||
       semanticTokenEvidence?.renderError)
      throw Error("Native v1alpha4 semantic tokens were not rendered: "+
        JSON.stringify(semanticTokenEvidence));
    console.log("STUDIO_V1ALPHA4_LANGUAGE_FEATURES_CHROMIUM",
      JSON.stringify(v1alpha4LanguageFeatures));
    console.log("STUDIO_V1ALPHA4_SEMANTIC_TOKENS_CHROMIUM",
      JSON.stringify(semanticTokenEvidence));
  }

  // The native Inspector is source-derived and read-only; it is not Runtime Evidence.
  await evalWebviewJS("(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
    ".find(el=>el.getAttribute('data-id')==='get-sm-subscription-data');node?.click();return !!node;})()");
  await sleep(120);
  const inspectorSelection=await nativeCommand("skillStudio.internal.selectionAcceptance");
  console.log("STUDIO_V1ALPHA4_INSPECTOR_SELECTION_CHROMIUM",
    JSON.stringify(inspectorSelection));
  if(inspectorSelection?.nodeId!=="get-sm-subscription-data"||
     inspectorSelection?.snapshotState!=="READY")
    throw Error("v1alpha4 graph selection did not reach the native Inspector model: "+
      JSON.stringify(inspectorSelection));
  await nativeCommand("skillStudio.auditPackage");
  // Theia 1.76 registers a per-view focus command from PluginViewRegistry.
  // The VS Code workbench.view.extension.<container> command is not registered
  // by this Theia host; silently ignoring it leaves a real but hidden view.
  await nativeCommand("skillStudio.inspection.focus");
  let inspectorState={text:"",visible:false};
  for(let i=0;i<80;i++){
    inspectorState=await evalJS("(()=>{const el=document.getElementById('plugin-view-container:workbench.view.extension.skillStudioInspector');const r=el?.getBoundingClientRect();return {text:el?.innerText??'',visible:!!r&&r.width>0&&r.height>0};})()");
    const text=inspectorState.text;
    if(inspectorState.visible&&
       text.includes("Contract Goal · pdu_session.initial_request_fulfilled")&&
       text.includes("Global Precondition · get-sm-subscription-data.precondition")&&
       /Data Flow · \d+ arguments/.test(text)&&
       text.includes("Source lineage only"))break;
    await sleep(100);
  }
  const inspectorText=inspectorState.text;
  const phaseEvidence={
    visible:inspectorState.visible,
    contractGoal:inspectorText.includes("Contract Goal · pdu_session.initial_request_fulfilled"),
    globalPrecondition:inspectorText.includes("Global Precondition · get-sm-subscription-data.precondition"),
    selectedNode:inspectorText.includes("get-sm-subscription-data"),
    dataflow:/Data Flow · \d+ arguments/.test(inspectorText),
    sourceOnly:inspectorText.includes("Source lineage only")&&
      inspectorText.toLowerCase().includes("not linked"),
    noRuntimeClaims:!inspectorText.includes("Runtime Evidence")&&
      !/Runtime (?:PASS|FAILED|SUCCEEDED|COMMITTED)/.test(inspectorText)
  };
  if(!phaseEvidence.visible||!phaseEvidence.contractGoal||
     !phaseEvidence.globalPrecondition||!phaseEvidence.selectedNode||
     !phaseEvidence.dataflow||!phaseEvidence.sourceOnly||
     !phaseEvidence.noRuntimeClaims)
    throw Error("v1alpha4 Inspector did not expose the selected Source-only projection: "+
      JSON.stringify({phaseEvidence,inspectorSelection,
        inspectorText:inspectorText.slice(-2200),
        inspectorContainer:await evalJS("(()=>{const el=document.getElementById('plugin-view-container:workbench.view.extension.skillStudioInspector');return {text:el?.innerText??'',html:el?.innerHTML?.slice(-3500)??'',visible:!!el&&el.getBoundingClientRect().width>0};})()") }));
  console.log("STUDIO_V1ALPHA4_INSPECTOR_CHROMIUM",JSON.stringify(phaseEvidence));

  // A single native EditorGroup test covers Procedure/Contract/Predicate/Schema
  // visuals followed by ordinary Python/YAML Source tabs and a second Skill.
  const editorGroupPlacement=await nativeCommand("skillStudio.internal.editorGroupAcceptance");
  if(!(editorGroupPlacement?.openedVisualCount>=3)||
     !(editorGroupPlacement?.groupCount>=1)||editorGroupPlacement.groupCount>2||
     editorGroupPlacement?.maxViewColumn>2||
     editorGroupPlacement?.pythonColumn!==1||
     editorGroupPlacement?.ordinaryYamlColumn!==1)
    throw Error("v1alpha4 editor groups did not remain a stable two-column layout: "+
      JSON.stringify(editorGroupPlacement));
  console.log("STUDIO_V1ALPHA4_EDITOR_GROUPS_CHROMIUM",JSON.stringify(editorGroupPlacement));

  // Native Markdown is the VS Code Markdown extension, with one shared
  // Source-left / Preview-right layout for both v1alpha4 Skill documents.
  const skillGuideUri=defaultProcedureUri.replace(
    /\/assurance\/procedure\.yaml$/,"/SKILL.md");
  const mappingUri=defaultProcedureUri.replace(
    "/skills/establish-pdu-session/assurance/procedure.yaml",
    "/skills/establish-pdu-session-mas/assurance/openamsm-operation-mapping.md");
  const nativeMarkdownUri=await nativeCommand(
    "skillStudio.internal.nativeMarkdownOpenFromColumnAcceptance",skillGuideUri,1);
  if(nativeMarkdownUri!==skillGuideUri)
    throw Error("Native Markdown did not open the exact v1alpha4 Skill guide: "+nativeMarkdownUri);
  const nativeMarkdown=await waitNativeMarkdown(view=>
    view.heading?.includes("Establish PDU Session")&&
    view.styles.some(url=>url.includes("/media/native-markdown-preview.css")),
    "v1alpha4 native Markdown Preview");
  if(nativeMarkdown.view.headingColor!=="rgb(12, 142, 123)"||
     nativeMarkdown.view.maxWidth!=="980px")
    throw Error("v1alpha4 Markdown Preview did not apply the shared Studio theme: "+
      JSON.stringify(nativeMarkdown.view));
  if(requireBrowserLsp){
    const markdownStartup=await nativeCommand(
      "skillStudio.internal.nativeMarkdownWorkerStartupAcceptance");
    if(!markdownStartup?.isActive||markdownStartup.activationResult!=="ready"||
       !markdownStartup.workerAvailable||markdownStartup.workerProbe?.ok!==true||
       markdownStartup.workerProbe?.status!==200)
      throw Error("Native Markdown Language Server did not start cleanly: "+
        JSON.stringify(markdownStartup));
  }
  const markdownDiagnostics=await nativeCommand(
    "skillStudio.internal.nativeMarkdownWorkerDiagnostics");
  const assertTwoColumns=async(stage,uri)=>{
    const layout=await nativeCommand("skillStudio.internal.twoColumnLayoutAcceptance");
    const columns=layout?.groups?.map(group=>group.column)??[];
    if(!columns.length||columns.length>2||columns.some(col=>col!==1&&col!==2)||
       layout.editors?.some(editor=>editor.column!==1&&editor.column!==2))
      throw Error("Unexpected editor group after "+stage+": "+JSON.stringify(layout));
    if(uri){
      const source=layout.groups.find(group=>group.column===1)?.tabs?.find(tab=>
        tab.uri===uri&&!tab.viewType);
      const preview=layout.groups.find(group=>group.column===2)?.tabs?.find(tab=>
        tab.uri===uri&&tab.viewType==="vscode.markdown.preview.editor");
      if(!source||!preview)
        throw Error("Markdown Source/Preview did not occupy columns 1/2 after "+stage+": "+
          JSON.stringify(layout));
    }
    return layout;
  };
  const markdownLayout=await assertTwoColumns("initial v1alpha4 Markdown Preview",nativeMarkdownUri);
  const secondMarkdownUri=await nativeCommand(
    "skillStudio.internal.nativeMarkdownOpenFromColumnAcceptance",mappingUri,2);
  if(secondMarkdownUri!==mappingUri)
    throw Error("Native Markdown did not open the v1alpha4 MAS mapping document: "+
      JSON.stringify(secondMarkdownUri));
  const secondMarkdown=await waitNativeMarkdown(view=>
    view.heading?.includes("OpenAMSM source mapping")&&
    view.styles.some(url=>url.includes("/media/native-markdown-preview.css")),
    "v1alpha4 MAS mapping Markdown Preview");
  const secondMarkdownLayout=await assertTwoColumns(
    "second v1alpha4 Markdown source opened from the right group",secondMarkdownUri);
  const nativeMarkdownEvidence={
    uri:nativeMarkdownUri,preview:nativeMarkdown.view,layout:markdownLayout,
    secondUri:secondMarkdownUri,secondPreview:secondMarkdown.view,
    secondLayout:secondMarkdownLayout,workerDiagnostics:markdownDiagnostics
  };
  console.log("STUDIO_V1ALPHA4_NATIVE_MARKDOWN_CHROMIUM",JSON.stringify(nativeMarkdownEvidence));

  const liveUri=await nativeCommand(
    "skillStudio.internal.nativeMarkdownLiveUpdateAcceptance",skillGuideUri);
  try{
    const live=await waitNativeMarkdown(view=>
      view.heading==="Native Markdown Live Update Probe",
      "v1alpha4 Markdown unsaved Source update");
    const settings=await nativeCommand("skillStudio.internal.nativeMarkdownSettingsAcceptance");
    if(settings?.scrollEditorWithPreview!==true||settings?.scrollPreviewWithEditor!==true)
      throw Error("Native Markdown bidirectional scroll settings are not enabled: "+
        JSON.stringify(settings));
    console.log("STUDIO_V1ALPHA4_MARKDOWN_LIVE_UPDATE_CHROMIUM",JSON.stringify({
      uri:liveUri,preview:live.view,scrollEditorWithPreview:settings.scrollEditorWithPreview,
      scrollPreviewWithEditor:settings.scrollPreviewWithEditor
    }));
  }finally{
    await nativeCommand("core.undo");
    await nativeCommand("skillStudio.internal.restoreNativeMarkdownLiveUpdateAcceptance",liveUri);
  }
  await waitNativeMarkdown(view=>view.heading?.includes("Establish PDU Session"),
    "restored v1alpha4 Skill Markdown Preview");

  const securityUri=await nativeCommand(
    "skillStudio.internal.nativeMarkdownSecurityAcceptance",skillGuideUri);
  try{
    const security=await waitNativeMarkdown(view=>
      view.heading==="Native Markdown Security Probe",
      "v1alpha4 Markdown security probe");
    const safeLink=security.view.anchorDetails.find(anchor=>
      anchor.text==="Safe package reference");
    const blockedLinks=security.view.anchorDetails.filter(anchor=>
      anchor.text==="Escaping package link"||anchor.text==="Missing package link");
    if(security.view.imageCount!==0||security.view.scriptMarkers!==0||
       security.view.scriptExecuted||!safeLink||
       safeLink.href!=="assurance/contract.yaml"||blockedLinks.length||
       !security.view.csp.includes("default-src 'none'")||
       /script-src[^;]*unsafe-inline/.test(security.view.csp))
      throw Error("Native Markdown package security boundary failed: "+
        JSON.stringify(security.view));
    console.log("STUDIO_V1ALPHA4_MARKDOWN_SECURITY_CHROMIUM",
      JSON.stringify(security.view));
  }finally{
    await nativeCommand("skillStudio.internal.removeNativeMarkdownSecurityAcceptance",securityUri);
  }

  // The native Contract, Predicate and Schema Designers render the v1alpha4
  // source files from the same Skill Package and retain native Source pairing.
  const contractUri=await openPackageFile("skillStudio.openContract","assurance/contract.yaml");
  const contract=await waitWebview(view=>view.title==="SKILL Contract Visual"&&
    view.bodyText.includes("Package\nestablish-pdu-session\n")&&
    view.bodyText.includes("nudm-sdm-get"),
    "v1alpha4 5GC Contract Designer");
  const expectedContractCards=["Goal & Preconditions","Schemas & Context",
    "Capabilities","Dependencies","Limits"];
  const contractCards=contract.view.cards??[];
  if(!contract.view.bodyText.includes("Package\nestablish-pdu-session\n")||
     !contract.view.bodyText.includes("pdu_session.initial_request_fulfilled")||
     !contract.view.bodyText.includes("nudm-sdm-get")||
     expectedContractCards.some(title=>!contract.view.cards.includes(title)))
    throw Error("v1alpha4 Contract Designer did not render the current Contract Source: "+
      JSON.stringify(contract.view).slice(0,2600));
  await assertSourceVisualPair(evalJS,sleep,"contract.yaml","v1alpha4 Contract Designer");
  const predicateUri=await openPackageFile("skillStudio.openPredicates","assurance/predicates.yaml");
  const predicates=await waitWebview(view=>view.title==="SKILL Predicate Visual"&&
    view.bodyText.includes("establishment.ran.adopted"),
    "v1alpha4 5GC Predicate Designer");
  const predicateDetails=await command("Runtime.evaluate",{
    contextId:predicates.contextId,returnByValue:true,
    expression:"(()=>{const item=[...document.querySelectorAll('details.predicate')].find(node=>node.querySelector('.pid')?.textContent.trim()==='establishment.subscription.request_valid');if(!item)return {opened:false,bodyText:document.body?.innerText??''};item.open=true;return {opened:true,bodyText:document.body?.innerText??''};})()"
  });
  const predicateText=predicateDetails.result?.value?.bodyText??predicates.view.bodyText;
  if(!predicateDetails.result?.value?.opened||
     !predicateText.includes("establishment.ran.adopted")||
     !predicateText.includes("scripts/validate-subscription-request.py")||
     !predicateText.includes("Parameters → Evidence → Evaluator")||
     !predicateText.includes("Evidence Requirements")||
     predicateText.includes("Observation"))
    throw Error("v1alpha4 Predicate Designer did not render the current PredicateSet: "+
      JSON.stringify({view:predicates.view,predicateText:predicateText.slice(-2600)}));
  await assertSourceVisualPair(evalJS,sleep,"predicates.yaml","v1alpha4 Predicate Designer");
  const schemaUri=await openPackageFile(
    "skillStudio.openSchema","schemas/establishment-request.schema.yaml");
  const schema=await waitWebview(view=>view.title==="SKILL Schema Visual"&&
    view.bodyText.includes("Schema ID urn:connectionagent:example:5gc:establishment-request:v1alpha4")&&
    view.bodyText.includes("establishment-request"),
    "v1alpha4 5GC Schema Designer");
  if(!schema.view.bodyText.includes("sNssai")||
     !schema.view.bodyText.includes("requestedPduSessionType")||
     !schema.view.bodyText.includes("const: IPV4")||
     !schema.view.bodyText.includes("Draft 2020-12"))
    throw Error("v1alpha4 Schema Designer did not render the real request Schema: "+
      JSON.stringify(schema.view).slice(0,2600));
  await assertSourceVisualPair(evalJS,sleep,"establishment-request.schema.yaml",
    "v1alpha4 Schema Designer");
  console.log("STUDIO_V1ALPHA4_DESIGNERS_CHROMIUM",JSON.stringify({
    contract:{uri:contractUri,cards:contractCards},
    predicates:{uri:predicateUri,heading:predicates.view.title},
    schema:{uri:schemaUri,heading:schema.view.title}
  }));

  // Verify the second v1alpha4 Skill opens through its exact URI, then restore
  // the primary 5GC Procedure as the final active editor.
  const masProcedureUri=defaultProcedureUri.replace(
    "/establish-pdu-session/assurance/procedure.yaml",
    "/establish-pdu-session-mas/assurance/procedure.yaml");
  await nativeCommand("core.close.all.main.tabs");
  await nativeCommand("skillStudio.openProcedure",masProcedureUri);
  const masPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","v1alpha4 MAS Procedure Designer");
  const masGraph=await waitWebview(view=>
    view.procedureRoot&&view.bodyText.includes("establish-pdu-session-mas")&&view.graphNodes>0,
    "v1alpha4 MAS Procedure graph");
  await nativeCommand("core.close.all.main.tabs");
  await nativeCommand("skillStudio.openProcedure",defaultProcedureUri);
  const restoredPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","restored v1alpha4 5GC Procedure Designer");
  const finalGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "restored default v1alpha4 5GC Procedure graph");

  const packageOverviewEvidence=await runPackageOverviewAcceptance({
    command,evalJS,sleep,requireEditor
  });
  if(!packageOverviewEvidence?.twoSkills||
     packageOverviewEvidence.evidence?.skills?.length!==2)
    throw Error("Package Overview did not discover both v1alpha4 Skills: "+
      JSON.stringify(packageOverviewEvidence));
  await nativeCommand("core.close.all.main.tabs");
  await nativeCommand("skillStudio.openProcedure",defaultProcedureUri);
  const finalPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","final v1alpha4 default Procedure Designer");
  const finalRestoredGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "final default v1alpha4 Procedure graph");

  const dualSkillExplorer={
    root:"skill-studio-demo/skills",
    conventionalFolder:"establish-pdu-session",
    masFolder:"establish-pdu-session-mas",
    masProcedureUri,masPair,masGraph:masGraph.view,
    packageOverview:packageOverviewEvidence.evidence,
    conventionalProcedure:finalPair,
    conventionalGraph:finalRestoredGraph.view
  };
  const restored={
    url:finalRestoredGraph.view.url,
    readyState:"complete",
    hasRoot:finalRestoredGraph.view.procedureRoot,
    nodes:finalRestoredGraph.view.graphNodes,
    procedureValue:finalRestoredGraph.view.procedureValue,
    bodyText:finalRestoredGraph.view.bodyText
  };
  const warmTiming={type:"rendered",cacheHit:true,revision:finalRestoredGraph.view.revision};
  console.log("STUDIO_V1ALPHA4_DUAL_SKILL_EXPLORER_CHROMIUM",
    JSON.stringify(dualSkillExplorer));
  console.log("STUDIO_LAYOUT_TIMING",JSON.stringify({initialTiming,warmTiming}));
  console.log("STUDIO_WORKBENCH_CHROMIUM",JSON.stringify({
    views:true,packageAudit:true,languageServiceStatus,
    nativeSingleClick:true,nativeDoubleClick:true,
    reopenMs:Date.now()-started
  }));
  return {
    views:true,packageAudit:true,languageServiceStatus,
    phaseEvidence,packageZip:{details:zipNotice.details,...packageZip},
    markdown:true,restored,initialTiming,warmTiming,
    nativeSingleClick:true,nativeDoubleClick:true,reopenMs:Date.now()-started,
    dualSkillExplorer,packageOverview:packageOverviewEvidence.evidence,
    graphEditability,canvasToolbar,
    v1alpha4LanguageFeatures,semanticTokenEvidence,
    nativeMarkdownEvidence,designerEvidence:{
      contract:contract.view,predicates:predicates.view,schema:schema.view
    }
  };
}
