import {openNativeSource} from "./native-source.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {auditPackageWorkspace} from '../../../../site/package-audit.mjs';
import {renderMarkdown} from '../../../../site/markdown-preview.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';
import {previewNodeRename,applyNodeRename} from '../../../../site/node-designer.mjs';
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue} from '../../../../site/node-attributes.mjs';

export function registerWorkbench(vscode,context){
  let document=null,selection={},snapshot=null,audit=[],auditStatus="Package Audit · not run",generation=0,timer;
  const providers=new Map(),sessions=new Map(),selections=new Map();
  const diagnostics=vscode.languages.createDiagnosticCollection('skill-studio');

  function currentNode(item){
    if(!document||!isProcedurePath(document.uri.path))throw Error("No active Procedure Source");
    const doc=document,source=doc.getText(),version=doc.version;
    const procedureId=item?.procedureId??selection.procedureId;
    const nodeId=item?.nodeId??selection.nodeId;
    if(item?.documentUri&&item.documentUri!==doc.uri.toString())
      throw Error("Inspector selection belongs to another Source document");
    if(Number.isSafeInteger(item?.sourceVersion)&&item.sourceVersion!==version)
      throw Error("Inspector selection is stale; select the Node again");
    if(typeof procedureId!=="string"||typeof nodeId!=="string")
      throw Error("Select a Node in the graph or Inspector first");
    const projected=inspectionSnapshot(source,{procedureId,nodeId});
    const procedure=projected.model.procedures.get(procedureId);
    if(projected.model.state!=="READY"||!procedure?.nodes.some(n=>n.id===nodeId))
      throw Error("Selected Node is not present in the current Source");
    return {doc,source,version,procedureId,nodeId};
  }
  async function predicateContext(doc){
    const suffix="assurance/procedure.yaml";
    if(!doc.uri.path.endsWith(suffix))return {predicateSource:null,skillName:null};
    const base=doc.uri.path.slice(0,-suffix.length);
    const skillName=base.replace(/\/$/,"").split("/").at(-1)||null;
    const uri=doc.uri.with({path:base+"assurance/predicates.yaml"});
    const opened=vscode.workspace.textDocuments?.find(x=>x.uri.toString()===uri.toString());
    try{
      const predicateSource=opened?opened.getText():
        new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      return {predicateSource,skillName};
    }catch{return {predicateSource:null,skillName};}
  }
  async function confirmAndApply({doc,source,version,preview,changes,verify}){
    const message=[preview.summary,preview.diff].filter(Boolean).join("\\n\\n");
    const choice=await vscode.window.showInformationMessage(
      message||"确认修改当前 Source",
      {modal:true},
      "确认并应用"
    );
    if(choice!=="确认并应用")return false;
    if(document!==doc||doc.version!==version||doc.getText()!==source)
      throw Error("Source changed after Preview; the edit was discarded");
    const candidate=await verify(doc.getText());
    if(candidate!==preview.candidateSource)
      throw Error("Revalidated Patch does not match the reviewed Preview");
    if(document!==doc||doc.version!==version||doc.getText()!==source)
      throw Error("Source changed during Patch revalidation");
    const edit=new vscode.WorkspaceEdit();
    const spans=changes(preview);
    if(!spans.length)throw Error("Patch has no qualified Source spans");
    for(const span of spans){
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<=span.start||span.end>source.length||
         source.slice(span.start,span.end)!==span.oldValue)
        throw Error("Patch Source span no longer matches the current document");
      edit.replace(doc.uri,new vscode.Range(
        doc.positionAt(span.start),doc.positionAt(span.end)),span.newValue);
    }
    const applied=await vscode.workspace.applyEdit(edit);
    if(!applied)throw Error("Host rejected WorkspaceEdit");
    return true;
  }
  async function renameNode(item,newId){
    const ctx=currentNode(item);
    let value=newId;
    if(typeof value!=="string")value=await vscode.window.showInputBox({
      value:ctx.nodeId,prompt:"输入新的 Node ID",placeHolder:"new-node-id"
    });
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Node ID");
    const preview=previewNodeRename(ctx.source,ctx.procedureId,ctx.nodeId,value);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:text=>applyNodeRename(text,preview)
    });
    if(applied){
      selection={procedureId:ctx.procedureId,nodeId:value};
      selections.set(ctx.doc.uri.toString(),selection);
      update(ctx.doc,selection);
    }
    return applied;
  }
  async function editNodeOperatorValue(item,newValue){
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const state=nodeAttributeState(ctx.source,ctx.procedureId,ctx.nodeId,
      predicates.predicateSource,predicates.skillName);
    if(!state?.operator)
      throw Error("This Operator is Source-only or has no qualified Package choices");
    let value=newValue;
    if(typeof value!=="string"){
      value=state.operator.type==="select"
        ?await vscode.window.showQuickPick(state.operator.values,{
          placeHolder:"选择 "+state.operator.operator+" Operator 值"
        })
        :await vscode.window.showInputBox({
          value:state.operator.value,prompt:"输入新的 "+state.operator.operator+" Operator 值"
        });
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Operator value");
    const preview=previewNodeOperatorValue(ctx.source,ctx.procedureId,ctx.nodeId,
      value,predicates.predicateSource,predicates.skillName);
    return confirmAndApply({
      ...ctx,preview,
      changes:p=>[{
        start:p.sourceSpan.start,end:p.sourceSpan.end,
        oldValue:p.oldValue,newValue:p.newValue
      }],
      verify:async text=>{
        const current=await predicateContext(ctx.doc);
        return applyNodeOperatorValue(text,preview,
          current.predicateSource,current.skillName);
      }
    });
  }

  context.subscriptions.push(diagnostics);
  for(const id of ['inspection','outline','evidence','problems']){
    const emitter=new vscode.EventEmitter();
    const provider={onDidChangeTreeData:emitter.event,
      getChildren:item=>item?.children??(id==='problems'
        ? [{label:auditStatus,children:[]},...([...(snapshot?.problems??[]),...audit].map(d=>({label:d.message,line:d.line,uri:d.uri,description:d.code??'Source projection',children:[]})))]
        :snapshot?.[id]??[{label:'Open assurance/procedure.yaml',children:[]}]),
      getTreeItem(item){
        const tree=new vscode.TreeItem(item.label,item.children?.length?vscode.TreeItemCollapsibleState.Collapsed:vscode.TreeItemCollapsibleState.None);
        tree.description=item.description;tree.tooltip=item.label+(item.line?' · L'+item.line:'');
        if(item.kind==='node'){
          tree.contextValue='skillStudio.node';
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.sourceVersion=document?.version;tree.documentUri=document?.uri.toString();
        }
        if(document&&item.line)tree.command={command:'skillStudio.revealInspection',title:'Reveal Source',arguments:[{...item,uri:item.uri??document.uri,version:document.version,sourceVersion:document.version,documentUri:document.uri.toString(),...(item.uri?{auditGeneration:generation}:{})}]};
        return tree;
      }};
    providers.set(id,emitter);
    context.subscriptions.push(emitter,vscode.window.registerTreeDataProvider('skillStudio.'+id,provider));
  }
  const fire=()=>{for(const p of providers.values())p.fire();};
  function update(doc,choice){
    if(!isProcedurePath(doc?.uri.path))return;
    const key=doc.uri.toString(),same=document?.uri.toString()===key;
    const text=doc.getText(),projected=same&&snapshot?.text===text?snapshot.model:null;
    const next=choice??(same?selection:selections.get(key)??{});
    const changed=!same||snapshot?.text!==text||next.procedureId!==selection.procedureId||next.nodeId!==selection.nodeId;
    if(!same){generation++;audit=[];diagnostics.clear();}
    document=doc;selection=next;selections.set(key,next);
    if(changed){snapshot={...inspectionSnapshot(text,selection,projected),text};fire();}
  }
  async function auditCurrent(){
    if(!document)return;
    const doc=document,version=doc.version,ticket=++generation;
    auditStatus="Package Audit · running";fire();
    const files=new Map(),uris=new Map();
    try{
      const base=doc.uri.with({path:doc.uri.path.slice(0,-'assurance/procedure.yaml'.length)});
      // Bounded by file count and aggregate bytes; never crawl another Package.
      const found=await vscode.workspace.findFiles(new vscode.RelativePattern(base,'**/*'),'**/node_modules/**',501);
      if(found.length>500)throw Error('Package exceeds 500-file audit limit');
      let bytes=0;
      for(const uri of found){
        if(!uri.path.startsWith(base.path))continue;
        const path=uri.path.slice(base.path.length);uris.set(path,uri);
        if(!/\.(yaml|json|py|md)$/.test(path)){files.set(path,{text:''});continue;}
        const open=vscode.workspace.textDocuments.find(d=>d.uri.toString()===uri.toString());
        const text=open?open.getText():new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        bytes+=text.length;if(bytes>4*MAX_SOURCE_BYTES)throw Error('Package exceeds 4 MiB audit limit');
        files.set(path,{text});
      }
      const required=['assurance/procedure.yaml','assurance/contract.yaml','assurance/predicates.yaml'];
      const missing=required.filter(p=>!files.has(p));
      const results=missing.length?missing.map(path=>({message:'Audit unavailable: missing '+path,path:'assurance/procedure.yaml',line:1,code:'AUDIT_INCOMPLETE'})):
        auditPackageWorkspace({name:base.path.replace(/\/$/,'').split('/').at(-1),files},doc.getText());
      if(ticket!==generation||document!==doc||doc.version!==version)return;
      audit=results.map(d=>({...d,uri:uris.get(d.path)??doc.uri}));
      auditStatus="Package Audit · "+(missing.length?"unavailable":audit.length+" editor warnings");diagnostics.clear();
      for(const uri of new Set(audit.map(d=>d.uri))){
        diagnostics.set(uri,audit.filter(d=>d.uri===uri).map(d=>{
          const line=Math.max(0,d.line-1),diagnostic=new vscode.Diagnostic(new vscode.Range(line,0,line,1),d.message,vscode.DiagnosticSeverity.Warning);
          diagnostic.source='Skill Studio · editor audit';diagnostic.code=d.code;return diagnostic;
        }));
      }
      fire();
    }catch(error){if(ticket!==generation)return;auditStatus='Package Audit · unavailable';audit=[{message:'Audit unavailable: '+error.message,line:1,uri:doc.uri}];diagnostics.clear();fire();}
  }
  function scheduleAudit(){generation++;clearTimeout(timer);auditStatus="Package Audit · pending";audit=[];diagnostics.clear();timer=setTimeout(()=>void auditCurrent(),350);fire();}
  context.subscriptions.push({dispose(){clearTimeout(timer);generation++;sessions.clear();selections.clear();}},
    vscode.commands.registerCommand('skillStudio.revealInspection',async item=>{
      if(!document||item.version!==document.version||
         (item.auditGeneration!==undefined&&item.auditGeneration!==generation))return;
      if(item.nodeId){selection={procedureId:item.procedureId,nodeId:item.nodeId};update(document);sessions.get(document.uri.toString())?.({type:'focusNode',...selection,version:document.version});}
      const doc=await vscode.workspace.openTextDocument(item.uri);
      const line=Math.min(Math.max(0,item.line-1),doc.lineCount-1);
      await openNativeSource(vscode,doc.uri,{preview:true,selection:new vscode.Range(line,0,line,0)});
    }),
    vscode.commands.registerCommand('skillStudio.auditPackage',auditCurrent),
    vscode.commands.registerCommand('skillStudio.refreshInspection',()=>{if(document){update(document);scheduleAudit();}}),
    vscode.commands.registerCommand('skillStudio.renameNode',async(item,newId)=>{
      try{return await renameNode(item,newId);}
      catch(error){await vscode.window.showWarningMessage('Node 重命名未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editNodeOperatorValue',async(item,newValue)=>{
      try{return await editNodeOperatorValue(item,newValue);}
      catch(error){await vscode.window.showWarningMessage('Operator 修改未执行：'+error.message);return false;}
    }),
    vscode.workspace.onDidChangeTextDocument(e=>{
      if(isProcedurePath(e.document.uri.path)&&document?.uri.toString()===e.document.uri.toString())update(e.document);
      if(document)scheduleAudit();
    }),
    vscode.window.onDidChangeActiveTextEditor(editor=>{if(isProcedurePath(editor?.document.uri.path)){update(editor.document);scheduleAudit();}}));
  context.subscriptions.push(vscode.commands.registerCommand('skillStudio.previewMarkdown',async uri=>{
    uri=uri??vscode.window.activeTextEditor?.document.uri;
    if(!uri||!uri.path.toLowerCase().endsWith('.md'))return;
    const doc=await vscode.workspace.openTextDocument(uri);
    const panel=vscode.window.createWebviewPanel('skillStudio.markdown','Preview · '+uri.path.split('/').at(-1),vscode.ViewColumn.Beside,{enableScripts:false});
    const render=()=>{const preview=renderMarkdown(doc.getText());panel.webview.html='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;none&#39;;"></head><body><article>'+(preview.available?preview.html:'<p>预览不可用，请使用源码编辑器。</p>')+'</article></body></html>';};
    render();const changed=vscode.workspace.onDidChangeTextDocument(e=>{if(e.document.uri.toString()===uri.toString())render();});panel.onDidDispose(()=>changed.dispose());
  }));
  return {attach(doc,post){sessions.set(doc.uri.toString(),post);update(doc);scheduleAudit();return ()=>{sessions.delete(doc.uri.toString());};},select(doc,message){
    if(message.version!==doc.version||typeof message.procedureId!=='string')return;
    update(doc,{procedureId:message.procedureId,nodeId:typeof message.nodeId==='string'?message.nodeId:null});
  },activate(doc){const changed=document?.uri.toString()!==doc.uri.toString()||snapshot?.text!==doc.getText();update(doc);if(changed)scheduleAudit();}};
}
