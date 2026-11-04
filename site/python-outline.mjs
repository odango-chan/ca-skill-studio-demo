// E3-A2: bounded, read-only Python top-level source navigation.
// This lexical index is not a parser, execution engine, type checker or LSP.
const SYMBOL=/^(async[ \t]+def|def|class)[ \t]+([A-Za-z_][A-Za-z_0-9]*)[ \t]*(?=\(|:)/;
const freeze=Object.freeze;
function scanLine(line,oldMode) {
  let mode=oldMode;
  for(let i=0;i<line.length;){
    const c=line[i];
    if(mode){
      if(c==="\\"){i+=2;continue;}
      if(line.startsWith(mode,i)){i+=mode.length;mode=null;continue;}
      i++;continue;
    }
    if(c==="#")break;
    if(c==="'"||c==='"'){
      const triple=c.repeat(3);
      mode=line.startsWith(triple,i)?triple:c;
      i+=mode.length;continue;
    }
    i++;
  }
  return {mode,uncertain:Boolean(mode&&mode.length===1)};
}
export function pythonTopLevelOutline(text) {
  const unavailable=reason=>freeze({status:"UNAVAILABLE",
    symbols:freeze([]),warnings:freeze([reason])});
  if(typeof text!=="string"||text.length>1024*1024||text.includes("\u0000"))
    return unavailable("Python Source 不可索引");
  const lines=text.split(/\r\n|\n|\r/);
  if(lines.length>20000)return unavailable("Python Source 行数超出索引上限");
  const candidates=[];
  let mode=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!mode){
      const match=SYMBOL.exec(line);
      if(match){
        if(candidates.length>=200)return unavailable("顶层符号超出索引上限");
        candidates.push(freeze({name:match[2],
          kind:match[1]==="class"?"class":"function",
          line:i+1,async:match[1].startsWith("async")}));
      }
    }
    const next=scanLine(line,mode);
    if(next.uncertain)
      return unavailable("无法可靠扫描非三引号跨行字符串；符号定位已关闭");
    mode=next.mode;
  }
  if(mode)return unavailable("三引号字符串未闭合；符号定位已关闭");
  const counts=new Map();
  for(const item of candidates)counts.set(item.name,(counts.get(item.name)||0)+1);
  const duplicates=[...counts].filter(([,n])=>n>1).map(([name])=>name);
  return freeze({status:"READY",
    symbols:freeze(candidates.filter(x=>counts.get(x.name)===1)),
    warnings:freeze(duplicates.length?
      ["重复的顶层符号不建立跳转："+duplicates.join(", ")]:[])});
}
