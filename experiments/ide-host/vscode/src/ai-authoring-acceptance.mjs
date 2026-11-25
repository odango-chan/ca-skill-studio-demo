// Isolated native-Editor acceptance. This command is registered only in the
// backend CI fixture host. It consumes the trusted v1alpha5 BuildRequest fixture
// produced by artifact generator 2.0.2, while all Check calls use the installed
// Compiler product version exposed by compilerIntegration.
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

export function registerSyntheticAuthoringAcceptance(vscode,context,compilerIntegration,authoringEditor=null){
  // A source-level flag alone is insufficient: this requires an explicit
  // acceptance-enabled Node host and a separately staged immutable fixture.
  if(typeof process==="undefined"||!process.versions?.node)return null;
  let pendingUndo=null;
  const command=vscode.commands.registerCommand(acceptanceCommand,async()=>{
    if(pendingUndo)throw Error("Previous synthetic acceptance Undo has not been verified");
    if(typeof compilerIntegration?.checkRequest!=="function"){
      throw Error("The installed Compiler Check client is unavailable");
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
    catch(e){if(!/not found|ENOENT|FileNotFound|EntryNotFound|nonexistent file/i.test(String(e?.message??e)))throw e;}
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
      // Undo belongs to the active frontend Monaco editor, not the backend
      // plugin command registry. The Chromium harness invokes real Theia Undo,
      // then a separate host command verifies the buffer and disk identities.
      pendingUndo={document,original,temporary,uri};
      created=false; // ownership transfers to verify/cleanup command
      return {
        compilerVersion:compilerIntegration.compilerVersion,artifactGeneratorVersion:"2.0.2",\n        languageTarget:"connectionagent.io/v1alpha5",
        qualification:"SYNTHETIC_TEST_ONLY",real5gcQualification:"NOT_CLAIMED",
        compilerBaseline:sourceCheck,compilerCandidate:candidateCheck,
        candidateDigest:candidate.digest,atomicGroupCount:patch.groups.length,
        nativeWorkspaceEdit:"PASS",bufferChangedBeforeUndo:true,
        unsavedDiskUnchanged:true,pendingUndo:true,autoSaved:false
      };
    }finally{
      if(created){
        try{
          if(document?.getText()===original){
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          }
        }finally{
          await vscode.workspace.fs.delete(temporary,{recursive:true,useTrash:false});
        }
      }
    }
  });
  const verify=vscode.commands.registerCommand(
    "skillStudio.internal.syntheticAuthoringVerifyUndo",async()=>{
      const state=pendingUndo;
      if(!state)throw Error("No synthetic native-editor Undo is pending");
      try{
        // Native Monaco changes may need a frontend/backend document event tick.
        for(let attempt=0;attempt<40 && state.document.getText()!==state.original;attempt++){
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(state.document.getText()!==state.original)
          throw Error("Theia native editor Undo did not restore the synthetic Procedure");
        const bytes=await vscode.workspace.fs.readFile(state.uri);
        if(new TextDecoder().decode(bytes)!==state.original)
          throw Error("Native Undo unexpectedly changed the synthetic file on disk");
        return {
          nativeUndo:"PASS",restoredOriginal:true,
          unsavedDiskUnchanged:true,autoSaved:false
        };
      }finally{
        pendingUndo=null;
        try{
          if(state.document.getText()===state.original){
            await focusSyntheticSource(state);
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          }
        }finally{
          await vscode.workspace.fs.delete(state.temporary,{recursive:true,useTrash:false});
        }
      }
    });
  // Separate from the earlier direct-native acceptance: this fixture drives
  // the exact production AI Editor Tab Generate -> model-shaped Gateway reply
  // -> Patch -> Compiler Check -> Apply button -> frontend Undo. It cannot run
  // without the pinned fixture staged by the backend Chromium CI host.
  let editorFixture=null;
  const editorPrepare=vscode.commands.registerCommand(
    "skillStudio.internal.prepareSyntheticEditorTabAcceptance",async()=>{
      if(!authoringEditor?.installSyntheticFixture)
        throw Error("Isolated Editor Tab synthetic fixture interface is unavailable");
      if(editorFixture)throw Error("Another synthetic Editor Tab fixture is already prepared");
      if(pendingUndo)throw Error("Previous native acceptance Undo must complete first");
      const fixtureUri=vscode.Uri.joinPath(context.extensionUri,"dist",
        "authoring-trusted-build-request.json");
      const trusted=JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fixtureUri)));
      if(trusted.apiVersion!=="connectionagent.io/compiler-build-request/v1alpha5"||
         trusted.languageTarget!=="connectionagent.io/v1alpha5"||
         !trusted.trustedBuildContext||!Array.isArray(trusted.files))
        throw Error("Editor Tab acceptance requires the trusted v1alpha5 fixture");
      const file=trusted.files.find(item=>item.path===sourceRel);
      if(!file||typeof file.bytes!=="string")throw Error("Trusted fixture Procedure is missing");
      const original=Buffer.from(file.bytes,"base64").toString("utf8");
      if(!original.includes("FAIL: SAFE_STOPPED"))
        throw Error("Trusted synthetic baseline route was changed");
      const roots=vscode.workspace.workspaceFolders??[];
      if(roots.length!==1||roots[0].uri.scheme!=="file")
        throw Error("Editor Tab acceptance requires one isolated local CI workspace");
      const temporary=vscode.Uri.joinPath(roots[0].uri,".studio-ai-acceptance");
      const assurance=vscode.Uri.joinPath(temporary,"skills","example","assurance");
      const uri=vscode.Uri.joinPath(assurance,"procedure.yaml");
      try{
        await vscode.workspace.fs.stat(temporary);
        throw Error("Synthetic acceptance directory already exists");
      }catch(e){
        if(!/not found|ENOENT|FileNotFound|EntryNotFound|nonexistent file/i.test(
          String(e?.message??e)))throw e;
      }
      let created=false;
      try{
        await vscode.workspace.fs.createDirectory(assurance);
        created=true;
        await vscode.workspace.fs.writeFile(uri,new TextEncoder().encode(original));
        const document=await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document,{
          preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
        });
        authoringEditor.installSyntheticFixture({
          documentUri:uri.toString(),original,trusted
        });
        editorFixture={document,original,uri,temporary};
        created=false;
        return {ready:true,syntheticOnly:true,documentUri:uri.toString()};
      }finally{
        if(created){
          authoringEditor.clearSyntheticFixture?.();
          await vscode.workspace.fs.delete(temporary,{recursive:true,useTrash:false});
        }
      }
    });
  async function focusSyntheticSource(state) {
    // Theia can transiently reject showTextDocument(TextDocument) while the
    // standalone Webview switches focus after native WorkspaceEdit. Retry
    // with the exact same prevalidated URI; never substitute another file.
    let lastError;
    for (const target of [state.document,state.uri,state.uri,state.document]) {
      try {
        await vscode.window.showTextDocument(target,{
          preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
        });
        return;
      } catch (error) {
        lastError=error;
        await new Promise(resolve=>setTimeout(resolve,120));
      }
    }
    throw new Error("Unable to refocus the same synthetic Procedure for frontend Undo: "+
      String(lastError?.message??"Theia editor unavailable"));
  }
  const editorApplied=vscode.commands.registerCommand(
    "skillStudio.internal.verifySyntheticEditorTabApplied",async()=>{
      const state=editorFixture;
      if(!state)throw Error("No Editor Tab acceptance fixture is pending");
      for(let attempt=0;attempt<40&&
          !state.document.getText().includes("FAIL: FAILED");attempt++){
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!state.document.getText().includes("FAIL: FAILED"))
        throw Error("The production Editor Tab Apply did not update the synthetic buffer");
      const disk=new TextDecoder().decode(await vscode.workspace.fs.readFile(state.uri));
      if(disk!==state.original)
        throw Error("The production Editor Tab unexpectedly saved the synthetic source");
      await focusSyntheticSource(state);
      return {nativeWorkspaceEdit:"PASS",unsavedDiskUnchanged:true,
        autoSaved:false,pendingUndo:true};
    });
  const editorUndo=vscode.commands.registerCommand(
    "skillStudio.internal.verifySyntheticEditorTabUndo",async()=>{
      const state=editorFixture;
      if(!state)throw Error("No synthetic Editor Tab Undo is pending");
      try{
        for(let attempt=0;attempt<40&&state.document.getText()!==state.original;attempt++){
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        if(state.document.getText()!==state.original)
          throw Error("Theia Undo did not restore the Editor Tab synthetic source");
        const disk=new TextDecoder().decode(await vscode.workspace.fs.readFile(state.uri));
        if(disk!==state.original)throw Error("Editor Tab Undo changed the original disk bytes");
        return {nativeUndo:"PASS",restoredOriginal:true,unsavedDiskUnchanged:true,autoSaved:false};
      }finally{
        editorFixture=null;
        authoringEditor.clearSyntheticFixture?.();
        try{
          if(state.document.getText()===state.original){
            await vscode.window.showTextDocument(state.document,{
              preview:false,preserveFocus:false,viewColumn:vscode.ViewColumn.One
            });
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          }
        }finally{
          await vscode.workspace.fs.delete(state.temporary,{recursive:true,useTrash:false});
        }
      }
    });
  context.subscriptions.push(command,verify,editorPrepare,editorApplied,editorUndo);
  return command;
}
