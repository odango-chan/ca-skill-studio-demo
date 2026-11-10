import {projectWorkspace} from '../../../../site/workspace.mjs';
import {phaseStepDependencyReport} from '../../../../site/phase-dataflow.mjs';
import {phaseConsumerContractReport} from '../../../../site/phase-consumer-contract.mjs';
import {phaseStepEvidenceSummary,bindingEvidenceExplanation}
  from '../../../../site/phase-evidence-copy.mjs';
import {phaseOutputReferenceOptions} from '../../../../site/phase-output-refs.mjs';

// UI adapter only: every fact below comes from Classic's source projection.
const row=(label,line,children=[],extra={})=>({label,line,children,...extra});
const sameBinding=(a,b)=>a.phaseName===b.phaseName&&a.stepIndex===b.stepIndex&&
  a.bindingKey===b.bindingKey;
const display=value=>value===undefined||value===null||value===''?'未声明':String(value);
export function inspectionSnapshot(text,selection={},projected=null,files=null){
  const model=projected??projectWorkspace(text);
  if(model.state!=='READY')return {
    model,outline:[],inspection:[],evidence:[],problems:model.diagnostics,
    dataflow:null,consumerContracts:null
  };
  const procedure=model.procedures.get(selection.procedureId)??model.procedures.get(model.entry);
  const node=procedure.nodes.find(n=>n.id===selection.nodeId);
  const dataflow=node?phaseStepDependencyReport(text,procedure.name,node.id,files):null;
  const consumerContracts=node?phaseConsumerContractReport(text,procedure.name,node.id,files):null;
  const contractFor=binding=>consumerContracts?.bindings.find(x=>sameBinding(x,binding))??null;
  const stepEvidence=(phaseName,stepIndex)=>
    phaseStepEvidenceSummary(phaseName,stepIndex,dataflow,consumerContracts);
  const outputReferences=node?phaseOutputReferenceOptions(text,procedure.name,node.id):[];
  const outputReferencesFor=(phaseName,stepIndex)=>outputReferences.filter(x=>
    x.phaseName===phaseName&&x.stepIndex===stepIndex);
  const outline=[...model.procedures.values()].map(p=>row(p.name,p.nodes[0]?.line??1,
    p.nodes.map(n=>row(n.id,n.line,[],{description:n.operator,procedureId:p.name,nodeId:n.id,kind:'node'})),{description:p.nodes.length+' nodes',procedureId:p.name}));
  const inspection=node?[
    row(node.id,node.line,[],{description:node.operator+' · '+node.value,kind:'node',procedureId:procedure.name,nodeId:node.id}),
    ...node.phases.map(p=>row(p.name,p.line,p.steps.map(s=>{
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
    }),{kind:'phase',procedureId:procedure.name,nodeId:node.id,phaseName:p.name})),
    ...procedure.routes.filter(r=>r.source===node.id).map(r=>row(r.routeSource+' · '+r.outcome+' → '+r.target,r.line,[],{kind:'route',procedureId:procedure.name,nodeId:node.id,routeId:r.id,routeSource:r.routeSource,outcome:r.outcome,target:r.target}))
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
      row('Consumer ABI evidence',binding.line,consumerDetails.map(detail=>
        row(detail,binding.line)),{
        description:contract?.typeRelation==='TYPE_ONLY_MATCH'
          ?'仅类型一致；不是完整 ABI 证明':display(contract?.consumerStatus)
      }),
      row('Evidence boundary',binding.line,[],{description:explanation.reason})
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
    ],{description:'Read-only Source evidence · no Runtime evidence · no write authorization'}
  ):null;
  const evidence=[row('Source evidence only · Runtime NOT_RUN · no write authority',1),
    ...((node?[node]:procedure.nodes).flatMap(n=>[
      ...n.children.map(c=>row(n.id+' → '+c.procedure,c.line,[],{description:c.via})),
      ...n.phases.map(p=>row(n.id+' · '+p.name,p.line,p.steps.map(s=>{
        const summary=node?.id===n.id?stepEvidence(p.name,s.index-1):null;
        return row(s.operator+' · '+s.value,s.line,[],{
          description:summary?.label??'No resolved Phase binding evidence'
        });
      })))
    ])),
    ...(dataflowSummary?[dataflowSummary]:[])];
  return {model,outline,inspection,evidence,problems:[],dataflow,consumerContracts};
}
