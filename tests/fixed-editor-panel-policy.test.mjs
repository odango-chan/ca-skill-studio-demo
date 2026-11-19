import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  constrainMainEditorPanelOptions,
  isMainEditorPanelOptions,
  createPreviewAutoRevealPreference
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

test("production shell enforces the fixed Main Editor without a test-only URL flag", () => {
  const source=readFileSync(
    "experiments/ide-host/theia-fixed-workbench/src/browser/fixed-workbench-frontend-module.ts",
    "utf8");
  assert.match(source,/rebind\(TheiaDockPanel\.Factory\)/);
  assert.match(source,/constrainMainEditorPanelOptions\(options, MAIN_AREA_CLASS\)/);
  assert.doesNotMatch(source,/skillStudioFixedLayoutTest|FIXED_LAYOUT_TEST_QUERY|if \(!enabled\)/);
});

test("Preview auto-reveals once per browser profile and then respects restored layout", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
  const firstLaunch = createPreviewAutoRevealPreference(storage);
  assert.equal(firstLaunch.shouldReveal(), true);
  firstLaunch.markRevealed();
  assert.equal(firstLaunch.shouldReveal(), false);

  const restoredLaunch = createPreviewAutoRevealPreference(storage);
  assert.equal(restoredLaunch.shouldReveal(), false,
    "a later launch must not override the user's saved hidden / visible layout");
});

test("Preview auto-reveal remains safe when browser storage is unavailable", () => {
  const preference = createPreviewAutoRevealPreference({
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); }
  });
  assert.equal(preference.shouldReveal(), true,
    "storage failure must not prevent the initial Preview from appearing");
  preference.markRevealed();
  assert.equal(preference.shouldReveal(), false,
    "the in-memory guard still prevents duplicate activation during this session");
});

test("real Chromium fixed-layout smoke exercises the production URL without a test-only flag", () => {
  const source = readFileSync(
    "experiments/ide-host/scripts/theia-fixed-layout-smoke.mjs", "utf8");
  assert.doesNotMatch(source, /skillStudioFixedLayoutTest|FIXED_LAYOUT_TEST_QUERY/);
});
