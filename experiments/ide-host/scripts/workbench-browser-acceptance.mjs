// Runs against actual Theia DOM. Source stays in the single Main Editor group;
// its contextual visualizer is a WebviewView in the right Secondary Sidebar.
export async function assertSourceVisualPair(evalJS,sleep,filename,label){
  let state;
  for(let attempt=0;attempt<40;attempt++){
    state=await evalJS(`(()=>{
      const c=window.theia.container;
      const key=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.activateWidget&&k.prototype?.addWidget);
      if(!key)throw Error('Theia shell missing');
      const shell=c.get(key);
      const commandKey=[...c._bindingDictionary._map.keys()].find(k=>
        typeof k==='function'&&k.prototype?.executeCommand&&
        k.prototype?.registerCommand&&k.prototype?.getCommand);
      const registry=commandKey?c.get(commandKey):null;
      const commandIds=[
        'workbench.view.extension.skillStudioInspector',
        'workbench.action.focusAuxiliaryBar',
        'workbench.action.toggleAuxiliaryBar',
        'workbench.action.focusSideBar',
        'workbench.action.toggleSidebar'
      ].map(id=>({id,registered:Boolean(registry?.getCommand?.(id))}));
      const availableViewCommands=(registry?.getCommands?.()??[])
        .map(item=>typeof item==='string'?item:item?.id??item?.commandId??'')
        .filter(id=>/view|sidebar|auxiliary|container|widget/i.test(id)).slice(0,180);
      const inspect=(area,widget)=>{
        const node=widget.node,rect=node?.getBoundingClientRect?.();
        const visible=!!rect&&rect.width>0&&rect.height>0&&!widget.isHidden;
        const nested=[...(node?.querySelectorAll?.('.lm-Widget')??[])];
        const elements=[node,...nested].filter(Boolean);
        const webviews=elements.flatMap(el=>[...(el.querySelectorAll?.('iframe')??[])])
          .map(frame=>{const r=frame.getBoundingClientRect();return {
            src:frame.getAttribute('src')??'',title:frame.title??'',
            visible:r.width>0&&r.height>0,
            rect:{x:r.x,y:r.y,width:r.width,height:r.height}
          };}).filter(frame=>frame.visible);
        return {id:widget.id??node?.id??null,area,viewId:widget.viewId??null,
          title:widget.title?.label??widget.title?.caption??null,
          className:typeof node?.className==='string'?node.className:'',
          text:(node?.innerText??'').slice(0,160),visible,
          rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null,
          webviews};
      };
      const bars=shell.mainAreaTabBars??[];
      const main=shell.getWidgets('main').map(widget=>{
        const uri=widget.editor?.uri??widget.resource;
        const rect=widget.node?.getBoundingClientRect?.();
        return {id:widget.id,uri:uri?.toString?.()??null,
          kind:widget.editor?'source':widget.viewType??'unknown',
          column:bars.findIndex(bar=>bar.titles.some(title=>title.owner===widget))+1,
          visible:!widget.isHidden&&!!rect&&rect.width>0&&rect.height>0,
          rect:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null};
      });
      const right=shell.getWidgets('right').map(widget=>inspect('right',widget));
      const left=shell.getWidgets('left').map(widget=>inspect('left',widget));
      const source=main.filter(widget=>widget.kind==='source'&&widget.visible&&
        widget.uri?.endsWith('/'+${JSON.stringify(filename)}));
      const preview=[...right,...left].flatMap(widget=>[
        {widget,frame:null},...widget.webviews.map(frame=>({widget,frame}))
      ]).filter(item=>item.widget.visible&&item.frame?.visible&&
        item.frame.rect.x>=0);
      const sourceRight=source[0]?.rect?.x+source[0]?.rect?.width;
      const rightPreview=preview.find(item=>item.frame.rect.x>=sourceRight-2);
      const tabBars=bars.map(bar=>{
        const r=bar.node?.getBoundingClientRect?.();
        return {visible:!!r&&r.width>0&&r.height>0,
          tabs:bar.titles?.length??0,
          rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};
      });
      // The fixed Theia Main Editor uses single-document mode, which
      // intentionally has no tab bar. Count its single Main Editor panel as
      // one group when a Source widget is visible; do not mistake tabBarCount=0
      // for the absence of an Editor group.
      const visibleTabBarCount=tabBars.filter(x=>x.visible).length;
      const visibleEditorGroups=visibleTabBarCount>0
        ?visibleTabBarCount
        :(main.some(widget=>widget.visible)?1:0);
      return {main,right,left,source,preview,selectedPreview:rightPreview??null,
        commandIds,availableViewCommands,tabBars,visibleEditorGroups};
    })()`);
    const source=state.source??[];
    const preview=state.selectedPreview;
    // Preview is deliberately NOT a Main Editor widget. It must be a visible
    // Webview iframe hosted in the right-hand sidebar, beyond the Source pane.
    if(source.length===1&&source[0].column===1&&preview&&
       state.visibleEditorGroups===1&&
       source[0].rect.x+source[0].rect.width<=preview.frame.rect.x+2){
      const evidence={filename,label,source:source[0],preview:{
        area:preview.widget.area,id:preview.widget.id,viewId:preview.widget.viewId,
        title:preview.widget.title,frame:preview.frame
      },visibleEditorGroups:state.visibleEditorGroups};
      console.log('STUDIO_YAML_SOURCE_PREVIEW_CHROMIUM',JSON.stringify(evidence));
      return evidence;
    }
    await sleep(120);
  }
  throw Error(label+' requires exactly one Main Editor Source group and a visible right-side Preview WebviewView: '+JSON.stringify(state));
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
  async function revealTreeRow(row,label){
    const id=row?.nodeIds?.[0];
    if(!id)throw Error('Native tree row has no node ID: '+label+' '+JSON.stringify(row));
    const target=await evalJS(`(()=>{
      const anchor=[...document.querySelectorAll('[data-node-id]')].
        find(el=>el.getAttribute('data-node-id')===${JSON.stringify(id)});
      const rowEl=anchor?.closest('.theia-TreeNode');
      if(!rowEl)return {found:false};
      rowEl.scrollIntoView({block:'center',inline:'nearest'});
      const r=rowEl.getBoundingClientRect();
      return {found:true,visible:r.width>0&&r.height>0&&r.x<innerWidth&&r.y<innerHeight&&r.right>0&&r.bottom>0};
    })()`);
    if(!target?.found)throw Error('Native tree row is not reachable: '+label+' '+JSON.stringify({target,row}));
    return target;
  }

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
      // The native Explorer may have been scrolled to its final row. Center
      // the target inside the actual tree scroller before dispatching input;
      // a visible hit-test at the viewport edge is not a reliable click.
      let scroller=null;
      for(let parent=toggle.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if((style.overflowY==='auto'||style.overflowY==='scroll')&&
           parent.scrollHeight>parent.clientHeight+4){scroller=parent;break;}
      }
      if(scroller){
        const before=toggle.getBoundingClientRect();
        const desired=Math.max(120,Math.min(innerHeight-120,innerHeight/2));
        scroller.scrollTop+=before.top+before.height/2-desired;
      }
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
    const originallyCollapsed=String(row.toggleClass??'').includes('theia-mod-collapsed');
    const stateFor=async()=>evalJS(`(()=>{
      const anchor=[...document.querySelectorAll('[data-node-id]')]
        .find(el=>el.getAttribute('data-node-id')===${JSON.stringify(id)});
      const toggle=anchor?.closest('.theia-TreeNode')?.querySelector('.theia-ExpansionToggle');
      return toggle?{found:true,collapsed:toggle.classList.contains('theia-mod-collapsed')}:
        {found:false};
    })()`);
    let after=null;
    for(let attempt=0;attempt<3;attempt++){
      if(attempt){
        // Re-resolve a virtualized tree row after a missed input dispatch.
        await revealTreeRow(row,label);
        const retried=await evalJS(`(()=>{
          const anchor=[...document.querySelectorAll('[data-node-id]')]
            .find(el=>el.getAttribute('data-node-id')===${JSON.stringify(id)});
          const toggle=anchor?.closest('.theia-TreeNode')?.querySelector('.theia-ExpansionToggle');
          if(!toggle)return null;
          const r=toggle.getBoundingClientRect();
          const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
          const hit=document.elementFromPoint(x,y);
          return {x,y,hitWithinToggle:hit===toggle||toggle.contains(hit)};
        })()`);
        if(!retried?.hitWithinToggle)continue;
        target.x=retried.x;target.y=retried.y;
      }
      await click(target.x,target.y);
      for(let poll=0;poll<12;poll++){
        await sleep(100);
        after=await stateFor();
        if(after?.found&&after.collapsed!==originallyCollapsed)return;
      }
    }
    throw Error('Trusted native Package toggle click did not change expansion state: '+
      label+' '+JSON.stringify({row,target,after}));
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
    throw Error('Two-SKILL v1alpha5 inventory does not match the pinned sample manifest: '+
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
    definition:1,assurance:3,schemas:1,references:1
  });

  // Dependencies must be a real section in the same native TreeView in both
  // backend and browser-only Theia. It starts collapsed and expands to the
  // owner-provided empty state; no second Dependencies view is permitted.
  // Skills are expanded above it, so reveal the lower native TreeView rows
  // before querying visibility rather than treating off-screen as missing.
  await evalJS(`(()=>{
    const header=[...document.querySelectorAll('.theia-view-container-part-header')]
      .find(x=>x.textContent.trim().toLowerCase()==='package explorer'&&
        x.getBoundingClientRect().width>0&&x.getBoundingClientRect().x>=0);
    const part=header?.closest('.part');
    const candidates=[...(part?.querySelectorAll('*')??[])].filter(el=>{
      const style=getComputedStyle(el);
      return (style.overflowY==='auto'||style.overflowY==='scroll')&&
        el.scrollHeight>el.clientHeight+4;
    }).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
    const scroller=candidates[0];
    if(scroller)scroller.scrollTop=scroller.scrollHeight;
    return {found:Boolean(scroller),scrollTop:scroller?.scrollTop??null,
      scrollHeight:scroller?.scrollHeight??null,clientHeight:scroller?.clientHeight??null};
  })()`);
  await sleep(180);
  rows=await readTreeRows();
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
        row.text.includes('Assurance · 3/3 core'));
      if(group){
        if(!group.visible){
          await revealTreeRow(group,name+' Assurance group');
          await sleep(80);
          continue;
        }
        return {rows,range};
      }
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
    throw Error('v1alpha5 5GC Package row disappeared after Dependencies interaction');
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
    definition:1,assurance:3,schemas:1,references:1
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
  command,evalJS,evalWebviewJS,sleep,requireEditor,requireBrowserLsp=false,
  requireCompilerWorker=false,procedureUri
}){
  if(!requireEditor)return {required:false};
  const defaultProcedureUri=String(procedureUri??"");
  const procedureSuffix="/skills/establish-pdu-session/assurance/procedure.yaml";
  if(!defaultProcedureUri.endsWith(procedureSuffix))
    throw Error("Browser acceptance must run against the active CA-SL v1alpha5 5GC Procedure: "+
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
            frameId:frame.id,worldName:"skill-studio-v1alpha5-acceptance",
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
              "studioMarkdownStatus:document.querySelector('#studio-status')?.textContent??'',"+
              "markdownBlockCount:document.querySelectorAll('.studio-markdown-block[data-source-line]').length,"+
              "scrollY:window.scrollY,"+
              "procedureRoot:!!root,graphNodes:document.querySelectorAll('.react-flow__node').length,"+
              "graphEdges:document.querySelectorAll('.react-flow__edge').length,"+
              "procedureValue:document.querySelector('#procedureList')?.value??null,"+
              "revision:document.querySelector('#revision')?.textContent??null,"+
              "timing:root?.dataset.studioTiming??null,"+
              "cards:[...document.querySelectorAll('.card h2')].map(el=>el.textContent.trim()),"+
              "heading:heading?.textContent?.trim()??null,"+
              "studioMarkdownPreviewRoot:Boolean(document.querySelector('#studio-content')&&"+
              "styles.some(url=>url.includes('/media/studio-markdown-preview.css'))),"+
              "styles,headingColor:heading?getComputedStyle(heading).color:null,"+
              "maxWidth:document.body?getComputedStyle(document.body).maxWidth:null,"+
              "anchorDetails:[...document.querySelectorAll('a')].map(anchor=>({"+
              "text:anchor.textContent.trim(),href:anchor.getAttribute('href'),"+
              "dataStudioHref:anchor.getAttribute('data-studio-href'),resolvedHref:anchor.href})),"+
              "imageCount:document.querySelectorAll('img').length,"+
              "scriptMarkers:[...document.scripts].filter(script=>"+
              "script.textContent.includes('skillStudioMarkdownXss')).length,"+
              "scriptExecuted:window.skillStudioMarkdownXss===true,"+
              "csp:document.querySelector('meta[http-equiv=\"Content-Security-Policy\" i]')?.content??''"+
              "};})()"
          });
          const view=evaluated.result?.value;
          if(!view)continue;
          latest.candidates.push({url:frame.url,title:view.title,
            procedureValue:view.procedureValue,heading:view.heading,
            nodes:view.graphNodes,preview:view.studioMarkdownPreviewRoot});
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
  const waitStudioMarkdown=(predicate,label,attempts=100)=>
    waitWebview(view=>view.studioMarkdownPreviewRoot&&predicate(view),label,attempts);
  const evaluateStudioMarkdown=async(preview,expression)=>{
    const result=await command("Runtime.evaluate",{
      contextId:preview.contextId,returnByValue:true,awaitPromise:true,expression
    });
    if(result.exceptionDetails)
      throw Error("Markdown Preview evaluation failed: "+
        (result.exceptionDetails.exception?.description??result.exceptionDetails.text));
    return result.result?.value;
  };
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
    evalJS,sleep,"procedure.yaml","CA-SL v1alpha5 Procedure Designer");
  const sourceState=await nativeCommand("skillStudio.internal.sourceVersionAcceptance");
  if(sourceState?.uri!==defaultProcedureUri||!Number.isSafeInteger(sourceState.version))
    throw Error("Native Source is not the exact v1alpha5 Procedure TextDocument: "+
      JSON.stringify({expected:defaultProcedureUri,sourceState,procedurePair}));
  const initialGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "default v1alpha5 Procedure graph");
  const initialTiming=initialGraph.view.timing?JSON.parse(initialGraph.view.timing):{
    type:"rendered",revision:initialGraph.view.revision,nodes:initialGraph.view.graphNodes
  };

  // The v1alpha5 candidate graph is intentionally read-only. Route changes belong
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
    throw Error("v1alpha5 Procedure graph exposed legacy interactive Route editing: "+
      JSON.stringify(graphEditability));
  const sourceAfterGraph=await nativeCommand("skillStudio.internal.sourceVersionAcceptance");
  if(sourceAfterGraph?.uri!==defaultProcedureUri||
     sourceAfterGraph.version!==sourceState.version)
    throw Error("Read-only v1alpha5 graph interaction changed authoritative Source: "+
      JSON.stringify({sourceState,sourceAfterGraph,graphEditability}));
  graphEditability.sourceUnchanged=true;
  console.log("STUDIO_V1ALPHA5_GRAPH_READ_ONLY_CHROMIUM",JSON.stringify(graphEditability));

  // The released v1alpha5 Root graph keeps the same read-only path-focus UX:
  // default success backbone, optional route-category filters and per-Node folding.
  const toolbarInitial=await evalWebviewJS("(()=>({"+
    "layout:document.querySelector('#layoutDirection')?.value??null,"+
    "rootMode:document.querySelector('#rootPathMode')?.value??null,"+
    "rootVisible:document.querySelector('#rootPathToolbar')?.hidden===false,"+
    "rootFiltersVisible:document.querySelector('#rootPathFilters')?.hidden===false,"+
    "toolbarVisible:document.querySelector('#graphTools')?.hidden===false,"+
    "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
    "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length,"+
    "controls:['columns-2','network','eye','locate-fixed','zoom-out','zoom-in','maximize','fit-width','fit-height']"+
    ".map(name=>({name,found:[...document.querySelectorAll('#graphTools svg[data-icon]')].some(el=>el.getAttribute('data-icon')===name)}))"+
    "}))()");
  if(toolbarInitial?.layout!=="DOWN"||toolbarInitial.rootMode!=="normal"||
     !toolbarInitial.rootVisible||toolbarInitial.rootFiltersVisible||
     !toolbarInitial.toolbarVisible||!(toolbarInitial.nodes>0)||!(toolbarInitial.edges>0)||
     toolbarInitial.controls.some(item=>!item.found))
    throw Error("v1alpha5 Root graph must open on the compact main path with path controls available: "+
      JSON.stringify(toolbarInitial));

  const branchInitial=await evalWebviewJS("(()=>{"+
    "const button=[...document.querySelectorAll('#reactFlowRoot .designer-hidden-branches')]"+
      ".find(item=>/^\\+\\d+ 条$/.test(item.textContent.trim()));"+
    "const card=button?.closest('.react-flow__node');"+
    "const rect=card?.getBoundingClientRect();"+
    "const viewport=document.querySelector('#reactFlowRoot .react-flow__viewport');"+
    "const transform=viewport?getComputedStyle(viewport).transform:'none';"+
    "const zoom=transform==='none'?1:new DOMMatrixReadOnly(transform).a;"+
    "return {buttonText:button?.textContent.trim()??null,nodeId:card?.querySelector('.designer-node-id')?.textContent.trim()??null,"+
      "rect:rect?{x:rect.x,y:rect.y}:null,zoom,"+
      "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
      "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length};})()");
  if(!branchInitial?.buttonText?.startsWith('+')||!branchInitial.nodeId||!branchInitial.rect)
    throw Error("v1alpha5 main path did not expose a per-Node hidden-branch control: "+
      JSON.stringify({toolbarInitial,branchInitial}));

  await evalWebviewJS("(()=>{const id="+JSON.stringify(branchInitial.nodeId)+";"+
    "const card=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
      ".find(item=>item.querySelector('.designer-node-id')?.textContent.trim()===id);"+
    "card?.querySelector('.designer-hidden-branches')?.click();return true;})()");
  let branchExpanded=null;
  for(let attempt=0;attempt<40;attempt++){
    branchExpanded=await evalWebviewJS("(()=>{const id="+JSON.stringify(branchInitial.nodeId)+";"+
      "const card=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
        ".find(item=>item.querySelector('.designer-node-id')?.textContent.trim()===id);"+
      "const button=card?.querySelector('.designer-hidden-branches');"+
      "const rect=card?.getBoundingClientRect();"+
      "const viewport=document.querySelector('#reactFlowRoot .react-flow__viewport');"+
      "const transform=viewport?getComputedStyle(viewport).transform:'none';"+
      "return {buttonText:button?.textContent.trim()??null,pressed:button?.getAttribute('aria-pressed')??null,"+
        "rect:rect?{x:rect.x,y:rect.y}:null,zoom:transform==='none'?1:new DOMMatrixReadOnly(transform).a,"+
        "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
        "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length};})()");
    const anchorDelta=branchExpanded?.rect?Math.max(
      Math.abs(branchExpanded.rect.x-branchInitial.rect.x),
      Math.abs(branchExpanded.rect.y-branchInitial.rect.y)):Infinity;
    if(branchExpanded?.buttonText==="收起"&&anchorDelta<2&&
       Math.abs(branchExpanded.zoom-branchInitial.zoom)<0.001)break;
    await sleep(100);
  }
  const anchorExpandedDelta=branchExpanded?.rect?Math.max(
    Math.abs(branchExpanded.rect.x-branchInitial.rect.x),
    Math.abs(branchExpanded.rect.y-branchInitial.rect.y)):Infinity;
  if(branchExpanded?.buttonText!=="收起"||branchExpanded.pressed!=="true"||
     !(branchExpanded.nodes>branchInitial.nodes)||!(branchExpanded.edges>branchInitial.edges)||
     anchorExpandedDelta>=2||Math.abs(branchExpanded.zoom-branchInitial.zoom)>0.001)
    throw Error("v1alpha5 per-Node branch expansion must preserve its screen anchor and zoom: "+
      JSON.stringify({branchInitial,branchExpanded,anchorExpandedDelta}));

  await evalWebviewJS("(()=>{const id="+JSON.stringify(branchInitial.nodeId)+";"+
    "const card=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
      ".find(item=>item.querySelector('.designer-node-id')?.textContent.trim()===id);"+
    "card?.querySelector('.designer-hidden-branches')?.click();return true;})()");
  let branchCollapsed=null;
  for(let attempt=0;attempt<40;attempt++){
    branchCollapsed=await evalWebviewJS("(()=>{const id="+JSON.stringify(branchInitial.nodeId)+";"+
      "const card=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
        ".find(item=>item.querySelector('.designer-node-id')?.textContent.trim()===id);"+
      "const button=card?.querySelector('.designer-hidden-branches');"+
      "const rect=card?.getBoundingClientRect();"+
      "const viewport=document.querySelector('#reactFlowRoot .react-flow__viewport');"+
      "const transform=viewport?getComputedStyle(viewport).transform:'none';"+
      "return {buttonText:button?.textContent.trim()??null,pressed:button?.getAttribute('aria-pressed')??null,"+
        "rect:rect?{x:rect.x,y:rect.y}:null,zoom:transform==='none'?1:new DOMMatrixReadOnly(transform).a,"+
        "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
        "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length};})()");
    const anchorDelta=branchCollapsed?.rect?Math.max(
      Math.abs(branchCollapsed.rect.x-branchInitial.rect.x),
      Math.abs(branchCollapsed.rect.y-branchInitial.rect.y)):Infinity;
    if(branchCollapsed?.buttonText?.startsWith('+')&&anchorDelta<2&&
       Math.abs(branchCollapsed.zoom-branchInitial.zoom)<0.001)break;
    await sleep(100);
  }
  const anchorCollapsedDelta=branchCollapsed?.rect?Math.max(
    Math.abs(branchCollapsed.rect.x-branchInitial.rect.x),
    Math.abs(branchCollapsed.rect.y-branchInitial.rect.y)):Infinity;
  if(!branchCollapsed?.buttonText?.startsWith('+')||branchCollapsed.pressed!=="false"||
     branchCollapsed.nodes!==branchInitial.nodes||branchCollapsed.edges!==branchInitial.edges||
     anchorCollapsedDelta>=2||Math.abs(branchCollapsed.zoom-branchInitial.zoom)>0.001)
    throw Error("v1alpha5 per-Node branch collapse must restore the compact graph without moving its anchor: "+
      JSON.stringify({branchInitial,branchCollapsed,anchorCollapsedDelta}));

  await evalWebviewJS("(()=>{const s=document.querySelector('#rootPathMode');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(350);
  const allPaths=await evalWebviewJS("(()=>({layout:document.querySelector('#layoutDirection')?.value??null,"+
    "rootMode:document.querySelector('#rootPathMode')?.value??null,"+
    "rootToolbarVisible:document.querySelector('#rootPathToolbar')?.hidden===false,"+
    "nodes:document.querySelectorAll('#reactFlowRoot .react-flow__node').length,"+
    "edges:document.querySelectorAll('#reactFlowRoot .react-flow__edge').length}))()");
  if(allPaths.layout!=="DOWN"||allPaths.rootMode!=="all"||!allPaths.rootToolbarVisible||
     !(allPaths.nodes>branchCollapsed.nodes)||!(allPaths.edges>branchCollapsed.edges))
    throw Error("v1alpha5 All Paths mode did not reveal the full graph: "+
      JSON.stringify({toolbarInitial,allPaths,branchCollapsed}));

  await evalWebviewJS("(()=>{const s=document.querySelector('#rootPathMode');s.value='normal';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(350);
  const sourceAfterBranchFolding=await nativeCommand("skillStudio.internal.sourceVersionAcceptance");
  if(sourceAfterBranchFolding?.uri!==defaultProcedureUri||
     sourceAfterBranchFolding.version!==sourceState.version)
    throw Error("v1alpha5 graph path filtering or branch folding changed authoritative Source: "+
      JSON.stringify({sourceState,sourceAfterBranchFolding,branchInitial,branchExpanded,branchCollapsed,allPaths}));

  await evalWebviewJS("(()=>{const s=document.querySelector('#layoutDirection');s.value='RIGHT';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(180);
  const horizontal=await evalWebviewJS("document.querySelector('#layoutDirection')?.value??null");
  await evalWebviewJS("(()=>{const s=document.querySelector('#layoutDirection');s.value='DOWN';s.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await sleep(350);
  const canvasToolbar={initial:toolbarInitial,horizontal,allPaths,branchInitial,
    branchExpanded,branchCollapsed,anchorExpandedDelta,anchorCollapsedDelta,sourceUnchanged:true};
  console.log("STUDIO_V1ALPHA5_CANVAS_TOOLBAR_CHROMIUM",JSON.stringify(canvasToolbar));

  // Package ZIP must be produced from the exact active v1alpha5 Package snapshot.
  await evalWebviewJS("document.querySelector('#exportPackageZip')?.click();true");
  let zipNotice=null;
  for(let i=0;i<60;i++){
    zipNotice=await evalWebviewJS("({visible:!document.querySelector('#zipExportNotice')?.hidden,"+
      "details:document.querySelector('#zipExportDetails')?.textContent??''})");
    if(zipNotice?.visible)break;
    await sleep(100);
  }
  if(!zipNotice?.visible||!zipNotice.details.includes(".zip"))
    throw Error("v1alpha5 Package ZIP export did not prepare a download: "+JSON.stringify(zipNotice));
  const packageZip=await evalWebviewJS("(()=>{let blobMeta=null,linkMeta=null;"+
    "const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;"+
    "URL.createObjectURL=function(blob){blobMeta={size:blob.size,type:blob.type};return create.call(URL,blob);};"+
    "HTMLAnchorElement.prototype.click=function(){linkMeta={download:this.download,href:this.href};};"+
    "document.querySelector('#downloadPackageZip')?.click();URL.createObjectURL=create;"+
    "HTMLAnchorElement.prototype.click=click;return {blobMeta,linkMeta,noticeHidden:document.querySelector('#zipExportNotice')?.hidden};})()");
  if(!(packageZip?.blobMeta?.size>22)||packageZip.blobMeta.type!=="application/zip"||
     !packageZip.linkMeta?.download?.endsWith(".zip")||
     !packageZip.linkMeta.href.startsWith("blob:")||!packageZip.noticeHidden)
    throw Error("v1alpha5 Package ZIP did not produce a browser Blob download: "+
      JSON.stringify(packageZip));
  packageZip.details=zipNotice.details;
  console.log("STUDIO_V1ALPHA5_PACKAGE_ZIP_CHROMIUM",JSON.stringify(packageZip));

  let languageServiceStatus="NOT_REQUIRED_NODE_HOST";
  let v1alpha5LanguageFeatures=null,semanticTokenEvidence=null;
  if(requireBrowserLsp){
    // A v1alpha5 Package is intentionally PARTIAL until trusted Owner,
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
      "CA-SL v1alpha5 source parsed; static Package qualification requires the v1alpha5 Compiler";
    if(languageServiceDiagnostics?.languageClientStarted!==true||
       languageServiceDiagnostics?.languageTransportFailure||
       !languagePackage||
       languagePackage.state!=="PARTIAL"||
       languagePackage.procedureState!=="READY"||
       languagePackage.packageAuditState!=="UNAVAILABLE"||
       !String(languagePackage.packageAuditReason??"").includes(expectedPartialReason)||
       packageSnapshot?.lastSentSnapshot?.completeness!=="complete")
      throw Error("v1alpha5 Language Service must be available while its unqualified Package remains PARTIAL: "+
        JSON.stringify({languageServiceDiagnostics,expectedPackageRoot,languagePackage,packageSnapshot}));
    console.log("STUDIO_V1ALPHA5_LSP_PARTIAL_IS_EXPECTED_CHROMIUM",JSON.stringify({
      status:languageServiceStatus,
      languageClientStarted:languageServiceDiagnostics.languageClientStarted,
      languagePackage,
      snapshot:packageSnapshot?.lastSentSnapshot
    }));
    v1alpha5LanguageFeatures=await nativeCommand(
      "skillStudio.internal.v1alpha5LanguageProviderAcceptance",defaultProcedureUri);
    if(v1alpha5LanguageFeatures?.status!=="PARTIAL"||
       v1alpha5LanguageFeatures?.snapshotCompleteness!=="complete"||
       !v1alpha5LanguageFeatures.contractPreconditionCompletion?.includes("check.precondition")||
       !v1alpha5LanguageFeatures.requestSchemaCompletion?.includes("schemas/request.schema.yaml")||
       !v1alpha5LanguageFeatures.startNodeCompletion?.includes("check")||
       !v1alpha5LanguageFeatures.predicateCompletion?.includes("demo.ready")||
       !v1alpha5LanguageFeatures.preconditionFields?.includes("predicates:")||
       !v1alpha5LanguageFeatures.observationFields?.includes("tool:")||
       !v1alpha5LanguageFeatures.operationFields?.includes("script:")||
       !v1alpha5LanguageFeatures.scriptPathCompletion?.includes("scripts/runner.py")||
       !v1alpha5LanguageFeatures.waitNodeFields?.includes("wait:")||
       !v1alpha5LanguageFeatures.waitFields?.includes("event:")||
       !v1alpha5LanguageFeatures.waitFields?.includes("routes:")||
       !v1alpha5LanguageFeatures.waitEventFields?.includes("operation:")||
       !v1alpha5LanguageFeatures.waitResponseFields?.includes("after:")||
       !v1alpha5LanguageFeatures.waitRouteKeys?.includes("TIMEOUT:")||
       !v1alpha5LanguageFeatures.waitResponseAfter?.includes("final")||
       v1alpha5LanguageFeatures.waitResponseAfter?.includes("timeout-handler")||
       !v1alpha5LanguageFeatures.waitTimeoutTarget?.includes("timeout-handler")||
       !v1alpha5LanguageFeatures.waitOutput?.includes("await-event.wait.output")||
       v1alpha5LanguageFeatures.waitTimeoutTarget?.includes("SUCCEEDED")||
       !v1alpha5LanguageFeatures.outcomeUnknownTargets?.includes("SAFE_STOPPED")||
       !v1alpha5LanguageFeatures.contractDefinition||
       !v1alpha5LanguageFeatures.predicateDefinition||
       !v1alpha5LanguageFeatures.predicateHoverSignature||
       !v1alpha5LanguageFeatures.predicateReferences||
       !v1alpha5LanguageFeatures.scriptDefinition||
       !v1alpha5LanguageFeatures.procedureOutline?.includes("run-script")||
       !v1alpha5LanguageFeatures.procedureOutline?.includes("await-event")||
       !v1alpha5LanguageFeatures.procedureOutline?.includes("timeout-handler")||
       v1alpha5LanguageFeatures.ownerQualification!=="NOT_QUALIFIED")
      throw Error("Native v1alpha5 language-provider acceptance failed: "+
        JSON.stringify(v1alpha5LanguageFeatures));
    semanticTokenEvidence=await nativeCommand("skillStudio.internal.semanticTokenDiagnostics");
    if(semanticTokenEvidence?.registered!==true||
       !(semanticTokenEvidence?.lastTokenCount>0)||
       semanticTokenEvidence?.renderer!=="theia-text-editor-decoration"||
       !(semanticTokenEvidence?.renderedTokenCount>0)||
       !(semanticTokenEvidence?.renderedTypeCount>=2)||
       semanticTokenEvidence?.renderError)
      throw Error("Native v1alpha5 semantic tokens were not rendered: "+
        JSON.stringify(semanticTokenEvidence));
    console.log("STUDIO_V1ALPHA5_LANGUAGE_FEATURES_CHROMIUM",
      JSON.stringify(v1alpha5LanguageFeatures));
    console.log("STUDIO_V1ALPHA5_SEMANTIC_TOKENS_CHROMIUM",
      JSON.stringify(semanticTokenEvidence));
  }

  // The native Inspector is source-derived and read-only; it is not Runtime Evidence.
  await evalWebviewJS("(()=>{const node=[...document.querySelectorAll('#reactFlowRoot .react-flow__node')]"+
    ".find(el=>el.getAttribute('data-id')==='get-sm-subscription-data');node?.click();return !!node;})()");
  await sleep(120);
  const inspectorSelection=await nativeCommand("skillStudio.internal.selectionAcceptance");
  console.log("STUDIO_V1ALPHA5_INSPECTOR_SELECTION_CHROMIUM",
    JSON.stringify(inspectorSelection));
  if(inspectorSelection?.nodeId!=="get-sm-subscription-data"||
     inspectorSelection?.snapshotState!=="READY")
    throw Error("v1alpha5 graph selection did not reach the native Inspector model: "+
      JSON.stringify(inspectorSelection));
  await nativeCommand("skillStudio.auditPackage");
  const packageDiagnosticState=await nativeCommand(
    "skillStudio.internal.semanticTokenDiagnostics");
  const packageAudit=packageDiagnosticState?.packageAudit;
  const expectedCapabilityId=
    "urn:example:connectionagent:capability:3gpp:namf-communication-n1n2-transfer:v1";
  const capabilityProblem=packageAudit?.problems?.find(item=>
    item.code==="CAPABILITY_GRANT_NOT_CHECKED"&&item.message.includes(expectedCapabilityId));
  const capabilityMarker=packageAudit?.editorMarkers?.find(item=>
    item.code==="CAPABILITY_GRANT_NOT_CHECKED"&&item.message.includes(expectedCapabilityId));
  if(!String(packageAudit?.status??"").includes("NOT_CHECKED")||
     !capabilityProblem||capabilityProblem.status!=="not_checked"||
     capabilityProblem.domain!=="capabilities"||!(capabilityProblem.line>0)||
     !capabilityMarker||capabilityMarker.line!==capabilityProblem.line||
     !packageAudit.problems.some(item=>item.code==="EVIDENCE_GUARANTEE_NOT_CHECKED")||
     !packageAudit.problems.some(item=>item.code==="DEPENDENCY_NOT_CONFIGURED"))
    throw Error("v1alpha5 Package diagnostics must reach Problems and editor markers without Compiler qualification: "+
      JSON.stringify({packageAudit,expectedCapabilityId}));
  console.log("STUDIO_V1ALPHA5_PACKAGE_DIAGNOSTICS_CHROMIUM",JSON.stringify({
    status:packageAudit.status,
    capabilityProblem,capabilityMarker,
    problemCount:packageAudit.problems.length,
    diagnosticCount:packageAudit.diagnostics.length
  }));
  // Run in-memory static diagnostic regression cases. These results belong
  // to the native Test Explorer, never to Source Problems or Runtime Evidence.
  const offlineTests=await nativeCommand("skillStudio.runDiagnosticTests");
  if(!offlineTests||offlineTests.apiVersion!=="skill-studio-diagnostic-regression/v1"||
     offlineTests.qualification!=="NOT_QUALIFIED"||
     offlineTests.summary?.PASS!==11||offlineTests.summary?.FAIL!==0||
     offlineTests.summary?.NOT_RUN!==0||
     !offlineTests.nativeTestExplorer)
    throw Error("Native Test Explorer did not run all 11 offline static diagnostic regression cases: "+
      JSON.stringify(offlineTests));
  console.log("STUDIO_OFFLINE_DIAGNOSTIC_TEST_EXPLORER_CHROMIUM",JSON.stringify({
    nativeTestExplorer:offlineTests.nativeTestExplorer,
    summary:offlineTests.summary,qualification:offlineTests.qualification
  }));
  // Route replays consume scripted Stage Outcomes only. The real browser
  // verifies the native test controller and the exact pinned 5GC route suite.
  const routeTests=await nativeCommand("skillStudio.runRouteScenarios");
  if(routeTests?.apiVersion!=="skill-studio-route-test-results/v1"||
     routeTests.qualification!=="NOT_QUALIFIED"||
     routeTests.summary?.PASS!==5||routeTests.summary?.FAIL!==0||
     routeTests.summary?.NOT_RUN!==0||!routeTests.nativeTestExplorer)
    throw Error("Native Route Test Explorer must replay five 5GC scenarios without Runtime qualification: "+
      JSON.stringify({summary:routeTests?.summary,apiVersion:routeTests?.apiVersion,
        qualification:routeTests?.qualification,nativeTestExplorer:routeTests?.nativeTestExplorer}));
  console.log("STUDIO_ROUTE_SCENARIO_TEST_EXPLORER_CHROMIUM",JSON.stringify({
    nativeTestExplorer:routeTests.nativeTestExplorer,
    summary:routeTests.summary,qualification:routeTests.qualification
  }));
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
    throw Error("v1alpha5 Inspector did not expose the selected Source-only projection: "+
      JSON.stringify({phaseEvidence,inspectorSelection,
        inspectorText:inspectorText.slice(-2200),
        inspectorContainer:await evalJS("(()=>{const el=document.getElementById('plugin-view-container:workbench.view.extension.skillStudioInspector');return {text:el?.innerText??'',html:el?.innerHTML?.slice(-3500)??'',visible:!!el&&el.getBoundingClientRect().width>0};})()") }));
  console.log("STUDIO_V1ALPHA5_INSPECTOR_CHROMIUM",JSON.stringify(phaseEvidence));

  // One Main EditorGroup must contain every Source document. Visual projections
  // live only in the independent right-side Preview WebviewView.
  const editorGroupPlacement=await nativeCommand("skillStudio.internal.editorGroupAcceptance");
  if(!(editorGroupPlacement?.openedVisualCount>=3)||
     editorGroupPlacement?.groupCount!==1||
     editorGroupPlacement?.maxViewColumn>1||
     editorGroupPlacement?.pythonColumn!==1||
     editorGroupPlacement?.ordinaryYamlColumn!==1)
    throw Error("v1alpha5 Sources escaped the single Main Editor group: "+
      JSON.stringify(editorGroupPlacement));
  console.log("STUDIO_V1ALPHA5_EDITOR_GROUPS_CHROMIUM",JSON.stringify(editorGroupPlacement));

  // Markdown Source remains native; all rendering, links and scrolling belong
  // to the single right-side Studio Preview WebviewView.
  const skillGuideUri=defaultProcedureUri.replace(
    /\/assurance\/procedure\.yaml$/,"/SKILL.md");
  const markdownFixture=await nativeCommand(
    "skillStudio.internal.markdownPreviewAcceptance","establish-pdu-session");
  if(markdownFixture?.uri!==skillGuideUri||!(markdownFixture.lineCount>150))
    throw Error("Studio Markdown Preview fixture did not open the exact v1alpha5 Skill guide: "+
      JSON.stringify(markdownFixture));
  const markdownPreview=await waitStudioMarkdown(view=>
    view.heading==="Studio Markdown Preview Acceptance"&&
    view.bodyText.includes("INITIAL")&&view.bodyText.includes("Renderer")&&
    view.markdownBlockCount>=80,
    "v1alpha5 shared Markdown Preview");
  if(markdownPreview.view.imageCount!==0||
     markdownPreview.view.scriptMarkers!==0||
     markdownPreview.view.scriptExecuted||
     !markdownPreview.view.csp.includes("default-src 'none'")||
     markdownPreview.view.studioMarkdownStatus.includes("inventory unavailable")||
     markdownPreview.view.studioMarkdownStatus.includes("Preview unavailable"))
    throw Error("Studio Markdown Preview did not enforce its safe Package-backed projection: "+
      JSON.stringify(markdownPreview.view));
  const safeMarkdownLink=markdownPreview.view.anchorDetails.find(anchor=>
    anchor.text==="Safe package reference");
  const traversalMarkdownLink=markdownPreview.view.anchorDetails.find(anchor=>
    anchor.text==="Traversal package reference");
  const missingMarkdownLink=markdownPreview.view.anchorDetails.find(anchor=>
    anchor.text==="Missing package reference");
  if(!safeMarkdownLink||safeMarkdownLink.dataStudioHref!=="assurance/contract.yaml"||
     safeMarkdownLink.href!==null||!traversalMarkdownLink||
     traversalMarkdownLink.dataStudioHref!=="../../outside.md"||
     !missingMarkdownLink||missingMarkdownLink.dataStudioHref!=="missing.md")
    throw Error("Studio Markdown Preview did not preserve guarded Package link targets: "+
      JSON.stringify(markdownPreview.view.anchorDetails));
  const blockedTraversal=await evaluateStudioMarkdown(markdownPreview,
    "(()=>{const a=[...document.querySelectorAll('[data-studio-href]')].find(x=>x.dataset.studioHref==='../../outside.md');if(a)a.click();return true;})()");
  if(!blockedTraversal)throw Error("Could not dispatch traversal-link security probe");
  const blockedTraversalView=await waitStudioMarkdown(view=>
    view.studioMarkdownStatus.includes("Blocked unverified Package link."),
    "blocked Markdown Package traversal link");
  await evaluateStudioMarkdown(blockedTraversalView,
    "(()=>{const a=[...document.querySelectorAll('[data-studio-href]')].find(x=>x.dataset.studioHref==='missing.md');if(a)a.click();return true;})()");
  const blockedMissingView=await waitStudioMarkdown(view=>
    view.studioMarkdownStatus.includes("Blocked unverified Package link."),
    "blocked missing Markdown Package link");
  console.log("STUDIO_V1ALPHA5_MARKDOWN_SECURITY_CHROMIUM",JSON.stringify({
    uri:markdownFixture.uri,images:blockedMissingView.view.imageCount,
    scripts:blockedMissingView.view.scriptMarkers,scriptExecuted:blockedMissingView.view.scriptExecuted,
    safeLink:safeMarkdownLink,traversalLink:traversalMarkdownLink,
    missingLink:missingMarkdownLink,csp:blockedMissingView.view.csp
  }));
  await assertSourceVisualPair(evalJS,sleep,"SKILL.md","v1alpha5 Markdown Source + Preview");

  const live=await nativeCommand(
    "skillStudio.internal.markdownPreviewLiveUpdateAcceptance",markdownFixture.uri);
  if(live?.version<=markdownFixture.version)
    throw Error("Markdown live update did not advance the Source version: "+JSON.stringify(live));
  const updatedMarkdown=await waitStudioMarkdown(view=>
    view.heading==="Studio Markdown Preview Acceptance"&&
    view.bodyText.includes("UPDATED")&&!view.bodyText.includes("INITIAL"),
    "v1alpha5 Markdown unsaved Source update");
  const previewScrollStart=await evaluateStudioMarkdown(blockedMissingView,
    "(()=>new Promise(resolve=>{window.scrollTo(0,document.body.scrollHeight*0.72);"+
      "setTimeout(()=>resolve({height:document.body.scrollHeight,scrollY:window.scrollY,"+
      "lastScroll:(()=>{try{return JSON.parse(document.documentElement.dataset.studioLastPreviewScroll??'null')}catch{return null}})(),"+
      "lastAck:(()=>{try{return JSON.parse(document.documentElement.dataset.studioLastPreviewScrollAck??'null')}catch{return null}})()}),180);}))()");
  if(!(previewScrollStart?.height>1000)||!(previewScrollStart?.scrollY>0))
    throw Error("Markdown Preview fixture did not scroll to a non-zero position: "+
      JSON.stringify(previewScrollStart));
  let sourceAfterPreviewScroll=null;
  for(let attempt=0;attempt<50;attempt++){
    sourceAfterPreviewScroll=await nativeCommand(
      "skillStudio.internal.markdownPreviewSourceStateAcceptance",markdownFixture.uri);
    if((sourceAfterPreviewScroll?.visibleRanges?.[0]?.start??1)>35)break;
    await sleep(80);
  }
  if((sourceAfterPreviewScroll?.visibleRanges?.[0]?.start??1)<=35){
    const scrollDiagnostics=await evaluateStudioMarkdown(blockedMissingView,
      "({lastScroll:(()=>{try{return JSON.parse(document.documentElement.dataset.studioLastPreviewScroll??'null')}catch{return null}})(),"+
      "lastAck:(()=>{try{return JSON.parse(document.documentElement.dataset.studioLastPreviewScrollAck??'null')}catch{return null}})(),scrollY:window.scrollY})");
    throw Error("Markdown Preview scrolling did not reveal the matching Source lines: "+
      JSON.stringify({sourceAfterPreviewScroll,previewScrollStart,scrollDiagnostics}));
  }
  await evaluateStudioMarkdown(blockedMissingView,"(()=>{window.scrollTo(0,0);return true;})()");
  await waitStudioMarkdown(view=>view.scrollY===0,"reset Markdown Preview scroll before reverse sync");
  const sourceReveal=await nativeCommand(
    "skillStudio.internal.markdownPreviewRevealSourceAcceptance",markdownFixture.uri,120);
  if(sourceReveal?.line!==120)throw Error("Could not reveal Markdown Source line 120");
  const sourceToPreview=await waitStudioMarkdown(view=>view.scrollY>0,
    "Markdown Source-to-Preview scroll synchronization");
  if(!(sourceToPreview.view.scrollY>0))
    throw Error("Markdown Source scrolling did not move the right Preview");
  const markdownEvidence={
    uri:markdownFixture.uri,initialVersion:markdownFixture.version,
    updatedVersion:live.version,blocks:updatedMarkdown.view.markdownBlockCount,
    previewScrollHeight:previewScrollStart.height,previewScrollY:previewScrollStart.scrollY,
    sourceAfterPreviewScroll,sourceReveal,previewScrollAfterSource:sourceToPreview.view.scrollY,
    security:{images:blockedMissingView.view.imageCount,
      scripts:blockedMissingView.view.scriptMarkers,
      scriptExecuted:blockedMissingView.view.scriptExecuted,
      safeLink:safeMarkdownLink,traversalLink:traversalMarkdownLink,
      missingLink:missingMarkdownLink}
  };
  console.log("STUDIO_V1ALPHA5_MARKDOWN_PREVIEW_CHROMIUM",JSON.stringify(markdownEvidence));
  await nativeCommand("skillStudio.internal.restoreMarkdownPreviewAcceptance",markdownFixture.uri);
  const restoredMarkdown=await waitStudioMarkdown(view=>
    view.heading?.includes("Establish PDU Session"),
    "restored v1alpha5 Skill Markdown Preview");
  if(!restoredMarkdown.view.bodyText.includes("establish-pdu-session"))
    throw Error("Restored Markdown Preview does not show the original Skill guide");

  const mappingUri=defaultProcedureUri.replace(
    "/skills/establish-pdu-session/assurance/procedure.yaml",
    "/skills/establish-pdu-session-mas/references/openamsm-operation-mapping.md");
  const secondMarkdownUri=await nativeCommand(
    "skillStudio.internal.markdownPreviewOpenAcceptance",
    "establish-pdu-session-mas","references/openamsm-operation-mapping.md");
  if(secondMarkdownUri!==mappingUri)
    throw Error("Studio Markdown Preview did not open the exact MAS Package reference: "+
      JSON.stringify(secondMarkdownUri));
  const secondMarkdown=await waitStudioMarkdown(view=>
    view.heading?.includes("OpenAMSM source mapping"),
    "v1alpha5 MAS reference Markdown Preview");
  await assertSourceVisualPair(evalJS,sleep,"openamsm-operation-mapping.md",
    "v1alpha5 MAS Markdown Source + Preview");
  console.log("STUDIO_V1ALPHA5_MARKDOWN_SHARED_HOST_CHROMIUM",JSON.stringify({
    firstUri:markdownFixture.uri,secondUri:secondMarkdownUri,
    secondHeading:secondMarkdown.view.heading,
    visibleEditorGroups:secondMarkdown.visibleEditorGroups??1
  }));

  // The native Contract, Predicate and Schema Designers render the v1alpha5
  // source files from the same Skill Package and retain native Source pairing.
  const contractUri=await openPackageFile("skillStudio.openContract","assurance/contract.yaml");
  const contract=await waitWebview(view=>view.title==="SKILL Contract Visual"&&
    view.bodyText.includes("Package\nestablish-pdu-session\n")&&
    view.bodyText.includes("get-sm-subscription-data"),
    "v1alpha5 5GC Contract Designer");
  const expectedContractCards=["Goal & Preconditions","Schemas & Context",
    "Capabilities","Dependencies","Limits"];
  const contractCards=contract.view.cards??[];
  if(!contract.view.bodyText.includes("Package\nestablish-pdu-session\n")||
     !contract.view.bodyText.includes("pdu_session.initial_request_fulfilled")||
     !contract.view.bodyText.includes("get-sm-subscription-data")||
     expectedContractCards.some(title=>!contract.view.cards.includes(title)))
    throw Error("v1alpha5 Contract Designer did not render the current Contract Source: "+
      JSON.stringify(contract.view).slice(0,2600));
  await assertSourceVisualPair(evalJS,sleep,"contract.yaml","v1alpha5 Contract Designer");
  const predicateUri=await openPackageFile("skillStudio.openPredicates","assurance/predicates.yaml");
  const predicates=await waitWebview(view=>view.title==="SKILL Predicate Visual"&&
    view.bodyText.includes("establishment.ran.adopted"),
    "v1alpha5 5GC Predicate Designer");
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
    throw Error("v1alpha5 Predicate Designer did not render the current PredicateSet: "+
      JSON.stringify({view:predicates.view,predicateText:predicateText.slice(-2600)}));
  await assertSourceVisualPair(evalJS,sleep,"predicates.yaml","v1alpha5 Predicate Designer");
  const schemaUri=await openPackageFile(
    "skillStudio.openSchema","schemas/establishment-request.schema.yaml");
  const schema=await waitWebview(view=>view.title==="SKILL Schema Visual"&&
    view.bodyText.includes("Schema ID urn:connectionagent:example:5gc:establishment-request:v1alpha5")&&
    view.bodyText.includes("establishment-request"),
    "v1alpha5 5GC Schema Designer");
  if(!schema.view.bodyText.includes("sNssai")||
     !schema.view.bodyText.includes("requestedPduSessionType")||
     !schema.view.bodyText.includes("const: IPV4")||
     !schema.view.bodyText.includes("Draft 2020-12"))
    throw Error("v1alpha5 Schema Designer did not render the real request Schema: "+
      JSON.stringify(schema.view).slice(0,2600));
  await assertSourceVisualPair(evalJS,sleep,"establishment-request.schema.yaml",
    "v1alpha5 Schema Designer");
  console.log("STUDIO_V1ALPHA5_DESIGNERS_CHROMIUM",JSON.stringify({
    contract:{uri:contractUri,cards:contractCards},
    predicates:{uri:predicateUri,heading:predicates.view.title},
    schema:{uri:schemaUri,heading:schema.view.title}
  }));

  // Verify the second v1alpha5 Skill opens through its exact URI, then restore
  // the primary 5GC Procedure as the final active editor.
  const masProcedureUri=defaultProcedureUri.replace(
    "/establish-pdu-session/assurance/procedure.yaml",
    "/establish-pdu-session-mas/assurance/procedure.yaml");
  // Keep unrelated editors open; closing every tab can block Theia's Webview command bridge.
  await nativeCommand("skillStudio.openProcedure",masProcedureUri);
  const masPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","v1alpha5 MAS Procedure Designer");
  const masGraph=await waitWebview(view=>
    view.procedureRoot&&view.bodyText.includes("establish-pdu-session-mas")&&view.graphNodes>0,
    "v1alpha5 MAS Procedure graph");
  // Keep unrelated editors open; closing every tab can block Theia's Webview command bridge.
  await nativeCommand("skillStudio.openProcedure",defaultProcedureUri);
  const restoredPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","restored v1alpha5 5GC Procedure Designer");
  const finalGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "restored default v1alpha5 5GC Procedure graph");

  const packageOverviewEvidence=await runPackageOverviewAcceptance({
    command,evalJS,sleep,requireEditor
  });
  if(!packageOverviewEvidence?.twoSkills||
     packageOverviewEvidence.evidence?.skills?.length!==2)
    throw Error("Package Overview did not discover both v1alpha5 Skills: "+
      JSON.stringify(packageOverviewEvidence));
  // Keep unrelated editors open; closing every tab can block Theia's Webview command bridge.
  await nativeCommand("skillStudio.openProcedure",defaultProcedureUri);
  const finalPair=await assertSourceVisualPair(
    evalJS,sleep,"procedure.yaml","final v1alpha5 default Procedure Designer");
  const finalRestoredGraph=await waitWebview(view=>
    view.procedureRoot&&view.procedureValue==="establish-pdu-session"&&view.graphNodes>0,
    "final default v1alpha5 Procedure graph");

  // This is the actual released Go/WASM Worker, not a JS contract mock.
  // An unqualified Example must yield source-backed Compiler diagnostics, and
  // Build must remain failure-atomic without trusted Owner/Deployment inputs.
  if(requireCompilerWorker){
    const smoke=await nativeCommand("skillStudio.internal.compilerWorkerAcceptance");
    if(smoke?.compilerVersion!=="v2.0.0"||
       smoke?.languageTarget!=="connectionagent.io/v1alpha5"||
       smoke?.workerTransport!=="PASS"||
       smoke?.artifactFailureAtomicity!=="PASS")
      throw Error("Released Compiler v2 Worker smoke failed: "+JSON.stringify(smoke));
    const check=await nativeCommand("skillStudio.checkSkill",defaultProcedureUri);
    if(!Array.isArray(check?.diagnostics)||!check.errors||
       !check.diagnostics.every(item=>item.phase==="C_STATIC"||
         item.phase==="C_WARNING"))
      throw Error("Real Compiler v2 Check failed to report trusted-link gaps: "+
        JSON.stringify({errors:check?.errors,warnings:check?.warnings,
          codes:check?.diagnostics?.map(x=>x.code).slice(0,20)}));
    const build=await nativeCommand("skillStudio.buildSkill",defaultProcedureUri);
    if(build?.success!==false||build.outputFiles?.length!==0)
      throw Error("Unqualified Example emitted an unexpected Compiler v2 Artifact: "+
        JSON.stringify({success:build?.success,outputs:build?.outputFiles?.length}));
    console.log("STUDIO_COMPILER_V2_REAL_WORKER_CHROMIUM",JSON.stringify({
      ...smoke,checkErrors:check.errors,checkWarnings:check.warnings,
      checkCodes:[...new Set(check.diagnostics.map(item=>item.code))].slice(0,16),
      buildSuccess:build.success,buildOutputFiles:build.outputFiles.length
    }));
  }
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
  console.log("STUDIO_V1ALPHA5_DUAL_SKILL_EXPLORER_CHROMIUM",
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
    v1alpha5LanguageFeatures,semanticTokenEvidence,
    markdownEvidence,designerEvidence:{
      contract:contract.view,predicates:predicates.view,schema:schema.view
    }
  };
}
