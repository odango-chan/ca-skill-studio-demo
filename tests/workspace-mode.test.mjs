import test from "node:test";
import assert from "node:assert/strict";
import { registerWorkspaceMode } from "../experiments/ide-host/vscode/src/workspace-mode.mjs";
import { registerAiAuthoringEditor } from "../experiments/ide-host/vscode/src/ai-authoring-editor.mjs";

function harness(saved, {useAuthoringStub=false} = {}) {
  const commands = new Map();
  const preferences = new Map(saved ? [["skillStudio.workspaceMode", saved]] : []);
  const document = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    getText: () => "# unsaved", isDirty: true,
  };
  document.uri.toString = () => document.uri.path;
  const editor = { document, selection: { anchor: 3 } };
  const contractDocument = {
    uri: {path:"/skills/demo/assurance/contract.yaml",
      toString(){return this.path;}},
    getText: () => "# contract", isDirty: true, version: 7
  };
  const textDocuments = [document, contractDocument];
  const opened = [];
  const panels = [];
  let onEditor;
  const vscode = {
    ViewColumn: { One: 1 },
    Uri: {
      joinPath: (_, ...parts) => parts.join("/"),
      parse: value => ({path:new URL(value).pathname,toString:()=>value})
    },
    workspace: {
      textDocuments,
      openTextDocument: async uri => textDocuments.find(item =>
        item.uri.toString() === uri.toString()) ?? null
    },
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
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
  const authoring = useAuthoringStub
    ? {open: async () => true, getDocument: () => document}
    : registerAiAuthoringEditor(vscode, context);
  const mode = registerWorkspaceMode(vscode, context, { authoring, showWelcome: () => false });
  function emitEditorEvent(editor) { onEditor?.(editor); }
  function activateEditor(editor) {
    vscode.window.activeTextEditor = editor;
    vscode.window.visibleTextEditors = [editor];
    emitEditorEvent(editor);
  }
  return { commands, preferences, vscode, document, contractDocument, editor, opened, panels, mode, activateEditor, emitEditorEvent };
}



test("a delayed stale editor event cannot replace the Console source restored from AI", async () => {
  const host = harness(undefined, {useAuthoringStub:true});
  assert.equal(await host.mode.restore(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);
  const restoredState=host.commands.get("skillStudio.internal.workspaceModeDiagnostics")();
  assert.equal(restoredState.mode,"console");
  assert.equal(restoredState.pendingConsoleRestore.uri,host.document.uri.toString());
  assert.equal(restoredState.consoleEditor.uri,host.document.uri.toString());

  // The previous implementation stopped suppressing editor events after 300 ms.
  // A delayed event for another tab could then replace the saved Console URI.
  await new Promise(resolve => setTimeout(resolve, 350));
  const stalePath = "/skills/demo/assurance/contract.yaml";
  const staleDocument = { uri: { path: stalePath, toString: () => stalePath }, isClosed: false };
  host.emitEditorEvent({ document: staleDocument });

  assert.equal(await host.commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);
  assert.equal(host.opened.at(-1)[1], host.document.uri);
});

test("a real Console navigation after restore updates the AI return target", async () => {
  const host = harness(undefined, {useAuthoringStub:true});
  assert.equal(await host.mode.restore(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);

  await new Promise(resolve => setTimeout(resolve, 350));
  const path = "/skills/demo/assurance/contract.yaml";
  const document = { uri: { path, toString: () => path }, isClosed: false };
  const editor = { document, selection: { anchor: 9 } };
  host.activateEditor(editor);

  assert.equal(await host.commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);
  assert.equal(host.opened.at(-1)[1], document.uri);
});



test("Theia current Source URI overrides stale VS Code active-editor state", async () => {
  const host = harness(undefined, {useAuthoringStub:true});
  assert.equal(await host.mode.restore(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);

  // Simulate Theia's current native widget moving to Contract while its VS Code
  // activeTextEditor / visibleTextEditors projection still reports Procedure.
  assert.equal(await host.commands.get("skillStudio.internal.nativeSourceActivated")(
    host.contractDocument.uri.toString()), true);
  host.emitEditorEvent(host.editor);

  const diagnostics=host.commands.get("skillStudio.internal.workspaceModeDiagnostics")();
  assert.equal(diagnostics.nativeShellBridgeSeen,true);
  assert.equal(diagnostics.nativeShellSourceUri,host.contractDocument.uri.toString());
  assert.equal(diagnostics.consoleEditor.uri,host.contractDocument.uri.toString());
  assert.equal(diagnostics.activeTextEditor.uri,host.document.uri.toString());

  assert.equal(await host.commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await host.commands.get("skillStudio.openConsole")(), true);
  assert.equal(host.opened.at(-1)[1],host.contractDocument.uri);
});

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



test("reopening AI while Theia reports another native tab active preserves the saved Console source", async () => {
  const commands = new Map();
  const preferences = new Map();
  const procedure = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    isClosed: false,
  };
  const contract = {
    uri: { path: "/skills/demo/assurance/contract.yaml" },
    isClosed: false,
  };
  const procedureEditor = { document: procedure, selection: { anchor: 2 }, viewColumn: 1 };
  const contractEditor = { document: contract, selection: { anchor: 8 }, viewColumn: 1 };
  const opened = [];
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      activeTextEditor: procedureEditor,
      visibleTextEditors: [procedureEditor],
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showWarningMessage: message => assert.fail(message),
      showTextDocument: async (...args) => opened.push(args),
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
    globalState: {
      get: key => preferences.get(key),
      update: async (key, value) => preferences.set(key, value),
    },
    subscriptions: [],
  };
  const authoring = { open: async () => true, getDocument: () => procedure };
  const mode = registerWorkspaceMode(vscode, context, {
    authoring, showWelcome: () => false,
  });

  assert.equal(await mode.restore(), true);
  vscode.window.activeTextEditor = contractEditor;
  assert.equal(await commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await commands.get("skillStudio.openConsole")(), true);
  assert.equal(opened.at(-1)[1], procedure.uri);
  assert.deepEqual(opened.at(-1)[3], {
    viewColumn: 1, preview: false, preserveFocus: false, selection: procedureEditor.selection,
  });
});

test("entering AI from Console preserves a selected non-Procedure source document", async () => {
  const commands = new Map();
  const preferences = new Map([["skillStudio.workspaceMode", "console"]]);
  const procedure = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    isClosed: false,
  };
  const contract = {
    uri: { path: "/skills/demo/assurance/contract.yaml" },
    isClosed: false,
  };
  const contractEditor = { document: contract, selection: { anchor: 11 }, viewColumn: 1 };
  const procedureEditor = { document: procedure, selection: { anchor: 2 }, viewColumn: 1 };
  const opened = [];
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      activeTextEditor: procedureEditor,
      visibleTextEditors: [contractEditor],
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showWarningMessage: message => assert.fail(message),
      showTextDocument: async (...args) => opened.push(args),
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
    globalState: {
      get: key => preferences.get(key),
      update: async (key, value) => preferences.set(key, value),
    },
    subscriptions: [],
  };
  const authoring = { open: async () => true, getDocument: () => procedure };
  const mode = registerWorkspaceMode(vscode, context, {
    authoring, showWelcome: () => false,
  });

  assert.equal(await mode.restore(), false);
  assert.equal(await commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await commands.get("skillStudio.openConsole")(), true);
  assert.equal(opened.at(-1)[1], contract.uri);
  assert.deepEqual(opened.at(-1)[3], {
    viewColumn: 1, preview: false, preserveFocus: false, selection: contractEditor.selection,
  });
});


test("entering AI from Console captures the visible Procedure when activeTextEditor is stale", async () => {
  const commands = new Map();
  const preferences = new Map([["skillStudio.workspaceMode", "console"]]);
  const procedure = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    isClosed: false,
  };
  const contract = {
    uri: { path: "/skills/demo/assurance/contract.yaml" },
    isClosed: false,
  };
  const procedureEditor = { document: procedure, selection: { anchor: 4 }, viewColumn: 1 };
  const contractEditor = { document: contract, selection: { anchor: 9 }, viewColumn: 1 };
  const opened = [];
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      activeTextEditor: contractEditor,
      visibleTextEditors: [procedureEditor],
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showWarningMessage: message => assert.fail(message),
      showTextDocument: async (...args) => opened.push(args),
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
    globalState: {
      get: key => preferences.get(key),
      update: async (key, value) => preferences.set(key, value),
    },
    subscriptions: [],
  };
  const authoring = { open: async () => true, getDocument: () => procedure };
  const mode = registerWorkspaceMode(vscode, context, {
    authoring, showWelcome: () => false,
  });

  assert.equal(await mode.restore(), false);
  assert.equal(await commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await commands.get("skillStudio.openConsole")(), true);
  assert.equal(opened.at(-1)[1], procedure.uri);
  assert.deepEqual(opened.at(-1)[3], {
    viewColumn: 1, preview: false, preserveFocus: false, selection: procedureEditor.selection,
  });
});


test("Console navigation updates the saved return target before entering AI", async () => {
  const commands = new Map();
  const preferences = new Map([["skillStudio.workspaceMode", "console"]]);
  const procedure = {
    uri: { path: "/skills/demo/assurance/procedure.yaml" },
    isClosed: false,
  };
  const contract = {
    uri: { path: "/skills/demo/assurance/contract.yaml" },
    isClosed: false,
  };
  const procedureEditor = { document: procedure, selection: { anchor: 1 }, viewColumn: 1 };
  const contractEditor = { document: contract, selection: { anchor: 7 }, viewColumn: 1 };
  const opened = [];
  let onEditor;
  const vscode = {
    ViewColumn: { One: 1 },
    window: {
      activeTextEditor: procedureEditor,
      visibleTextEditors: [contractEditor],
      onDidChangeActiveTextEditor(listener) {
        onEditor = listener;
        return { dispose() { onEditor = undefined; } };
      },
      showWarningMessage: message => assert.fail(message),
      showTextDocument: async (...args) => opened.push(args),
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
    globalState: {
      get: key => preferences.get(key),
      update: async (key, value) => preferences.set(key, value),
    },
    subscriptions: [],
  };
  const authoring = { open: async () => true, getDocument: () => procedure };
  const mode = registerWorkspaceMode(vscode, context, {
    authoring, showWelcome: () => false,
  });

  assert.equal(await mode.restore(), false);
  vscode.window.activeTextEditor = contractEditor;
  onEditor(contractEditor);
  assert.equal(await commands.get("skillStudio.openAiAuthoring")(), true);
  assert.equal(await commands.get("skillStudio.openConsole")(), true);
  assert.equal(opened.at(-1)[1], contract.uri);
  assert.deepEqual(opened.at(-1)[3], {
    viewColumn: 1, preview: false, preserveFocus: false, selection: contractEditor.selection,
  });
});
