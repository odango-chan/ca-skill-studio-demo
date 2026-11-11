// E1-A2: Monaco is a view over the same Source working copy. It is never
// a second persistent representation of SKILL text or the transaction history.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/register.all";
import {monacoLanguageForPath} from "./monaco-language.mjs";
import {configureMonacoYaml} from "monaco-yaml";
import {createOwnerYamlSchemas} from "./yaml-owner-schemas.mjs";
import {yamlSchemaCapability} from "./yaml-schema-policy.mjs";
import {registerSkillSemanticTokens} from "./skill-semantic-tokens.mjs";
import studioLightTheme from "../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json";
import {standaloneSemanticTokenRules} from "./semantic-token-theme.mjs";
const languageId = monacoLanguageForPath;
let yamlLanguageService = null;
let monacoWorkerCompatibilityInstalled = false;

// monaco-yaml 5.x / monaco-worker-manager 2.x still use the legacy
// {moduleId, label, createData} createWebWorker contract. Monaco's tree-shaken
// editor API expects {worker, ...}; its full editor.main entry normally wraps
// this call, but importing that entry would defeat Studio's small Monaco build.
// Bridge the legacy contract here, following the upstream compatibility fix:
// microsoft/monaco-editor#5049 and remcohaszing/monaco-yaml#272.
function ensureMonacoWorkerCompatibility() {
  if (monacoWorkerCompatibilityInstalled) return;
  const createWebWorker = monaco.editor.createWebWorker.bind(monaco.editor);
  monaco.editor.createWebWorker = options => {
    if (Object.prototype.hasOwnProperty.call(options, "worker")) {
      return createWebWorker(options);
    }
    const getWorker = globalThis.MonacoEnvironment?.getWorker;
    if (typeof getWorker !== "function") {
      throw new Error("MonacoEnvironment.getWorker is required for YAML language services");
    }
    const workerOrPromise = getWorker(
      options.moduleId,
      options.label ?? "monaco-editor-worker"
    );
    if (!workerOrPromise) {
      throw new Error("MonacoEnvironment.getWorker returned no worker for " + options.label);
    }
    const worker = Promise.resolve(workerOrPromise).then(instance => {
      if (!instance || typeof instance.postMessage !== "function") {
        throw new TypeError("Monaco worker factory must return a Worker");
      }
      // The first message boots Monaco's worker host; the second carries
      // monaco-worker-manager's createData for the YAML worker initializer.
      instance.postMessage("ignore");
      instance.postMessage(options.createData);
      return instance;
    });
    return createWebWorker({...options, worker});
  };
  monacoWorkerCompatibilityInstalled = true;
}

// Monaco may render menus in an overlay or a shadow root. Theme tokens must
// reach those layers; ordinary site CSS alone cannot reliably paint them.
function ensureStudioLightTheme(){
  monaco.editor.defineTheme("studio-light",{
    base:"vs",
    inherit:true,
    // Monaco Standalone resolves semantic token styles from TokenTheme rules,
    // not the VS Code-only semanticTokenColors field.
    rules:standaloneSemanticTokenRules(studioLightTheme.semanticTokenColors??{}),
    colors:{
      ...studioLightTheme.colors,
      "menu.background":"#ffffff",
      "menu.foreground":"#294259",
      "menu.selectionBackground":"#e8f4f0",
      "menu.selectionForeground":"#155a52",
      "menu.separatorBackground":"#dce7ed",
      "menu.border":"#d3e1e9"
    }
  });
}
function ensureYamlLanguage() {
  if (!yamlLanguageService) {
    yamlLanguageService = configureMonacoYaml(monaco, {
      completion: true,
      hover: true,
      validate: true,
      enableSchemaRequest: false,
      yamlVersion: "1.2",
      format: {enable: false},
      schemas: createOwnerYamlSchemas()
    });
  }
  return yamlLanguageService;
}
const ensureText = text => {
  if(typeof text !== "string")throw new TypeError("Source must be text");
  return text;
};

export function createMonacoSourceBackend(host,{mirror,onUndo,onRedo,onSave}={}) {
  if(!host || !mirror)throw new TypeError("Monaco requires a host and source mirror");
  const callbacks={input:new Set(),scroll:new Set()};
  let suppress=0,raw="",model=null,modelChange=null,disposed=false;
  // The private mirror supports existing DOM-based D4 regression probes.
  // It is hidden from the user once Monaco is mounted and cannot write except
  // through a deliberate input event; Monaco alone receives keyboard input.
  let editor;
  const guarded=fn=>{suppress++;try{return fn();}finally{suppress--;}};
  const syncMirror=()=>{if(mirror.value!==raw)mirror.value=raw;};
  const onModelInput=()=>{
    if(suppress||disposed||!model)return;
    raw=model.getValue(monaco.editor.EndOfLinePreference.TextDefined,true);
    syncMirror();
    for(const handler of [...callbacks.input])handler();
  };
  const onMirrorInput=()=>{
    if(disposed||mirror.value===raw)return;
    const text=mirror.value;
    // Only compatibility tests synthesize input on this hidden textarea.
    // This route still enters the same Monaco model -> Source input callback.
    if(!model)return;
    model.setValue(text);
  };
  try {
    ensureMonacoWorkerCompatibility();
    ensureYamlLanguage();
    registerSkillSemanticTokens(monaco);
    ensureStudioLightTheme();
    host.dataset.yamlSchemaEngine="monaco-yaml@5.5.1";
    editor=monaco.editor.create(host,{
      model:null,theme:"studio-light",
      // Monaco's standalone default can leave semantic highlighting disabled
      // even when the active theme declares semanticHighlighting=true.
      "semanticHighlighting.enabled":true,
      automaticLayout:true,minimap:{enabled:false},
      fontSize:12,lineHeight:21,tabSize:2,insertSpaces:true,
      scrollBeyondLastLine:false,renderWhitespace:"selection",
      wordWrap:"off",overviewRulerLanes:0,
      fixedOverflowWidgets:true,accessibilitySupport:"auto",
      ariaLabel:"当前文件源码 · Monaco Editor"
    });
    const scrollSubscription=editor.onDidScrollChange(()=>{
      if(disposed||suppress)return;
      for(const handler of [...callbacks.scroll])handler();
    });
    const actions=[scrollSubscription];
    for(const [key,callback] of [
      [monaco.KeyCode.KeyZ,onUndo],
      [monaco.KeyCode.KeyY,onRedo],
      [monaco.KeyCode.KeyS,onSave]
    ])if(typeof callback==="function"){
      editor.addCommand(monaco.KeyMod.CtrlCmd|key,callback);
    }
    if(typeof onRedo==="function")
      editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.KeyZ,onRedo);
    mirror.addEventListener("input",onMirrorInput);
    const backend={
      readText:()=>raw,
      replaceText(text){
        const next=ensureText(text);
        guarded(()=>{
          raw=next;
          if(model && model.getValue(monaco.editor.EndOfLinePreference.TextDefined,true)!==next)
            model.setValue(next);
          syncMirror();
        });
      },
      openDocument(path,text){
        if(typeof path!=="string"||!path)throw new TypeError("Missing file path");
        const next=ensureText(text);
        guarded(()=>{
          modelChange?.dispose();
          modelChange=null;
          editor.setModel(null);
          model?.dispose();
          // Unique active model only: previous files are retained by the
          // existing per-file Package Source buffer, not by Monaco models.
          const uri=monaco.Uri.from({scheme:"inmemory",path:"/"+path});
          model=monaco.editor.createModel(next,languageId(path),uri);
          host.dataset.language=languageId(path);
          host.dataset.yamlSchemaCapability=yamlSchemaCapability(path);
          raw=next;
          editor.setModel(model);
          modelChange=model.onDidChangeContent(onModelInput);
          syncMirror();
          editor.setScrollTop(0);
          editor.setScrollLeft(0);
        });
      },
      onInput(callback){
        callbacks.input.add(callback);
        return ()=>callbacks.input.delete(callback);
      },
      onScroll(callback){
        callbacks.scroll.add(callback);
        return ()=>callbacks.scroll.delete(callback);
      },
      focus(){editor.focus();},
      getScrollTop:()=>editor.getScrollTop(),
      setScrollTop(value){editor.setScrollTop(value);},
      getScrollLeft:()=>editor.getScrollLeft(),
      setScrollLeft(value){editor.setScrollLeft(value);},
      revealLine(line){
        if(!model||!Number.isSafeInteger(line)||line<1)return;
        const number=Math.min(line,model.getLineCount());
        editor.setPosition({lineNumber:number,column:1});
        editor.revealLineInCenter(number);
        editor.focus();
      },
      layout(){editor.layout();},
      dispose(){
        if(disposed)return;
        disposed=true;
        modelChange?.dispose();
        editor.setModel(null);
        model?.dispose();
        for(const action of actions)action.dispose();
        mirror.removeEventListener("input",onMirrorInput);
        editor.dispose();
        callbacks.input.clear();
        callbacks.scroll.clear();
      }
    };
    return backend;
  }catch(error){
    editor?.dispose();
    throw error;
  }
}
