/**
 * Convert the VS Code/Theia CompletionTriggerKind enum to the LSP enum.
 *
 * VS Code: Invoke=0, TriggerCharacter=1, TriggerForIncompleteCompletions=2
 * LSP:     Invoked=1, TriggerCharacter=2, TriggerForIncompleteCompletions=3
 *
 * This adapter is used only at the native editor -> LSP boundary.
 */
export function toLspCompletionContext(context) {
  const triggerKind = Number.isInteger(context?.triggerKind)
    ? context.triggerKind + 1
    : 1;
  return {
    triggerKind,
    ...(typeof context?.triggerCharacter === "string"
      ? { triggerCharacter: context.triggerCharacter }
      : {})
  };
}
