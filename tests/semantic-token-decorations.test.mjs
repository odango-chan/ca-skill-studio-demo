import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSemanticTokenDecorationRenderer} from "../experiments/ide-host/lsp-browser/client/src/semantic-token-decorations.mjs";

const theme = JSON.parse(readFileSync(
  new URL("../extensions/skill-studio-theme/themes/skill-studio-light-color-theme.json", import.meta.url),
  "utf8"
));

class FakeRange {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = {line:startLine,character:startCharacter};
    this.end = {line:endLine,character:endCharacter};
  }
}

function fakeDocument(uri, version = 1) {
  const lines = [
    "kind: Procedure",
    "    createdsession.ingress.eligible: PASS"
  ];
  return {
    uri: {toString:()=>uri},
    version,
    lineCount: lines.length,
    lineAt: line => ({text:lines[line]})
  };
}

function fakeHost(initialEditors = []) {
  const visibleListeners = new Set();
  const changeListeners = new Set();
  const closeListeners = new Set();
  const decorations = [];
  const vscode = {
    Range: FakeRange,
    window: {
      visibleTextEditors: initialEditors,
      createTextEditorDecorationType(options) {
        const decoration = {
          options,
          disposed:false,
          dispose(){this.disposed=true;}
        };
        decorations.push(decoration);
        return decoration;
      },
      onDidChangeVisibleTextEditors(listener) {
        visibleListeners.add(listener);
        return {dispose:()=>visibleListeners.delete(listener)};
      }
    },
    workspace: {
      onDidChangeTextDocument(listener) {
        changeListeners.add(listener);
        return {dispose:()=>changeListeners.delete(listener)};
      },
      onDidCloseTextDocument(listener) {
        closeListeners.add(listener);
        return {dispose:()=>closeListeners.delete(listener)};
      }
    }
  };
  return {
    vscode,
    decorations,
    showEditors(editors) {
      vscode.window.visibleTextEditors=editors;
      for (const listener of visibleListeners) listener(editors);
    },
    change(document) {
      for (const listener of changeListeners) listener({document});
    },
    close(document) {
      for (const listener of closeListeners) listener(document);
    }
  };
}

function fakeEditor(document) {
  const calls=[];
  return {
    document,
    calls,
    setDecorations(decoration,ranges) {
      calls.push({decoration,ranges});
    }
  };
}

function semanticData(line) {
  const referenceStart=line.indexOf("createdsession.ingress.eligible");
  const outcomeStart=line.indexOf("PASS");
  return Uint32Array.from([
    1,referenceStart,"createdsession.ingress.eligible".length,0,0,
    0,outcomeStart-referenceStart,4,1,0
  ]);
}

test("Theia decoration adapter renders LSP token ranges with the canonical Studio Light colors",()=>{
  const uri="file:///workspace/skills/establish-pdu-session/assurance/procedure.yaml";
  const document=fakeDocument(uri);
  const editor=fakeEditor(document);
  const host=fakeHost();
  const renderer=createSemanticTokenDecorationRenderer(
    host.vscode,
    ["caReferencePredicate","caValueOutcome"],
    theme.semanticTokenColors
  );

  const line=document.lineAt(1).text;
  const result=renderer.render(document,semanticData(line));
  assert.deepEqual(result,{tokenCount:2,tokenTypeCount:2});
  assert.equal(editor.calls.length,0,"off-screen documents are cached without editor RPCs");

  host.showEditors([editor]);
  assert.equal(editor.calls.length,2);
  const predicate=editor.calls.find(call=>call.decoration.options.color==="#7B5BA7");
  const outcome=editor.calls.find(call=>call.decoration.options.color==="#AD6517");
  assert.ok(predicate,"Predicate reference uses the canonical purple");
  assert.ok(outcome,"PASS outcome uses the canonical orange");
  assert.deepEqual(predicate.ranges[0],new FakeRange(
    1,line.indexOf("createdsession.ingress.eligible"),
    1,line.indexOf("createdsession.ingress.eligible")+"createdsession.ingress.eligible".length
  ));
  assert.deepEqual(outcome.ranges[0],new FakeRange(
    1,line.indexOf("PASS"),1,line.indexOf("PASS")+4
  ));

  renderer.dispose();
  assert.ok(host.decorations.every(decoration=>decoration.disposed));
});

test("Theia decoration adapter preserves delta positions and clears stale ranges by document version",()=>{
  const uri="file:///workspace/skills/establish-pdu-session/assurance/procedure.yaml";
  const document=fakeDocument(uri,1);
  const editor=fakeEditor(document);
  const host=fakeHost([editor]);
  const renderer=createSemanticTokenDecorationRenderer(
    host.vscode,
    ["caReferencePredicate","caValueOutcome"],
    theme.semanticTokenColors
  );

  const line=document.lineAt(1).text;
  const referenceStart=line.indexOf("createdsession.ingress.eligible");
  // The first entry has an unknown type, but its delta position must still
  // advance the stream before the following valid token is decoded.
  const data=Uint32Array.from([
    1,referenceStart,3,99,0,
    0,5,4,1,0
  ]);
  const result=renderer.render(document,data);
  assert.deepEqual(result,{tokenCount:1,tokenTypeCount:1});
  assert.equal(editor.calls.length,1);
  assert.equal(editor.calls[0].decoration.options.color,"#AD6517");
  assert.equal(editor.calls[0].ranges[0].start.character,referenceStart+5);

  const newerDocument=fakeDocument(uri,2);
  host.change(newerDocument);
  assert.equal(editor.calls.at(-1).ranges.length,0,
    "an older decoration set is cleared when the document advances");

  editor.document=newerDocument;
  renderer.render(newerDocument,semanticData(newerDocument.lineAt(1).text));
  const renderedCalls=editor.calls.length;
  host.change(newerDocument);
  assert.equal(editor.calls.length,renderedCalls,
    "a delayed change event for the same version does not clear fresh ranges");

  host.close(newerDocument);
  assert.ok(editor.calls.slice(-2).every(call=>call.ranges.length===0),
    "closing the document clears each previously applied token type");

  renderer.dispose();
  assert.ok(host.decorations.every(decoration=>decoration.disposed));
});
