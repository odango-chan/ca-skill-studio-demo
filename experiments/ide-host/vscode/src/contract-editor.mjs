import {openNativeSource} from './native-source.mjs';
import {pairCustomEditor,openSourceViewPair} from './source-view-pair.mjs';
import {projectSkillContract} from '../../../../site/contract-projection.mjs';
import {projectWorkspace} from '../../../../site/workspace.mjs';
import {parseDocument, LineCounter, isMap, isScalar} from 'yaml';

const VIEW = 'skillStudio.contractPreview';
const SUFFIX = '/assurance/contract.yaml';

function nonce() {
  const bytes = new Uint8Array(20);
  if (!globalThis.crypto?.getRandomValues)
    throw new Error('Secure randomness unavailable: refusing to render Contract Webview');
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function contractPath(path) {
  return typeof path === 'string' && path.toLowerCase().endsWith(SUFFIX);
}
function packageRoot(uri) {
  if (!contractPath(uri.path)) throw new Error('Not an assurance/contract.yaml document');
  return uri.path.slice(0, -SUFFIX.length);
}
function packageUri(contractUri, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('schemas/') ||
      relativePath.startsWith('/') || relativePath.includes('\\') ||
      relativePath.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Contract Schema reference is not a safe package-relative path');
  return contractUri.with({path: packageRoot(contractUri) + '/' + relativePath});
}
function predicateLine(source, predicateId) {
  const counter = new LineCounter();
  const parsed = parseDocument(source, {
    version: '1.2', schema: 'core', strict: true,
    uniqueKeys: true, stringKeys: true, lineCounter: counter, logLevel: 'silent'
  });
  if (parsed.errors.length || !isMap(parsed.contents)) return 1;
  const predicates = parsed.contents.get('predicates', true);
  if (!isMap(predicates)) return 1;
  for (const pair of predicates.items) {
    if (isScalar(pair.key) && pair.key.value === predicateId)
      return counter.linePos(pair.key.range?.[0] ?? 0).line || 1;
  }
  return 1;
}
async function reveal(vscode, uri, line) {
  return openSourceViewPair(vscode,uri,{line});
}
async function openReference(vscode, contractDocument, message) {
  const root = packageRoot(contractDocument.uri);
  if (message.type === 'openProcedure') {
    if (typeof message.value !== 'string') throw new Error('Procedure ID is missing');
    const uri = contractDocument.uri.with({path: root + '/assurance/procedure.yaml'});
    const procedureDocument = await vscode.workspace.openTextDocument(uri);
    const projection = projectWorkspace(procedureDocument.getText());
    const procedure = projection.state === 'READY'
      ? projection.procedures.get(message.value) : null;
    if (!procedure) {
      await vscode.window.showWarningMessage(
        'Procedure "' + message.value + '" is not uniquely available in the current Source; opening the file at its beginning.');
      await reveal(vscode, uri, 1);
      return;
    }
    await reveal(vscode, uri, procedure.line);
    return;
  }
  if (message.type === 'openSchema') {
    const uri = packageUri(contractDocument.uri, message.value);
    await reveal(vscode, uri, 1);
    return;
  }
  if (message.type === 'openPredicate') {
    if (typeof message.value !== 'string') throw new Error('Predicate ID is missing');
    const uri = contractDocument.uri.with({path: root + '/assurance/predicates.yaml'});
    const predicateDocument = await vscode.workspace.openTextDocument(uri);
    const line = predicateLine(predicateDocument.getText(), message.value);
    if (line === 1) {
      await vscode.window.showWarningMessage(
        'Predicate "' + message.value + '" was not resolved exactly; opening PredicateSet Source.');
    }
    await reveal(vscode, uri, line);
  }
}
function webviewHtml(webview, token) {
  const csp = "default-src 'none'; img-src data:; style-src 'nonce-" + token +
    "'; script-src 'nonce-" + token + "'; connect-src 'none';";
  const style = [
    ":root{color-scheme:light;--ink:#29465c;--muted:#71869a;--line:#dce6ec;--paper:#fff;--canvas:#f5f8fb;--teal:#18796e}",
    "*{box-sizing:border-box}html,body{height:100%;margin:0}",
    "body{font:13px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--canvas);overflow:auto}",
    "button{font:inherit;cursor:pointer;border:1px solid #cbdce5;border-radius:7px;padding:6px 10px;background:#fff;color:#31556a}",
    "button:hover{background:#edf5f7}button:focus-visible{outline:2px solid #5aafa2;outline-offset:2px}",
    ".head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:13px 20px;background:#fff;border-bottom:1px solid var(--line)}",
    ".brand{min-width:0;flex:1}.eyebrow{font-size:10px;letter-spacing:.12em;color:var(--teal);font-weight:700}",
    "h1{font-size:19px;line-height:1.2;margin:2px 0 0;font-weight:650}.head-actions{display:flex;align-items:center;gap:8px}",
    ".primary{background:#e9f5f2;border-color:#b9ddd4;color:#176f64;font-weight:600}.status{font-size:10px;color:var(--muted);white-space:nowrap}",
    "main{max-width:1320px;margin:0 auto;padding:18px 20px 28px}.intro{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:0 0 14px}",
    ".intro p{margin:3px 0 0;color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}",
    ".card{background:var(--paper);border:1px solid var(--line);border-radius:11px;min-width:0;padding:14px 15px;box-shadow:0 1px 2px #243b5308}",
    ".card.wide{grid-column:1/-1}.card h2{font-size:13px;margin:0 0 3px;font-weight:700}.sub{font-size:10px;color:var(--muted);margin:0 0 11px}",
    ".rows{display:flex;flex-direction:column;gap:0}.row{display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-top:1px solid #edf1f4}.row:first-child{border-top:0}",
    ".label{flex:0 0 132px;color:var(--muted);font-size:11px}.value{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:550}",
    ".row-actions{display:flex;gap:5px;align-items:center;flex:none}.row-actions button{font-size:10px;padding:3px 7px}",
    ".chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid #dce8ed;background:#f6fafb;border-radius:6px;padding:4px 7px;font-size:11px;overflow-wrap:anywhere}",
    ".chip button{border:0;background:transparent;padding:0;color:inherit;text-align:left}.empty{color:var(--muted);font-size:11px;padding:5px 0}",
    ".expect{display:inline-block;margin-left:7px;padding:1px 6px;border-radius:5px;background:#f1f5f7;color:#526b7c;font-size:10px;font-weight:600}",
    ".banner{border:1px solid #ead7b6;background:#fff8e9;color:#80591f;border-radius:9px;padding:10px 12px;margin:0 0 13px;font-size:11px}",
    ".banner strong{display:block;margin-bottom:3px}.banner ul{margin:5px 0 0;padding-left:18px}",
    ".footer{padding:14px 2px 0;color:var(--muted);font-size:10px}.fallback{padding:26px;border:1px dashed #cbd8e0;border-radius:10px;background:#fff}",
    ".fallback h2{margin:0 0 6px;font-size:15px}.fallback p{color:var(--muted);max-width:720px}",
    "@media(max-width:760px){.grid{grid-template-columns:1fr}.card.wide{grid-column:auto}main{padding:12px}.head{padding:10px 12px}.label{flex-basis:110px}.head-actions{gap:5px}.status{display:none}}"
  ].join("\n");
  const script = [
    "const api=acquireVsCodeApi(),$=id=>document.getElementById(id);let currentVersion=0;",
    "const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=String(text);return n;};",
    "function action(label,type,value){const b=el('button','',label);b.addEventListener('click',()=>api.postMessage({type,value,version:currentVersion}));return b;}",
    "function card(title,subtitle,wide=false){const c=el('section','card'+(wide?' wide':''));c.append(el('h2','',title));if(subtitle)c.append(el('p','sub',subtitle));const rows=el('div','rows');c.append(rows);$('content').append(c);return rows;}",
    "function row(parent,label,value,sourceLine,actionNode){const r=el('div','row'),l=el('div','label',label),v=el('div','value',value===null||value===undefined||value===''?'未声明':value);r.append(l,v);const a=el('div','row-actions');if(Number.isSafeInteger(sourceLine)&&sourceLine>0)a.append(action('L'+sourceLine,'revealLine',sourceLine));if(actionNode)a.append(actionNode);if(a.childNodes.length)r.append(a);parent.append(r);}",
    "function list(parent,title,items,kind){const wrap=el('div','row'),label=el('div','label',title),values=el('div','value'),chips=el('div','chips');if(Array.isArray(items)&&items.length){for(const item of items){const chip=el('span','chip'),value=item?.value??'';if(kind)chip.append(action(value,kind,value));else chip.textContent=String(value);chips.append(chip);}}else chips.append(el('span','empty','未声明'));values.append(chips);wrap.append(label,values);parent.append(wrap);}",
    "function expectationSection(title,items){const rows=card(title,'声明式条件引用 · 不代表当前运行结果',true);if(!Array.isArray(items)||!items.length){rows.append(el('div','empty','未声明'));return;}for(const item of items){const r=el('div','row'),label=el('div','label','Predicate'),v=el('div','value'),id=item.predicate?.value??'未解析';v.textContent=String(id);if(item.expect?.value!==undefined)v.append(el('span','expect',item.expect.value));if(item.satisfiable?.value!==undefined)v.append(el('span','expect','satisfiable: '+item.satisfiable.value));r.append(label,v);const a=el('div','row-actions');if(item.line)a.append(action('L'+item.line,'revealLine',item.line));if(item.predicate?.value)a.append(action('打开 Predicate','openPredicate',item.predicate.value));if(a.childNodes.length)r.append(a);rows.append(r);}}",
    "function render(data){currentVersion=data.version;const p=data.projection;$('status').textContent='SOURCE VERSION '+data.version;$('name').textContent=p.name?.value||'未命名 Skill';$('content').replaceChildren();$('banner').replaceChildren();",
    "if(p.state==='SOURCE_ONLY'){const f=el('section','fallback');f.append(el('h2','','当前 Contract 暂不支持图形投影'));f.append(el('p','',p.reason||'请使用原生 YAML 编辑器查看当前文件。'));f.append(action('打开 YAML Source','openSource'));$('content').append(f);return;}",
    "if(p.state==='PARTIAL'||p.projectionWarnings?.length){const b=el('div','banner');b.append(el('strong','','部分可视化 · 原始 Source 保持完整'));b.append(el('div','','以下内容没有被当前视图解释，不会被隐藏或改写：'));const ul=el('ul');for(const path of [...(p.unprojectedPaths||[]),...(p.projectionWarnings||[])])ul.append(el('li','',path));b.append(ul);$('banner').append(b);}",
    "let r=card('Skill Identity','契约身份与目标');row(r,'Package',p.name?.value,p.name?.line);row(r,'Skill Type',p.skillType?.value,p.skillType?.line);row(r,'Goal',p.goal?.value,p.goal?.line);",
    "r=card('Entry & Inputs','入口与输入结构');row(r,'Entry Procedure',p.entryProcedure?.value,p.entryProcedure?.line,p.entryProcedure?.value?action('打开 Procedure','openProcedure',p.entryProcedure.value):null);row(r,'Request Schema',p.requestSchema?.value,p.requestSchema?.line,p.requestSchema?.value?action('打开 Schema','openSchema',p.requestSchema.value):null);",
    "r=card('Required Context','执行前需要的上下文事实');list(r,'Required Facts',p.requiredFacts);list(r,'Context Schemas',p.contextSchemas);r=card('Allowed Resources','声明的资源范围，不代表运行时授权');list(r,'Capabilities',p.capabilities);list(r,'Local Tools',p.localTools);",
    "expectationSection('Preconditions',p.preconditions);expectationSection('Requirements',p.requirements);expectationSection('Postconditions',p.postconditions);",
    "r=card('Planning','计划边界与组合预算');row(r,'Max Actions',p.maxActions?.value,p.maxActions?.line);row(r,'Dynamic Procedure',p.allowDynamicProcedure?.value,p.allowDynamicProcedure?.line);row(r,'Fallback Procedure',p.fallbackProcedure?.value,p.fallbackProcedure?.line,p.fallbackProcedure?.value?action('打开 Procedure','openProcedure',p.fallbackProcedure.value):null);",
    "if(p.budgetPartition?.parentActions||p.budgetPartition?.childActions)row(r,'Budget Partition','Parent '+(p.budgetPartition.parentActions?.value??'—')+' / Child '+(p.budgetPartition.childActions?.value??'—'));",
    "r=card('Failure Semantics','Outcome unknown 的后续处理');row(r,'Require Reconcile',p.requireReconcile?.value,p.requireReconcile?.line);",
    "r=card('Dependencies','组合依赖的 Skill / Artifact');if(Array.isArray(p.dependencies)&&p.dependencies.length){for(const dep of p.dependencies)row(r,dep.name?.value||'Dependency',[dep.artifactRef?.value,dep.variant?.value,dep.digest?.value].filter(Boolean).join(' · '),dep.line);}else r.append(el('div','empty','未声明'));}",
    "$('openSource').addEventListener('click',()=>api.postMessage({type:'openSource',version:currentVersion}));",
    "window.addEventListener('message',event=>{const msg=event.data;if(msg?.type==='snapshot')render(msg);else if(msg?.type==='error')$('status').textContent=msg.message||'Webview error';});api.postMessage({type:'ready'});"
  ].join("\n");
  return '<!doctype html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>SKILL Contract Visual</title><style nonce="' + token + '">' + style + '</style></head>' +
    '<body><header class="head"><div class="brand"><div class="eyebrow">SKILL STUDIO · ASSURANCE</div>' +
    '<h1>Contract Designer <span id="name"></span></h1></div><div class="head-actions">' +
    '<span id="status" class="status"></span><button id="openSource" class="primary">打开 YAML Source</button></div></header>' +
    '<main><div class="intro"><div><strong>Skill Contract</strong>' +
    '<p>从当前 Source 生成的只读结构视图 · 点击引用可定位相关文件</p></div></div>' +
    '<div id="banner"></div><div id="content" class="grid"></div>' +
    '<div class="footer">Source 是唯一真源。此视图不修改 YAML、不执行 Skill，也不授予 Capability / Tool 权限；实际校验以 Owner Schema 与 Runtime 为准。</div>' +
    '</main><script nonce="' + token + '">' + script + '</script></body></html>';
}
function commandUri(vscode,value) {
  if (value && typeof value.path === 'string') return value;
  const serialized = typeof value === 'string' ? value : value?.toString?.();
  return typeof serialized === 'string' &&
    /^[a-z][a-z0-9+.-]*:\/\//i.test(serialized)
    ? vscode.Uri.parse(serialized) : null;
}
async function chooseContract(vscode, uri) {
  const supplied = commandUri(vscode,uri);
  if (supplied && contractPath(supplied.path)) return supplied;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && contractPath(active.path)) return active;
  const candidates = await vscode.workspace.findFiles(
    '**/assurance/contract.yaml', '**/node_modules/**', 50);
  if (!candidates.length) {
    await vscode.window.showInformationMessage(
      'Open a SKILL folder containing assurance/contract.yaml first.');
    return null;
  }
  if (candidates.length === 1) return candidates[0];
  const picked = await vscode.window.showQuickPick(candidates.map(file => ({
    label: vscode.workspace.asRelativePath(file), uri: file
  })), {placeHolder: 'Choose the Contract Source file'});
  return picked?.uri ?? null;
}
export function registerContractEditor(vscode, context) {
  const provider = {
    async resolveCustomTextEditor(document, panel) {
      if (!contractPath(document.uri.path)) {
        await vscode.window.showWarningMessage(
          'Only assurance/contract.yaml is supported by Contract Designer');
        return;
      }
      await pairCustomEditor(vscode,panel,document);
      const webview = panel.webview;
      webview.options = {enableScripts: true, localResourceRoots: []};
      const token = nonce();
      webview.html = webviewHtml(webview, token);
      let disposed = false, ready = false;
      const push = () => {
        if (disposed || !ready) return;
        const text = document.getText();
        const projection = projectSkillContract(text);
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
            message: 'Contract Source 已变化，请使用最新视图重新选择引用。'});
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
          } else if (['openProcedure', 'openSchema', 'openPredicate'].includes(message.type)) {
            await openReference(vscode, document, message);
          }
        } catch (error) {
          await vscode.window.showWarningMessage(
            'Contract Designer: ' + String(error?.message ?? error));
        }
      });
      panel.onDidDispose(() => {
        disposed = true;
        changed.dispose();
        incoming.dispose();
      });
    }
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW, provider, {
    webviewOptions: {retainContextWhenHidden: true}
  }));
  context.subscriptions.push(vscode.commands.registerCommand('skillStudio.openContract',
    async uri => {
      const target = await chooseContract(vscode, uri);
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW);
    }));
}
