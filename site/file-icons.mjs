// Local, themed Explorer icons. No CDN, external font, or dynamic HTML parsing.
// The file suffix determines the icon; the text label remains accessible.
const NS="http://www.w3.org/2000/svg";
const TYPES=Object.freeze({
  yaml:{name:"YAML",glyph:"Y",fill:"#fdf0f6",stroke:"#bd568e",ink:"#ab3676",size:10},
  markdown:{name:"Markdown",glyph:"M↓",fill:"#eef7ff",stroke:"#4384bd",ink:"#2b72ab",size:8},
  python:{name:"Python",glyph:"PY",fill:"#eef5ff",stroke:"#3776ab",ink:"#286494",size:8},
  json:{name:"JSON",glyph:"{}",fill:"#fff8e9",stroke:"#c79333",ink:"#a87817",size:10},
  script:{name:"Shell",glyph:">_",fill:"#edfaf3",stroke:"#55a27d",ink:"#248653",size:9},
  text:{name:"Text",glyph:"",fill:"#f3f6fa",stroke:"#8a9cad",ink:"#647888",size:8},
  code:{name:"Code",glyph:"<>",fill:"#f1f2ff",stroke:"#797ac9",ink:"#5e61b3",size:9},
  generic:{name:"File",glyph:"",fill:"#f4f7fa",stroke:"#9aaabb",ink:"#718497",size:8}
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

export function fileIconSpec(path){
  return TYPES[fileIconKind(path)];
}

function shape(document,tag,attributes={},value){
  const element=document.createElementNS(NS,tag);
  for(const [key,attr] of Object.entries(attributes))element.setAttribute(key,String(attr));
  if(value!==undefined)element.textContent=value;
  return element;
}

function iconRoot(document,type){
  return shape(document,"svg",{
    viewBox:"0 0 20 20",width:"18",height:"18",
    class:"asset-file-icon asset-file-icon-"+type,
    "data-icon-kind":type,"aria-hidden":"true",focusable:"false"
  });
}

export function createFileIcon(document,path){
  const type=fileIconKind(path),spec=TYPES[type];
  const icon=iconRoot(document,type);
  icon.append(
    shape(document,"path",{
      d:"M4.25 1.8H11.8L16 6v11.75H4.25Z",
      fill:spec.fill,stroke:spec.stroke,"stroke-width":1.15,
      "stroke-linejoin":"round"
    }),
    shape(document,"path",{
      d:"M11.8 1.8V6H16",fill:"none",stroke:spec.stroke,
      "stroke-width":1.1,"stroke-linejoin":"round"
    })
  );
  if(spec.glyph){
    icon.appendChild(shape(document,"text",{
      x:10.1,y:14.5,"text-anchor":"middle","font-size":spec.size,
      "font-family":"ui-monospace,Consolas,monospace",
      "font-weight":"800",fill:spec.ink
    },spec.glyph));
    if(type==="python")icon.appendChild(shape(document,"circle",{
      cx:14,cy:10,r:1.7,fill:"#efbd4c"
    }));
  }else{
    for(const [i,width] of [7,8.5,6].entries()){
      icon.appendChild(shape(document,"path",{
        d:"M6.5 "+(9.5+i*2.3)+"h"+width,fill:"none",stroke:spec.ink,
        "stroke-width":1.25,"stroke-linecap":"round"
      }));
    }
  }
  return icon;
}

export function createFolderIcon(document){
  const icon=shape(document,"svg",{
    viewBox:"0 0 20 20",width:"18",height:"18",
    class:"asset-folder-icon","aria-hidden":"true",focusable:"false"
  });
  icon.append(
    shape(document,"path",{
      class:"asset-folder-closed",
      d:"M2.1 5.15h5.55l1.65 1.75h8.55v9.25H2.1Z",
      fill:"#f8d995",stroke:"#c49b4a","stroke-width":1.1,
      "stroke-linejoin":"round"
    }),
    shape(document,"path",{
      class:"asset-folder-open",
      d:"M2.1 5.2h5.65l1.75 1.75h8.15v3H4.1l-1.9 6.2h13.45l2.35-8.3H4.65Z",
      fill:"#f7dda6",stroke:"#c49b4a","stroke-width":1.1,
      "stroke-linejoin":"round"
    })
  );
  return icon;
}
