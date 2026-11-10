import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPackageInventory,packageFileCommand,packageScanRoots,registerPackageOverview}
  from '../experiments/ide-host/vscode/src/package-overview.mjs';

function uri(path) {
  return {
    path,
    toString(){return 'file://'+path;},
    with({path:next}){return uri(next);}
  };
}
const files=[
  '/workspace/skills/establish-pdu-session/SKILL.md',
  '/workspace/skills/establish-pdu-session/assurance/contract.yaml',
  '/workspace/skills/establish-pdu-session/assurance/procedure.yaml',
  '/workspace/skills/establish-pdu-session/assurance/predicates.yaml',
  '/workspace/skills/establish-pdu-session/schemas/request.schema.yaml',
  '/workspace/skills/establish-pdu-session/scripts/evaluate.py',
  '/workspace/skills/establish-pdu-session/references/3gpp.md',
  '/workspace/skills/establish-pdu-session/README.md',
  '/workspace/skills/establish-pdu-session-mas/SKILL.md',
  '/workspace/skills/establish-pdu-session-mas/assurance/procedure.yaml',
  '/workspace/skills/establish-pdu-session-mas/schemas/request.schema.yaml',
  '/workspace/skills/establish-pdu-session-mas/scripts/execute.py',
  '/workspace/skills/establish-pdu-session-mas/nested/SKILL.md',
  '/workspace/skills/establish-pdu-session-mas/nested/assurance/procedure.yaml',
  '/workspace/skills/establish-pdu-session-mas/nested/assurance/contract.yaml',
  '/workspace/skills/establish-pdu-session-mas/nested/assurance/predicates.yaml',
  '/workspace/skills/establish-pdu-session/node_modules/ignored/index.js',
  '/workspace/skills/establish-pdu-session/.git/config'
].map(uri);

test('C4 recovers the Skills/workspaces container from an open OPFS document without workspaceFolders',()=>{
  const active=uri('/workspace/workspaces/establish-pdu-session/assurance/procedure.yaml');
  const roots=packageScanRoots([], [{uri:active}]);
  assert.equal(roots.length,1);
  assert.equal(roots[0].path,'/workspace/workspaces');
  const sibling=uri('/workspace/skills/establish-pdu-session-mas/scripts/run.py');
  const siblingRoots=packageScanRoots([], [{uri:sibling}]);
  assert.equal(siblingRoots[0].path,'/workspace/skills');
});

test('C4 discovers multiple SKILL roots in one Workspace and groups real files',()=>{
  const dirty=new Set([
    '/workspace/skills/establish-pdu-session/scripts/evaluate.py',
    '/workspace/skills/establish-pdu-session-mas/assurance/procedure.yaml'
  ]);
  const inventory=buildPackageInventory(files,dirty);
  assert.equal(inventory.truncated,false);
  assert.equal(inventory.packages.length,3);
  const main=inventory.packages.find(p=>p.name==='establish-pdu-session');
  const mas=inventory.packages.find(p=>p.name==='establish-pdu-session-mas'&&
    p.rootPath.endsWith('/establish-pdu-session-mas'));
  const nested=inventory.packages.find(p=>p.rootPath.endsWith('/establish-pdu-session-mas/nested'));
  assert.ok(main&&mas&&nested);
  assert.equal(main.corePresent,3);
  assert.equal(main.incomplete,false);
  assert.equal(main.fileCount,8);
  assert.equal(main.dirtyCount,1);
  assert.deepEqual(main.groups.map(g=>g.key),
    ['definition','assurance','schemas','scripts','references','other']);
  assert.equal(main.groups.find(g=>g.key==='schemas').files[0].path,
    'schemas/request.schema.yaml');
  assert.equal(mas.corePresent,1);
  assert.equal(mas.incomplete,true);
  assert.equal(mas.dirtyCount,1);
  assert.deepEqual(mas.missingCore,
    ['assurance/contract.yaml','assurance/predicates.yaml']);
  assert.equal(nested.corePresent,3);
  assert.equal(nested.fileCount,4);
  assert.equal(main.files.some(f=>f.path.includes('node_modules')),false);
  assert.equal(main.files.some(f=>f.path.includes('.git')),false);
});

test('C4 keeps incomplete packages visible when only assurance markers exist',()=>{
  const inventory=buildPackageInventory([
    uri('/workspace/partial/assurance/contract.yaml'),
    uri('/workspace/partial/assurance/procedure.yaml')
  ]);
  assert.equal(inventory.packages.length,1);
  const pkg=inventory.packages[0];
  assert.equal(pkg.hasSkillMd,false);
  assert.equal(pkg.corePresent,2);
  assert.equal(pkg.incomplete,true);
  assert.ok(pkg.groups.find(g=>g.key==='definition').missing.includes('SKILL.md'));
  assert.ok(pkg.groups.find(g=>g.key==='assurance').missing.includes(
    'assurance/predicates.yaml'));
});

test('C4 uses exact file-kind Designer commands and native Source for other files',()=>{
  const file=uri('/workspace/skill/schemas/request.schema.yaml');
  assert.equal(packageFileCommand('assurance/procedure.yaml',file).command,
    'skillStudio.openProcedure');
  assert.equal(packageFileCommand('assurance/contract.yaml',file).command,
    'skillStudio.openContract');
  assert.equal(packageFileCommand('assurance/predicates.yaml',file).command,
    'skillStudio.openPredicates');
  assert.equal(packageFileCommand('schemas/request.schema.yaml',file).command,
    'skillStudio.openSchema');
  assert.equal(packageFileCommand('scripts/evaluate.py',file).command,'vscode.open');
  assert.equal(packageFileCommand('references/3gpp.md',file).command,'vscode.open');
  assert.deepEqual(packageFileCommand('assurance/contract.yaml',file).arguments,[file]);
});

test('C4 reports bounded inventory instead of implying a complete scan',()=>{
  const result=buildPackageInventory(files,new Set(),true);
  assert.equal(result.truncated,true);
  assert.ok(result.scannedFiles>0);
});

test('C4 registers Packages view and renders package tree with source actions',async()=>{
  const treeProviders=new Map(),treeViews=new Map(),commands=new Map();
  class Emitter {
    constructor(){this.event=()=>{};}
    fire(){}
    dispose(){}
  }
  class Item {
    constructor(label,state){this.label=label;this.collapsibleState=state;}
  }
  class Icon {constructor(id){this.id=id;}}
  class RelativePattern {
    constructor(base,pattern){this.baseUri=base;this.pattern=pattern;}
  }
  const noop=()=>({dispose(){}});
  const workspace={
    workspaceFolders:[],
    textDocuments:[
      {uri:uri('/workspace/skills/establish-pdu-session/scripts/evaluate.py'),isDirty:true}
    ],
    async findFiles(){return files;},
    asRelativePath(value){return value.path;},
    onDidChangeWorkspaceFolders:noop
  };
  const vscode={
    EventEmitter:Emitter,TreeItem:Item,ThemeIcon:Icon,RelativePattern,
    TreeItemCollapsibleState:{Collapsed:1,None:0},
    workspace,window:{
      createTreeView(id,options){
        treeViews.set(id,options);treeProviders.set(id,options.treeDataProvider);
        return {dispose(){}};
      }
    },
    commands:{
      registerCommand(id,fn){commands.set(id,fn);return {dispose(){}};}
    }
  };
  const context={subscriptions:[]};
  const activeProcedure={uri:uri('/workspace/skills/establish-pdu-session/assurance/procedure.yaml'),isDirty:false};
  registerPackageOverview(vscode,context,()=>activeProcedure);
  const refresh=commands.get('skillStudio.refreshPackages');
  assert.equal(typeof refresh,'function');
  await refresh();
  const provider=treeProviders.get('skillStudio.packages');
  assert.ok(provider);
  assert.equal(treeViews.get('skillStudio.packages').showCollapseAll,true);
  assert.equal(treeViews.get('skillStudio.packages').treeDataProvider,provider);
  const roots=provider.getChildren();
  assert.equal(roots[0].label,'3 SKILL Packages');
  const pkg=roots.find(x=>x.kind==='package'&&x.name==='establish-pdu-session');
  assert.ok(pkg);
  assert.match(pkg.description,/3\/3 core/);
  assert.match(pkg.description,/1 modified/);
  const groups=provider.getChildren(pkg);
  const schemas=groups.find(x=>x.key==='schemas');
  const schemaFiles=provider.getChildren(schemas);
  assert.equal(schemaFiles[0].label,'request.schema.yaml');
  assert.equal(schemaFiles[0].command.command,'skillStudio.openSchema');
  const treeItem=provider.getTreeItem(pkg);
  assert.equal(treeItem.label,'establish-pdu-session');
  assert.equal(treeItem.collapsibleState,1);
});
