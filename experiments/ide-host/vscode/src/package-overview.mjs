const CORE = Object.freeze([
  'assurance/contract.yaml',
  'assurance/procedure.yaml',
  'assurance/predicates.yaml'
]);
const FILE_LIMIT = 1000;
const NOISE = /(^|\/)(?:node_modules|\.git)\/|\/(?:\.DS_Store|Thumbs\.db)$/i;

function parentOf(path) {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0,index) : '';
}
function packageMarker(path) {
  if (path.endsWith('/SKILL.md')) return parentOf(path);
  if (/\/assurance\/(?:contract|procedure|predicates)\.yaml$/.test(path))
    return path.slice(0,path.lastIndexOf('/assurance/'));
  return null;
}
function basename(path) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}
function ownerOf(path, roots) {
  return roots.find(root => path.startsWith(root + '/')) ?? null;
}
function classify(path) {
  if (path === 'SKILL.md') return 'definition';
  if (path.startsWith('assurance/')) return 'assurance';
  if (path.startsWith('schemas/')) return 'schemas';
  if (path.startsWith('scripts/')) return 'scripts';
  if (path.startsWith('references/')) return 'references';
  return 'other';
}
export function packageFileCommand(path, uri) {
  if (path === 'assurance/procedure.yaml')
    return {command:'skillStudio.openProcedure',title:'Open Procedure Designer',arguments:[uri]};
  if (path === 'assurance/contract.yaml')
    return {command:'skillStudio.openContract',title:'Open Contract Designer',arguments:[uri]};
  if (path === 'assurance/predicates.yaml')
    return {command:'skillStudio.openPredicates',title:'Open Predicate Designer',arguments:[uri]};
  if (/^schemas\/.+\.schema\.ya?ml$/i.test(path))
    return {command:'skillStudio.openSchema',title:'Open Schema Designer',arguments:[uri]};
  return {command:'vscode.open',title:'Open Source',arguments:[uri]};
}

// Inventory only. It does not parse or validate Package contents.
// A package is discovered from SKILL.md or an assurance core file so incomplete
// packages remain visible instead of disappearing from the workbench.
export function packageScanRoots(workspaceFolders, openDocuments = []) {
  const folders = (workspaceFolders ?? [])
    .map(folder=>folder?.uri).filter(uri=>typeof uri?.path==='string');
  if (folders.length) return folders;
  // Browser-only Theia can expose an imported OPFS Package through an open
  // TextDocument before it reports a workspace folder. Recover only the
  // nearest known Skills/workspaces container, never scan the whole OPFS.
  const roots = new Map();
  for (const document of openDocuments ?? []) {
    const path = document?.uri?.path;
    if (typeof path !== 'string') continue;
    let packageRoot = packageMarker(path);
    if (!packageRoot) {
      const match = path.match(/^(.*\/(?:skills|workspaces)\/[^/]+)(?:\/|$)/);
      if (match) packageRoot = match[1];
    }
    if (!packageRoot) continue;
    const parent = parentOf(packageRoot);
    const container = ['skills','workspaces'].includes(basename(parent))
      ? parent : packageRoot;
    const uri = document.uri.with?.({path:container});
    if (uri) roots.set(uri.toString(),uri);
  }
  return [...roots.values()];
}

export function buildPackageInventory(uris, dirtyPaths = new Set(), truncated = false) {
  const files = (Array.isArray(uris) ? uris : [])
    .filter(uri => uri && typeof uri.path === 'string' && !NOISE.test(uri.path))
    .map(uri => ({uri,path:uri.path}));
  const rootSet = new Set(files.map(file => packageMarker(file.path)).filter(Boolean));
  const roots = [...rootSet].filter(root=>root.length>0 && root!=='/')
    .sort((a,b)=>b.length-a.length || a.localeCompare(b));
  const packages = [];
  for (const rootPath of [...roots].sort((a,b)=>a.localeCompare(b))) {
    const packageFiles = files.filter(file => ownerOf(file.path,roots) === rootPath)
      .map(file => ({
        uri:file.uri,
        path:file.path.slice(rootPath.length+1)
      }))
      .filter(file => file.path.length > 0)
      .sort((a,b)=>a.path.localeCompare(b.path));
    if (!packageFiles.length) continue;
    const byGroup = new Map([
      ['definition',[]],['assurance',[]],['schemas',[]],
      ['scripts',[]],['references',[]],['other',[]]
    ]);
    for (const file of packageFiles) byGroup.get(classify(file.path)).push(file);
    const present = new Set(packageFiles.map(file=>file.path));
    const missingCore = CORE.filter(path=>!present.has(path));
    const dirtyCount = packageFiles.filter(file=>dirtyPaths.has(file.uri.path)).length;
    const rootFile = packageFiles[0]?.uri;
    const rootUri = rootFile?.with ? rootFile.with({path:rootPath}) : null;
    const name = basename(rootPath);
    const groups = [
      {key:'definition',label:'Skill Definition',files:byGroup.get('definition'),missing:present.has('SKILL.md')?[]:['SKILL.md'],icon:'book'},
      {key:'assurance',label:'Assurance · '+(CORE.length-missingCore.length)+'/'+CORE.length+' core',files:byGroup.get('assurance'),missing:missingCore,icon:'shield'},
      {key:'schemas',label:'Schemas · '+byGroup.get('schemas').length,files:byGroup.get('schemas'),missing:[],icon:'symbol-structure'},
      {key:'scripts',label:'Scripts · '+byGroup.get('scripts').length,files:byGroup.get('scripts'),missing:[],icon:'code'},
      {key:'references',label:'References · '+byGroup.get('references').length,files:byGroup.get('references'),missing:[],icon:'book-open'},
      {key:'other',label:'Other · '+byGroup.get('other').length,files:byGroup.get('other'),missing:[],icon:'folder'}
    ].filter(group=>group.files.length || group.missing.length);
    packages.push({
      kind:'package',name,rootPath,rootUri,files:packageFiles,groups,
      fileCount:packageFiles.length,dirtyCount,corePresent:CORE.length-missingCore.length,
      coreTotal:CORE.length,missingCore,hasSkillMd:present.has('SKILL.md'),
      incomplete:missingCore.length>0 || !present.has('SKILL.md'),truncated
    });
  }
  return {packages,scannedFiles:files.length,truncated};
}

function packageNode(pkg) {
  return {
    ...pkg,kind:'package',
    label:pkg.name,
    description:(pkg.relativeRoot??pkg.rootPath)+' · '+
      pkg.corePresent+'/'+pkg.coreTotal+' core · '+pkg.fileCount+' files'+
      (pkg.dirtyCount?' · '+pkg.dirtyCount+' modified':''),
    tooltip:'Package 文件清点；不代表内容校验或 Runtime 资格。'+
      (pkg.incomplete?' 缺少：'+[...(!pkg.hasSkillMd?['SKILL.md']:[]),...pkg.missingCore].join(', '):''),
    icon:pkg.incomplete?'warning':'package'
  };
}
function groupNode(pkg, group) {
  return {
    ...group,kind:'group',packageRoot:pkg.rootPath,
    label:group.label,
    description:group.missing.length?'缺少 '+group.missing.length+' 个文件':undefined
  };
}
function treeNode(vscode, node) {
  const collapsible = node.kind==='section'
    ?(node.section==='skills'?vscode.TreeItemCollapsibleState.Expanded:
      vscode.TreeItemCollapsibleState.Collapsed)
    :node.kind==='package'||node.kind==='group'
      ?vscode.TreeItemCollapsibleState.Collapsed
      :vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(node.label,collapsible);
  if (node.description) item.description = node.description;
  if (node.tooltip) item.tooltip = node.tooltip;
  if (node.contextValue) item.contextValue = node.contextValue;
  if (node.icon && vscode.ThemeIcon) item.iconPath = new vscode.ThemeIcon(node.icon);
  if (node.command) item.command = node.command;
  if (node.kind==='section') item.id='section:'+node.section;
  else if (node.kind==='package') item.id='package:'+node.rootPath;
  else if (node.kind==='group') item.id='group:'+node.packageRoot+':'+node.key;
  else if (node.kind==='file') item.id='file:'+node.uri.toString();
  else if (node.kind==='missing') item.id='missing:'+node.packageRoot+':'+node.groupKey+':'+node.label;
  else item.id=node.kind;
  return item;
}
export function registerPackageOverview(vscode,context,getActiveDocument=()=>null,
  {dependenciesProvider=null,getProjectRoot=()=>null,onPackagesChanged=()=>{}}={}) {
  let packages = [], message = '等待扫描当前 Workspace', inventoryState = 'loading', timer = null, generation = 0;
  const emitter = new vscode.EventEmitter();
  let observedRootSignature = null;
  let treeReads=0;
  const treeReadsByKind={root:0,section:0,package:0,group:0,dependency:0,other:0};
  const fire = () => emitter.fire();
  const notifyPackagesChanged=list=>{
    try{onPackagesChanged([...list]);}
    catch(error){console.warn("SKILL Package language lifecycle notification failed:",
      String(error?.message??error));}
  };
  const skillsSection=()=>({
    kind:'section',section:'skills',label:'Skills',
    description:packages.length+' Skill Package'+(packages.length===1?'':'s'),
    icon:'package',contextValue:'skillStudio.skillsSection'
  });
  const dependenciesSection=()=>({
    kind:'section',section:'dependencies',label:'Dependencies',
    description:'Plugin-managed snapshots and contracts',
    icon:'library',contextValue:'skillStudio.dependenciesSection'
  });
  const decorateDependencyNodes=(items,parentNode=null)=>(items??[]).map(item=>({
    ...item,sourceSection:'dependencies',...(parentNode?{parentNode}:{})
  }));
  const skillsChildren=()=>{
    const summary={
      kind:'summary',label:packages.length+' SKILL Package'+(packages.length===1?'':'s'),
      description:message,icon:'layers',
      tooltip:'文件清点，不代表 SKILL 内容已通过语义校验'
    };
    if(!packages.length){
      const notice=inventoryState==='loading'
        ?{label:'正在读取 Package 文件清单…',description:'项目结构先行显示，文件清点在后台进行'}
        :inventoryState==='no-workspace'
          ?{label:'请先打开 Workspace',description:'然后刷新 Package 清单'}
          :inventoryState==='select-project-root'
            ?{label:'请选择 Project Root',description:'多根工作区需要明确选择项目根目录'}
          :inventoryState==='unavailable'
            ?{label:'Package 清单不可用',description:message}
            :inventoryState==='truncated-empty'
              ?{label:'扫描范围内未发现 SKILL Package',description:'文件数量达到上限，无法判断剩余文件'}
              :{label:'未发现 SKILL Package',description:'需要 SKILL.md 或 assurance/*.yaml'};
      return [summary,{kind:'notice',...notice,icon:'info',
        tooltip:'Package Explorer 只清点文件，不做语义校验'}];
    }
    return [summary,...packages.map(packageNode)];
  };
  const provider = {
    onDidChangeTreeData:emitter.event,
    async getChildren(node) {
      treeReads++;
      const readKind=node?.kind==='package'?'package':
        node?.kind==='group'?'group':node?.kind==='section'?'section':
        node?.sourceSection==='dependencies'?'dependency':
        node?'other':'root';
      treeReadsByKind[readKind]=(treeReadsByKind[readKind]??0)+1;
      if(!node)return [skillsSection(),dependenciesSection()];
      if(node.kind==='section'){
        if(node.section==='skills')return skillsChildren();
        if(node.section==='dependencies'){
          if(!dependenciesProvider)return [{
            kind:'message',text:'Dependency Service unavailable',
            sourceSection:'dependencies'
          }];
          return decorateDependencyNodes(await dependenciesProvider.getChildren());
        }
        return [];
      }
      if(node.sourceSection==='dependencies'){
        if(!dependenciesProvider)return [];
        return decorateDependencyNodes(await dependenciesProvider.getChildren(node),node);
      }
      if(node.kind==='package'){
        const pkg=packages.find(item=>item.rootPath===node.rootPath);
        return pkg?pkg.groups.map(group=>groupNode(pkg,group)):[];
      }
      if(node.kind==='group'){
        const files=node.files.map(file=>{
          const label=basename(file.path);
          const isMarkdown=/\.md$/i.test(file.path);
          return {
            kind:'file',label,description:file.path,uri:file.uri,
            packageRoot:node.packageRoot,groupKey:node.key,
            command:packageFileCommand(file.path,file.uri),
            contextValue:isMarkdown?'skillStudio.packageMarkdown':'skillStudio.packageFile',
            icon:/\.py$/i.test(file.path)?'file-code':
              /\.schema\.ya?ml$/i.test(file.path)?'symbol-structure':
              isMarkdown?'markdown':'file'
          };
        });
        const missing=node.missing.map(path=>({
          kind:'missing',label:'Missing · '+path,description:'Not found in Package',
          packageRoot:node.packageRoot,groupKey:node.key,
          tooltip:'当前文件清单中未发现该核心文件',icon:'warning'
        }));
        return [...missing,...files];
      }
      return [];
    },
    getTreeItem(node){
      if(node.kind==='section')return treeNode(vscode,node);
      if(node.sourceSection==='dependencies')
        return dependenciesProvider?.getTreeItem(node)??treeNode(vscode,{
          ...node,label:node.label??node.text??'Dependency'
        });
      return treeNode(vscode,node);
    },
    // Explicit parent relationships keep TreeView.reveal stable across both
    // authored Skill nodes and Plugin-owned Dependency operation nodes.
    getParent(node){
      if(!node||node.kind==='section')return undefined;
      if(node.sourceSection==='dependencies'){
        if(node.kind==='dependency'||node.kind==='message')return dependenciesSection();
        if(node.kind==='operation')return node.parentNode??dependenciesSection();
      }
      if(node.kind==='package')return skillsSection();
      const pkg=packages.find(item=>item.rootPath===node.packageRoot);
      if(!pkg)return node.kind==='summary'||node.kind==='notice'?skillsSection():undefined;
      if(node.kind==='group')return packageNode(pkg);
      if(node.kind==='file'||node.kind==='missing'){
        const group=pkg.groups.find(item=>item.key===node.groupKey);
        return group?groupNode(pkg,group):packageNode(pkg);
      }
      return undefined;
    }
  };
  // Register the view without programmatically stealing editor focus.
  // The manifest's visibility: visible supplies the first-workspace default;
  // persisted user layout remains authoritative after the first open.
  // Keep a TreeView handle for explicit, focus-free Package reveal actions.
  const treeView = typeof vscode.window.createTreeView==='function'
    ? vscode.window.createTreeView('skillStudio.packages',{
        treeDataProvider:provider,showCollapseAll:true
      })
    : null;
  const treeRegistration = treeView ?? vscode.window.registerTreeDataProvider(
    'skillStudio.packages',provider);
  context.subscriptions.push(emitter,treeRegistration);
  async function refresh() {
    const ticket = ++generation;
    try {
      const activeDocument = getActiveDocument?.();
      const openDocuments = [...(vscode.workspace.textDocuments??[]),
        ...(activeDocument?[activeDocument]:[])];
      const workspaceFolders=vscode.workspace.workspaceFolders??[];
      const selectedRoot=getProjectRoot?.()??null;
      if(workspaceFolders.length>1&&!selectedRoot){
        observedRootSignature='';packages=[];inventoryState='select-project-root';
        message='Multi-root workspace · select a Project Root';
        notifyPackagesChanged(packages);fire();return [];
      }
      const scanFolders=selectedRoot?[{uri:selectedRoot}]:workspaceFolders;
      const roots = packageScanRoots(scanFolders,openDocuments);
      const rootSignature = roots.map(root=>root.toString()).sort().join('\n');
      if (!roots.length) {
        observedRootSignature=rootSignature;
        packages=[];inventoryState='no-workspace';message='请先打开 Workspace 或一个 SKILL 文件';
        notifyPackagesChanged(packages);fire();return [];
      }
      const found = [], seen = new Set();
      for (const root of roots) {
        const remaining = FILE_LIMIT+1-found.length;
        if (remaining <= 0) break;
        // The Package inventory is strictly source-scoped: imported dependency
        // snapshots and generated BuildResults never appear as authored Skills.
        let sourceRoot = null;
        if (vscode.Uri?.joinPath && vscode.workspace.fs?.stat) {
          const candidate = vscode.Uri.joinPath(root,'skills');
          try {
            await vscode.workspace.fs.stat(candidate);
            sourceRoot = candidate;
          } catch(error) {
            if(error?.code!=='FileNotFound')throw error;
          }
        }
        // Theia's OPFS findFiles implementation expects the RelativePattern
        // base URI to be the directory actually traversed. Anchoring a
        // 'skills/**/*' glob at the parent project root can return no files.
        const pattern = new vscode.RelativePattern(sourceRoot??root,'**/*');
        const batch = await vscode.workspace.findFiles(
          pattern,'**/node_modules/**',remaining);
        const sourcePrefix = sourceRoot?.path ? (sourceRoot.path.endsWith('/') ? sourceRoot.path : sourceRoot.path+'/') : null;
        for (const uri of batch) {
          if(sourcePrefix&&!uri.path.startsWith(sourcePrefix))continue;
          const key = uri.toString();
          if (!seen.has(key)) {seen.add(key);found.push(uri);}
        }
      }
      if (ticket !== generation) return packages;
      observedRootSignature=rootSignature;
      const truncated = found.length > FILE_LIMIT;
      const visible = found.slice(0,FILE_LIMIT);
      const dirty = new Set((vscode.workspace.textDocuments??[])
        .filter(doc=>doc.isDirty).map(doc=>doc.uri.path));
      const inventory = buildPackageInventory(visible,dirty,truncated);
      packages = inventory.packages.map(pkg=>{
        let relativeRoot=pkg.rootPath;
        if (pkg.rootUri) {
          try { relativeRoot=vscode.workspace.asRelativePath(pkg.rootUri)||pkg.name; }
          catch { relativeRoot=pkg.name; }
        }
        return {...pkg,relativeRoot};
      });
      inventoryState = packages.length ? 'ready' : inventory.truncated ? 'truncated-empty' : 'empty';
      message = inventory.truncated
        ?'已扫描前 '+inventory.scannedFiles+' 个文件 · 结果可能不完整'
        :inventory.scannedFiles+' 个文件 · 仅清点，不做语义校验';
      notifyPackagesChanged(packages);
      fire();
      return packages;
    } catch(error) {
      if (ticket !== generation) return packages;
      packages=[];inventoryState='unavailable';
      message='Inventory unavailable · '+String(error?.message??error);
      notifyPackagesChanged(packages);
      fire();
      return [];
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer=setTimeout(()=>void refresh(),250);
  }
  // Opening a Source document does not alter the inventory when its scan
  // roots are unchanged. Do not discard expanded native TreeView nodes for
  // a file-open notification (notably when navigating to a second Skill).
  function scheduleIfRootsChanged() {
    const activeDocument=getActiveDocument?.();
    const openDocuments=[...(vscode.workspace.textDocuments??[]),
      ...(activeDocument?[activeDocument]:[])];
    const workspaceFolders=vscode.workspace.workspaceFolders??[];
    const selectedRoot=getProjectRoot?.()??null;
    const roots=workspaceFolders.length>1&&!selectedRoot?[]:
      packageScanRoots(selectedRoot?[{uri:selectedRoot}]:workspaceFolders,openDocuments);
    const signature=roots.map(root=>root.toString()).sort().join('\n');
    if(signature!==observedRootSignature)schedule();
  }
  function refreshDirty() {
    const dirty = new Set((vscode.workspace.textDocuments??[])
      .filter(doc=>doc.isDirty).map(doc=>doc.uri.path));
    const next=packages.map(pkg=>({...pkg,
      dirtyCount:pkg.files.filter(file=>dirty.has(file.uri.path)).length
    }));
    // Avoid a root tree refresh when only the document contents changed.
    if(next.some((pkg,index)=>pkg.dirtyCount!==packages[index].dirtyCount)){
      packages=next;
      fire();
    }
  }
  const subscriptions = [
    vscode.commands.registerCommand('skillStudio.refreshPackages',async()=>{
      const result=await refresh();
      return {
        state:inventoryState,message,treeReads,treeReadsByKind,
        packages:result.map(pkg=>({
          name:pkg.name,relativeRoot:pkg.relativeRoot,
          fileCount:pkg.fileCount,corePresent:pkg.corePresent,
          groups:pkg.groups.map(group=>({key:group.key,count:group.files.length,
            missing:group.missing}))
        }))
      };
    }),
    vscode.workspace.onDidChangeWorkspaceFolders?.(schedule),
    vscode.workspace.onDidCreateFiles?.(schedule),
    vscode.workspace.onDidDeleteFiles?.(schedule),
    vscode.workspace.onDidRenameFiles?.(schedule),
    vscode.workspace.onDidOpenTextDocument?.(scheduleIfRootsChanged),
    vscode.workspace.onDidCloseTextDocument?.(scheduleIfRootsChanged),
    vscode.workspace.onDidChangeTextDocument?.(refreshDirty),
    vscode.workspace.onDidSaveTextDocument?.(refreshDirty),
    {dispose(){clearTimeout(timer);generation++;}}
  ].filter(Boolean);
  context.subscriptions.push(...subscriptions);
  const dependencyChanged=dependenciesProvider?.onDidChangeTreeData?.(()=>fire());
  if(dependencyChanged)context.subscriptions.push(dependencyChanged);
  async function revealPackages(){
    const list=await refresh();
    if(!treeView?.reveal)return false;
    for(const pkg of list){
      await treeView.reveal(packageNode(pkg),{
        expand:1,focus:false,select:false
      });
    }
    return list.length>0;
  }
  void refresh();
  return {refresh,revealPackages,
    dispose(){clearTimeout(timer);generation++;emitter.dispose?.();}};
}
