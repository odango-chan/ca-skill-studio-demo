// Generate Theia shell masks and VS Code/Theia file-icon SVGs from Classic's
// canonical icon geometry. No icon font, remote asset, or runtime dependency.
import {iconShapes} from "../../../site/icons.mjs";

export const THEIA_CLASSIC_ICON_MAP=Object.freeze({
  files:"folder","explorer-view-icon":"folder",search:"search",
  "source-control":"git-branch","debug-alt":"workflow",debug:"workflow",
  extensions:"package","settings-gear":"settings",settings:"settings",gear:"settings",
  account:"network",remote:"network","new-file":"file-plus","new-folder":"folder-plus",
  add:"plus",plus:"plus",remove:"minus",minus:"minus",close:"x","close-all":"x",
  menu:"menu",more:"more-horizontal",ellipsis:"more-horizontal",
  "chevron-down":"chevron-down","chevron-up":"chevron-up",
  "chevron-left":"chevron-left","chevron-right":"chevron-right",
  undo:"undo-2",redo:"redo-2",save:"file-check","save-all":"archive",
  refresh:"refresh-cw",sync:"refresh-cw","collapse-all":"panel-left-close",
  filter:"sliders-horizontal","list-filter":"sliders-horizontal",
  layout:"columns-2","layout-panel":"fit-height",
  "layout-sidebar-left":"panel-left-open","layout-sidebar-right":"panel-right-open",
  "layout-sidebar-left-off":"panel-left-close","layout-sidebar-right-off":"panel-right-close",
  "panel-left":"panel-left-open","panel-right":"panel-right-open","panel-bottom":"fit-height",
  "split-horizontal":"columns-2","split-vertical":"fit-height",
  "zoom-in":"zoom-in","zoom-out":"zoom-out",maximize:"maximize",
  play:"play",run:"play","run-all":"play","debug-start":"play",
  stop:"circle-stop","debug-stop":"circle-stop",restart:"refresh-cw",
  check:"check","check-all":"list-checks","clear-all":"rotate-ccw",
  terminal:"file-terminal",output:"file-text",problems:"shield-check","open-preview":"eye"
});

export const CLASSIC_FILE_ICON_ASSETS=Object.freeze({
  "file.svg":Object.freeze({icon:"file",color:"#71889c"}),
  "folder.svg":Object.freeze({icon:"folder",color:"#6c8198"}),
  "folder-open.svg":Object.freeze({icon:"folder-open",color:"#6c8198"}),
  "skill.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "yaml.svg":Object.freeze({icon:"file-code",color:"#678a9a"}),
  "markdown.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "python.svg":Object.freeze({icon:"file-code",color:"#638798"}),
  "json.svg":Object.freeze({icon:"file-json",color:"#927f9b"}),
  "shell.svg":Object.freeze({icon:"file-terminal",color:"#638798"}),
  "text.svg":Object.freeze({icon:"file-text",color:"#7483a0"}),
  "code.svg":Object.freeze({icon:"file-code",color:"#638798"})
});

const SHELL_SCOPES=Object.freeze([
  ".theia-app-sides",".theia-app-centers",".theia-app-bottom",
  ".theia-sidebar-menu",".theia-sidepanel-toolbar",".theia-navigator",
  ".theia-navigator-container",".theia-view-container",".theia-Toolbar",
  ".theia-toolbar",".theia-statusBar",".theia-statusbar",
  ".lm-MenuBar",".lm-TabBar",".lm-Menu"
]);
function escapeXml(value){
  return String(value).replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"
  })[char]);
}
export function renderClassicSvg(name,stroke="#71889c"){
  if(!/^#[0-9a-f]{6}$/i.test(stroke))
    throw new Error("Classic icon stroke must be a six-digit hex color");
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
export function buildClassicIconsCss(){
  const rules=Object.entries(THEIA_CLASSIC_ICON_MAP).map(([codicon,name])=>{
    const uri="data:image/svg+xml,"+encodeURIComponent(
      renderClassicSvg(name,"#000000").replace(/^<\?xml[^>]*>\s*/,"")
    );
    const selectors=SHELL_SCOPES.map(scope=>
      scope+" .codicon-"+codicon+"::before"
    ).join(",\n");
    return selectors+"{\n"+'  content:""!important;\n'+
      "  display:inline-block!important;width:1em!important;height:1em!important;\n"+
      "  line-height:1!important;vertical-align:-.12em!important;\n"+
      "  background-color:currentColor!important;\n"+
      '  -webkit-mask-image:url("'+uri+'")!important;\n'+
      '  mask-image:url("'+uri+'")!important;\n'+
      "  -webkit-mask-repeat:no-repeat!important;mask-repeat:no-repeat!important;\n"+
      "  -webkit-mask-position:center!important;mask-position:center!important;\n"+
      "  -webkit-mask-size:contain!important;mask-size:contain!important;\n}";
  }).join("\n\n");
  return "/* Generated from site/icons.mjs; Theia keeps all native commands. */\n"+
    rules+"\n";
}
