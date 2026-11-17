import {
  buildContextPack,
  MAX_CONTEXT_PACK_BYTES,
} from "../../../../authoring/core/context-pack.mjs";
import { createProcedureAgent } from "../../../../authoring/core/procedure-agent.mjs";
import { createGatewayModelClient } from "../../../../authoring/core/gateway-client.mjs";
import { createChangeSet } from "../../../../authoring/core/change-set.mjs";
import {
  planV1Alpha5Patch,
  materializeAcceptedPatchGroups,
} from "../../../../authoring/core/v1alpha5-patch-engine.mjs";
import { collectPackageSnapshot } from "./package-snapshot.mjs";
import { resolveLockedDependencies } from "./dependency-service.mjs";
import { decodeBase64 } from "./dependency-snapshot.mjs";
import { isProcedurePath } from "./bridge.mjs";
import { assertStudioMutation } from "./project-policy.mjs";

const LANGUAGE_TARGET = "connectionagent.io/v1alpha5";
const MAX_CONTEXT_ITEMS = 128;
const TEXT_DEPENDENCY_FILE = /\.(?:json|ya?ml|md)$/i;
const SENSITIVE_SEGMENT = /(?:^|[._-])(?:secrets?|credentials?|private[-_]?keys?|access[-_]?tokens?|tokens?)(?:[._-]|$)/i;
const encoder = new TextEncoder();

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function safeTextPath(path) {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === ".." ||
      part.startsWith(".") || SENSITIVE_SEGMENT.test(part))) return false;
  return true;
}

function resourceKind(path) {
  if (path === "assurance/contract.yaml") return "contract";
  if (path === "assurance/predicates.yaml") return "predicate";
  if (path.startsWith("schemas/")) return "schema";
  if (path.startsWith("references/")) return "reference";
  if (path.startsWith("scripts/")) return "script";
  return null;
}

export function createPackageRevisionTracker() {
  const revisions = new Map();
  return async function revisionFor(snapshot, dependencyResolution) {
    const identity = snapshot?.rootUri;
    if (typeof identity !== "string" || !identity) throw new TypeError("Package root identity is required");
    const documents = (snapshot.documents ?? []).map((item) => ({
      path: item.relativePath,
      version: item.version,
      text: item.text,
    }));
    const dependencies = (dependencyResolution.snapshots ?? [])
      .map((item) => ({ id: item.id, kind: item.kind, digest: item.snapshotDigest }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const fingerprint = await sha256Hex(JSON.stringify({ documents, dependencies }));
    const previous = revisions.get(identity);
    if (previous?.fingerprint === fingerprint) return previous.generation;
    const generation = (previous?.generation ?? 0) + 1;
    revisions.set(identity, { fingerprint, generation });
    return generation;
  };
}

export async function buildAuthoringResourceInventory(snapshot, dependencyResolution) {
  if (!snapshot || snapshot.completeness !== "complete") {
    throw new Error("Package snapshot is incomplete; AI Authoring refuses to send a partial Package.");
  }
  if (!dependencyResolution || dependencyResolution.status !== "READY") {
    const details = (dependencyResolution?.diagnostics ?? [])
      .map((item) => item.code + ": " + item.message).join("\n");
    throw new Error("Locked dependencies are not READY. Repair the dependency lock before AI Authoring." +
      (details ? "\n" + details : ""));
  }

  const resources = [];
  for (const item of snapshot.documents ?? []) {
    const path = item.relativePath;
    const kind = resourceKind(path);
    if (!kind || !safeTextPath(path) || typeof item.text !== "string" || item.text.length === 0) continue;
    const id = kind + "-" + (await sha256Hex(path)).slice(0, 20);
    const explicit = kind === "reference" || kind === "script";
    resources.push({
      id,
      kind,
      path,
      content: item.text,
      selected: !explicit,
      ...(explicit ? { explicitlyIncluded: false } : {}),
      label: path,
      bytes: encoder.encode(item.text).byteLength,
    });
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const dependency of dependencyResolution.snapshots ?? []) {
    const files = [];
    for (const file of dependency.files ?? []) {
      if (!TEXT_DEPENDENCY_FILE.test(file.path) || !safeTextPath(file.path)) continue;
      try {
        const text = decoder.decode(decodeBase64(file.bytes));
        if (text.length) files.push({ path: file.path, text });
      } catch {
        // Binary and invalid UTF-8 files are verified but not model-readable context.
      }
    }
    if (!files.length) continue;
    const content = JSON.stringify({
      dependencyId: dependency.id,
      kind: dependency.kind,
      snapshotDigest: dependency.snapshotDigest,
      files,
    }, null, 2);
    const id = "dep-" + dependency.id;
    resources.push({
      id,
      kind: "dependency",
      version: dependency.snapshotDigest,
      verified: true,
      content,
      selected: true,
      label: "dependency:" + dependency.id + "@" + dependency.snapshotDigest,
      bytes: encoder.encode(content).byteLength,
    });
  }

  if (resources.length > MAX_CONTEXT_ITEMS) {
    throw new Error("Package exposes more than " + MAX_CONTEXT_ITEMS +
      " eligible context items. Narrow the Package before sending context.");
  }
  return Object.freeze(resources.map((item) => Object.freeze(item)));
}

function nonceValue() {
  const bytes = new Uint8Array(24);
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure randomness unavailable");
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function renderAiAuthoringHtml(nonce) {
  if (typeof nonce !== "string" || !/^[a-f0-9]{32,128}$/.test(nonce)) {
    throw new TypeError("A cryptographically random Webview nonce is required");
  }
  const css = [
    ":root{color-scheme:light dark;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}",
    "*{box-sizing:border-box}",
    "body{margin:0;padding:0;min-width:320px}",
    "button,input,textarea{font:inherit}",
    "button{border:1px solid var(--vscode-button-border,var(--vscode-widget-border));border-radius:4px;padding:7px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}",
    "button:disabled{opacity:.45;cursor:not-allowed}",
    "button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}",
    "header.topbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}",
    ".heading{display:flex;flex-direction:column;gap:3px}.heading strong{font-size:15px}.muted,small{color:var(--vscode-descriptionForeground)}",
    ".top-actions,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.spread{justify-content:space-between}",
    "main{display:grid;grid-template-columns:minmax(300px, .9fr) minmax(280px, .8fr) minmax(360px, 1.3fr);gap:12px;padding:12px;align-items:start}",
    "section.card{min-width:0;border:1px solid var(--vscode-panel-border);border-radius:7px;padding:12px;background:var(--vscode-editorWidget-background)}",
    "section.card h2{font-size:13px;margin:0 0 10px;font-weight:650}",
    "textarea{width:100%;min-height:190px;resize:vertical;padding:10px;border:1px solid var(--vscode-input-border);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);outline-color:var(--vscode-focusBorder)}",
    ".note{font-size:12px;line-height:1.5;margin:10px 0;color:var(--vscode-descriptionForeground)}",
    ".source-list,.group-list{display:flex;flex-direction:column;gap:7px;max-height:58vh;overflow:auto}",
    ".source,.group{display:flex;gap:9px;align-items:flex-start;padding:8px;border:1px solid var(--vscode-panel-border);border-radius:5px}",
    ".source input,.group input{margin-top:3px;flex:0 0 auto}",
    ".source-main,.group-main{min-width:0;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}",
    ".kind{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground)}",
    ".source-label{font-size:12px}.source-bytes{font-size:11px;color:var(--vscode-descriptionForeground)}",
    ".status{padding:8px 12px;border-top:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);font-size:12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}",
    ".summary{font-size:14px;font-weight:600;margin:4px 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".subsection{margin:12px 0}.subsection h3{font-size:12px;margin:0 0 6px}.subsection ul{margin:0;padding-left:20px;font-size:12px;line-height:1.55}",
    ".group-title{font-size:12px;font-weight:600}.group-main details{margin-top:6px}.group-main summary{font-size:11px;color:var(--vscode-descriptionForeground);cursor:pointer}.group-main li{font-size:11px;margin:4px 0;overflow-wrap:anywhere}",
    ".compiler{font-size:11px;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:4px 6px}",
    ".warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}",
    ".actions{margin-top:12px}",
    "@media(max-width:1050px){main{grid-template-columns:minmax(260px,1fr) minmax(280px,1fr)}.proposal{grid-column:1/-1}}",
    "@media(max-width:650px){header.topbar{align-items:flex-start;flex-direction:column}main{grid-template-columns:1fr}.proposal{grid-column:auto}}",
  ].join("\n");
  const script = [
    "const vscode=acquireVsCodeApi();",
    "const byId=id=>document.getElementById(id);",
    "let busy=false,canApply=false,contextReady=false;",
    "function status(text,kind){const el=byId('status');el.textContent=text||'';el.className='status '+(kind||'');}",
    "function setBusy(value){busy=value;byId('generate').disabled=value||!window.gatewayConfigured||!contextReady;byId('cancel').disabled=!value;byId('refresh').disabled=value;byId('apply').disabled=value||!canApply;}",
    "function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}",
    "function addList(id,items){const root=byId(id);clear(root);if(!items||!items.length)return;const ul=document.createElement('ul');for(const value of items){const li=document.createElement('li');li.textContent=value;ul.appendChild(li);}root.appendChild(ul);}",
    "function renderContext(message){contextReady=true;canApply=false;window.gatewayConfigured=message.gatewayConfigured===true;byId('proposalSummary').textContent='';clear(byId('plan'));clear(byId('assumptions'));clear(byId('blockers'));clear(byId('groups'));byId('patchState').textContent='尚未生成';byId('patchError').textContent='';byId('apply').disabled=true;byId('discard').disabled=true;byId('packageInfo').textContent=message.packageName+' · '+message.documentVersion+' · Package revision '+message.packageGeneration;byId('gatewayNotice').textContent=window.gatewayConfigured?'Gateway URL 已配置；Provider Key 由服务端管理。':'请先在用户设置中配置 connectionAgent.skillStudio.ai.gatewayUrl。';const list=byId('sources');clear(list);for(const item of message.sources||[]){const label=document.createElement('label');label.className='source';const input=document.createElement('input');input.type='checkbox';input.checked=item.selected===true;input.value=item.id;input.disabled=busy;const body=document.createElement('span');body.className='source-main';const kind=document.createElement('span');kind.className='kind';kind.textContent=item.kind;const name=document.createElement('span');name.className='source-label';name.textContent=item.label;const size=document.createElement('span');size.className='source-bytes';size.textContent=item.bytes+' bytes'+(item.explicitOptIn?' · 每次任务需显式选择':'');body.append(kind,name,size);label.append(input,body);list.appendChild(label);}status('上下文已就绪。发送前会再次显示明确的数据披露确认。');setBusy(false);}",
    "function renderProposal(message){canApply=message.canApply===true;byId('proposalSummary').textContent=message.summary||'';addList('plan',message.plan||[]);addList('assumptions',message.assumptions||[]);addList('blockers',message.blockers||[]);byId('blockers').className=(message.blockers&&message.blockers.length)?'subsection warning':'subsection';byId('patchState').textContent=message.patchState||'NOT_RUN';byId('patchError').textContent=message.patchError||'';const list=byId('groups');clear(list);for(const group of message.groups||[]){const label=document.createElement('label');label.className='group';const input=document.createElement('input');input.type='checkbox';input.checked=true;input.value=group.id;input.dataset.groupId=group.id;const body=document.createElement('span');body.className='group-main';const title=document.createElement('span');title.className='group-title';title.textContent=group.label+' · '+group.operationIds.length+' 项';const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='查看操作与理由';const ul=document.createElement('ul');for(const operation of group.operations||[]){const li=document.createElement('li');li.textContent=operation.type+' — '+operation.rationale;ul.appendChild(li);}details.append(summary,ul);body.append(title,details);label.append(input,body);list.appendChild(label);}byId('apply').disabled=!canApply||busy;byId('discard').disabled=false;status(canApply?'本地 Patch Plan READY；这不是 Compiler Check。':'提案已返回，但当前不能应用修改。',canApply?'':'warning');}",
    "byId('generate').addEventListener('click',()=>{const task=byId('task').value.trim();const selectedIds=[...document.querySelectorAll('#sources input:checked')].map(item=>item.value);vscode.postMessage({type:'generate',task,selectedIds});});",
    "byId('cancel').addEventListener('click',()=>vscode.postMessage({type:'cancel'}));",
    "byId('refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));",
    "byId('apply').addEventListener('click',()=>{const groupIds=[...document.querySelectorAll('[data-group-id]:checked')].map(item=>item.dataset.groupId);vscode.postMessage({type:'apply',groupIds});});",
    "byId('discard').addEventListener('click',()=>vscode.postMessage({type:'discard'}));",
    "window.addEventListener('message',event=>{const message=event.data||{};if(message.type==='context')renderContext(message);else if(message.type==='status'){status(message.message,message.kind);if(message.busy!==undefined)setBusy(message.busy);}else if(message.type==='proposal')renderProposal(message);else if(message.type==='error'){if(message.contextUnavailable===true){contextReady=false;clear(byId('sources'));}status(message.message,'error');setBusy(false);}else if(message.type==='applied'){canApply=false;byId('apply').disabled=true;byId('discard').disabled=true;status('已应用到原生编辑器缓冲区；尚未保存。Compiler Check: NOT_RUN。');}else if(message.type==='discarded'){canApply=false;clear(byId('groups'));byId('proposalSummary').textContent='';byId('plan').textContent='';byId('assumptions').textContent='';byId('blockers').textContent='';byId('apply').disabled=true;byId('discard').disabled=true;status('提案已丢弃。');}});",
    "vscode.postMessage({type:'ready'});",
  ].join("\n");
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'none'; font-src 'none';\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>AI Procedure Authoring</title><style nonce=\"" + nonce + "\">" + css + "</style></head><body>",
    "<header class=\"topbar\"><div class=\"heading\"><strong>AI Procedure Authoring</strong><small id=\"packageInfo\">读取当前 Package…</small></div><div class=\"top-actions\"><span class=\"compiler\">CA-SL v1alpha5 Preview</span><button id=\"refresh\" class=\"secondary\">刷新上下文</button></div></header>",
    "<main>",
    "<section class=\"card\"><h2>任务说明</h2><textarea id=\"task\" maxlength=\"4000\" placeholder=\"描述希望如何修改当前 Procedure。模型只会提出语义修改，不会直接写文件或执行 Tool。\"></textarea><div class=\"note\"><strong>数据披露：</strong>选中的上下文将在你确认后发送到配置的 AI Gateway。Provider API Key 不存储在 Studio 中。</div><div id=\"gatewayNotice\" class=\"note warning\"></div><div class=\"actions\"><button id=\"generate\">生成修改提案</button><button id=\"cancel\" class=\"secondary\" disabled>取消请求</button></div></section>",
    "<section class=\"card\"><h2>上下文来源</h2><p class=\"note\">Procedure 当前缓冲区必定包含。Contract、Predicate、Schema 和已验证依赖默认选中；Reference / Script 需要逐任务显式选择。</p><div id=\"sources\" class=\"source-list\"></div></section>",
    "<section class=\"card proposal\"><div class=\"top-actions\" style=\"justify-content:space-between\"><h2>修改提案</h2><span class=\"compiler\">Compiler Check: NOT_RUN</span></div><div id=\"proposalSummary\" class=\"summary\"></div><div class=\"subsection\"><h3>执行计划</h3><div id=\"plan\"></div></div><div class=\"subsection\"><h3>假设</h3><div id=\"assumptions\"></div></div><div id=\"blockers\" class=\"subsection\"><h3>阻塞项</h3></div><div class=\"subsection\"><h3>可独立接受的原子修改组</h3><div id=\"patchState\" class=\"kind\">尚未生成</div><div id=\"patchError\" class=\"note error\"></div><div id=\"groups\" class=\"group-list\"></div></div><div class=\"actions\"><button id=\"apply\" disabled>应用选中修改</button><button id=\"discard\" class=\"secondary\" disabled>丢弃提案</button></div></section>",
    "</main><footer class=\"status\"><span id=\"status\">正在初始化…</span><span>仅修改当前 Procedure 缓冲区 · 不自动保存 · Compiler Check 不在本阶段执行</span></footer>",
    "<script nonce=\"" + nonce + "\">" + script + "</script></body></html>",
  ].join("\n");
}

export function registerAiAuthoringEditor(vscode, context, { getActiveDocument } = {}) {
  const revisionFor = createPackageRevisionTracker();
  let panel = null;
  let session = null;

  function post(message) {
    if (panel && session && !session.disposed) void panel.webview.postMessage(message);
  }

  async function resolveProcedureDocument() {
    const active = vscode.window.activeTextEditor?.document ?? null;
    if (active) {
      if (isProcedurePath(active.uri.path)) return active;
      throw new Error("请先打开目标 Skill 的 assurance/procedure.yaml，再启动 AI Authoring。");
    }
    const workbenchDocument = getActiveDocument?.() ?? null;
    if (workbenchDocument && isProcedurePath(workbenchDocument.uri.path)) return workbenchDocument;
    const matches = await vscode.workspace.findFiles(
      "**/assurance/procedure.yaml", "**/node_modules/**", 50
    );
    if (matches.length === 0) throw new Error("当前 Workspace 中没有找到 assurance/procedure.yaml。");
    let selected = matches[0];
    if (matches.length > 1) {
      const items = matches.map((uri) => ({
        label: vscode.workspace.asRelativePath(uri),
        description: uri.toString(),
        uri,
      }));
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: "选择要编辑的 Skill Procedure",
        ignoreFocusOut: true,
      });
      if (!choice) return null;
      selected = choice.uri;
    }
    return vscode.workspace.openTextDocument(selected);
  }

  async function collectAuthoringState(document) {
    if (!document || !isProcedurePath(document.uri.path)) {
      throw new Error("AI Authoring 只支持 assurance/procedure.yaml。");
    }
    if (!Number.isSafeInteger(document.version) || document.version < 1) {
      throw new Error("当前 Procedure 没有可用的 TextDocument revision。");
    }
    const snapshot = await collectPackageSnapshot(vscode, document, 1);
    if (snapshot.completeness !== "complete") {
      throw new Error("Package 快照不完整，已拒绝发送上下文：" + (snapshot.reason ?? "unknown"));
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) throw new Error("无法确定当前 Skill 所属 Workspace Folder。");
    const dependencies = await resolveLockedDependencies(vscode, folder.uri);
    if (dependencies.status !== "READY") {
      const details = (dependencies.diagnostics ?? [])
        .map((item) => item.code + ": " + item.message).join("\n");
      throw new Error("已声明依赖未通过本地快照校验，已拒绝发送上下文。" +
        (details ? "\n" + details : ""));
    }
    const generation = await revisionFor(snapshot, dependencies);
    snapshot.generation = generation;
    const procedure = snapshot.documents.find((item) => item.relativePath === "assurance/procedure.yaml");
    if (!procedure || procedure.version !== document.version || procedure.text !== document.getText()) {
      throw new Error("Procedure buffer changed while the Package snapshot was collected. Refresh context and retry.");
    }
    const resources = await buildAuthoringResourceInventory(snapshot, dependencies);
    return { snapshot, dependencies, generation, procedure, resources };
  }

  async function refreshContext() {
    if (!session || session.disposed) return;
    post({ type: "status", message: "正在读取当前 Procedure、Package 文件和锁定依赖…" });
    try {
      const state = await collectAuthoringState(session.document);
      session.context = state;
      session.pending = null;
      const gatewayBaseUrl = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai")
        .get("gatewayUrl", "");
      post({
        type: "context",
        languageTarget: LANGUAGE_TARGET,
        packageName: state.snapshot.packageName,
        documentVersion: session.document.version,
        packageGeneration: state.generation,
        gatewayConfigured: typeof gatewayBaseUrl === "string" && gatewayBaseUrl.trim().length > 0,
        sources: state.resources.map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          bytes: item.bytes,
          selected: item.selected,
          explicitOptIn: item.kind === "reference" || item.kind === "script",
        })),
      });
    } catch (error) {
      session.context = null;
      post({ type: "error", message: String(error?.message ?? error), contextUnavailable: true });
    }
  }

  async function handleGenerate(message) {
    if (!session || session.disposed || !session.context) {
      post({ type: "error", message: "当前上下文尚未就绪，请先刷新。" });
      return;
    }
    if (session.controller) {
      post({ type: "error", message: "已有模型请求正在运行。" });
      return;
    }
    const task = typeof message.task === "string" ? message.task.trim() : "";
    if (!task || task.length > 4000) {
      post({ type: "error", message: "请输入 1–4000 字符的修改要求。" });
      return;
    }
    if (!Array.isArray(message.selectedIds) ||
      message.selectedIds.some((id) => typeof id !== "string")) {
      post({ type: "error", message: "上下文来源选择无效。" });
      return;
    }
    const selectedIds = new Set(message.selectedIds);
    if (selectedIds.size !== message.selectedIds.length ||
      [...selectedIds].some((id) => !session.context.resources.some((item) => item.id === id))) {
      post({ type: "error", message: "上下文来源包含重复或未知项目。" });
      return;
    }
    const gatewayBaseUrl = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai")
      .get("gatewayUrl", "");
    if (typeof gatewayBaseUrl !== "string" || !gatewayBaseUrl.trim()) {
      post({ type: "error", message: "尚未配置 AI Gateway。请在用户设置中填写 connectionAgent.skillStudio.ai.gatewayUrl。" });
      return;
    }

    const document = session.document;
    const initial = session.context;
    const selectedResources = initial.resources.map((item) => ({
      ...item,
      selected: selectedIds.has(item.id),
      ...(item.kind === "reference" || item.kind === "script"
        ? { explicitlyIncluded: selectedIds.has(item.id) }
        : {}),
    }));
    let contextPack;
    try {
      contextPack = await buildContextPack({
        taskId: globalThis.crypto.randomUUID(),
        revision: document.version,
        languageTarget: LANGUAGE_TARGET,
        procedure: {
          path: "assurance/procedure.yaml",
          documentVersion: document.version,
          text: document.getText(),
        },
        resources: selectedResources,
        maxBytes: MAX_CONTEXT_PACK_BYTES,
      });
    } catch (error) {
      post({ type: "error", message: String(error?.message ?? error) });
      return;
    }

    const disclosure = contextPack.manifest.map((item) =>
      item.label + " · " + item.bytes + " bytes"
    );
    const detail = [
      "目标语言：CA-SL v1alpha5",
      "Procedure：assurance/procedure.yaml",
      "上下文总量：" + contextPack.byteCount + " bytes",
      "将发送的来源：",
      ...disclosure.slice(0, 12),
      ...(disclosure.length > 12 ? ["…另有 " + (disclosure.length - 12) + " 项"] : []),
      "",
      "内容将发送到你配置的 AI Gateway。Provider API Key 不会从服务端暴露给 Studio。",
    ].join("\n");
    const confirmed = await vscode.window.showWarningMessage(
      "确认将当前 Procedure 和所选上下文发送到 AI 服务？",
      { modal: true, detail },
      "发送并生成提案",
    );
    if (confirmed !== "发送并生成提案") {
      post({ type: "status", message: "已取消发送；没有向模型发送数据。" });
      return;
    }

    try {
      const current = await collectAuthoringState(document);
      if (document.version !== initial.procedure.version ||
        current.generation !== initial.generation ||
        document.getText() !== initial.procedure.text) {
        await refreshContext();
        post({ type: "error", message: "生成期间 Package 或 Procedure 已变化。上下文已刷新，请重新检查后再生成。" });
        return;
      }
    } catch (error) {
      post({ type: "error", message: String(error?.message ?? error) });
      return;
    }

    const controller = new AbortController();
    session.controller = controller;
    post({ type: "status", message: "正在请求模型并校验语义提案…", busy: true });
    try {
      const modelClient = createGatewayModelClient({ gatewayBaseUrl: gatewayBaseUrl.trim() });
      const agent = createProcedureAgent({ modelClient });
      const proposalResult = await agent.propose({
        task,
        contextPack: contextPack.pack,
        contextManifest: contextPack.manifest,
        contextDisclosureAccepted: true,
        signal: controller.signal,
        maxTokens: 2048,
      });
      const current = await collectAuthoringState(document);
      if (document.version !== initial.procedure.version ||
        current.generation !== initial.generation ||
        document.getText() !== initial.procedure.text) {
        await refreshContext();
        post({ type: "error", message: "模型响应期间 Package 或 Procedure 已变化。提案已丢弃，没有应用任何修改。" });
        return;
      }

      const changeSet = createChangeSet({
        proposalResult,
        hostBase: {
          documentUri: document.uri.toString(),
          documentVersion: document.version,
          packageGeneration: initial.generation,
          sourceDigest: "sha256:" + contextPack.manifest[0].digest,
        },
      });
      let patchPlan = null;
      let patchError = null;
      if (proposalResult.proposal.blockers.length === 0 &&
        proposalResult.proposal.operations.length > 0) {
        try {
          patchPlan = await planV1Alpha5Patch({
            source: document.getText(),
            changeSet,
            currentDocumentUri: document.uri.toString(),
            currentDocumentVersion: document.version,
            currentPackageGeneration: initial.generation,
          });
        } catch (error) {
          patchError = String(error?.message ?? error);
        }
      }
      session.pending = patchPlan ? {
        document,
        source: document.getText(),
        documentVersion: document.version,
        packageGeneration: initial.generation,
        proposalResult,
        changeSet,
        patchPlan,
      } : null;
      post({
        type: "proposal",
        summary: proposalResult.proposal.summary,
        plan: proposalResult.proposal.plan,
        assumptions: proposalResult.proposal.assumptions,
        blockers: proposalResult.proposal.blockers,
        patchState: patchPlan ? "READY · local source patch only" :
          patchError ? "BLOCKED · patch planning failed" : "NOT_RUN",
        patchError,
        canApply: Boolean(patchPlan && proposalResult.proposal.blockers.length === 0),
        groups: patchPlan ? patchPlan.groups.map((group) => ({
          id: group.id,
          label: group.label,
          operationIds: group.operationIds,
          operations: changeSet.operations.filter((operation) =>
            group.operationIds.includes(operation.id)).map((operation) => ({
              type: operation.type,
              rationale: operation.rationale,
            })),
        })) : [],
      });
    } catch (error) {
      const aborted = error?.name === "AbortError" || controller.signal.aborted;
      post({
        type: "error",
        message: aborted ? "模型请求已取消。" : String(error?.message ?? error),
      });
    } finally {
      if (session?.controller === controller) session.controller = null;
      post({ type: "status", message: "请求结束。Compiler Check: NOT_RUN。", busy: false });
    }
  }

  async function handleApply(message) {
    if (!session?.pending) {
      post({ type: "error", message: "没有可应用的 READY Patch Plan。" });
      return;
    }
    if (!Array.isArray(message.groupIds) || message.groupIds.length === 0 ||
      message.groupIds.some((id) => typeof id !== "string")) {
      post({ type: "error", message: "请至少选择一个完整修改组。" });
      return;
    }
    const pending = session.pending;
    const document = pending.document;
    post({ type: "status", message: "正在检查文档与 Package revision…" });
    try {
      const current = await collectAuthoringState(document);
      if (document.version !== pending.documentVersion ||
        current.generation !== pending.packageGeneration ||
        document.getText() !== pending.source) {
        session.pending = null;
        await refreshContext();
        post({ type: "error", message: "文档或 Package 已变化，旧提案失效。请基于新上下文重新生成。" });
        return;
      }
      const materialized = await materializeAcceptedPatchGroups({
        source: pending.source,
        plan: pending.patchPlan,
        acceptedGroupIds: message.groupIds,
      });
      assertStudioMutation(document.uri, vscode.workspace.workspaceFolders ?? [], "edit");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        materialized.source,
      );
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error("Host rejected the native WorkspaceEdit; no save was attempted.");
      session.pending = null;
      post({
        type: "applied",
        acceptedGroupIds: materialized.acceptedGroupIds,
        documentVersion: document.version,
        saved: false,
        compilerCheck: "NOT_RUN",
      });
      await refreshContext();
    } catch (error) {
      post({ type: "error", message: String(error?.message ?? error) });
    }
  }

  async function open() {
    let document;
    try {
      document = await resolveProcedureDocument();
      if (!document) return false;
      if (panel) {
        session.document = document;
        panel.title = "AI Procedure Authoring";
        panel.reveal(vscode.ViewColumn.Active, false);
        await refreshContext();
        return true;
      }
      panel = vscode.window.createWebviewPanel(
        "skillStudio.aiAuthoring",
        "AI Procedure Authoring",
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      session = { document, context: null, pending: null, controller: null, disposed: false };
      panel.webview.options = { enableScripts: true, localResourceRoots: [] };
      panel.webview.html = renderAiAuthoringHtml(nonceValue());
      context.subscriptions.push(panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready" || message.type === "refresh") await refreshContext();
        else if (message.type === "generate") await handleGenerate(message);
        else if (message.type === "cancel") {
          session?.controller?.abort();
          post({ type: "status", message: "正在取消模型请求…" });
        } else if (message.type === "apply") await handleApply(message);
        else if (message.type === "discard") {
          if (session) session.pending = null;
          post({ type: "discarded" });
        }
      }));
      context.subscriptions.push(panel.onDidDispose(() => {
        if (session) {
          session.disposed = true;
          session.controller?.abort();
        }
        panel = null;
        session = null;
      }));
      context.subscriptions.push(panel);
      return true;
    } catch (error) {
      void vscode.window.showWarningMessage("AI Procedure Authoring： " + String(error?.message ?? error));
      return false;
    }
  }

  const command = vscode.commands.registerCommand("skillStudio.openAiAuthoring", open);
  context.subscriptions.push(command);
  return Object.freeze({ open });
}
