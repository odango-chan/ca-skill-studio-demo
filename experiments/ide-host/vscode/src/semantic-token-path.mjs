function normalizePath(value){
  return typeof value==="string"
    ?value.replace(/\\/g,"/").replace(/^\\/+/, "")
    :"";
}

/**
 * Resolve a stable semantic-token path for the current document.
 *
 * Theia may return only a basename from workspace.asRelativePath when a
 * persisted workspace root is narrower than the Package. CA-SL source
 * classification needs the Package-relative assurance/ or lib/ path.
 */
export function resolveSemanticTokenSourcePath(uriPath,workspaceRelativePath=""){
  const uri=normalizePath(uriPath);
  const workspace=normalizePath(workspaceRelativePath);
  const packageMatch=uri.match(/(?:^|\\/)(assurance\\/(?:procedure|contract|predicates)\\.ya?ml)$/i);
  if(packageMatch)return packageMatch[1];

  const libraryMatch=uri.startsWith("lib/")
    ?uri
    :uri.includes("/lib/")?uri.slice(uri.lastIndexOf("/lib/")+1):"";
  if(libraryMatch)return libraryMatch;

  return workspace||uri;
}
