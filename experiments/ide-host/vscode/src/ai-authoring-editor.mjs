import {
  buildContextPack,
  MAX_CONTEXT_PACK_BYTES,
} from "../../../../authoring/core/context-pack.mjs";
import { createProcedureAgent } from "../../../../authoring/core/procedure-agent.mjs";
import { createGatewayModelClient, listGatewayModels, validateModelId } from "../../../../authoring/core/gateway-client.mjs";
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
import { createCompilerBuildRequest, COMPILER_LANGUAGE_TARGET, COMPILER_VERSION } from "./compiler-request.mjs";

const LANGUAGE_TARGET = COMPILER_LANGUAGE_TARGET;
const MAX_CONTEXT_ITEMS = 512;
const TEXT_DEPENDENCY_FILE = /\.(?:json|ya?ml|md)$/i;
const SENSITIVE_SEGMENT = /(?:^|[._-])(?:secrets?|credentials?|passwords?|api[-_]?keys?|private[-_]?keys?|access[-_]?tokens?|tokens?|auth)(?:[._-]|$)/i;
const GATEWAY_TOKEN_SECRET_KEY = "connectionAgent.skillStudio.ai.gatewayToken";
export const DEFAULT_AI_GATEWAY_URL = "http://127.0.0.1:8787/opencode-go/openai";
export const DEFAULT_AI_MODEL_ID = "deepseek-v4.1-flash";
const encoder = new TextEncoder();


/**
 * Model discovery and selection stay in the VS Code/Theia extension Host.
 * The Webview has connect-src 'none' and never receives a Gateway token.
 * Catalog failure is not fatal: the user can still enter a custom model ID.
 */
export async function chooseAiAuthoringModel(vscode, secrets, {
  discover = listGatewayModels,
} = {}) {
  if (typeof vscode?.window?.showQuickPick !== "function" ||
      typeof vscode.window.showInputBox !== "function") {
    throw new Error("The host model picker is unavailable.");
  }
  const settings = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai");
  const gatewayUrl = settings.get("gatewayUrl", DEFAULT_AI_GATEWAY_URL);
  const currentModel = settings.get("model", DEFAULT_AI_MODEL_ID);
  let models = [], discoveryAvailable = false;
  try {
    const gatewayToken = typeof secrets?.get === "function"
      ? await secrets.get(GATEWAY_TOKEN_SECRET_KEY) : undefined;
    models = await discover({ gatewayBaseUrl: gatewayUrl, gatewayToken });
    discoveryAvailable = models.length > 0;
  } catch {
    // Do not log provider responses, token or gateway error contents to UI.
  }
  const items = models.map(model => ({
    label: model.name,
    description: model.id,
    modelId: model.id,
  }));
  if (typeof currentModel === "string" && currentModel.trim() &&
      !items.some(item => item.modelId === currentModel.trim())) {
    items.unshift({
      label: currentModel.trim(),
      description: "当前配置的模型（未出现在 Gateway 列表）",
      modelId: currentModel.trim(),
    });
  }
  items.push({
    label: "手动输入模型 ID…",
    description: "可用于自定义 Gateway；模型列表不可用时仍可选择",
    manual: true,
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: "SKILL Studio · 选择 AI 模型",
    placeHolder: discoveryAvailable
      ? "来自已配置 Gateway 的模型列表；选择后记住设置"
      : "Gateway 模型列表不可用；可以继续使用当前模型或手动输入",
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!picked) return false;

  let modelId = picked.modelId;
  if (picked.manual) {
    modelId = await vscode.window.showInputBox({
      title: "SKILL Studio · 自定义模型 ID",
      prompt: "请输入当前 Gateway 支持的 OpenAI-compatible Chat Completions 模型 ID",
      value: typeof currentModel === "string" ? currentModel : DEFAULT_AI_MODEL_ID,
      ignoreFocusOut: true,
      validateInput: value => {
        try { validateModelId(value); return undefined; }
        catch { return "模型 ID 必须由英数字开头，仅含字母、数字、点、下划线、冒号、斜线或连字符。"; }
      },
    });
    if (modelId === undefined) return false;
  }
  modelId = validateModelId(modelId);
  if (modelId === currentModel) return false;
  if (typeof settings.update !== "function" || vscode.ConfigurationTarget?.Global === undefined) {
    throw new Error("无法保存应用级模型设置。");
  }
  await settings.update("model", modelId, vscode.ConfigurationTarget.Global);
  return true;
}

export async function configureAiGatewayToken(vscode, secrets) {
  if (!secrets || typeof secrets.store !== "function" || typeof secrets.delete !== "function") {
    throw new Error("Host SecretStorage is unavailable.");
  }
  if (typeof vscode?.window?.showInputBox !== "function") {
    throw new Error("Host input UI is unavailable.");
  }
  const value = await vscode.window.showInputBox({
    prompt: "配置共享 AI Gateway 访问令牌；留空可清除已有令牌",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "Gateway access token",
  });
  if (value === undefined) return false;
  if (typeof value !== "string") throw new TypeError("Gateway token must be text.");
  const token = value.trim();
  if (token && /[\u0000-\u001f\u007f]/.test(token)) {
    throw new TypeError("Gateway token must contain printable characters only.");
  }
  if (token) {
    await secrets.store(GATEWAY_TOKEN_SECRET_KEY, token);
    await vscode.window.showInformationMessage("已保存共享 AI Gateway 访问令牌。");
  } else {
    await secrets.delete(GATEWAY_TOKEN_SECRET_KEY);
    await vscode.window.showInformationMessage("已清除共享 AI Gateway 访问令牌。");
  }
  return true;
}

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
    })).sort((left, right) => left.path.localeCompare(right.path));
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
    files.sort((left, right) => left.path.localeCompare(right.path));
    const content = JSON.stringify({
      dependencyId: dependency.id,
      kind: dependency.kind,
      snapshotDigest: dependency.snapshotDigest,
      files,
    }, null, 2);
    const id = dependency.id;
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

export function containsWaitMutation(operations) {
  if (!Array.isArray(operations)) return false;
  return operations.some((operation) =>
    typeof operation?.type === "string" &&
    (operation.type.startsWith("node.wait.") ||
      (operation.type === "node.add" && operation.payload?.definition?.wait !== undefined))
  );
}

export function createAuthoringCompilerRequest(state, candidateSource) {
  if (!state?.snapshot || state.snapshot.completeness !== "complete" ||
    !state?.dependencies || state.dependencies.status !== "READY" ||
    typeof candidateSource !== "string") {
    throw new Error("A complete current Package and candidate Procedure are required for Compiler Check.");
  }
  const documents = (state.snapshot.documents ?? []).map((item) =>
    item.relativePath === "assurance/procedure.yaml"
      ? { ...item, text: candidateSource }
      : item
  );
  if (!documents.some((item) => item.relativePath === "assurance/procedure.yaml" &&
    item.text === candidateSource)) {
    throw new Error("The exact candidate Procedure is missing from the Compiler snapshot.");
  }
  const resolvedDependencies = (state.dependencies.snapshots ?? []).map((item) => ({
    dependencyId: item.id,
    digest: item.snapshotDigest,
    files: item.files ?? [],
  }));
  return createCompilerBuildRequest({
    packageName: state.snapshot.packageName,
    documents,
    resolvedDependencies,
  });
}

export async function createAuthoringCompilerCheck({
  compilerIntegration,
  state,
  document,
  changeSet,
  candidateSource,
  candidateDigest,
} = {}) {
  if (typeof compilerIntegration?.checkRequest !== "function") {
    throw new Error("The pinned CA-SL v1alpha5 Compiler Worker is unavailable.");
  }
  if (!document?.uri || !Number.isSafeInteger(document.version) ||
    !changeSet?.base || typeof candidateDigest !== "string") {
    throw new Error("The exact live document and Change Set identity are required for Compiler Check.");
  }
  let request;
  if (state.syntheticTrustedRequest) {
    // Only a Node extension Host can consume the pinned trusted fixture.
    // No browser Webview or model response can install this ephemeral state;
    // the backend acceptance command must first read the staged CI file.
    if (typeof process === "undefined" || !process.versions?.node) {
      throw new Error("Synthetic Compiler trust is forbidden outside isolated acceptance.");
    }
    const fixture = state.syntheticTrustedRequest;
    const sourcePath = "skills/example/assurance/procedure.yaml";
    const sourceFile = fixture.files?.find(item => item.path === sourcePath);
    if (!fixture.trustedBuildContext || !sourceFile ||
        Buffer.from(sourceFile.bytes, "base64").toString("utf8") !== state.procedure.text) {
      throw new Error("Synthetic compiler fixture is absent, altered or no longer current.");
    }
    request = {
      ...fixture,
      files: fixture.files.map(item => item.path === sourcePath
        ? { ...item, bytes: Buffer.from(candidateSource, "utf8").toString("base64") }
        : item),
    };
  } else {
    request = createAuthoringCompilerRequest(state, candidateSource);
  }
  const diagnostics = await compilerIntegration.checkRequest(request);
  if (!Array.isArray(diagnostics)) {
    throw new Error("Compiler Check did not return a complete Diagnostic array.");
  }
  const errorCount = diagnostics.filter((item) => item?.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item?.severity === "warning").length;
  return Object.freeze({
    compilerVersion: compilerIntegration.compilerVersion ?? COMPILER_VERSION,
    languageTarget: COMPILER_LANGUAGE_TARGET,
    state: errorCount === 0 ? "PASS" : "FAIL",
    complete: true,
    documentUri: document.uri.toString(),
    documentVersion: document.version,
    packageGeneration: state.generation,
    sourceDigest: changeSet.base.sourceDigest,
    candidateDigest,
    // Studio does not yet attach a trusted IngressCatalog binding to this request.
    // Wait-bearing candidates therefore remain preview-only even after static Check.
    trustedIngressBinding: false,
    diagnostics,
    errorCount,
    warningCount,
  });
}

export function isAuthoringApplyAllowed({
  patchPlan,
  changeSet,
  candidateDigest,
  blockers = [],
  waitMutation = false,
  compilerCheck = null,
} = {}) {
  // candidateDigest MUST be computed by the Host from the exact selected
  // atomic groups, not assumed from the all-groups Patch Plan candidate.
  // The Compiler result must identify this exact document / Package / source / candidate.
  const base = changeSet?.base;
  const exactCandidate = Boolean(
    base &&
    typeof candidateDigest === "string" &&
    compilerCheck?.documentUri === base.documentUri &&
    compilerCheck?.documentVersion === base.documentVersion &&
    compilerCheck?.packageGeneration === base.packageGeneration &&
    compilerCheck?.sourceDigest === base.sourceDigest &&
    compilerCheck?.candidateDigest === candidateDigest
  );
  return Boolean(
    patchPlan &&
    exactCandidate &&
    Array.isArray(blockers) &&
    blockers.length === 0 &&
    compilerCheck?.compilerVersion === COMPILER_VERSION &&
    compilerCheck?.languageTarget === LANGUAGE_TARGET &&
    compilerCheck?.state === "PASS" &&
    compilerCheck?.complete === true &&
    (!waitMutation || compilerCheck?.trustedIngressBinding === true)
  );
}

export async function applyAuthoringCandidateToBuffer(vscode, document, {
  source,
  documentVersion,
  candidateSource,
} = {}) {
  if (!document?.uri || !isProcedurePath(document.uri.path) ||
      typeof candidateSource !== "string" ||
      !isLiveDocumentRevision(document, { source, documentVersion })) {
    throw new Error("The current Procedure revision changed; refusing a stale native WorkspaceEdit.");
  }
  assertStudioMutation(document.uri, vscode.workspace.workspaceFolders ?? [], "edit");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri,
    new vscode.Range(document.positionAt(0),document.positionAt(source.length)),
    candidateSource);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied !== true) {
    throw new Error("Host rejected the native WorkspaceEdit; no save was attempted.");
  }
  return Object.freeze({ applied:true, saved:false });
}

export function isCurrentAuthoringSession(current, expected) {
  return Boolean(current && current === expected && current.disposed !== true);
}

export function isLiveDocumentRevision(document, revision) {
  return Boolean(document && revision &&
    Number.isSafeInteger(revision.documentVersion) &&
    typeof revision.source === "string" &&
    document.version === revision.documentVersion &&
    document.getText() === revision.source);
}

export function preferredProcedureDocument(activeDocument, workbenchDocument) {
  if (activeDocument && isProcedurePath(activeDocument.uri?.path)) return activeDocument;
  if (workbenchDocument && isProcedurePath(workbenchDocument.uri?.path)) return workbenchDocument;
  return null;
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
    ".source-preview{display:grid;grid-template-columns:1fr 1fr;gap:8px}.source-preview pre{margin:0;padding:8px;max-height:48vh;overflow:auto;white-space:pre;tab-size:2;font-family:var(--vscode-editor-font-family);font-size:11px;line-height:1.45;background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-panel-border);border-radius:4px}.source-preview h4{font-size:11px;margin:0 0 5px;color:var(--vscode-descriptionForeground)}",
    "@media(max-width:850px){.source-preview{grid-template-columns:1fr}}",
    ".compiler{font-size:11px;color:var(--vscode-descriptionForeground);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:4px 6px}",
    ".warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}",
    ".actions{margin-top:12px}",
    "@media(max-width:1050px){main{grid-template-columns:minmax(260px,1fr) minmax(280px,1fr)}.proposal{grid-column:1/-1}}",
    "@media(max-width:650px){header.topbar{align-items:flex-start;flex-direction:column}main{grid-template-columns:1fr}.proposal{grid-column:auto}}",
  ].join("\n");
  const script = [
    "const vscode=acquireVsCodeApi();",
    "const byId=id=>document.getElementById(id);",
    "let busy=false,canApply=false,contextReady=false,previewSequence=0;",
    "function status(text,kind){const el=byId('status');el.textContent=text||'';el.className='status '+(kind||'');}",
    "function setBusy(value){busy=value;byId('generate').disabled=value||!window.gatewayConfigured||!contextReady;byId('cancel').disabled=!value;byId('refresh').disabled=value;byId('chooseModel').disabled=value;byId('apply').disabled=value||!canApply;}",
    "function clear(el){while(el.firstChild)el.removeChild(el.firstChild);}",
    "function clearProposal(){canApply=false;previewSequence++;clear(byId('plan'));clear(byId('assumptions'));clear(byId('blockers'));clear(byId('groups'));byId('proposalSummary').textContent='';byId('currentSource').textContent='';byId('candidateSource').textContent='';byId('patchState').textContent='尚未生成';byId('patchError').textContent='';byId('compilerStatus').textContent='Compiler Check: NOT_RUN';byId('apply').disabled=true;byId('discard').disabled=true;}",
    "function addList(id,items){const root=byId(id);clear(root);if(!items||!items.length)return;const ul=document.createElement('ul');for(const value of items){const li=document.createElement('li');li.textContent=value;ul.appendChild(li);}root.appendChild(ul);}",
    "function requestSourcePreview(){const requestId=++previewSequence;const groupIds=[...document.querySelectorAll('[data-group-id]:checked')].map(item=>item.dataset.groupId);vscode.postMessage({type:'preview',requestId,groupIds});}",
    "function renderContext(message){contextReady=true;clearProposal();window.gatewayConfigured=message.gatewayConfigured===true;byId('modelLabel').textContent='当前模型：'+(message.modelId||'未配置');byId('packageInfo').textContent=message.packageName+' · '+message.documentVersion+' · Package revision '+message.packageGeneration;byId('gatewayNotice').textContent=window.gatewayConfigured?'Gateway 使用 '+(message.gatewayUrl||'已配置地址')+'；默认仅连接本机，选择模型会获取该 Gateway 的公开模型目录。Provider API Key 保留在 Gateway 主机。':'请检查 Gateway 和模型设置；本机默认 Gateway 为 127.0.0.1:8787，可以使用「选择模型」。';const list=byId('sources');clear(list);for(const item of message.sources||[]){const label=document.createElement('label');label.className='source';const input=document.createElement('input');input.type='checkbox';input.checked=item.selected===true;input.value=item.id;input.disabled=busy;const body=document.createElement('span');body.className='source-main';const kind=document.createElement('span');kind.className='kind';kind.textContent=item.kind;const name=document.createElement('span');name.className='source-label';name.textContent=item.label;const size=document.createElement('span');size.className='source-bytes';size.textContent=item.bytes+' bytes'+(item.explicitOptIn?' · 每次任务需显式选择':'');body.append(kind,name,size);label.append(input,body);list.appendChild(label);}status('上下文已就绪。发送前会再次显示明确的数据披露确认。');setBusy(false);}",
    "function renderProposal(message){previewSequence++;canApply=message.canApply===true;byId('proposalSummary').textContent=message.summary||'';byId('currentSource').textContent=message.currentSource||'';byId('candidateSource').textContent=message.candidateSource||'';addList('plan',message.plan||[]);addList('assumptions',message.assumptions||[]);addList('blockers',message.blockers||[]);byId('blockers').className=(message.blockers&&message.blockers.length)?'subsection warning':'subsection';byId('patchState').textContent=message.patchState||'NOT_RUN';byId('patchError').textContent=message.patchError||'';byId('compilerStatus').textContent='Compiler '+(message.compilerVersion||'v2.0.2')+' Check: '+(message.compilerState||'NOT_RUN');const list=byId('groups');clear(list);for(const group of message.groups||[]){const label=document.createElement('label');label.className='group';const input=document.createElement('input');input.type='checkbox';input.checked=true;input.value=group.id;input.dataset.groupId=group.id;input.addEventListener('change',requestSourcePreview);const body=document.createElement('span');body.className='group-main';const title=document.createElement('span');title.className='group-title';title.textContent=group.label+' · '+group.operationIds.length+' 项';const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='查看操作与理由';const ul=document.createElement('ul');for(const operation of group.operations||[]){const li=document.createElement('li');li.textContent=operation.type+' — '+operation.rationale;ul.appendChild(li);}details.append(summary,ul);body.append(title,details);label.append(input,body);list.appendChild(label);}byId('apply').disabled=!canApply||busy;byId('discard').disabled=false;status(canApply?'Compiler v2.0.2 对精确候选返回 PASS；可应用选中修改。':'提案已返回；请检查 Compiler Check 与阻塞项。',canApply?'':'warning');}",
    "byId('generate').addEventListener('click',()=>{const task=byId('task').value.trim();const selectedIds=[...document.querySelectorAll('#sources input:checked')].map(item=>item.value);clearProposal();vscode.postMessage({type:'generate',task,selectedIds});});",
    "byId('cancel').addEventListener('click',()=>vscode.postMessage({type:'cancel'}));",
    "byId('refresh').addEventListener('click',()=>{clearProposal();vscode.postMessage({type:'refresh'});});",
    "byId('chooseModel').addEventListener('click',()=>vscode.postMessage({type:'chooseModel'}));",
    "byId('apply').addEventListener('click',()=>{const groupIds=[...document.querySelectorAll('[data-group-id]:checked')].map(item=>item.dataset.groupId);vscode.postMessage({type:'apply',groupIds});});",
    "byId('discard').addEventListener('click',()=>vscode.postMessage({type:'discard'}));",
    "window.addEventListener('message',event=>{const message=event.data||{};if(message.type==='context')renderContext(message);else if(message.type==='status'){status(message.message,message.kind);if(message.busy!==undefined)setBusy(message.busy);}else if(message.type==='busy'){setBusy(message.busy===true);}else if(message.type==='proposal')renderProposal(message);else if(message.type==='preview'&&message.requestId===previewSequence){byId('candidateSource').textContent=message.candidateSource||'';byId('compilerStatus').textContent='Compiler '+(message.compilerVersion||'v2.0.2')+' Check: '+(message.compilerState||'NOT_RUN');byId('patchState').textContent=message.patchState||'PREVIEW ONLY';byId('patchError').textContent=message.patchError||'';canApply=message.canApply===true;byId('apply').disabled=busy||!canApply;status(canApply?'Compiler PASS；可应用当前选中组。':'当前选中组仍为 PREVIEW ONLY。',canApply?'':'warning');}else if(message.type==='error'){if(message.contextUnavailable===true){contextReady=false;clear(byId('sources'));clearProposal();}status(message.message,'error');setBusy(false);}else if(message.type==='applied'){canApply=false;byId('apply').disabled=true;byId('discard').disabled=true;status('已应用到原生编辑器缓冲区；尚未保存。Compiler Check: '+(message.compilerCheck||'UNAVAILABLE')+'。');}else if(message.type==='discarded'){clearProposal();status('提案已丢弃。');}});",
    "vscode.postMessage({type:'ready'});",
  ].join("\n");
  return [
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'none'; font-src 'none';\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>AI Procedure Authoring</title><style nonce=\"" + nonce + "\">" + css + "</style></head><body>",
    "<header class=\"topbar\"><div class=\"heading\"><strong>AI Procedure Authoring</strong><small id=\"packageInfo\">读取当前 Package…</small></div><div class=\"top-actions\"><span id=\"modelLabel\" class=\"compiler\">当前模型：读取中…</span><button id=\"chooseModel\" class=\"secondary\" title=\"从 Gateway 选择模型或手动输入模型 ID\">选择模型</button><span class=\"compiler\">CA-SL v1alpha5 · FROZEN / RELEASED</span><button id=\"refresh\" class=\"secondary\">刷新上下文</button></div></header>",
    "<main>",
    "<section class=\"card\"><h2>任务说明</h2><textarea id=\"task\" maxlength=\"4000\" placeholder=\"描述希望如何修改当前 Procedure。模型只会提出语义修改，不会直接写文件或执行 Tool。\"></textarea><div class=\"note\"><strong>数据披露：</strong>选中的上下文将在你确认后发送到配置的 AI Gateway。Provider API Key 只保留在 Gateway 主机。</div><div id=\"gatewayNotice\" class=\"note warning\"></div><div class=\"actions\"><button id=\"generate\">生成修改提案</button><button id=\"cancel\" class=\"secondary\" disabled>取消请求</button></div></section>",
    "<section class=\"card\"><h2>上下文来源</h2><p class=\"note\">Procedure 当前缓冲区必定包含。Contract、Predicate、Schema 和已验证依赖默认选中；Reference / Script 需要逐任务显式选择。</p><div id=\"sources\" class=\"source-list\"></div></section>",
    "<section class=\"card proposal\"><div class=\"top-actions spread\"><h2>修改提案</h2><span id=\"compilerStatus\" class=\"compiler\">Compiler Check: NOT_RUN</span></div><div id=\"proposalSummary\" class=\"summary\"></div><div class=\"subsection\"><h3>执行计划</h3><div id=\"plan\"></div></div><div class=\"subsection\"><h3>假设</h3><div id=\"assumptions\"></div></div><div class=\"subsection\"><h3>阻塞项</h3><div id=\"blockers\"></div></div><div class=\"subsection\"><h3>可独立接受的原子修改组</h3><div id=\"patchState\" class=\"kind\">尚未生成</div><div id=\"patchError\" class=\"note error\"></div><div id=\"groups\" class=\"group-list\"></div></div><div class=\"subsection\"><h3>Host 生成的 YAML 候选预览</h3><p class=\"note\">左侧是当前缓冲区，右侧是所选原子修改组生成的候选内容；模型不能直接提交原始 YAML。</p><div class=\"source-preview\"><div><h4>当前 YAML</h4><pre id=\"currentSource\"></pre></div><div><h4>候选 YAML</h4><pre id=\"candidateSource\"></pre></div></div></div><div class=\"actions\"><button id=\"apply\" disabled>应用选中修改</button><button id=\"discard\" class=\"secondary\" disabled>丢弃提案</button></div></section>",
    "</main><footer class=\"status\"><span id=\"status\">正在初始化…</span><span>仅修改当前 Procedure 缓冲区 · 不自动保存 · 每个候选都必须通过 Compiler v2.0.2 Check；Wait 还需要可信 IngressCatalog 绑定</span></footer>",
    "<script nonce=\"" + nonce + "\">" + script + "</script></body></html>",
  ].join("\n");
}

export function registerAiAuthoringEditor(vscode, context, { getActiveDocument, compilerIntegration } = {}) {
  const revisionFor = createPackageRevisionTracker();
  let panel = null;
  let session = null;
  let syntheticFixture = null;
  let syntheticFingerprint = null;
  let syntheticGeneration = 0;

  function installSyntheticFixture({documentUri, original, trusted} = {}) {
    if (typeof process === "undefined" || !process.versions?.node) {
      throw new Error("Synthetic Editor Tab fixture requires a Node extension host and staged pinned CI fixture.");
    }
    if (typeof documentUri !== "string" ||
        !documentUri.includes("/.studio-ai-acceptance/skills/example/assurance/procedure.yaml") ||
        typeof original !== "string" || !original.includes("FAIL: SAFE_STOPPED") ||
        !trusted?.trustedBuildContext || !Array.isArray(trusted.files)) {
      throw new TypeError("Only an isolated pinned synthetic acceptance fixture is allowed.");
    }
    const file = trusted.files.find(item => item.path === "skills/example/assurance/procedure.yaml");
    if (!file || Buffer.from(file.bytes, "base64").toString("utf8") !== original) {
      throw new Error("Synthetic Editor Tab fixture and trusted Compiler source differ.");
    }
    syntheticFixture = { documentUri, original, trusted };
    syntheticFingerprint = null;
    syntheticGeneration = 0;
  }

  function clearSyntheticFixture() {
    syntheticFixture = null;
    syntheticFingerprint = null;
    syntheticGeneration = 0;
  }

  function post(message) {
    if (panel && session && !session.disposed) void panel.webview.postMessage(message);
  }

  async function resolveProcedureDocument() {
    const active = vscode.window.activeTextEditor?.document ?? null;
    const workbenchDocument = getActiveDocument?.() ?? null;
    const preferred = preferredProcedureDocument(active, workbenchDocument);
    if (preferred) return preferred;
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
    if (syntheticFixture?.documentUri === document.uri.toString()) {
      const text = document.getText();
      if (syntheticFingerprint !== text) {
        syntheticFingerprint = text;
        syntheticGeneration += 1;
      }
      const procedure = { relativePath: "assurance/procedure.yaml", text,
        version: document.version };
      const snapshot = {
        completeness: "complete", rootUri: syntheticFixture.documentUri,
        packageName: "example", generation: syntheticGeneration,
        documents: [procedure],
      };
      return {
        snapshot, dependencies: { status: "READY", snapshots: [] },
        generation: syntheticGeneration, procedure, resources: [],
        // After an Apply this becomes normal read-only preview; no second
        // Compiler trust is silently conferred to a mutated fixture.
        ...(text === syntheticFixture.original
          ? { syntheticTrustedRequest: syntheticFixture.trusted } : {}),
      };
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
    const activeSession = session;
    if (!isCurrentAuthoringSession(session, activeSession)) return;
    const document = activeSession.document;
    const requestId = (activeSession.contextRequestId ?? 0) + 1;
    activeSession.contextRequestId = requestId;
    activeSession.pending = null;
    post({ type: "status", message: "正在读取当前 Procedure、Package 文件和锁定依赖…", busy: true });
    try {
      const state = await collectAuthoringState(document);
      if (!isCurrentAuthoringSession(session, activeSession) ||
        activeSession.contextRequestId !== requestId) return;
      activeSession.context = state;
      activeSession.pending = null;
      const aiSettings = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai");
      const gatewayBaseUrl = aiSettings.get("gatewayUrl", DEFAULT_AI_GATEWAY_URL);
      const modelId = aiSettings.get("model", DEFAULT_AI_MODEL_ID);
      const gatewayConfigured = typeof gatewayBaseUrl === "string" && gatewayBaseUrl.trim().length > 0 &&
        typeof modelId === "string" && modelId.trim().length > 0;
      post({
        type: "context",
        languageTarget: LANGUAGE_TARGET,
        packageName: state.snapshot.packageName,
        documentVersion: document.version,
        packageGeneration: state.generation,
        gatewayConfigured,
        gatewayUrl: typeof gatewayBaseUrl === "string" ? gatewayBaseUrl.trim() : "",
        modelId: typeof modelId === "string" ? modelId.trim() : "",
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
      if (!isCurrentAuthoringSession(session, activeSession) ||
        activeSession.contextRequestId !== requestId) return;
      activeSession.context = null;
      activeSession.pending = null;
      post({ type: "error", message: String(error?.message ?? error), contextUnavailable: true });
    }
  }

  async function handleChooseModel() {
    const activeSession = session;
    const isCurrent = () => isCurrentAuthoringSession(session, activeSession);
    if (!isCurrent() || activeSession.choosingModel ||
        activeSession.generating || activeSession.applying || activeSession.controller) return;
    activeSession.choosingModel = true;
    post({ type: "status", message: "正在读取 Gateway 模型列表；此操作不发送 Procedure 内容…" });
    try {
      const updated = await chooseAiAuthoringModel(vscode, context.secrets);
      if (!isCurrent()) return;
      if (updated) {
        activeSession.pending = null;
        await refreshContext();
        if (isCurrent()) post({ type: "status", message: "模型选择已保存；下次生成将使用新模型。" });
      } else {
        post({ type: "status", message: "模型选择未改变。" });
      }
    } catch {
      if (isCurrent()) post({ type: "error", message: "无法保存模型选择，请检查 Studio 应用设置。" });
    } finally {
      if (isCurrent()) activeSession.choosingModel = false;
    }
  }

  async function handleGenerate(message) {
    const activeSession = session;
    const isCurrent = () => isCurrentAuthoringSession(session, activeSession);
    if (!isCurrent() || !activeSession.context) {
      post({ type: "error", message: "当前上下文尚未就绪，请先刷新。" });
      return;
    }
    if (activeSession.choosingModel) {
      post({ type: "error", message: "正在选择模型，请完成模型选择后再生成。" });
      return;
    }
    if (activeSession.generating || activeSession.controller) {
      post({ type: "error", message: "已有模型请求正在准备或运行。" });
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
      [...selectedIds].some((id) => !activeSession.context.resources.some((item) => item.id === id))) {
      post({ type: "error", message: "上下文来源包含重复或未知项目。" });
      return;
    }
    const aiSettings = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai");
    const gatewayBaseUrl = aiSettings.get("gatewayUrl", DEFAULT_AI_GATEWAY_URL);
    const modelId = aiSettings.get("model", DEFAULT_AI_MODEL_ID);
    if (typeof gatewayBaseUrl !== "string" || !gatewayBaseUrl.trim() ||
      typeof modelId !== "string" || !modelId.trim()) {
      post({ type: "error", message: "尚未配置 AI Gateway。请在应用设置中填写 connectionAgent.skillStudio.ai.gatewayUrl 和 connectionAgent.skillStudio.ai.model。" });
      return;
    }

    activeSession.generating = true;
    activeSession.pending = null;
    const document = activeSession.document;
    const initial = activeSession.context;
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
      if (!isCurrent()) return;
    } catch (error) {
      if (!isCurrent()) return;
      activeSession.generating = false;
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
    if (!isCurrent()) return;
    if (confirmed !== "发送并生成提案") {
      activeSession.generating = false;
      post({ type: "status", message: "已取消发送；没有向模型发送数据。" });
      return;
    }

    try {
      const current = await collectAuthoringState(document);
      if (!isCurrent()) return;
      if (document.version !== initial.procedure.version ||
        current.generation !== initial.generation ||
        document.getText() !== initial.procedure.text) {
        activeSession.generating = false;
        await refreshContext();
        if (isCurrent()) {
          post({ type: "error", message: "生成期间 Package 或 Procedure 已变化。上下文已刷新，请重新检查后再生成。" });
        }
        return;
      }
    } catch (error) {
      if (!isCurrent()) return;
      activeSession.generating = false;
      post({ type: "error", message: String(error?.message ?? error) });
      return;
    }

    if (!isCurrent()) return;
    const controller = new AbortController();
    activeSession.controller = controller;
    post({ type: "status", message: "正在请求模型并校验语义提案…", busy: true });
    try {
      const gatewayToken = typeof context.secrets?.get === "function"
        ? await context.secrets.get(GATEWAY_TOKEN_SECRET_KEY)
        : undefined;
      const modelClient = createGatewayModelClient({
        gatewayBaseUrl: gatewayBaseUrl.trim(),
        modelId: modelId.trim(),
        gatewayToken,
        sessionId: activeSession.sessionId,
      });
      const agent = createProcedureAgent({ modelClient });
      const proposalResult = await agent.propose({
        task,
        contextPack: contextPack.pack,
        contextManifest: contextPack.manifest,
        contextDisclosureAccepted: true,
        signal: controller.signal,
        maxTokens: 2048,
      });
      if (!isCurrent()) return;
      const current = await collectAuthoringState(document);
      if (!isCurrent()) return;
      if (document.version !== initial.procedure.version ||
        current.generation !== initial.generation ||
        document.getText() !== initial.procedure.text) {
        await refreshContext();
        if (isCurrent()) {
          post({ type: "error", message: "模型响应期间 Package 或 Procedure 已变化。提案已丢弃，没有应用任何修改。" });
        }
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
      let candidateSource = null;
      let candidateDigest = null;
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
          if (!isCurrent()) return;
          const preview = await materializeAcceptedPatchGroups({
            source: document.getText(),
            plan: patchPlan,
            acceptedGroupIds: patchPlan.groups.map((group) => group.id),
          });
          if (!isCurrent()) return;
          candidateSource = preview.source;
          candidateDigest = preview.digest;
        } catch (error) {
          if (!isCurrent()) return;
          patchError = String(error?.message ?? error);
        }
      }
      if (!isCurrent()) return;
      const waitGate = containsWaitMutation(changeSet.operations);
      let compilerCheck = null;
      let compilerCheckError = null;
      if (patchPlan && candidateSource !== null && candidateDigest) {
        try {
          compilerCheck = await createAuthoringCompilerCheck({
            compilerIntegration,
            state: initial,
            document,
            changeSet,
            candidateSource,
            candidateDigest,
          });
        } catch (error) {
          compilerCheckError = String(error?.message ?? error);
        }
      }
      if (!isCurrent()) return;
      const canApply = isAuthoringApplyAllowed({
        patchPlan,
        changeSet,
        candidateDigest,
        blockers: proposalResult.proposal.blockers,
        waitMutation: waitGate,
        compilerCheck,
      });
      activeSession.pending = patchPlan ? {
        document,
        source: document.getText(),
        documentVersion: document.version,
        packageGeneration: initial.generation,
        proposalResult,
        changeSet,
        patchPlan,
        state: initial,
        candidateSource,
        candidateDigest,
        compilerCheck,
        canApply,
      } : null;
      post({
        type: "proposal",
        summary: proposalResult.proposal.summary,
        plan: proposalResult.proposal.plan,
        assumptions: proposalResult.proposal.assumptions,
        blockers: proposalResult.proposal.blockers,
        compilerVersion: compilerCheck?.compilerVersion ?? COMPILER_VERSION,
        compilerState: compilerCheck?.state ?? "UNAVAILABLE",
        patchState: patchPlan
          ? (canApply ? "READY · Compiler v2.0.2 PASS" :
            waitGate ? "PREVIEW ONLY · trusted IngressCatalog binding required" :
            compilerCheck?.state === "FAIL" ? "BLOCKED · Compiler Check failed" :
            "PREVIEW ONLY · Compiler Check unavailable")
          : patchError ? "BLOCKED · patch planning failed" : "NOT_RUN",
        patchError: compilerCheckError ??
          (waitGate
            ? "Wait edits additionally require a trusted IngressCatalog v1alpha1 Owner binding. Static Check alone does not establish that trust."
            : compilerCheck?.state === "FAIL"
              ? compilerCheck.diagnostics.slice(0, 6).map(item =>
                (item.code ? item.code + ": " : "") + item.message).join("\\n")
              : canApply ? "" :
                patchPlan ? "Compiler v2.0.2 Check is unavailable; no AI-generated change can be applied."
                  : patchError),
        canApply,
        currentSource: patchPlan ? document.getText() : "",
        candidateSource: candidateSource ?? "",
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
      if (!isCurrent()) return;
      const aborted = error?.name === "AbortError" || controller.signal.aborted;
      post({
        type: "error",
        message: aborted ? "模型请求已取消。" : String(error?.message ?? error),
      });
    } finally {
      if (isCurrent()) {
        if (activeSession.controller === controller) activeSession.controller = null;
        activeSession.generating = false;
        // Do not overwrite a Proposal or error with a generic terminal status.
        post({ type: "busy", busy: false });
      }
    }
  }

  async function handlePreview(message) {
    const activeSession = session;
    const isCurrent = () => isCurrentAuthoringSession(session, activeSession);
    if (!isCurrent() || !activeSession.pending) return;
    if (!Array.isArray(message.groupIds) ||
      message.groupIds.some((id) => typeof id !== "string") ||
      !Number.isSafeInteger(message.requestId)) {
      post({ type: "error", message: "预览修改组选择无效。" });
      return;
    }
    const pending = activeSession.pending;
    activeSession.previewRequestId = message.requestId;
    if (!isLiveDocumentRevision(pending.document, pending)) {
      activeSession.pending = null;
      post({ type: "error", message: "Procedure 已变化，候选预览失效；请重新生成提案。" });
      return;
    }
    try {
      const preview = await materializeAcceptedPatchGroups({
        source: pending.source,
        plan: pending.patchPlan,
        acceptedGroupIds: message.groupIds,
      });
      if (!isCurrent() || activeSession.pending !== pending ||
        activeSession.previewRequestId !== message.requestId) return;
      if (!isLiveDocumentRevision(pending.document, pending)) {
        activeSession.pending = null;
        post({ type: "error", message: "Procedure 在候选预览生成期间发生变化，旧预览已失效。请刷新上下文并重新生成。" });
        return;
      }
      let compilerCheck = null;
      let compilerCheckError = null;
      try {
        compilerCheck = await createAuthoringCompilerCheck({
          compilerIntegration,
          state: pending.state,
          document: pending.document,
          changeSet: pending.changeSet,
          candidateSource: preview.source,
          candidateDigest: preview.digest,
        });
      } catch (error) {
        compilerCheckError = String(error?.message ?? error);
      }
      if (!isCurrent() || activeSession.pending !== pending ||
        activeSession.previewRequestId !== message.requestId) return;
      if (!isLiveDocumentRevision(pending.document, pending)) {
        activeSession.pending = null;
        post({ type: "error", message: "Compiler Check 完成前 Procedure 已变化；旧候选已失效。" });
        return;
      }
      const waitGate = containsWaitMutation(pending.changeSet.operations);
      const canApply = message.groupIds.length > 0 && isAuthoringApplyAllowed({
        patchPlan: pending.patchPlan,
        changeSet: pending.changeSet,
        candidateDigest: preview.digest,
        blockers: pending.proposalResult.proposal.blockers,
        waitMutation: waitGate,
        compilerCheck,
      });
      pending.candidateSource = preview.source;
      pending.candidateDigest = preview.digest;
      pending.compilerCheck = compilerCheck;
      pending.canApply = canApply;
      post({
        type: "preview",
        requestId: message.requestId,
        candidateSource: preview.source,
        compilerVersion: compilerCheck?.compilerVersion ?? COMPILER_VERSION,
        compilerState: compilerCheck?.state ?? "UNAVAILABLE",
        canApply,
        patchState: canApply ? "READY · Compiler v2.0.2 PASS" :
          waitGate ? "PREVIEW ONLY · trusted IngressCatalog binding required" :
          compilerCheck?.state === "FAIL" ? "BLOCKED · Compiler Check failed" :
          "PREVIEW ONLY · Compiler Check unavailable",
        patchError: compilerCheckError ??
          (waitGate
            ? "Wait edits additionally require a trusted IngressCatalog v1alpha1 Owner binding. Static Check alone does not establish that trust."
            : compilerCheck?.state === "FAIL"
              ? compilerCheck.diagnostics.slice(0, 6).map(item =>
                (item.code ? item.code + ": " : "") + item.message).join("\\n")
              : canApply ? "" : "Compiler v2.0.2 Check did not return a complete PASS for this exact candidate."),
      });
    } catch (error) {
      if (!isCurrent() || activeSession.pending !== pending) return;
      post({ type: "error", message: "候选 YAML 生成失败：" + String(error?.message ?? error) });
    }
  }

  async function handleApply(message) {
    const activeSession = session;
    const isCurrent = () => isCurrentAuthoringSession(session, activeSession);
    if (!isCurrent()) return;
    if (activeSession.applying) {
      post({ type: "error", message: "正在应用已选修改，请稍候。" });
      return;
    }
    if (!activeSession.pending) {
      post({ type: "error", message: "没有可应用的 READY Patch Plan。" });
      return;
    }
    if (!Array.isArray(message.groupIds) || message.groupIds.length === 0 ||
      message.groupIds.some((id) => typeof id !== "string")) {
      post({ type: "error", message: "请至少选择一个完整修改组。" });
      return;
    }
    const pending = activeSession.pending;
    let appliedCompilerState = "NOT_RUN";
    if (pending.canApply !== true) {
      post({ type: "error", message: "该提案目前仅可预览。必须先由完整、权威的 CA-SL v1alpha5 Compiler 对同一候选 Package 返回 PASS，才能启用 Apply。" });
      return;
    }
    activeSession.applying = true;
    const document = pending.document;
    post({ type: "status", message: "正在检查文档与 Package revision…", busy: true });
    try {
      const current = await collectAuthoringState(document);
      if (!isCurrent()) return;
      if (document.version !== pending.documentVersion ||
        current.generation !== pending.packageGeneration ||
        document.getText() !== pending.source) {
        activeSession.pending = null;
        await refreshContext();
        if (isCurrent()) {
          post({ type: "error", message: "文档或 Package 已变化，旧提案失效。请基于新上下文重新生成。" });
        }
        return;
      }
      const materialized = await materializeAcceptedPatchGroups({
        source: pending.source,
        plan: pending.patchPlan,
        acceptedGroupIds: message.groupIds,
      });
      if (!isCurrent() || activeSession.pending !== pending) return;
      const finalState = await collectAuthoringState(document);
      if (!isCurrent() || activeSession.pending !== pending) return;
      if (!isLiveDocumentRevision(document, pending) ||
        finalState.generation !== pending.packageGeneration) {
        activeSession.pending = null;
        await refreshContext();
        if (isCurrent()) {
          post({ type: "error", message: "生成候选后 Procedure 或 Package 再次变化，已拒绝应用旧修改。请检查新上下文并重新生成。" });
        }
        return;
      }
      const compilerCheck = await createAuthoringCompilerCheck({
        compilerIntegration,
        state: finalState,
        document,
        changeSet: pending.changeSet,
        candidateSource: materialized.source,
        candidateDigest: materialized.digest,
      });
      appliedCompilerState = compilerCheck.state;
      if (!isCurrent() || activeSession.pending !== pending) return;
      const afterCheckState = await collectAuthoringState(document);
      if (!isCurrent() || activeSession.pending !== pending) return;
      if (!isLiveDocumentRevision(document, pending) ||
        afterCheckState.generation !== pending.packageGeneration) {
        activeSession.pending = null;
        await refreshContext();
        if (isCurrent()) {
          post({ type: "error", message: "Compiler Check 期间 Procedure 或 Package 发生变化，已拒绝应用旧候选。" });
        }
        return;
      }
      pending.compilerCheck = compilerCheck;
      const selectedCandidateAllowed = isAuthoringApplyAllowed({
        patchPlan: pending.patchPlan,
        changeSet: pending.changeSet,
        candidateDigest: materialized.digest,
        blockers: pending.proposalResult.proposal.blockers,
        waitMutation: containsWaitMutation(pending.changeSet.operations),
        compilerCheck,
      });
      if (!selectedCandidateAllowed) {
        pending.canApply = false;
        post({ type: "error", message: compilerCheck.state === "FAIL"
          ? "Compiler v2.0.2 对所选候选返回 FAIL： " +
            compilerCheck.diagnostics.slice(0, 6).map(item =>
              (item.code ? item.code + ": " : "") + item.message).join("; ")
          : "所选候选没有获得完整、精确匹配的 v2.0.2 Compiler PASS；仍保持 PREVIEW ONLY。" });
        return;
      }
      await applyAuthoringCandidateToBuffer(vscode, document, {
        source: pending.source,
        documentVersion: pending.documentVersion,
        candidateSource: materialized.source,
      });
      if (!isCurrent()) return;
      activeSession.pending = null;
      post({
        type: "applied",
        acceptedGroupIds: materialized.acceptedGroupIds,
        documentVersion: document.version,
        saved: false,
        compilerCheck: appliedCompilerState,
      });
      await refreshContext();
    } catch (error) {
      if (!isCurrent()) return;
      post({ type: "error", message: String(error?.message ?? error) });
    } finally {
      if (isCurrent()) {
        activeSession.applying = false;
        post({ type: "busy", busy: false });
      }
    }
  }

  async function open() {
    let document;
    try {
      document = await resolveProcedureDocument();
      if (!document) return false;
      if (panel) {
        if (!session || session.document !== document) {
          if (session) {
            session.disposed = true;
            session.controller?.abort();
          }
          session = {
            document,
            sessionId: globalThis.crypto.randomUUID(),
            context: null,
            pending: null,
            controller: null,
            disposed: false,
            generating: false,
            applying: false,
            choosingModel: false,
            contextRequestId: 0,
          };
        }
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
      session = {
        document,
        sessionId: globalThis.crypto.randomUUID(),
        context: null,
        pending: null,
        controller: null,
        disposed: false,
        generating: false,
        applying: false,
        choosingModel: false,
        contextRequestId: 0,
      };
      panel.webview.options = { enableScripts: true, localResourceRoots: [] };
      panel.webview.html = renderAiAuthoringHtml(nonceValue());
      context.subscriptions.push(panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready" || message.type === "refresh") await refreshContext();
        else if (message.type === "generate") await handleGenerate(message);
        else if (message.type === "chooseModel") await handleChooseModel();
        else if (message.type === "cancel") {
          session?.controller?.abort();
          post({ type: "status", message: "正在取消模型请求…" });
        } else if (message.type === "preview") await handlePreview(message);
        else if (message.type === "apply") await handleApply(message);
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
  const gatewayTokenCommand = vscode.commands.registerCommand("skillStudio.setAiGatewayToken", async () => {
    try {
      await configureAiGatewayToken(vscode, context.secrets);
    } catch (error) {
      void vscode.window.showErrorMessage("配置共享 AI Gateway 访问令牌失败：" + String(error?.message ?? error));
    }
  });
  const gatewayAcceptanceCommand =
    typeof process !== "undefined" && Boolean(process.versions?.node)
      ? vscode.commands.registerCommand("skillStudio.internal.configureAiGatewayAcceptance",
        async ({ gatewayUrl = "", modelId = "deepseek-v4.1-flash" } = {}) => {
          // The acceptance fixture is staged only in isolated backend CI.
          // No production installation can update settings via this command.
          await vscode.workspace.fs.stat(vscode.Uri.joinPath(context.extensionUri,
            "dist", "authoring-trusted-build-request.json"));
          if (typeof gatewayUrl !== "string" || typeof modelId !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(modelId)) {
            throw new TypeError("Invalid AI Gateway acceptance configuration.");
          }
          if (gatewayUrl) {
            const parsed = new URL(gatewayUrl);
            if (parsed.protocol !== "http:" ||
                !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
                parsed.username || parsed.password || parsed.search || parsed.hash ||
                parsed.pathname === "/" || !parsed.pathname) {
              throw new TypeError("AI Gateway acceptance may target only an HTTP loopback route.");
            }
          }
          const settings = vscode.workspace.getConfiguration("connectionAgent.skillStudio.ai");
          const target = vscode.ConfigurationTarget?.Global;
          if (target === undefined || typeof settings?.update !== "function") {
            throw new Error("Application-scoped AI Gateway settings cannot be updated by the acceptance host.");
          }
          await settings.update("gatewayUrl", gatewayUrl, target);
          await settings.update("model", modelId, target);
          return true;
        })
      : null;
  context.subscriptions.push(command, gatewayTokenCommand);
  if (gatewayAcceptanceCommand) context.subscriptions.push(gatewayAcceptanceCommand);
  return Object.freeze({
    open,
    configureAiGatewayToken: () => configureAiGatewayToken(vscode, context.secrets),
    ...(typeof process !== "undefined" && process.versions?.node
      ? { installSyntheticFixture, clearSyntheticFixture }
      : {}),
  });
}
