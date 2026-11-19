// Theia / VS Code host adapter for released CA Skill Compiler v2.0.0.
// The Compiler is the sole authority for Check, Build, linking and Artifact output.
// This adapter owns workspace snapshots, diagnostics and read-only presentation.
import {collectPackageSnapshot,packageRootForProcedure} from "./package-snapshot.mjs";
import {createCompilerWorkerClient} from "./compiler-client.mjs";
import {normalizeCompilerDiagnostics} from "./compiler-diagnostics.mjs";
import {createCompilerResultGate} from "./compiler-result-gate.mjs";
import {
  COMPILER_VERSION,
  COMPILER_INSPECTION_VERSION,
  COMPILER_LANGUAGE_TARGET,
  createCompilerBuildRequest,
  compilerArtifactRelativePath,
  isCompilerBuildResult,
  isCompilerInspection
} from "./compiler-request.mjs";

const SOURCE_SUFFIX="/assurance/procedure.yaml";
const utf8=new TextDecoder("utf-8",{fatal:true});
let snapshotGeneration=0;

function asUri(vscode,value){
  if(!value)return null;
  if(typeof value==="string")return vscode.Uri.parse(value);
  if(value.uri)return asUri(vscode,value.uri);
  if(value.rootUri)return asUri(vscode,value.rootUri);
  if(value.scheme&&value.path!==undefined){
    return vscode.Uri.from({
      scheme:value.scheme,authority:value.authority??"",path:value.path,
      query:value.query??"",fragment:value.fragment??""
    });
  }
  return null;
}

function packageRootFromUri(vscode,uri){
  if(!uri?.path)return null;
  const match=/^(.*\/skills\/[^/]+)(?:\/|$)/.exec(uri.path);
  if(!match)return null;
  return uri.with({path:match[1]});
}

function makeArtifactProvider(vscode,context,output){
  const emitter=new vscode.EventEmitter();
  const builds=new Map();
  const buildsById=new Map();
  const contents=new Map();
  let nextArtifactId=0;

  const provider={
    onDidChangeTreeData:emitter.event,
    async getChildren(node){
      if(!node)return [...builds.values()].sort((a,b)=>
        a.packageName.localeCompare(b.packageName));
      if(node.kind==="artifact-package"){
        if(!node.success)return [{
          kind:"artifact-message",artifactId:node.artifactId,
          label:"No Artifact · Build failed",
          description:node.errorCount+" Compiler error(s)",
          icon:"warning"
        }];
        return node.files;
      }
      return [];
    },
    getTreeItem(node){
      const collapsible=vscode.TreeItemCollapsibleState;
      if(node.kind==="artifact-package"){
        const item=new vscode.TreeItem(node.label,collapsible.Collapsed);
        item.id="compiler-artifact:"+node.artifactId;
        item.contextValue="skillStudio.buildArtifact";
        item.description=node.success
          ?node.files.length+" files · Compiler "+COMPILER_VERSION
          :node.errorCount+" error(s) · Compiler "+COMPILER_VERSION;
        item.tooltip=node.success
          ?"Verified, read-only in-memory Compiler Artifact. Not written into the authored workspace."
          :"BuildResult is failure-atomic; no partial Artifact was retained.";
        item.iconPath=new vscode.ThemeIcon(node.success?"package":"warning");
        return item;
      }
      if(node.kind==="artifact-file"){
        const item=new vscode.TreeItem(node.label,collapsible.None);
        item.id="compiler-artifact-file:"+node.uri.path;
        item.description=node.relativePath;
        item.tooltip="Read-only Compiler Artifact · "+node.relativePath;
        item.iconPath=new vscode.ThemeIcon(node.icon??"file");
        item.command={command:"vscode.open",title:"Open Artifact",arguments:[node.uri]};
        return item;
      }
      const item=new vscode.TreeItem(node.label,collapsible.None);
      item.description=node.description;
      item.iconPath=new vscode.ThemeIcon(node.icon??"info");
      return item;
    },
    getParent(node){
      if(!node||node.kind==="artifact-package")return undefined;
      return buildsById.get(node.artifactId);
    },
    setBuild(packageRoot,packageName,result){
      const artifactId=String(++nextArtifactId);
      const previous=builds.get(packageRoot.toString());
      if(previous){
        buildsById.delete(previous.artifactId);
        for(const file of previous.files??[])contents.delete(file.uri.path);
      }
      const prefix="skills/"+packageName+"/";
      const files=[];
      if(result.success){
        for(const file of result.outputFiles){
          const relativePath=compilerArtifactRelativePath(packageName,file?.path);
          let text;
          try{
            const binary=atob(file.bytes);
            const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
            text=utf8.decode(bytes);
          }catch{
            text="[Binary Artifact: read-only preview is unavailable for this file.]";
          }
          const uri=vscode.Uri.from({
            scheme:"skill-studio-artifact",
            path:"/"+artifactId+"/"+relativePath
          });
          contents.set(uri.path,text);
          files.push({
            kind:"artifact-file",artifactId,relativePath,
            label:relativePath.split("/").at(-1),uri,
            icon:/\.ya?ml$/i.test(relativePath)?"file-code":
              /\.json$/i.test(relativePath)?"json":
              /\.md$/i.test(relativePath)?"markdown":
              /\.py$/i.test(relativePath)?"file-code":"file"
          });
        }
      }
      const entry={
        kind:"artifact-package",artifactId,packageRoot:packageRoot.toString(),
        packageName,label:packageName+(result.success?" · Build":" · Build failed"),
        success:result.success,errorCount:result.diagnostics.filter(item=>
          item.severity==="error").length,files
      };
      builds.set(packageRoot.toString(),entry);
      buildsById.set(artifactId,entry);
      emitter.fire();
      output.appendLine("Artifact view updated: "+packageName+
        " · "+(result.success?files.length+" files":"FAILED / no partial output"));
      return entry;
    }
  };

  const contentRegistration=vscode.workspace.registerTextDocumentContentProvider(
    "skill-studio-artifact",{
      provideTextDocumentContent(uri){
        return contents.get(uri.path)??"Artifact content is no longer available in this session.";
      }
    });
  context.subscriptions.push(emitter,contentRegistration);
  return provider;
}

export function registerCompilerIntegration(vscode,context,{
  getActiveDocument=()=>vscode.window.activeTextEditor?.document??null
}={}){
  const output=vscode.window.createOutputChannel("Skill Compiler · "+COMPILER_VERSION);
  const diagnostics=vscode.languages.createDiagnosticCollection("skill-compiler");
  const compilerProblems=new Map();
  const resultGate=createCompilerResultGate();
  const problemsEmitter=new vscode.EventEmitter();
  const problemsProvider={
    onDidChange:problemsEmitter.event,
    getProblems:()=>[...compilerProblems.values()].flat()
  };
  const client=createCompilerWorkerClient(vscode,context);
  const artifacts=makeArtifactProvider(vscode,context,output);
  context.subscriptions.push(output,diagnostics,problemsEmitter,{dispose:()=>client.dispose()});

  function clearPackageDiagnostics(packageRoot){
    const prefix=packageRoot.path.replace(/\/$/,"")+"/";
    diagnostics.forEach(uri=>{
      if(uri.scheme===packageRoot.scheme&&
         uri.authority===packageRoot.authority&&
         uri.path.startsWith(prefix))diagnostics.delete(uri);
    });
  }

  function invalidatePackage(packageRoot){
    if(!packageRoot)return;
    const rootKey=packageRoot.toString();
    resultGate.advance(rootKey);
    clearPackageDiagnostics(packageRoot);
    if(compilerProblems.delete(rootKey))problemsEmitter.fire();
  }

  function invalidateAll(){
    const known=new Set([...resultGate.knownRoots(),...compilerProblems.keys()]);
    resultGate.invalidateAll();
    for(const key of known){
      const root=asUri(vscode,key);
      if(root)clearPackageDiagnostics(root);
    }
    if(compilerProblems.size){
      compilerProblems.clear();
      problemsEmitter.fire();
    }
  }

  function onWorkspaceFile(uri){
    if(!uri||uri.scheme==="skill-studio-artifact")return;
    if(/\/\.vscode\/settings\.json$/i.test(uri.path??"")){
      invalidateAll();
      return;
    }
    const root=packageRootFromUri(vscode,uri);
    if(root)invalidatePackage(root);
  }
  // Keep Editor/Compiler generations separate. Source changes invalidate
  // Compiler-owned findings immediately, never Language Service diagnostics.
  const listen=(event,callback)=>{
    if(typeof event!=="function")return;
    const subscription=event(callback);
    if(subscription?.dispose)context.subscriptions.push(subscription);
  };
  listen(vscode.workspace.onDidChangeTextDocument,event=>
    onWorkspaceFile(event.document?.uri));
  listen(vscode.workspace.onDidCreateFiles,event=>
    event.files?.forEach(onWorkspaceFile));
  listen(vscode.workspace.onDidDeleteFiles,event=>
    event.files?.forEach(onWorkspaceFile));
  listen(vscode.workspace.onDidRenameFiles,event=>
    event.files?.forEach(file=>{
      onWorkspaceFile(file.oldUri);
      onWorkspaceFile(file.newUri);
    }));
  listen(vscode.workspace.onDidChangeConfiguration,event=>{
    if(typeof event.affectsConfiguration!=="function"||
       event.affectsConfiguration("connectionAgent.skillStudio"))invalidateAll();
  });
  listen(vscode.workspace.onDidChangeWorkspaceFolders,()=>invalidateAll());

  function publishDiagnostics(packageRoot,packageName,procedureUri,items,compilerRevision){
    // Validate the whole Compiler response before touching any accepted
    // DiagnosticCollection. Missing or ungrounded source ranges remain
    // request/file Problems, never synthetic line-1 editor errors.
    const projected=normalizeCompilerDiagnostics(items,{packageName,requirePhase:true});
    const grouped=new Map();
    const problemEntries=[];
    for(const item of projected){
      const sourceUri=item.sourcePath
        ?vscode.Uri.joinPath(packageRoot,...item.sourcePath.split("/"))
        :null;
      // A request-level Compiler error has no owning source document.
      // Do not attach it to the active Procedure merely to enable a click.
      const uri=sourceUri;
      const problem={
        ...item,uri:uri?.toString()??null,compilerRevision
      };
      problemEntries.push(problem);
      if(item.locationKind==="request"){
        output.appendLine("[request/unmapped] "+item.code+
          (item.path?" "+item.path:"")+": "+item.message);
        continue;
      }
      if(item.locationKind!=="source"){
        output.appendLine("[file-only] "+item.code+" "+item.path+
          ": no authoritative line/column; editor marker not invented");
        continue;
      }
      const line=item.line-1,column=item.column-1;
      const severity=item.severity==="warning"
        ?vscode.DiagnosticSeverity.Warning:vscode.DiagnosticSeverity.Error;
      const diagnostic=new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(line,column),
          new vscode.Position(line,column+1)),item.message,severity
      );
      diagnostic.source="CA Skill Compiler "+COMPILER_VERSION;
      diagnostic.code=item.code;
      if(!grouped.has(uri.toString()))grouped.set(uri.toString(),{uri,items:[]});
      grouped.get(uri.toString()).items.push(diagnostic);
    }
    clearPackageDiagnostics(packageRoot);
    for(const {uri,items:group} of grouped.values())diagnostics.set(uri,group);
    compilerProblems.set(packageRoot.toString(),problemEntries);
    problemsEmitter.fire();
    output.appendLine("Compiler diagnostics: "+projected.length+
      " · "+projected.filter(item=>item.severity==="error").length+" error(s)");
  }

  async function chooseProcedure(target){
    let uri=asUri(vscode,target);
    if(!uri){
      const active=getActiveDocument?.();
      if(active?.uri)uri=active.uri;
    }
    if(uri){
      if(uri.path.endsWith(SOURCE_SUFFIX)){
        return vscode.workspace.openTextDocument(uri);
      }
      const root=packageRootFromUri(vscode,uri);
      if(root){
        const procedure=vscode.Uri.joinPath(root,"assurance","procedure.yaml");
        try{return await vscode.workspace.openTextDocument(procedure);}
        catch(error){
          if(error?.code!=="FileNotFound")throw error;
        }
      }
    }

    const candidates=await vscode.workspace.findFiles(
      "**/assurance/procedure.yaml","**/{node_modules,.git}/**",100
    );
    if(!candidates.length)throw new Error("No Skill Package with assurance/procedure.yaml was found");
    let selected=candidates[0];
    if(candidates.length>1){
      const choice=await vscode.window.showQuickPick(candidates.map(file=>({
        label:vscode.workspace.asRelativePath(file),
        description:file.path,
        uri:file
      })),{placeHolder:"Select a Skill Package for Compiler v2.0.0"});
      if(!choice) return null;
      selected=choice.uri;
    }
    return vscode.workspace.openTextDocument(selected);
  }

  async function assembleRequest(target){
    const procedure=await chooseProcedure(target);
    if(!procedure)return null;
    const root=packageRootForProcedure(vscode,procedure);
    if(!root)throw new Error("The selected document is not a Skill Procedure");
    // Compiler v2 accepts only the released v1alpha5 language target.
    // Let Compiler produce errors for malformed or legacy source bytes:
    // never silently re-target or translate source syntax in the editor.
    const languageTarget=COMPILER_LANGUAGE_TARGET;
    const expectedSuffix="/skills/"+root.name;
    if(!root.uri.path.endsWith(expectedSuffix)){
      throw new Error("Compiler v2 requires the Package to live under the project skills/<name>/ source root");
    }
    const rootKey=root.uri.toString();
    const sourceRevision=resultGate.current(rootKey);
    const snapshot=await collectPackageSnapshot(vscode,procedure,++snapshotGeneration);
    if(!resultGate.isCurrent(rootKey,sourceRevision))
      throw Error("Skill Source changed during Compiler snapshot assembly; rerun Check/Build");
    if(snapshot.completeness!=="complete"){
      throw new Error("Compiler input snapshot is "+snapshot.completeness+
        "; refusing to compile incomplete source: "+(snapshot.reason??"unknown snapshot error"));
    }
    const request=createCompilerBuildRequest({
      packageName:root.name,
      documents:snapshot.documents
    });
    const projectFolder=vscode.workspace.getWorkspaceFolder?.(root.uri);
    if(projectFolder){
      try{
        const settings=vscode.workspace.getConfiguration(
          "connectionAgent.skillStudio",projectFolder.uri
        );
        const legacy=settings.get("dependencies",[]);
        if(Array.isArray(legacy)&&legacy.length){
          output.appendLine("TRUST BOUNDARY: "+legacy.length+
            " existing project dependency record(s) are not independently authenticated v1alpha5 Compiler BuildRequest bindings. No snapshot was forwarded as a trusted Owner/Deployment authorization.");
        }
      }catch(error){
        output.appendLine("Project dependency settings unavailable: "+String(error?.message??error));
      }
    }
    output.appendLine("Compiler "+COMPILER_VERSION+" · CA-SL v1alpha5 · "+
      root.name+" · "+request.files.length+" source file(s)");
    output.appendLine("No independently trusted dependency, CapabilityContracts, Evidence or IngressCatalog publication is currently attached to this Compiler request. Compiler Check will report resulting linking gaps; Studio does not synthesize Owner authorization.");
    return {procedure,root,request,sourceRevision};
  }

  async function withProgress(title,task){
    if(typeof vscode.window.withProgress!=="function"||
       vscode.ProgressLocation?.Notification===undefined){
      return task({report(){}});
    }
    return vscode.window.withProgress({
      location:vscode.ProgressLocation.Notification,title,cancellable:false
    },task);
  }

  async function checkSkill(target){
    const prepared=await assembleRequest(target);
    if(!prepared)return null;
    const rootKey=prepared.root.uri.toString();
    if(!resultGate.isCurrent(rootKey,prepared.sourceRevision))
      throw Error("Skill Source changed while preparing Compiler Check; rerun Check");
    const revision=resultGate.advance(rootKey);
    return withProgress("Checking Skill · Compiler "+COMPILER_VERSION,async progress=>{
      progress.report({message:"Running CA-SL v1alpha5 Compiler Check…"});
      const result=await client.request("check",prepared.request);
      if(!Array.isArray(result))throw new Error("Compiler Check returned an invalid Diagnostic[] response");
      if(!resultGate.isCurrent(rootKey,revision)){
        output.appendLine("Compiler Check result discarded: Source or Package state changed during the request");
        return null;
      }
      publishDiagnostics(prepared.root.uri,prepared.root.name,
        prepared.procedure.uri,result,revision);
      const errors=result.filter(item=>item.severity==="error").length;
      const warnings=result.filter(item=>item.severity==="warning").length;
      output.show(true);
      if(errors){
        void vscode.window.showWarningMessage(
          "Compiler Check: "+errors+" error(s), "+warnings+" warning(s) · "+prepared.root.name);
      }else{
        void vscode.window.showInformationMessage(
          "Compiler Check PASS · "+warnings+" warning(s) · "+prepared.root.name);
      }
      return {diagnostics:result,errors,warnings};
    });
  }

  async function buildSkill(target){
    const prepared=await assembleRequest(target);
    if(!prepared)return null;
    const rootKey=prepared.root.uri.toString();
    if(!resultGate.isCurrent(rootKey,prepared.sourceRevision))
      throw Error("Skill Source changed while preparing Compiler Build; rerun Build");
    const revision=resultGate.advance(rootKey);
    return withProgress("Building Skill · Compiler "+COMPILER_VERSION,async progress=>{
      progress.report({message:"Compiling and linking CA-SL v1alpha5…"});
      const result=await client.request("build",prepared.request);
      if(!isCompilerBuildResult(result)){
        throw new Error("Compiler BuildResult does not match the frozen v1alpha5 output contract");
      }
      if(!result.success&&result.outputFiles.length){
        throw new Error("Compiler violated failure-atomicity: failed BuildResult contains output files");
      }
      if(result.success){
        progress.report({message:"Verifying deterministic Artifact integrity…"});
        const verification=await client.request("verifyArtifact",result);
        if(typeof verification!=="string"||verification.length){
          throw new Error("Compiler Artifact integrity verification failed: "+String(verification));
        }
      }
      if(!resultGate.isCurrent(rootKey,revision)){
        output.appendLine("Compiler Build result discarded: Source or Package state changed during the request");
        return null;
      }
      publishDiagnostics(prepared.root.uri,prepared.root.name,
        prepared.procedure.uri,result.diagnostics,revision);
      artifacts.setBuild(prepared.root.uri,prepared.root.name,result);
      output.show(true);
      if(result.success){
        void vscode.window.showInformationMessage(
          "Compiler Build PASS · "+result.outputFiles.length+
          " Artifact file(s) · "+prepared.root.name+
          " (read-only; not written into Source)");
      }else{
        void vscode.window.showWarningMessage(
          "Compiler Build BLOCKED · "+result.diagnostics.filter(item=>
            item.severity==="error").length+" error(s) · no Artifact emitted");
      }
      return result;
    });
  }

  async function inspectDependencies(target){
    const prepared=await assembleRequest(target);
    if(!prepared)return null;
    return withProgress("Inspecting Dependencies · Compiler "+COMPILER_VERSION,async progress=>{
      progress.report({message:"Inspecting only independently supplied v1alpha5 immutable snapshots…"});
      const result=await client.request("inspect",prepared.request);
      if(!isCompilerInspection(result)){
        throw new Error("Compiler DependencyInspection does not match the frozen v1alpha5 output contract");
      }
      output.appendLine("DependencyInspection · "+result.callables.length+
        " callable(s) · "+result.schemas.length+" Schema(s) · "+
        result.diagnostics.length+" diagnostic(s)");
      if(!result.callables.length&&!result.schemas.length){
        output.appendLine("No trusted dependency snapshots were supplied; Studio-only project records are not Owner qualification evidence.");
      }
      output.show(true);
      void vscode.window.showInformationMessage(
        "Compiler DependencyInspection: "+result.callables.length+
        " callable(s), "+result.schemas.length+" Schema(s); "+
        (result.diagnostics.length?"see Compiler Output":"no trusted v1alpha5 snapshots supplied"));
      return result;
    });
  }

  async function safe(command,target){
    try{
      if(command==="check")return await checkSkill(target);
      if(command==="build")return await buildSkill(target);
      return await inspectDependencies(target);
    }catch(error){
      output.appendLine("ERROR: "+String(error?.stack??error));
      output.show(true);
      void vscode.window.showErrorMessage(
        "Skill Compiler "+COMPILER_VERSION+": "+String(error?.message??error));
      return null;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("skillStudio.revealCompilerDiagnostic",async item=>{
      const uri=asUri(vscode,item?.uri);
      if(!uri)return;
      const root=packageRootFromUri(vscode,uri);
      const rootKey=root?.toString();
      if(!rootKey||!resultGate.isCurrent(rootKey,item?.compilerRevision))return;
      const document=await vscode.workspace.openTextDocument(uri);
      if(!resultGate.isCurrent(rootKey,item.compilerRevision))return;
      const editor=await vscode.window.showTextDocument(document,{
        preview:false,viewColumn:vscode.ViewColumn.One
      });
      const line=Number.isSafeInteger(item?.line)&&item.line>0?item.line-1:0;
      const column=Number.isSafeInteger(item?.column)&&item.column>0?item.column-1:0;
      const position=new vscode.Position(line,column);
      editor.selection=new vscode.Selection(position,position);
      editor.revealRange(new vscode.Range(position,position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }),
    vscode.commands.registerCommand("skillStudio.checkSkill",target=>safe("check",target)),
    vscode.commands.registerCommand("skillStudio.buildSkill",target=>safe("build",target)),
    vscode.commands.registerCommand("skillStudio.inspectCompilerDependencies",
      target=>safe("inspect",target))
  );

  // Real Chromium acceptance: exercise the actual pinned Go/WASM callbacks in
  // the browser-only Theia Plugin Worker with a deliberately incomplete Skill.
  // It proves transport and failure atomicity only, not a qualified Owner build.
  if(typeof globalThis.Worker==="function"&&
     typeof globalThis.location!=="undefined"&&
     /^(localhost|127(?:\.\d{1,3}){3})$/.test(globalThis.location.hostname)){
    context.subscriptions.push(vscode.commands.registerCommand(
      "skillStudio.internal.compilerWorkerAcceptance",async()=>{
        const request={
          apiVersion:"connectionagent.io/compiler-build-request/v1alpha5",
          languageTarget:"connectionagent.io/v1alpha5",
          files:[
            {
              path:"skills/compiler-smoke/SKILL.md",
              bytes:"IyBDb21waWxlciBzbW9rZQo="
            },
            {
              path:"skills/compiler-smoke/assurance/procedure.yaml",
              bytes:"c3RhcnQ6IFsK"
            }
          ],
          resolvedDependencies:[],
          targets:["compiler-smoke"]
        };
        const [check,build,inspect]=await Promise.all([
          client.request("check",request),
          client.request("build",request),
          client.request("inspect",request)
        ]);
        if(!Array.isArray(check)||!check.some(item=>item.code==="YAML_PARSE_ERROR")){
          throw new Error("Compiler Check did not return the expected YAML_PARSE_ERROR diagnostic");
        }
        if(!isCompilerBuildResult(build)||build.success!==false||
           build.outputFiles.length!==0){
          throw new Error("Compiler Worker did not preserve failure-atomic BuildResult semantics");
        }
        if(!isCompilerInspection(inspect)){
          throw new Error("Compiler Worker did not return DependencyInspection v1alpha5");
        }
        return {
          compilerVersion:COMPILER_VERSION,languageTarget:COMPILER_LANGUAGE_TARGET,
          checkDiagnostics:check.length,buildSuccess:build.success,
          buildOutputFiles:build.outputFiles.length,
          inspectCallables:inspect.callables.length,inspectSchemas:inspect.schemas.length,
          workerTransport:"PASS",artifactFailureAtomicity:"PASS"
        };
      }
    ));
  }

  return {
    provider:artifacts,
    problems:problemsProvider,
    getArtifactProvider:()=>artifacts,
    dispose(){client.dispose();diagnostics.dispose?.();output.dispose?.();}
  };
}
