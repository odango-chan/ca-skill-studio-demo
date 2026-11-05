// E5: bounded, read-only, literal search of the current in-memory Package.
// This is an editor navigation feature, not a schema validator or disk index.
export const PACKAGE_SEARCH_LIMITS=Object.freeze({
  query:96,files:64,charactersPerFile:1024*1024,
  results:80,resultsPerFile:16
});
const REGEXP_SPECIAL=new Set(["\\","^","$",".","*","+","?","(",")","[","]","{","}","|"]);
function literalPattern(value){
  return [...value].map(ch=>REGEXP_SPECIAL.has(ch)?"\\"+ch:ch).join("");
}
function excerptFor(text,lineStart,lineEnd,index,length){
  const line=text.slice(lineStart,lineEnd).replace(/\r$/,"");
  const column=index-lineStart;
  const from=Math.max(0,column-42);
  const to=Math.min(line.length,Math.max(from+112,column+length+18));
  return (from?"…":"")+line.slice(from,to)+(to<line.length?"…":"");
}
export function searchPackageText(workspace,query,{
  activePath=null,activeText=null
}={}){
  if(typeof query!=="string")throw new TypeError("Search query must be text");
  if(query.length>PACKAGE_SEARCH_LIMITS.query)
    throw new RangeError("Search query exceeds 96 characters");
  const matches=[];
  const empty={matches,truncated:false,scannedFiles:0,skippedLarge:0};
  const term=query.trim();
  if(!term||!(workspace?.files instanceof Map))return empty;
  const regex=new RegExp(literalPattern(term),"giu");
  let truncated=false,scannedFiles=0,skippedLarge=0;
  const files=[...workspace.files.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(files.length>PACKAGE_SEARCH_LIMITS.files)truncated=true;
  for(const file of files.slice(0,PACKAGE_SEARCH_LIMITS.files)){
    if(!file?.editable)continue; // Opaque bytes cannot be decoded as text.
    const text=file.path===activePath&&typeof activeText==="string"
      ?activeText:file.text;
    if(typeof text!=="string")continue;
    if(text.length>PACKAGE_SEARCH_LIMITS.charactersPerFile){
      skippedLarge++;continue;
    }
    scannedFiles++;
    regex.lastIndex=0;
    let line=1,lineStart=0,nextBreak=text.indexOf("\n");
    let perFile=0;
    for(const found of text.matchAll(regex)){
      if(matches.length>=PACKAGE_SEARCH_LIMITS.results||
         perFile>=PACKAGE_SEARCH_LIMITS.resultsPerFile){
        truncated=true;break;
      }
      const index=found.index;
      while(nextBreak!==-1&&nextBreak<index){
        line++;lineStart=nextBreak+1;
        nextBreak=text.indexOf("\n",lineStart);
      }
      const end=nextBreak===-1?text.length:nextBreak;
      matches.push({
        path:file.path,line,column:index-lineStart+1,
        preview:excerptFor(text,lineStart,end,index,found[0].length)
      });
      perFile++;
    }
  }
  return {matches,truncated,scannedFiles,skippedLarge};
}
