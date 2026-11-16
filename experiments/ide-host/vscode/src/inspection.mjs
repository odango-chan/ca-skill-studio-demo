import {projectWorkspace} from '../../../../site/workspace.mjs';
import {phaseStepDependencyReport} from '../../../../site/phase-dataflow.mjs';
import {phaseConsumerContractReport} from '../../../../site/phase-consumer-contract.mjs';
import {phaseStepEvidenceSummary,bindingEvidenceExplanation}
  from '../../../../site/phase-evidence-copy.mjs';
import {phaseOutputReferenceOptions,previewPhaseOutputReference}
  from '../../../../site/phase-output-refs.mjs';
import {phaseRouteTargetOptions} from '../../../../site/phase-routes.mjs';
import {phaseOutcomeEditOptions} from '../../../../site/phase-outcomes.mjs';
import {isV1Alpha4Procedure,analyzeV1Alpha4Source}
  from '../../../../language/core/v1alpha4.ts';

// UI adapter only: every fact below comes from the shared language source projection.
const row=(label,line,children=[],extra={})=>({label,line,children,...extra});
const sameBinding=(a,b)=>a.phaseName===b.phaseName&&a.stepIndex===b.stepIndex&&
  a.bindingKey===b.bindingKey;
const display=value=>value===undefined||value===null||value===''?'未声明':String(value);
function classifyV1Alpha4Source(value){
  const raw=String(value??"").trim();
  if(/^context\./.test(raw))return {
    kind:"Context",description:"Context reference · Host Context Schema not linked"
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
function v1alpha4InspectionSnapshot(text,selection,files,packageName,packageRootUri){
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
  const analysis=analyzeV1Alpha4Source(documents,packageName||"skill");
  const projection=analysis.procedure,procedure=projection.procedures[0];
  if(projection.state!=="READY"||!procedure)return {
    model:{state:"UNAVAILABLE",entry:null,procedures:new Map(),diagnostics:projection.diagnostics},
    outline:[],inspection:[],problems:analysis.diagnostics,
    dataflow:null,consumerContracts:null
  };
  const model={state:"READY",entry:procedure.name,
    procedures:new Map([[procedure.name,procedure]]),diagnostics:projection.diagnostics};
  const outline=[row(procedure.name,procedure.nodes[0]?.line??1,
    procedure.nodes.map(node=>row(node.id,node.line,
      (node.stages??[]).map(stage=>row(stage.name,stage.line,[],{
        kind:"v1alpha4-stage",description:[stage.target,
          (stage.routeOutcomes??[]).join(" / ")].filter(Boolean).join(" · ")
      })),{
        description:(node.stages??[]).map(stage=>stage.name).join(" → "),
        procedureId:procedure.name,nodeId:node.id,kind:"v1alpha4-node"
      })),{description:procedure.nodes.length+" Nodes · CA-SL v1alpha4",
        procedureId:procedure.name})];
  const contractRows=[
    row("Contract Goal · "+display(projection.goal),projection.goalLine??1,[],{
      kind:"v1alpha4-contract",sourcePath:"assurance/contract.yaml",
      description:"Read-only Contract goal declaration"
    }),
    row("Global Precondition · "+display(projection.precondition),
      projection.preconditionLine??1,[],{
        kind:"v1alpha4-contract",sourcePath:"assurance/contract.yaml",
        description:"Contract-level precondition reference"
      })
  ];
  const node=procedure.nodes.find(item=>item.id===selection.nodeId);
  const bindings=[];
  const stageRows=(node?.stages??[]).map(stage=>{
    const children=[];
    for(const argument of stage.arguments??[]){
      const source=classifyV1Alpha4Source(argument.value);
      const binding={consumer:stage.name+" · "+argument.name,
        value:argument.value,line:argument.line,...source,evidenceRequirements:[]};
      bindings.push(binding);
      children.push(row("Argument · "+argument.name,argument.line,[],{
        kind:"v1alpha4-flow",
        description:argument.value+" · "+source.description
      }));
    }
    for(const call of stage.calls??[]){
      const callChildren=[];
      call.arguments.forEach((value,index)=>{
        const parameter=call.parameters[index]||"arg"+(index+1);
        const line=call.argumentLines?.[index]??call.line;
        const source=classifyV1Alpha4Source(value);
        const requirements=call.evidenceRequirements.filter(item=>
          item.parameter===parameter);
        const binding={consumer:call.predicate+" · "+parameter,value,
          line,...source,evidenceRequirements:requirements};
        bindings.push(binding);
        callChildren.push(row(parameter+" ← "+value,line,[],{
          kind:"v1alpha4-flow",description:source.description
        }));
      });
      if(call.evidenceLocations?.length){
        for(const location of call.evidenceLocations)
          callChildren.push(row("Evidence required · "+location.evidence,location.line,[],{
            kind:"v1alpha4-evidence",sourcePath:"assurance/predicates.yaml",
            description:"PredicateSet requires this Evidence for "+location.parameter+
              " · Owner guarantee / Producer satisfaction not qualified"
          }));
      }else{
        for(const requirement of call.evidenceRequirements)
          for(const evidence of requirement.evidence)
            callChildren.push(row("Evidence required · "+evidence,call.line,[],{
              kind:"v1alpha4-evidence",
              description:"PredicateSet requires this Evidence for "+requirement.parameter+
                " · Owner guarantee / Producer satisfaction not qualified"
            }));
      }
      children.push(row("Predicate · "+call.predicate,call.line,callChildren,{
        kind:"v1alpha4-call",
        description:"Positional arguments · "+call.arguments.length
      }));
    }
    return row(stage.name,stage.line,children,{
      kind:"v1alpha4-stage",
      description:[stage.target,(stage.routeOutcomes??[]).join(" / ")]
        .filter(Boolean).join(" · ")
    });
  });
  const routeRows=procedure.routes.filter(route=>route.source===node?.id)
    .map(route=>row(route.routeSource+" · "+route.outcome+" → "+route.target,
      route.line,[],{kind:"v1alpha4-route"}));
  const dataflowRows=bindings.map(binding=>row(
    binding.consumer+" ← "+binding.value,binding.line,[],{
      kind:"v1alpha4-flow",description:binding.description
    }));
  const inspection=node?[
    ...contractRows,
    row(node.id,node.line,[...stageRows,...routeRows],{
      description:"Node · "+(node.stages??[]).map(stage=>stage.name).join(" → "),
      kind:"v1alpha4-node",procedureId:procedure.name,nodeId:node.id
    }),
    row("Data Flow · "+bindings.length+" arguments",node.line,dataflowRows,{
      kind:"v1alpha4-dataflow",
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
  if(isV1Alpha4Procedure(text))
    return v1alpha4InspectionSnapshot(text,selection,files,packageName,packageRootUri);
  const model=projected??projectWorkspace(text);
  if(model.state!=='READY')return {
    model,outline:[],inspection:[],problems:model.diagnostics,
    dataflow:null,consumerContracts:null
  };
  const procedure=model.procedures.get(selection.procedureId)??model.procedures.get(model.entry);
  const node=procedure.nodes.find(n=>n.id===selection.nodeId);
  const dataflow=node?phaseStepDependencyReport(text,procedure.name,node.id,files):null;
  const consumerContracts=node?phaseConsumerContractReport(text,procedure.name,node.id,files):null;
  const contractFor=binding=>consumerContracts?.bindings.find(x=>sameBinding(x,binding))??null;
  const stepEvidence=(phaseName,stepIndex)=>
    phaseStepEvidenceSummary(phaseName,stepIndex,dataflow,consumerContracts);
  // Classic candidate discovery may find two historically observed spellings
  // even when replacing the last occurrence would remove the proof required
  // by its own Preview revalidation. Never advertise a native edit that the
  // shared Source planner would reject.
  const outputReferences=node?phaseOutputReferenceOptions(text,procedure.name,node.id)
    .filter(reference=>reference.choices.some(value=>{
      if(value===reference.value)return false;
      try{
        previewPhaseOutputReference(text,procedure.name,node.id,
          reference.phaseName,reference.stepIndex,reference.bindingKey,value);
        return true;
      }catch{return false;}
    })):[];

  const outputReferencesFor=(phaseName,stepIndex)=>outputReferences.filter(x=>
    x.phaseName===phaseName&&x.stepIndex===stepIndex);
  const phaseRouteTargets=node?phaseRouteTargetOptions(text,procedure.name,node.id):[];
  const outcomeRepairs=node?phaseOutcomeEditOptions(text,procedure.name,node.id):[];
  const outline=[...model.procedures.values()].map(p=>row(p.name,p.nodes[0]?.line??1,
    p.nodes.map(n=>row(n.id,n.line,[],{description:n.operator,procedureId:p.name,nodeId:n.id,kind:'node'})),{description:p.nodes.length+' nodes',procedureId:p.name}));
  const inspection=node?[
    row(node.id,node.line,[],{description:node.operator+' · '+node.value,kind:'node',procedureId:procedure.name,nodeId:node.id}),
    ...node.phases.map(p=>row(p.name,p.line,[...p.steps.map(s=>{
      const stepIndex=s.index-1,evidence=stepEvidence(p.name,stepIndex);
      const outputRows=outputReferencesFor(p.name,stepIndex).map(reference=>
        row('Output reference · '+reference.bindingKey,s.line,[],{
          kind:'phase-output-reference',procedureId:procedure.name,nodeId:node.id,
          phaseName:p.name,stepIndex,bindingKey:reference.bindingKey,
          currentValue:reference.value,choices:reference.choices,
          producerPhase:reference.producerPhase,producerStep:reference.producerStep,
          producerStepIndex:reference.producerStepIndex,outputSuffix:reference.outputSuffix,
          description:reference.value+' · 可切换为 '+reference.choices
            .filter(value=>value!==reference.value).join(' / ')
        }));
      return row((s.name||'Step '+s.index)+' · '+s.operator+' '+s.value,
        s.line,outputRows,{
          kind:'phase-step',procedureId:procedure.name,nodeId:node.id,phaseName:p.name,
          stepIndex,stepName:s.name||null,stepOperator:s.operator,stepValue:s.value,
          description:[s.operator+' · '+s.value,evidence?.label].filter(Boolean).join(' · ')
        });
    }),...outcomeRepairs.filter(option=>option.phaseName===p.name)
      .filter(option=>option.adds.length||option.renames.length||option.deletions.length)
      .map(option=>row('Outcome repair · '+p.name,p.line,[],{
        kind:'phase-outcome-repair',procedureId:procedure.name,nodeId:node.id,
        phaseName:p.name,addCount:option.adds.length,
        renameCount:option.renames.length,deleteCount:option.deletions.length,
        description:['补齐 '+option.adds.length,'纠正 '+option.renames.length,
          '删除 '+option.deletions.length].join(' · ')+' · Source-only'
      }))],{kind:'phase',procedureId:procedure.name,nodeId:node.id,phaseName:p.name})),
    ...procedure.routes.filter(r=>r.source===node.id).map(r=>{
      const eligible=phaseRouteTargets.find(target=>target.routeId===r.id);
      return row(r.routeSource+' · '+r.outcome+' → '+r.target,r.line,[],{
        kind:'route',procedureId:procedure.name,nodeId:node.id,
        routeId:r.id,routeSource:r.routeSource,outcome:r.outcome,target:r.target,
        ...(eligible?{phaseTargetChoices:eligible.targets,
          phaseName:eligible.phaseName}: {})
      });
    })
  ]:[row(procedure.name,1,[],{description:'Select a node in the graph or Outline'})];
  const dataflowRows=(dataflow?.bindings??[]).map(binding=>{
    const contract=contractFor(binding);
    const explanation=bindingEvidenceExplanation(binding,contract);
    const consumerDetails=contract?[
      'Consumer status · '+display(contract.consumerStatus),
      'Consumer schema · '+display(contract.consumerSchema),
      'Consumer type · '+display(contract.consumerType),
      'Required · '+display(contract.consumerRequired),
      'Constraints · '+(contract.consumerConstraints?.length
        ?contract.consumerConstraints.join(', '):'未声明'),
      'Type relation · '+display(contract.typeRelation)
    ]:['Consumer ABI · CONSUMER_ABI_UNAVAILABLE'];
    const children=[
      row('Producer provenance · '+display(binding.status),binding.line,[],{
        description:explanation.origin
      }),
      row('Producer output schema · '+display(binding.contractStatus),binding.line,[],{
        description:display(binding.contractSchema)+' · output type '+display(binding.outputType)
      }),
      row('Consumer ABI declaration',binding.line,consumerDetails.map(detail=>
        row(detail,binding.line)),{
        description:contract?.typeRelation==='TYPE_ONLY_MATCH'
          ?'仅类型一致；不是完整 ABI 证明':display(contract?.consumerStatus)
      }),
      row('Source / Runtime boundary',binding.line,[],{description:explanation.reason})
    ];
    return row(binding.phaseName+' · Step '+(binding.stepIndex+1)+' · '+binding.bindingKey,
      binding.line,children,{description:binding.value+' · '+display(binding.status)});
  });
  const dataflowSummary=dataflow?row(
    'Producer / Consumer dataflow · '+dataflow.bindings.length+' bindings',
    node?.line??1,[
      row('Source lineage · '+display(dataflow.status),node?.line??1,[],{
        description:'Unresolved '+(dataflow.summary?.unresolved??0)+
          ' · edit eligible '+(dataflow.summary?.editEligible??0)
      }),
      row('Consumer ABI · '+display(consumerContracts?.status),node?.line??1,[],{
        description:'Type-only '+(consumerContracts?.summary?.typeOnly??0)+
          ' · mismatched '+(consumerContracts?.summary?.mismatched??0)+
          ' · unknown '+(consumerContracts?.summary?.unknown??0)+
          ' · authorized writes '+(consumerContracts?.summary?.authorizedWrites??0)
      }),
      ...dataflowRows
    ],{description:'Static Source analysis only · Runtime NOT_RUN · no write authorization'}
  ):null;
  // Contextual Data Flow is the sole Source-derived Inspector projection;
  // Runtime Evidence remains outside this editor-time model.
  if(node&&dataflowSummary)inspection.push(row(
    'Data Flow · Producer / Consumer · '+dataflow.bindings.length+' bindings',
    node.line,dataflowSummary.children,{
      kind:'data-flow',procedureId:procedure.name,nodeId:node.id,
      description:'Source-derived only · Runtime NOT_RUN · no write authority'
    }));
  return {model,outline,inspection,problems:[],dataflow,consumerContracts};
}
