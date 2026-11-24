import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDependencyIntegration}
  from '../experiments/ide-host/vscode/src/dependency-integration.mjs';

function fixture(){
  const commands=new Map(),providers=new Map();
  let definitions;
  class EventEmitter{
    event=()=>({dispose(){}});
    fire(){}
    dispose(){}
  }
  class TreeItem{
    constructor(label,collapsibleState){this.label=label;this.collapsibleState=collapsibleState;}
  }
  class ThemeIcon{constructor(id){this.id=id;}}
  class Position{constructor(line,character){this.line=line;this.character=character;}}
  class Location{constructor(uri,position){this.uri=uri;this.position=position;}}
  const uriFrom=({scheme,path})=>({
    scheme,path,
    with({path:next}){return uriFrom({scheme,path:next});},
    toString(){return scheme+':'+path;}
  });
  const vscode={
    EventEmitter,TreeItem,ThemeIcon,Position,Location,
    TreeItemCollapsibleState:{None:0,Collapsed:1},
    Uri:{from:uriFrom},
    languages:{
      registerDefinitionProvider(selectors,provider){
        definitions={selectors,provider};return {dispose(){}};
      }
    },
    workspace:{
      workspaceFolders:[],
      onDidChangeConfiguration(){return {dispose(){}};},
      onDidChangeWorkspaceFolders(){return {dispose(){}};},
      registerTextDocumentContentProvider(scheme,provider){
        providers.set(scheme,provider);return {dispose(){}};
      },
      async openTextDocument(uri){
        const text=providers.get(uri.scheme).provideTextDocumentContent(uri);
        return {uri,version:1,languageId:'json',
          getText(){return text;},
          lineAt(i){return {text:text.split('\n')[i]};}};
      }
    },
    commands:{registerCommand(name,fn){commands.set(name,fn);return {dispose(){}};}},
    window:{async showErrorMessage(){}}
  };
  const context={subscriptions:[]};
  const integration=registerDependencyIntegration(vscode,context);
  const snapshot={id:'network',kind:'interface-package',
    snapshotDigest:'sha256:'+'c'.repeat(64),files:[]};
  return {vscode,commands,providers,definitions:()=>definitions,integration,snapshot};
}
test('imported exports render as read-only Package Explorer rows',async()=>{
  const m=fixture();
  const dep={id:'network',kind:'interface-package',source:{type:'interface-zip'}};
  const exported={kind:'interface-export',id:'urn:test:input',
    exportKind:'Schema',dependency:dep,path:'schemas/input.schema.json'};
  const item=m.integration.provider.getTreeItem(exported);
  assert.equal(item.command.command,'skillStudio.openInterfaceExport');
  assert.deepEqual(item.command.arguments,['network','schemas/input.schema.json']);
  assert.match(item.tooltip,/Read-only/);
  assert.match(item.tooltip,/NOT_CHECKED/);
  assert.ok(m.commands.has('skillStudio.openInterfaceExport'));
  assert.ok(m.providers.has('skill-studio-dependency'));
  assert.equal(m.definitions().selectors.length,2);
});
test('imported Schema Ctrl+Click resolves exact sibling in locked virtual source',async()=>{
  const m=fixture();
  const primary=JSON.stringify({
    $schema:'https://json-schema.org/draft/2020-12/schema',
    type:'object',properties:{item:{$ref:'peer.schema.json#/$defs/Thing'}}
  },null,2);
  const sibling=JSON.stringify({
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $defs:{Thing:{type:'string'}}
  },null,2);
  const source=m.integration.prepareToolCatalog(m.snapshot,'schemas/input.schema.json',primary);
  const target=m.integration.prepareToolCatalog(m.snapshot,'schemas/peer.schema.json',sibling);
  const doc=await m.vscode.workspace.openTextDocument(source);
  const lines=primary.split('\n');
  const line=lines.findIndex(x=>x.includes('peer.schema.json'));
  const position=new m.vscode.Position(line,lines[line].indexOf('peer.schema.json')+3);
  const result=await m.definitions().provider.provideDefinition(doc,position);
  assert.equal(result.uri.path,target.path);
  assert.ok(result.position.line>=0);
  const elsewhere=await m.definitions().provider.provideDefinition(doc,new m.vscode.Position(0,0));
  assert.equal(elsewhere,null);
});
