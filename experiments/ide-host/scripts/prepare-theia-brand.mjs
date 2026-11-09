// Add the Classic SKILL Studio wordmark beside Lumino's native menu list.
// The native menu content node and all menu commands remain untouched.
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";

export function buildSkillStudioBrandCss(){
  return `/* Classic SKILL Studio wordmark in the native Theia menu-bar row. */
.lm-MenuBar.skill-studio-branded{
  min-width:0;
}
.lm-MenuBar.skill-studio-branded > .skill-studio-brand{
  display:flex;
  flex:0 0 auto;
  align-items:center;
  align-self:stretch;
  gap:8px;
  margin:0 6px 0 0;
  padding:0 12px 0 10px;
  border-right:1px solid var(--theia-ui-separator,#e1e7ef);
  color:var(--theia-ui-font-color1,#233550);
  font-family:var(--theia-ui-font-family,Inter,system-ui,sans-serif);
  font-size:13px;
  font-weight:650;
  letter-spacing:-.02em;
  line-height:1;
  white-space:nowrap;
  user-select:none;
  cursor:default;
}
.lm-MenuBar.skill-studio-branded > .lm-MenuBar-content{
  flex:1 1 auto;
  min-width:0;
}
.skill-studio-brand-mark{
  display:flex;
  flex:none;
  width:24px;
  height:24px;
  align-items:center;
  justify-content:center;
  gap:2px;
  border:1px solid #99d9cb;
  border-radius:7px;
  background:linear-gradient(145deg,#dcf8ef,#b8e6de);
}
.skill-studio-brand-mark > span{
  display:block;
  width:3px;
  border-radius:10px;
  background:#198c7b;
  transform:rotate(28deg);
}
.skill-studio-brand-mark > span:nth-child(1),
.skill-studio-brand-mark > span:nth-child(3){height:9px}
.skill-studio-brand-mark > span:nth-child(2){height:15px}
.skill-studio-brand-label{
  display:inline-block;
  color:inherit;
  white-space:nowrap;
}
@media(max-width:760px){
  .lm-MenuBar.skill-studio-branded > .skill-studio-brand{
    gap:0;
    margin-right:4px;
    padding:0 8px;
  }
  .skill-studio-brand-label{display:none}
}
@media(max-width:420px){
  .lm-MenuBar.skill-studio-branded > .skill-studio-brand{padding:0 6px}
  .skill-studio-brand-mark{width:22px;height:22px}
}
`;
}

export function buildSkillStudioBrandScript(){
  return `// Presentation-only insertion. Do not add a fake menu item or intercept events.
(() => {
  // Theia 1.76 assigns this stable ID to BrowserMainMenuFactory's native bar.
  const BAR_SELECTOR = '[id="theia:menubar"].lm-MenuBar';
  const CONTENT_CLASS = "lm-MenuBar-content";
  const BRAND_CLASS = "skill-studio-brand";

  function createBrand(){
    const brand = document.createElement("div");
    brand.className = BRAND_CLASS;
    brand.setAttribute("data-skill-studio-brand","true");

    const mark = document.createElement("span");
    mark.className = "skill-studio-brand-mark";
    mark.setAttribute("aria-hidden","true");
    for(let index=0;index<3;index++){
      mark.appendChild(document.createElement("span"));
    }

    const label = document.createElement("span");
    label.className = "skill-studio-brand-label";
    label.textContent = "SKILL Studio";
    brand.append(mark,label);
    return brand;
  }

  function mount(){
    let mounted = false;
    for(const bar of document.querySelectorAll(BAR_SELECTOR)){
      const content = Array.from(bar.children).find(child =>
        child.classList.contains(CONTENT_CLASS)
      );
      if(!content)continue;

      let brand = Array.from(bar.children).find(child =>
        child.hasAttribute("data-skill-studio-brand")
      );
      if(!brand)brand = createBrand();
      // Keep the brand immediately before Lumino's native list. Never mutate
      // contentNode itself: Lumino owns its menu-title children and behavior.
      if(brand.nextElementSibling!==content)bar.insertBefore(brand,content);
      bar.classList.add("skill-studio-branded");
      mounted = true;
    }
    if(mounted&&document.documentElement)
      document.documentElement.dataset.skillStudioBrand = "ready";
    return mounted;
  }

  function start(){
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement,{childList:true,subtree:true});
    mount();
  }

  if(document.documentElement)start();
  else document.addEventListener("DOMContentLoaded",start,{once:true});
})();
`;
}

function ensureHeadLink(html,id,href){
  const expected='<link id="'+id+'" rel="stylesheet" href="'+href+'">';
  if(html.includes('id="'+id+'"')){
    if(!html.includes(expected))
      throw new Error("Unexpected existing SKILL Studio stylesheet tag: "+id);
    return html;
  }
  const head=html.match(/<\/head>/i);
  if(!head)throw new Error("Theia frontend index has no head element for "+id);
  return html.replace(head[0],expected+head[0]);
}

function ensureBodyScript(html,id,src){
  const expected='<script id="'+id+'" type="module" src="'+src+'"></script>';
  if(html.includes('id="'+id+'"')){
    if(!html.includes(expected))
      throw new Error("Unexpected existing SKILL Studio script tag: "+id);
    return html;
  }
  const body=html.match(/<\/body>/i);
  if(!body)throw new Error("Theia frontend index has no body element for "+id);
  return html.replace(body[0],expected+body[0]);
}

export async function prepareTheiaBrand(rootPath){
  if(typeof rootPath!=="string"||!rootPath.trim())
    throw new Error("Theia frontend root path is required");
  const root=resolve(rootPath);
  const css=buildSkillStudioBrandCss();
  const script=buildSkillStudioBrandScript();
  await writeFile(join(root,"skill-studio-brand.css"),css);
  await writeFile(join(root,"skill-studio-brand.js"),script);

  const indexPath=join(root,"index.html");
  const original=await readFile(indexPath,"utf8");
  let html=ensureHeadLink(original,"skill-studio-brand-theme","./skill-studio-brand.css");
  html=ensureBodyScript(html,"skill-studio-brand-script","./skill-studio-brand.js");
  if(html!==original)await writeFile(indexPath,html);

  return Object.freeze({
    root,
    stylesheet:"skill-studio-brand.css",
    script:"skill-studio-brand.js",
    cssBytes:Buffer.byteLength(css),
    scriptBytes:Buffer.byteLength(script)
  });
}
