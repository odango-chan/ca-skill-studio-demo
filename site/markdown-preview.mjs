// Lightweight local Markdown preview for SKILL.md and other .md files.
// Raw HTML is escaped; no external assets or script execution.
// Source textarea remains the only editable and authoritative document.
const escapeHTML=value=>String(value).replace(/[&<>"']/g,ch=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&#39;"
})[ch]);
const safeHref=raw=>{
  const value=String(raw).trim();
  if(/^https?:\/\/[^\s<>"']+$/i.test(value))return value;
  if(/^mailto:[^\s<>"']+$/i.test(value))return value;
  if(/^#[a-z0-9._:-]+$/i.test(value))return value;
  return null;
};
function inline(src,depth=0){
  if(depth>5)return escapeHTML(src);
  const pattern=/(!?\[([^\]\r\n]+)\]\(([^)\s]+)(?:\s+"([^"\r\n]*)")?\)|\x60([^\x60\r\n]+)\x60|\*\*([^*\r\n]+)\*\*|__([^_\r\n]+)__|~~([^~\r\n]+)~~|\*([^*\r\n]+)\*|_([^_\r\n]+)_|<https?:\/\/[^>\s]+>)/g;
  let out="",offset=0,match;
  while((match=pattern.exec(src))){
    out+=escapeHTML(src.slice(offset,match.index));
    const raw=match[0];
    if(raw.startsWith("![")){
      out+='<span class="md-image-ref" title="图片不会在本地预览中自动请求外部资源">图片：'+escapeHTML(match[2])+"</span>";
    }else if(raw.startsWith("[")){
      const href=safeHref(match[3]);
      out+=href?'<a href="'+escapeHTML(href)+'" rel="noopener noreferrer" target="_blank">'+inline(match[2],depth+1)+"</a>":
        '<span class="md-unresolved-link" title="'+escapeHTML(match[3])+'">'+inline(match[2],depth+1)+"</span>";
    }else if(raw.charCodeAt(0)===96){
      out+="<code>"+escapeHTML(match[5])+"</code>";
    }else if(raw.startsWith("**")||raw.startsWith("__")){
      out+="<strong>"+inline(match[6]??match[7],depth+1)+"</strong>";
    }else if(raw.startsWith("~~")){
      out+="<del>"+inline(match[8],depth+1)+"</del>";
    }else if(raw.startsWith("*")||raw.startsWith("_")){
      out+="<em>"+inline(match[9]??match[10],depth+1)+"</em>";
    }else if(raw.startsWith("<")){
      const href=safeHref(raw.slice(1,-1));
      out+=href?'<a href="'+escapeHTML(href)+'" rel="noopener noreferrer" target="_blank">'+escapeHTML(href)+"</a>":escapeHTML(raw);
    }else out+=escapeHTML(raw);
    offset=pattern.lastIndex;
  }
  return out+escapeHTML(src.slice(offset));
}
const fenceStart=line=>line.match(/^\s{0,3}(\x60{3,}|\x7e{3,})([^\r\n]*)$/);
const heading=line=>line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
const listItem=line=>line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
const hr=line=>/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
const quote=line=>/^\s{0,3}>\s?/.test(line);
const tableSeparator=line=>/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
function cells(line){
  let value=line.trim();
  if(value.startsWith("|"))value=value.slice(1);
  if(value.endsWith("|"))value=value.slice(0,-1);
  return value.split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,"|"));
}
function startsBlock(lines,i){
  const line=lines[i];
  return Boolean(fenceStart(line)||heading(line)||hr(line)||quote(line)||listItem(line)||
    (i+1<lines.length&&line.includes("|")&&tableSeparator(lines[i+1])));
}
function renderList(lines,i,depth){
  const first=listItem(lines[i]);const indent=first[1].length;
  const numbered=/^\d/.test(first[2]);
  const tag=numbered?"ol":"ul";
  const start=numbered?Number.parseInt(first[2],10):1;
  const attr=numbered&&start!==1&&start<100000?' start="'+start+'"':"";
  let out="<"+tag+attr+">";
  while(i<lines.length){
    const m=listItem(lines[i]);
    if(!m||m[1].length!==indent||/^\d/.test(m[2])!==numbered)break;
    const pieces=[m[3]];i++;
    while(i<lines.length&&lines[i].trim()){
      const child=listItem(lines[i]);
      if(child&&child[1].length===indent)break;
      if(child&&child[1].length>indent){
        const nested=renderList(lines,i,depth+1);
        pieces.push(nested.html);i=nested.next;continue;
      }
      if(lines[i].match(/^\s{2,}/)&&!startsBlock(lines,i)){
        pieces.push(inline(lines[i].trim()));i++;continue;
      }
      break;
    }
    out+="<li>"+inline(pieces[0])+pieces.slice(1).join(" ")+"</li>";
  }
  out+="</"+tag+">";
  return {html:out,next:i};
}
function renderBlocks(lines,depth=0){
  if(depth>6)return "<pre>"+escapeHTML(lines.join("\n"))+"</pre>";
  let out="",i=0;
  while(i<lines.length){
    if(!lines[i].trim()){i++;continue;}
    const fence=fenceStart(lines[i]);
    if(fence){
      const marker=fence[1],type=marker.charAt(0),lang=fence[2].trim().split(/\s+/)[0];
      i++;const block=[];
      const close=new RegExp("^\\s{0,3}"+(type.charCodeAt(0)===96?"\\x60":"\\x7e")+"{"+marker.length+",}\\s*$");
      while(i<lines.length&&!close.test(lines[i]))block.push(lines[i++]);
      if(i<lines.length)i++;
      const language=/^[a-z0-9_-]{1,28}$/i.test(lang)?' data-language="'+escapeHTML(lang)+'"':"";
      out+="<pre><code"+language+">"+escapeHTML(block.join("\n"))+"</code></pre>";
      continue;
    }
    const h=heading(lines[i]);
    if(h){
      const level=h[1].length;
      out+="<h"+level+">"+inline(h[2])+"</h"+level+">";i++;continue;
    }
    if(hr(lines[i])){out+="<hr>";i++;continue;}
    if(quote(lines[i])){
      const quoted=[];
      while(i<lines.length&&quote(lines[i]))quoted.push(lines[i++].replace(/^\s{0,3}>\s?/,""));
      out+="<blockquote>"+renderBlocks(quoted,depth+1)+"</blockquote>";
      continue;
    }
    if(i+1<lines.length&&lines[i].includes("|")&&tableSeparator(lines[i+1])){
      const headers=cells(lines[i]);
      // Emit only fixed alignment classes, never source-controlled inline CSS.
      const alignment=cells(lines[i+1]).map(marker=>{
        const left=marker.startsWith(":"),right=marker.endsWith(":");
        return left&&right?' class="md-align-center"':
          right?' class="md-align-right"':
          left?' class="md-align-left"':"";
      });
      i+=2;out+="<div class=\"md-table-wrap\"><table><thead><tr>";
      for(let j=0;j<headers.length;j++)
        out+="<th"+(alignment[j]??"")+">"+inline(headers[j])+"</th>";
      out+="</tr></thead><tbody>";
      let rows=0;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes("|")&&rows++<1000){
        const vals=cells(lines[i++]);out+="<tr>";
        for(let j=0;j<headers.length;j++)
          out+="<td"+(alignment[j]??"")+">"+inline(vals[j]??"")+"</td>";
        out+="</tr>";
      }
      out+="</tbody></table></div>";
      continue;
    }
    if(listItem(lines[i])){
      const list=renderList(lines,i,depth);
      if(list.next>i){out+=list.html;i=list.next;continue;}
    }
    const paragraph=[lines[i++].trim()];
    while(i<lines.length&&lines[i].trim()&&!startsBlock(lines,i)){
      paragraph.push(lines[i++].trim());
    }
    out+="<p>"+inline(paragraph.join(" "))+"</p>";
  }
  return out;
}
export function renderMarkdown(source,{maxChars=300000}={}){
  if(typeof source!=="string")throw new TypeError("Markdown Source must be a string");
  if(source.length>maxChars)return {available:false,html:"",reason:"文件太大，无法安全预览"};
  const lines=source.replace(/\r\n?/g,"\n").split("\n");
  let head="";
  if(lines[0]?.trim()==="---"){
    const end=lines.slice(1,130).findIndex(x=>x.trim()==="---");
    if(end>=0){
      const front=lines.slice(1,end+1).join("\n");
      head='<details class="md-frontmatter"><summary>Front matter</summary><pre><code>'+escapeHTML(front)+"</code></pre></details>";
      lines.splice(0,end+2);
    }
  }
  return {available:true,html:head+renderBlocks(lines)};
}
