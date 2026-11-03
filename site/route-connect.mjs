import {addRouteOutcomeOptions,previewAddRouteOutcome} from "./route-create.mjs";

// A canvas connection is only an *intent*. The sole business write path
// remains D3-A1's version-bound YAML source Patch and Diff confirmation.
const ID=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
// In-memory gesture ownership: a spread/copy of a proposal is not a real
// connection event. This is a UI integrity guard, not an auth credential.
const issuedProposals=new WeakSet();
const fail=reason=>{throw new Error(reason);};

export function proposeCanvasRouteConnection({
  source,procedureId,sourceId,targetId,sourceHandle,targetHandle
}={}){
  if(typeof source!=="string"||!ID.test(procedureId??"")||
    !ID.test(sourceId??"")||!ID.test(targetId??""))
    fail("Invalid canvas connection identity");
  // React Flow's existing layout handles represent actual edges. Only the
  // distinct add-route handle may initiate a new semantic mapping.
  if(sourceHandle!=="new-route-out"||
    typeof targetHandle!=="string"||
    !(targetHandle==="in"||/^edge-\d+-in$/.test(targetHandle)))
    fail("This connection does not start from the dedicated add-Route handle");
  if(sourceId===targetId)
    fail("Self-loop creation is not qualified by D3-A3");
  const options=addRouteOutcomeOptions(source,procedureId,sourceId);
  if(!options||options.routeSource!=="operator.on"||
    !options.outcomes.length||!options.targets.includes(targetId))
    fail("No source-qualified operator.on Outcome available for this connection");
  const proposal=Object.freeze({
    type:"CanvasRouteProposal",profile:"d3-a3-canvas-only-v1",
    baseSource:source,procedureId,sourceId,targetId,
    routeSource:"operator.on",
    outcomes:Object.freeze([...options.outcomes])
  });
  issuedProposals.add(proposal);
  return proposal;
}

export function previewCanvasRouteConnection(source,proposal,outcome){
  if(!proposal||typeof proposal!=="object"||
    !issuedProposals.has(proposal)||
    proposal.type!=="CanvasRouteProposal"||
    proposal.profile!=="d3-a3-canvas-only-v1"||
    source!==proposal.baseSource)
    fail("Canvas connection is stale or unsupported");
  if(typeof outcome!=="string"||!proposal.outcomes.includes(outcome))
    fail("Choose a qualified Outcome explicitly");
  // Requalification and the full structural guard are delegated to A1.
  const verified=proposeCanvasRouteConnection({
    source,procedureId:proposal.procedureId,sourceId:proposal.sourceId,
    targetId:proposal.targetId,sourceHandle:"new-route-out",targetHandle:"in"
  });
  if(JSON.stringify(verified)!==JSON.stringify(proposal))
    fail("Canvas proposal has been modified or expired");
  return previewAddRouteOutcome(source,proposal.procedureId,
    proposal.sourceId,outcome,proposal.targetId);
}
