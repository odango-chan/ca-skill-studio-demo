// Consistent, source-backed file type icons: one shared outline family.
// No external font/icon service, badge glyphs or per-file inline SVG code.
import {createIcon} from "./icons.mjs";
const NS="http://www.w3.org/2000/svg";
const TYPES=Object.freeze({
  yaml:{name:"YAML",icon:"file-code",tone:"source"},
  markdown:{name:"Markdown",icon:"file-text",tone:"document"},
  python:{name:"Python",icon:"file-code",tone:"code"},
  json:{name:"JSON",icon:"file-json",tone:"schema"},
  script:{name:"Shell",icon:"file-terminal",tone:"code"},
  text:{name:"Text",icon:"file-text",tone:"neutral"},
  code:{name:"Code",icon:"file-code",tone:"code"},
  generic:{name:"File",icon:"file",tone:"neutral"}
});
export function fileIconKind(path){
  const name=String(path??"").replace(/\\/g,"/").split("/").pop().toLowerCase();
  if(/\.ya?ml$/.test(name))return "yaml";
  if(/\.md$|\.markdown$/.test(name))return "markdown";
  if(/\.py$|\.pyw$/.test(name))return "python";
  if(/\.json$|\.jsonc$/.test(name))return "json";
  if(/\.sh$|\.bash$|\.fish$/.test(name))return "script";
  if(/\.txt$|\.log$|\.lrc$/.test(name))return "text";
  if(/\.(?:js|mjs|cjs|jsx|ts|tsx|go|css|html)$/.test(name))return "code";
  return "generic";
}
export function fileIconSpec(path){return TYPES[fileIconKind(path)];}
export function createFileIcon(document,path){
  const type=fileIconKind(path),spec=TYPES[type];
  const icon=createIcon(document,spec.icon,{
    size:18,className:"asset-file-icon asset-file-icon-"+type
  });
  icon.setAttribute("data-icon-kind",type);
  icon.setAttribute("data-icon-tone",spec.tone);
  return icon;
}
export function createFolderIcon(document){
  const icon=createIcon(document,"folder",{size:18,className:"asset-folder-icon"});
  icon.firstChild?.setAttribute("class","asset-folder-closed");
  const opened=document.createElementNS(NS,"path");
  opened.setAttribute("class","asset-folder-open");
  opened.setAttribute("d","M3 8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H6l-3 8h16l3-8");
  icon.appendChild(opened);
  return icon;
}
