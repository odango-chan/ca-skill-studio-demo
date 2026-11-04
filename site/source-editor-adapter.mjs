// E1-A1: UI transport adapter only. Business text/history stay in the existing
// per-file Source working copy; the adapter never creates a second saved model.
// Future Monaco backend must implement the same interface as textareaBackend.
function requireText(value) {
  if (typeof value !== "string") throw new TypeError("Source must be text");
  return value;
}
function assertBackend(backend) {
  for (const method of ["readText", "replaceText", "openDocument", "onInput", "onScroll", "focus", "getScrollTop", "setScrollTop", "getScrollLeft", "setScrollLeft"])
    if (typeof backend?.[method] !== "function") throw new TypeError("Missing Source backend method: " + method);
  return backend;
}

// A native textarea is the safe default; no additional buffer and no implicit
// formatter, serializer or synthetic input event is introduced.
export function createTextareaSourceBackend(textarea) {
  if (!textarea || typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function" || typeof textarea.value !== "string")
    throw new TypeError("Expected a text input element");
  return {
    readText: () => textarea.value,
    replaceText(text) { textarea.value = requireText(text); },
    openDocument(_path, text) {
      textarea.value = requireText(text);
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
    },
    onInput(handler) {
      textarea.addEventListener("input", handler);
      return () => textarea.removeEventListener("input", handler);
    },
    onScroll(handler) {
      textarea.addEventListener("scroll", handler, { passive: true });
      return () => textarea.removeEventListener("scroll", handler);
    },
    focus() { textarea.focus(); },
    revealLine(line) {
      if(!Number.isSafeInteger(line)||line<1)return;
      const lines=textarea.value.split("\n");
      const before=lines.slice(0,line-1);
      const index=before.join("\n").length+(before.length?1:0);
      textarea.focus();
      if(typeof textarea.setSelectionRange==="function")
        textarea.setSelectionRange(index,index+(lines[line-1]||"").length);
      const height=typeof getComputedStyle==="function"
        ? Number.parseFloat(getComputedStyle(textarea).lineHeight)||20 : 20;
      textarea.scrollTop=Math.max(0,(line-4)*height);
    },
    getScrollTop: () => textarea.scrollTop,
    setScrollTop(value) { textarea.scrollTop = value; },
    getScrollLeft: () => textarea.scrollLeft,
    setScrollLeft(value) { textarea.scrollLeft = value; }
  };
}

// Backend-neutral facade. The existing app can keep its source.value calls;
// each get/set touches ONLY the active editor backend. Programmatic changes
// (Visual Patch, Undo/Redo, Reset, open file) must not be recorded as typing.
export function createSourceEditorAdapter(initialBackend) {
  let backend = assertBackend(initialBackend);
  let path = "";
  let programmaticDepth = 0;
  let disposed = false;
  let detachInput = null, detachScroll = null;
  const listeners = { input: new Set(), scroll: new Set() };

  function ensureOpen() {
    if (disposed) throw new Error("Source editor is disposed");
  }
  function silent(action) {
    programmaticDepth++;
    try { return action(); } finally { programmaticDepth--; }
  }
  function bind() {
    detachInput = backend.onInput(() => {
      if (!disposed && !programmaticDepth)
        for (const listener of [...listeners.input]) listener();
    });
    detachScroll = backend.onScroll(() => {
      if (!disposed && !programmaticDepth)
        for (const listener of [...listeners.scroll]) listener();
    });
    if (typeof detachInput !== "function" || typeof detachScroll !== "function")
      throw new TypeError("Backend listeners must return unsubscribe functions");
  }
  bind();
  return {
    get value() { ensureOpen(); return backend.readText(); },
    set value(text) { ensureOpen(); silent(() => backend.replaceText(requireText(text))); },
    get scrollTop() { ensureOpen(); return backend.getScrollTop(); },
    set scrollTop(value) { ensureOpen(); backend.setScrollTop(value); },
    get scrollLeft() { ensureOpen(); return backend.getScrollLeft(); },
    set scrollLeft(value) { ensureOpen(); backend.setScrollLeft(value); },
    focus() { ensureOpen(); backend.focus(); },
    revealLine(line) { ensureOpen(); backend.revealLine?.(line); },
    layout() { ensureOpen(); backend.layout?.(); },
    get path() { ensureOpen(); return path; },
    openDocument(nextPath, text) {
      ensureOpen();
      if (typeof nextPath !== "string" || !nextPath) throw new TypeError("Missing file path");
      silent(() => backend.openDocument(nextPath, requireText(text)));
      path = nextPath;
    },
    addEventListener(type, handler) {
      ensureOpen();
      if (!listeners[type] || typeof handler !== "function") throw new TypeError("Unknown editor event");
      listeners[type].add(handler);
    },
    removeEventListener(type, handler) {
      ensureOpen();
      listeners[type]?.delete(handler);
    },
    // E1-A2 will swap textarea for Monaco using this method. The last active
    // Source bytes are moved exactly once; old listeners must be detached.
    useBackend(nextBackend) {
      ensureOpen();
      const next = assertBackend(nextBackend);
      if (next === backend) return;
      const text = backend.readText();
      silent(() => next.openDocument(path || "untitled.txt", text));
      detachInput(); detachScroll();
      backend = next;
      bind();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detachInput(); detachScroll();
      listeners.input.clear(); listeners.scroll.clear();
    }
  };
}
