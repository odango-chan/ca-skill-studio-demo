// Right-side Markdown projection only. Monaco/Theia remains the sole editor.
// Marked is pinned to 14.0.0. No raw Markdown is inserted as executable HTML.
import {Marked} from "marked";

const MAX_MARKDOWN_SOURCE_BYTES=1024*1024;
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[ch]));

export function markdownLinkCandidate(href) {
  if(typeof href!=="string"||href.length===0||href.length>2048)return false;
  if(/^[\x00-\x1f\x7f]/.test(href)||/[\r\n\t]/.test(href))return false;
  if(href.startsWith("#"))return true;
  if(/^(?:https?:|mailto:|tel:)/i.test(href))return true;
  if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith("//"))return false;
  if(href.startsWith("/")||href.includes("\\")||/%(?:2f|5c)/i.test(href))return false;
  return /^[^?#]+(?:[?#].*)?$/.test(href);
}

const renderer={
  // Escape both block and inline HTML. Raw HTML must never render.
  html({text}){return escapeHtml(text);},
  // Image tokens are plain alt text, with no img, remote/local resource or SVG.
  image({text}){return '<span class="studio-markdown-image-disabled">'+escapeHtml(text)+'</span>';},
  link({href,tokens}){
    const label=this.parser.parseInline(tokens);
    if(!markdownLinkCandidate(href))return label;
    // Do not supply href to the Webview DOM. Every activation goes back to
    // the host for its exact inventoried Package boundary and symlink checks.
    return '<a role="link" tabindex="0" data-studio-href="'+escapeHtml(href)+'">'+label+'</a>';
  }
};

export function renderStudioMarkdown(source) {
  if(typeof source!=="string")throw Error("Markdown Source must be text");
  if(new TextEncoder().encode(source).length>MAX_MARKDOWN_SOURCE_BYTES)
    throw Error("Markdown Source exceeds 1 MiB preview limit");
  const engine=new Marked({gfm:true,breaks:false,renderer});
  const tokens=engine.lexer(source);
  let sourceLine=1;
  const blocks=[];
  for(const token of tokens){
    const raw=typeof token.raw==="string"?token.raw:"";
    const line=sourceLine;
    sourceLine+=(raw.match(/\n/g)??[]).length;
    const html=engine.parser([token]);
    if(token.type==="space"||token.type==="def"||!html.trim())continue;
    blocks.push('<section class="studio-markdown-block" data-source-line="'+line+'">'+html+'</section>');
  }
  return {html:blocks.join("\n"),blockCount:blocks.length,lastSourceLine:sourceLine};
}

// Tests intentionally consume this renderer directly: CSP alone is not a
// substitute for escaping raw HTML and removing image/link navigation.
