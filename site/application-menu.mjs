// One application command surface shared by Pages and a future local host.
// Today each command delegates synchronously to its existing editor action.
// Do not invent Run, Debug, Validate or native filesystem capabilities here.
export const STUDIO_COMMAND_TARGETS=Object.freeze({
  "file.open":"openButton",
  "file.openDirectory":"openDirectoryButton",
  "file.saveDirectory":"saveDirectoryButton",
  "file.export":"downloadButton",
  "file.exportPackage":"exportPackageButton",
  "edit.undo":"undoButton",
  "edit.redo":"redoButton",
  "edit.reset":"resetButton",
  "view.visual":"mode-visual",
  "view.source":"mode-source",
  "view.split":"mode-split",
  "view.inspector":"inspectorVisibility",
  "view.fit":"fit"
});

// A missing, disabled or hidden command stays unavailable, not simulated.
// In the future a host adapter can implement the same command IDs with
// explicit capability gates, without changing this menu or Source authority.
export function studioCommandTarget(root,command){
  const id=STUDIO_COMMAND_TARGETS[command];
  if(!id)return null;
  const node=root.getElementById(id);
  if(!node||node.disabled||node.hidden||node.closest?.("[hidden]"))return null;
  return node;
}

export function mountApplicationMenu(menu,root=document){
  if(!menu)return {dispose(){}};
  const trigger=menu.querySelector("summary");
  const commands=[...menu.querySelectorAll("[data-studio-command]")];
  const refresh=()=>{
    for(const button of commands){
      const command=button.dataset.studioCommand;
      button.disabled=!studioCommandTarget(root,command);
    }
  };
  const onToggle=()=>{if(menu.open)refresh();};
  const onClick=event=>{
    const button=event.target.closest?.("[data-studio-command]");
    if(!button||!menu.contains(button))return;
    const target=studioCommandTarget(root,button.dataset.studioCommand);
    if(!target){
      refresh();
      return;
    }
    // Deliberately synchronous within the user's click for browser
    // file/directory picker permissions. Existing handlers remain the owner.
    menu.open=false;
    target.click();
  };
  const outside=event=>{
    if(menu.open&&!menu.contains(event.target))menu.open=false;
  };
  const keydown=event=>{
    if(menu.open&&event.key==="Escape"){
      event.preventDefault();
      menu.open=false;
      trigger?.focus();
    }
  };
  menu.addEventListener("toggle",onToggle);
  menu.addEventListener("click",onClick);
  root.addEventListener("pointerdown",outside);
  root.addEventListener("keydown",keydown);
  return {refresh,dispose(){
    menu.removeEventListener("toggle",onToggle);
    menu.removeEventListener("click",onClick);
    root.removeEventListener("pointerdown",outside);
    root.removeEventListener("keydown",keydown);
  }};
}
