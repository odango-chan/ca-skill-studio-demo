export function markdownPreviewBridge() {
  const api=acquireVsCodeApi();
  const article=document.querySelector('article');
  let version=Number(article.dataset.version);
  let programmaticTop=null;
  let frame=0;

  function anchors(){
    const points=[{line:0,top:0}];
    for(const element of article.querySelectorAll('[data-source-start]')){
      const box=element.getBoundingClientRect();
      points.push({line:Number(element.dataset.sourceStart),top:box.top+scrollY});
      points.push({line:Number(element.dataset.sourceEnd),top:box.bottom+scrollY});
    }
    return points;
  }

  function map(value,from,to){
    const points=anchors();
    for(let i=1;i<points.length;i++){
      const previous=points[i-1],next=points[i];
      if(value>=next[from])continue;
      const span=next[from]-previous[from];
      if(span>0)return previous[to]+(next[to]-previous[to])*(value-previous[from])/span;
    }
    return points.at(-1)[to];
  }

  function reveal(line){
    scrollTo(0,map(line,'line','top'));
    programmaticTop=scrollY;
  }

  addEventListener('message',({data})=>{
    if(data?.type==='renderMarkdown'&&data.version>=version){
      const line=map(scrollY,'top','line');
      const expanded=[...article.querySelectorAll('details[open]')].map(node=>node.className);
      article.innerHTML=data.html;
      for(const node of article.querySelectorAll('details'))node.open=expanded.includes(node.className);
      version=data.version;
      reveal(line);
    }
    if(data?.type==='revealMarkdownLine'&&data.version===version)reveal(data.line);
  });
  addEventListener('scroll',()=>{
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      if(scrollY===programmaticTop)return;
      programmaticTop=null;
      api.postMessage({type:'markdownVisibleLine',version,line:Math.floor(map(scrollY,'top','line'))});
    });
  });
  document.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    if(target.closest('.md-source-switch'))api.postMessage({type:'showMarkdownSource'});
    const link=target.closest('a[data-local-path]');
    if(!link)return;
    event.preventDefault();
    api.postMessage({type:'openPackageFile',path:link.dataset.localPath});
  });
  api.postMessage({type:'markdownReady'});
}
