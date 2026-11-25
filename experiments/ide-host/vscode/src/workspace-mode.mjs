import { isProcedurePath } from "./bridge.mjs";
import { openNativeSource } from "./native-source.mjs";

const preferenceKey = "skillStudio.workspaceMode";

function visibleSourceEditor(vscode) {
  const active = vscode.window.activeTextEditor;
  const visible = Array.isArray(vscode.window.visibleTextEditors)
    ? vscode.window.visibleTextEditors.filter(editor => editor?.document)
    : [];
  if (visible.length === 0) return active;
  const activeUri = active?.document?.uri?.toString?.();
  const activeVisible = visible.find(editor =>
    editor.document === active?.document ||
    (activeUri && editor.document.uri?.toString?.() === activeUri));
  if (activeVisible) return activeVisible;
  return visible.find(editor => editor.viewColumn === vscode.ViewColumn.One) ?? visible[0];
}

export function registerWorkspaceMode(vscode, context, { authoring, showWelcome }) {
  let mode = context.globalState.get(preferenceKey) === "console" ? "console" : "ai";
  let consoleEditor;
  let switching = false;
  let waitForProcedure;

  // Track source navigation only while Console is the visible workspace mode.
  // Theia may keep a different native tab in activeTextEditor while AI is open.
  const sourceEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (mode !== "console") return;
    const visible = visibleSourceEditor(vscode) ?? editor;
    if (visible?.document) consoleEditor = visible;
  });
  context.subscriptions.push(sourceEditorListener);

  async function select(next, { startup = false } = {}) {
    if (switching) return false;
    waitForProcedure?.dispose();
    waitForProcedure = undefined;
    switching = true;
    try {
      if (next === "ai") {
        // Do not recapture a Console document that was already tracked. Theia
        // can report a stale tab at the mode boundary; the saved editor is the
        // authoritative return target until Console navigation changes it.
        if (mode !== "ai" && (!consoleEditor?.document || consoleEditor.document.isClosed)) {
          const editor = visibleSourceEditor(vscode);
          if (editor) consoleEditor = editor;
        }
        if (!await authoring.open({ pick: !startup })) return false;
      } else {
        const savedDocument = consoleEditor?.document;
        const activeDocument = visibleSourceEditor(vscode)?.document;
        const document = mode === "ai" && savedDocument && !savedDocument.isClosed
          ? savedDocument : activeDocument ?? authoring.getDocument();
        if (document) {
          const previousEditor = consoleEditor;
          const options = {
            viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
            ...(previousEditor?.document === document && !document.isClosed
              && previousEditor.selection ? { selection: previousEditor.selection } : {}),
          };
          // Theia's native source opener preserves the editor contribution
          // used by Preview and the semantic-token decoration renderer.
          if (document.isUntitled) await vscode.window.showTextDocument(document, options);
          else await openNativeSource(vscode, document.uri, options);
          // Record the document we explicitly restored. Active-editor events
          // emitted during the transition are ignored until Console is active.
          if (previousEditor?.document !== document || document.isClosed) {
            consoleEditor = { document };
          }
        } else if (await showWelcome() !== true) {
          return false;
        }
      }
      mode = next;
      if (!startup) await context.globalState.update(preferenceKey, mode);
      return true;
    } catch (error) {
      void vscode.window.showWarningMessage("SKILL Studio mode: " + String(error?.message ?? error));
      return false;
    } finally {
      switching = false;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("skillStudio.openAiAuthoring", () => select("ai")),
    vscode.commands.registerCommand("skillStudio.openConsole", () => select("console")),
  );

  return {
    restore() {
      // Let the existing Welcome/Example flow establish a project and source.
      if (mode !== "ai") {
        const editor = visibleSourceEditor(vscode);
        if (editor) consoleEditor = editor;
        return Promise.resolve(false);
      }
      if (isProcedurePath(visibleSourceEditor(vscode)?.document.uri.path)) {
        return select("ai", { startup: true });
      }
      waitForProcedure = vscode.window.onDidChangeActiveTextEditor(editor => {
        const visible = visibleSourceEditor(vscode) ?? editor;
        if (isProcedurePath(visible?.document.uri.path)) void select("ai", { startup: true });
      });
      context.subscriptions.push(waitForProcedure);
      return Promise.resolve(false);
    },
  };
}
