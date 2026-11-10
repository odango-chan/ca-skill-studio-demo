import {LineCounter,isMap,isScalar,isSeq,parseDocument} from "yaml";

// E3-A1: read-only, exact references in the active in-memory Package.
// This is an editor index, not Python execution, ABI inference or qualification.
const SCRIPT_PATH=/^scripts\/[A-Za-z0-9_.-]+\.py$/;
const SCHEMA_PATH=/^schemas\/[A-Za-z0-9_.-]+\.schema\.ya?ml$/;
const NAME=/^[A-Za-z][A-Za-z0-9_-]*$/;
const TITLE=/^[A-Za-z][A-Za-z0-9]*$/;
const freeze=Object.freeze;

function metadata(text) {
  if(typeof text!=="string"||text.length>1024*1024)return null;
  const header=text.slice(0,4096);
  const lines=header.split(/\r\n|\n|\r/);
  if(lines[0]!=="# /// connectionagent-tool")return null;
  const end=lines.findIndex((line,index)=>index>0&&line==="# ///");
  if(end<2)return null;
  const starts=[];
  let offset=0;
  for(const line of lines){
    starts.push(offset);
    offset+=line.length;
    if(header.startsWith("\r\n",offset))offset+=2;
    else if(header[offset]==="\r"||header[offset]==="\n")offset++;
  }
  const fields=new Map(),ranges=new Map();
  for(let i=1;i<end;i++){
    const match=/^# (name|inputSchema|outputSchema): ([A-Za-z][A-Za-z0-9_-]*)$/.exec(lines[i]);
    if(!match)continue;
    if(fields.has(match[1]))return null;
    fields.set(match[1],match[2]);
    const start=starts[i]+lines[i].length-match[2].length;
    ranges.set(match[1],freeze({start,end:start+match[2].length}));
  }
  const name=fields.get("name"),inputSchema=fields.get("inputSchema"),
    outputSchema=fields.get("outputSchema");
  if(!NAME.test(name??"")||!TITLE.test(inputSchema??"")||
     !TITLE.test(outputSchema??""))return null;
  return freeze({
    name,inputSchema,outputSchema,
    nameRange:ranges.get("name"),
    inputSchemaRange:ranges.get("inputSchema"),
    outputSchemaRange:ranges.get("outputSchema")
  });
}
function source(files,path) {
  const item=files?.get(path);
  return typeof item?.text==="string"&&item.text.length<=1024*1024?
    item.text:null;
}
function parse(files,path,warnings) {
  const text=source(files,path);
  if(text===null)return null;
  const lines=new LineCounter();
  const doc=parseDocument(text,{version:"1.2",schema:"core",
    strict:true,uniqueKeys:true,stringKeys:true,lineCounter:lines,
    logLevel:"silent"});
  if(doc.errors.length){
    warnings.push("无法索引 "+path+"：YAML 无法解析");
    return null;
  }
  return {root:doc.contents,lines};
}
function lineOf(node,counter) {
  return node?.range?counter.linePos(node.range[0]).line||1:1;
}
function walk(node,visit,limit={remaining:20000}) {
  if(--limit.remaining<0)return;
  if(isMap(node)){
    for(const pair of node.items){
      if(isScalar(pair.key))visit(pair.key.value,pair.value);
      walk(pair.value,visit,limit);
    }
  }else if(isSeq(node)){
    for(const child of node.items)walk(child,visit,limit);
  }
}
function field(node,key) {
  return isMap(node)?node.get(key,true):null;
}
function scalar(node) {
  return isScalar(node)&&typeof node.value==="string"?node.value:null;
}
function matchesSchema(files,title,warnings){
  const matches=[];
  for(const [path] of files){
    if(!SCHEMA_PATH.test(path))continue;
    const doc=parse(files,path,warnings);
    const titleNode=field(doc?.root,"title");
    if(doc&&scalar(titleNode)===title&&Array.isArray(titleNode.range))
      matches.push(freeze({
        path,line:lineOf(titleNode,doc.lines),
        targetRange:freeze({start:titleNode.range[0],end:titleNode.range[1]})
      }));
  }
  return matches;
}

// Results are intentionally recomputed from current Package Source on view
// refresh; never retain stale links across edits, Undo/Redo or file switching.
export function scriptNavigationReport(files,path) {
  const empty=freeze({status:"UNAVAILABLE",callers:freeze([]),
    schemas:freeze([]),warnings:freeze([])});
  if(!(files instanceof Map)||!SCRIPT_PATH.test(path??"")||
     source(files,path)===null)return empty;
  const warnings=[],callers=[],schemas=[];
  const own=metadata(source(files,path));
  if(!own)warnings.push("脚本缺少唯一的 connectionagent-tool name/inputSchema/outputSchema 声明");
  const procedure=parse(files,"assurance/procedure.yaml",warnings);
  if(procedure){
    walk(procedure.root,(key,value)=>{
      if(key==="script"&&scalar(value)===path){
        if(Array.isArray(value?.range)&&own?.nameRange){
          callers.push(freeze({
            path:"assurance/procedure.yaml",
            line:lineOf(value,procedure.lines),
            label:"Procedure · script: "+path,
            sourceRange:freeze({start:value.range[0],end:value.range[1]}),
            targetRange:own.nameRange
          }));
        }
      }
    });
  }
  if(own){
    let names=0;
    for(const [candidate] of files){
      if(!SCRIPT_PATH.test(candidate))continue;
      if(metadata(source(files,candidate))?.name===own.name)names++;
    }
    if(names!==1)warnings.push("脚本工具名 "+own.name+" 不唯一，Predicate 引用不可安全定位");
    else {
      const predicates=parse(files,"assurance/predicates.yaml",warnings);
      const records=field(predicates?.root,"predicates");
      if(isMap(records))for(const pair of records.items){
        const evaluator=field(pair.value,"evaluator");
        const ref=field(evaluator,"ref");
        if(scalar(field(evaluator,"type"))==="script"&&
           scalar(ref)==="skill."+own.name){
          if(Array.isArray(ref?.range)&&own.nameRange){
            callers.push(freeze({
              path:"assurance/predicates.yaml",
              line:lineOf(ref,predicates.lines),
              label:"Predicate · "+scalar(pair.key),
              sourceRange:freeze({start:ref.range[0],end:ref.range[1]}),
              targetRange:own.nameRange
            }));
          }
        }
      }
    }
    for(const [role,title,sourceRange] of [
      ["输入",own.inputSchema,own.inputSchemaRange],
      ["输出",own.outputSchema,own.outputSchemaRange]
    ]){
      const matches=matchesSchema(files,title,warnings);
      if(matches.length===1&&sourceRange)
        schemas.push(freeze({...matches[0],role,title,sourceRange}));
      else warnings.push(role+" Schema "+title+
        (matches.length?" 存在多个同名声明":" 未在 Package 中找到"));
    }
  }
  return freeze({status:"READY",callers:freeze(callers),
    schemas:freeze(schemas),warnings:freeze(warnings)});
}
