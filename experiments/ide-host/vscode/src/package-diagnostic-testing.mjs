// VS Code / Theia native Testing API adapter for Studio's offline diagnostic
// regression engine. Never maps a self-test PASS to Skill qualification.
import {collectPackageSnapshot} from "./package-snapshot.mjs";
import {
  DIAGNOSTIC_TEST_CASES,runDiagnosticRegressionSuite
} from "../../../../site/package-diagnostic-tests.mjs";

const ROOT_ID="skillStudio.diagnosticRegressions";
const DOMAIN_PREFIX="domain:";
const allIds=DIAGNOSTIC_TEST_CASES.map(item=>item.id);

function selectedCases(request){
  const include=Array.isArray(request?.include)?request.include:null;
  const exclude=Array.isArray(request?.exclude)?request.exclude:[];
  const testIncluded=test=>!include?.length||include.some(item=>
    item?.id===ROOT_ID||item?.id===DOMAIN_PREFIX+test.domain||item?.id===test.id);
  const testExcluded=test=>exclude.some(item=>
    item?.id===ROOT_ID||item?.id===DOMAIN_PREFIX+test.domain||item?.id===test.id);
  return DIAGNOSTIC_TEST_CASES.filter(test=>
    testIncluded(test)&&!testExcluded(test)).map(test=>test.id);
}

export function registerPackageDiagnosticTesting(vscode,context,{
  getActiveProcedure=()=>vscode.window.activeTextEditor?.document??null,
  snapshotProvider=collectPackageSnapshot
}={}){
  const output=vscode.window.createOutputChannel("Skill Studio · Offline Diagnostic Tests");
  context.subscriptions.push(output);
  const cases=new Map(DIAGNOSTIC_TEST_CASES.map(item=>[item.id,item]));
  const testItems=new Map();

  async function execute(ids=allIds){
    const active=getActiveProcedure?.();
    // No live Tool dispatch or arbitrary script execution; an absent or
    // incomplete Package is NOT_RUN instead of a fabricated validation PASS.
    let files=null;
    let reason="No v1alpha5 assurance/procedure.yaml is currently selected";
    if(active?.uri?.path?.endsWith("/assurance/procedure.yaml")){
      try{
        const snapshot=await snapshotProvider(vscode,active);
        if(snapshot?.completeness==="complete"&&Array.isArray(snapshot.documents)){
          files=new Map(snapshot.documents.map(doc=>[
            doc.relativePath,{text:doc.text}
          ]));
          reason="";
        }else{
          reason="Package snapshot is incomplete: "+
            String(snapshot?.reason??"unknown inventory error");
        }
      }catch(error){
        reason="Unable to read Package snapshot: "+String(error?.message??error);
      }
    }
    const result=runDiagnosticRegressionSuite({files,include:ids});
    output.appendLine("Offline diagnostic regressions · "+
      (active?.uri?.path??"no active Package")+" · "+
      ids.length+" selected case(s)");
    if(reason)output.appendLine("NOT_RUN boundary: "+reason);
    for(const entry of result.results)
      output.appendLine(entry.status+" · "+entry.label+
        (entry.diagnostic?" · "+entry.diagnostic.code+
          " @ "+entry.diagnostic.path+":"+entry.diagnostic.line:"")+
        (entry.status==="PASS"?"":" · "+entry.reason));
    output.appendLine("PASS "+result.summary.PASS+" / FAIL "+result.summary.FAIL+
      " / NOT_RUN "+result.summary.NOT_RUN+
      " · static diagnostic self-tests only; Skill qualification NOT_QUALIFIED");
    return result;
  }

  let controller=null;
  if(typeof vscode.tests?.createTestController==="function"&&
     vscode.TestRunProfileKind?.Run!==undefined){
    controller=vscode.tests.createTestController(
      "skillStudio.packageDiagnosticChecks",
      "SKILL Studio · Offline Diagnostic Regressions"
    );
    context.subscriptions.push(controller);
    const root=controller.createTestItem(ROOT_ID,
      "Current Package · Static Diagnostic Regression Tests");
    const groups=new Map();
    for(const testcase of DIAGNOSTIC_TEST_CASES){
      let group=groups.get(testcase.domain);
      if(!group){
        group=controller.createTestItem(DOMAIN_PREFIX+testcase.domain,
          testcase.domain[0].toUpperCase()+testcase.domain.slice(1));
        groups.set(testcase.domain,group);
        root.children.add(group);
      }
      const item=controller.createTestItem(testcase.id,testcase.label);
      group.children.add(item);
      testItems.set(testcase.id,item);
    }
    controller.items.add(root);
    controller.createRunProfile("Run offline diagnostics",vscode.TestRunProfileKind.Run,
      async(request,token)=>{
        const ids=selectedCases(request);
        const run=controller.createTestRun(request);
        try{
          if(token?.isCancellationRequested){
            for(const id of ids)run.skipped(testItems.get(id));
            return;
          }
          for(const id of ids)run.enqueued?.(testItems.get(id));
          const results=await execute(ids);
          for(const result of results.results){
            const item=testItems.get(result.id);
            if(token?.isCancellationRequested){
              run.skipped(item);continue;
            }
            run.started(item);
            if(result.status==="PASS")run.passed(item);
            else if(result.status==="NOT_RUN")run.skipped(item);
            else run.failed(item,new vscode.TestMessage(result.reason));
          }
          run.appendOutput?.("Offline Package diagnostic tests only; not Compiler or Runtime qualification.\r\n");
        }catch(error){
          const message=new vscode.TestMessage(
            "Diagnostic test harness failed: "+String(error?.message??error));
          for(const id of ids)run.errored?.(testItems.get(id),message);
        }finally{
          run.end();
        }
      },true);
    output.appendLine("Native Test Explorer registered: "+cases.size+
      " read-only diagnostic regression cases");
  }else{
    output.appendLine("Native Testing API unavailable; command-based offline tests remain supported");
  }

  context.subscriptions.push(vscode.commands.registerCommand(
    "skillStudio.runDiagnosticTests",async()=>{
      const result=await execute();
      output.show(true);
      return result;
    }
  ));
  return Object.freeze({
    hasNativeTestExplorer:Boolean(controller),
    testCount:cases.size,
    run:execute
  });
}
