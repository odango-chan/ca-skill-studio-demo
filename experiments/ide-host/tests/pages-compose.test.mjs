import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,rm,writeFile,stat} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {composePagesRelease} from "../scripts/compose-pages-release.mjs";

async function put(root,path,content){
  const target=join(root,path);
  await mkdir(target.slice(0,target.lastIndexOf("/")),{recursive:true});
  await writeFile(target,content);
}

test("Pages root is Theia, complete previous Studio remains at /classic/",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"studio-pages-compose-"));
  const classic=join(temp,"dist"),theia=join(temp,"theia");
  try{
    await put(classic,"index.html",'<!doctype html><html><body><script src="./app.js"></script></body></html>');
    await put(classic,"app.js","window.classicStudio=true;");
    await put(classic,"studio.css","/* classic studio */");
    await put(classic,"light.css","/* classic theme */");
    await put(classic,"app.css","/* classic app */");
    await put(classic,"samples/establish-pdu-session/SKILL.md","# Sample");
    await put(theia,"index.html",'<!doctype html><html><head><link id="skill-studio-classic-icon-theme" rel="stylesheet" href="./classic-icons.css"><link id="skill-studio-brand-theme" rel="stylesheet" href="./skill-studio-brand.css"></head><body><div id="skill-studio-preview-warning"><a href="./classic/">Classic</a></div><div id="theia-app-shell"></div><script id="skill-studio-brand-script" type="module" src="./skill-studio-brand.js"></script></body></html>');
    await put(theia,"bundle.js","window.theia=true;");
    await put(theia,"classic-icons.css","/* classic icon theme */");
    await put(theia,"skill-studio-brand.css","/* SKILL Studio brand theme */");
    await put(theia,"skill-studio-brand.js","/* SKILL Studio brand mount */");
    await put(theia,"hostedPlugin/list.json",'["ca-skill-studio-ide-spike","odango-chan.skill-studio-theme"]');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/package.json",'{"name":"skill-studio-theme"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json",'{"name":"SKILL Studio Light"}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill-studio-file-icon-theme.json",'{"iconDefinitions":{}}');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg",'<svg></svg>');
    await put(theia,"hostedPlugin/odango_chan_skill_studio_theme/icons/yaml.svg",'<svg></svg>');
    await put(theia,"webview/index.html","<html>webview</html>");

    const result=await composePagesRelease({
      classicDist:classic,theiaFrontend:theia,outputDist:classic
    });
    assert.equal(result.defaultHost,"theia-browser-only");
    assert.equal(result.classicPath,"/classic/");
    assert.match(await readFile(join(classic,"index.html"),"utf8"),/theia-app-shell/);
    assert.match(await readFile(join(classic,"index.html"),"utf8"),/href="\.\/classic\//);
    assert.match(await readFile(join(classic,"classic","index.html"),"utf8"),/href="\.\.\//);
    assert.match(await readFile(join(classic,"classic","index.html"),"utf8"),/src="\.\/app\.js"/);
    assert.equal(await readFile(join(classic,"classic","app.js"),"utf8"),"window.classicStudio=true;");
    assert.equal(await readFile(join(classic,"classic","samples/establish-pdu-session/SKILL.md"),"utf8"),"# Sample");
    assert.equal(await readFile(join(classic,"bundle.js"),"utf8"),"window.theia=true;");
    assert.equal(await readFile(join(classic,"classic-icons.css"),"utf8"),"/* classic icon theme */");
    assert.equal(await readFile(join(classic,"skill-studio-brand.css"),"utf8"),"/* SKILL Studio brand theme */");
    assert.equal(await readFile(join(classic,"skill-studio-brand.js"),"utf8"),"/* SKILL Studio brand mount */");
    assert.match(await readFile(join(classic,"hostedPlugin/list.json"),"utf8"),/ca-skill-studio-ide-spike/);
    assert.match(await readFile(join(classic,"hostedPlugin/list.json"),"utf8"),/skill-studio-theme/);
    assert.equal(await readFile(join(classic,"hostedPlugin/odango_chan_skill_studio_theme/themes/skill-studio-light-color-theme.json"),"utf8"),'{"name":"SKILL Studio Light"}');
    assert.equal(await readFile(join(classic,"hostedPlugin/odango_chan_skill_studio_theme/icons/skill.svg"),"utf8"),'<svg></svg>');
    assert.equal(await readFile(join(classic,".nojekyll"),"utf8"),"");
    assert.match(await readFile(join(classic,"ide-preview","index.html"),"utf8"),/url=\.\.\//);
    await assert.rejects(stat(join(classic,"app.js")));
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});

test("invalid Theia input is rejected before the Classic build is replaced",async()=>{
  const temp=await mkdtemp(join(tmpdir(),"studio-pages-guard-"));
  const classic=join(temp,"dist"),theia=join(temp,"theia");
  try{
    await put(classic,"index.html","<html><body>classic</body></html>");
    await put(classic,"app.js","classic-app");
    await put(classic,"studio.css","classic-studio-css");
    await put(classic,"light.css","classic-light-css");
    await put(classic,"app.css","classic-app-css");
    await put(theia,"index.html","<html><body>not prepared</body></html>");
    await assert.rejects(
      composePagesRelease({classicDist:classic,theiaFrontend:theia,outputDist:classic}),
      /Required Pages asset missing|same-origin warning/
    );
    assert.equal(await readFile(join(classic,"index.html"),"utf8"),"<html><body>classic</body></html>");
    assert.equal(await readFile(join(classic,"app.js"),"utf8"),"classic-app");
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
});
