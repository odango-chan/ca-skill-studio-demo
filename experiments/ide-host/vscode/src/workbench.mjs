import {openNativeSource} from "./native-source.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {auditPackageWorkspace} from '../../../../site/package-audit.mjs';
import {renderMarkdown} from '../../../../site/markdown-preview.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';

export function registerWorkbench(vscode,context){
  let document=null,selection={},snapshot=null,audit=[],generation=0,timer;
  const providers=new Map(),sessions=new Map();
  const diagnostics=vscode.languages.createDiagnosticCollection('skill-studio');
  context.subscriptions.push(diagnostics);
  for(const id of ['inspection','outline','evidence','problems']){
    const emitter=new vscode.EventEmitter();
    const provider={onDidChangeTreeData:emitter.event,
      getChildren:item=>item?.children??(id==='problems'
        ? [...(snapshot?.problems??[]),...audit].map(d=>({label:d.message,line:d.line,uri:d.uri,description:d.code??'Source projection',children:[]}))
        :snapshot?.[id]??[{label:'Open assurance/procedure.yaml',children:[]}]),
      getTreeItem(item){
        const tree=new vscode.TreeItem(item.label,item.children?.length?vscode.TreeItemCollapsibleState.Collapsed:vscode.TreeItemCollapsibleState.None);
        tree.description=item.description;tree.tooltip=item.label+(item.line?' · L'+item.line:'');
        if(document&&item.line)tree.command={command:'skillStudio.revealInspection',title:'Reveal Source',arguments:[{...item,uri:item.uri??document.uri,version:document.version}]};
        return tree;
      }};
    providers.set(id,emitter);
    context.subscriptions.push(emitter,vscode.window.registerTreeDataProvider('skillStudio.'+id,provider));
  }
  const fire=()=>{for(const p of providers.values())p.fire();};
  function update(doc,choice=selection){
    if(!isProcedurePath(doc?.uri.path))return;
    const same=document?.uri.toString()===doc.uri.toString();
    const text=doc.getText(),projected=same&&snapshot?.text===text?snapshot.model:null;
    if(!same){generation++;selection={};audit=[];diagnostics.clear();}
    document=doc;selection=same?choice:{};
    snapshot={...inspectionSnapshot(text,selection,projected),text};fire();
  }
  async function auditCurrent(){
    if(!document)return;
    const doc=document,version=doc.version,ticket=++generation;
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
      audit=results.map(d=>({...d,uri:uris.get(d.path)??doc.uri}));diagnostics.clear();
      for(const uri of new Set(audit.map(d=>d.uri))){
        diagnostics.set(uri,audit.filter(d=>d.uri===uri).map(d=>{
          const line=Math.max(0,d.line-1),diagnostic=new vscode.Diagnostic(new vscode.Range(line,0,line,1),d.message,vscode.DiagnosticSeverity.Warning);
          diagnostic.source='Skill Studio · editor audit';diagnostic.code=d.code;return diagnostic;
        }));
      }
      fire();
    }catch(error){if(ticket!==generation)return;audit=[{message:'Audit unavailable: '+error.message,line:1,uri:doc.uri}];diagnostics.clear();fire();}
  }
  function scheduleAudit(){generation++;clearTimeout(timer);audit=[];diagnostics.clear();timer=setTimeout(()=>void auditCurrent(),350);}
  context.subscriptions.push({dispose(){clearTimeout(timer);generation++;sessions.clear();}},
    vscode.commands.registerCommand('skillStudio.revealInspection',async item=>{
      if(!document||item.version!==document.version)return;
      if(item.nodeId){selection={procedureId:item.procedureId,nodeId:item.nodeId};update(document);sessions.get(document.uri.toString())?.({type:'focusNode',...selection,version:document.version});}
      const doc=await vscode.workspace.openTextDocument(item.uri);
      const line=Math.min(Math.max(0,item.line-1),doc.lineCount-1);
      await openNativeSource(vscode,doc.uri,{preview:true,selection:new vscode.Range(line,0,line,0)});
    }),
    vscode.commands.registerCommand('skillStudio.auditPackage',auditCurrent),
    vscode.commands.registerCommand('skillStudio.refreshInspection',()=>{if(document){update(document);scheduleAudit();}}),
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
  },activate(doc){update(doc);scheduleAudit();}};
}
