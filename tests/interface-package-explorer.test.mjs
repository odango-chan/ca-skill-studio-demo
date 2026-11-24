import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDependencyIntegration}
  from '../experiments/ide-host/vscode/src/dependency-integration.mjs';
import {zipPackage} from '../site/zip.mjs';
import {sha256} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {resolveLockedDependencies}
  from '../experiments/ide-host/vscode/src/dependency-service.mjs';
import {projectLockedInterfaceCompletionHints}
  from '../experiments/ide-host/vscode/src/interface-schema-completion.mjs';

function fixture({workspace=false}={}){
  const commands=new Map(),providers=new Map();
  const files=new Map(),dirs=new Set(['/workspace']);
  const settings={skillsRoot:'skills',dependencies:[],
    dependencyLock:{version:'skillc.lock/v0.1',entries:[]}};
  const errors=[],shown=[],previewCalls=[];
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
        return {uri,version:1,languageId:workspace?'plaintext':'json',
          getText(){return text;},
          lineAt(i){return {text:text.split('\n')[i]};}};
      }
    },
    commands:{registerCommand(name,fn){commands.set(name,fn);return {dispose(){}};}},
    window:{async showErrorMessage(){}}
  };
  if(workspace){
    const root=uriFrom({scheme:'file',path:'/workspace'});
    vscode.Uri.joinPath=(uri,...segments)=>uriFrom({
      scheme:uri.scheme,path:[uri.path,...segments].join('/')
    });
    vscode.ViewColumn={One:1};
    vscode.ConfigurationTarget={WorkspaceFolder:6};
    vscode.workspace.workspaceFolders=[{uri:root,name:'test-project'}];
    vscode.workspace.getConfiguration=()=>({
      get:(name,fallback)=>settings[name]??fallback,
      async update(name,value,target){
        assert.equal(target,6);
        settings[name]=value;
      }
    });
    const missing=()=>Object.assign(Error('missing'),{code:'FileNotFound'});
    vscode.workspace.fs={
      async stat(uri){
        if(files.has(uri.path)||dirs.has(uri.path))return {type:1};
        throw missing();
      },
      async createDirectory(uri){dirs.add(uri.path);},
      async readFile(uri){
        if(!files.has(uri.path))throw missing();
        return new Uint8Array(files.get(uri.path));
      },
      async writeFile(uri,bytes){files.set(uri.path,new Uint8Array(bytes));},
      async rename(from,to,{overwrite}={}){
        assert.equal(overwrite,false);
        if([...files.keys()].some(k=>k.startsWith(to.path+'/')))
          throw Error('snapshot destination already exists');
        for(const [key,bytes] of [...files]){
          if(key.startsWith(from.path+'/')){
            files.delete(key);files.set(to.path+key.slice(from.path.length),bytes);
          }
        }
        for(const dir of [...dirs]){
          if(dir===from.path||dir.startsWith(from.path+'/')){
            dirs.delete(dir);dirs.add(to.path+dir.slice(from.path.length));
          }
        }
      },
      async delete(uri){
        for(const key of [...files.keys()])
          if(key.startsWith(uri.path+'/'))files.delete(key);
      }
    };
    vscode.window.showQuickPick=async(items)=>items[0];
    vscode.window.showOpenDialog=async()=>[uriFrom({
      scheme:'file',path:'/workspace/official-interface.zip'
    })];
    vscode.window.showInputBox=async()=> 'ca-client';
    vscode.window.showWarningMessage=async(_message,_options,button)=>button;
    vscode.window.showErrorMessage=async message=>{errors.push(message);};
    vscode.window.showTextDocument=async(document,options)=>{
      shown.push({document,options});return {document};
    };
    vscode.languages.setTextDocumentLanguage=async(document,languageId)=>({
      ...document,languageId
    });
    vscode.commands.executeCommand=async(name,...args)=>{
      previewCalls.push({name,args});
      if(commands.has(name))return commands.get(name)(...args);
      return undefined;
    };
  }
  const context={subscriptions:[]};
  const integration=registerDependencyIntegration(vscode,context);
  const snapshot={id:'network',kind:'interface-package',
    snapshotDigest:'sha256:'+'c'.repeat(64),files:[]};
  return {vscode,commands,providers,definitions:()=>definitions,integration,
    snapshot,settings,files,errors,shown,previewCalls};
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


test('native Add Dependency command imports ZIP, locks bytes, opens Schema and serves completion',async()=>{
  const m=fixture({workspace:true}),enc=new TextEncoder();
  const inputId='urn:wtlab:demo:query:v1',outputId='urn:wtlab:demo:response:v1';
  const schema=JSON.stringify({
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:inputId,type:'object',required:['supi'],
    properties:{supi:{type:'string'},pduSessionId:{type:'integer'}}
  });
  const output=JSON.stringify({
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:outputId,type:'object',properties:{status:{type:'string'}}
  });
  const catalog=[
    'apiVersion: connectionagent.io/toolcatalog/v1alpha4',
    'kind: ToolCatalog',
    'metadata:',
    '  owner: wtlab',
    'spec:',
    '  contracts:',
    '    - id: context.smf.session.read',
    '      kind: observation',
    '      effect: READ',
    '      queryContextSchema:',
    '        $ref: '+inputId,
    '      outputSchema:',
    '        $ref: '+outputId,
    '      ownerOutcomes: [SUCCEEDED, FAILED]',
    ''
  ].join('\n');
  const entries=[
    {path:'schemas/query.schema.json',text:schema},
    {path:'schemas/response.schema.json',text:output},
    {path:'tool-catalog.yaml',text:catalog}
  ];
  const meta=await Promise.all(entries.map(async item=>({
    path:item.path,sha256:await sha256(enc.encode(item.text))
  })));
  const manifest={
    apiVersion:'connectionagent.io/interface-package/v1alpha1',
    packageId:'urn:wtlab:demo:interface',version:'1.0.0',
    languageTarget:'connectionagent.io/v1alpha5',publisher:'wtlab',
    files:meta,dependencies:[],
    exports:[
      {kind:'Schema',id:inputId,path:'schemas/query.schema.json'},
      {kind:'Schema',id:outputId,path:'schemas/response.schema.json'},
      {kind:'CallableCatalog',id:'context.smf.session.read',path:'tool-catalog.yaml'}
    ]
  };
  const zip=zipPackage([{path:'package.json',text:JSON.stringify(manifest)},...entries]);
  m.files.set('/workspace/official-interface.zip',zip);
  const result=await m.commands.get('skillStudio.addDependency')();
  assert.equal(m.errors.length,0,JSON.stringify(m.errors));
  assert.equal(result.status,'READY');
  assert.equal(m.settings.dependencies.length,1);
  assert.equal(m.settings.dependencies[0].kind,'interface-package');
  const loaded=await resolveLockedDependencies(m.vscode,
    m.vscode.workspace.workspaceFolders[0].uri);
  assert.equal(loaded.status,'READY');
  const hints=projectLockedInterfaceCompletionHints(loaded.snapshots[0]);
  assert.ok(hints.some(item=>item.id==='ca-client::context.smf.session.read'&&
    item.argumentProperties.some(p=>p.name==='supi'&&p.required)));
  const roots=await m.integration.provider.getChildren();
  assert.equal(roots.length,1);
  assert.match(m.integration.provider.getTreeItem(roots[0]).description,
    /Compiler NOT_LINKED/);
  const children=await m.integration.provider.getChildren(roots[0]);
  const schemas=children.find(node=>node.exportKind==='Schema');
  assert.ok(schemas);
  const exports=await m.integration.provider.getChildren(schemas);
  assert.equal(exports.length,2);
  await m.commands.get('skillStudio.openInterfaceExport')(
    'ca-client','schemas/query.schema.json');
  assert.equal(m.errors.length,0,JSON.stringify(m.errors));
  assert.equal(m.shown.length,1);
  assert.equal(m.shown[0].document.uri.scheme,'skill-studio-dependency');
  assert.equal(m.shown[0].document.languageId,'json');
  assert.equal(m.shown[0].options.viewColumn,1);
  assert.equal(m.previewCalls.some(call=>
    call.name==='skillStudio.showPreview'),true);
  const lockDigest=m.settings.dependencyLock.entries[0].snapshotDigest.slice(7);
  m.files.set('/workspace/.skill-studio/dependencies/'+lockDigest+
    '/schemas/query.schema.json',enc.encode('{}'));
  const tampered=await resolveLockedDependencies(m.vscode,
    m.vscode.workspace.workspaceFolders[0].uri);
  assert.equal(tampered.status,'ERROR');
  const previouslyShown=m.shown.length;
  const refused=await m.commands.get('skillStudio.openInterfaceExport')(
    'ca-client','schemas/query.schema.json');
  assert.equal(refused,null);
  assert.equal(m.shown.length,previouslyShown);
  assert.ok(m.errors.some(message=>message.includes('lock is missing or invalid')));
});
