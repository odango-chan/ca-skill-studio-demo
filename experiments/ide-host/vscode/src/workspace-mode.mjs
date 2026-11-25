import { isProcedurePath } from "./bridge.mjs";
import { preferredProcedureDocument } from "./ai-authoring-editor.mjs";
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
        if (editor?.document && isProcedurePath(editor.document.uri?.path)) {
          consoleEditor = editor;
        }
        if (!await authoring.open({ pick: !startup })) return false;

        // Theia may report a non-Procedure native tab as active while the AI
        // panel owns the current Procedure. Keep the actual AI write target as
        // the Console return target instead of remembering that unrelated tab.
        const procedure = authoring.getDocument?.();
        if (procedure && isProcedurePath(procedure.uri?.path) &&
            (consoleEditor?.document !== procedure || consoleEditor.document.isClosed)) {
          consoleEditor = { document: procedure };
        }
      } else {
        const savedDocument = consoleEditor?.document;
        const activeDocument = vscode.window.activeTextEditor?.document;
        const workbenchDocument = authoring.getDocument?.();
        const document = mode === "ai"
          ? preferredProcedureDocument(
              savedDocument && !savedDocument.isClosed ? savedDocument : activeDocument,
              workbenchDocument,
            )
          : activeDocument ?? workbenchDocument;
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
