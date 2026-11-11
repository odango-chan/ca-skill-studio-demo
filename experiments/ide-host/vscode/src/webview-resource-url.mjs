// Browser-only Theia serves hostedPlugin files below the Pages base path,
// while asWebviewUri() can emit a root-absolute URL. Keep the correction
// restricted to the same-origin static plugin worker. Desktop VS Code and
// backend-backed Theia keep their original host-generated resource URLs.
export function staticPreviewResourceUrl(uri,extensionUri,location=globalThis.location){
  const value=uri.toString();
  const path=location?.pathname??"";
  if(!path.endsWith("/plugin-worker.js")||
     (extensionUri.scheme!=="http"&&extensionUri.scheme!=="https"))
    return value;
  const base=path.slice(0,-"/plugin-worker.js".length);
  if(!base)return value;
  try{
    const origin=location.origin;
    const parsed=new URL(value,origin);
    if(parsed.origin!==origin||!parsed.pathname.startsWith("/hostedPlugin/"))
      return value;
    return base+parsed.pathname+parsed.search+parsed.hash;
  }catch{return value;}
}
