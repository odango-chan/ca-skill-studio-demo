import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectWorkspace} from "../site/workspace.mjs";
import {routeProjectionSignature} from "../site/route-create.mjs";
import {namedVerifyEditOptions,previewNamePlainVerify,applyNamePlainVerify,
  previewDeleteUnreferencedNamedVerify,applyDeleteUnreferencedNamedVerify,
  previewSwapAdjacentNamedVerify,applySwapAdjacentNamedVerify}
  from "../site/phase-named-verify.mjs";

const original=readFileSync(new URL("../site/samples/packages/"+
  "establish-pdu-session/assurance/procedure.yaml",import.meta.url),"utf8");
const procedure="ue-requested-pdu-session-establishment",node="nudm-sdm-subscribe";
const phase="preconditions",name="check-ingress";
const a="            - verify: createdsession.ingress.eligible\n";
const b="            - verify: createdsession.lifecycle.ready\n";
const namedLine="            - name: "+name+"\n"+
  "              verify: createdsession.ingress.eligible\n";
const args=(source=original,i=3)=>[source,procedure,node,phase,i];
const namePreview=src=>previewNamePlainVerify(...args(src),name);
const named=original.replace(a,namedLine);

test("D4-A3b2b1 owner sample exposes name but blocks effectful named Steps",()=>{
  assert.ok(original.includes(a+b));
  const x=namedVerifyEditOptions(original,procedure,node);
  assert.ok(x.names.some(k=>k.phaseName===phase&&k.stepIndex===3));
  assert.ok(x.names.some(k=>k.phaseName===phase&&k.stepIndex===4));
  assert.deepEqual(x.deletions,[]);
  assert.deepEqual(x.swaps,[]);
  assert.ok(Object.isFrozen(x)&&Object.isFrozen(x.names));
  assert.throws(()=>previewDeleteUnreferencedNamedVerify(...args(original,0)));
  assert.throws(()=>previewSwapAdjacentNamedVerify(...args(original,0)));
});

test("D4-A3b2b1 add a name to existing plain Verify without changing predicate or graph",()=>{
  const p=namePreview(original);
  assert.equal(p.type,"NamePlainPhaseVerify");
  assert.equal(p.candidateSource,named);
  assert.equal(original.slice(p.sourceSpan.start,p.sourceSpan.end),a);
  assert.match(p.diff,/^\+            - name: check-ingress$/m);
  assert.match(p.summary,/Runtime\/5GC 未验证/);
  assert.equal(applyNamePlainVerify(original,p),named);
  const actual=routeProjectionSignature(projectWorkspace(named));
  const expected=routeProjectionSignature(projectWorkspace(original));
  expected.find(x=>x.name===procedure).nodes.find(x=>x.id===node)
    .phases.find(x=>x.name===phase).steps[3].name=name;
  assert.deepEqual(actual,expected);
});

test("D4-A3b2b1 unreferenced named Verify may be removed with exact Source span",()=>{
  const opts=namedVerifyEditOptions(named,procedure,node);
  assert.ok(opts.deletions.some(x=>x.phaseName===phase&&x.stepIndex===3));
  assert.ok(!opts.deletions.some(x=>x.phaseName===phase&&x.stepIndex===0));
  const p=previewDeleteUnreferencedNamedVerify(...args(named));
  assert.equal(p.type,"DeleteUnreferencedNamedVerify");
  assert.equal(p.referenceCount,0);
  assert.equal(named.slice(p.sourceSpan.start,p.sourceSpan.end),namedLine);
  assert.equal(p.candidateSource,original.replace(a,""));
  assert.equal(applyDeleteUnreferencedNamedVerify(named,p),p.candidateSource);
  assert.equal(projectWorkspace(p.candidateSource).state,"READY");
  const expected=routeProjectionSignature(projectWorkspace(named));
  const list=expected.find(x=>x.name===procedure).nodes.find(x=>x.id===node)
    .phases.find(x=>x.name===phase).steps;
  list.splice(3,1);list.forEach((s,i)=>{s.index=i+1;});
  assert.deepEqual(routeProjectionSignature(projectWorkspace(p.candidateSource)),expected);
});

test("D4-A3b2b1 independent named Verify can swap with adjacent Verify, not script/call",()=>{
  const opts=namedVerifyEditOptions(named,procedure,node);
  assert.ok(opts.swaps.some(x=>x.phaseName===phase&&x.stepIndex===3));
  assert.equal(opts.swaps.some(x=>x.phaseName===phase&&x.stepIndex<3),false);
  const p=previewSwapAdjacentNamedVerify(...args(named));
  assert.equal(p.type,"SwapAdjacentNamedVerify");
  const swapped=original.replace(a+b,b+namedLine);
  assert.equal(p.candidateSource,swapped);
  assert.equal(named.slice(p.sourceSpan.start,p.sourceSpan.end),namedLine+b);
  assert.equal(applySwapAdjacentNamedVerify(named,p),swapped);
  const back=previewSwapAdjacentNamedVerify(...args(swapped));
  assert.equal(applySwapAdjacentNamedVerify(swapped,back),named);
  assert.equal(projectWorkspace(swapped).state,"READY");
});

test("D4-A3b2b1 refuses named output consumers even if reference looks structurally valid",()=>{
  const withRef=named.replace(
    "                  from: input.dnn\n",
    "                  from: preconditions."+name+".output\n");
  assert.ok(withRef.includes("from: preconditions."+name+".output"));
  const opts=namedVerifyEditOptions(withRef,procedure,node);
  assert.equal(opts.deletions.some(x=>x.stepIndex===3),false);
  assert.equal(opts.swaps.some(x=>x.stepIndex===3),false);
  assert.throws(()=>previewDeleteUnreferencedNamedVerify(...args(withRef)));
  assert.throws(()=>previewSwapAdjacentNamedVerify(...args(withRef)));
  for(const altered of [
    named.replace(namedLine,namedLine+"            # "+name+"\n"),
    named.replace(namedLine,"            - name: '"+name+"'\n"+
      "              verify: createdsession.ingress.eligible\n"),
    named.replace(namedLine,"            - name: "+name+"\n"+
      "              verify: createdsession.ingress.eligible # note\n"),
    named.replace(namedLine,namedLine.replace("verify:","call:")),
    named.replace(namedLine,namedLine.replace("verify:","script:")),
    named.replace(namedLine,namedLine+"              with:\n                x:\n                  from: input.dnn\n")
  ]){
    assert.throws(()=>previewDeleteUnreferencedNamedVerify(...args(altered)));
    assert.throws(()=>previewSwapAdjacentNamedVerify(...args(altered)));
  }
});
test("D4-A3b2b1 reject commented, quoted, duplicated or invented Verify names",()=>{
  for(const n of ["", "0bad", "a.b", "a space",
    "select-subscription-configuration","createdsession"]){
    assert.throws(()=>previewNamePlainVerify(...args(original),n));
  }
  const cases=[
    original.replace(a,"            - verify: 'createdsession.ingress.eligible'\n"),
    original.replace(a,"            - verify: createdsession.ingress.eligible # note\n"),
    original.replace(a,"            # comment\n"+a),
    original.replace(a,a.replace("- verify:","- call:")),
    original.replace(a,a+"              with:\n                x:\n                  from: input.dnn\n"),
    "procedures: ["
  ];
  for(const x of cases)assert.throws(()=>namePreview(x));
  for(const [p,n,ph,i] of [
    ["bad",node,phase,3],[procedure,"missing",phase,3],
    [procedure,node,"operator",3],[procedure,node,phase,0],
    [procedure,node,phase,-1],[procedure,node,phase,90]
  ])assert.throws(()=>previewNamePlainVerify(original,p,n,ph,i,name));
});
test("D4-A3b2b1 refuses nonadjacent, ambiguous or unsafe named Verify swaps",()=>{
  const withComment=named.replace(namedLine+b,namedLine+"            # between\n"+b);
  const withGap=named.replace(namedLine+b,namedLine+"\n"+b);
  const withQuote=named.replace(b,"            - verify: 'createdsession.lifecycle.ready'\n");
  const withSame=named.replace(b,a);
  for(const x of [withComment,withGap,withQuote,withSame]){
    assert.throws(()=>previewSwapAdjacentNamedVerify(...args(x)));
  }
  assert.throws(()=>previewSwapAdjacentNamedVerify(...args(named,4)));
});
test("D4-A3b2b1 all three operations reject stale/forged previews",()=>{
  const pair=[
    [original,namePreview(original),applyNamePlainVerify],
    [named,previewDeleteUnreferencedNamedVerify(...args(named)),
      applyDeleteUnreferencedNamedVerify],
    [named,previewSwapAdjacentNamedVerify(...args(named)),
      applySwapAdjacentNamedVerify]
  ];
  for(const [src,p,fn] of pair){
    for(const altered of [
      {...p,diff:"forged"},
      {...p,sourceSpan:{start:0,end:0}},
      {...p,candidateSource:src},
      {...p,stepIndex:2},
      {...p,extra:true}
    ])assert.throws(()=>fn(src,altered));
    assert.throws(()=>fn(src+"\n",p),/Stale/);
  }
});
test("D4-A3b2b1 preserves CRLF while naming, deleting and swapping",()=>{
  const crlf=original.replace(/\n/g,"\r\n");
  const p=previewNamePlainVerify(...args(crlf),name);
  const withName=applyNamePlainVerify(crlf,p);
  assert.equal(withName,named.replace(/\n/g,"\r\n"));
  const del=previewDeleteUnreferencedNamedVerify(...args(withName));
  assert.equal(applyDeleteUnreferencedNamedVerify(withName,del),
    original.replace(a,"").replace(/\n/g,"\r\n"));
  const swap=previewSwapAdjacentNamedVerify(...args(withName));
  const moved=applySwapAdjacentNamedVerify(withName,swap);
  assert.equal(moved,original.replace(a+b,b+namedLine).replace(/\n/g,"\r\n"));
  assert.equal(applySwapAdjacentNamedVerify(moved,
    previewSwapAdjacentNamedVerify(...args(moved))),withName);
});
