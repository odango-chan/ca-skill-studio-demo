// Own one persistent Language Service reference for every discovered Skill
// Package. Designer editors may acquire additional references, but project
// diagnostics no longer depend on opening a particular CustomEditor.
export function createPackageLanguageLifecycle({
  openTextDocument,
  attach,
  onError=()=>{}
}={}){
  if(typeof openTextDocument!=="function"||typeof attach!=="function")
    throw new TypeError("Package Language lifecycle requires openTextDocument and attach");
  const desired=new Map();
  const releases=new Map();
  const pending=new Map();
  let disposed=false;

  function sync(packages=[]){
    if(disposed)return;
    const next=new Map();
    for(const pkg of packages??[]){
      const procedure=pkg.files?.find(file=>file.path==="assurance/procedure.yaml");
      if(procedure?.uri?.toString)next.set(procedure.uri.toString(),procedure.uri);
    }
    for(const [key,release] of releases){
      if(next.has(key))continue;
      releases.delete(key);
      release();
    }
    for(const key of pending.keys())
      if(!next.has(key))pending.delete(key);
    desired.clear();
    for(const [key,uri] of next)desired.set(key,uri);

    for(const [key,uri] of next){
      if(releases.has(key)||pending.has(key))continue;
      const ticket={};
      pending.set(key,ticket);
      void Promise.resolve().then(()=>openTextDocument(uri)).then(document=>{
        if(disposed||pending.get(key)!==ticket||!desired.has(key))return;
        pending.delete(key);
        const release=attach(document);
        if(!disposed&&desired.has(key))releases.set(key,release);
        else release();
      }).catch(error=>{
        if(pending.get(key)===ticket)pending.delete(key);
        if(!disposed)onError(key,error);
      });
    }
  }

  function dispose(){
    if(disposed)return;
    disposed=true;
    desired.clear();
    pending.clear();
    for(const release of releases.values())release();
    releases.clear();
  }

  function snapshot(){
    return {desired:[...desired.keys()],attached:[...releases.keys()],
      pending:[...pending.keys()],disposed};
  }
  return {sync,dispose,snapshot};
}
