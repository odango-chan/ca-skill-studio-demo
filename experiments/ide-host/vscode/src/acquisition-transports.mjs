// Browser-safe host acquisition transports. Network errors are BLOCKED;
// discovery never sends tools/call and credentials never enter project settings.
import {decodeBase64} from "./dependency-snapshot.mjs";
const fail=(message)=>{throw Error("Host acquisition BLOCKED: "+message);};
const jsonResponse=async response=>{
  if(!response.ok)fail("HTTP "+response.status);
  const type=response.headers.get("content-type")??"";
  const text=await response.text();
  if(type.includes("text/event-stream")){
    const messages=text.split(/\r?\n/).filter(line=>line.startsWith("data:"))
      .map(line=>line.slice(5).trim()).filter(x=>x&&x!=="[DONE]");
    if(!messages.length)fail("MCP SSE response has no JSON payload");
    return JSON.parse(messages.at(-1));
  }
  if(!type.includes("json"))fail("expected JSON or MCP SSE response");
  return JSON.parse(text);
};
export async function readGitHubPinnedFile({
  repository,path,ref,token,fetchImpl=globalThis.fetch
}){
  if(typeof fetchImpl!=="function")fail("network fetch unavailable");
  const url=new URL(repository);
  const parts=url.pathname.replace(/\.git$/,"").split("/").filter(Boolean);
  if(url.protocol!=="https:"||url.hostname!=="github.com"||parts.length!==2||
     !parts.every(s=>/^[A-Za-z0-9_.-]+$/.test(s))||
     !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||
     !ref||typeof ref!=="string")
    fail("Git v0.1 browser adapter supports github.com HTTPS owner/repo + safe file path");
  const base="https://api.github.com/repos/"+parts.join("/");
  const headers={"Accept":"application/vnd.github+json",
    ...(token?{Authorization:"Bearer "+token}:{})};
  const request=async url=>{
    let response;
    try{response=await fetchImpl(url,{headers,credentials:"omit"});}
    catch(error){fail("GitHub fetch failed (CORS/network/auth): "+String(error?.message??error));}
    return jsonResponse(response);
  };
  const commit=await request(base+"/commits/"+encodeURIComponent(ref));
  if(!/^[a-f0-9]{40}$/.test(commit?.sha??""))
    fail("Git ref did not resolve to full commit SHA");
  const segments=path.split("/");
  if(segments.some(s=>s==="."||s===".."))fail("unsafe Git path");
  const file=await request(base+"/contents/"+segments.map(encodeURIComponent).join("/")+
    "?ref="+commit.sha);
  if(file.type!=="file"||file.encoding!=="base64"||typeof file.content!=="string")
    fail("Git dependency must be a bounded file, not directory/LFS");
  const bytes=decodeBase64(file.content.replace(/\s/g,""));
  if(bytes.byteLength>2097152)fail("Git contract exceeds Compiler file size limit");
  return {commit:commit.sha,bytes};
}
export async function discoverMcpHttpTools({
  endpoint,token,fetchImpl=globalThis.fetch
}){
  if(typeof fetchImpl!=="function")fail("network fetch unavailable");
  let url;
  try{url=new URL(endpoint);}catch{fail("invalid MCP endpoint URL");}
  if(url.username||url.password||url.hash)fail("no embedded MCP credentials in URL");
  if(url.protocol!=="https:"&&!(url.protocol==="http:"&&
     ["localhost","127.0.0.1"].includes(url.hostname)))
    fail("MCP requires HTTPS or explicit local host");
  let serial=0,session=null;
  async function rpc(method,params={},notification=false){
    const id=notification?undefined:++serial;
    const body=JSON.stringify({jsonrpc:"2.0",...(id?{id}:{}),method,params});
    let response;
    try{
      response=await fetchImpl(url.href,{method:"POST",mode:"cors",credentials:"omit",
        headers:{"Content-Type":"application/json",
          Accept:"application/json, text/event-stream",
          ...(session?{"Mcp-Session-Id":session}:{}),
          ...(token?{Authorization:"Bearer "+token}:{})},
        body});
    }catch(error){
      fail("MCP CORS/network/authorization unavailable: "+String(error?.message??error));
    }
    if(!response.ok)fail("MCP "+method+" HTTP "+response.status);
    const returnedSession=response.headers.get("mcp-session-id");
    if(returnedSession)session=returnedSession;
    if(notification)return null;
    const data=await jsonResponse(response);
    if(data.id!==id||data.jsonrpc!=="2.0"||data.error)
      fail("MCP "+method+" JSON-RPC error or unmatched response");
    return data.result;
  }
  const initialized=await rpc("initialize",{
    protocolVersion:"2025-06-18",capabilities:{},
    clientInfo:{name:"Skill Studio",version:"0.1.0"}});
  if(!initialized?.protocolVersion)fail("MCP initialize handshake failed");
  await rpc("notifications/initialized",{},true);
  let cursor,tools=[],pages=0;
  do{
    const result=await rpc("tools/list",cursor?{cursor}:{});
    if(!Array.isArray(result?.tools))fail("MCP tools/list returned no tool array");
    tools.push(...result.tools);
    if(tools.length>128)fail("MCP tool catalog exceeds 128 selection limit");
    cursor=result.nextCursor;
    if(++pages>20)fail("MCP tools/list pagination exceeded 20 pages");
  }while(cursor);
  return tools;
}
