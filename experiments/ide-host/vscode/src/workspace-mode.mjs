import { isProcedurePath } from "./bridge.mjs";
import { openNativeSource } from "./native-source.mjs";

const preferenceKey = "skillStudio.workspaceMode";

export function registerWorkspaceMode(vscode, context, { authoring, showWelcome }) {
  let mode = context.globalState.get(preferenceKey) === "console" ? "console" : "ai";
  let consoleEditor;
  let switching = false;
  let waitForProcedure;

  async function select(next, { startup = false } = {}) {
    if (switching) return false;
    waitForProcedure?.dispose();
    waitForProcedure = undefined;
    switching = true;
    try {
      if (next === "ai") {
        // Theia's native editor opener does not consistently populate
        // activeTextEditor even when a Source editor is visibly selected.
        // Capture the one visible text editor first so AI Workbench cannot
        // replace the user's Console selection with its own Procedure.
        const visible=(vscode.window.visibleTextEditors??[])
          .filter(item=>item?.document&&!item.document.isClosed);
        const editor=visible.find(item=>item.viewColumn===vscode.ViewColumn.One) ??
          visible[0] ?? vscode.window.activeTextEditor;
        if (editor) consoleEditor = editor;
        if (!await authoring.open({ pick: !startup })) return false;
      } else {
        // Once captured, the Console document outranks the AI editor's last
        // Procedure. This restores the exact selected file and its dirty model.
        const consoleDocument=consoleEditor?.document&&!consoleEditor.document.isClosed
          ?consoleEditor.document:null;
        const document = consoleDocument ??
          vscode.window.activeTextEditor?.document ?? authoring.getDocument();
        if (document) {
          const options = {
            viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
            ...(consoleEditor?.document === document && !document.isClosed
              && consoleEditor.selection ? { selection: consoleEditor.selection } : {}),
          };
          // Theia's native source opener preserves the editor contribution
          // used by Preview and the semantic-token decoration renderer.
          if (document.isUntitled) await vscode.window.showTextDocument(document, options);
          else await openNativeSource(vscode, document.uri, options);
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
      if (mode !== "ai") return Promise.resolve(false);
      if (isProcedurePath(vscode.window.activeTextEditor?.document.uri.path)) {
        return select("ai", { startup: true });
      }
      waitForProcedure = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isProcedurePath(editor?.document.uri.path)) void select("ai", { startup: true });
      });
      context.subscriptions.push(waitForProcedure);
      return Promise.resolve(false);
    },
  };
}
