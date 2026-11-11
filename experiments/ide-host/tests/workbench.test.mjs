import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {inspectionSnapshot} from '../vscode/src/inspection.mjs';

// Workbench now consumes the canonical YAML token catalog. Bundle it with the
// same explicit YAML text loader used by the production extension build;
// Node's native ESM loader does not import .yaml files directly.
const scratchRoot=resolve(process.cwd(),'.agent-tmp');
mkdirSync(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,'workbench-test-'));
const bundlePath=join(scratch,'workbench.mjs');
let registerWorkbench;
try{
  await build({
    entryPoints:[resolve('experiments/ide-host/vscode/src/workbench.mjs')],
    outfile:bundlePath,bundle:true,format:'esm',platform:'node',
    target:'node24',packages:'external',loader:{'.yaml':'text'},
    logLevel:'silent',
    plugins:[{
      name:'node-workbench-test-no-browser-worker',
      setup(build){
        // Node workbench tests intentionally exercise the extension-host
        // fallback, not the browser Worker transport. Keep that lazy import
        // out of the test bundle; dedicated LSP tests cover it independently.
        build.onResolve({filter:/browserClient[.]mjs$/},()=>({
          path:'browser-client-test-stub',namespace:'workbench-test'
        }));
        build.onLoad({filter:/.*/,namespace:'workbench-test'},()=>({
          contents:'export function createSkillLanguageClient(){ throw new Error("Browser Worker client is not used in Node workbench tests"); }',
          loader:'js'
        }));
      }
    }]
  });
  ({registerWorkbench}=await import(pathToFileURL(bundlePath).href));
}finally{
  await rm(scratch,{recursive:true,force:true});
}
import {deleteNodeOptions,previewNodeDelete} from '../../../site/node-delete.mjs';
const root='site/samples/packages/establish-pdu-session/';
const source=readFileSync(root+'assurance/procedure.yaml','utf8');
const outputReferenceSource=readFileSync('tests/fixtures/establish-pre-hold/assurance/procedure.yaml','utf8');
const phaseFull="          'on':\n            FAILED: failed\n            UNRESOLVED: unresolved\n";
const phaseMissing="          'on':\n            UNRESOLVED: unresolved\n";
const phasePcf="          'on':\n            FAILED: finalize-failed\n            UNRESOLVED: finalize-unresolved\n";
const phaseTypo="          'on':\n            MISTYPED: finalize-failed\n            UNRESOLVED: finalize-unresolved\n";
const missingOutcomeSource=source.replace(phaseFull,phaseMissing);
const typoOutcomeSource=source.replace(phasePcf,phaseTypo);
const extraOutcomeSource=source.replace(phaseFull,
  "          'on':\n            FAILED: failed\n            UNRESOLVED: unresolved\n            EXTRA: failed\n");
test('Inspection preserves Classic node/phase/route source identity; unknown syntax fails closed',()=>{
  const result=inspectionSnapshot(source,{procedureId:'establish-session',nodeId:'nudm-sdm-subscribe'});
  assert.equal(result.model.state,'READY');
  assert.equal(result.outline.length,5);
  const proc=[...result.model.procedures.values()].find(p=>p.nodes.some(n=>n.id==='nudm-sdm-subscribe'));
  const selected=inspectionSnapshot(source,{procedureId:proc.name,nodeId:'nudm-sdm-subscribe'});
  assert.ok(selected.inspection.some(x=>x.label==='preconditions'&&x.children.length===5));
  assert.ok(selected.evidence.some(x=>x.label.includes('Runtime NOT_RUN')));
  assert.ok(selected.inspection.every(x=>x.line>0));
  assert.ok(selected.dataflow.bindings.length>0,'selected Node exposes source-resolved Phase dependencies');
  assert.equal(selected.consumerContracts.summary.authorizedWrites,0,
    'read-only Evidence never grants ABI write authority');
  const script=readFileSync(root+'scripts/select_establishment_configuration.py','utf8');
  const schemas=new Map([
    ['scripts/select_establishment_configuration.py',{text:script}],
    ['schemas/EstablishmentSelectionInput.schema.yaml',{text:`title: EstablishmentSelectionInput
type: object
required: [dnn, slice, plmn, ingress-ref, lifecycle-ref, requested-type, requested-ssc, udmResult]
properties:
  dnn: {type: string}
  slice: {type: object}
  plmn: {type: object}
  ingress-ref: {type: string}
  lifecycle-ref: {type: string}
  requested-type: {type: string}
  requested-ssc: {type: integer}
  udmResult: {type: object}
`}]
  ]);
  const typed=inspectionSnapshot(source,{procedureId:proc.name,nodeId:'nudm-sdm-subscribe'},null,schemas);
  assert.ok(typed.consumerContracts.bindings.some(x=>x.typeRelation==='TYPE_ONLY_MATCH'),
    'Evidence distinguishes declared type-only matches from full ABI proof');
  assert.ok(typed.consumerContracts.bindings.some(x=>x.typeRelation==='PRODUCER_TYPE_UNAVAILABLE'),
    'Evidence keeps unknown producer output types explicit');
  const flow=typed.evidence.find(x=>x.label.includes('Producer / Consumer dataflow'));
  assert.ok(flow?.children.some(x=>x.label.includes('Consumer ABI')));
  assert.ok(flow.children.every(x=>!x.writeAuthorized),
    'dataflow evidence rows remain read-only');
  const invalid=inspectionSnapshot('procedures: [invalid]');
  assert.equal(invalid.model.state,'UNAVAILABLE');assert.equal(invalid.outline.length,0);assert.ok(invalid.problems.length);
});

test('Inspection exposes only Classic-qualified same-producer output reference normalization',()=>{
  const procedureId='ue-requested-pdu-session-establishment';
  const selected=inspectionSnapshot(outputReferenceSource,{
    procedureId,nodeId:'nudm-sdm-subscribe'
  });
  const phase=selected.inspection.find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const step=phase?.children.find(x=>x.kind==='phase-step'&&x.stepIndex===1);
  const reference=step?.children.find(x=>x.kind==='phase-output-reference'&&
    x.bindingKey==='selection');
  assert.ok(reference,'eligible same-producer output reference is exposed under its Phase Step');
  assert.equal(reference.currentValue,
    'preconditions.select-subscription-configuration.output');
  assert.deepEqual(reference.choices,[
    'preconditions.select-subscription-configuration.output',
    'nudm-sdm-subscribe.preconditions.select-subscription-configuration.output'
  ]);
  assert.equal(reference.producerPhase,'preconditions');
  assert.equal(reference.producerStep,'select-subscription-configuration');
  const current=inspectionSnapshot(source,{
    procedureId,nodeId:'nudm-sdm-subscribe'
  });
  assert.ok(current.inspection.every(p=>p.children.every(s=>
    s.children.every(x=>x.kind!=='phase-output-reference'))),
    'UDM Subscribe sample does not expose unsupported output-reference actions');
  // The PCF candidate is observed but not executable: converting its last
  // local occurrence would remove Classic's required dual-form evidence.
  const pcf=inspectionSnapshot(source,{
    procedureId,nodeId:'npcf-sm-policy-control-create'
  });
  const pcfPhase=pcf.inspection.find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const pcfStep=pcfPhase?.children.find(x=>x.kind==='phase-step'&&x.stepIndex===4);
  assert.ok(pcfStep,'PCF baseline Verify Step remains visible');
  assert.ok(!pcfStep.children.some(x=>x.kind==='phase-output-reference'&&
    x.bindingKey==='pcfPolicyAssociationRef'),
    'native Inspector must hide candidates rejected by Classic preview');
  // The published AMF node has multiple local occurrences plus a qualified
  // form, so normalizing one Verify binding remains reprovable.
  const live=inspectionSnapshot(source,{
    procedureId,nodeId:'namf-communication-n1n2-message-transfer'
  });
  const livePhase=live.inspection.find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const liveStep=livePhase?.children.find(x=>x.kind==='phase-step'&&x.stepIndex===1);
  const liveRef=liveStep?.children.find(x=>x.kind==='phase-output-reference'&&
    x.bindingKey==='operationContextRef');
  assert.ok(liveRef,'published AMF sample contains a reversible output-reference candidate');
  assert.deepEqual(liveRef.choices,[
    'preconditions.resolve-effective-session-configuration.output.contextRef',
    'namf-communication-n1n2-message-transfer.preconditions.resolve-effective-session-configuration.output.contextRef'
  ]);
  assert.equal(liveRef.producerStep,'resolve-effective-session-configuration');
});

test('Inspector exposes only owner-observed, Preview-qualified Outcome repairs',()=>{
  const procedureId='ue-requested-pdu-session-establishment';
  const findRepair=(text,nodeId)=>{
    const view=inspectionSnapshot(text,{procedureId,nodeId});
    return view.inspection.flatMap(row=>row.children)
      .find(child=>child.kind==='phase-outcome-repair'&&
        child.phaseName==='preconditions');
  };
  assert.equal(findRepair(source,'nudm-sdm-subscribe'),undefined,
    'complete owner example has no Outcome repair command');
  const addition=findRepair(missingOutcomeSource,'nudm-sdm-subscribe');
  assert.ok(addition,'missing core Outcome with observed target is repairable');
  assert.deepEqual([addition.addCount,addition.renameCount,addition.deleteCount],
    [1,0,0]);
  const typo=findRepair(typoOutcomeSource,'npcf-sm-policy-control-create');
  assert.ok(typo,'uniquely misspelled noncore Outcome has repair eligibility');
  assert.ok(typo.addCount>=1,'owner-observed missing-core additions also remain available');
  assert.equal(typo.renameCount,1,'the one provable typo correction is exposed');
  assert.equal(typo.deleteCount,0,'noncore deletion is forbidden until core is complete');
  const extra=findRepair(extraOutcomeSource,'nudm-sdm-subscribe');
  assert.ok(extra,'isolated noncore Outcome may be safely deleted');
  assert.deepEqual([extra.addCount,extra.renameCount,extra.deleteCount],[0,0,1]);
  const quoted=missingOutcomeSource.replace('UNRESOLVED: unresolved',
    "'UNRESOLVED': unresolved");
  assert.equal(findRepair(quoted,'nudm-sdm-subscribe'),undefined,
    'non-plain or ambiguous YAML fails closed');
});

test('Native views track unsaved Source, audit Classic package, reject stale selection and dispose listeners',async()=>{
  const commands=new Map(),providers=new Map(),changes=[],panels=[],diagnosticSets=[],appliedEdits=[];
  const markdownMessages=[],markdownReveals=[],showDocumentCalls=[];
  const disposable=()=>({dispose(){}});
  let confirmChoice='确认并应用',markdownMessage,visibleRangeChanged;
  function uri(path){return {path,toString(){return 'file://'+path;},with(change){return uri(change.path);}};}
  const file=uri('/workspace/establish-pdu-session/assurance/procedure.yaml');
  const doc={uri:file,version:1,text:source,getText(){return this.text;},positionAt(offset){return {offset};},get lineCount(){return this.text.split('\n').length;}};
  const markdownUri=uri('/workspace/SKILL.md');
  const markdownDoc={uri:markdownUri,version:1,text:'# Preview title\n<script>alert(1)</script>',
    getText(){return this.text;},get lineCount(){return this.text.split('\n').length;}};
  const markdownEditor={document:markdownDoc,visibleRanges:[{start:{line:0},end:{line:5}}],
    revealRange(range,type){markdownReveals.push({range,type});}};
  let changed;
  const vscode={
    EventEmitter:class {event=()=>disposable();fire(){changes.push(1);}dispose(){}},
    TreeItem:class {constructor(label,state){this.label=label;this.collapsibleState=state;}},
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    Range:class {constructor(start,startCharacter,end,endCharacter){
      if(typeof start==='number'){
        this.start={line:start,character:startCharacter};
        this.end={line:end,character:endCharacter};
      }else{this.start=start;this.end=startCharacter;}
    }},
    WorkspaceEdit:class {constructor(){this.changes=[];}replace(uri,range,value){this.changes.push({uri,range,value});}},
    Diagnostic:class {constructor(range,message,severity){Object.assign(this,{range,message,severity});}},DiagnosticSeverity:{Warning:1},
    RelativePattern:class {constructor(base,pattern){Object.assign(this,{base,pattern});}},
    ViewColumn:{One:1,Two:2,Beside:2},TextEditorRevealType:{AtTop:1},
    Uri:{joinPath(_base,...parts){return {toString(){return 'https://studio.invalid/'+parts.join('/');}};}},
    languages:{createDiagnosticCollection:()=>({clear(){diagnosticSets.length=0;},set(...args){diagnosticSets.push(args);},dispose(){}})},
    commands:{executeCommand:async()=>{},registerCommand(name,cb){commands.set(name,cb);return disposable();}},
    workspace:{textDocuments:[doc,markdownDoc],
      findFiles:async()=>['assurance/procedure.yaml','assurance/contract.yaml','assurance/predicates.yaml','SKILL.md'].map(p=>uri('/workspace/establish-pdu-session/'+p)),
      fs:{readFile:async u=>new TextEncoder().encode(readFileSync(root+u.path.split('establish-pdu-session/')[1],'utf8'))},
      async applyEdit(edit){
        appliedEdits.push([...edit.changes]);
        for(const change of [...edit.changes].sort((a,b)=>b.range.start.offset-a.range.start.offset))
          doc.text=doc.text.slice(0,change.range.start.offset)+change.value+doc.text.slice(change.range.end.offset);
        doc.version++;changed({document:doc});return true;
      },
      onDidChangeTextDocument(cb){changed=cb;return disposable();},
      openTextDocument:async target=>target.path==='/workspace/SKILL.md'?markdownDoc:doc},
    window:{registerTreeDataProvider(id,p){providers.set(id,p);return disposable();},
      onDidChangeActiveTextEditor:()=>disposable(),
      onDidChangeTextEditorVisibleRanges(cb){visibleRangeChanged=cb;return disposable();},
      visibleTextEditors:[markdownEditor],
      showTextDocument:async(document,options)=>{showDocumentCalls.push({document,options});return markdownEditor;},
      showInformationMessage:async()=>confirmChoice,showWarningMessage:async()=>{},
      showQuickPick:async items=>items[0],showInputBox:async options=>options?.value??'sbi.new.operation',
      createWebviewPanel(_type,_title,column){const p={column,reveal(nextColumn){this.column=nextColumn;},
        webview:{html:'',cspSource:'https://studio.invalid',asWebviewUri:u=>u,
          onDidReceiveMessage(cb){markdownMessage=cb;return disposable();},
          postMessage(message){markdownMessages.push(message);return Promise.resolve(true);}},
        onDidDispose:()=>disposable()};panels.push(p);return p;}}
  };
  const context={subscriptions:[],extensionUri:uri('/extension')},workbench=registerWorkbench(vscode,context),posted=[];
  workbench.attach(doc,m=>posted.push(m));
  assert.equal(providers.size,4);
  const beforeActivation=changes.length;workbench.activate(doc);workbench.activate(doc);
  assert.equal(changes.length,beforeActivation,"unchanged activation must not refresh the native trees");
  const outline=providers.get('skillStudio.outline');
  const node=outline.getChildren()[0].children[0];
  const item=outline.getTreeItem(node);
  const firstProcedure=outline.getChildren()[0];
  const selectedNode=firstProcedure.children[0];
  workbench.select(doc,{version:doc.version,procedureId:selectedNode.procedureId,nodeId:selectedNode.nodeId});
  const inspector=providers.get('skillStudio.inspection');
  const inspectorNode=inspector.getChildren().find(x=>x.kind==='node');
  assert.ok(inspectorNode,'selected Node identity is exposed to the native Inspector');
  const inspectorItem=inspector.getTreeItem(inspectorNode);
  assert.equal(inspectorItem.contextValue,'skillStudio.node');
  assert.equal(inspectorItem.nodeId,selectedNode.nodeId);
  assert.equal(inspectorItem.sourceVersion,doc.version);
  assert.equal(inspectorNode.sourceVersion,doc.version);
  assert.equal(inspectorNode.documentUri,doc.uri.toString());
  assert.ok(commands.has('skillStudio.renameNode'));
  assert.ok(commands.has('skillStudio.editNodeOperatorValue'));
  await commands.get(item.command.command)(...item.command.arguments);
  assert.equal(posted.at(-1).type,'focusNode');
  doc.version++;doc.text='procedures: [broken]';changed({document:doc});
  await commands.get(item.command.command)(...item.command.arguments);
  assert.equal(posted.length,1,'stale tree command cannot navigate');
  assert.equal(outline.getChildren().length,0);
  assert.ok(providers.get('skillStudio.problems').getChildren().length);
  doc.version++;doc.text=source;changed({document:doc});
  assert.ok(commands.has('skillStudio.editPhaseInputBinding'));
  const phaseProcedure='ue-requested-pdu-session-establishment';
  const phaseNode='nudm-sdm-subscribe';
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const phaseRow=providers.get('skillStudio.inspection').getChildren().find(x=>x.label==='preconditions');
  const phaseStep=phaseRow?.children.find(x=>
    x.kind==='phase-step'&&x.phaseName==='preconditions'&&x.stepIndex===0);
  assert.ok(phaseStep,'eligible Phase Step identity is exposed');
  const phaseItem=providers.get('skillStudio.inspection').getTreeItem(phaseStep);
  assert.equal(phaseItem.contextValue,'skillStudio.namedPhaseStepAndBinding');
  assert.equal(phaseItem.kind,'phase-step');
  assert.equal(phaseStep.sourceVersion,doc.version);
  assert.equal(phaseStep.documentUri,doc.uri.toString());
  const beforeBinding=doc.text,phaseVersion=doc.version;
  confirmChoice='取消';
  await commands.get('skillStudio.editPhaseInputBinding')(phaseItem,'dnn','input.ue-ref');
  assert.equal(doc.text,beforeBinding,'cancelled Phase binding preview must not write');
  confirmChoice='确认并应用';
  await commands.get('skillStudio.editPhaseInputBinding')(phaseItem,'dnn','input.ue-ref');
  assert.equal(doc.version,phaseVersion+1);
  assert.ok(doc.text.includes('dnn:\n                  from: input.ue-ref'));
  const writesAfterBinding=doc.text;
  await commands.get('skillStudio.editPhaseInputBinding')(phaseItem,'dnn','input.dnn');
  assert.equal(doc.text,writesAfterBinding,'stale Phase Step selection must not write');
  // The current demo has no same-Node alias pair. Exercise this bounded
  // operation against the pinned predecessor fixture that proves both spellings.
  assert.ok(commands.has('skillStudio.editPhaseOutputReference'));
  doc.text=outputReferenceSource;doc.version++;changed({document:doc});
  const outputProcedure='ue-requested-pdu-session-establishment';
  const outputNode='nudm-sdm-subscribe';
  workbench.select(doc,{version:doc.version,procedureId:outputProcedure,nodeId:outputNode});
  const outputPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const outputStep=outputPhase?.children.find(x=>x.kind==='phase-step'&&x.stepIndex===1);
  const outputRow=outputStep?.children.find(x=>x.kind==='phase-output-reference'&&
    x.bindingKey==='selection');
  assert.ok(outputRow,'eligible output reference is represented as a nested Inspector row');
  const outputItem=providers.get('skillStudio.inspection').getTreeItem(outputRow);
  assert.equal(outputItem.contextValue,'skillStudio.phaseOutputReference');
  assert.equal(outputItem.sourceVersion,doc.version);
  assert.equal(outputItem.documentUri,doc.uri.toString());
  const localOutput='preconditions.select-subscription-configuration.output';
  const qualifiedOutput='nudm-sdm-subscribe.'+localOutput;
  const beforeOutput=doc.text,outputVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.editPhaseOutputReference')(
    outputItem,'selection',qualifiedOutput),false);
  assert.equal(doc.text,beforeOutput,'cancelled output-reference normalization must not touch Source');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.editPhaseOutputReference')(
    outputItem,'selection',qualifiedOutput),true);
  assert.equal(doc.version,outputVersion+1);
  assert.ok(doc.text.includes('from: '+qualifiedOutput));
  assert.equal(appliedEdits.at(-1).length,1,'normalization is one exact scalar WorkspaceEdit');
  assert.equal(appliedEdits.at(-1)[0].range.end.offset-
    appliedEdits.at(-1)[0].range.start.offset,localOutput.length);
  const normalized=doc.text;
  assert.equal(await commands.get('skillStudio.editPhaseOutputReference')(
    outputItem,'selection',localOutput),false,'stale output-reference selection cannot be reused');
  assert.equal(doc.text,normalized);
  workbench.select(doc,{version:doc.version,procedureId:outputProcedure,nodeId:outputNode});
  const normalizedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const normalizedStep=normalizedPhase.children.find(x=>x.kind==='phase-step'&&x.stepIndex===1);
  const normalizedRow=normalizedStep.children.find(x=>x.kind==='phase-output-reference');
  const normalizedItem=providers.get('skillStudio.inspection').getTreeItem(normalizedRow);
  assert.equal(await commands.get('skillStudio.editPhaseOutputReference')(
    normalizedItem,'selection',localOutput),true,'reverse normalization is allowed only while both forms remain observed');
  assert.equal(doc.text,beforeOutput,'forward and reverse normalization round-trip exactly');
  doc.text=source;doc.version++;changed({document:doc});
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});

  // D4-A4a: the native Route row only exposes shared, Source-proven targets.
  assert.ok(commands.has('skillStudio.editPhaseRouteTarget'));
  const phaseRouteRow=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='route'&&x.routeSource==='preconditions.on'&&
      x.outcome==='FAILED');
  assert.ok(phaseRouteRow?.phaseTargetChoices?.includes('finalize-failed'),
    'current UDM failed Route has a real same-Phase/same-Outcome target');
  const phaseRouteItem=providers.get('skillStudio.inspection').getTreeItem(phaseRouteRow);
  assert.ok(['skillStudio.phaseRouteTarget','skillStudio.routeAndPhaseTarget']
    .includes(phaseRouteItem.contextValue));
  assert.equal(phaseRouteItem.sourceVersion,doc.version);
  assert.equal(phaseRouteItem.documentUri,doc.uri.toString());
  const beforeRoute=doc.text,routeVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.editPhaseRouteTarget')(
    phaseRouteItem,'finalize-failed'),false);
  assert.equal(doc.text,beforeRoute,'cancelled Route retarget must not change Source');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.editPhaseRouteTarget')(
    phaseRouteItem,'finalize-failed'),true);
  assert.equal(doc.version,routeVersion+1);
  assert.ok(doc.text.includes('FAILED: finalize-failed'));
  assert.equal(appliedEdits.at(-1).length,1,'Route retarget patches one Source scalar');
  const modifiedRoute=doc.text;
  assert.equal(await commands.get('skillStudio.editPhaseRouteTarget')(
    phaseRouteItem,'finalize-failed'),false,'stale Route row must fail closed');
  assert.equal(doc.text,modifiedRoute);
  doc.text=source;doc.version++;changed({document:doc});
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});

  // D4-A4b1: real Source-owner fixtures qualify three distinct operations.
  assert.ok(commands.has('skillStudio.repairPhaseOutcome'));
  const getOutcomeRow=()=>{
    const phase=providers.get('skillStudio.inspection').getChildren()
      .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
    const row=phase?.children.find(x=>x.kind==='phase-outcome-repair');
    return row?providers.get('skillStudio.inspection').getTreeItem(row):null;
  };
  const selectOutcome=(text,nodeId)=>{
    doc.text=text;doc.version++;changed({document:doc});
    workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId});
    return getOutcomeRow();
  };
  const noRepair=selectOutcome(source,'nudm-sdm-subscribe');
  assert.equal(noRepair,null,'healthy Source should have no clickable repair row');
  const addItem=selectOutcome(missingOutcomeSource,'nudm-sdm-subscribe');
  assert.equal(addItem?.contextValue,'skillStudio.phaseOutcomeRepair');
  assert.equal(addItem.sourceVersion,doc.version);
  assert.equal(addItem.documentUri,doc.uri.toString());
  const addAction={mode:'add',outcome:'FAILED',target:'finalize-failed'};
  const missingBefore=doc.text,addVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    addItem,addAction),false);
  assert.equal(doc.text,missingBefore,'cancelled Phase Outcome add writes nothing');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    addItem,addAction),true);
  assert.equal(doc.version,addVersion+1);
  assert.ok(doc.text.includes("UNRESOLVED: unresolved\n            FAILED: finalize-failed\n"));
  assert.equal(appliedEdits.at(-1).length,1);
  assert.equal(appliedEdits.at(-1)[0].range.start.offset,
    appliedEdits.at(-1)[0].range.end.offset,'core Outcome uses one native insertion');
  const afterOutcomeAdd=doc.text;
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    addItem,addAction),false,'stale Outcome repair item must be rejected');
  assert.equal(doc.text,afterOutcomeAdd);
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    {...addItem,sourceVersion:doc.version},{mode:'add',
      outcome:'IMAGINED',target:'finalize-failed'}),false,
    'unobserved Outcome is never authorized');

  const typoItem=selectOutcome(typoOutcomeSource,'npcf-sm-policy-control-create');
  assert.equal(typoItem?.contextValue,'skillStudio.phaseOutcomeRepair');
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    typoItem,{mode:'rename',oldOutcome:'MISTYPED',
      newOutcome:'FAILED',target:'finalize-failed'}),true);
  assert.equal(doc.text,source,'Outcome spelling correction restores original Source');
  assert.equal(appliedEdits.at(-1).length,1);
  const extraItem=selectOutcome(extraOutcomeSource,'nudm-sdm-subscribe');
  assert.equal(extraItem?.contextValue,'skillStudio.phaseOutcomeRepair');
  assert.equal(await commands.get('skillStudio.repairPhaseOutcome')(
    extraItem,{mode:'delete',outcome:'EXTRA',target:'failed'}),true);
  assert.equal(doc.text,source,'safe noncore delete restores original Source');
  assert.equal(appliedEdits.at(-1).length,1);
  assert.equal(appliedEdits.at(-1)[0].value,'','noncore delete is exact line removal');
  // Subsequent named Step / Verify regressions always start with the exact
  // unchanged published Source.
  selectOutcome(source,'nudm-sdm-subscribe');

  assert.ok(commands.has('skillStudio.addPhaseVerify'));
  assert.ok(commands.has('skillStudio.editPhaseVerifyStep'));
  assert.ok(commands.has('skillStudio.renameNamedPhaseStep'));
  doc.text=source;doc.version++;changed({document:doc});
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const renamePhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const renameStep=renamePhase.children.find(x=>x.kind==='phase-step'&&x.stepIndex===0);
  const renameItem=providers.get('skillStudio.inspection').getTreeItem(renameStep);
  assert.equal(renameItem.contextValue,'skillStudio.namedPhaseStepAndBinding');
  const renamed='select-subscription-config-v2';
  const beforeRename=doc.text,renameVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.renameNamedPhaseStep')(renameItem,renamed),false);
  assert.equal(doc.text,beforeRename,'cancelled named Step rename must not touch Source');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.renameNamedPhaseStep')(renameItem,renamed),true);
  assert.equal(doc.version,renameVersion+1);
  assert.ok(doc.text.includes('- name: '+renamed));
  assert.equal(doc.text.includes('select-subscription-configuration'),false,
    'all closed-world same-Procedure output references are renamed atomically');
  assert.equal(appliedEdits.at(-1).length,6,'named Step identity and five references share one WorkspaceEdit');
  const afterRename=doc.text;
  assert.equal(await commands.get('skillStudio.renameNamedPhaseStep')(renameItem,'another-name'),false,
    'stale named Step selection cannot be reused');
  assert.equal(doc.text,afterRename);
  doc.text=source;doc.version++;changed({document:doc});
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const verifyPhaseRow=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  assert.ok(verifyPhaseRow,'Phase row exposes authoring identity');
  const verifyPhaseItem=providers.get('skillStudio.inspection').getTreeItem(verifyPhaseRow);
  const verifyPredicate='createdsession.n4.initial_resources_ready';
  const beforeVerify=doc.text,verifyVersion=doc.version,editCount=appliedEdits.length;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.addPhaseVerify')(verifyPhaseItem,verifyPredicate),false);
  assert.equal(doc.text,beforeVerify,'cancelled Verify addition must not touch Source');
  assert.equal(appliedEdits.length,editCount);
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.addPhaseVerify')(verifyPhaseItem,verifyPredicate),true);
  assert.equal(doc.version,verifyVersion+1);
  assert.ok(doc.text.includes('            - verify: '+verifyPredicate+'\n'));
  assert.equal(appliedEdits.at(-1).length,1,'Verify addition uses a single bounded Source span');
  assert.equal(appliedEdits.at(-1)[0].range.start.offset,appliedEdits.at(-1)[0].range.end.offset,
    'Verify addition is a zero-width insertion');
  const addedVerifySource=doc.text;
  assert.equal(await commands.get('skillStudio.addPhaseVerify')(verifyPhaseItem,verifyPredicate),false);
  assert.equal(doc.text,addedVerifySource,'stale Phase selection must not append twice');
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const addedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const addedStep=addedPhase.children.find(x=>x.stepIndex===5);
  assert.equal(addedStep.stepValue,verifyPredicate);
  const addedItem=providers.get('skillStudio.inspection').getTreeItem(addedStep);
  assert.equal(addedItem.contextValue,'skillStudio.verifyStep');
  const beforeMove=doc.text,moveVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(addedItem,'move-up'),false);
  assert.equal(doc.text,beforeMove,'cancelled Verify reorder must not write');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(addedItem,'move-up'),true);
  assert.equal(doc.version,moveVersion+1);
  assert.ok(doc.text.indexOf('            - verify: '+verifyPredicate)>
    doc.text.indexOf('            - verify: createdsession.ingress.eligible'));
  assert.ok(doc.text.indexOf('            - verify: '+verifyPredicate)<
    doc.text.indexOf('            - verify: createdsession.lifecycle.ready'),
    'one adjacent Verify was moved up without changing other Step order');
  const movedSource=doc.text;
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(addedItem,'move-down'),false);
  assert.equal(doc.text,movedSource,'stale Verify Step cannot reorder');
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const reorderedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const movedStep=reorderedPhase.children.find(x=>x.stepIndex===4);
  assert.equal(movedStep.stepValue,verifyPredicate);
  const movedItem=providers.get('skillStudio.inspection').getTreeItem(movedStep);
  const deleteVerifyVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(movedItem,'delete'),false);
  assert.equal(doc.version,deleteVerifyVersion);
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(movedItem,'delete'),true);
  assert.equal(doc.version,deleteVerifyVersion+1);
  assert.equal(doc.text,source,'Verify insertion/reorder/deletion round-trip preserves exact original Source');
  assert.equal(appliedEdits.at(-1).length,1,'Verify deletion uses one Source deletion');
  assert.equal(appliedEdits.at(-1)[0].value,'');

  // Exercise naming and zero-consumer deletion on a plain Verify whose
  // immediate Source neighbors are unambiguous in the current owner sample.
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const namedVerifyPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const unnamedVerify=namedVerifyPhase.children.find(x=>x.stepIndex===4);
  const unnamedVerifyItem=providers.get('skillStudio.inspection').getTreeItem(unnamedVerify);
  assert.equal(unnamedVerifyItem.contextValue,'skillStudio.verifyStep');
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(unnamedVerifyItem,
    {action:'name',newName:'lifecycle-ready'}),true);
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const namedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const namedVerify=namedPhase.children.find(x=>x.stepName==='lifecycle-ready');
  const namedVerifyItem=providers.get('skillStudio.inspection').getTreeItem(namedVerify);
  assert.equal(namedVerifyItem.contextValue,'skillStudio.namedVerifyStep');
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(namedVerifyItem,'delete'),true);
  assert.equal(doc.text,source.replace("            - verify: createdsession.lifecycle.ready\n",""),
    'named Verify deletion removes only the unreferenced Step');
  doc.text=source;doc.version++;changed({document:doc});
  assert.ok(commands.has('skillStudio.insertNode'));
  assert.ok(commands.has('skillStudio.deleteNode'));
  const routeProcedure='ue-requested-pdu-session-establishment';
  workbench.select(doc,{version:doc.version,procedureId:routeProcedure,nodeId:'nudm-sdm-get'});
  const routeRow=providers.get('skillStudio.inspection').getChildren().find(x=>
    x.kind==='route'&&x.routeId==='nudm-sdm-get:postconditions:PASS');
  assert.ok(routeRow,'patchable Route identity is exposed');
  const routeItem=providers.get('skillStudio.inspection').getTreeItem(routeRow);
  assert.equal(routeItem.contextValue,'skillStudio.route');
  assert.equal(routeItem.kind,'route');
  const insertSpec={nodeId:'ide-host-insert-probe',operator:'call',
    value:'sbi.demo.insert_probe',outcome:'COMMITTED'};
  const beforeInsert=doc.text,insertVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.insertNode')(routeItem,insertSpec),false);
  assert.equal(doc.text,beforeInsert,'cancelled Node insertion must not write');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.insertNode')(routeItem,insertSpec),true);
  assert.equal(doc.version,insertVersion+1);
  assert.ok(doc.text.includes('PASS: ide-host-insert-probe'));
  assert.ok(doc.text.includes('ide-host-insert-probe:\n        call: sbi.demo.insert_probe'));
  assert.equal(appliedEdits.at(-1).length,2,'Node insertion uses one two-span WorkspaceEdit');
  let deleteDiagnostic='';
  try{previewNodeDelete(doc.text,routeProcedure,'ide-host-insert-probe','nudm-sdm-subscribe');}
  catch(error){deleteDiagnostic=error.message;}
  assert.ok(deleteNodeOptions(doc.text,routeProcedure,'ide-host-insert-probe'),
    'Inserted single-outcome Node should be deletable: '+deleteDiagnostic);
  const insertedNode=providers.get('skillStudio.inspection').getChildren().find(x=>x.kind==='node');
  assert.ok(insertedNode);
  assert.equal(insertedNode.procedureId,routeProcedure);
  assert.equal(insertedNode.nodeId,'ide-host-insert-probe');
  assert.ok(deleteNodeOptions(doc.text,insertedNode.procedureId,insertedNode.nodeId),
    'Inspector Node row carries the same eligible identity as the Source model');
  const insertedItem=providers.get('skillStudio.inspection').getTreeItem(insertedNode);
  assert.equal(insertedItem.contextValue,'skillStudio.deletableNode');
  assert.equal(insertedItem.kind,'node');
  const afterInsert=doc.text,deleteVersion=doc.version;
  confirmChoice='取消';
  assert.equal(await commands.get('skillStudio.deleteNode')(insertedItem,'nudm-sdm-subscribe'),false);
  assert.equal(doc.text,afterInsert,'cancelled Node deletion must not write');
  confirmChoice='确认并应用';
  assert.equal(await commands.get('skillStudio.deleteNode')(insertedItem,'nudm-sdm-subscribe'),true);
  assert.equal(doc.version,deleteVersion+1);
  assert.ok(!doc.text.includes('ide-host-insert-probe:'));
  assert.ok(doc.text.includes('PASS: nudm-sdm-subscribe'));
  assert.equal(appliedEdits.at(-1).length,2,'Node deletion repairs inbound Route and removes Node in one WorkspaceEdit');
  const afterDelete=doc.text;
  assert.equal(await commands.get('skillStudio.deleteNode')(insertedItem,'nudm-sdm-subscribe'),false);
  assert.equal(doc.text,afterDelete,'stale Node selection cannot be deleted');
  const protectedNode=providers.get('skillStudio.inspection').getChildren().find(x=>x.kind==='node');
  assert.equal(protectedNode.nodeId,'nudm-sdm-subscribe','successful delete selects the qualified redirect target');
  assert.equal(providers.get('skillStudio.inspection').getTreeItem(protectedNode).contextValue,
    'skillStudio.node','Phase-bearing Node does not expose deletion');
  await commands.get('skillStudio.auditPackage')();
  assert.match(providers.get('skillStudio.problems').getChildren()[0].label,/editor warnings/);
  assert.ok(providers.get('skillStudio.problems').getChildren().every(x=>!x.label.includes('Audit unavailable')));
  assert.ok(commands.has('skillStudio.exportPackageZip'));
  // Package export uses the complete byte snapshot but overlays every open
  // TextDocument, so unsaved edits are included without writing to OPFS.
  const exportSource=source+'\n# unsaved-export-probe\n';
  doc.text=exportSource;doc.version++;changed({document:doc});
  const beforeZipMessages=posted.length;
  assert.equal(await commands.get('skillStudio.exportPackageZip')(),true);
  const zipMessage=posted.slice(beforeZipMessages).find(x=>x.type==='packageZipReady');
  assert.ok(zipMessage,'Package ZIP is delivered to the active Procedure Webview');
  assert.equal(zipMessage.filename,'establish-pdu-session.zip');
  assert.equal(zipMessage.fileCount,4);
  assert.equal(zipMessage.opaqueCount,0);
  const zipBytes=Buffer.from(zipMessage.base64,'base64');
  assert.equal(zipBytes.readUInt32LE(0),0x04034b50,'export is a real ZIP archive');
  let zipOffset=0,exportedProcedure='';
  while(zipBytes.readUInt32LE(zipOffset)===0x04034b50){
    const size=zipBytes.readUInt32LE(zipOffset+18);
    const nameLength=zipBytes.readUInt16LE(zipOffset+26);
    const extraLength=zipBytes.readUInt16LE(zipOffset+28);
    const nameStart=zipOffset+30;
    const name=zipBytes.subarray(nameStart,nameStart+nameLength).toString('utf8');
    const dataStart=nameStart+nameLength+extraLength;
    if(name==='assurance/procedure.yaml')
      exportedProcedure=zipBytes.subarray(dataStart,dataStart+size).toString('utf8');
    zipOffset=dataStart+size;
  }
  assert.ok(exportedProcedure.includes('# unsaved-export-probe'),
    'ZIP contains current unsaved native Source rather than stale disk bytes');
  doc.text=source;doc.version++;changed({document:doc});
  const evidence=providers.get('skillStudio.evidence').getChildren();
  assert.ok(evidence[0].label.includes('no write authority'));
  const dataflow=evidence.find(x=>x.label.includes('Producer / Consumer dataflow'));
  assert.ok(dataflow,'bounded Package Audit hydrates selected-Node dataflow evidence');
  assert.ok(dataflow.children.some(x=>x.label.includes('Consumer ABI')));
  assert.match(dataflow.description,/no write authorization/);
  assert.ok(dataflow.children.some(x=>x.label.includes('Source lineage')));
  await commands.get('skillStudio.previewMarkdown')(markdownUri);
  assert.equal(showDocumentCalls.at(-1).options.viewColumn,vscode.ViewColumn.One,
    'native Markdown Source is opened in the first editor column');
  assert.equal(showDocumentCalls.at(-1).options.preview,false,
    'native Markdown Source is a persistent editor, not a preview tab');
  assert.equal(panels[0].column,vscode.ViewColumn.Two,
    'read-only Markdown Preview is paired in the second editor column');
  assert.match(panels[0].webview.html,/Content-Security-Policy/);
  assert.match(panels[0].webview.html,/style-src https:\/\/studio\.invalid/);
  assert.match(panels[0].webview.html,/script-src 'nonce-[a-f0-9]{32}'/);
  assert.match(panels[0].webview.html,/img-src 'none'/);
  assert.match(panels[0].webview.html,/href="https:\/\/studio\.invalid\/media\/markdown-preview\.css"/);
  assert.match(panels[0].webview.html,/class="md-preview-toolbar"/);
  assert.match(panels[0].webview.html,/class="markdown-preview"/);
  assert.match(panels[0].webview.html,/<h1(?: id="[^"]+")? data-source-line="0">Preview title<\/h1>/);
  assert.match(panels[0].webview.html,/&lt;script&gt;/);
  assert.equal((panels[0].webview.html.match(/<script\b/gi)??[]).length,1,
    'only the nonce-protected local file navigation bridge is present');
  assert.match(panels[0].webview.html,/<script nonce="[a-f0-9]{32}">/);
  await markdownMessage({type:'ready'});
  markdownDoc.text='# Updated title\n\n## Details\n\nA live edit.';
  changed({document:markdownDoc});
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(markdownMessages.at(-1).type,'updatePreview',
    'unsaved native edits update the existing Webview rather than replacing its HTML');
  assert.match(markdownMessages.at(-1).html,/Updated title/);
  assert.match(markdownMessages.at(-1).html,/data-source-line="2"/);
  visibleRangeChanged({textEditor:markdownEditor,
    visibleRanges:[{start:{line:7},end:{line:12}}]});
  assert.deepEqual(markdownMessages.at(-1),{type:'scrollToLine',line:7},
    'native Source scrolling sends a source-line anchor to Preview');
  await markdownMessage({type:'scrollToSourceLine',line:6});
  assert.equal(markdownReveals.at(-1).range.start.line,6,
    'Preview scrolling reveals the matching native Source line');
  assert.equal(markdownReveals.at(-1).type,vscode.TextEditorRevealType.AtTop);
  await markdownMessage({type:'toggleLayout'});
  assert.equal(panels[0].column,vscode.ViewColumn.One,
    'small-screen single-pane mode places Preview in the Source group');
  await markdownMessage({type:'toggleLayout'});
  assert.equal(panels[0].column,vscode.ViewColumn.Two,
    'the toolbar can restore the side-by-side layout');
  markdownDoc.text='x'.repeat(300001);changed({document:markdownDoc});
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.match(markdownMessages.at(-1).html,/预览不可用/);
  
  for(const sub of context.subscriptions)sub.dispose();
  assert.ok(changes.length>3);
});
