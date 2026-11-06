// One application command surface shared by Pages and a future local host.
// Today each command delegates synchronously to its existing editor action.
// Do not invent Run, Debug, Validate or native filesystem capabilities here.
export const STUDIO_COMMAND_TARGETS=Object.freeze({
  "file.open":"openButton",
  "file.openDirectory":"openDirectoryButton",
  "file.loadSample":"establishSampleButton",
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

export function mountApplicationMenu(host,root=document){
  if(!host)return {dispose(){}};
  const menus=[...host.querySelectorAll("details.application-menu")];
  const commands=[...host.querySelectorAll("[data-studio-command]")];
  const openMenu=()=>menus.find(menu=>menu.open);
  const closeMenus=except=>{
    for(const menu of menus)if(menu!==except)menu.open=false;
  };
  const refresh=()=>{
    for(const button of commands)
      button.disabled=!studioCommandTarget(root,button.dataset.studioCommand);
  };
  // Native details implements Tab, Enter and Space. Only one top-level
  // dropdown may be open; the menu bar has a single shared command owner.
  const toggles=menus.map(menu=>{
    const handler=()=>{
      if(menu.open){
        closeMenus(menu);
        refresh();
      }
    };
    menu.addEventListener("toggle",handler);
    return handler;
  });
  const onClick=event=>{
    const button=event.target.closest?.("[data-studio-command]");
    if(button&&host.contains(button)){
      const target=studioCommandTarget(root,button.dataset.studioCommand);
      if(!target){refresh();return;}
      // Preserve the originating click's browser user activation so native
      // file/directory picker permissions are not lost.
      closeMenus();
      target.click();
      return;
    }
    if(event.target.closest?.(".application-menu-help a"))closeMenus();
  };
  const outside=event=>{
    if(openMenu()&&!host.contains(event.target))closeMenus();
  };
  const keydown=event=>{
    const active=openMenu();
    if(event.key==="Escape"&&active){
      event.preventDefault();
      event.stopImmediatePropagation(); // Don't clear the editor selection.
      closeMenus();
      active.querySelector("summary")?.focus();
      return;
    }
    // Familiar top-menu keyboard navigation, without stealing arrows from
    // the actual menu items or Monaco.
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;
    const summary=event.target.closest?.("summary");
    const current=summary?.closest?.("details.application-menu");
    const i=menus.indexOf(current);
    if(i<0)return;
    event.preventDefault();
    const next=menus[(i+(event.key==="ArrowRight"?1:-1)+menus.length)%menus.length];
    const wasOpen=current.open;
    closeMenus();
    if(wasOpen)next.open=true;
    next.querySelector("summary")?.focus();
  };
  host.addEventListener("click",onClick);
  root.addEventListener("pointerdown",outside);
  root.addEventListener("keydown",keydown);
  return {refresh,dispose(){
    menus.forEach((menu,i)=>menu.removeEventListener("toggle",toggles[i]));
    host.removeEventListener("click",onClick);
    root.removeEventListener("pointerdown",outside);
    root.removeEventListener("keydown",keydown);
  }};
}
