import test from "node:test";
import assert from "node:assert/strict";
import {
  constrainMainEditorPanelOptions,
  isMainEditorPanelOptions
} from "../experiments/ide-host/theia-fixed-workbench/src/browser/fixed-editor-panel-policy.mjs";

const MAIN = "theia-app-main";

test("identifies the Main Editor from Theia's stable renderer class", () => {
  assert.equal(isMainEditorPanelOptions({
    renderer: { tabBarClasses: ["theia-app-centers", MAIN] }
  }, MAIN), true);
  assert.equal(isMainEditorPanelOptions({
    renderer: { tabBarClasses: ["theia-app-centers", "theia-app-bottom"] }
  }, MAIN), false);
  assert.equal(isMainEditorPanelOptions(undefined, MAIN), false);
});

test("constrains only the Main Editor to one document group", () => {
  const renderer = { tabBarClasses: ["theia-app-centers", MAIN] };
  const main = {
    mode: "multiple-document",
    spacing: 0,
    renderer
  };
  const constrained = constrainMainEditorPanelOptions(main, MAIN);
  assert.equal(constrained.mode, "single-document");
  assert.equal(constrained.disableDragAndDrop, true);
  assert.equal(constrained.spacing, 0);
  assert.equal(constrained.renderer, renderer);
  assert.equal(main.mode, "multiple-document", "the original options must not be mutated");
});

test("leaves bottom and side panel options unchanged", () => {
  const bottom = {
    mode: "multiple-document",
    renderer: { tabBarClasses: ["theia-app-centers", "theia-app-bottom"] }
  };
  assert.equal(constrainMainEditorPanelOptions(bottom, MAIN), bottom);
  const side = { mode: "single-document" };
  assert.equal(constrainMainEditorPanelOptions(side, MAIN), side);
});
