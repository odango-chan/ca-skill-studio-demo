import {openNativeSource} from './native-source.mjs';
import {openSourceViewPair,forgetSourceViewPair} from './source-view-pair.mjs';
import {projectJsonSchema, resolveSchemaPointer} from '../../../../site/schema-projection.mjs';

export const SCHEMA_VIEW = 'skillStudio.schemaPreview';
const SCHEMA_PATH = /\/schemas\/(?:[^/]+\/)*[^/]+\.schema\.ya?ml$/i;
const LOCAL_FILE = /^[A-Za-z0-9_-]+(?:[._-][A-Za-z0-9_-]+)*\.schema\.ya?ml$/;

function nonce() {
  const bytes = new Uint8Array(20);
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('Secure randomness unavailable; Schema webview refused');
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(n => n.toString(16).padStart(2,'0')).join('');
}
export function isSkillSchema(path) {
  return typeof path === 'string' && SCHEMA_PATH.test(path);
}
export function localSchemaReference(uri, ref) {
  if (typeof ref !== 'string' || ref.length > 2048 ||
      !isSkillSchema(uri?.path)) return null;
  if (ref.startsWith('#'))
    return ref === '#' || ref.startsWith('#/')
      ? {uri, pointer: ref} : null;
  // Only sibling .schema.yaml files within the same schemas directory.
  // Never follow HTTP(S), registry refs, absolute paths, parent paths or schemes.
  const index = ref.indexOf('#');
  const file = index >= 0 ? ref.slice(0,index) : ref;
  const pointer = index >= 0 ? ref.slice(index) : '#';
  if (!LOCAL_FILE.test(file) || !(pointer === '#' || pointer.startsWith('#/')))
    return null;
  const parent = uri.path.slice(0,uri.path.lastIndexOf('/'));
  const target = uri.with({path:parent+'/'+file});
  return {uri:target,pointer};
}
async function reveal(vscode, uri, line) {
  return openSourceViewPair(vscode,uri,{line});
}
async function followReference(vscode, document, projection, sourcePointer) {
  if (projection.state === 'SOURCE_ONLY') return;
  const entry = projection.allRefs.find(x => x.sourcePointer === sourcePointer);
  if (!entry || typeof entry.reference !== 'string') {
    await vscode.window.showWarningMessage('Schema $ref no longer matches current Source.');
    return;
  }
  const target = localSchemaReference(document.uri,entry.reference);
  if (!target) {
    await vscode.window.showWarningMessage(
      'Schema $ref is external or unsafe; only local pointers and sibling schema files can be opened.');
    return;
  }
  const targetDoc = await vscode.workspace.openTextDocument(target.uri);
  const resolved = resolveSchemaPointer(targetDoc.getText(),target.pointer);
  if (!resolved) {
    await vscode.window.showWarningMessage(
      'Schema $ref does not uniquely resolve in the current target Source: '+entry.reference);
    return;
  }
  await reveal(vscode,target.uri,resolved.line);
}
function html(token) {
  const csp = "default-src 'none'; img-src data:; style-src 'nonce-" + token +
    "'; script-src 'nonce-" + token + "'; connect-src 'none';";
  const style = [
    ":root{color-scheme:light;--ink:#29465c;--muted:#72879a;--line:#dce6ec;--paper:#fff;--canvas:#f5f8fb;--teal:#18796e}",
    "*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:13px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--canvas)}",
    "button,input{font:inherit}button{cursor:pointer;border:1px solid #cbdce5;border-radius:7px;padding:5px 9px;background:#fff;color:#31556a}button:hover{background:#edf5f7}button:focus-visible,input:focus-visible{outline:2px solid #5aafa2;outline-offset:2px}",
    "header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:13px 20px;background:#fff;border-bottom:1px solid var(--line)}",
    ".brand{flex:1;min-width:0}.eyebrow{font-size:10px;letter-spacing:.12em;color:var(--teal);font-weight:700}h1{font-size:19px;line-height:1.2;margin:2px 0 0;font-weight:650}",
    ".actions{display:flex;gap:8px;align-items:center}.primary{background:#e9f5f2;border-color:#b9ddd4;color:#176f64;font-weight:600}.status{color:var(--muted);font-size:10px;white-space:nowrap}",
    "main{max-width:1380px;margin:0 auto;padding:16px 20px 26px}.desc{color:var(--muted);font-size:11px;margin:4px 0 12px}.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}",
    "input{border:1px solid #cbdce5;border-radius:6px;padding:7px 10px;min-width:240px;max-width:100%;background:#fff;color:var(--ink)}.pill{font-size:10px;color:#526b7c;background:#f1f6f8;border:1px solid var(--line);padding:4px 7px;border-radius:6px}",
    ".tree{background:var(--paper);border:1px solid var(--line);border-radius:11px;padding:12px}.field{border-left:1px solid #dde9eb;margin-left:11px;padding:4px 0 5px 11px}.field.root{border:0;margin:0;padding:0}",
    ".field>summary{display:flex;align-items:center;gap:9px;list-style:none;cursor:pointer;min-height:31px;border-radius:6px;padding:2px 4px}.field>summary::-webkit-details-marker{display:none}.field>summary:hover{background:#f6fafb}",
    ".arrow{font-size:17px;color:#8b9eac}.field[open]>summary .arrow{transform:rotate(90deg)}.field-name{font-weight:600;overflow-wrap:anywhere}.datatype{font-size:10px;color:#246b70;background:#eaf5f4;border-radius:5px;padding:2px 6px}",
    ".required{font-size:9px;font-weight:700;color:#9a621c;background:#fff4df;border-radius:4px;padding:2px 6px}.line{font-size:10px;padding:2px 6px}.details{margin:4px 0 7px 24px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".chip{font-size:10px;color:#526b7c;border:1px solid #dfe7ed;background:#f8fafb;border-radius:5px;padding:3px 7px;overflow-wrap:anywhere;white-space:pre-wrap}.subtitle{color:var(--muted);font-size:11px;padding-left:4px}",
    ".banner{border:1px solid #e8d5b5;background:#fff8e9;color:#80591f;border-radius:9px;padding:10px 12px;margin:0 0 12px;font-size:11px}.banner ul{margin:5px 0 0;padding-left:20px}",
    ".fallback{background:#fff;border:1px dashed #cbd8e0;border-radius:10px;padding:25px}.fallback h2{margin:0 0 6px;font-size:15px}.footer{padding:14px 2px 0;color:var(--muted);font-size:10px}",
    "@media(max-width:720px){header{padding:10px 12px}main{padding:10px}.status{display:none}input{width:100%}.toolbar{align-items:stretch}}"
  ].join("\n");
  const script = [
    "const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let version=0,last=null;",
    "function el(tag,cls,value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined&&value!==null)n.textContent=String(value);return n;}",
    "function action(label,type,value){const b=el('button','line',label);b.addEventListener('click',e=>{e.stopPropagation();e.preventDefault();api.postMessage({type,value,version});});return b;}",
    "function value(x){return Array.isArray(x)?x.map(y=>String(y)).join(', '):x===null?'null':typeof x==='object'?JSON.stringify(x):String(x);}",
    "function field(parent,node){if(!node)return;const d=el('details','field'+(node.depth===0?' root':''));d.open=node.depth<2;d.dataset.field=(node.name+' '+node.pointer+' '+node.type+' '+(node.ref?.value||'')).toLowerCase();",
    "const s=el('summary');s.append(el('span','arrow',node.children.length?'›':'·'));s.append(el('span','field-name',node.name));s.append(el('span','datatype',node.type));if(node.required)s.append(el('span','required','required'));s.append(action('L'+node.line,'revealLine',node.line));d.append(s);",
    "const extras=el('div','details');if(node.title?.value)extras.append(el('span','chip','title: '+node.title.value));if(node.description?.value)extras.append(el('span','chip',node.description.value));",
    "if(node.booleanValue!==undefined)extras.append(el('span','chip','schema: '+node.booleanValue));if(node.ref?.value)extras.append(action('$ref '+node.ref.value,'followReference',node.pointer));",
    "for(const c of node.constraints||[])extras.append(el('span','chip',c.key+': '+value(c.value)));if(extras.childNodes.length)d.append(extras);",
    "for(const item of node.children||[])field(d,item);parent.append(d);}",
    "function filter(){const needle=$('search').value.trim().toLowerCase();for(const d of document.querySelectorAll('.field')){d.hidden=false;if(!needle)continue;const own=(d.dataset.field||'').includes(needle);const descendants=[...d.querySelectorAll('.field')].some(x=>(x.dataset.field||'').includes(needle));d.hidden=!(own||descendants);if(descendants)d.open=true;}}",
    "function render(msg){last=msg.projection;version=msg.version;$('status').textContent='SOURCE VERSION '+version;$('title').textContent=last.title||last.schemaId||'Schema';$('tree').replaceChildren();$('banner').replaceChildren();$('summary').replaceChildren();$('search').value='';",
    "if(last.state==='SOURCE_ONLY'){const f=el('section','fallback');f.append(el('h2','','当前 Schema 无法安全可视化'));f.append(el('p','subtitle',last.reason||'请查看原始 YAML'));f.append(action('打开 YAML Source','openSource'));$('tree').append(f);return;}",
    "$('summary').append(el('span','pill','Draft 2020-12'),el('span','pill',last.fieldCount+' fields'),el('span','pill','只读 · Source 真源'));",
    "if(last.state==='PARTIAL'){const b=el('div','banner');b.append(el('strong','', '部分可视化 · 未展示内容仍保留在 YAML'));const ul=el('ul');for(const p of [...(last.unprojectedPaths||[]),...(last.projectionWarnings||[])])ul.append(el('li','',p));b.append(ul);$('banner').append(b);}",
    "field($('tree'),last.tree);}",
    "$('search').addEventListener('input',filter);$('openSource').addEventListener('click',()=>api.postMessage({type:'openSource',version}));",
    "window.addEventListener('message',event=>{const m=event.data;if(m?.type==='snapshot')render(m);else if(m?.type==='error')$('status').textContent=m.message||'Schema editor error';});api.postMessage({type:'ready'});"
  ].join("\n");
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">'+
    '<meta http-equiv="Content-Security-Policy" content="'+csp+'">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<title>SKILL Schema Visual</title><style nonce="'+token+'">'+style+'</style></head>'+
    '<body><header><div class="brand"><div class="eyebrow">SKILL STUDIO · SCHEMAS</div><h1>Schema Designer · <span id="title"></span></h1></div>'+
    '<div class="actions"><span id="status" class="status"></span><button id="openSource" class="primary">打开 YAML Source</button></div></header>'+
    '<main><p class="desc">从当前文档投影的 Draft 2020-12 字段树 · $ref 仅跳转精确本地定义，不访问网络。</p>'+
    '<div id="banner"></div><div class="toolbar"><input id="search" aria-label="查找字段" placeholder="搜索字段或路径">'+
    '<div id="summary" class="toolbar"></div></div><div id="tree" class="tree"></div>'+
    '<div class="footer">仅展示 JSON Schema 声明。当前视图不运行验证、不自动展开循环引用、不修改 Source、不发起外部请求。</div>'+
    '</main><script nonce="'+token+'">'+script+'</script></body></html>';
}
function commandUri(vscode,value) {
  if (value && typeof value.path === 'string') return value;
  const serialized = typeof value === 'string' ? value : value?.toString?.();
  return typeof serialized === 'string' &&
    /^[a-z][a-z0-9+.-]*:\/\//i.test(serialized)
    ? vscode.Uri.parse(serialized) : null;
}
async function chooseSchema(vscode, uri) {
  const supplied = commandUri(vscode,uri);
  if (supplied && isSkillSchema(supplied.path)) return supplied;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && isSkillSchema(active.path)) return active;
  const found = await vscode.workspace.findFiles('**/schemas/*.schema.yaml','**/node_modules/**',50);
  // Optional precise package-relative path for deterministic callers/tests.
  // Never construct a URI from arbitrary command input; choose an actual
  // workspace file only when there is exactly one matching candidate.
  if (typeof uri === 'string') {
    const suffix = uri;
    if (!/^schemas\/[A-Za-z0-9_-]+(?:[._-][A-Za-z0-9_-]+)*\.schema\.ya?ml$/.test(suffix))
      throw new Error('Unsafe or unsupported Schema relative path');
    const matches = found.filter(file => file.path.endsWith('/'+suffix));
    if (matches.length !== 1)
      throw new Error('Schema relative path did not resolve uniquely in the workspace');
    return matches[0];
  }
  if (!found.length) {
    await vscode.window.showInformationMessage('Open a SKILL project with schemas/*.schema.yaml first.');
    return null;
  }
  if (found.length === 1) return found[0];
  const picked = await vscode.window.showQuickPick(found.map(x=>({
    label:vscode.workspace.asRelativePath(x),uri:x
  })),{placeHolder:'Select a JSON Schema source'});
  return picked?.uri??null;
}
export function registerSchemaEditor(vscode,context) {
  const provider = {
    async resolveCustomTextEditor(document,panel) {
      if (!isSkillSchema(document.uri.path)) {
        await vscode.window.showWarningMessage('Only Skill schemas/*.schema.yaml is supported');
        return;
      }
      const webview = panel.webview;
      webview.options={enableScripts:true,localResourceRoots:[]};
      webview.html=html(nonce());
      let disposed=false, ready=false;
      const push=()=>{
        if(disposed||!ready)return;
        const projection=projectJsonSchema(document.getText());
        void webview.postMessage({type:'snapshot',version:document.version,projection});
      };
      const onChange=vscode.workspace.onDidChangeTextDocument(e=>{
        if(e.document.uri.toString()===document.uri.toString())push();
      });
      const onMessage=webview.onDidReceiveMessage(async message=>{
        if(disposed||!message||typeof message!=='object')return;
        if(message.type==='ready'){ready=true;push();return;}
        if(message.version!==document.version){
          void webview.postMessage({type:'error',message:'Schema Source 已变化，请使用最新字段视图。'});
          push();return;
        }
        try {
          if(message.type==='openSource'){
            await openNativeSource(vscode,document.uri,{
              viewColumn:vscode.ViewColumn.One,preserveFocus:false,preview:false
            });
          } else if(message.type==='revealLine') {
            await reveal(vscode,document.uri,message.value);
          } else if(message.type==='followReference'){
            const projection=projectJsonSchema(document.getText());
            await followReference(vscode,document,projection,message.value);
          }
        }catch(e) {
          await vscode.window.showWarningMessage('Schema Designer: '+String(e?.message??e));
        }
      });
      panel.onDidDispose(()=>{disposed=true;forgetSourceViewPair(document.uri);onChange.dispose();onMessage.dispose();});
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(
    SCHEMA_VIEW,provider,{webviewOptions:{retainContextWhenHidden:true}}));
  context.subscriptions.push(vscode.commands.registerCommand('skillStudio.openSchema',
    async uri=>{
      const target=await chooseSchema(vscode,uri);
      if(target)await openSourceViewPair(vscode,target);
    }));
}
