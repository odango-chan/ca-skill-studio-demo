import {openNativeSource} from "./native-source.mjs";
import {inspectionSnapshot} from './inspection.mjs';
import {auditPackageWorkspace} from '../../../../site/package-audit.mjs';
import {renderMarkdown} from '../../../../site/markdown-preview.mjs';
import {isProcedurePath,MAX_SOURCE_BYTES} from './bridge.mjs';
import {previewNodeRename,applyNodeRename} from '../../../../site/node-designer.mjs';
import {nodeAttributeState,previewNodeOperatorValue,applyNodeOperatorValue} from '../../../../site/node-attributes.mjs';
import {insertNodeOptions,previewNodeInsert,applyNodeInsert} from '../../../../site/node-create.mjs';
import {deleteNodeOptions,previewNodeDelete,applyNodeDelete} from '../../../../site/node-delete.mjs';
import {phaseStepBindingOptions,previewPhaseInputBinding,applyPhaseInputBinding} from '../../../../site/phase-bindings.mjs';
import {phaseVerifyAddOptions,phaseVerifyDeleteOptions,
  previewAddPhaseVerify,applyAddPhaseVerify,
  previewDeletePhaseVerify,applyDeletePhaseVerify}
  from '../../../../site/phase-step-structural.mjs';
import {adjacentVerifyReorderOptions,previewAdjacentVerifyReorder,
  applyAdjacentVerifyReorder} from '../../../../site/phase-step-order.mjs';
import {openNativeSource} from "./native-source.mjs";
import {collectPackageSnapshot,packageRootForProcedure} from "./package-snapshot.mjs";

export function registerWorkbench(vscode,context){
  let document=null,selection={},snapshot=null,bindingOptions=[],predicateSnapshot=null,
    predicateGeneration=0,audit=[],auditStatus="Package Audit · not run",generation=0,timer;
  const providers=new Map(),sessions=new Map(),selections=new Map();
  const diagnostics=vscode.languages.createDiagnosticCollection('skill-studio');
  const languagePackages=new Map();
  let languageClient=null,languageClientPromise=null,languageClientFailureShown=false,
    languageStatusItem=null;
  function updateLanguageStatus(state,detail){
    if(typeof Worker!=="function"||typeof globalThis.location==="undefined")return;
    if(!languageStatusItem){
      languageStatusItem=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,20);
      languageStatusItem.name="SKILL Studio Language Service";
      context.subscriptions.push(languageStatusItem);
    }
    languageStatusItem.text="SKILL LSP: "+state;
    languageStatusItem.tooltip=detail||"Skill Studio browser Language Service";
    languageStatusItem.show();
  }

  function languagePackageContains(root,uri){
    if(!uri||uri.scheme!==root.scheme||uri.authority!==root.authority)return false;
    const base=root.path.replace(/\/$/,"");
    return uri.path.startsWith(base+"/");
  }
  async function ensureLanguageClient(){
    if(typeof Worker!=="function"||typeof globalThis.location==="undefined")return null;
    if(!languageClientPromise){
      languageClientPromise=(async()=>{
        let candidate=null;
        try{
          const {createSkillLanguageClient}=await import("../../lsp-browser/client/src/browserClient.mjs");
          candidate=createSkillLanguageClient(vscode,context,{
            onStatus:status=>updateLanguageStatus(
              status.state,
              status.reason||("Package "+status.rootUri+" · generation "+status.generation+
                " · "+(status.publishedDiagnosticCount??0)+" diagnostics")
            ),
            onError:error=>{
              console.warn("Skill Studio Language Service",error);
              updateLanguageStatus("ERROR",String(error?.message??error));
            }
          });
          updateLanguageStatus("STARTING","Starting browser language Worker");
          await candidate.start();
          languageClient=candidate;
          updateLanguageStatus("STARTED","Browser language Worker initialized");
          return candidate;
        }catch(error){
          if(candidate)await candidate.stop().catch(()=>{});
          languageClient=null;
          languageClientPromise=null;
          throw error;
        }
      })();
    }
    return languageClientPromise;
  }
  async function refreshLanguagePackage(state,ticket,generation){
    if(state.disposed||ticket!==state.ticket)return;
    try{
      const snapshot=await collectPackageSnapshot(
        vscode,state.procedureDocument,generation
      );
      if(state.disposed||ticket!==state.ticket)return;
      const client=await ensureLanguageClient();
      if(!client||state.disposed||ticket!==state.ticket)return;
      updateLanguageStatus("ANALYZING","Analyzing "+snapshot.packageName+
        " · generation "+snapshot.generation);
      client.sendPackageSnapshot(snapshot);
    }catch(error){
      if(state.disposed||ticket!==state.ticket)return;
      console.warn("Skill Studio Package analysis unavailable",error);
      updateLanguageStatus("ERROR",String(error?.message??error));
      if(!languageClientFailureShown){
        languageClientFailureShown=true;
        void vscode.window.showWarningMessage(
          "SKILL Studio 语言服务未能启动；现有编辑器仍可继续使用。详情见 Language Service Output。"
        );
      }
    }
  }
  function scheduleLanguagePackageRefresh(state,immediate=false){
    if(state.disposed)return;
    const ticket=++state.ticket;
    const generation=++state.generation;
    clearTimeout(state.timer);
    updateLanguageStatus("ANALYZING","Package "+state.key+
      " changed · generation "+generation);
    const invalidate=client=>{
      if(!state.disposed&&ticket===state.ticket)
        client?.invalidatePackage(state.key,generation);
    };
    if(languageClient)invalidate(languageClient);
    else if(languageClientPromise)
      void languageClientPromise.then(invalidate).catch(()=>{});
    if(immediate){
      void refreshLanguagePackage(state,ticket,generation);
      return;
    }
    state.timer=setTimeout(()=>{
      state.timer=null;
      void refreshLanguagePackage(state,ticket,generation);
    },120);
  }
  function attachLanguagePackage(doc){
    const rootInfo=packageRootForProcedure(vscode,doc);
    if(!rootInfo||typeof Worker!=="function"||typeof globalThis.location==="undefined")
      return ()=>{};
    const root=rootInfo.uri;
    const key=root.toString();
    let state=languagePackages.get(key);
    if(state){
      state.refs++;
      state.procedureDocument=doc;
      scheduleLanguagePackageRefresh(state);
    }else{
      state={
        root,key,procedureDocument:doc,refs:1,generation:0,ticket:0,
        timer:null,disposed:false,subscriptions:[]
      };
      languagePackages.set(key,state);
      const listen=(event,handler)=>{
        if(typeof event==="function"){
          const disposable=event(handler);
          if(disposable?.dispose)state.subscriptions.push(disposable);
        }
      };
      const refreshIfInside=uri=>{
        if(languagePackageContains(root,uri))scheduleLanguagePackageRefresh(state);
      };
      listen(vscode.workspace.onDidChangeTextDocument,event=>{
        if(languagePackageContains(root,event.document.uri)){
          if(event.document.uri.toString()===doc.uri.toString())
            state.procedureDocument=event.document;
          scheduleLanguagePackageRefresh(state);
        }
      });
      listen(vscode.workspace.onDidOpenTextDocument,document=>{
        refreshIfInside(document.uri);
        if(document.uri.toString()===state.procedureDocument.uri.toString())
          state.procedureDocument=document;
      });
      listen(vscode.workspace.onDidCloseTextDocument,document=>{
        refreshIfInside(document.uri);
      });
      listen(vscode.workspace.onDidCreateFiles,event=>{
        if(event.files?.some(uri=>languagePackageContains(root,uri)))
          scheduleLanguagePackageRefresh(state);
      });
      listen(vscode.workspace.onDidDeleteFiles,event=>{
        if(event.files?.some(uri=>languagePackageContains(root,uri)))
          scheduleLanguagePackageRefresh(state);
      });
      listen(vscode.workspace.onDidRenameFiles,event=>{
        if(event.files?.some(item=>
          languagePackageContains(root,item.oldUri)||
          languagePackageContains(root,item.newUri)))
          scheduleLanguagePackageRefresh(state);
      });
      scheduleLanguagePackageRefresh(state,true);
    }
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      state.refs--;
      if(state.refs>0)return;
      state.disposed=true;
      state.ticket++;
      clearTimeout(state.timer);
      for(const subscription of state.subscriptions)subscription.dispose();
      state.subscriptions.length=0;
      languagePackages.delete(key);
      if(languagePackages.size===0)updateLanguageStatus("IDLE","No open Procedure Package");
      const close=client=>client?.closePackage(key);
      if(languageClientPromise)void languageClientPromise.then(close).catch(()=>{});
      else close(languageClient);
    };
  }
  context.subscriptions.push({dispose(){
    for(const state of languagePackages.values()){
      state.disposed=true;state.ticket++;clearTimeout(state.timer);
      for(const subscription of state.subscriptions)subscription.dispose();
    }
    languagePackages.clear();
    const stop=client=>client?.stop();
    if(languageClientPromise)void languageClientPromise.then(stop).catch(()=>{});
    else void languageClient?.stop();
  }});
  // Internal, non-contributed browser acceptance probe. It opens the real
  // native Source documents before invoking VS Code's public provider commands.
  if(typeof Worker==="function"&&typeof globalThis.location!=="undefined"){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.languageProviderAcceptance",
      async procedureUriValue=>{
        const procedureUri=vscode.Uri.parse(String(procedureUriValue??""));
        const procedureDocument=await vscode.workspace.openTextDocument(procedureUri);
        const procedureLines=procedureDocument.getText().split(/\\r\\n|\\n|\\r/);
        const scriptPathValue="scripts/select_establishment_configuration.py";
        const procedureLine=procedureLines.findIndex(line=>line.includes("script: "+scriptPathValue));
        if(procedureLine<0)throw Error("Procedure Source does not contain the expected declared script path");
        const procedureCharacter=procedureLines[procedureLine].indexOf(scriptPathValue)+12;
        await openNativeSource(vscode,procedureUri,{preview:true});
        await new Promise(resolve=>setTimeout(resolve,180));
        const procedurePosition=new vscode.Position(procedureLine,procedureCharacter);
        const definitionResult=await vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",procedureUri,procedurePosition);
        const definitions=Array.isArray(definitionResult)?definitionResult:
          definitionResult?[definitionResult]:[];
        const target=definitions.find(item=>item?.uri||item?.targetUri);
        if(!target)throw Error("Definition provider returned no exact script target (languageId="+
          procedureDocument.languageId+", line="+procedureLine+", position="+procedureCharacter+")");
        const scriptUri=target.uri??target.targetUri;
        const scriptPath=scriptUri.path;
        if(!scriptPath.endsWith("/"+scriptPathValue))
          throw Error("Definition resolved to an unexpected target: "+scriptPath);
        const hoverResult=await vscode.commands.executeCommand(
          "vscode.executeHoverProvider",procedureUri,procedurePosition);
        const hovers=Array.isArray(hoverResult)?hoverResult:
          hoverResult?[hoverResult]:[];
        const hoverText=hovers.flatMap(item=>
          Array.isArray(item?.contents)?item.contents:[item?.contents])
          .map(item=>typeof item==="string"?item:item?.value??String(item??""))
          .join(" ");
        if(!hoverText.includes("Skill Script")||
           !hoverText.includes("select-establishment-configuration"))
          throw Error("Hover provider did not return the declared Skill Script metadata");
        const scriptDocument=await vscode.workspace.openTextDocument(scriptUri);
        const scriptLines=scriptDocument.getText().split(/\\r\\n|\\n|\\r/);
        const nameLine=scriptLines.findIndex(line=>line==="# name: select-establishment-configuration");
        const schemaLine=scriptLines.findIndex(line=>line==="# inputSchema: EstablishmentSelectionInput");
        if(nameLine<0||schemaLine<0)
          throw Error("Python Source is missing the declared name or inputSchema metadata");
        await openNativeSource(vscode,scriptUri,{preview:true});
        await new Promise(resolve=>setTimeout(resolve,300));
        const referenceResult=await vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",scriptUri,new vscode.Position(nameLine,12));
        const references=Array.isArray(referenceResult)?referenceResult:[];
        if(!references.some(item=>item?.uri?.toString()===procedureUri.toString()))
          throw Error("References provider did not return the Procedure caller");
        const symbolResult=await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",scriptUri);
        const symbols=Array.isArray(symbolResult)?symbolResult:[];
        if(!symbols.some(item=>item.name==="main"))
          throw Error("Python Document Symbols did not include main()");
        const completionResult=await vscode.commands.executeCommand(
          "vscode.executeCompletionItemProvider",scriptUri,
          new vscode.Position(schemaLine,scriptLines[schemaLine].length));
        const completions=Array.isArray(completionResult)?completionResult:
          completionResult?.items??[];
        const labels=completions.map(item=>
          typeof item.label==="string"?item.label:item.label?.label??"");
        if(!labels.includes("EstablishmentSelectionInput"))
          throw Error("Schema Completion did not return the unique Package title");
        return {
          definition:scriptPath,
          hover:hovers.length,
          references:references.length,
          symbols:symbols.map(item=>item.name),
          schemaCompletion:"EstablishmentSelectionInput",
          procedureLanguage:procedureDocument.languageId,
          scriptLanguage:scriptDocument.languageId,
          procedureLine,
          nameLine,
          schemaLine
        };
      }
    ));
  }

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
  async function refreshPredicateSnapshot(doc){
    const version=doc.version,uri=doc.uri.toString(),ticket=++predicateGeneration;
    const next=await predicateContext(doc);
    if(document!==doc||doc.version!==version||ticket!==predicateGeneration)return;
    predicateSnapshot={uri,version,...next};
    fire();
  }
  function singleSourceChange(preview){
    const {start,end}=preview.sourceSpan;
    const delta=preview.candidateSource.length-preview.baseSource.length;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start<0||end<start||end>preview.baseSource.length||
       end+delta<start||end+delta>preview.candidateSource.length)
      throw Error("Phase Patch Source span is invalid");
    return [{start,end,
      oldValue:preview.baseSource.slice(start,end),
      newValue:preview.candidateSource.slice(start,end+delta)}];
  }
  async function confirmAndApply({doc,source,version,preview,changes,verify}){
    const message=[preview.summary,preview.diff].filter(Boolean).join("\n\n");
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
      const insertion=span.start===span.end&&span.oldValue===""&&
        typeof span.newValue==="string"&&span.newValue.length>0;
      if(!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||
         span.start<0||span.end<span.start||span.end>source.length||
         (span.end===span.start&&!insertion)||
         typeof span.oldValue!=="string"||typeof span.newValue!=="string"||
         source.slice(span.start,span.end)!==span.oldValue)
        throw Error("Patch Source span no longer matches the current document");
      edit.replace(doc.uri,new vscode.Range(
        doc.positionAt(span.start),doc.positionAt(span.end)),span.newValue);
    }
    const applied=await vscode.workspace.applyEdit(edit);
    if(!applied)throw Error("Host rejected WorkspaceEdit");
    return true;
  }

  async function editPhaseInputBinding(item,bindingKey,newValue){
    if(item?.kind!=="phase-step"||typeof item.phaseName!=="string"||
       !Number.isSafeInteger(item.stepIndex))
      throw Error("Select an eligible Phase Step in the native Inspector");
    const ctx=currentNode(item);
    const options=phaseStepBindingOptions(ctx.source,ctx.procedureId,ctx.nodeId)
      .filter(x=>x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
    if(!options.length)throw Error("This Phase Step has no qualified same-type input bindings");
    let key=bindingKey;
    if(typeof key!=="string"){
      const picked=await vscode.window.showQuickPick(options.map(x=>({
        label:x.bindingKey,description:x.value,detail:x.inputType+" · "+x.stepName
      })),{placeHolder:"选择要修改的 Phase Step 输入绑定"});
      key=picked?.label??picked;
    }
    const binding=options.find(x=>x.bindingKey===key);
    if(!binding)throw Error("Selected binding is not part of the current Phase Step");
    let value=newValue;
    if(typeof value!=="string"){
      value=await vscode.window.showQuickPick(binding.choices.filter(x=>x!==binding.value),{
        placeHolder:"选择同类型的 Procedure 输入来源"
      });
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Phase binding");
    const preview=previewPhaseInputBinding(ctx.source,ctx.procedureId,ctx.nodeId,
      item.phaseName,item.stepIndex,key,value);
    return confirmAndApply({
      ...ctx,preview,
      changes:p=>[{
        start:p.sourceSpan.start,end:p.sourceSpan.end,
        oldValue:p.oldValue,newValue:p.newValue
      }],
      verify:text=>applyPhaseInputBinding(text,preview)
    });
  }

  async function addPhaseVerify(item,predicate){
    if(item?.kind!=="phase"||typeof item.phaseName!=="string")
      throw Error("Select an eligible Phase in the native Inspector");
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const options=phaseVerifyAddOptions(ctx.source,ctx.procedureId,ctx.nodeId,
      predicates.predicateSource,predicates.skillName);
    const phase=options.find(x=>x.phaseName===item.phaseName);
    if(!phase)throw Error("Selected Phase has no safe Verify append anchor or available PredicateSet entry");
    let value=predicate;
    if(typeof value!=="string"){
      const picked=await vscode.window.showQuickPick(phase.choices,{
        placeHolder:"选择要追加到 Phase 末尾的 Package Predicate"
      });
      value=typeof picked==="string"?picked:picked?.value??picked?.label;
    }
    if(typeof value!=="string"||!value.trim())return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Verify Step");
    const preview=previewAddPhaseVerify(ctx.source,ctx.procedureId,ctx.nodeId,
      item.phaseName,value,predicates.predicateSource,predicates.skillName);
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,
      verify:text=>applyAddPhaseVerify(text,preview,predicates.predicateSource)
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function editPhaseVerifyStep(item,requestedAction){
    if(item?.kind!=="phase-step"||item.stepOperator!=="verify"||
       typeof item.phaseName!=="string"||!Number.isSafeInteger(item.stepIndex))
      throw Error("Select an eligible Verify Step in the native Inspector");
    const ctx=currentNode(item);
    const deletions=phaseVerifyDeleteOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    const reorder=adjacentVerifyReorderOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    const canDelete=deletions.some(x=>x.phaseName===item.phaseName&&
      x.stepIndex===item.stepIndex);
    const canMoveUp=reorder.some(x=>x.phaseName===item.phaseName&&
      x.stepIndex===item.stepIndex-1);
    const canMoveDown=reorder.some(x=>x.phaseName===item.phaseName&&
      x.stepIndex===item.stepIndex);
    const choices=[
      ...(canMoveUp?[{label:"Move Verify Up",value:"move-up"}]:[]),
      ...(canMoveDown?[{label:"Move Verify Down",value:"move-down"}]:[]),
      ...(canDelete?[{label:"Delete Verify Step",value:"delete"}]:[])
    ];
    let action=requestedAction;
    if(typeof action!=="string"){
      const picked=await vscode.window.showQuickPick(choices,{
        placeHolder:"选择此 Verify Step 的安全编辑操作"
      });
      action=typeof picked==="string"?picked:picked?.value;
    }
    if(!choices.some(x=>x.value===action))return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the Verify Step operation");
    let preview,verify;
    if(action==="delete"){
      preview=previewDeletePhaseVerify(ctx.source,ctx.procedureId,ctx.nodeId,
        item.phaseName,item.stepIndex);
      verify=text=>applyDeletePhaseVerify(text,preview);
    }else{
      const pairIndex=action==="move-up"?item.stepIndex-1:item.stepIndex;
      preview=previewAdjacentVerifyReorder(ctx.source,ctx.procedureId,ctx.nodeId,
        item.phaseName,pairIndex);
      verify=text=>applyAdjacentVerifyReorder(text,preview);
    }
    const applied=await confirmAndApply({
      ...ctx,preview,changes:singleSourceChange,verify
    });
    if(applied)update(ctx.doc);
    return applied;
  }

  async function insertNode(item,spec){
    if(item?.kind!=="route"||typeof item.routeId!=="string")
      throw Error("Select an eligible Route in the native Inspector");
    const ctx=currentNode(item);
    const predicates=await predicateContext(ctx.doc);
    const options=insertNodeOptions(ctx.source,ctx.procedureId,item.routeId,
      predicates.predicateSource,predicates.skillName);
    if(!options)throw Error("Selected Route is not eligible for Node insertion");
    let nodeId=spec?.nodeId;
    if(typeof nodeId!=="string")
      nodeId=await vscode.window.showInputBox({
        value:"new-node",prompt:"输入新 Node ID",placeHolder:"new-node-id"
      });
    if(typeof nodeId!=="string"||!nodeId.trim())return false;
    let operator=spec?.operator;
    if(typeof operator!=="string"){
      const choices=[
        ...(options.terminalValues.length?["terminal"]:[]),
        "call",...(options.predicates.length?["verify"]:[])
      ];
      operator=await vscode.window.showQuickPick(choices,{
        placeHolder:"选择要插入的 Node Operator"
      });
    }
    if(typeof operator!=="string")return false;
    let value=spec?.value;
    if(typeof value!=="string"){
      if(operator==="terminal"||operator==="verify"){
        const choices=operator==="terminal"?options.terminalValues:options.predicates;
        value=await vscode.window.showQuickPick(choices,{
          placeHolder:operator==="terminal"?"选择 Terminal 状态":"选择 Package Predicate"
        });
      }else{
        value=await vscode.window.showInputBox({
          value:"sbi.new.operation",prompt:"输入新 Node 的 Call operation"
        });
      }
    }
    if(typeof value!=="string"||!value.trim())return false;
    let outcome=operator==="terminal"?"":spec?.outcome;
    if(operator!=="terminal"&&typeof outcome!=="string")
      outcome=await vscode.window.showInputBox({
        value:operator==="verify"?"PASS":"COMMITTED",
        prompt:"输入新 Node 的 Outcome"
      });
    if(operator!=="terminal"&&typeof outcome!=="string")return false;
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the new Node");
    const preview=previewNodeInsert(ctx.source,ctx.procedureId,item.routeId,
      {nodeId,operator,value,outcome},
      predicates.predicateSource,predicates.skillName);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:async text=>{
        const current=await predicateContext(ctx.doc);
        return applyNodeInsert(text,preview,current.predicateSource,current.skillName);
      }
    });
    if(applied){
      const nextSelection={procedureId:ctx.procedureId,nodeId:preview.nodeId};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
    }
    return applied;
  }

  async function deleteNode(item,redirectTarget){
    if(item?.kind!=="node")
      throw Error("Select a Node in the native Inspector");
    const ctx=currentNode(item);
    const options=deleteNodeOptions(ctx.source,ctx.procedureId,ctx.nodeId);
    if(!options)throw Error("Selected Node is not eligible for safe deletion");
    let target=redirectTarget;
    if(typeof target!=="string"){
      target=options.targets.length===1?options.targets[0]:
        await vscode.window.showQuickPick(options.targets,{
          placeHolder:"选择删除 Node 后的 Route 重定向目标"
        });
    }
    if(typeof target!=="string")return false;
    if(!options.targets.includes(target))
      throw Error("Redirect target is not in the qualified deletion choices");
    if(ctx.doc.version!==ctx.version||ctx.doc.getText()!==ctx.source)
      throw Error("Source changed while choosing the redirect target");
    const preview=previewNodeDelete(ctx.source,ctx.procedureId,ctx.nodeId,target);
    const applied=await confirmAndApply({
      ...ctx,preview,
      changes:p=>p.sourceSpans.map(span=>({
        start:span.start,end:span.end,oldValue:span.oldValue,newValue:span.newValue
      })),
      verify:text=>applyNodeDelete(text,preview)
    });
    if(applied){
      const nextSelection={procedureId:ctx.procedureId,nodeId:target};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
    }
    return applied;
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
      const nextSelection={procedureId:ctx.procedureId,nodeId:value};
      selections.set(ctx.doc.uri.toString(),nextSelection);
      update(ctx.doc,nextSelection);
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
        tree.kind=item.kind;
        if(item.kind==='node'){
          const deletable=id==='inspection'&&document&&
            deleteNodeOptions(document.getText(),item.procedureId,item.nodeId);
          tree.contextValue=deletable?'skillStudio.deletableNode':'skillStudio.node';
          item.sourceVersion=document?.version;item.documentUri=document?.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
        }
        if(item.kind==='route'&&id==='inspection'&&document&&
           insertNodeOptions(document.getText(),item.procedureId,item.routeId)){
          tree.contextValue='skillStudio.route';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.routeId=item.routeId;tree.sourceVersion=item.sourceVersion;
          tree.documentUri=item.documentUri;
        }
        if(item.kind==='phase'&&id==='inspection'&&document){
          const cached=predicateSnapshot?.uri===document.uri.toString()&&
            predicateSnapshot.version===document.version?predicateSnapshot:null;
          const canAdd=cached&&phaseVerifyAddOptions(document.getText(),
            item.procedureId,item.nodeId,cached.predicateSource,cached.skillName)
            .some(x=>x.phaseName===item.phaseName);
          tree.contextValue=canAdd?'skillStudio.phaseWithVerifyAdd':'skillStudio.phase';
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.phaseName=item.phaseName;tree.sourceVersion=item.sourceVersion;
          tree.documentUri=item.documentUri;
        }
        if(item.kind==='phase-step'&&id==='inspection'&&document){
          const source=document.getText();
          const hasBinding=bindingOptions.some(x=>
            x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const deletable=item.stepOperator==='verify'&&
            phaseVerifyDeleteOptions(source,item.procedureId,item.nodeId).some(x=>
              x.phaseName===item.phaseName&&x.stepIndex===item.stepIndex);
          const reorder=item.stepOperator==='verify'
            ?adjacentVerifyReorderOptions(source,item.procedureId,item.nodeId):[];
          const canMoveUp=reorder.some(x=>x.phaseName===item.phaseName&&
            x.stepIndex===item.stepIndex-1);
          const canMoveDown=reorder.some(x=>x.phaseName===item.phaseName&&
            x.stepIndex===item.stepIndex);
          const canEditVerify=deletable||canMoveUp||canMoveDown;
          tree.contextValue=hasBinding
            ?(canEditVerify?'skillStudio.phaseStepAndVerify':'skillStudio.phaseStep')
            :(canEditVerify?'skillStudio.verifyStep':'skillStudio.phaseStepPlain');
          item.sourceVersion=document.version;item.documentUri=document.uri.toString();
          tree.procedureId=item.procedureId;tree.nodeId=item.nodeId;
          tree.phaseName=item.phaseName;tree.stepIndex=item.stepIndex;
          tree.stepName=item.stepName;tree.stepOperator=item.stepOperator;
          tree.stepValue=item.stepValue;
          tree.sourceVersion=item.sourceVersion;tree.documentUri=item.documentUri;
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
    if(!same){
      generation++;audit=[];diagnostics.clear();
      predicateSnapshot=null;predicateGeneration++;
    }
    document=doc;selection=next;selections.set(key,next);
    if(!predicateSnapshot||predicateSnapshot.uri!==key||
       predicateSnapshot.version!==doc.version){
      predicateSnapshot=null;
      void refreshPredicateSnapshot(doc);
    }
    if(changed){
      snapshot={...inspectionSnapshot(text,selection,projected),text};
      bindingOptions=snapshot.model.state==='READY'&&selection.procedureId&&selection.nodeId
        ?phaseStepBindingOptions(text,selection.procedureId,selection.nodeId):[];
      fire();
    }
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
    vscode.commands.registerCommand('skillStudio.editPhaseInputBinding',async(item,bindingKey,newValue)=>{
      try{return await editPhaseInputBinding(item,bindingKey,newValue);}
      catch(error){await vscode.window.showWarningMessage('Phase Binding 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.addPhaseVerify',async(item,predicate)=>{
      try{return await addPhaseVerify(item,predicate);}
      catch(error){await vscode.window.showWarningMessage('新增 Verify Step 未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.editPhaseVerifyStep',async(item,action)=>{
      try{return await editPhaseVerifyStep(item,action);}
      catch(error){await vscode.window.showWarningMessage('Verify Step 修改未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.insertNode',async(item,spec)=>{
      try{return await insertNode(item,spec);}
      catch(error){await vscode.window.showWarningMessage('Node 插入未执行：'+error.message);return false;}
    }),
    vscode.commands.registerCommand('skillStudio.deleteNode',async(item,redirectTarget)=>{
      try{return await deleteNode(item,redirectTarget);}
      catch(error){await vscode.window.showWarningMessage('Node 删除未执行：'+error.message);return false;}
    }),
    vscode.workspace.onDidChangeTextDocument(e=>{
      if(isProcedurePath(e.document.uri.path)&&document?.uri.toString()===e.document.uri.toString())update(e.document);
      if(document){
        const predicatePath=document.uri.path.slice(0,-'procedure.yaml'.length)+'predicates.yaml';
        if(e.document.uri.path===predicatePath){
          predicateSnapshot=null;predicateGeneration++;
          void refreshPredicateSnapshot(document);
        }
        scheduleAudit();
      }
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
  return {attach(doc,post){
    sessions.set(doc.uri.toString(),post);update(doc);scheduleAudit();
    const releaseLanguagePackage=attachLanguagePackage(doc);
    return ()=>{sessions.delete(doc.uri.toString());releaseLanguagePackage();};
  },select(doc,message){
    if(message.version!==doc.version||typeof message.procedureId!=='string')return;
    update(doc,{procedureId:message.procedureId,nodeId:typeof message.nodeId==='string'?message.nodeId:null});
  },activate(doc){
    const changed=document?.uri.toString()!==doc.uri.toString()||snapshot?.text!==doc.getText();
    update(doc);if(changed)scheduleAudit();
    const rootInfo=packageRootForProcedure(vscode,doc);
    const state=rootInfo?languagePackages.get(rootInfo.uri.toString()):null;
    if(state){state.procedureDocument=doc;scheduleLanguagePackageRefresh(state);}
  }};
}
