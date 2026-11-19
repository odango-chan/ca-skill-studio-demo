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

const PREVIEW_AUTO_REVEAL_KEY = "skill-studio.preview.auto-revealed.v2";

/**
 * Reveal the contextual Preview once per browser tab and workspace. A
 * site-wide localStorage flag is incorrect: showing Markdown in tab A must
 * not suppress the first YAML Preview in tab B. Pass sessionStorage from the
 * frontend so a manual hide still survives a reload of the same tab.
 */
export function createPreviewAutoRevealPreference(storage, workspaceId = "") {
  const key = PREVIEW_AUTO_REVEAL_KEY + ":" + String(workspaceId);
  let revealed = false;
  try {
    revealed = storage?.getItem(key) === "1";
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
        storage?.setItem(key, "1");
      } catch {
        // The in-memory guard still prevents duplicate reveals this session.
      }
    }
  };
}

// A native Source widget has an editor model and is not explicitly hidden.
// Do not consume the one-time Preview reveal on the Welcome-only landing page.
export function hasVisibleSourceEditor(widgets) {
  return Array.from(widgets ?? []).some(widget =>
    Boolean(widget?.editor) && widget.isHidden !== true);
}
