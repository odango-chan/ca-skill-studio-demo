import test from 'node:test';
import assert from 'node:assert/strict';
import {registerContractEditor} from '../experiments/ide-host/vscode/src/contract-editor.mjs';

const contract = [
  'apiVersion: connectionagent.io/v1alpha1',
  'kind: SkillContract',
  'metadata:',
  '  name: browser-contract-test',
  'spec:',
  '  skillType: executable',
  '  goal: demo.ready',
  '  entryProcedure: begin',
  '  allowedResources:',
  '    capabilities: [tool.read]',
  '    localTools: [skill.lookup]',
  '  postconditions:',
  '  - predicate: demo.done',
  '    expect: PASS',
  '  planning:',
  '    maxActions: 8',
  '    allowDynamicProcedure: false',
  ''
].join('\n');

test('Contract custom editor registers independently and renders a nonce-protected read-only view', async () => {
  const registrations = new Map();
  const commands = new Map();
  const context = {subscriptions: []};
  const vscode = {
    window: {
      registerCustomEditorProvider: (view, provider, options) => {
        registrations.set(view, {provider, options});
        return {dispose() {}};
      },
    },
    commands: {
      registerCommand: (name, handler) => {
        commands.set(name, handler);
        return {dispose() {}};
      }
    },
    workspace: {
      onDidChangeTextDocument: handler => {
        changeHandler = handler;
        return {dispose() {}};
      }
    }
  };
  let changeHandler, messageHandler, disposeHandler;
  registerContractEditor(vscode, context);
  assert.ok(registrations.has('skillStudio.contractPreview'));
  assert.ok(commands.has('skillStudio.openContract'));
  assert.equal(registrations.get('skillStudio.contractPreview').options.webviewOptions.retainContextWhenHidden, true);

  let text = contract;
  const uri = {path: '/workspace/demo/assurance/contract.yaml',
    toString: () => 'file:///workspace/demo/assurance/contract.yaml'};
  const document = {uri, version: 1, lineCount: contract.split('\n').length,
    getText: () => text};
  const messages = [];
  const webview = {
    options: null, html: '',
    postMessage: async message => {messages.push(message);return true;},
    onDidReceiveMessage: handler => {messageHandler = handler;return {dispose(){}};}
  };
  const panel = {webview, onDidDispose: handler => {disposeHandler = handler;}};
  await registrations.get('skillStudio.contractPreview').provider
    .resolveCustomTextEditor(document, panel);

  assert.equal(webview.options.enableScripts, true);
  assert.equal(webview.options.localResourceRoots.length, 0);
  assert.match(webview.html, /Contract Designer/);
  assert.match(webview.html, /Content-Security-Policy/);
  assert.doesNotMatch(webview.html, /unsafe-inline|https?:\/\//);
  assert.match(webview.html, /打开 YAML Source/);

  await messageHandler({type: 'ready'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).type, 'snapshot');
  assert.equal(messages.at(-1).projection.state, 'READY');
  assert.equal(messages.at(-1).projection.name.value, 'browser-contract-test');

  text = contract.replace('goal: demo.ready', 'goal: demo.updated');
  document.version = 2;
  changeHandler({document});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).version, 2);
  assert.equal(messages.at(-1).projection.goal.value, 'demo.updated');

  await messageHandler({type: 'openSource', version: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message.type === 'error' &&
    message.message.includes('Source 已变化')));

  disposeHandler();
});
