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
console.log('PUBLISHED_INTERFACE_ZIP_PASS',JSON.stringify({
  sha256:expected,packageId:packageData.manifest.packageId,
  version:packageData.manifest.version,files:packageData.files.length,
  exports:packageData.manifest.exports.length,
  completionCallables:hints.length,contextReadId:contextRead.id
}));
