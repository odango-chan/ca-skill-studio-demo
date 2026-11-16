import test from "node:test";
import assert from "node:assert/strict";
import {createSourceOnlyEditorNormalizer} from "../experiments/ide-host/vscode/src/editor-group-placement.mjs";

function fixture({sourceViewType=()=>null,hasSourceViewPair=()=>false,execute=async()=>{}}={}){
  const calls=[],shown=[];
  const vscode={ViewColumn:{One:1,Two:2},window:{activeTextEditor:null,
    showTextDocument:async(document,options)=>{
      shown.push({document,options});
      const editor={document,viewColumn:options.viewColumn};
      vscode.window.activeTextEditor=editor;
      return editor;
    }},commands:{executeCommand:async command=>{
      calls.push(command);
      const result=await execute(vscode.window.activeTextEditor);
      if(vscode.window.activeTextEditor)
        vscode.window.activeTextEditor.viewColumn=vscode.ViewColumn.One;
      return result;
    }}};
  const errors=[];
  const normalize=createSourceOnlyEditorNormalizer(vscode,{
    sourceViewType,hasSourceViewPair,onError:error=>errors.push(error)
  });
  const editor=(path,viewColumn=2)=>({document:{uri:{path,toString:()=>"file://"+path}},viewColumn});
  return {vscode,calls,shown,errors,normalize,editor};
}

test("moves the intended Python Source editor from the Visual group to the primary group",async()=>{
  const f=fixture();
  const python=f.editor("/skills/demo/scripts/main.py");
  f.vscode.window.activeTextEditor=python;
  assert.equal(await f.normalize(python),true);
  assert.deepEqual(f.calls,["workbench.action.moveEditorToFirstGroup"]);
  assert.equal(f.vscode.window.activeTextEditor.document.uri.toString(),python.document.uri.toString());
});

test("reactivates the captured Source tab before issuing the global move command",async()=>{
  let movedUri=null;
  const f=fixture({execute:async active=>{movedUri=active?.document?.uri?.toString();}});
  const python=f.editor("/skills/demo/scripts/main.py");
  f.vscode.window.activeTextEditor=f.editor("/skills/demo/assurance/procedure.yaml",2);
  assert.equal(await f.normalize(python),true);
  assert.equal(f.shown.length,1);
  assert.equal(f.shown[0].document.uri.toString(),python.document.uri.toString());
  assert.equal(movedUri,python.document.uri.toString(),
    "the active-editor command must never move the previously focused Designer");
});

test("moves unsupported YAML to the primary group without creating a Visual",async()=>{
  const f=fixture();
  const yaml=f.editor("/skills/demo/metadata.yaml");
  f.vscode.window.activeTextEditor=yaml;
  assert.equal(await f.normalize(yaml),true);
  assert.equal(f.calls.length,1);
});

test("does not move an editor already in the primary group",async()=>{
  const f=fixture();
  assert.equal(await f.normalize(f.editor("/skills/demo/scripts/main.py",1)),false);
  assert.deepEqual(f.calls,[]);
});

test("does not interfere with a registered Source/Visual pair",async()=>{
  const f=fixture({sourceViewType:uri=>uri.path.endsWith("/procedure.yaml")?"skillStudio.procedurePreview":null});
  assert.equal(await f.normalize(f.editor("/skills/demo/assurance/procedure.yaml")),false);
  assert.deepEqual(f.calls,[]);
});

test("does not move a document while its Source/Visual pair is opening",async()=>{
  const f=fixture({hasSourceViewPair:()=>true});
  assert.equal(await f.normalize(f.editor("/skills/demo/assurance/procedure.yaml")),false);
  assert.deepEqual(f.calls,[]);
});

test("coalesces recursive active-editor events for the same document",async()=>{
  let release;
  const f=fixture({execute:()=>new Promise(resolve=>{release=resolve;})});
  const editor=f.editor("/skills/demo/scripts/main.py");
  f.vscode.window.activeTextEditor=editor;
  const first=f.normalize(editor);
  const second=await f.normalize(editor);
  assert.equal(second,false);
  assert.equal(f.calls.length,1);
  release();
  assert.equal(await first,true);
});

test("reports a failed move and releases the in-flight guard",async()=>{
  let fail=true;
  const f=fixture({execute:async()=>{if(fail)throw Error("host unavailable");}});
  const editor=f.editor("/skills/demo/scripts/main.py");
  f.vscode.window.activeTextEditor=editor;
  assert.equal(await f.normalize(editor),false);
  assert.equal(f.errors.length,1);
  fail=false;
  assert.equal(await f.normalize(editor),true);
  assert.equal(f.calls.length,2);
});
