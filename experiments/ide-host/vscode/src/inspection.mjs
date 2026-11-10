import {projectWorkspace} from '../../../../site/workspace.mjs';

// UI adapter only: every fact below comes from Classic's source projection.
const row=(label,line,children=[],extra={})=>({label,line,children,...extra});
export function inspectionSnapshot(text,selection={},projected=null){
  const model=projected??projectWorkspace(text);
  if(model.state!=='READY')return {model,outline:[],inspection:[],evidence:[],problems:model.diagnostics};
  const procedure=model.procedures.get(selection.procedureId)??model.procedures.get(model.entry);
  const node=procedure.nodes.find(n=>n.id===selection.nodeId);
  const outline=[...model.procedures.values()].map(p=>row(p.name,p.nodes[0]?.line??1,
    p.nodes.map(n=>row(n.id,n.line,[],{description:n.operator,procedureId:p.name,nodeId:n.id,kind:'node'})),{description:p.nodes.length+' nodes',procedureId:p.name}));
  const inspection=node?[
    row(node.id,node.line,[],{description:node.operator+' · '+node.value,kind:'node',procedureId:procedure.name,nodeId:node.id}),
    ...node.phases.map(p=>row(p.name,p.line,p.steps.map(s=>row((s.name||'Step '+s.index)+' · '+s.operator+' '+s.value,s.line,[],{kind:'phase-step',procedureId:procedure.name,nodeId:node.id,phaseName:p.name,stepIndex:s.index-1,stepName:s.name||null,stepOperator:s.operator,stepValue:s.value})),{kind:'phase',procedureId:procedure.name,nodeId:node.id,phaseName:p.name})),
    ...procedure.routes.filter(r=>r.source===node.id).map(r=>row(r.routeSource+' · '+r.outcome+' → '+r.target,r.line,[],{kind:'route',procedureId:procedure.name,nodeId:node.id,routeId:r.id,routeSource:r.routeSource,outcome:r.outcome,target:r.target}))
  ]:[row(procedure.name,1,[],{description:'Select a node in the graph or Outline'})];
  const evidence=[row('Source evidence only · Runtime NOT_RUN',1),
    ...((node?[node]:procedure.nodes).flatMap(n=>[
      ...n.children.map(c=>row(n.id+' → '+c.procedure,c.line,[],{description:c.via})),
      ...n.phases.map(p=>row(n.id+' · '+p.name,p.line,p.steps.map(s=>row(s.operator+' · '+s.value,s.line))))
    ]))];
  return {model,outline,inspection,evidence,problems:[]};
}
