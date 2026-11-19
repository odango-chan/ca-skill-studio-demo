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
