// Theia does not currently render the Explorer's contributed viewsWelcome
// when no workspace folder is open. Use an actual editor welcome page instead;
// no example files are imported until a user selects an action.
const actions=Object.freeze({
  newProject:"skillStudio.newProject",
  openProject:"skillStudio.openProject",
  example:"skillStudio.loadExample",
  spec:"skillStudio.openLanguageSpec",
  guide:"skillStudio.openAuthoringGuide"
});

function nonce(){
  const bytes=new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}

export function registerProjectWelcome(vscode,context){
  let panel=null;
  const language=String(vscode.env?.language??"en").toLowerCase();
  const zh=language.startsWith("zh");
  const labels=zh?{
    title:"欢迎使用 SKILL Studio",
    description:"创建或打开 Skill 项目。只有选择示例项目时，才会导入官方 5GC 与 MAS 示例。",
    newProject:"新建项目",openProject:"打开项目",example:"打开示例项目",
    reference:"文档",spec:"Skill 语言规范",guide:"编写指南"
  }:{
    title:"Welcome to SKILL Studio",
    description:"Create or open a Skill project. Official 5GC and MAS examples are imported only when you choose the example project.",
    newProject:"New Project",openProject:"Open Project",example:"Open Example Project",
    reference:"Documentation",spec:"Skill Language Specification",guide:"Authoring Guide"
  };
  function show(){
    if((vscode.workspace.workspaceFolders??[]).length)return;
    if(panel){panel.reveal(vscode.ViewColumn.One);return;}
    panel=vscode.window.createWebviewPanel(
      "skillStudio.welcome","SKILL Studio Welcome",vscode.ViewColumn.One,
      {enableScripts:true,retainContextWhenHidden:true}
    );
    const token=nonce();
    panel.webview.html=`<!doctype html>
<html lang="${zh?"zh-CN":"en"}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
 content="default-src 'none'; style-src 'nonce-${token}'; script-src 'nonce-${token}'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${token}">
:root{color-scheme:light dark}body{margin:0;background:var(--vscode-editor-background);
color:var(--vscode-editor-foreground);font:14px/1.6 var(--vscode-font-family,system-ui)}
main{max-width:700px;margin:0 auto;padding:9vh 36px 48px}
h1{font-size:30px;font-weight:600;letter-spacing:-.6px;margin:10px 0 6px}
.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:var(--vscode-descriptionForeground)}
.description{max-width:560px;color:var(--vscode-descriptionForeground);margin:0 0 38px}
.actions{display:flex;gap:12px;flex-wrap:wrap}
button{padding:12px 18px;border:1px solid var(--vscode-button-border,transparent);
border-radius:7px;cursor:pointer;background:var(--vscode-button-secondaryBackground);
color:var(--vscode-button-secondaryForeground);font:inherit}
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
button:hover{filter:brightness(.95)}
section{margin-top:46px;padding-top:18px;border-top:1px solid var(--vscode-panel-border)}
h2{font-size:13px;font-weight:600;color:var(--vscode-descriptionForeground)}
.links{display:flex;gap:25px;flex-wrap:wrap}
a{color:var(--vscode-textLink-foreground);text-decoration:none;cursor:pointer}
a:hover{text-decoration:underline}
</style></head><body><main>
<div class="eyebrow">SKILL STUDIO</div><h1>${labels.title}</h1>
<p class="description">${labels.description}</p>
<div class="actions">
<button class="primary" data-action="newProject">${labels.newProject}</button>
<button data-action="openProject">${labels.openProject}</button>
<button data-action="example">${labels.example}</button>
</div>
<section><h2>${labels.reference}</h2><div class="links">
<a href="#" data-action="spec">${labels.spec}</a>
<a href="#" data-action="guide">${labels.guide}</a>
</div></section>
</main><script nonce="${token}">
const api=acquireVsCodeApi();
document.querySelectorAll("[data-action]").forEach(el=>
  el.addEventListener("click",event=>{
    event.preventDefault();
    api.postMessage({action:el.dataset.action});
  }));
</script></body></html>`;
    const events=panel.webview.onDidReceiveMessage(message=>{
      const command=Object.prototype.hasOwnProperty.call(actions,message?.action)
        ?actions[message.action]:null;
      if(command)void vscode.commands.executeCommand(command).then(
        ()=>{},error=>void vscode.window.showErrorMessage(
          "SKILL Studio: "+String(error?.message??error)));
    });
    panel.onDidDispose(()=>{events.dispose();panel=null;});
  }
  context.subscriptions.push(vscode.commands.registerCommand("skillStudio.showWelcome",show));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(()=>{
    if((vscode.workspace.workspaceFolders??[]).length){
      panel?.dispose();panel=null;
    }else show();
  }));
  if(!(vscode.workspace.workspaceFolders??[]).length)show();
  return {show};
}
