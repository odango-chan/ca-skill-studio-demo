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
  const diagnostics=[],parsed=new Map(),counters=new Map(),sources=new Map();
  const completeness=workspace?.completeness??"complete";
  const add=(code,path,node,message,{severity="warning",status="confirmed",
    domain="source",category="structure"}={})=>{
    if(diagnostics.length>=300)return;
    const counter=counters.get(path);
    const position=counter&&node?.range?counter.linePos(node.range[0]):null;
    diagnostics.push(Object.freeze({
      kind:"package-diagnostic",severity,status,code,path,relativePath:path,
      line:position?.line||1,column:position?.col||1,message,domain,category,
      source:"Skill Studio · Legacy Package Audit"
    }));
  };
  const warn=(code,path,node,message)=>add(code,path,node,message);
  const notChecked=(code,path,message,domain="package")=>add(code,path,null,message,{
    severity:"warning",status:"not_checked",domain,category:"analysis"
  });
  if(completeness!=="complete")
    notChecked("PACKAGE_SNAPSHOT_INCOMPLETE",FILES.procedure,
      "Package inventory is "+completeness+"; only the captured files can be checked"+
      (workspace?.snapshotReason?": "+workspace.snapshotReason:""));
  if(!(fileMap instanceof Map)){
    notChecked("PACKAGE_INVENTORY_UNAVAILABLE",FILES.procedure,
      "Package file inventory is unavailable; no source or cross-file checks were run");
    return Object.freeze(diagnostics);
  }
  for(const [path,file] of fileMap){
    if(typeof path!=="string"||typeof file?.text!=="string"){
      notChecked("PACKAGE_FILE_UNREADABLE",FILES.procedure,
        "At least one Package entry has no readable text; affected checks were not run");
      continue;
    }
    sources.set(path,path===FILES.procedure&&typeof procedureOverride==="string"?
      procedureOverride:file.text);
  }
  const required=[FILES.procedure,FILES.contract,FILES.predicates];
  for(const path of required){
    if(sources.has(path))continue;
    const observedMissing=completeness==="complete";
    add(observedMissing?"CORE_FILE_MISSING":"CORE_FILE_NOT_OBSERVED",
      path,null,observedMissing
        ?"Required Package source file is missing: "+path
        :"Cannot confirm whether required Package source file exists because the Package inventory is "+completeness,
      {severity:observedMissing?"error":"warning",
       status:observedMissing?"confirmed":"not_checked",
       domain:"package",category:"inventory"});
  }
  // Parse every available YAML file independently. One malformed file must
  // not prevent syntax checks or source-local checks in its siblings.
  for(const [path,text] of sources){
    if(!/\.ya?ml$/i.test(path))continue;
    const counter=new LineCounter();
    counters.set(path,counter);
    const doc=parseDocument(text,{
      version:"1.2",schema:"core",strict:true,uniqueKeys:true,
      stringKeys:true,lineCounter:counter,logLevel:"silent"
    });
    if(doc.errors.length){
      for(const err of doc.errors){
        add("YAML_PARSE",path,err.pos?
          {range:[err.pos[0],err.pos[1]]}:null,"YAML 无法解析："+err.message,
          {severity:"error",domain:"syntax",category:"yaml"});
      }
      continue;
    }
    parsed.set(path,doc.contents);
  }
  // JSON source is independent of YAML/Procedure analysis too.
  for(const [path,text] of sources){
    if(!/\.json$/i.test(path))continue;
    try{JSON.parse(text);}
    catch(error){
      const match=String(error?.message??"").match(/position\s+(\d+)/i);
      const offset=match?Number(match[1]):0;
      const prefix=text.slice(0,offset),line=prefix.split(/\r\n|\r|\n/).length;
      const column=offset-(Math.max(prefix.lastIndexOf("\n"),prefix.lastIndexOf("\r"))+1)+1;
      diagnostics.push(Object.freeze({
        kind:"package-diagnostic",severity:"error",status:"confirmed",
        code:"JSON_PARSE",path,relativePath:path,line,column,
        message:"JSON 无法解析："+String(error?.message??error),
        domain:"syntax",category:"json",source:"Skill Studio · Legacy Package Audit"
      }));
    }
  }
  const contract=parsed.get(FILES.contract);
  const predicates=parsed.get(FILES.predicates);
  const procedureAst=parsed.get(FILES.procedure);
  if(!contract)notChecked("CONTRACT_CHECKS_NOT_CHECKED",FILES.contract,
    "Contract checks were not run because the file is missing or its YAML could not be parsed");
  if(!predicates)notChecked("PREDICATE_CHECKS_NOT_CHECKED",FILES.predicates,
    "PredicateSet checks were not run because the file is missing or its YAML could not be parsed","predicates");
  if(!procedureAst)notChecked("PROCEDURE_CHECKS_NOT_CHECKED",FILES.procedure,
    "Procedure structure and reference checks were not run because the file is missing or its YAML could not be parsed","procedure");
  const predIds=new Set(entries(get(predicates,"predicates")).map(pair=>v(pair.key)));
  const procedureModel=procedureAst
    ?projectWorkspace(sources.get(FILES.procedure))
    :{state:"UNAVAILABLE",diagnostics:[]};
  if(procedureAst&&procedureModel.state!=="READY"){
    const detail=procedureModel.diagnostics?.[0]?.message??"legacy graph projection unavailable";
    notChecked("PROCEDURE_GRAPH_PROJECTION_NOT_CHECKED",FILES.procedure,
      "The visual graph projection could not be built: "+detail+
      ". Independent YAML, metadata and reference checks continue.","procedure");
  }
  const procedureRoot=get(procedureAst,"procedures");
  const procedureEntries=entries(procedureRoot);
  const ids=new Set(procedureEntries.map(pair=>v(pair.key)));
  const contractName=contract?v(get(contract,"metadata","name")):null;
  const predName=predicates?v(get(predicates,"metadata","skill")):null;
  if(contract){
    if(contractName!==workspace?.name)
      warn("CONTRACT_NAME",FILES.contract,get(contract,"metadata","name"),
        "Contract metadata.name 与当前 Package 不一致");
    if(v(get(contract,"kind"))&&v(get(contract,"kind"))!=="SkillContract")
      add("CONTRACT_KIND_INVALID",FILES.contract,get(contract,"kind"),
        "Contract kind 必须为 SkillContract",{severity:"error",domain:"contract"});
    const apiVersion=v(get(contract,"apiVersion"));
    if(apiVersion&&apiVersion!=="connectionagent.io/v1alpha1")
      warn("CONTRACT_API_VERSION_UNRECOGNIZED",FILES.contract,get(contract,"apiVersion"),
        "Legacy analyzer detected an unexpected Contract apiVersion: "+apiVersion);
  }
  if(predicates){
    if(predName&&contractName&&predName!==contractName)
      warn("PREDICATE_SKILL",FILES.predicates,get(predicates,"metadata","skill"),
        "PredicateSet 的 Skill 名称与 Contract 不一致");
    if(v(get(predicates,"kind"))&&v(get(predicates,"kind"))!=="PredicateSet")
      add("PREDICATE_KIND_INVALID",FILES.predicates,get(predicates,"kind"),
        "PredicateSet kind 必须为 PredicateSet",{severity:"error",domain:"predicates"});
    const apiVersion=v(get(predicates,"apiVersion"));
    const contractVersion=v(get(contract,"apiVersion"));
    if(apiVersion&&contractVersion&&apiVersion!==contractVersion)
      add("API_VERSION_MISMATCH",FILES.predicates,get(predicates,"apiVersion"),
        "Contract 与 PredicateSet apiVersion 不一致",{severity:"error",domain:"language"});
  }
  const entry=contract?v(get(contract,"spec","entryProcedure")):null;
  if(contract&&typeof entry==="string"&&!ids.has(entry))
    add("ENTRY_PROCEDURE",FILES.contract,get(contract,"spec","entryProcedure"),
      "Contract entryProcedure 不存在："+entry,{severity:"error",domain:"contract"});
  if(contract&&!entry)
    add("ENTRY_PROCEDURE_MISSING",FILES.contract,get(contract,"spec"),
      "Contract 缺少 spec.entryProcedure",{severity:"error",domain:"contract"});
  const schema=contract?v(get(contract,"spec","inputs","requestSchema")):null;
  if(typeof schema==="string"&&!sources.has(schema))
    add("REQUEST_SCHEMA",FILES.contract,get(contract,"spec","inputs","requestSchema"),
      "Contract Schema 文件未包含在 Package："+schema,
      {severity:"error",domain:"schemas"});
  const allowed=new Set([
    ...values(get(contract,"spec","allowedResources","capabilities")),
    ...values(get(contract,"spec","allowedResources","localTools"))
  ]);
  // Contract's explicit predicate references.
  if(contract&&predicates){
    for(const section of ["preconditions","postconditions"]){
      const records=get(contract,"spec",section);
      if(records!==null&&!isSeq(records)){
        add("CONTRACT_PREDICATE_SECTION_INVALID",FILES.contract,records,
          "Contract spec."+section+" 必须是列表",{severity:"error",domain:"contract"});
        continue;
      }
      for(const record of (isSeq(records)?records.items:[])){
        const ref=get(record,"predicate");
        if(typeof v(ref)==="string"&&!predIds.has(v(ref)))
          add("CONTRACT_PREDICATE",FILES.contract,ref,
            "Contract 引用了未定义 Predicate："+v(ref),
            {severity:"error",domain:"predicates"});
      }
    }
  }else if(contract&&!predicates){
    notChecked("CONTRACT_PREDICATE_LINKS_NOT_CHECKED",FILES.contract,
      "Contract Predicate 引用无法核对：PredicateSet 缺失或 YAML 解析失败","predicates");
  }

  // Validate PredicateSet structure independently of Procedure graph projection.
  if(predicates){
    const definitions=get(predicates,"predicates");
    if(!isMap(definitions)){
      add("PREDICATE_SET_INVALID",FILES.predicates,definitions,
        "PredicateSet 必须包含 predicates mapping",{severity:"error",domain:"predicates"});
    }else for(const pair of definitions.items){
      const id=v(pair.key),body=pair.value;
      if(!isMap(body)){
        add("PREDICATE_DEFINITION_INVALID",FILES.predicates,body,
          "Predicate "+id+" 必须是 mapping",{severity:"error",domain:"predicates"});
        continue;
      }
      const observations=get(body,"observations"),evaluator=get(body,"evaluator");
      if(!isMap(observations)||observations.items.length===0)
        add("PREDICATE_OBSERVATIONS_INVALID",FILES.predicates,observations??body,
          "Predicate "+id+" 必须声明非空 observations mapping",
          {severity:"error",domain:"predicates"});
      else for(const observation of observations.items){
        if(!isMap(observation.value)){
          add("OBSERVATION_INVALID",FILES.predicates,observation.value,
            "Predicate "+id+" 的 Observation "+v(observation.key)+" 必须是 mapping",
            {severity:"error",domain:"observations"});
          continue;
        }
        for(const field of ["ref","scope","freshness"]){
          if(typeof v(get(observation.value,field))!=="string")
            add("OBSERVATION_FIELD_MISSING",FILES.predicates,observation.value,
              "Predicate "+id+" 的 Observation "+v(observation.key)+" 缺少字符串字段 "+field,
              {severity:"error",domain:"observations"});
        }
      }
      if(!isMap(evaluator))
        add("PREDICATE_EVALUATOR_INVALID",FILES.predicates,evaluator??body,
          "Predicate "+id+" 缺少 evaluator mapping",
          {severity:"error",domain:"predicates"});
      else{
        const type=v(get(evaluator,"type")),expression=v(get(evaluator,"expression"));
        if(typeof type!=="string"||!type)
          add("PREDICATE_EVALUATOR_TYPE_MISSING",FILES.predicates,evaluator,
            "Predicate "+id+" 的 evaluator 缺少 type",{severity:"error",domain:"predicates"});
        if(typeof expression!=="string"||!expression.trim())
          add("PREDICATE_EXPRESSION_MISSING",FILES.predicates,evaluator,
            "Predicate "+id+" 的 evaluator 缺少非空 expression",
            {severity:"error",domain:"predicates"});
      }
    }
  }

  const operators=new Set(["call","verify","terminal","procedure","reconcile","tool","script","predicate"]);
  const referencedScripts=new Set();
  if(procedureAst){
    if(!isMap(procedureRoot)||procedureEntries.length===0){
      add("PROCEDURES_ROOT_INVALID",FILES.procedure,procedureRoot,
        "Legacy Procedure 必须包含非空 procedures mapping",
        {severity:"error",domain:"procedure"});
    }
    for(const pair of procedureEntries){
      const procId=v(pair.key),procNode=pair.value;
      if(!isMap(procNode)){
        add("PROCEDURE_INVALID",FILES.procedure,procNode,
          "Procedure "+procId+" 必须是 mapping",{severity:"error",domain:"procedure"});
        continue;
      }
      const nodes=get(procNode,"nodes"),inputs=get(procNode,"inputs");
      if(!isMap(nodes)){
        add("PROCEDURE_NODES_INVALID",FILES.procedure,nodes??procNode,
          "Procedure "+procId+" 缺少 nodes mapping",{severity:"error",domain:"procedure"});
        continue;
      }
      const nodeEntries=nodes.items,nodeIds=new Set(nodeEntries.map(item=>v(item.key)));
      const inputKeys=new Set(entries(inputs).map(item=>v(item.key)));
      const inputByNormalized=new Map([...inputKeys].map(key=>[normalized(key),key]));
      const startNode=v(get(procNode,"start"));
      if(!startNode)
        add("PROCEDURE_START_MISSING",FILES.procedure,procNode,
          "Procedure "+procId+" 缺少 start",{severity:"error",domain:"procedure"});
      else if(!nodeIds.has(startNode))
        add("PROCEDURE_START_NOT_FOUND",FILES.procedure,get(procNode,"start"),
          "Procedure "+procId+" 的 start 指向不存在的 Node："+startNode,
          {severity:"error",domain:"procedure"});
      const adjacency=new Map(nodeEntries.map(item=>[v(item.key),[]]));
      for(const nodePair of nodeEntries){
        const nodeId=v(nodePair.key),node=nodePair.value;
        if(!isMap(node)){
          add("NODE_INVALID",FILES.procedure,node,
            "Node "+procId+"/"+nodeId+" 必须是 mapping",
            {severity:"error",domain:"procedure"});
          continue;
        }
        const nodeOperators=node.items.filter(item=>operators.has(v(item.key)));
        if(nodeOperators.length!==1)
          add("NODE_OPERATOR_COUNT",FILES.procedure,node,
            "Node "+procId+"/"+nodeId+" 必须且只能声明一个 Operator；当前为 "+nodeOperators.length,
            {severity:"error",domain:"procedure"});
        const validateRoutes=(routeNode,routeLabel)=>{
          if(routeNode===null)return;
          if(!isMap(routeNode)){
            add("ROUTES_INVALID",FILES.procedure,routeNode,
              procId+"/"+nodeId+" 的 "+routeLabel+" 必须是 mapping",
              {severity:"error",domain:"procedure"});
            return;
          }
          for(const route of routeNode.items){
            const target=v(route.value);
            if(typeof target!=="string"||!target){
              add("ROUTE_TARGET_INVALID",FILES.procedure,route.value,
                procId+"/"+nodeId+" 的 "+routeLabel+"."+v(route.key)+" 必须指向 Node ID",
                {severity:"error",domain:"procedure"});
            }else if(!nodeIds.has(target)){
              add("ROUTE_TARGET_MISSING",FILES.procedure,route.value,
                procId+"/"+nodeId+" 的 "+routeLabel+" 指向不存在的 Node："+target,
                {severity:"error",domain:"procedure"});
            }else adjacency.get(nodeId)?.push(target);
          }
        };
        validateRoutes(get(node,"on"),"on");
        for(const phaseName of ["preconditions","postconditions"]){
          const phase=get(node,phaseName);
          if(phase===null)continue;
          if(!isMap(phase)){
            add("PHASE_INVALID",FILES.procedure,phase,
              procId+"/"+nodeId+" 的 "+phaseName+" 必须是 mapping",
              {severity:"error",domain:"procedure"});
            continue;
          }
          const steps=get(phase,"steps");
          if(steps!==null&&!isSeq(steps))
            add("PHASE_STEPS_INVALID",FILES.procedure,steps,
              procId+"/"+nodeId+" 的 "+phaseName+".steps 必须是有序列表",
              {severity:"error",domain:"procedure"});
          for(const step of (isSeq(steps)?steps.items:[])){
            if(!isMap(step)){
              add("PHASE_STEP_INVALID",FILES.procedure,step,
                procId+"/"+nodeId+" 的 "+phaseName+" Step 必须是 mapping",
                {severity:"error",domain:"procedure"});
              continue;
            }
            const stepOperators=step.items.filter(item=>operators.has(v(item.key)));
            if(stepOperators.length!==1)
              add("PHASE_STEP_OPERATOR_COUNT",FILES.procedure,step,
                procId+"/"+nodeId+" 的 "+phaseName+" Step 必须且只能包含一个 Operator",
                {severity:"error",domain:"procedure"});
          }
          validateRoutes(get(phase,"on"),phaseName+".on");
        }
        collectActions(node,(field,scalar)=>{
          const value=v(scalar);
          if(field==="verify"||field==="predicate"){
            if(predicates&&!predIds.has(value))
              add("NODE_PREDICATE",FILES.procedure,scalar,
                procId+"/"+nodeId+" 使用未定义 Predicate："+value,
                {severity:"error",domain:"predicates"});
            else if(!predicates)
              notChecked("NODE_PREDICATE_NOT_CHECKED",FILES.procedure,
                "Cannot resolve Predicate "+value+" because PredicateSet is unavailable","predicates");
          }else if(field==="call"||field==="tool"){
            if(contract&&!allowed.has(value))
              add("CAPABILITY_UNDECLARED",FILES.procedure,scalar,
                procId+"/"+nodeId+" 的 "+field+" 未列入 Contract capabilities/localTools："+value,
                {severity:"error",domain:"capabilities"});
            else if(!contract)
              notChecked("CAPABILITY_DECLARATION_NOT_CHECKED",FILES.procedure,
                "Cannot resolve "+field+" "+value+" because Contract is unavailable","capabilities");
          }else if(field==="script"){
            if(/\.py$/i.test(value))referencedScripts.add(value);
            if(!sources.has(value))
              add("SCRIPT_MISSING",FILES.procedure,scalar,
                procId+"/"+nodeId+" 的脚本不在当前 Package："+value,
                {severity:"error",domain:"scripts"});
          }else if(field==="from"){
            if(value.startsWith("input.")){
              const key=value.slice(6);
              if(!inputKeys.has(key))
                add("INPUT_MISSING",FILES.procedure,scalar,
                  procId+"/"+nodeId+" 引用了未声明 Procedure input："+key,
                  {severity:"error",domain:"procedure"});
            }else{
              const match=value.match(/^([A-Za-z_][A-Za-z0-9_-]*)\.(?:output(?:\.|$)|preconditions\.|postconditions\.)/);
              if(match&&!nodeIds.has(match[1])&&!["preconditions","postconditions"].includes(match[1]))
                add("PRODUCER_MISSING",FILES.procedure,scalar,
                  procId+"/"+nodeId+" 引用了不存在的 Node："+match[1],
                  {severity:"error",domain:"procedure"});
            }
          }
        });
        const withMap=get(node,"with");
        for(const bind of entries(withMap)){
          const key=v(bind.key),ref=get(bind.value,"from"),target=v(ref);
          const matching=inputByNormalized.get(normalized(key));
          if(matching&&typeof target==="string"&&target.startsWith("input.")&&
             target!=="input."+matching)
            warn("INPUT_BINDING_SUSPECT",FILES.procedure,ref,
              procId+"/"+nodeId+" 的 with."+key+
              " 通常对应 input."+matching+"，当前却绑定 "+target+
              "；这是启发式提示，需要人工确认类型与语义");
        }
      }
      if(startNode&&nodeIds.has(startNode)){
        const reachable=new Set([startNode]),queue=[startNode];
        while(queue.length){
          const current=queue.shift();
          for(const target of adjacency.get(current)??[]){
            if(!reachable.has(target)){reachable.add(target);queue.push(target);}
          }
        }
        for(const item of nodeEntries){
          const id=v(item.key);
          if(!reachable.has(id))
            warn("NODE_UNREACHABLE",FILES.procedure,item.key,
              "Node "+procId+"/"+id+" 无法从 start "+startNode+" 到达");
        }
      }
    }
  }

  if(sources.has(FILES.procedure)&&!contract)
    notChecked("PROCEDURE_CONTRACT_LINKS_NOT_CHECKED",FILES.procedure,
      "Procedure 的 Capability / Contract 引用无法完整核对：Contract 不可用","contract");
  if(sources.has(FILES.procedure)&&!predicates)
    notChecked("PROCEDURE_PREDICATE_LINKS_NOT_CHECKED",FILES.procedure,
      "Procedure 的 Predicate 引用无法完整核对：PredicateSet 不可用","predicates");
  if(referencedScripts.size)
    notChecked("PYTHON_SYNTAX_NOT_CHECKED",FILES.procedure,
      "已检查 "+referencedScripts.size+" 个脚本引用的文件存在性；Python 语法/类型未由当前浏览器端 Package Audit 执行","scripts");
  if(allowed.size)
    notChecked("CAPABILITY_AUTHORIZATION_NOT_CHECKED",FILES.contract,
      "已检查 Capability 是否在本地 Contract 声明；Owner 身份、发布证明与运行授权不在本地静态检查范围内","capabilities");
  return Object.freeze(diagnostics);
}
