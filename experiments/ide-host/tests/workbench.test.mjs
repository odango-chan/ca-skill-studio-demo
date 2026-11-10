import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectionSnapshot} from '../vscode/src/inspection.mjs';
import {registerWorkbench} from '../vscode/src/workbench.mjs';
import {deleteNodeOptions,previewNodeDelete} from '../../../site/node-delete.mjs';
const root='site/samples/packages/establish-pdu-session/';
const source=readFileSync(root+'assurance/procedure.yaml','utf8');
test('Inspection preserves Classic node/phase/route source identity; unknown syntax fails closed',()=>{
  const result=inspectionSnapshot(source,{procedureId:'establish-session',nodeId:'nudm-sdm-subscribe'});
  assert.equal(result.model.state,'READY');
  assert.equal(result.outline.length,5);
  const proc=[...result.model.procedures.values()].find(p=>p.nodes.some(n=>n.id==='nudm-sdm-subscribe'));
  const selected=inspectionSnapshot(source,{procedureId:proc.name,nodeId:'nudm-sdm-subscribe'});
  assert.ok(selected.inspection.some(x=>x.label==='preconditions'&&x.children.length===5));
  assert.ok(selected.evidence.some(x=>x.label.includes('Runtime NOT_RUN')));
  assert.ok(selected.inspection.every(x=>x.line>0));
  const invalid=inspectionSnapshot('procedures: [invalid]');
  assert.equal(invalid.model.state,'UNAVAILABLE');assert.equal(invalid.outline.length,0);assert.ok(invalid.problems.length);
});

test('Native views track unsaved Source, audit Classic package, reject stale selection and dispose listeners',async()=>{
  const commands=new Map(),providers=new Map(),changes=[],panels=[],diagnosticSets=[],appliedEdits=[];
  const disposable=()=>({dispose(){}});
  let confirmChoice='确认并应用';
  function uri(path){return {path,toString(){return 'file://'+path;},with(change){return uri(change.path);}};}
  const file=uri('/workspace/establish-pdu-session/assurance/procedure.yaml');
  const doc={uri:file,version:1,text:source,getText(){return this.text;},positionAt(offset){return {offset};},get lineCount(){return this.text.split('\n').length;}};
  let changed;
  const vscode={
    EventEmitter:class {event=()=>disposable();fire(){changes.push(1);}dispose(){}},
    TreeItem:class {constructor(label,state){this.label=label;this.collapsibleState=state;}},
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    Range:class {constructor(start,end){this.start=start;this.end=end;}},
    WorkspaceEdit:class {constructor(){this.changes=[];}replace(uri,range,value){this.changes.push({uri,range,value});}},
    Diagnostic:class {constructor(range,message,severity){Object.assign(this,{range,message,severity});}},DiagnosticSeverity:{Warning:1},
    RelativePattern:class {constructor(base,pattern){Object.assign(this,{base,pattern});}},
    ViewColumn:{Beside:2},
    languages:{createDiagnosticCollection:()=>({clear(){diagnosticSets.length=0;},set(...args){diagnosticSets.push(args);},dispose(){}})},
    commands:{executeCommand:async()=>{},registerCommand(name,cb){commands.set(name,cb);return disposable();}},
    workspace:{textDocuments:[doc],
      findFiles:async()=>['assurance/procedure.yaml','assurance/contract.yaml','assurance/predicates.yaml','SKILL.md'].map(p=>uri('/workspace/establish-pdu-session/'+p)),
      fs:{readFile:async u=>new TextEncoder().encode(readFileSync(root+u.path.split('establish-pdu-session/')[1],'utf8'))},
      async applyEdit(edit){
        appliedEdits.push([...edit.changes]);
        for(const change of [...edit.changes].sort((a,b)=>b.range.start.offset-a.range.start.offset))
          doc.text=doc.text.slice(0,change.range.start.offset)+change.value+doc.text.slice(change.range.end.offset);
        doc.version++;changed({document:doc});return true;
      },
      onDidChangeTextDocument(cb){changed=cb;return disposable();},openTextDocument:async()=>doc},
    window:{registerTreeDataProvider(id,p){providers.set(id,p);return disposable();},
      onDidChangeActiveTextEditor:()=>disposable(),showTextDocument:async()=>{},
      showInformationMessage:async()=>confirmChoice,showWarningMessage:async()=>{},
      showQuickPick:async items=>items[0],showInputBox:async options=>options?.value??'sbi.new.operation',
      createWebviewPanel(){const p={webview:{html:''},onDidDispose:()=>disposable()};panels.push(p);return p;}}
  };
  const context={subscriptions:[]},workbench=registerWorkbench(vscode,context),posted=[];
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

  // Exercise the named Verify lifecycle using the same native Inspector command:
  // name a plain Verify, swap the now-named Verify with its adjacent predecessor,
  // then delete it only because the closed-world report proves zero consumers.
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const namedVerifyPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const namedVerifyPhaseItem=providers.get('skillStudio.inspection').getTreeItem(namedVerifyPhase);
  assert.equal(await commands.get('skillStudio.addPhaseVerify')(namedVerifyPhaseItem,verifyPredicate),true);
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const appendedNamedVerifyPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const unnamedVerify=appendedNamedVerifyPhase.children.find(x=>x.stepIndex===5);
  const unnamedVerifyItem=providers.get('skillStudio.inspection').getTreeItem(unnamedVerify);
  assert.equal(unnamedVerifyItem.contextValue,'skillStudio.verifyStep');
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(unnamedVerifyItem,
    {action:'name',newName:'resource-ready-check'}),true);
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const namedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const namedVerify=namedPhase.children.find(x=>x.stepName==='resource-ready-check');
  const namedVerifyItem=providers.get('skillStudio.inspection').getTreeItem(namedVerify);
  assert.equal(namedVerifyItem.contextValue,'skillStudio.namedVerifyStep');
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(namedVerifyItem,'move-up'),true);
  workbench.select(doc,{version:doc.version,procedureId:phaseProcedure,nodeId:phaseNode});
  const swappedPhase=providers.get('skillStudio.inspection').getChildren()
    .find(x=>x.kind==='phase'&&x.phaseName==='preconditions');
  const swappedVerify=swappedPhase.children.find(x=>x.stepName==='resource-ready-check');
  const swappedVerifyItem=providers.get('skillStudio.inspection').getTreeItem(swappedVerify);
  assert.equal(await commands.get('skillStudio.editPhaseVerifyStep')(swappedVerifyItem,'delete'),true);
  assert.equal(doc.text,source,'named Verify name/swap/delete round-trip restores exact Source');
  assert.ok(commands.has('skillStudio.insertNode'));
  assert.ok(commands.has('skillStudio.deleteNode'));
  doc.text=source;doc.version++;changed({document:doc});
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
  doc.text='# Preview title\n<script>alert(1)</script>';
  await commands.get('skillStudio.previewMarkdown')(uri('/workspace/SKILL.md'));
  assert.match(panels[0].webview.html,/Content-Security-Policy/);
  assert.match(panels[0].webview.html,/<h1>Preview title<\/h1>/);
  assert.match(panels[0].webview.html,/&lt;script&gt;/);
  doc.text='x'.repeat(300001);changed({document:{...doc,uri:uri('/workspace/SKILL.md')}});
  assert.match(panels[0].webview.html,/预览不可用/);
  assert.doesNotMatch(panels[0].webview.html,/<script/i);
  for(const sub of context.subscriptions)sub.dispose();
  assert.ok(changes.length>3);
});
