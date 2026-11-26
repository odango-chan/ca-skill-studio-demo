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
  let pendingConsoleRestoreDocument;
  let waitForProcedure;

  // A native editor event may arrive after the command that restored Console has
  // completed. Keep the intended document as the restore target until either
  // that document is reported active or a later event agrees with the host's
  // current activeTextEditor. This avoids a fixed timeout accepting a stale tab.
  const sourceEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (!editor?.document) return;
    if (pendingConsoleRestoreDocument) {
      if (editor.document === pendingConsoleRestoreDocument) {
        consoleEditor = editor;
        return;
      }
      const activeDocument = vscode.window.activeTextEditor?.document;
      if (activeDocument === editor.document) {
        consoleEditor = editor;
        pendingConsoleRestoreDocument = undefined;
      }
      return;
    }
    if (mode !== "console" || switching) return;
    if (editor.document !== consoleEditor?.document) consoleEditor = editor;
  });
  context.subscriptions.push(sourceEditorListener);

  async function select(next, { startup = false } = {}) {
    if (switching) return false;
    waitForProcedure?.dispose();
    waitForProcedure = undefined;
    switching = true;
    if (next === "ai") pendingConsoleRestoreDocument = undefined;
    try {
      if (next === "ai") {
        // Keep the last Console editor object (including selection/undo state).
        // Only seed it if startup or no live Console source has been tracked.
        if (startup || !consoleEditor?.document || consoleEditor.document.isClosed) {
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
          pendingConsoleRestoreDocument = document;
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
          if (!previousEditor?.document || previousEditor.document.isClosed) {
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
      if (next === "console") pendingConsoleRestoreDocument = undefined;
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
