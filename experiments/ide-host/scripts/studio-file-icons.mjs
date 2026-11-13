// Shared SVG artwork for the standalone Skill Studio file icon theme.
// This is a theme asset generator, not a second workbench or shell icon layer.
import {iconShapes} from "../../../site/icons.mjs";

export const STUDIO_FILE_ICON_ASSETS=Object.freeze({
  "file.svg":Object.freeze({icon:"file",color:"#71889c"}),
  "folder.svg":Object.freeze({icon:"folder",color:"#6c8198"}),
  "folder-open.svg":Object.freeze({icon:"folder-open",color:"#6c8198"}),
  "folder-skills.svg":Object.freeze({icon:"folder-skills",color:"#0c8e7b"}),
  "folder-library.svg":Object.freeze({icon:"folder-library",color:"#697e97"}),
  "folder-output.svg":Object.freeze({icon:"folder-output",color:"#75889c"}),
  "skill.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "yaml.svg":Object.freeze({icon:"file-code",color:"#678a9a"}),
  "markdown.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "python.svg":Object.freeze({icon:"file-code",color:"#638798"}),
  "json.svg":Object.freeze({icon:"file-json",color:"#927f9b"}),
  "shell.svg":Object.freeze({icon:"file-terminal",color:"#638798"}),
  "text.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "code.svg":Object.freeze({icon:"file-code",color:"#638798"})
});

function escapeXml(value){
  return String(value).replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"
  })[char]);
}

export function renderStudioFileIconSvg(name,stroke="#71889c"){
  if(!/^#[0-9a-f]{6}$/i.test(stroke))
    throw new Error("Studio file icon stroke must be a six-digit hex color");
  const body=iconShapes(name).map(({tag,attrs})=>{
    const attributes=Object.entries(attrs)
      .map(([key,value])=>key+'="'+escapeXml(value)+'"').join(" ");
    return "<"+tag+" "+attributes+"/>";
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" '+
    'viewBox="0 0 24 24" fill="none" stroke="'+stroke+'" '+
    'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">\n'+
    body+"\n</svg>\n";
}
