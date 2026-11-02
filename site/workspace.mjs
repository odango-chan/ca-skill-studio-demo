import { parseDocument, LineCounter, isAlias, isMap, isSeq, isScalar } from "yaml";

// Read-only multi-procedure projection. Does NOT make any new syntax editable.
// The Source text is the only authority; phase steps are ordered inspector rows,
// not invented graph nodes, and every route records its actual YAML source.
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OPERATORS = new Set(["call", "verify", "terminal", "procedure", "reconcile", "tool", "script", "predicate"]);
const PHASES = ["preconditions", "postconditions"];
const STEP_OPERATORS = new Set([...OPERATORS]);
const MAX_FILE = 1024 * 1024;
const MAX_NODES = 300;
const MAX_ROUTES = 1600;

class ReadError extends Error {
  constructor(message, line = 1) { super(message); this.line = line; }
}
const fail = (message, line = 1) => { throw new ReadError(message, line); };
const at = (node, counter) => counter.linePos(node?.range?.[0] ?? 0).line || 1;
const string = (node, label, counter) => {
  if (!isScalar(node) || typeof node.value !== "string" || !NAME.test(node.value))
    fail(label + " 必须是可识别的字符串标量", at(node, counter));
  return node.value;
};
const map = (node, label, counter) => {
  if (!isMap(node)) fail(label + " 不是 mapping", at(node, counter));
  const result = new Map();
  for (const pair of node.items) {
    const key = string(pair.key, label + " key", counter);
    if (result.has(key)) fail("重复 YAML key: " + key, at(pair.key, counter));
    result.set(key, { value: pair.value, keyNode: pair.key });
  }
  return result;
};
const optional = (fields, key) => fields.get(key)?.value;
const mandatory = (fields, key, label, counter) => {
  const result = optional(fields, key);
  if (!result) fail(label + " 缺少 " + key);
  return result;
};
function scanUnsafe(node, counter, budget = {remaining: 120000}, depth = 0) {
  if (--budget.remaining < 0 || depth > 48) fail("YAML 节点/层级超出预览限制", at(node,counter));
  if (!node) return;
  if (isAlias(node) || node.anchor || node.tag) fail("Alias / Anchor / Tag 暂不支持投影", at(node,counter));
  if (isMap(node)) for (const pair of node.items) {
    scanUnsafe(pair.key, counter, budget, depth + 1);
    scanUnsafe(pair.value, counter, budget, depth + 1);
  } else if (isSeq(node)) for (const item of node.items) scanUnsafe(item,counter,budget,depth+1);
}

function phaseView(raw, name, counter, nodeName, routeSink, childSink, text) {
  const fields = map(raw, nodeName + "." + name, counter);
  for (const key of fields.keys())
    if (key !== "steps" && key !== "on") fail("Phase 字段尚未纳入只读投影: " + key, at(fields.get(key).keyNode,counter));
  const steps = [];
  if (fields.has("steps")) {
    const list = optional(fields,"steps");
    if (!isSeq(list)) fail("Phase.steps 必须是有序列表",at(list,counter));
    if (list.items.length > 80) fail("单个 Phase 步骤数量过多");
    for (let i = 0; i < list.items.length; i++) {
      const rawStep = list.items[i];
      const item = map(rawStep, nodeName + "." + name + ".steps[" + i + "]", counter);
      const operators = [...item.keys()].filter(key => STEP_OPERATORS.has(key));
      if (operators.length !== 1) fail("Phase Step 需要且只能包含一个 Operator", at(rawStep,counter));
      const operator = operators[0];
      const rawValue = optional(item,operator);
      const value = operator === "script"
        ? (isScalar(rawValue) && typeof rawValue.value === "string" && /^[A-Za-z0-9_./-]+$/.test(rawValue.value)
            ? rawValue.value : fail("脚本路径不能被安全投影",at(rawValue,counter)))
        : string(rawValue, "Step Operator",counter);
      const step = {
        index:i+1, line:at(rawStep,counter), name:item.has("name") ? string(optional(item,"name"),"Step name",counter) : "",
        operator, value
      };
      steps.push(step);
      if (operator === "procedure") childSink.push({
        procedure:value, via:name + ".steps[" + i + "]", line:step.line
      });
    }
  }
  if (fields.has("on")) addRoutes(optional(fields,"on"), nodeName, name, counter, routeSink, text);
  return { name, line:at(raw,counter), steps, routeCount:routeSink.filter(r=>r.source===nodeName && r.routeSource===name+".on").length };
}

function addRoutes(raw, nodeName, source, counter, routes, text) {
  const routeMap = map(raw,nodeName + "." + source + ".on",counter);
  for (const [outcome, item] of routeMap) {
    const target = string(item.value,"Route target",counter);
    const range = item.value.range;
    if (!range) fail("Route 没有 Source Span", at(item.value,counter));
    const id = source === "operator" ? nodeName + ":" + outcome : nodeName + ":" + source + ":" + outcome;
    routes.push({
      id, source:nodeName, outcome, target,
      routeSource:source + ".on", line:at(item.keyNode,counter),
      sourceSpan:{start:range[0],end:range[1]}, patchable:text.slice(range[0],range[1])===target
    });
  }
}

function parseOne(name, entry, counter, text) {
  const fields = map(entry.value,"procedure " + name,counter);
  for (const key of fields.keys())
    if (!["applicability","inputs","start","nodes"].includes(key))
      fail("Procedure 字段尚未纳入投影: " + key,at(fields.get(key).keyNode,counter));
  const start=string(mandatory(fields,"start",name,counter),"start",counter);
  const rawNodes=map(mandatory(fields,"nodes",name,counter),name+".nodes",counter);
  if (rawNodes.size>MAX_NODES) fail("Node 超出预览上限");
  const nodes=[],routes=[],children=[];
  for (const [id,entry] of rawNodes) {
    const fields=map(entry.value,name+".nodes."+id,counter);
    const keys=[...fields.keys()].filter(x=>OPERATORS.has(x));
    if(keys.length!==1) fail("Node Operator 必须恰好一个: "+id,at(entry.value,counter));
    const operator=keys[0];
    const value=string(optional(fields,operator),"Node Operator",counter);
    for (const k of fields.keys())
      if(!OPERATORS.has(k) && !["on","with","from","preconditions","postconditions"].includes(k))
        fail("当前 Profile 不识别 Node 字段: "+k,at(fields.get(k).keyNode,counter));
    const node={id,operator,value,line:at(entry.keyNode,counter),phases:[],children:[]};
    for(const phase of PHASES){
      if(fields.has(phase)){
        const projection=phaseView(optional(fields,phase),phase,counter,id,routes,node.children,text);
        node.phases.push(projection);
      }
    }
    if(fields.has("on"))addRoutes(optional(fields,"on"),id,"operator",counter,routes,text);
    if(operator==="procedure")node.children.push({procedure:value,via:"operator",line:node.line});
    if(operator!=="terminal" && !routes.some(r=>r.source===id))
      fail("非终态 Node 没有任何 Route: "+id,node.line);
    if(operator==="terminal" && routes.some(r=>r.source===id))
      fail("Terminal 有 Route: "+id,node.line);
    nodes.push(node);
    for(const ref of node.children)children.push({...ref,caller:id});
  }
  if(routes.length>MAX_ROUTES) fail("Route 数量超过预览上限");
  const ids=new Set(nodes.map(n=>n.id));
  if(!ids.has(start))fail("start 未指向现有 Node: "+name);
  for(const route of routes)
    if(!ids.has(route.target))fail("Route 悬空: "+name+"/"+route.id+" → "+route.target,route.line);
  const routeKeys=new Set();
  for(const route of routes){
    if(routeKeys.has(route.id))fail("Route ID 冲突: "+route.id,route.line);
    routeKeys.add(route.id);
  }
  return {name,start,nodes,routes,children,line:at(entry.keyNode,counter),profile:"multi-procedure-readonly-v1"};
}

export function projectWorkspace(text) {
  try {
    if(typeof text!=="string" || text.length>MAX_FILE)fail("文件超过 1 MiB 预览上限");
    if(text.split(/\r\n|\n|\r/).length>20000)fail("行数超出预览上限");
    const counter=new LineCounter();
    const doc=parseDocument(text,{
      version:"1.2",schema:"core",uniqueKeys:true,stringKeys:true,
      strict:true,keepSourceTokens:true,lineCounter:counter,logLevel:"silent"
    });
    if(doc.errors.length){
      const error=doc.errors[0];
      fail("YAML 解析失败: "+error.message,counter.linePos(error.pos?.[0]??0).line||1);
    }
    if(doc.directives?.docStart || doc.directives?.docEnd || /^\s*%YAML/m.test(text))
      fail("YAML 文档指令暂不支持多 Procedure 图形投影");
    scanUnsafe(doc.contents,counter);
    const roots=map(doc.contents,"root",counter);
    if(roots.size!==1 || !roots.has("procedures"))fail("只支持 procedures YAML 根结构");
    const defs=map(optional(roots,"procedures"),"procedures",counter);
    if(defs.size<1 || defs.size>32)fail("Procedure 数量超出支持范围");
    const procedures=new Map();
    for(const [name,entry] of defs)procedures.set(name,parseOne(name,entry,counter,text));
    for(const proc of procedures.values())
      for(const child of proc.children)
        if(!procedures.has(child.procedure))
          fail("Child Procedure 引用不存在: "+proc.name+"/"+child.caller+" → "+child.procedure,child.line);
    const entry=[...procedures.keys()][0];
    return {
      state:"READY", diagnostics:[], entry, procedures,
      // Existing ensure single-file patch is kept isolated in patch.mjs.
      procedure:procedures.get(entry)
    };
  }catch(err){
    return {state:"UNAVAILABLE",diagnostics:[{
      message:err instanceof ReadError ? err.message : "无法安全投影: "+String(err?.message ?? err),
      line:err instanceof ReadError ? err.line : 1
    }],entry:null,procedures:new Map(),procedure:null};
  }
}
