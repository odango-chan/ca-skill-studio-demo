import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {inspectionSnapshot} from '../vscode/src/inspection.mjs';
import {isAllowedPackageRelativeLink} from '../vscode/src/markdown-link-policy.mjs';

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
const v1SampleRoot='site/samples/v1alpha5/';
const v1SampleManifest=JSON.parse(readFileSync(v1SampleRoot+'files.json','utf8'));
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
  assert.ok(selected.inspection.every(x=>x.line>0));
  assert.ok(selected.dataflow.bindings.length>0,'selected Node exposes source-resolved Phase dependencies');
  const inspectorFlow=selected.inspection.find(x=>x.kind==='data-flow');
  assert.ok(inspectorFlow,'selected Node displays contextual Data Flow in Inspector');
  assert.match(inspectorFlow.label,/Data Flow · Producer \/ Consumer/);
  assert.match(inspectorFlow.description,/Source-derived only · Runtime NOT_RUN/);
  assert.ok(inspectorFlow.children.some(x=>x.label.includes('Source lineage')));
  assert.ok(inspectorFlow.children.some(x=>x.label.includes('Consumer ABI')));
  assert.ok(inspectorFlow.children.every(x=>!x.writeAuthorized),
    'Inspector Data Flow must never claim source analysis authorizes writes');

  assert.equal(selected.consumerContracts.summary.authorizedWrites,0,
    'Source-derived Data Flow never grants write authority');
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
    'Data Flow distinguishes declared type-only matches from full ABI proof');
  assert.ok(typed.consumerContracts.bindings.some(x=>x.typeRelation==='PRODUCER_TYPE_UNAVAILABLE'),
    'Data Flow keeps unknown producer output types explicit');
  const typedFlow=typed.inspection.find(x=>x.kind==='data-flow');
  assert.ok(typedFlow?.children.some(x=>x.label.includes('Consumer ABI')));
  const consumerRows=typedFlow.children.filter(x=>x.label.includes('Step '));
  assert.ok(consumerRows.some(x=>x.children.some(c=>c.label==='Consumer ABI declaration')),
    'Inspector Data Flow keeps consumer ABI declarations, not Runtime Evidence');
  assert.ok(consumerRows.some(x=>x.children.some(c=>c.label==='Source / Runtime boundary')),
    'Inspector Data Flow labels its evidence boundary explicitly');
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

test('native Markdown links are constrained to the exact Package inventory',()=>{
  const allowed=new Set(['SKILL.md','references/3gpp-procedure.md','schemas/request.yaml']);
  assert.equal(isAllowedPackageRelativeLink('../SKILL.md','references',allowed),true);
  assert.equal(isAllowedPackageRelativeLink('../../outside.md','references',allowed),false);
  assert.equal(isAllowedPackageRelativeLink('missing.md','references',allowed),false);
  assert.equal(isAllowedPackageRelativeLink('//example.invalid/escape.md','references',allowed),false);
  assert.equal(isAllowedPackageRelativeLink('javascript:alert(1)','references',allowed),false);
  assert.equal(isAllowedPackageRelativeLink('#section','references',allowed),true);
  assert.equal(isAllowedPackageRelativeLink('https://example.invalid/docs','references',allowed),true);
});

test('Native views track unsaved Source, audit Package, reject stale selection and dispose listeners',async()=>{
  const commands=new Map(),providers=new Map(),changes=[],diagnosticSets=[],appliedEdits=[],nativeCommands=[];
  const showDocumentCalls=[];
  const disposable=()=>({dispose(){}});
  let confirmChoice='确认并应用',markdownExtensionActivated=false,
    v1alpha5Mode=false,compilerConnected=true;
  function uri(path){return {path,toString(){return 'file://'+path;},with(change){return uri(change.path);}};}
  const file=uri('/workspace/establish-pdu-session/assurance/procedure.yaml');
  const doc={uri:file,version:1,text:source,getText(){return this.text;},positionAt(offset){return {offset};},get lineCount(){return this.text.split('\n').length;}};
  const markdownUri=uri('/workspace/establish-pdu-session/SKILL.md');
  const contractUri=uri('/workspace/establish-pdu-session/assurance/contract.yaml');
  const predicatesUri=uri('/workspace/establish-pdu-session/assurance/predicates.yaml');
  const contractDoc={uri:contractUri,version:1,text:readFileSync(root+'assurance/contract.yaml','utf8'),
    getText(){return this.text;},get lineCount(){return this.text.split('\n').length;}};
  const predicatesDoc={uri:predicatesUri,version:1,text:readFileSync(root+'assurance/predicates.yaml','utf8'),
    getText(){return this.text;},get lineCount(){return this.text.split('\n').length;}};
  const markdownDoc={uri:markdownUri,version:1,languageId:'markdown',
    text:'# Preview title\n\nA native Markdown source.',
    getText(){return this.text;},get lineCount(){return this.text.split('\n').length;}};
  const markdownEditor={document:markdownDoc,visibleRanges:[{start:{line:0},end:{line:5}}]};
  let changed;
  const workspaceEvents={};
  const vscode={
    EventEmitter:class {event=()=>disposable();fire(){changes.push(1);}dispose(){}},
    TreeItem:class {constructor(label,state){this.label=label;this.collapsibleState=state;}},
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    ThemeIcon:class {constructor(id){this.id=id;}},
    SemanticTokensLegend:class {constructor(tokenTypes,tokenModifiers){
      this.tokenTypes=tokenTypes;this.tokenModifiers=tokenModifiers;
    }},
    SemanticTokens:class {constructor(data){this.data=data;}},
    Range:class {constructor(start,startCharacter,end,endCharacter){
      if(typeof start==='number'){
        this.start={line:start,character:startCharacter};
        this.end={line:end,character:endCharacter};
      }else{this.start=start;this.end=startCharacter;}
    }},
    WorkspaceEdit:class {constructor(){this.changes=[];}replace(uri,range,value){this.changes.push({uri,range,value});}},
    Diagnostic:class {constructor(range,message,severity){Object.assign(this,{range,message,severity});}},DiagnosticSeverity:{Error:0,Warning:1,Information:2},
    RelativePattern:class {constructor(base,pattern){Object.assign(this,{base,pattern});}},
    ViewColumn:{One:1,Two:2,Beside:2},
    FileType:{File:1,Directory:2,SymbolicLink:64},
    Uri:{parse(value){return uri(String(value).replace(/^file:\/\//,''));},
      joinPath(base,...parts){
        const joined=uri([base.path.replace(/\/$/,''),...parts].join('/'));
        joined.toString=()=> 'https://studio.invalid/'+parts.join('/');
        return joined;
      }},
    extensions:{getExtension(id){return id==='vscode.markdown-language-features'?{
      extensionUri:uri('/extensions/vscode.markdown-language-features'),isActive:markdownExtensionActivated,
      async activate(){markdownExtensionActivated=true;this.isActive=true;return {};}
    }:null;}},
    languages:{
      registerDocumentSemanticTokensProvider(){
        throw new Error("simulated semantic-token provider registration failure");
      },
      getDiagnostics:target=>diagnosticSets.flatMap(([uri,items])=>
        uri.path===target.path?items:[]),
      createDiagnosticCollection:()=>({clear(){diagnosticSets.length=0;},set(...args){diagnosticSets.push(args);},dispose(){}})
    },
    commands:{async executeCommand(id,...args){nativeCommands.push({id,args});return true;},
      async getCommands(){return ['markdown.showPreview','vscode.openWith'];},
      registerCommand(name,cb){commands.set(name,cb);return disposable();}},
    workspace:{textDocuments:[doc,markdownDoc,contractDoc,predicatesDoc],
      workspaceFolders:[{uri:uri('/workspace'),name:'workspace'}],
      getWorkspaceFolder:()=>({uri:uri('/workspace')}),
      findFiles:async pattern=>{
        if(pattern==='**/SKILL.md'||pattern==='**/establish-pdu-session/SKILL.md')return [markdownUri];
        if(v1alpha5Mode&&pattern?.pattern==='**/*')
          return v1SampleManifest.files.filter(path=>path.startsWith('establish-pdu-session/'))
            .map(path=>uri('/workspace/establish-pdu-session/'+path.slice('establish-pdu-session/'.length)));
        return [
          'assurance/procedure.yaml','assurance/contract.yaml','assurance/predicates.yaml',
          'SKILL.md','schemas/establishment-request.schema.yaml',
          'scripts/select_establishment_configuration.py','scripts/evaluate_udm_read.py',
          'scripts/evaluate_transfer_start.py'
        ].map(p=>uri('/workspace/establish-pdu-session/'+p));
      },
      getConfiguration:(section)=>({get:(key,fallback)=>section==='connectionAgent.skillStudio'
        ?({skillsRoot:'skills',dependencies:[],
          dependencyLock:{version:'skillc.lock/v0.1',entries:[]},
          defaultBuildTarget:'all'})[key]??fallback
        :({scrollEditorWithPreview:true,scrollPreviewWithEditor:true,markEditorSelection:true})[key]}),
      fs:{readFile:async u=>new TextEncoder().encode(v1alpha5Mode
          ?readFileSync(v1SampleRoot+'establish-pdu-session/'+u.path.split('establish-pdu-session/')[1],'utf8')
          :readFileSync(root+u.path.split('establish-pdu-session/')[1],'utf8')),
        stat:async target=>({type:target.path==='/workspace/establish-pdu-session'||target.path==='/workspace/establish-pdu-session/assurance'?2:1})},
      async applyEdit(edit){
        appliedEdits.push([...edit.changes]);
        for(const change of [...edit.changes].sort((a,b)=>b.range.start.offset-a.range.start.offset))
          doc.text=doc.text.slice(0,change.range.start.offset)+change.value+doc.text.slice(change.range.end.offset);
        doc.version++;changed({document:doc});return true;
      },
      onDidChangeTextDocument(cb){changed=cb;return disposable();},
      onDidCreateFiles(cb){workspaceEvents.create=cb;return disposable();},
      onDidDeleteFiles(cb){workspaceEvents.delete=cb;return disposable();},
      onDidRenameFiles(cb){workspaceEvents.rename=cb;return disposable();},
      onDidChangeConfiguration(cb){workspaceEvents.configuration=cb;return disposable();},
      openTextDocument:async target=>target.path.endsWith('/establish-pdu-session/SKILL.md')?markdownDoc:
        v1alpha5Mode&&target.path.endsWith('/assurance/contract.yaml')?contractDoc:
        v1alpha5Mode&&target.path.endsWith('/assurance/predicates.yaml')?predicatesDoc:doc},
    window:{registerTreeDataProvider(id,p){providers.set(id,p);return disposable();},
      onDidChangeActiveTextEditor:()=>disposable(),
      onDidChangeTextEditorVisibleRanges(){return disposable();},
      visibleTextEditors:[markdownEditor],
      showTextDocument:async(document,options)=>{showDocumentCalls.push({document,options});return markdownEditor;},
      showInformationMessage:async()=>confirmChoice,showWarningMessage:async()=>{},
      showQuickPick:async items=>items[0],showInputBox:async options=>options?.value??'sbi.new.operation'}
  };
  const compilerProblems=[{
    kind:'compiler-diagnostic',message:'Malformed Procedure YAML',
    code:'YAML_PARSE_ERROR',severity:'error',line:2,column:1,
    uri:'file:///workspace/establish-pdu-session/assurance/procedure.yaml'
  },{
    kind:'compiler-diagnostic',message:'Trusted deployment context is missing',
    code:'BUILD_REQUEST_INVALID',severity:'error',uri:null,
    locationKind:'request',phase:'C_STATIC',path:''
  }];
  let emitCompilerProblems;
  const compilerProblemsProvider={
    getProblems:()=>compilerConnected?compilerProblems:[],
    onDidChange:listener=>{emitCompilerProblems=listener;return disposable();}
  };
  const context={subscriptions:[],extensionUri:uri('/extension')},
    workbench=registerWorkbench(vscode,context,{compilerProblemsProvider}),posted=[];
  workbench.attach(doc,m=>posted.push(m));
  assert.equal(providers.size,3);
  const problems=providers.get('skillStudio.problems');
  const compilerProblem=problems.getChildren().flatMap(item=>item.children??[])
    .find(item=>item.kind==='compiler-diagnostic');
  assert.ok(compilerProblem,'Compiler diagnostics are projected into the native Skill Studio Problems view');
  assert.equal(compilerProblem.code,'YAML_PARSE_ERROR');
  assert.equal(compilerProblem.severity,'error');
  assert.equal(problems.getTreeItem(compilerProblem).command.command,
    'skillStudio.revealCompilerDiagnostic',
    'Compiler Problems navigate to the exact source file through the Compiler reveal command');
  const requestProblem=problems.getChildren().flatMap(item=>item.children??[])
    .find(item=>item.code==='BUILD_REQUEST_INVALID');
  assert.ok(requestProblem,'Compiler request diagnostics remain visible without source spans');
  const requestTree=problems.getTreeItem(requestProblem);
  assert.equal(requestTree.command,undefined,
    'a request-level Compiler diagnostic must never navigate to an arbitrary Procedure');
  assert.match(requestTree.tooltip,/Location: request/);
  const beforeCompilerRefresh=changes.length;
  emitCompilerProblems?.();
  assert.ok(changes.length>beforeCompilerRefresh,
    'new Compiler diagnostics refresh only through the Problems provider event');
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
  assert.equal(commands.has('skillStudio.previewMarkdownNative'),false,
    'only the user-facing Package Preview command is registered');
  assert.equal(commands.has('skillStudio.previewMarkdown'),false,
    'Studio does not contribute a duplicate Markdown Preview command');
  assert.ok(commands.has('skillStudio.internal.markdownPreviewOpenAcceptance'));
  assert.ok(commands.has('skillStudio.internal.markdownPreviewAcceptance'));
  assert.ok(commands.has('skillStudio.internal.markdownPreviewLiveUpdateAcceptance'));
  assert.ok(commands.has('skillStudio.internal.markdownPreviewSourceStateAcceptance'));
  assert.ok(commands.has('skillStudio.internal.markdownPreviewRevealSourceAcceptance'));
  assert.ok(commands.has('skillStudio.internal.restoreMarkdownPreviewAcceptance'));
  assert.equal(commands.has('skillStudio.internal.nativeMarkdownPreviewAcceptance'),false,
    'native Markdown Preview orchestration was replaced by the shared Studio Preview host');
  assert.equal(commands.has('skillStudio.internal.nativeMarkdownSettingsAcceptance'),false,
    'native Markdown Preview settings are no longer part of the shared Preview host');
  assert.equal(commands.has('skillStudio.internal.nativeMarkdownScrollDiagnosticsAcceptance'),false,
    'synthetic revealRange scroll instrumentation is not shipped in the workbench');
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
  assert.match(providers.get('skillStudio.problems').getChildren()[0].label,/0 errors \/ 2 warnings/,
    JSON.stringify(diagnosticSets.map(([target,items])=>({
      uri:target.path,items:items.map(item=>({code:item.code,message:item.message}))
    }))));
  assert.ok(providers.get('skillStudio.problems').getChildren()
    .flatMap(item=>item.children??[]).every(x=>!x.label.includes('Audit unavailable')));
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
  assert.equal(zipMessage.fileCount,8);
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
  assert.ok(!providers.has('skillStudio.evidence'),
    'standalone Evidence TreeView must be retired');
  const inspectorDataFlowRows=providers.get('skillStudio.inspection').getChildren();
  const dataflow=inspectorDataFlowRows.find(x=>x.kind==='data-flow');
  assert.ok(dataflow,'bounded Package Audit hydrates selected-Node Inspector Data Flow');
  assert.ok(dataflow.children.some(x=>x.label.includes('Consumer ABI')));
  assert.match(dataflow.description,/Runtime NOT_RUN/);
  assert.ok(dataflow.children.some(x=>x.label.includes('Source lineage')));
  const previewOpened=await commands.get(
    'skillStudio.internal.markdownPreviewOpenAcceptance')('establish-pdu-session','SKILL.md');
  assert.equal(previewOpened,markdownUri.toString(),
    'internal acceptance opens the exact native Markdown Source without a public Preview command');
  assert.equal(showDocumentCalls.at(-1).document,markdownDoc);
  assert.equal(showDocumentCalls.at(-1).options.viewColumn,vscode.ViewColumn.One,
    'editable Markdown Source stays in the first editor column');
  assert.equal(showDocumentCalls.at(-1).options.preview,false,
    'Markdown Source is persistent, not a transient preview tab');
  assert.equal(markdownExtensionActivated,false,
    'opening Markdown Source does not activate or open the native Markdown Preview CustomEditor');
  assert.equal(nativeCommands.some(call=>call.id==='vscode.openWith'&&
    call.args[1]==='vscode.markdown.preview.editor'),false,
    'the shared right-side Preview must not invoke the native Markdown Preview CustomEditor');

  // The v1alpha5 Example must keep showing deterministic local and NOT_CHECKED
  // Package diagnostics while the Compiler provider is disconnected.
  v1alpha5Mode=true;
  compilerConnected=false;
  doc.text=readFileSync(v1SampleRoot+'establish-pdu-session/assurance/procedure.yaml','utf8');
  doc.version++;changed({document:doc});
  contractDoc.text=readFileSync(v1SampleRoot+'establish-pdu-session/assurance/contract.yaml','utf8');
  contractDoc.version++;
  predicatesDoc.text=readFileSync(v1SampleRoot+'establish-pdu-session/assurance/predicates.yaml','utf8');
  predicatesDoc.version++;
  await commands.get('skillStudio.auditPackage')();
  const problemRoots=providers.get('skillStudio.problems').getChildren();
  const packageProblems=problemRoots.flatMap(item=>item.children??[])
    .filter(item=>item.kind==='package-diagnostic');
  const capabilityProblem=packageProblems.find(item=>
    item.kind==='package-diagnostic'&&item.code==='CAPABILITY_GRANT_NOT_CHECKED'&&
    item.message.includes('namf-communication-n1n2-transfer'));
  assert.ok(capabilityProblem,
    'Capability Grant is a visible Problem without Compiler integration');
  assert.equal(capabilityProblem.status,'not_checked');
  assert.equal(capabilityProblem.domain,'capabilities');
  assert.ok(packageProblems.length>10,
    'the default Example exposes multiple real dependency and trust-boundary blockers');
  const dependencyProblem=packageProblems.find(item=>
    item.kind==='package-diagnostic'&&item.code==='DEPENDENCY_NOT_CONFIGURED');
  assert.ok(dependencyProblem,'unconfigured Contract dependencies are confirmed Problems');
  const dependencyTreeItem=providers.get('skillStudio.problems').getTreeItem(dependencyProblem);
  assert.equal(dependencyTreeItem.iconPath.id,'error');
  const dependencyMarkerSet=diagnosticSets.find(([target,items])=>
    target.path===dependencyProblem.uri.path&&items.some(item=>item.code==='DEPENDENCY_NOT_CONFIGURED'));
  assert.ok(dependencyMarkerSet,'confirmed dependency errors also have editor markers');
  assert.equal(dependencyMarkerSet[1].find(item=>item.code==='DEPENDENCY_NOT_CONFIGURED').severity,
    vscode.DiagnosticSeverity.Error);
  assert.ok(packageProblems.some(item=>item.code==='EVIDENCE_GUARANTEE_NOT_CHECKED'));
  assert.ok(packageProblems.some(item=>item.code==='DEPENDENCY_NOT_CONFIGURED'));
  assert.ok(!problemRoots.some(item=>item.kind==='problem-group'&&item.label==='Compiler'),
    'Compiler disconnection does not prevent independent Package diagnostics');
  assert.match(problemRoots[0].label,/NOT_CHECKED/);
  assert.ok(problemRoots.some(item=>item.kind==='problem-group'&&item.label==='Capabilities'));
  assert.ok(problemRoots.some(item=>item.kind==='problem-group'&&item.label==='Dependencies'));
  const capabilityGroup=problemRoots.find(item=>
    item.kind==='problem-group'&&item.label==='Capabilities');
  const capabilityGroupTreeItem=providers.get('skillStudio.problems').getTreeItem(capabilityGroup);
  assert.equal(capabilityGroupTreeItem.collapsibleState,vscode.TreeItemCollapsibleState.Collapsed);
  assert.match(capabilityGroupTreeItem.description,/NOT_CHECKED/);

  const expectedCapabilityLine=contractDoc.text.split('\n').findIndex(line=>
    line.includes('namf-communication-n1n2-transfer'))+1;
  assert.equal(capabilityProblem.line,expectedCapabilityLine);
  const markerSet=diagnosticSets.find(([target,items])=>
    target.path===contractUri.path&&items.some(item=>
      item.code==='CAPABILITY_GRANT_NOT_CHECKED'&&
      item.message.includes('namf-communication-n1n2-transfer')));
  assert.ok(markerSet,'Capability Grant also appears in the editor DiagnosticCollection');
  const capabilityMarker=markerSet[1].find(item=>
    item.code==='CAPABILITY_GRANT_NOT_CHECKED'&&
    item.message.includes('namf-communication-n1n2-transfer'));
  assert.equal(capabilityMarker.severity,vscode.DiagnosticSeverity.Warning);
  assert.equal(capabilityMarker.range.start.line,expectedCapabilityLine-1);

  const capabilityTreeItem=providers.get('skillStudio.problems').getTreeItem(capabilityProblem);
  assert.equal(capabilityTreeItem.contextValue,'skillStudio.packageDiagnostic');
  assert.equal(capabilityTreeItem.iconPath.id,'warning');
  assert.equal(capabilityTreeItem.command.command,'skillStudio.revealInspection');
  await commands.get(capabilityTreeItem.command.command)(...capabilityTreeItem.command.arguments);
  const sourceOpen=nativeCommands.filter(call=>call.id==='vscode.openWith').at(-1);
  assert.equal(sourceOpen.args[0].path,contractUri.path,
    'clicking the Capability Problem opens the owning Contract file');
  assert.equal(sourceOpen.args[2].selection.start.line,expectedCapabilityLine-1,
    'Problem navigation selects the exact Capability Grant source line');
  const acceptance=await commands.get('skillStudio.internal.semanticTokenDiagnostics')();
  assert.match(acceptance.registrationError,
    /simulated semantic-token provider registration failure/,
    "a semantic-token host API failure must be reported without aborting workbench activation");
  assert.ok(acceptance.packageAudit.problems.some(item=>
    item.code==='CAPABILITY_GRANT_NOT_CHECKED'&&item.line===expectedCapabilityLine));
  assert.ok(acceptance.packageAudit.editorMarkers.some(item=>
    item.code==='CAPABILITY_GRANT_NOT_CHECKED'&&item.line===expectedCapabilityLine));

  // The accepted diagnostics must immediately become stale on filesystem and
  // project lock changes, without any Compiler request.
  const currentRoot='/workspace/establish-pdu-session/';
  const outsider=uri('/workspace/establish-pdu-session-backup/assurance/contract.yaml');
  const pending=()=>problems.getChildren()[0].label==='Package Audit · pending';
  const assertMarkersRestored=async()=>{
    await commands.get('skillStudio.auditPackage')();
    assert.ok(diagnosticSets.some(([target,items])=>
      target.path===contractUri.path&&items.some(item=>item.code==='CAPABILITY_GRANT_NOT_CHECKED')));
  };
  workspaceEvents.create({files:[outsider]});
  assert.ok(!pending(),'changes to a sibling Package must not invalidate current Problems');
  changed({document:{uri:outsider}});
  assert.ok(!pending(),'unrelated TextDocuments do not invalidate the selected Package');
  workspaceEvents.create({files:[uri(currentRoot+'schemas/new.schema.yaml')]});
  assert.equal(diagnosticSets.length,0,'new files clear accepted editor markers immediately');
  assert.ok(pending(),'new Package files invalidate audit status');
  await assertMarkersRestored();
  workspaceEvents.delete({files:[uri(currentRoot+'scripts/validate-subscription-request.py')]});
  assert.ok(pending(),'deleted Package files invalidate accepted diagnostics');
  await assertMarkersRestored();
  workspaceEvents.rename({files:[{
    oldUri:outsider,newUri:uri(currentRoot+'scripts/renamed.py')
  }]});
  assert.ok(pending(),'renames into the Package invalidate current diagnostics');
  await assertMarkersRestored();
  workspaceEvents.configuration({
    affectsConfiguration:section=>section==='editor.fontSize'
  });
  assert.ok(!pending(),'unrelated settings changes must not clear Package diagnostics');
  workspaceEvents.configuration({
    affectsConfiguration:section=>section==='connectionAgent.skillStudio'
  });
  assert.equal(diagnosticSets.length,0,'dependency settings changes clear old editor markers');
  assert.ok(pending(),'project dependency updates trigger a new Package audit');
  await assertMarkersRestored();

  for(const sub of context.subscriptions)sub.dispose();
  assert.ok(changes.length>3);
});
