import test from 'node:test';
import assert from 'node:assert/strict';
import {base64Bytes} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {pickBrowserInterfaceZip,MAX_BROWSER_INTERFACE_ZIP_BYTES}
  from '../experiments/ide-host/vscode/src/interface-upload-webview.mjs';

function fixture(){
  let receiver,disposedCallback;
  const messages=[];
  const panel={
    closed:false,webview:{
      html:'',
      onDidReceiveMessage(fn){receiver=fn;return {dispose(){}};},
      postMessage(message){messages.push(message);return Promise.resolve(true);}
    },
    onDidDispose(fn){disposedCallback=fn;return {dispose(){}};},
    dispose(){this.closed=true;disposedCallback?.();}
  };
  const vscode={ViewColumn:{One:1},window:{
    createWebviewPanel(type,title,column,options){
      assert.equal(type,'skillStudio.interfacePackageUpload');
      assert.equal(column,1);
      assert.equal(options.enableScripts,true);
      return panel;
    }
  }};
  return {vscode,panel,messages,emit:message=>receiver(message)};
}
test('browser device picker uses a nonce CSP and bounded, acknowledged ZIP chunks',async()=>{
  const m=fixture(),bytes=Uint8Array.from({length:245},(_,i)=>i%256);
  const selected=pickBrowserInterfaceZip(m.vscode);
  assert.match(m.panel.webview.html,/type="file"/);
  assert.match(m.panel.webview.html,/script-src 'nonce-[a-f0-9]{32}'/);
  assert.match(m.panel.webview.html,/default-src 'none'/);
  assert.doesNotMatch(m.panel.webview.html,/https:\/\/api\.github\.com/);
  m.emit({type:'start',name:'interface.zip',size:bytes.length});
  assert.deepEqual(m.messages.at(-1),{type:'ack',offset:0});
  m.emit({type:'chunk',offset:0,base64:base64Bytes(bytes.subarray(0,100))});
  assert.deepEqual(m.messages.at(-1),{type:'ack',offset:100});
  m.emit({type:'chunk',offset:100,base64:base64Bytes(bytes.subarray(100))});
  assert.deepEqual(m.messages.at(-1),{type:'ack',offset:245});
  m.emit({type:'done'});
  const result=await selected;
  assert.equal(result.name,'interface.zip');
  assert.deepEqual(result.bytes,bytes);
  assert.equal(m.panel.closed,true);
});
test('oversize or out-of-order data is blocked and cannot resolve a successful upload',async()=>{
  const m=fixture(),chosen=pickBrowserInterfaceZip(m.vscode);
  m.emit({type:'start',name:'interface.zip',size:MAX_BROWSER_INTERFACE_ZIP_BYTES+1});
  assert.equal(m.messages.at(-1).type,'error');
  m.emit({type:'start',name:'interface.zip',size:32});
  m.emit({type:'chunk',offset:1,base64:base64Bytes(new Uint8Array(10))});
  assert.equal(m.messages.at(-1).type,'error');
  m.emit({type:'done'});
  assert.equal(m.messages.at(-1).type,'error');
  m.emit({type:'cancel'});
  assert.equal(await chosen,null);
});
test('closing the browser upload view is cancellation, never an imported ZIP',async()=>{
  const m=fixture(),chosen=pickBrowserInterfaceZip(m.vscode);
  m.panel.dispose();
  assert.equal(await chosen,null);
});
test('a host without the webview API can use its native workspace file picker',async()=>{
  assert.equal(await pickBrowserInterfaceZip({window:{}}),undefined);
});
