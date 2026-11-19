import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  constrainMainEditorPanelOptions,
  isMainEditorPanelOptions,
  createPreviewAutoRevealPreference,
  hasVisibleSourceEditor,
  hasVisualizableSourceEditor
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

test("Preview auto-reveals once per tab/workspace, preserving a hidden layout on reload", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
  const workspace = "#/.theia/globalStorage/example";
  const firstLaunch = createPreviewAutoRevealPreference(storage,workspace);
  assert.equal(firstLaunch.shouldReveal(), true);
  firstLaunch.markRevealed();
  assert.equal(firstLaunch.shouldReveal(), false);

  const restoredLaunch = createPreviewAutoRevealPreference(storage,workspace);
  assert.equal(restoredLaunch.shouldReveal(), false,
    "a reload in the same tab/workspace must not override the user's hidden layout");
  const nextWorkspace = createPreviewAutoRevealPreference(storage,
    "#/.theia/globalStorage/another-project");
  assert.equal(nextWorkspace.shouldReveal(), true,
    "a different workspace starts its own Preview lifecycle");
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

test("Preview auto-reveal is deferred on Welcome and available when native Source opens", () => {
  assert.equal(hasVisibleSourceEditor([]), false);
  assert.equal(hasVisibleSourceEditor([{id:"skill-studio-welcome", isHidden:false}]), false);
  assert.equal(hasVisibleSourceEditor([{editor:{uri:"file:///procedure.yaml"}, isHidden:true}]), false);
  assert.equal(hasVisibleSourceEditor([{id:"skill-studio-welcome"},{
    editor:{uri:"file:///procedure.yaml"}, isHidden:false
  }]), true);
});

test("production shell waits for native Source and verifies visible right Preview before persisting", () => {
  const source = readFileSync(
    "experiments/ide-host/theia-fixed-workbench/src/browser/fixed-workbench-frontend-module.ts",
    "utf8");
  assert.match(source,/hasVisualizableSourceEditor\(shell\.getWidgets\('main'\)\)/);
  assert.match(source,/shell\.onDidChangeCurrentWidget/);
  assert.match(source,/shell\.revealWidget\(PREVIEW_CONTAINER_WIDGET_ID\)/);
  assert.match(source,/container\.isVisible/);
  assert.match(source,/if \(!visible\) return;[\s\S]*?autoReveal\.markRevealed\(\)/);
});

test("a new tab can open YAML Preview even after another tab opened Markdown", () => {
  const makeStorage = () => {
    const values = new Map();
    return {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); }
    };
  };
  const workspace = "#/.theia/globalStorage/example";
  const markdownTabStorage = makeStorage();
  const yamlTabStorage = makeStorage();
  const markdownTab = createPreviewAutoRevealPreference(markdownTabStorage,workspace);
  markdownTab.markRevealed();
  assert.equal(markdownTab.shouldReveal(), false);
  assert.equal(createPreviewAutoRevealPreference(markdownTabStorage,workspace).shouldReveal(), false,
    "refreshing the Markdown tab preserves its own layout");
  assert.equal(createPreviewAutoRevealPreference(yamlTabStorage,workspace).shouldReveal(), true,
    "the YAML tab must not inherit an unrelated tab's already-revealed flag");
});

test("production Preview initialization uses tab-scoped storage, never origin-wide localStorage", () => {
  const source=readFileSync(
    "experiments/ide-host/theia-fixed-workbench/src/browser/fixed-workbench-frontend-module.ts",
    "utf8");
  assert.match(source,/storage = window\.sessionStorage;/);
  assert.match(source,/createPreviewAutoRevealPreference\(storage, window\.location\.hash\)/);
  assert.doesNotMatch(source,/storage = window\.localStorage;/);
});

test("only authored YAML Designers and Markdown auto-open a contextual Preview", () => {
  const make = (path, hidden = false) => ({
    editor: { uri: { toString() { return "file:///workspace/" + path; } } },
    isHidden: hidden
  });
  assert.equal(hasVisualizableSourceEditor([make("skills/a/assurance/procedure.yaml")]),true);
  assert.equal(hasVisualizableSourceEditor([make("skills/a/assurance/contract.yaml")]),true);
  assert.equal(hasVisualizableSourceEditor([make("skills/a/assurance/predicates.yaml")]),true);
  assert.equal(hasVisualizableSourceEditor([make("skills/a/schemas/request.schema.yaml")]),true);
  assert.equal(hasVisualizableSourceEditor([make("skills/a/SKILL.md")]),true);
  assert.equal(hasVisualizableSourceEditor([make("scripts/example.py")]),false);
  assert.equal(hasVisualizableSourceEditor([make("reference/other.yaml")]),false);
  assert.equal(hasVisualizableSourceEditor([make("skills/a/assurance/procedure.yaml",true)]),false);
});

test("Theia Source lifecycle reveals the exact Preview view, not only its Inspector container", () => {
  const content = readFileSync(
    "experiments/ide-host/theia-fixed-workbench/src/browser/fixed-workbench-frontend-module.ts",
    "utf8");
  assert.match(content,/commands\.executeCommand\(openCommand\)/);
  assert.match(content,/shell\.revealWidget\(PREVIEW_WIDGET_ID\)/);
  assert.doesNotMatch(content,/@theia\/plugin-ext\/lib\/main/);
  assert.match(content,/previewViewVisible:/);
  assert.match(content,/shell\.getCurrentWidget\('main'\)/);
  assert.match(content,/shell\.isExpanded\('right'\)/);
  assert.match(content,/hasVisualizableSourceEditor\(\[current\]\)/);
  assert.doesNotMatch(content,/vscode\.openWith/);
});
