import {analyzeCurrentSource}
  from '../../../../language/core/source.ts';

// UI adapter only: every fact below comes from the shared language source projection.
const row=(label,line,children=[],extra={})=>({label,line,children,...extra});
const display=value=>value===undefined||value===null||value===''?'未声明':String(value);
function classifyCurrentSource(value){
  const raw=String(value??"").trim();
  if(/^context\./.test(raw))return {
    kind:"Context",description:"Context reference · Host Context Schema not linked"
  };
  const waitOutput=/^([A-Za-z][A-Za-z0-9_-]*)\.wait\.output(?:\.(.*))?$/.exec(raw);
  if(waitOutput)return {
    kind:"Wait Output",producerNode:waitOutput[1],producerStage:"wait",
    output:waitOutput[2]??"",
    description:"Normalized Ingress request · available only after this exact Wait occurrence is EVENT_RECEIVED; Ingress Schema not linked"
  };
  const producer=/^([A-Za-z][A-Za-z0-9_-]*)\.(operation|observation)\.output(?:\.(.*))?$/.exec(raw);
  if(producer)return {
    kind:"Producer",producerNode:producer[1],producerStage:producer[2],
    output:producer[3]??"",
    description:"Source producer reference · Owner output Schema / Evidence guarantee not linked"
  };
  if(/^(?:["']|[-+]?\d|true$|false$|null$)/i.test(raw))
    return {kind:"Literal",description:"Literal argument"};
  return {kind:"Expression",description:"Source expression · no implicit resolution"};
}
function currentInspectionSnapshot(text,selection,files,packageName,packageRootUri){
  const uriFor=path=>String(packageRootUri??"file:///skill").replace(/\/$/,"")+"/"+path;
  const documents=new Map();
  documents.set("assurance/procedure.yaml",{
    uri:uriFor("assurance/procedure.yaml"),
    relativePath:"assurance/procedure.yaml",version:0,text
  });
  for(const path of ["assurance/contract.yaml","assurance/predicates.yaml"]){
    const source=files?.get(path)?.text;
    if(typeof source==="string")documents.set(path,{
      uri:uriFor(path),relativePath:path,version:0,text:source
    });
  }
  const analysis=analyzeCurrentSource(documents,packageName||"skill");
  const projection=analysis.procedure,procedure=projection.procedures[0];
  if(projection.state!=="READY"||!procedure)return {
    model:{state:"UNAVAILABLE",entry:null,procedures:new Map(),diagnostics:projection.diagnostics},
    outline:[],inspection:[],problems:analysis.diagnostics,
    dataflow:null,consumerContracts:null
  };
  const model={state:"READY",entry:procedure.name,
    procedures:new Map([[procedure.name,procedure]]),diagnostics:projection.diagnostics};
  const outline=[row(procedure.name,procedure.nodes[0]?.line??1,
    procedure.nodes.map(node=>row(node.id,node.line,[
      ...(node.wait?[row("Wait · "+node.wait.event.source+"/"+node.wait.event.service+"/"+node.wait.event.operation,
        node.wait.line,[],{kind:"v1alpha5-wait",
          description:"Timeout "+node.wait.timeout+" · TIMEOUT → "+node.wait.timeoutTarget+
            (node.wait.responseAfter?" · response after "+node.wait.responseAfter:"")})]:[]),
      ...(node.stages??[]).map(stage=>row(stage.name,stage.line,[],{
        kind:"v1alpha5-stage",description:[stage.target,
          (stage.routeOutcomes??[]).join(" / ")].filter(Boolean).join(" · ")
      }))
    ],{
        description:(node.wait?("WAIT · "+node.wait.event.source+"/"+node.wait.event.service+"/"+node.wait.event.operation+" · "):"")+
          (node.stages??[]).map(stage=>stage.name).join(" → "),
        procedureId:procedure.name,nodeId:node.id,kind:"v1alpha5-node"
      })),{description:procedure.nodes.length+" Nodes · CA-SL v1alpha5",
        procedureId:procedure.name})];
  const contractRows=[
    row("Contract Goal · "+display(projection.goal),projection.goalLine??1,[],{
      kind:"v1alpha5-contract",sourcePath:"assurance/contract.yaml",
      description:"Read-only Contract goal declaration"
    }),
    row("Global Precondition · "+display(projection.precondition),
      projection.preconditionLine??1,[],{
        kind:"v1alpha5-contract",sourcePath:"assurance/contract.yaml",
        description:"Contract-level precondition reference"
      })
  ];
  const node=procedure.nodes.find(item=>item.id===selection.nodeId);
  const bindings=[];
  const waitRows=node?.wait?[row(
    "Node-entry Wait · "+node.wait.event.source+"/"+node.wait.event.service+"/"+node.wait.event.operation,
    node.wait.line,[
      row("Timeout · "+node.wait.timeout,node.wait.timeoutLine,[],{
        kind:"v1alpha5-wait",description:"Fixed event-wait deadline; no polling loop"
      }),
      row("TIMEOUT → "+node.wait.timeoutTarget,node.wait.timeoutRouteLine,[],{
        kind:"v1alpha5-wait",description:"Wait-control edge; not a business Stage Outcome"
      }),
      ...(node.wait.responseAfter?[row("Response boundary · "+node.wait.responseAfter,
        node.wait.responseAfterLine??node.wait.line,[],{
          kind:"v1alpha5-wait",description:"Paired response commits at this Node completion"
        })]:[])
    ],{kind:"v1alpha5-wait",
      description:"Exact Ingress event selector; wait.output is available only on the accepted-event path"
    })]:[];
  const stageRows=(node?.stages??[]).map(stage=>{
    const children=[];
    for(const argument of stage.arguments??[]){
      const source=classifyCurrentSource(argument.value);
      const binding={consumer:stage.name+" · "+argument.name,
        value:argument.value,line:argument.line,...source,evidenceRequirements:[]};
      bindings.push(binding);
      children.push(row("Argument · "+argument.name,argument.line,[],{
        kind:"v1alpha5-flow",
        description:argument.value+" · "+source.description
      }));
    }
    for(const call of stage.calls??[]){
      const callChildren=[];
      call.arguments.forEach((value,index)=>{
        const parameter=call.parameters[index]||"arg"+(index+1);
        const line=call.argumentLines?.[index]??call.line;
        const source=classifyCurrentSource(value);
        const requirements=call.evidenceRequirements.filter(item=>
          item.parameter===parameter);
        const binding={consumer:call.predicate+" · "+parameter,value,
          line,...source,evidenceRequirements:requirements};
        bindings.push(binding);
        callChildren.push(row(parameter+" ← "+value,line,[],{
          kind:"v1alpha5-flow",description:source.description
        }));
      });
      if(call.evidenceLocations?.length){
        for(const location of call.evidenceLocations)
          callChildren.push(row("Evidence required · "+location.evidence,location.line,[],{
            kind:"v1alpha5-evidence",sourcePath:"assurance/predicates.yaml",
            description:"PredicateSet requires this Evidence for "+location.parameter+
              " · Owner guarantee / Producer satisfaction not qualified"
          }));
      }else{
        for(const requirement of call.evidenceRequirements)
          for(const evidence of requirement.evidence)
            callChildren.push(row("Evidence required · "+evidence,call.line,[],{
              kind:"v1alpha5-evidence",
              description:"PredicateSet requires this Evidence for "+requirement.parameter+
                " · Owner guarantee / Producer satisfaction not qualified"
            }));
      }
      children.push(row("Predicate · "+call.predicate,call.line,callChildren,{
        kind:"v1alpha5-call",
        description:"Positional arguments · "+call.arguments.length
      }));
    }
    return row(stage.name,stage.line,children,{
      kind:"v1alpha5-stage",
      description:[stage.target,(stage.routeOutcomes??[]).join(" / ")]
        .filter(Boolean).join(" · ")
    });
  });
  const routeRows=procedure.routes.filter(route=>route.source===node?.id)
    .map(route=>row(route.routeSource+" · "+route.outcome+" → "+route.target,
      route.line,[],{kind:"v1alpha5-route"}));
  const dataflowRows=bindings.map(binding=>row(
    binding.consumer+" ← "+binding.value,binding.line,[],{
      kind:"v1alpha5-flow",description:binding.description
    }));
  const inspection=node?[
    ...contractRows,
    row(node.id,node.line,[...waitRows,...stageRows,...routeRows],{
      description:"Node · "+(node.wait?"Wait · ":"")+(node.stages??[]).map(stage=>stage.name).join(" → "),
      kind:"v1alpha5-node",procedureId:procedure.name,nodeId:node.id
    }),
    row("Data Flow · "+bindings.length+" arguments",node.line,dataflowRows,{
      kind:"v1alpha5-dataflow",
      description:"Source lineage only · imported Owner Schema / Evidence guarantees are not linked"
    })
  ]:[...contractRows,row(procedure.name,1,[],{
    description:"Select a Node in the Procedure Designer or Outline"
  })];
  return {model,outline,inspection,problems:analysis.diagnostics,
    dataflow:{status:"SOURCE_ONLY",bindings,
      summary:{unresolved:bindings.filter(item=>item.kind==="Producer").length,
        editEligible:0}},consumerContracts:null};
}
export function inspectionSnapshot(text,selection={},projected=null,files=null,
  packageName="skill",packageRootUri="file:///skill"){
  return currentInspectionSnapshot(text,selection,files,packageName,packageRootUri);
}
