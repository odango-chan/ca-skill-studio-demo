// Native VS Code / Theia Testing API for offline Procedure Route scenarios.
// These are controlled Outcome replays, NOT Tool/Predicate/Ingress execution.
import {collectPackageSnapshot} from "./package-snapshot.mjs";
import {
  BUILTIN_ROUTE_SCENARIOS,discoverAuthoredRouteScenarios,
  runRouteScenarioSuite
} from "../../../../site/v1alpha5-route-test-suite.mjs";

const ROOT_ID="skillStudio.routeScenarios";
const BUILTIN_GROUP="builtins",AUTHORED_GROUP="authored";

export function registerPackageRouteTesting(vscode,context,{
  getActiveProcedure=()=>vscode.window.activeTextEditor?.document??null,
  snapshotProvider=collectPackageSnapshot
}={}){
  const output=vscode.window.createOutputChannel("Skill Studio · Procedure Route Scenarios");
  context.subscriptions.push(output);
  let controller=null,root=null;
  const known=new Map();
  const groups=new Map();

  async function readCurrentPackage(){
    const doc=getActiveProcedure?.();
    if(!doc?.uri?.path?.endsWith("/assurance/procedure.yaml"))
      return {files:null,packageName:null,reason:"No active v1alpha5 Procedure"};
    try{
      const snapshot=await snapshotProvider(vscode,doc,0);
      if(snapshot?.completeness!=="complete"||!Array.isArray(snapshot.documents))
        return {files:null,packageName:snapshot?.packageName??null,
          reason:"Incomplete Package source snapshot: "+String(snapshot?.reason??"unknown")};
      const files=new Map(snapshot.documents.map(item=>[
        item.relativePath,{text:item.text}
      ]));
      return {files,packageName:snapshot.packageName??null,reason:null};
    }catch(error){
      return {files:null,packageName:null,reason:"Package source unavailable: "+String(error?.message??error)};
    }
  }

  function updateItems(data){
    if(!controller||!root)return;
    const candidates=[
      ...BUILTIN_ROUTE_SCENARIOS.filter(item=>item.packageName===data.packageName),
      ...discoverAuthoredRouteScenarios(data.files)
    ];
    const alive=new Set();
    for(const candidate of candidates){
      alive.add(candidate.id);
      const group=candidate.id.startsWith("authored:")?AUTHORED_GROUP:BUILTIN_GROUP;
      let item=known.get(candidate.id);
      if(!item){
        item=controller.createTestItem(candidate.id,candidate.label);
        known.set(candidate.id,item);
        groups.get(group).children.add(item);
      }else{
        item.label=candidate.label;
      }
    }
    for(const [id,item] of known){
      if(!alive.has(id)){
        groups.get(id.startsWith("authored:")?AUTHORED_GROUP:BUILTIN_GROUP)
          .children.delete(item.id);
        known.delete(id);
      }
    }
  }

  async function refresh(){
    const current=await readCurrentPackage();
    updateItems(current);
    return current;
  }

  async function execute(ids=null){
    const data=await refresh();
    const result=runRouteScenarioSuite({...data,include:ids});
    output.appendLine("Route scenario replay · "+(data.packageName??"no Package")+
      " · "+result.results.length+" test(s)");
    if(data.reason)output.appendLine("NOT_RUN boundary: "+data.reason);
    for(const entry of result.results){
      output.appendLine(entry.status+" · "+entry.label+
        " · expected route terminal "+(entry.terminal??"none")+
        " · "+entry.reason);
      if(entry.status!=="NOT_RUN")
        output.appendLine(entry.trace.map(step=>
          "  "+step.node+"."+step.stage+" ["+step.outcome+"] → "+step.to).join("\n"));
    }
    output.appendLine("PASS "+result.summary.PASS+" / FAIL "+result.summary.FAIL+
      " / NOT_RUN "+result.summary.NOT_RUN+
      " · scripted Stage Outcomes only; Owner / Runtime NOT_QUALIFIED");
    return result;
  }

  if(typeof vscode.tests?.createTestController==="function"&&
     vscode.TestRunProfileKind?.Run!==undefined){
    controller=vscode.tests.createTestController("skillStudio.routeScenarioTests",
      "SKILL Studio · Procedure Route Scenarios");
    context.subscriptions.push(controller);
    root=controller.createTestItem(ROOT_ID,
      "Current Package · Scripted Routes (NOT Runtime)");
    for(const [id,label] of [
      [BUILTIN_GROUP,"Pinned Example Route Regressions"],
      [AUTHORED_GROUP,"Package tests/*.route-scenario.json"]
    ]){
      const group=controller.createTestItem(id,label);
      groups.set(id,group);
      root.children.add(group);
    }
    controller.items.add(root);
    controller.refreshHandler=async()=>{await refresh();};
    controller.resolveHandler=async()=>{await refresh();};
    controller.createRunProfile("Replay Procedure Routes",vscode.TestRunProfileKind.Run,
      async(request,token)=>{
        const run=controller.createTestRun(request);
        try{
          const current=await refresh();
          const selected=[...known.keys()].filter(id=>{
            const group=id.startsWith("authored:")?AUTHORED_GROUP:BUILTIN_GROUP;
            const includes=request?.include;
            const excludes=request?.exclude??[];
            const selected=!Array.isArray(includes)||!includes.length||
              includes.some(item=>[ROOT_ID,group,id].includes(item?.id));
            const excluded=excludes.some(item=>[ROOT_ID,group,id].includes(item?.id));
            return selected&&!excluded;
          });
          if(token?.isCancellationRequested){
            for(const id of selected)run.skipped(known.get(id));
            return;
          }
          for(const id of selected)run.enqueued?.(known.get(id));
          const result=runRouteScenarioSuite({...current,include:selected});
          for(const entry of result.results){
            const item=known.get(entry.id);
            if(!item)continue;
            if(token?.isCancellationRequested){run.skipped(item);continue;}
            run.started(item);
            if(entry.status==="PASS")run.passed(item);
            else if(entry.status==="NOT_RUN")run.skipped(item);
            else run.failed(item,new vscode.TestMessage(entry.reason));
          }
          run.appendOutput?.(
            "Scripted CA-SL v1alpha5 Stage/Route trace only. Not evidence of Tool execution or Skill qualification.\r\n");
        }catch(error){
          const message=new vscode.TestMessage("Route scenario harness failed: "+
            String(error?.message??error));
          for(const item of known.values())run.errored?.(item,message);
        }finally{run.end();}
      },true);
    // The full Test Explorer tree tracks the active Package. Refresh on
    // user navigation or explicit Testing refresh; never mutate source.
    if(typeof vscode.window.onDidChangeActiveTextEditor==="function"){
      context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(
        ()=>{void refresh();}
      ));
    }
    void refresh();
  }else output.appendLine(
    "Native Testing API unavailable; route scenarios remain runnable from the Command Palette"
  );

  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.runRouteScenarios",async()=>{
      const result=await execute();
      output.show(true);
      return {...result,nativeTestExplorer:Boolean(controller)};
    }
  ));
  return {hasNativeTestExplorer:Boolean(controller),execute,refresh};
}
