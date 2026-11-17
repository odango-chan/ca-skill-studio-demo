import test from 'node:test';
import assert from 'node:assert/strict';
import {registerPredicateEditor} from '../experiments/ide-host/vscode/src/predicate-editor.mjs';

const source = [
  '# CA-SL v1alpha4 PredicateSet',
  'predicates:',
  '  session.ready:',
  '    parameters:',
  '      - supi: string',
  '      - pduSessionId: integer',
  '    evidence:',
  '      requires:',
  '        supi: [ca::evidence.ue-identity]',
  '    evaluator:',
  '      type: cel',
  '      expression: supi != "" && pduSessionId > 0',
  '  session.persisted:',
  '    parameters:',
  '      - session: ca::schemas:session-result:v1',
  '    evaluator:',
  '      type: script',
  '      script: scripts/validate-session.py',
  ''
].join('\n');

test('Predicate custom editor renders v1alpha4 Parameters, Evidence and Evaluator', async () => {
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
    toString: () => 'file:///workspace/demo/assurance/predicates.yaml',
    with: value => ({path: value.path, toString: () => 'file:///workspace/demo/' + value.path.split('/').slice(-1)[0]})};
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
  assert.match(webview.html, /Parameters → Evidence → Evaluator/);
  assert.match(webview.html, /Content-Security-Policy/);
  assert.doesNotMatch(webview.html, /unsafe-inline|https?:\/\//);

  await messageHandler({type: 'ready'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).type, 'snapshot');
  assert.equal(messages.at(-1).projection.state, 'READY');
  assert.equal(messages.at(-1).projection.language, 'CA-SL v1alpha4');
  assert.equal(messages.at(-1).projection.skill.value, 'demo');
  assert.equal(messages.at(-1).projection.predicateCount, 2);
  assert.deepEqual(messages.at(-1).projection.predicates[0].parameters
    .map(item => [item.name, item.type]), [['supi', 'string'], ['pduSessionId', 'integer']]);
  assert.equal(messages.at(-1).projection.predicates[0].evidence[0]
    .guarantees[0].value, 'ca::evidence.ue-identity');
  assert.equal(messages.at(-1).projection.predicates[1].evaluator.script.value,
    'scripts/validate-session.py');

  text = source.replace('pduSessionId > 0', 'pduSessionId >= 1');
  document.version = 2;
  changeHandler({document});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages.at(-1).version, 2);
  assert.match(messages.at(-1).projection.predicates[0].evaluator.expression.value,
    /pduSessionId >= 1/);

  await messageHandler({type: 'revealLine', value: 8, version: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message.type === 'error' &&
    message.message.includes('Source 已变化')));

  disposeHandler();
});
