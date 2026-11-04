// E1-A2: Monaco is a view over the same Source working copy. It is never
// a second persistent representation of SKILL text or the transaction history.
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/register.all";
import {monacoLanguageForPath} from "./monaco-language.mjs";
const languageId = monacoLanguageForPath;
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
    editor=monaco.editor.create(host,{
      model:null,theme:"vs",automaticLayout:true,minimap:{enabled:false},
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
