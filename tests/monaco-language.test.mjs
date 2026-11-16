import test from "node:test";
import assert from "node:assert/strict";
import {monacoLanguageForPath} from "../site/monaco-language.mjs";

test("E1 language selection follows source file paths, never inferred payload",()=>{
  for(const [path,language] of [
    ["assurance/procedure.yaml","yaml"],["assurance/contract.yml","yaml"],
    ["scripts/evaluate_udm_read.py","python"],
    ["references/session-selection.md","markdown"],
    ["schemas/generated.json","json"],
    ["misc/notes.txt","plaintext"],["file.unknown","plaintext"],
    ["any.py/../sample.yaml","yaml"]
  ])assert.equal(monacoLanguageForPath(path),language,path);
});
test("Unknown files remain editable as plain text without guessing a DSL",()=>{
  assert.equal(monacoLanguageForPath(""),"plaintext");
  assert.equal(monacoLanguageForPath("SKILL"),"plaintext");
});
