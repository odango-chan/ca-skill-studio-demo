import test from 'node:test';
import assert from 'node:assert/strict';
import {registerPredicateEditor} from '../experiments/ide-host/vscode/src/predicate-editor.mjs';

const source = [
  'apiVersion: connectionagent.io/v1alpha1',
  'kind: PredicateSet',
  'metadata:',
  '  skill: browser-predicate-test',
  'predicates:',
  '  session.ready:',
  '    observations:',
  '      state:',
  '        ref: session.context',
  '        scope: request.sessionRef',
  '        freshness: 5s',
  '    evaluator:',
  '      type: cel',
  '      expression: observations.state.status == "READY"',
  ''
].join('\n');

test('Predicate custom editor registers independently and refreshes from current Source', async () => {
  const registrations = new Map();
  const commands = new Map();
  const context = {subscriptions: []};
  let changeHandler, messageHandler, disposeHandler;
  const vscode = {
    window: {
      registerCustomEditorProvider: (view, provider, options) => {
        registrations.set(view, {provider, options});
        return {dispose() {}};
      }
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
  registerPredicateEditor(vscode, context);
  assert.ok(registrations.has('skillStudio.predicatePreview'));
  assert.ok(commands.has('skillStudio.openPredicates'));
  assert.equal(registrations.get('skillStudio.predicatePreview')
    .options.webviewOptions.retainContextWhenHidden, true);

  let text = source;
  const uri = {path: '/workspace/demo/assurance/predicates.yaml',
    toString: () => 'file:///workspace/demo/assurance/predicates.yaml'};
  const document = {uri, version: 1, lineCount: source.split('\n').length,
    getText: () => text};
  const messages = [];
  const webview = {
    options: null, html: '',
    postMessage: async message => {messages.push(message);return true;},
    onDidReceiveMessage: handler => {messageHandler = handler;return {dispose(){}};}
  };
  const panel = {webview, onDidDispose: handler => {disposeHandler = handler;}};
  await registrations.get('skillStudio.predicatePreview').provider
    .resolveCustomTextEditor(document, panel);

  assert.equal(webview.options.enableScripts, true);
  assert.equal(webview.options.localResourceRoots.length, 0);
  assert.match(webview.html, /Predicate Designer/);
  assert.match(webview.html, /Observation → Evaluator/);
  assert.match(webview.html, /Content-Security-Policy/);
  assert.doesNotMatch(webview.html, /unsafe-inline|https?:\/\//);

  await messageHandler({type: 'ready'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).type, 'snapshot');
  assert.equal(messages.at(-1).projection.state, 'READY');
  assert.equal(messages.at(-1).projection.predicateCount, 1);

  text = source.replace('status == "READY"', 'status == "ACCEPTED"');
  document.version = 2;
  changeHandler({document});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).version, 2);
  assert.match(messages.at(-1).projection.predicates[0].evaluator.expression.value,
    /ACCEPTED/);

  await messageHandler({type: 'revealLine', value: 8, version: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message.type === 'error' &&
    message.message.includes('Source 已变化')));

  disposeHandler();
});
