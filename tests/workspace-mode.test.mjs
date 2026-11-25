import test from "node:test";
import assert from "node:assert/strict";
import { registerWorkspaceMode } from "../experiments/ide-host/vscode/src/workspace-mode.mjs";
import { registerAiAuthoringEditor } from "../experiments/ide-host/vscode/src/ai-authoring-editor.mjs";

function harness(saved) {
  const commands = new Map();
  const preferences = new Map(saved ? [["skillStudio.workspaceMode", saved]] : []);
  const document = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    getText: () => "# unsaved", isDirty: true,
  };
  document.uri.toString = () => document.uri.path;
  const editor = { document, selection: { anchor: 3 } };
  const opened = [];
  const panels = [];
  let onEditor;
  const vscode = {
    ViewColumn: { One: 1 },
    Uri: { joinPath: (_, ...parts) => parts.join("/") },
    window: {
      activeTextEditor: editor,
      onDidChangeActiveTextEditor(listener) {
        onEditor = listener;
        return { dispose() { onEditor = undefined; } };
      },
      showWarningMessage: message => assert.fail(message),
      showTextDocument: async (...args) => opened.push(args),
      createWebviewPanel: (kind, title, column, options) => {
        const listener = () => ({ dispose() {} });
        const panel = {
          title, column, options, visible: true, reveals: [],
          reveal(...args) { this.reveals.push(args); },
          onDidChangeViewState: listener, onDidDispose: listener,
          webview: { asWebviewUri: path => path, onDidReceiveMessage: listener },
        };
        panels.push(panel);
        return panel;
      },
    },
    commands: {
      executeCommand: async (...args) => opened.push(args),
      registerCommand(id, handler) {
        commands.set(id, handler);
        return { dispose() {} };
      },
    },
  };
  const context = {
    globalState: { get: key => preferences.get(key), update: async (key, value) => preferences.set(key, value) },
    subscriptions: [],
  };
  const authoring = registerAiAuthoringEditor(vscode, context);
  const mode = registerWorkspaceMode(vscode, context, { authoring, showWelcome: () => false });
  function activateEditor(editor) {
    vscode.window.activeTextEditor = editor;
    onEditor?.(editor);
  }
  return { commands, preferences, vscode, document, editor, opened, panels, mode, activateEditor };
}

test("defaults to AI and restores the same dirty native buffer and AI view", async () => {
  const host = harness();
  assert.equal(await host.mode.restore(), true);
  assert.equal(host.panels.length, 1);
  assert.equal(host.panels[0].column, 1);
  assert.equal(host.panels[0].options.retainContextWhenHidden, true);

  // Theia can report another native tab as active while the AI panel is visible.
  host.vscode.window.activeTextEditor = {
    document: { uri: { path: "/skills/demo/assurance/contract.yaml" } },
  };
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);
  assert.deepEqual(host.opened[0], ["vscode.openWith", host.document.uri, "default", {
    viewColumn: 1, preview: false, preserveFocus: false, selection: host.editor.selection,
  }]);
  assert.equal(host.editor.document.getText(), "# unsaved");
  assert.equal(host.editor.document.isDirty, true);
  assert.equal(host.preferences.get("skillStudio.workspaceMode"), "console");

  host.vscode.window.activeTextEditor = host.editor;
  assert.equal(await host.commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(host.panels.length, 1);
  assert.deepEqual(host.panels[0].reveals, [[1, false]]);
  assert.equal(host.preferences.get("skillStudio.workspaceMode"), "ai");
});

test("a saved Console choice is respected and switching Procedures retains their AI views in group one", async () => {
  const host = harness("console");
  assert.equal(await host.mode.restore(), false);
  assert.equal(host.panels.length, 0);
  await host.commands.get("skillStudio.openAiAuthoring")();
  const path = "/skills/other/assurance/procedure.yaml";
  host.vscode.window.activeTextEditor = {
    document: { uri: { path, toString: () => path } },
  };
  await host.commands.get("skillStudio.openAiAuthoring")();
  host.vscode.window.activeTextEditor = host.editor;
  await host.commands.get("skillStudio.openAiAuthoring")();
  assert.deepEqual(host.panels.map(panel => panel.column), [1, 1]);
  assert.deepEqual(host.panels[0].reveals, [[1, false]]);
  assert.deepEqual(host.panels[1].reveals, []);
});

test("a fresh workspace opens AI when its first Procedure becomes available", async () => {
  const host = harness();
  host.activateEditor(undefined);
  assert.equal(await host.mode.restore(), false);
  host.activateEditor(host.editor);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.panels.length, 1);
  host.activateEditor(host.editor);
  assert.equal(host.panels[0].reveals.length, 0);
});
