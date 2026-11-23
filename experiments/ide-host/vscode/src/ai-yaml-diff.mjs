// AI Workbench F3: a private, read-only Monaco DiffEditor inside the existing Editor Tab.
// It never shares Monaco models with the native source editor or writes workspace files.
import * as monaco from "monaco-editor/editor/editor.api";
import "../../../../node_modules/monaco-editor/min/vs/editor/editor.main.css";

const MAX_DIFF_BYTES = 256 * 1024;
const encoder = new TextEncoder();
let editor = null;
let originalModel = null;
let modifiedModel = null;
let mode = "side-by-side";
let currentIdentity = "";

function setupYaml() {
  if (monaco.languages.getLanguages().some(item => item.id === "yaml")) return;
  // Review-only highlighting; the pinned CA-SL Compiler remains authoritative.
  monaco.languages.register({ id: "yaml", extensions: [".yaml", ".yml"] });
  monaco.languages.setMonarchTokensProvider("yaml", {
    tokenizer: {
      root: [
        [/^\s*#.*$/, "comment"],
        [/#.*$/, "comment"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^']|'')*'/, "string"],
        [/\b(?:true|false|null|PASS|FAIL)\b/, "keyword"],
        [/-?\d+(?:\.\d+)?/, "number"],
        [/[A-Za-z_][\w.-]*(?=\s*:)/, "key"],
      ],
    },
  });
}

function hide() {
  document.getElementById("monacoDiffSurface").hidden = true;
  document.getElementById("diffRows").hidden = false;
}

function disposeModels() {
  editor?.setModel(null);
  originalModel?.dispose();
  modifiedModel?.dispose();
  originalModel = null;
  modifiedModel = null;
}

function clear() {
  currentIdentity = "";
  disposeModels();
  hide();
}

function ensureEditor() {
  if (editor) return editor;
  setupYaml();
  editor = monaco.editor.createDiffEditor(document.getElementById("monacoDiffSurface"), {
    readOnly: true,
    originalEditable: false,
    renderSideBySide: mode === "side-by-side",
    useInlineViewWhenSpaceIsLimited: true,
    renderOverviewRuler: true,
    lineNumbers: "on",
    scrollBeyondLastLine: false,
    ignoreTrimWhitespace: false,
    diffAlgorithm: "advanced",
    automaticLayout: true,
    minimap: { enabled: false },
    links: false,
    wordWrap: "off",
    folding: true,
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 5, revealLineCount: 12 },
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
    accessibilitySupport: "auto",
  });
  return editor;
}

function render({ baseSource, candidateSource, identity } = {}) {
  // Source is supplied solely by the Host Patch Engine; never a model-authored YAML blob.
  if (typeof baseSource !== "string" || typeof candidateSource !== "string" ||
      typeof identity !== "string" || !identity) {
    clear();
    return { available: false, reason: "没有精确的 Host 候选快照。" };
  }
  if (encoder.encode(baseSource).byteLength > MAX_DIFF_BYTES ||
      encoder.encode(candidateSource).byteLength > MAX_DIFF_BYTES) {
    clear();
    return { available: false, reason: "文件超过 Monaco 审阅上限（每侧 256 KiB），使用限量行 Diff 与完整源码检查。" };
  }
  try {
    ensureEditor();
    disposeModels();
    originalModel = monaco.editor.createModel(baseSource, "yaml",
      monaco.Uri.parse("inmemory://studio-ai-review/current.yaml"));
    modifiedModel = monaco.editor.createModel(candidateSource, "yaml",
      monaco.Uri.parse("inmemory://studio-ai-review/candidate.yaml"));
    editor.setModel({ original: originalModel, modified: modifiedModel });
    currentIdentity = identity;
    document.getElementById("monacoDiffSurface").hidden = false;
    document.getElementById("diffRows").hidden = true;
    editor.layout();
    return { available: true };
  } catch (error) {
    clear();
    return { available: false, reason: "Monaco 无法在当前 Host 初始化；已回退到原始行 Diff。" };
  }
}

function setMode(next) {
  if (!["side-by-side", "inline"].includes(next)) return;
  mode = next;
  editor?.updateOptions({ renderSideBySide: mode === "side-by-side" });
  editor?.layout();
}

function jump(direction) {
  if (!editor || !currentIdentity || !["previous", "next"].includes(direction)) return false;
  const modified = editor.getModifiedEditor?.();
  const changes = editor.getLineChanges?.() ?? [];
  if (!modified || !Array.isArray(changes) || changes.length === 0) return false;
  const positions = [...new Set(changes.map(change =>
    Math.max(1, change.modifiedStartLineNumber ?? 1)))].sort((x,y)=>x-y);
  const here = modified.getPosition()?.lineNumber ?? 1;
  const target = direction === "next"
    ? (positions.find(line=>line>here) ?? positions[0])
    : ([...positions].reverse().find(line=>line<here) ?? positions[positions.length-1]);
  if (!Number.isSafeInteger(target)) return false;
  modified.revealLineInCenter(target);
  modified.setPosition({ lineNumber: target, column: 1 });
  return true;
}

function resize() {
  if (!document.getElementById("monacoDiffSurface").hidden) editor?.layout();
}

window.skillStudioAiYamlDiff = Object.freeze({
  render, clear, resize, setMode, jump,
  get identity() { return currentIdentity; },
});

window.addEventListener("unload", () => {
  clear();
  editor?.dispose();
  editor = null;
});
