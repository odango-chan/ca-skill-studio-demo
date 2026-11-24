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
        const editor = vscode.window.activeTextEditor;
        if (editor) consoleEditor = editor;
        if (!await authoring.open({ pick: !startup })) return false;
      } else {
        const document = vscode.window.activeTextEditor?.document ??
          consoleEditor?.document ?? authoring.getDocument();
        if (document) {
          // Reveal the original buffer, including its editor selection. A
          // closed tab can be reopened through the normal native source path.
          if (consoleEditor?.document === document && !document.isClosed) {
            await vscode.window.showTextDocument(document, {
              viewColumn: vscode.ViewColumn.One, preview: false,
              selection: consoleEditor.selection,
            });
          } else {
            await openNativeSource(vscode, document.uri, {
              viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
            });
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
