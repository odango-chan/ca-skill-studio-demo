// Isolated native-Editor acceptance. This command is registered only in the
// backend CI fixture host, and consumes the exact trusted Compiler v2.0.2 fixture.
// It does not claim any real 5GC Owner or Deployment Qualification.
import {buildContextPack} from "../../../../authoring/core/context-pack.mjs";
import {validateModelProposal} from "../../../../authoring/core/model-proposal.mjs";
import {createChangeSet} from "../../../../authoring/core/change-set.mjs";
import {planV1Alpha5Patch,materializeAcceptedPatchGroups} from "../../../../authoring/core/v1alpha5-patch-engine.mjs";
import {applyAuthoringCandidateToBuffer} from "./ai-authoring-editor.mjs";

const acceptanceCommand="skillStudio.internal.syntheticAuthoringApplyAcceptance";
const sourceRel="skills/example/assurance/procedure.yaml";

function failIfErrors(diagnostics,label){
  if(!Array.isArray(diagnostics))throw Error(label+" did not return Diagnostic[]");
  const errors=diagnostics.filter(item=>item?.severity==="error");
  if(errors.length)throw Error(label+" failed: "+JSON.stringify(errors.slice(0,6)));
  return {diagnostics:diagnostics.length,errors:0};
}

export function registerSyntheticAuthoringAcceptance(vscode,context,compilerIntegration){
  // A source-level flag alone is insufficient: this requires an explicit
  // acceptance-enabled Node host and a separately staged immutable fixture.
  if(typeof process==="undefined"||!process.versions?.node||
     process.env.THEIA_ACCEPTANCE_FIXTURES!=="1")return null;
  const command=vscode.commands.registerCommand(acceptanceCommand,async()=>{
    if(typeof compilerIntegration?.checkRequest!=="function"){
      throw Error("The pinned Compiler v2.0.2 Check client is unavailable");
    }
    const fixtureUri=vscode.Uri.joinPath(context.extensionUri,"dist",
      "authoring-trusted-build-request.json");
    const trusted=JSON.parse(new TextDecoder().decode(
      await vscode.workspace.fs.readFile(fixtureUri)));
    if(trusted.apiVersion!=="connectionagent.io/compiler-build-request/v1alpha5"||
       trusted.languageTarget!=="connectionagent.io/v1alpha5"||
       !trusted.trustedBuildContext||!Array.isArray(trusted.files)){
      throw Error("Staged synthetic acceptance request lacks verified Compiler v1alpha5 identity");
    }
    const file=trusted.files.find(item=>item.path===sourceRel);
    if(!file||typeof file.bytes!=="string")throw Error("Pinned synthetic Procedure is missing");
    const original=Buffer.from(file.bytes,"base64").toString("utf8");
    if(!original.includes("FAIL: SAFE_STOPPED"))
      throw Error("Trusted synthetic source has changed unexpectedly");
    const pack=await buildContextPack({
      taskId:"synthetic-editor-e2e",revision:1,
      languageTarget:"connectionagent.io/v1alpha5",
      procedure:{path:"assurance/procedure.yaml",documentVersion:1,text:original},
      resources:[],maxBytes:131072
    });
    const proposal=validateModelProposal({
      schema:"ca-studio.ai-model-proposal/v1",
      summary:"Test the synthetic Compiler-qualified route modification",
      plan:["Update only the final Postcondition FAIL route"],
      operations:[{
        type:"stage.route.set",
        target:{nodeId:"final",stage:"postcondition",outcome:"FAIL"},
        payload:{targetNodeId:"FAILED"},
        rationale:"Verify a Host-owned patch in the real native editor",
        references:["procedure-current"]
      }],assumptions:[],blockers:[]
    },{allowedContextIds:["procedure-current"]});
    const roots=vscode.workspace.workspaceFolders??[];
    if(roots.length!==1)throw Error("Synthetic acceptance requires one isolated project root");
    const root=roots[0].uri;
    if(root.scheme!=="file")throw Error("Synthetic native WorkspaceEdit requires a file-backed project");
    const temporary=vscode.Uri.joinPath(root,".studio-ai-acceptance");
    const assurance=vscode.Uri.joinPath(temporary,"skills","example","assurance");
    const uri=vscode.Uri.joinPath(assurance,"procedure.yaml");
    let existed=false;
    try{await vscode.workspace.fs.stat(temporary);existed=true;}
    catch(e){if(!/not found|ENOENT|FileNotFound/i.test(String(e?.message??e)))throw e;}
    if(existed)throw Error("Synthetic acceptance directory already exists; refusing to modify it");
    let created=false,document=null;
    try{
      await vscode.workspace.fs.createDirectory(assurance);
      created=true;
      await vscode.workspace.fs.writeFile(uri,new TextEncoder().encode(original));
      document=await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document,{
        preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
      });
      const sourceCheck=failIfErrors(await compilerIntegration.checkRequest(trusted),
        "Synthetic original Compiler Check");
      const changeSet=createChangeSet({
        proposalResult:{
          taskId:pack.pack.taskId,revision:1,
          languageTarget:pack.pack.languageTarget,manifest:pack.manifest,proposal
        },
        hostBase:{
          documentUri:uri.toString(),documentVersion:document.version,
          packageGeneration:1,sourceDigest:"sha256:"+pack.manifest[0].digest
        },
        operationIdFactory:()=> "synthetic-native-op-1"
      });
      const patch=await planV1Alpha5Patch({
        source:original,changeSet,currentDocumentUri:uri.toString(),
        currentDocumentVersion:document.version,currentPackageGeneration:1
      });
      if(patch.groups.length!==1)
        throw Error("Expected one synthetic atomic patch group");
      const candidate=await materializeAcceptedPatchGroups({
        source:original,plan:patch,acceptedGroupIds:patch.groups.map(group=>group.id)
      });
      if(candidate.source===original||!candidate.source.includes("FAIL: FAILED"))
        throw Error("Synthetic accepted-group patch did not change the final route");
      const request={
        ...trusted,
        files:trusted.files.map(item=>item.path===sourceRel
          ?{...item,bytes:Buffer.from(candidate.source,"utf8").toString("base64")}:item)
      };
      const candidateCheck=failIfErrors(await compilerIntegration.checkRequest(request),
        "Exact synthetic candidate Compiler Check");
      const originalVersion=document.version;
      const applied=await applyAuthoringCandidateToBuffer(vscode,document,{
        source:original,documentVersion:originalVersion,
        candidateSource:candidate.source
      });
      if(!applied.applied||applied.saved||document.getText()!==candidate.source)
        throw Error("The real native WorkspaceEdit did not apply the qualified candidate");
      const diskAfterApply=new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      if(diskAfterApply!==original)
        throw Error("Native WorkspaceEdit unexpectedly saved the candidate to disk");
      await vscode.window.showTextDocument(document,{
        preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
      });
      await vscode.commands.executeCommand("undo");
      if(document.getText()!==original)
        throw Error("Native editor Undo did not restore the original Procedure");
      const diskAfterUndo=new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      if(diskAfterUndo!==original)
        throw Error("Undo changed the source file on disk unexpectedly");
      return {
        compilerVersion:"v2.0.2",languageTarget:"connectionagent.io/v1alpha5",
        qualification:"SYNTHETIC_TEST_ONLY",real5gcQualification:"NOT_CLAIMED",
        compilerBaseline:sourceCheck,compilerCandidate:candidateCheck,
        candidateDigest:candidate.digest,atomicGroupCount:patch.groups.length,
        nativeWorkspaceEdit:"PASS",bufferChangedBeforeUndo:true,
        unsavedDiskUnchanged:true,nativeUndo:"PASS",
        restoredOriginal:true,autoSaved:false
      };
    }finally{
      if(created){
        try{
          if(document&&document.getText()!==original){
            await vscode.window.showTextDocument(document,{
              preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
            });
            await vscode.commands.executeCommand("undo");
          }
          if(document?.getText()===original){
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          }
        }finally{
          await vscode.workspace.fs.delete(temporary,{recursive:true,useTrash:false});
        }
      }
    }
  });
  context.subscriptions.push(command);
  return command;
}
