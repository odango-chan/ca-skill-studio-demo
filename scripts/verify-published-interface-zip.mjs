// Opt-in real-release acceptance: pass the exact downloaded ZIP as argv[2].
// This is intentionally separate from all synthetic/fixture ZIP unit tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {decodeInterfacePackageZip}
  from '../experiments/ide-host/vscode/src/interface-package-zip.mjs';
import {base64Bytes} from '../experiments/ide-host/vscode/src/dependency-snapshot.mjs';
import {projectLockedInterfaceCompletionHints}
  from '../experiments/ide-host/vscode/src/interface-schema-completion.mjs';
import {schemaArgumentCompletions}
  from '../language/schema-argument-completions.mjs';
import {schemaValuePathCompletions}
  from '../language/schema-value-path-completions.mjs';

const name=process.argv[2];
if(!name)throw Error('Usage: node scripts/verify-published-interface-zip.mjs <exact published zip>');
const bytes=readFileSync(name);
const expected='sha256:cbd8fad939844cda5474f33f18d3cdc015c69dd8c1dc3908e84bd5273ce6e71b';
assert.equal(await sha256(bytes),expected,'released ZIP has changed');
const packageData=await decodeInterfacePackageZip(bytes);
assert.equal(packageData.manifest.apiVersion,'connectionagent.io/interface-package/v1alpha1');
assert.equal(packageData.manifest.languageTarget,'connectionagent.io/v1alpha5');
assert.equal(packageData.manifest.version,'1.1.0');
assert.equal(packageData.manifest.exports.filter(x=>x.kind==='CallableCatalog').length,11);
assert.equal(packageData.manifest.exports.filter(x=>x.kind==='CapabilityCatalog').length,2);
assert.equal(packageData.manifest.exports.filter(x=>x.kind==='Schema').length,4);
const hints=projectLockedInterfaceCompletionHints({
  id:'ca-client',kind:'interface-package',
  files:packageData.files.map(file=>({
    path:file.path,bytes:base64Bytes(file.bytes)
  }))
});
assert.ok(hints.length>0,'released public ToolCatalog/Schema must yield input hints');
const contextRead=hints.find(item=>item.argumentProperties.some(p=>
  p.name==='supi')&&item.argumentProperties.some(p=>p.name==='pduSessionId'));
assert.ok(contextRead,'released context query Schema should declare SUPI/PSI keys');
assert.ok(contextRead.argumentProperties.some(p=>p.name==='supi'&&p.required));
assert.ok(Array.isArray(contextRead.outputProperties)&&
  contextRead.outputProperties.some(p=>p.name==='status'),
  'released output Schema must provide the read-result status path');
// Drive the same source-only completion functions used by the current LSP,
// from the actual published ToolCatalog + immutable Schema bytes. This is not
// a Browser/UI assertion; the native Theia Worker has its own Chromium gate.
const source=[
  'start: read',
  'nodes:',
  '  read:',
  '    '+contextRead.kind+':',
  '      tool: '+contextRead.id,
  '      arguments:',
  '        ',
  '      routes:',
  '        SUCCEEDED: use',
  '  use:',
  '    operation:',
  '      tool: ca-client::unqualified.consumer',
  '      arguments:',
  '        data: read.'+contextRead.kind+'.output.',
  '      routes:',
  '        FAILED: FAILED',
  ''
].join('\n');
const snapshot={
  completeness:'complete',schemaCompletionHints:hints,documents:[]
};
const document={relativePath:'assurance/procedure.yaml',text:source};
const position=(needle)=>{
  const start=source.indexOf(needle);
  assert.ok(start>=0,'completion probe source anchor must exist');
  const offset=start+needle.length;
  const line=source.slice(0,offset).split('\n').length-1;
  return {offset,line,lineStart:source.lastIndexOf('\n',offset-1)+1};
};
const keys=position('      arguments:\n        ');
const fields=schemaArgumentCompletions(snapshot,document,'        ',
  keys.offset,keys.lineStart,keys.line);
assert.ok(fields.some(x=>x.label==='supi'&&x.textEdit.newText==='supi: '),
  'real released Tool query Schema must complete supi');
assert.ok(fields.some(x=>x.label==='pduSessionId'),
  'real released Tool query Schema must complete pduSessionId');
const outputAnchor='        data: read.'+contextRead.kind+'.output.';
const at=position(outputAnchor);
const output=schemaValuePathCompletions(snapshot,document,outputAnchor,
  at.offset,at.lineStart,at.line);
assert.ok(output?.some(x=>x.label==='status'),
  'real released Tool output Schema must complete status along a dominating route');
console.log('PUBLISHED_INTERFACE_ZIP_PASS',JSON.stringify({
  sha256:expected,packageId:packageData.manifest.packageId,
  version:packageData.manifest.version,files:packageData.files.length,
  exports:packageData.manifest.exports.length,
  completionCallables:hints.length,contextReadId:contextRead.id,
  argumentCompletions:fields.map(x=>x.label),
  outputCompletions:output.map(x=>x.label)
}));
