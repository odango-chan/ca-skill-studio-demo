import {parseDocument,LineCounter,isMap,isSeq,isScalar} from "yaml";
import {projectWorkspace} from "./workspace.mjs";

// Conservative editor diagnostics only. No Runtime, capability discovery,
// schema typing or production Skill validation is inferred from these checks.
const FILES=Object.freeze({
  procedure:"assurance/procedure.yaml",
  contract:"assurance/contract.yaml",
  predicates:"assurance/predicates.yaml"
});
const NAME=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
function values(node){
  return isSeq(node)?node.items.map(n=>isScalar(n)?n.value:null)
    .filter(x=>typeof x==="string"):[];
}
function entries(node){
  return isMap(node)?node.items:[];
}
function v(node){return isScalar(node)?node.value:null;}
function get(node,...path){
  let n=node;
  for(const part of path){
    if(!isMap(n))return null;
    n=n.get(part,true);
  }
  return n;
}
function normalized(s){return String(s).replace(/[^a-zA-Z0-9]/g,"").toLowerCase();}
function collectActions(node,fn){
  if(isMap(node)){
    for(const pair of node.items){
      const field=v(pair.key),value=pair.value;
      if(field==="from"||field==="call"||field==="tool"||
         field==="verify"||field==="predicate"||field==="script"){
        if(isScalar(value)&&typeof value.value==="string")
          fn(field,value,node);
      }
      collectActions(value,fn);
    }
  }else if(isSeq(node)){
    for(const item of node.items)collectActions(item,fn);
  }
}
export function auditPackageWorkspace(workspace,procedureOverride=null){
  const fileMap=workspace?.files;
  if(!(fileMap instanceof Map)||
     ![FILES.procedure,FILES.contract,FILES.predicates]
       .every(path=>typeof fileMap.get(path)?.text==="string"))return [];
  const sources=new Map([...fileMap].map(([path,file])=>[
    path,path===FILES.procedure&&typeof procedureOverride==="string"?
      procedureOverride:file.text
  ]));
  const diagnostics=[],parsed=new Map(),counters=new Map();
  const warn=(code,path,node,message)=>{
    if(diagnostics.length>=80)return;
    const counter=counters.get(path);
    const line=counter&&node?.range?counter.linePos(node.range[0]).line||1:1;
    diagnostics.push(Object.freeze({
      severity:"warning",code,path,line,message
    }));
  };
  for(const path of [FILES.contract,FILES.predicates,FILES.procedure]){
    const counter=new LineCounter();
    counters.set(path,counter);
    const doc=parseDocument(sources.get(path),{
      version:"1.2",schema:"core",strict:true,uniqueKeys:true,
      stringKeys:true,lineCounter:counter,logLevel:"silent"
    });
    if(doc.errors.length){
      const err=doc.errors[0];
      warn("YAML_PARSE",path,err.pos?
        {range:[err.pos[0],err.pos[1]]}:null,"YAML 无法解析："+err.message);
      return Object.freeze(diagnostics);
    }
    parsed.set(path,doc.contents);
  }
  const contract=parsed.get(FILES.contract);
  const predicates=parsed.get(FILES.predicates);
  const procedureAst=parsed.get(FILES.procedure);
  const predIds=new Set(entries(get(predicates,"predicates")).map(pair=>v(pair.key)));
  const procedureModel=projectWorkspace(sources.get(FILES.procedure));
  // Procedure projection itself reports the authoritative source errors.
  if(procedureModel.state!=="READY")return Object.freeze(diagnostics);
  const ids=new Set(procedureModel.procedures.keys());
  const contractName=v(get(contract,"metadata","name"));
  const predName=v(get(predicates,"metadata","skill"));
  if(contractName!==workspace.name)
    warn("CONTRACT_NAME",FILES.contract,get(contract,"metadata","name"),
      "Contract 名称与当前 Package 不一致");
  if(predName!==workspace.name)
    warn("PREDICATE_SKILL",FILES.predicates,get(predicates,"metadata","skill"),
      "PredicateSet 的 Skill 名称与 Package 不一致");
  const entry=v(get(contract,"spec","entryProcedure"));
  if(!ids.has(entry))
    warn("ENTRY_PROCEDURE",FILES.contract,
      get(contract,"spec","entryProcedure"),"Contract entryProcedure 不存在："+entry);
  const schema=v(get(contract,"spec","inputs","requestSchema"));
  if(typeof schema==="string"&&!sources.has(schema))
    warn("REQUEST_SCHEMA",FILES.contract,
      get(contract,"spec","inputs","requestSchema"),"Contract Schema 文件未包含在 Package："+schema);
  const allowed=new Set([
    ...values(get(contract,"spec","allowedResources","capabilities")),
    ...values(get(contract,"spec","allowedResources","localTools"))
  ]);
  // Contract's explicit predicate references.
  for(const section of ["preconditions","postconditions"]){
    for(const record of (isSeq(get(contract,"spec",section))?
      get(contract,"spec",section).items:[])){
      const ref=get(record,"predicate");
      if(typeof v(ref)==="string"&&!predIds.has(v(ref)))
        warn("CONTRACT_PREDICATE",FILES.contract,ref,
          "Contract 引用了未定义 Predicate："+v(ref));
    }
  }
  for(const pair of entries(get(procedureAst,"procedures"))){
    const procId=v(pair.key);
    const proc=procedureModel.procedures.get(procId);
    if(!proc)continue;
    const nodes=get(pair.value,"nodes");
    const inputs=get(pair.value,"inputs");
    const inputKeys=new Set(entries(inputs).map(x=>v(x.key)));
    const inputByNormalized=new Map([...inputKeys].map(k=>[normalized(k),k]));
    const nodeIds=new Set(proc.nodes.map(n=>n.id));
    for(const nodePair of entries(nodes)){
      const nodeId=v(nodePair.key);
      const node=nodePair.value;
      // Existing output source references may be qualified syntactically but
      // still unresolved. We check only identities, not output-field schema.
      collectActions(node,(field,scalar)=>{
        const val=v(scalar);
        if((field==="verify"||field==="predicate")&&!predIds.has(val)){
          warn("NODE_PREDICATE",FILES.procedure,scalar,
            procId+"/"+nodeId+" 使用未定义 Predicate："+val);
        }else if((field==="call"||field==="tool")&&
                 !allowed.has(val)){
          warn("CAPABILITY_UNDECLARED",FILES.procedure,scalar,
            procId+"/"+nodeId+" 的 "+field+" 未列入 Contract capabilities/localTools："+val);
        }else if(field==="script"&&val.startsWith("scripts/")&&!sources.has(val)){
          warn("SCRIPT_MISSING",FILES.procedure,scalar,
            procId+"/"+nodeId+" 的脚本不在当前 Package："+val);
        }else if(field==="from"){
          if(val.startsWith("input.")){
            const key=val.slice(6);
            if(!inputKeys.has(key))
              warn("INPUT_MISSING",FILES.procedure,scalar,
                procId+"/"+nodeId+" 引用了未声明 Procedure input："+key);
          }else{
            const match=val.match(/^([A-Za-z_][A-Za-z0-9_-]*)\.(?:output(?:\.|$)|preconditions\.|postconditions\.)/);
            if(match&&!nodeIds.has(match[1])&&!["preconditions","postconditions"].includes(match[1]))
              warn("PRODUCER_MISSING",FILES.procedure,scalar,
                procId+"/"+nodeId+" 引用了不存在的 Node："+match[1]);
          }
        }
      });
      // Heuristic only: a with key whose canonical name equals one declared
      // input is probably bound incorrectly if it points to another input.
      const withMap=get(node,"with");
      for(const bind of entries(withMap)){
        const key=v(bind.key),ref=get(bind.value,"from");
        const target=v(ref);
        const matching=inputByNormalized.get(normalized(key));
        if(matching&&typeof target==="string"&&target.startsWith("input.")&&
           target!=="input."+matching)
          warn("INPUT_BINDING_SUSPECT",FILES.procedure,ref,
            procId+"/"+nodeId+" 的 with."+key+
            " 通常对应 input."+matching+"，当前却绑定 "+target+
            "；请人工确认类型与语义");
      }
    }
  }
  return Object.freeze(diagnostics);
}
