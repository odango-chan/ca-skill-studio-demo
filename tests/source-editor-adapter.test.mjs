import test from "node:test";
import assert from "node:assert/strict";
import {createSourceEditorAdapter, createTextareaSourceBackend} from "../site/source-editor-adapter.mjs";

class FakeTextArea extends EventTarget {
  constructor(text = "") {
    super(); this.value = text; this.scrollTop = 0; this.scrollLeft = 0; this.focusCount = 0;
  }
  focus() { this.focusCount++; }
  type(text) { this.value = text; this.dispatchEvent(new Event("input")); }
}
function attachHistory(adapter) {
  const entries = [adapter.value]; let index = 0, recordings = 0;
  adapter.addEventListener("input", () => {
    entries.splice(index + 1);
    entries.push(adapter.value);
    index++; recordings++;
  });
  return {
    get recordings() { return recordings; },
    visual(next) { adapter.value = next; entries.splice(index + 1); entries.push(next); index++; },
    undo() { if (index) adapter.value = entries[--index]; },
    redo() { if (index < entries.length - 1) adapter.value = entries[++index]; }
  };
}

test("textarea backend preserves bytes and no programmatic edit emits input", () => {
  const raw = "\uFEFF'quoted': on\r\n# comment\r\n";
  const native = new FakeTextArea(raw);
  const source = createSourceEditorAdapter(createTextareaSourceBackend(native));
  let inputs = 0, scrolls = 0;
  source.addEventListener("input", () => inputs++);
  source.addEventListener("scroll", () => scrolls++);
  source.openDocument("assurance/procedure.yaml", raw);
  source.value = raw + "next: 1\r\n";
  assert.equal(source.value, raw + "next: 1\r\n");
  assert.equal(inputs, 0);
  native.type(source.value + "user edit");
  assert.equal(inputs, 1);
  native.dispatchEvent(new Event("scroll"));
  assert.equal(scrolls, 1);
  source.scrollTop = 42; source.scrollLeft = 3;
  assert.equal(native.scrollTop, 42); assert.equal(source.scrollLeft, 3);
  source.focus(); assert.equal(native.focusCount, 1);
  source.dispose();
  native.type("ignored after dispose");
  assert.equal(inputs, 1);
  assert.throws(() => source.value, /disposed/);
});

test("visual edits share single history with source typing and undo/redo do not echo", () => {
  const area = new FakeTextArea("before");
  const source = createSourceEditorAdapter(createTextareaSourceBackend(area));
  const history = attachHistory(source);
  area.type("typed");
  history.visual("patched");
  history.undo(); assert.equal(source.value, "typed");
  history.undo(); assert.equal(source.value, "before");
  history.redo(); assert.equal(source.value, "typed");
  history.redo(); assert.equal(source.value, "patched");
  assert.equal(history.recordings, 1);
});

test("backend migration retains exact bytes and detaches old input subscription", () => {
  const old = new FakeTextArea("first\r\n");
  const source = createSourceEditorAdapter(createTextareaSourceBackend(old));
  source.openDocument("scripts/example.py", "# coding\r\nprint('hi')\r\n");
  let inputs = 0;
  source.addEventListener("input", () => inputs++);
  const next = new FakeTextArea();
  source.useBackend(createTextareaSourceBackend(next));
  assert.equal(source.value, "# coding\r\nprint('hi')\r\n");
  assert.equal(inputs, 0);
  old.type("old change"); assert.equal(inputs, 0);
  next.type("new change"); assert.equal(inputs, 1);
  assert.equal(source.value, "new change");
  source.openDocument("SKILL.md", "# Heading\n");
  assert.equal(source.path, "SKILL.md");
  assert.equal(source.value, "# Heading\n");
  assert.equal(inputs, 1);
});

test("reject invalid backends and non-text writes", () => {
  assert.throws(() => createSourceEditorAdapter({}), /Missing Source backend/);
  const source = createSourceEditorAdapter(createTextareaSourceBackend(new FakeTextArea("a")));
  assert.throws(() => { source.value = null; }, /Source must be text/);
  assert.throws(() => source.openDocument("", "b"), /Missing file path/);
  assert.equal(source.value, "a");
});
