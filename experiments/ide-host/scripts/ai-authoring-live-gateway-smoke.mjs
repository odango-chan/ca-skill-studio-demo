// Opt-in, read-only live-provider acceptance for the Go AI Gateway.
// Only a synthetic CA-SL Procedure is sent to the configured endpoint.
// No production 5GC files, provider credentials, model response body or token
// are logged. Compiler/Owner/Runtime qualification are explicitly out of scope.
import {randomUUID} from "node:crypto";
import {buildContextPack} from "../../../authoring/core/context-pack.mjs";
import {createGatewayModelClient} from "../../../authoring/core/gateway-client.mjs";
import {createProcedureAgent} from "../../../authoring/core/procedure-agent.mjs";
import {createChangeSet} from "../../../authoring/core/change-set.mjs";
import {planV1Alpha5Patch,materializeAcceptedPatchGroups} from "../../../authoring/core/v1alpha5-patch-engine.mjs";

const baseUrl=process.env.STUDIO_AI_GATEWAY_URL;
const modelId=process.env.STUDIO_AI_MODEL_ID;
const token=process.env.STUDIO_AI_GATEWAY_TOKEN;
if(!baseUrl||!modelId){
  console.error("AI_AUTHORING_LIVE_GATEWAY_NOT_CONFIGURED: set STUDIO_AI_GATEWAY_URL and STUDIO_AI_MODEL_ID; optional STUDIO_AI_GATEWAY_TOKEN for remote Gateway.");
  process.exitCode=2;
}else{
  // Official Compiler v2 synthetic fixture uses an analogous final-state
  // route. This small source tests the provider contract only, not Compiler.
  const source=[
    "start: final",
    "nodes:",
    "  final:",
    "    postcondition:",
    "      predicates:",
    "        - predicate: synthetic.ready",
    "          arguments: []",
    "      routes:",
    "        PASS: SUCCEEDED",
    "        FAIL: SAFE_STOPPED",
    ""
  ].join("\n");
  try{
    const context=await buildContextPack({
      taskId:"studio-synthetic-live-gateway",revision:1,
      languageTarget:"connectionagent.io/v1alpha5",
      procedure:{path:"assurance/procedure.yaml",documentVersion:1,text:source},
      resources:[],maxBytes:131072
    });
    const client=createGatewayModelClient({
      gatewayBaseUrl:baseUrl,modelId,gatewayToken:token,
      sessionId:"studio-live-"+randomUUID()
    });
    const agent=createProcedureAgent({modelClient:client});
    const output=await agent.propose({
      task:"In the provided synthetic Procedure, propose changing only node final's postcondition FAIL route from SAFE_STOPPED to FAILED. Use one stage.route.set operation with target nodeId final, stage postcondition, outcome FAIL; payload targetNodeId FAILED; references procedure-current. Never invent capabilities or claim qualification. If unable to propose safely, return blockers instead of guessing.",
      contextPack:context.pack,
      contextManifest:context.manifest,
      contextDisclosureAccepted:true,
      maxTokens:2048,
      signal:AbortSignal.timeout(45000)
    });
    const proposal=output?.proposal;
    if(!proposal||!Array.isArray(proposal.operations)||!Array.isArray(proposal.blockers)){
      throw new TypeError("The Gateway proposal was not validated by Authoring Core.");
    }
    let preview="NOT_RUN",selectedGroupCount=0;
    if(proposal.blockers.length===0&&proposal.operations.length>0){
      const changeSet=createChangeSet({
        proposalResult:output,
        hostBase:{
          documentUri:"file:///synthetic/skills/example/assurance/procedure.yaml",
          documentVersion:1,packageGeneration:1,
          sourceDigest:"sha256:"+context.manifest[0].digest
        },
        operationIdFactory:(()=>{let id=0;return()=> "live-smoke-op-"+(++id);})()
      });
      const plan=await planV1Alpha5Patch({
        source,changeSet,currentDocumentUri:changeSet.base.documentUri,
        currentDocumentVersion:1,currentPackageGeneration:1
      });
      const candidate=await materializeAcceptedPatchGroups({
        source,plan,acceptedGroupIds:plan.groups.map(group=>group.id)
      });
      if(candidate.source===source||!candidate.digest)
        throw new Error("The live proposal did not produce a changed synthetic candidate.");
      preview="PASS";
      selectedGroupCount=plan.groups.length;
    }
    console.log("STUDIO_AI_AUTHORING_LIVE_GATEWAY_SMOKE",JSON.stringify({
      providerRequest:"PASS",
      responseEnvelope:"PASS",
      modelProposalSchema:"PASS",
      syntheticOnly:true,
      proposalOperationCount:proposal.operations.length,
      blockerCount:proposal.blockers.length,
      sourcePatchPreview:preview,
      selectedGroupCount,
      compilerCheck:"NOT_RUN",
      nativeWorkspaceEdit:"NOT_RUN",
      real5gcQualification:"NOT_CLAIMED"
    }));
  }catch(error){
    // Error diagnostics must never include the request body or credentials.
    console.error("STUDIO_AI_AUTHORING_LIVE_GATEWAY_FAILED",JSON.stringify({
      errorClass:error?.name??"Error",
      httpStatus:Number.isSafeInteger(error?.status)?error.status:undefined,
      category:error?.code??"PROVIDER_OR_PROPOSAL_REJECTED",
      promptContentLogged:false,secretLogged:false
    }));
    process.exitCode=1;
  }
}
