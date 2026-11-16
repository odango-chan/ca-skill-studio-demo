import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isSkillSchema,localSchemaReference,registerSchemaEditor}
  from '../experiments/ide-host/vscode/src/schema-editor.mjs';

const source=readFileSync(new URL(
  '../site/samples/packages/establish-pdu-session/schemas/establishment-request.schema.yaml',
  import.meta.url),'utf8');

function mock() {
  const providers=new Map(),commands=new Map(),sent=[];
  let changed,received,dispose;
  const schemaUri={path:'/workspace/establish-pdu-session/schemas/establishment-request.schema.yaml',
    toString(){return 'file://'+this.path;},
    with({path}){return {...this,path,toString(){return 'file://'+path;}};}};
  const document={uri:schemaUri,version:1,lineCount:source.split('\n').length,
    getText(){return text;}};
  let text=source;
  const vscode={
    window:{
      registerCustomEditorProvider(view,p,opts) {
        providers.set(view,{p,opts});return {dispose(){}};
      },
      visibleTextEditors:[],
      async showWarningMessage() {},
    },
    commands:{registerCommand(n,fn){commands.set(n,fn);return {dispose(){}};}},
    workspace:{
      onDidChangeTextDocument(fn){changed=fn;return {dispose(){}};},
      async openTextDocument(uri){return document;}
    }
  };
  const panel={webview:{
    html:'',options:null,
    onDidReceiveMessage(fn){received=fn;return {dispose(){}};},
    postMessage(message){sent.push(message);return Promise.resolve(true);}
  },onDidDispose(fn){dispose=fn;}};
  return {vscode,providers,commands,document,panel,sent,
    change(next){text=next;document.version++;changed({document});},
    async receive(msg){await received(msg);await new Promise(resolve=>setImmediate(resolve));},
    dispose(){dispose();}};
}

test('C3 registers a separate schema editor without stealing unrelated YAML files',()=>{
  assert.equal(isSkillSchema('/skill/schemas/request.schema.yaml'),true);
  assert.equal(isSkillSchema('/skill/schemas/other/nested.schema.yaml'),true);
  assert.equal(isSkillSchema('/skill/assurance/contract.yaml'),false);
  assert.equal(isSkillSchema('/skill/assurance/procedure.yaml'),false);
  assert.equal(isSkillSchema('/skill/schemas/data.yaml'),false);
});

test('C3 local reference policy refuses remote, traversal and unsafe schemes',()=>{
  const uri={path:'/skill/schemas/input.schema.yaml',
    with({path}){return {path};}};
  assert.equal(localSchemaReference(uri,'#/$defs/item').pointer,'#/$defs/item');
  const sibling=localSchemaReference(uri,'common.schema.yaml#/$defs/triState');
  assert.equal(sibling.uri.path,'/skill/schemas/common.schema.yaml');
  assert.equal(sibling.pointer,'#/$defs/triState');
  for(const bad of [
    'https://example.com/spec','#not-pointer','../secret.schema.yaml',
    '/root.schema.yaml','registry://schemas/foo.schema.yaml',
    'nested/foo.schema.yaml','foo.schema.yaml#anchor',
    'file:///etc/passwd','foo.schema.yaml?x=1'
  ]) assert.equal(localSchemaReference(uri,bad),null,bad);
});

test('C3 custom editor presents read-only source-backed state, refresh and version guard',async()=>{
  const m=mock(),context={subscriptions:[]};
  registerSchemaEditor(m.vscode,context);
  assert.ok(m.providers.has('skillStudio.schemaPreview'));
  assert.ok(m.commands.has('skillStudio.openSchema'));
  const {p,opts}=m.providers.get('skillStudio.schemaPreview');
  assert.equal(opts.webviewOptions.retainContextWhenHidden,true);
  await p.resolveCustomTextEditor(m.document,m.panel);
  assert.equal(m.panel.webview.options.enableScripts,true);
  assert.deepEqual(m.panel.webview.options.localResourceRoots,[]);
  assert.match(m.panel.webview.html,/SKILL Schema Visual/);
  assert.match(m.panel.webview.html,/Content-Security-Policy/);
  assert.doesNotMatch(m.panel.webview.html,/unsafe-inline|https?:\/\//);
  await m.receive({type:'ready'});
  assert.equal(m.sent.at(-1).projection.state,'READY');
  assert.equal(m.sent.at(-1).projection.title,'EstablishmentRequest');
  const changed=source.replace('maximum: 15','maximum: 14');
  m.change(changed);
  await new Promise(resolve=>setImmediate(resolve));
  const current=m.sent.at(-1);
  assert.equal(current.version,2);
  assert.equal(current.projection.tree.children.find(x=>x.name==='pduSessionId')
    .constraints.find(x=>x.key==='maximum').value,14);
  await m.receive({type:'revealLine',version:1,value:10});
  assert.ok(m.sent.some(x=>x.type==='error'&&x.message.includes('Source 已变化')));
  m.dispose();
});
