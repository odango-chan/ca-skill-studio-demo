import test from 'node:test';
import assert from 'node:assert/strict';
import {openNativeSource} from '../vscode/src/native-source.mjs';
test('VS Code explicit Source uses its public default editor ID',async()=>{
  const calls=[];const api={env:{uriScheme:'vscode'},commands:{executeCommand:async(...args)=>calls.push(args)}};
  const uri={path:'/workspace/assurance/procedure.yaml'};
  await openNativeSource(api,uri,{preview:false});
  assert.equal(calls.length,1);assert.equal(calls[0][2],'default');assert.equal(calls[0][1],uri);
});
test('Backend Theia Node entry selects preview text opener and supports hosts without preview module',async()=>{
  const views=[];let absent=false;
  const api={env:{uriScheme:'theia'},commands:{executeCommand:async(_command,_uri,view)=>{
    views.push(view);if(absent&&view==='editor-preview-widget')throw Error("Could not find an editor for 'editor-preview-widget'");
  }}};
  await openNativeSource(api,{},{});assert.deepEqual(views,['editor-preview-widget']);
  views.length=0;absent=true;await openNativeSource(api,{},{});
  assert.deepEqual(views,['editor-preview-widget','code-editor-opener']);
});
test('Source open reports real host failure and does not retry unrelated errors',async()=>{
  let calls=0,shown='';const api={env:{uriScheme:'theia'},
    commands:{executeCommand:async()=>{calls++;throw Error('Read permission denied');}},
    window:{showErrorMessage:async value=>{shown=value;}}};
  await assert.rejects(openNativeSource(api,{},{}),/Read permission denied/);
  assert.equal(calls,1);assert.match(shown,/Read permission denied/);
});
