export function isMainEditorPanelOptions(options, mainAreaClass) {
  const classes = options?.renderer?.tabBarClasses;
  return Array.isArray(classes) && classes.includes(mainAreaClass);
}

export function constrainMainEditorPanelOptions(options, mainAreaClass) {
  if (!isMainEditorPanelOptions(options, mainAreaClass)) return options;
  return {
    ...options,
    mode: "single-document",
    disableDragAndDrop: true
  };
}

const PREVIEW_AUTO_REVEAL_KEY = "skill-studio.preview.auto-revealed.v1";

/**
 * Reveal the contextual Preview automatically only on the first successful
 * browser-profile launch. Later launches leave the native Theia layout alone,
 * so a user's deliberate hide / resize choice survives reloads.
 */
export function createPreviewAutoRevealPreference(storage) {
  let revealed = false;
  try {
    revealed = storage?.getItem(PREVIEW_AUTO_REVEAL_KEY) === "1";
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return {
    shouldReveal() {
      return !revealed;
    },
    markRevealed() {
      revealed = true;
      try {
        storage?.setItem(PREVIEW_AUTO_REVEAL_KEY, "1");
      } catch {
        // The in-memory guard still prevents duplicate reveals this session.
      }
    }
  };
}
