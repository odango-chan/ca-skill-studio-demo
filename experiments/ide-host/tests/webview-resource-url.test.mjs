import test from "node:test";
import assert from "node:assert/strict";
import {staticPreviewResourceUrl} from "../vscode/src/webview-resource-url.mjs";

const staticWorker={origin:"https://studio.example",pathname:"/ca-skill-studio-demo/ide-preview/plugin-worker.js"};
const asset="https://studio.example/hostedPlugin/skill_studio/media/markdown-preview.css?v=1#top";
const asUri=value=>({toString(){return value;}});

test("browser-only Theia resolves Markdown and Procedure assets beneath Pages subpath",()=>{
  const expected="/ca-skill-studio-demo/ide-preview/hostedPlugin/skill_studio/media/markdown-preview.css?v=1#top";
  assert.equal(staticPreviewResourceUrl(asUri(asset),{scheme:"https"},staticWorker),expected);
  const graph="https://studio.example/hostedPlugin/skill_studio/media/procedure.css";
  assert.equal(staticPreviewResourceUrl(asUri(graph),{scheme:"https"},staticWorker),
    "/ca-skill-studio-demo/ide-preview/hostedPlugin/skill_studio/media/procedure.css");
});

test("resource URL correction is restricted to same-origin static Web extension workers",()=>{
  assert.equal(staticPreviewResourceUrl(asUri(asset),{scheme:"file"},staticWorker),asset);
  assert.equal(staticPreviewResourceUrl(asUri(asset),{scheme:"https"},
    {origin:staticWorker.origin,pathname:"/other-worker.js"}),asset);
  assert.equal(staticPreviewResourceUrl(asUri(asset),{scheme:"https"},
    {origin:staticWorker.origin,pathname:"/plugin-worker.js"}),asset);
  for(const bad of [
    "https://untrusted.example/hostedPlugin/skill_studio/media/markdown-preview.css",
    "https://studio.example/unrelated/media/markdown-preview.css"
  ])
    assert.equal(staticPreviewResourceUrl(asUri(bad),{scheme:"https"},staticWorker),bad);
});
