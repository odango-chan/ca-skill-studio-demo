import {openNativeSource} from './native-source.mjs';
import {openSourceViewPair,forgetSourceViewPair} from './source-view-pair.mjs';
import {projectPredicateSet} from '../../../../site/predicate-projection.mjs';

const VIEW = 'skillStudio.predicatePreview';
const SUFFIX = '/assurance/predicates.yaml';

function nonce() {
  const bytes = new Uint8Array(20);
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('Secure randomness unavailable: refusing to render Predicate Webview');
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function predicatePath(path) {
  return typeof path === 'string' && path.toLowerCase().endsWith(SUFFIX);
}
function commandUri(vscode,value) {
  if (value && typeof value.path === 'string') return value;
  const serialized = typeof value === 'string' ? value : value?.toString?.();
  return typeof serialized === 'string' &&
    /^[a-z][a-z0-9+.-]*:\/\//i.test(serialized)
    ? vscode.Uri.parse(serialized) : null;
}
async function choosePredicateSet(vscode, uri) {
  const supplied = commandUri(vscode,uri);
  if (supplied && predicatePath(supplied.path)) return supplied;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && predicatePath(active.path)) return active;
  const candidates = await vscode.workspace.findFiles(
    '**/assurance/predicates.yaml', '**/node_modules/**', 50);
  if (!candidates.length) {
    await vscode.window.showInformationMessage(
      'Open a SKILL folder containing assurance/predicates.yaml first.');
    return null;
  }
  if (candidates.length === 1) return candidates[0];
  const picked = await vscode.window.showQuickPick(candidates.map(file => ({
    label: vscode.workspace.asRelativePath(file), uri: file
  })), {placeHolder: 'Choose the PredicateSet Source file'});
  return picked?.uri ?? null;
}
async function reveal(vscode, uri, line) {
  return openSourceViewPair(vscode,uri,{line});
}
function webviewHtml(token) {
  const csp = "default-src 'none'; img-src data:; style-src 'nonce-" + token +
    "'; script-src 'nonce-" + token + "'; connect-src 'none';";
  const style = [
    ":root{color-scheme:light;--ink:#29465c;--muted:#71869a;--line:#dce6ec;--paper:#fff;--canvas:#f5f8fb;--teal:#18796e}",
    "*{box-sizing:border-box}html,body{height:100%;margin:0}body{font:13px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--canvas);overflow:auto}",
    "button{font:inherit;cursor:pointer;border:1px solid #cbdce5;border-radius:7px;padding:5px 9px;background:#fff;color:#31556a}button:hover{background:#edf5f7}button:focus-visible{outline:2px solid #5aafa2;outline-offset:2px}",
    ".head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:13px 20px;background:#fff;border-bottom:1px solid var(--line)}.brand{min-width:0;flex:1}",
    ".eyebrow{font-size:10px;letter-spacing:.12em;color:var(--teal);font-weight:700}h1{font-size:19px;line-height:1.2;margin:2px 0 0;font-weight:650}.head-actions{display:flex;align-items:center;gap:8px}",
    ".primary{background:#e9f5f2;border-color:#b9ddd4;color:#176f64;font-weight:600}.status{font-size:10px;color:var(--muted);white-space:nowrap}",
    "main{max-width:1380px;margin:0 auto;padding:18px 20px 28px}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:0 0 14px}.intro p{margin:3px 0 0;color:var(--muted);font-size:12px}",
    ".summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.pill{background:#fff;border:1px solid var(--line);border-radius:7px;padding:5px 9px;color:#557084;font-size:11px}",
    ".predicate{background:#fff;border:1px solid var(--line);border-radius:11px;margin:0 0 10px;overflow:hidden}.predicate summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;padding:11px 14px;min-height:48px}.predicate summary::-webkit-details-marker{display:none}",
    ".predicate summary:before{content:'›';font-size:20px;color:#7890a0;line-height:1;transition:transform .12s}.predicate[open] summary:before{transform:rotate(90deg)}",
    ".pid{font-weight:700;overflow-wrap:anywhere;flex:1}.meta{font-size:10px;color:var(--muted);white-space:nowrap}.type{font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;background:#edf5f3;color:#176f64}",
    ".body{border-top:1px solid #edf1f4;padding:12px 14px 14px}.flow{display:grid;grid-template-columns:minmax(0,3fr) 32px minmax(260px,2fr);align-items:stretch;gap:10px}",
    ".observations{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px}.observation,.evaluator{border:1px solid #dfe8ed;border-radius:9px;background:#fbfdfe;padding:11px;min-width:0}",
    ".section-title{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:8px}.oname{font-weight:700;margin-bottom:7px;display:flex;justify-content:space-between;gap:8px}",
    ".kv{display:grid;grid-template-columns:72px minmax(0,1fr);gap:5px 9px;padding-top:6px;border-top:1px solid #edf1f4;margin-top:6px}.key{font-size:10px;color:var(--muted)}.val{font-size:11px;overflow-wrap:anywhere;white-space:pre-wrap}",
    ".scope{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;background:#f0f5f7;border-radius:5px;padding:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px}",
    ".arrow{display:flex;align-items:center;justify-content:center;color:#80a49e;font-size:21px}.evaluator{background:#f6faf9;border-color:#d5e8e3}.evaluator pre{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;color:#35556b}",
    ".line{font-size:10px;padding:2px 6px}.banner{border:1px solid #ead7b6;background:#fff8e9;color:#80591f;border-radius:9px;padding:10px 12px;margin:0 0 13px;font-size:11px}.banner strong{display:block;margin-bottom:3px}.banner ul{margin:5px 0 0;padding-left:18px}",
    ".fallback{padding:26px;border:1px dashed #cbd8e0;border-radius:10px;background:#fff}.fallback h2{margin:0 0 6px;font-size:15px}.fallback p{color:var(--muted);max-width:720px}",
    ".footer{padding:14px 2px 0;color:var(--muted);font-size:10px}",
    "@media(max-width:800px){main{padding:12px}.head{padding:10px 12px}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg);height:18px}.status{display:none}.predicate summary{flex-wrap:wrap}}"
  ].join("\n");
  const script = [
    "const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let currentVersion=0;",
    "const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=String(text);return n;};",
    "function action(label,type,value){const b=el('button','line',label);b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();api.postMessage({type,value,version:currentVersion});});return b;}",
    "function kv(parent,key,value,line,scope=false){if(value===null||value===undefined)return;const k=el('div','key',key),v=el('div',scope?'val scope':'val',value);parent.append(k,v);if(line){const a=action('Source L'+line,'revealLine',line);a.style.gridColumn='2';parent.append(el('div','key',''),a);}}",
    "function render(data){currentVersion=data.version;const p=data.projection;$('status').textContent='SOURCE VERSION '+data.version;$('skill').textContent=p.skill?.value||'未命名 Skill';$('content').replaceChildren();$('banner').replaceChildren();",
    "if(p.state==='SOURCE_ONLY'){const f=el('section','fallback');f.append(el('h2','','当前 PredicateSet 暂不支持图形投影'));f.append(el('p','',p.reason||'请使用原生 YAML 编辑器查看当前文件。'));f.append(action('打开 YAML Source','openSource'));$('content').append(f);return;}",
    "if(p.state==='PARTIAL'||p.projectionWarnings?.length){const b=el('div','banner');b.append(el('strong','','部分可视化 · 原始 Source 保持完整'));b.append(el('div','','以下字段未被当前视图解释或结构不完整：'));const ul=el('ul');for(const path of [...(p.unprojectedPaths||[]),...(p.projectionWarnings||[])])ul.append(el('li','',path));b.append(ul);$('banner').append(b);}",
    "$('summary').replaceChildren(el('span','pill',p.predicateCount+' 个 Predicate'),el('span','pill','Observation → Evaluator'),el('span','pill','声明式配置 · 非运行结果'));",
    "for(const [index,predicate] of p.predicates.entries()){const d=el('details','predicate');d.open=index===0;const s=el('summary');s.append(el('span','pid',predicate.id));s.append(el('span','meta',predicate.observations.length+' observations'));s.append(el('span','type',String(predicate.evaluator?.type?.value??'UNKNOWN').toUpperCase()));s.append(action('L'+predicate.line,'revealLine',predicate.line));d.append(s);",
    "const body=el('div','body'),flow=el('div','flow'),left=el('div',''),obsTitle=el('div','section-title','Observations');left.append(obsTitle);const obs=el('div','observations');",
    "for(const observation of predicate.observations){const card=el('section','observation'),name=el('div','oname',observation.name);if(observation.line)name.append(action('L'+observation.line,'revealLine',observation.line));card.append(name);const values=el('div','kv');kv(values,'Ref',observation.ref?.value,observation.ref?.line);kv(values,'Scope',observation.scope?.value,observation.scope?.line,true);kv(values,'Freshness',observation.freshness?.value,observation.freshness?.line);kv(values,'When',observation.when?.value,observation.when?.line);card.append(values);obs.append(card);}left.append(obs);",
    "const arrow=el('div','arrow','→'),ev=el('section','evaluator');ev.append(el('div','section-title','Evaluator'));ev.append(el('div','oname',predicate.evaluator?.type?.value?.toUpperCase()||'UNRESOLVED'));if(predicate.evaluator?.type?.value==='cel'){const pre=el('pre','',predicate.evaluator.expression?.value||'Expression not declared');ev.append(pre);}else if(predicate.evaluator?.type?.value==='script'){ev.append(el('div','val','Skill evaluator reference'));ev.append(el('pre','',predicate.evaluator.ref?.value||'Script reference not declared'));}else ev.append(el('div','val','Unsupported evaluator variant · inspect Source'));if(predicate.evaluator?.line)ev.append(action('Source L'+predicate.evaluator.line,'revealLine',predicate.evaluator.line));flow.append(left,arrow,ev);body.append(flow);d.append(body);$('content').append(d);}",
    "}",
    "$('openSource').addEventListener('click',()=>api.postMessage({type:'openSource',version:currentVersion}));",
    "window.addEventListener('message',event=>{const msg=event.data;if(msg?.type==='snapshot')render(msg);else if(msg?.type==='error')$('status').textContent=msg.message||'Webview error';});api.postMessage({type:'ready'});"
  ].join("\n");
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>SKILL Predicate Visual</title><style nonce="' + token + '">' + style + '</style></head>' +
    '<body><header class="head"><div class="brand"><div class="eyebrow">SKILL STUDIO · ASSURANCE</div>' +
    '<h1>Predicate Designer · <span id="skill"></span></h1></div><div class="head-actions">' +
    '<span id="status" class="status"></span><button id="openSource" class="primary">打开 YAML Source</button></div></header>' +
    '<main><div class="intro"><div><strong>PredicateSet</strong>' +
    '<p>Observation → Evaluator · 展示声明关系，不执行表达式、不推断当前证据结果</p></div></div>' +
    '<div id="banner"></div><div id="summary" class="summary"></div><div id="content"></div>' +
    '<div class="footer">Predicate 是对 Observation 的声明式判定定义，不是当前运行证据。CEL 不在 Studio 中执行；Script ref 不代表脚本已加载或已获准执行。</div>' +
    '</main><script nonce="' + token + '">' + script + '</script></body></html>';
}
export function registerPredicateEditor(vscode, context) {
  const provider = {
    async resolveCustomTextEditor(document, panel) {
      if (!predicatePath(document.uri.path)) {
        await vscode.window.showWarningMessage(
          'Only assurance/predicates.yaml is supported by Predicate Designer');
        return;
      }
      const webview = panel.webview;
      webview.options = {enableScripts: true, localResourceRoots: []};
      const token = nonce();
      webview.html = webviewHtml(token);
      let disposed = false, ready = false;
      const push = () => {
        if (disposed || !ready) return;
        const text = document.getText();
        const projection = projectPredicateSet(text);
        void webview.postMessage({type: 'snapshot', text, version: document.version,
          path: document.uri.path, projection});
      };
      const changed = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === document.uri.toString()) push();
      });
      const incoming = webview.onDidReceiveMessage(async message => {
        if (disposed || !message || typeof message !== 'object') return;
        if (message.type === 'ready') {ready = true; push(); return;}
        if (message.version !== document.version) {
          void webview.postMessage({type: 'error',
            message: 'PredicateSet Source 已变化，请使用最新视图重新选择字段。'});
          push();
          return;
        }
        try {
          if (message.type === 'openSource') {
            await openNativeSource(vscode, document.uri, {
              viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false
            });
          } else if (message.type === 'revealLine') {
            await reveal(vscode, document.uri, message.value);
          }
        } catch (error) {
          await vscode.window.showWarningMessage(
            'Predicate Designer: ' + String(error?.message ?? error));
        }
      });
      panel.onDidDispose(() => {
        disposed = true;
        forgetSourceViewPair(document.uri);
        changed.dispose();
        incoming.dispose();
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW, provider, {
    webviewOptions: {retainContextWhenHidden: true}
  }));
  context.subscriptions.push(vscode.commands.registerCommand('skillStudio.openPredicates',
    async uri => {
      const target = await choosePredicateSet(vscode, uri);
      if (target) await openSourceViewPair(vscode,target);
    }));
}
