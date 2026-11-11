// Lightweight local Markdown preview for SKILL.md and other .md files.
// Raw HTML is escaped; source-provided scripts and images are never executed or fetched.
// Optional local links are data-only; the extension host validates every navigation.
// Native Source remains the only editable and authoritative document.
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
// Only path-shaped references can become host-mediated links. The extension
// host still resolves and verifies every target stays inside the active Skill.
function localPackagePath(raw,options={}){
  const value=String(raw).trim();
  if(!value||value.length>240||value.startsWith("/")||value.includes("\\")||
     value.includes("?")||value.includes("#")||
     !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:md|ya?ml|py|json)$/i.test(value))
    return null;
  const parts=value.split("/");
  if(parts.some(part=>!part||part==="."))return null;
  const parents=parts.filter(part=>part==="..").length;
  if(parents>1||(parents===1&&(parts[0]!==".."||parts.length!==2)))return null;
  const inventory=options.localFiles;
  if(!inventory||typeof inventory.has!=="function")return null;
  const targetParts=String(options.relativeDir??"").split("/").filter(Boolean);
  for(const part of parts){
    if(part===".."){if(!targetParts.length)return null;targetParts.pop();}
    else targetParts.push(part);
  }
  if(!options.localFiles.has(targetParts.join("/")))return null;
  return value;
}
function inline(src,depth=0,options={}){
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
      const localPath=options.localLinks?localPackagePath(match[3],options):null;
      out+=href?'<a href="'+escapeHTML(href)+'" rel="noopener noreferrer" target="_blank">'+inline(match[2],depth+1,options)+"</a>":
        localPath?'<a class="md-local-link" href="#" data-local-path="'+escapeHTML(localPath)+
          '" title="打开当前 Skill Package 内的文件">'+inline(match[2],depth+1,options)+"</a>":
        '<span class="md-unresolved-link" title="'+escapeHTML(match[3])+'">'+inline(match[2],depth+1,options)+"</span>";
    }else if(raw.charCodeAt(0)===96){
      const localPath=options.localLinks?localPackagePath(match[5],options):null;
      out+=localPath
        ?'<a class="md-local-link" href="#" data-local-path="'+escapeHTML(localPath)+
          '" title="打开当前 Skill Package 内的文件"><code>'+escapeHTML(match[5])+"</code></a>"
        :"<code>"+escapeHTML(match[5])+"</code>";
    }else if(raw.startsWith("**")||raw.startsWith("__")){
      out+="<strong>"+inline(match[6]??match[7],depth+1,options)+"</strong>";
    }else if(raw.startsWith("~~")){
      out+="<del>"+inline(match[8],depth+1,options)+"</del>";
    }else if(raw.startsWith("*")||raw.startsWith("_")){
      out+="<em>"+inline(match[9]??match[10],depth+1,options)+"</em>";
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
function collectMarkdownHeadings(lines){
  const items=[];let fence=null;
  for(let i=0;i<lines.length;i++){
    const marker=fenceStart(lines[i]);
    if(marker){
      const char=marker[1][0],length=marker[1].length;
      if(!fence)fence={char,length};
      else if(char===fence.char&&length>=fence.length)fence=null;
      continue;
    }
    if(fence)continue;
    const match=heading(lines[i]);
    if(!match)continue;
    const label=match[2].replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")
      .replace(/[*_~]/g,"").trim();
    items.push({line:i,id:"md-heading-"+i,level:match[1].length,label});
  }
  return items;
}
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
function renderList(lines,i,depth,options={}){
  const first=listItem(lines[i]);const indent=first[1].length;
  const numbered=/^\d/.test(first[2]);
  const tag=numbered?"ol":"ul";
  const start=numbered?Number.parseInt(first[2],10):1;
  const attr=numbered&&start!==1&&start<100000?' start="'+start+'"':"";
  const listLine=(options.lineOffset??0)+i;
  let out="<"+tag+attr+' data-source-line="'+listLine+'">";
  while(i<lines.length){
    const m=listItem(lines[i]);
    if(!m||m[1].length!==indent||/^\d/.test(m[2])!==numbered)break;
    const itemLine=(options.lineOffset??0)+i;
    const pieces=[m[3]];i++;
    while(i<lines.length&&lines[i].trim()){
      const child=listItem(lines[i]);
      if(child&&child[1].length===indent)break;
      if(child&&child[1].length>indent){
        const nested=renderList(lines,i,depth+1,options);
        pieces.push(nested.html);i=nested.next;continue;
      }
      if(lines[i].match(/^\s{2,}/)&&!startsBlock(lines,i)){
        pieces.push(inline(lines[i].trim(),0,options));i++;continue;
      }
      break;
    }
    out+='<li data-source-line="'+itemLine+'">'+inline(pieces[0],0,options)+pieces.slice(1).join(" ")+"</li>";
  }
  out+="</"+tag+">";
  return {html:out,next:i};
}
function renderBlocks(lines,depth=0,options={}){
  if(depth>6)return "<pre>"+escapeHTML(lines.join("\n"))+"</pre>";
  let out="",i=0;
  while(i<lines.length){
    if(!lines[i].trim()){i++;continue;}
    const fence=fenceStart(lines[i]);
    if(fence){
      const sourceLine=(options.lineOffset??0)+i;
      const marker=fence[1],type=marker.charAt(0),lang=fence[2].trim().split(/\s+/)[0];
      i++;const block=[];
      const close=new RegExp("^\\s{0,3}"+(type.charCodeAt(0)===96?"\\x60":"\\x7e")+"{"+marker.length+",}\\s*$");
      while(i<lines.length&&!close.test(lines[i]))block.push(lines[i++]);
      if(i<lines.length)i++;
      const language=/^[a-z0-9_-]{1,28}$/i.test(lang)?' data-language="'+escapeHTML(lang)+'"':"";
      out+='<pre data-source-line="'+sourceLine+'"><code'+language+">"+escapeHTML(block.join("\n"))+"</code></pre>";
      continue;
    }
    const h=heading(lines[i]);
    if(h){
      const level=h[1].length;
      const sourceLine=(options.lineOffset??0)+i;
      const id=depth===0?options.headingIds?.get(i):null;
      out+='<h'+level+(id?' id="'+id+'"':'')+' data-source-line="'+sourceLine+'">'+
        inline(h[2],0,options)+"</h"+level+">";i++;continue;
    }
    if(hr(lines[i])){out+='<hr data-source-line="'+((options.lineOffset??0)+i)+'">';i++;continue;}
    if(quote(lines[i])){
      const quoteStart=i,quoted=[];
      while(i<lines.length&&quote(lines[i]))quoted.push(lines[i++].replace(/^\s{0,3}>\s?/,""));
      const lineOffset=(options.lineOffset??0)+quoteStart;
      out+='<blockquote data-source-line="'+lineOffset+'">'+
        renderBlocks(quoted,depth+1,{...options,lineOffset})+"</blockquote>";
      continue;
    }
    if(i+1<lines.length&&lines[i].includes("|")&&tableSeparator(lines[i+1])){
      const headers=cells(lines[i]);
      // Only fixed alignment classes, never source-controlled style attributes.
      const alignment=cells(lines[i+1]).map(marker=>{
        const left=marker.startsWith(":"),right=marker.endsWith(":");
        return left&&right?' class="md-align-center"':
          right?' class="md-align-right"':
          left?' class="md-align-left"':"";
      });
      const tableLine=(options.lineOffset??0)+i;
      i+=2;out+='<div class="md-table-wrap" data-source-line="'+tableLine+'"><table><thead><tr data-source-line="'+tableLine+'">';
      for(let j=0;j<headers.length;j++)
        out+="<th"+(alignment[j]??"")+">"+inline(headers[j],0,options)+"</th>";
      out+="</tr></thead><tbody>";
      let rows=0;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes("|")&&rows++<1000){
        const rowLine=(options.lineOffset??0)+i;
        const vals=cells(lines[i++]);out+='<tr data-source-line="'+rowLine+'">';
        for(let j=0;j<headers.length;j++)
          out+="<td"+(alignment[j]??"")+">"+inline(vals[j]??"",0,options)+"</td>";
        out+="</tr>";
      }
      out+="</tbody></table></div>";
      continue;
    }
    if(listItem(lines[i])){
      const list=renderList(lines,i,depth,options);
      if(list.next>i){out+=list.html;i=list.next;continue;}
    }
    const paragraphLine=(options.lineOffset??0)+i;
    const paragraph=[lines[i++].trim()];
    while(i<lines.length&&lines[i].trim()&&!startsBlock(lines,i)){
      paragraph.push(lines[i++].trim());
    }
    out+='<p data-source-line="'+paragraphLine+'">'+inline(paragraph.join(" "),0,options)+"</p>";
  }
  return out;
}
export function renderMarkdown(source,{maxChars=300000,localLinks=false,localFiles=null,relativeDir=""}={}){
  if(typeof source!=="string")throw new TypeError("Markdown Source must be a string");
  if(source.length>maxChars)return {available:false,html:"",reason:"文件太大，无法安全预览"};
  const lines=source.replace(/\r\n?/g,"\n").split("\n");
  let head="",lineOffset=0;
  if(lines[0]?.trim()==="---"){
    const end=lines.slice(1,130).findIndex(x=>x.trim()==="---");
    if(end>=0){
      const front=lines.slice(1,end+1).join("\n");
      head='<details class="md-frontmatter" data-source-line="0"><summary>Front matter</summary><pre><code>'+escapeHTML(front)+"</code></pre></details>";
      lines.splice(0,end+2);lineOffset=end+2;
    }
  }
  const headings=collectMarkdownHeadings(lines);
  const headingIds=new Map(headings.map(item=>[item.line,item.id]));
  const toc=headings.length>1
    ?'<details class="md-toc"><summary>目录 · '+headings.length+'</summary><ol>'+
      headings.map(item=>'<li class="md-toc-level-'+item.level+'"><a href="#'+item.id+
        '">'+escapeHTML(item.label)+'</a></li>').join("")+'</ol></details>'
    :"";
  return {available:true,html:head+toc+renderBlocks(lines,0,{localLinks,localFiles,relativeDir,headingIds,lineOffset})};
}
