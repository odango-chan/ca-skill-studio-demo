// Local syntax colours. The textarea remains the sole editable Source authority.
// Every source character is escaped before entering the highlighting layer.
const esc=value=>String(value).replace(/[&<>"']/g,ch=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[ch]);
const span=(kind,text)=>'<span class="tok-'+kind+'">'+esc(text)+'</span>';
const MODES=Object.freeze({
  yaml:/\.ya?ml$/i,json:/\.json$/i,markdown:/\.md$/i,python:/\.py$/i
});
export function languageForPath(path=""){
  for(const [mode,re] of Object.entries(MODES))if(re.test(String(path)))return mode;
  return "plain";
}
function parseInline(text,re,classify){
  let result="",offset=0,match;
  re.lastIndex=0;
  while((match=re.exec(text))){
    if(match.index<offset)continue;
    result+=esc(text.slice(offset,match.index));
    result+=span(classify(match,text),match[0]);
    offset=re.lastIndex;
    if(match[0]==="")re.lastIndex++;
  }
  return result+esc(text.slice(offset));
}
const yamlToken=/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|#[^\r\n]*$|\b(?:true|false|null|yes|no|on|off)\b|(?<![\w.])[-+]?\d+(?:\.\d+)?\b|[|>][-+]?$/g;
function yamlLine(line){
  const m=line.match(/^(\s*(?:-\s+)?)(("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][\w.-]*)(\s*:))(?=\s|$)/);
  let prefix="",value=line;
  if(m){
    prefix=esc(m[1])+span("key",m[3])+esc(m[4]);
    value=line.slice(m[0].length);
  }
  return prefix+parseInline(value,yamlToken,m=>{
    const v=m[0];return v.startsWith("#")?"comment":
      v.startsWith("'")||v.startsWith('"')?"string":
      /^(true|false|null|yes|no|on|off)$/.test(v)?"literal":
      /^[-+]?\d/.test(v)?"number":"syntax";
  });
}
const jsonToken=/"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|(?<![\w.])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b/g;
function jsonLine(line){
  return parseInline(line,jsonToken,(m,full)=>{
    const v=m[0];
    if(v.startsWith('"')){
      const after=full.slice(m.index+m[0].length);
      return /^\s*:/.test(after)?"key":"string";
    }
    return /^(true|false|null)$/.test(v)?"literal":"number";
  });
}
const pyToken=/#.*$|"""(?:[^"]|"(?!""))*"""|'''(?:[^']|'(?!''))*'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:False|True|None)\b|\b(?:async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|and|pass|raise|return|try|while|with|yield|assert|as)\b|(?<![\w.])\d+(?:\.\d+)?\b/g;
function pythonLine(line){
  return parseInline(line,pyToken,m=>{
    const v=m[0];return v.startsWith("#")?"comment":
      /^["']/.test(v)?"string":/^(True|False|None)$/.test(v)?"literal":
      /^\d/.test(v)?"number":"keyword";
  });
}
function markdownLine(line){
  const m=line.match(/^(\s*)(#{1,6})(\s+)/);
  if(m)return esc(m[1])+span("heading",m[2])+esc(m[3])+
    span("heading",line.slice(m[0].length));
  const lead=line.match(/^(\s*)([-*+]|\d+\.)(\s+)/);
  const prefix=lead?esc(lead[1])+span("syntax",lead[2])+esc(lead[3]):"";
  const rest=lead?line.slice(lead[0].length):line;
  const re=/\x60[^\x60\r\n]+\x60|\*\*[^*\r\n]+\*\*|\*[^*\r\n]+\*|\[[^\]\r\n]+\]\([^\)\r\n]+\)/g;
  return prefix+parseInline(rest,re,m=>m[0].startsWith("\x60")?"string":
    m[0].startsWith("[")?"link":"keyword");
}
export function highlightSource(text,path="",limit=260000){
  if(typeof text!=="string")throw new TypeError("Source must be text");
  const language=languageForPath(path);
  if(text.length>limit||language==="plain")
    return {language,enabled:false,html:esc(text)+"\u200b"};
  const transform=language==="yaml"?yamlLine:
    language==="json"?jsonLine:
    language==="python"?pythonLine:markdownLine;
  return {language,enabled:true,html:text.split("\n").map(transform).join("\n")+"\u200b"};
}
