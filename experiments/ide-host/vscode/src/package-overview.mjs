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

function treeNode(vscode, node) {
  const collapsible = node.kind === 'package' || node.kind === 'group'
    ? vscode.TreeItemCollapsibleState.Collapsed
    : vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(node.label,collapsible);
  if (node.description) item.description = node.description;
  if (node.tooltip) item.tooltip = node.tooltip;
  if (node.contextValue) item.contextValue = node.contextValue;
  if (node.icon && vscode.ThemeIcon) item.iconPath = new vscode.ThemeIcon(node.icon);
  if (node.command) item.command = node.command;
  if (node.kind==='package') item.id='package:'+node.rootPath;
  else if (node.kind==='group') item.id='group:'+node.packageRoot+':'+node.key;
  else if (node.kind==='file') item.id='file:'+node.uri.toString();
  else if (node.kind==='missing') item.id='missing:'+node.label;
  else item.id=node.kind;
  return item;
}
export function registerPackageOverview(vscode,context,getActiveDocument=()=>null) {
  let packages = [], message = '等待扫描当前 Workspace', inventoryState = 'loading', timer = null, generation = 0;
  const emitter = new vscode.EventEmitter();
  let treeReads=0;
  const fire = () => emitter.fire();
  const provider = {
    onDidChangeTreeData:emitter.event,
    getChildren(node) {
      treeReads++;
      if (!node) {
        const summary = {
          kind:'summary',label:packages.length+' SKILL Package'+(packages.length===1?'':'s'),
          description:message,icon:'layers',tooltip:'文件清点，不代表 SKILL 内容已通过语义校验'
        };
        if (!packages.length) {
          const notice = inventoryState === 'no-workspace'
            ? {label:'请先打开 Workspace',description:'然后刷新 Package 清单'}
            : inventoryState === 'unavailable'
              ? {label:'Package 清单不可用',description:message}
              : inventoryState === 'truncated-empty'
                ? {label:'扫描范围内未发现 SKILL Package',description:'文件数量达到上限，无法判断剩余文件'}
                : {label:'未发现 SKILL Package',description:'需要 SKILL.md 或 assurance/*.yaml'};
          return [summary,{kind:'notice',...notice,icon:'info',
            tooltip:'Package Overview 只清点文件，不做语义校验'}];
        }
        return [summary,...packages.map(pkg=>({
          ...pkg,kind:'package',
          label:pkg.name,
          description:(pkg.relativeRoot??pkg.rootPath)+' · '+
            pkg.corePresent+'/'+pkg.coreTotal+' core · '+pkg.fileCount+' files'+
            (pkg.dirtyCount?' · '+pkg.dirtyCount+' modified':''),
          tooltip:'Package 文件清点；不代表内容校验或 Runtime 资格。'+
            (pkg.incomplete?' 缺少：'+[...(!pkg.hasSkillMd?['SKILL.md']:[]),...pkg.missingCore].join(', '):''),
          icon:pkg.incomplete?'warning':'package'
        }))];
      }
      if (node.kind === 'package') return node.groups.map(group=>({
        ...group,kind:'group',packageRoot:node.rootPath,
        label:group.label,description:group.missing.length?'缺少 '+group.missing.length+' 个文件':undefined
      }));
      if (node.kind === 'group') {
        const files = node.files.map(file=>{
          const label = basename(file.path);
          const isMarkdown = /\.md$/i.test(file.path);
          return {
            kind:'file',label,description:file.path,uri:file.uri,
            command:packageFileCommand(file.path,file.uri),
            contextValue:isMarkdown?'skillStudio.packageMarkdown':'skillStudio.packageFile',
            icon:/\.py$/i.test(file.path)?'file-code':
              /\.schema\.ya?ml$/i.test(file.path)?'symbol-structure':
              isMarkdown?'markdown':'file'
          };
        });
        const missing = node.missing.map(path=>({
          kind:'missing',label:'Missing · '+path,description:'Not found in Package',
          tooltip:'当前文件清单中未发现该核心文件',icon:'warning'
        }));
        return [...missing,...files];
      }
      return [];
    },
    getTreeItem(node) {
      return treeNode(vscode,node);
    }
  };
  // Theia's browser host can defer a contributed TreeView until its view
  // container is activated. createTreeView eagerly owns the view lifecycle;
  // registerTreeDataProvider alone left the Packages welcome page visible and
  // never asked the provider for its first root children in real Chromium.
  const treeView = vscode.window.createTreeView
    ? vscode.window.createTreeView('skillStudio.packages',{
        treeDataProvider:provider,showCollapseAll:true
      })
    : null;
  const treeRegistration = treeView ??
    vscode.window.registerTreeDataProvider('skillStudio.packages',provider);
  context.subscriptions.push(emitter,treeRegistration);
  async function refresh() {
    const ticket = ++generation;
    try {
      const activeDocument = getActiveDocument?.();
      const openDocuments = [...(vscode.workspace.textDocuments??[]),
        ...(activeDocument?[activeDocument]:[])];
      const roots = packageScanRoots(vscode.workspace.workspaceFolders??[],openDocuments);
      if (!roots.length) {
        packages=[];inventoryState='no-workspace';message='请先打开 Workspace 或一个 SKILL 文件';fire();return [];
      }
      const found = [], seen = new Set();
      for (const root of roots) {
        const remaining = FILE_LIMIT+1-found.length;
        if (remaining <= 0) break;
        const pattern = new vscode.RelativePattern(root,'**/*');
        const batch = await vscode.workspace.findFiles(
          pattern,'**/node_modules/**',remaining);
        for (const uri of batch) {
          const key = uri.toString();
          if (!seen.has(key)) {seen.add(key);found.push(uri);}
        }
      }
      if (ticket !== generation) return packages;
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
      fire();
      // Force the first Package row into the native TreeView. This is a
      // presentation refresh only; it does not expand child groups or steal
      // editor focus.
      if (packages.length && treeView?.reveal) {
        const first = packages[0];
        try {
          await treeView.reveal({
            ...first,kind:'package',label:first.name,
            description:first.relativeRoot+' · '+first.corePresent+'/'+
              first.coreTotal+' core · '+first.fileCount+' files'
          },{select:false,focus:false,expand:0});
        } catch {
          // A view can be disposed while workspace scanning is in flight.
        }
      }
      return packages;
    } catch(error) {
      if (ticket !== generation) return packages;
      packages=[];inventoryState='unavailable';
      message='Inventory unavailable · '+String(error?.message??error);
      fire();
      return [];
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer=setTimeout(()=>void refresh(),250);
  }
  function refreshDirty() {
    const dirty = new Set((vscode.workspace.textDocuments??[])
      .filter(doc=>doc.isDirty).map(doc=>doc.uri.path));
    packages=packages.map(pkg=>({...pkg,
      dirtyCount:pkg.files.filter(file=>dirty.has(file.uri.path)).length
    }));
    fire();
  }
  const subscriptions = [
    vscode.commands.registerCommand('skillStudio.refreshPackages',async()=>{
      const result=await refresh();
      return {
        state:inventoryState,message,treeReads,
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
    vscode.workspace.onDidOpenTextDocument?.(schedule),
    vscode.workspace.onDidCloseTextDocument?.(schedule),
    vscode.workspace.onDidChangeTextDocument?.(refreshDirty),
    vscode.workspace.onDidSaveTextDocument?.(refreshDirty),
    {dispose(){clearTimeout(timer);generation++;}}
  ].filter(Boolean);
  context.subscriptions.push(...subscriptions);
  void refresh();
  return {refresh,dispose(){clearTimeout(timer);generation++;emitter.dispose?.();}};
}
