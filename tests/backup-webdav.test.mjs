import vm from "node:vm";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { validateBackup, mergeBackupRows } from "../client/backup-model.js";
import { handleWebdav } from "../server/webdav.mjs";
const valid = () => ({format:"anime-backup",schema:1,rules:[],settings:{"anime-theme":"dark"},history:[],collection:[]});
test("backup allows application settings and rejects secrets, malformed rules and unknown format", () => {
  assert.equal(validateBackup(valid()).settings["anime-theme"],"dark");
  assert.throws(()=>validateBackup({...valid(),settings:{"anime-bangumi-token":"secret"}}));
  assert.throws(()=>validateBackup({...valid(),settings:{"anime-webdav-config":"secret"}}));
  assert.throws(()=>validateBackup({...valid(),schema:2}));
  assert.throws(()=>validateBackup({...valid(),rules:[{name:"bad"}]}));
  assert.throws(()=>validateBackup({...valid(),history:[{id:{}}]}));
});
test("restore merge retains newer local records and deduplicates numeric and string identifiers", () => {
  const merged=mergeBackupRows([{id:1,watchedAt:10},{id:2,watchedAt:8}],[{id:"1",watchedAt:5},{id:3,watchedAt:12}],"watchedAt");
  assert.deepEqual(merged.map(item=>item.id),[3,1,2]);
});
test("WebDAV gateway preserves JSON and credentials, blocks cross-origin requests and redirect forwarding", async () => {
  let saved="", receivedAuth="", redirected=0;
  const dav=createServer(async(req,res)=>{
    receivedAuth=req.headers.authorization || "";
    if(req.url==="/redirect"){res.writeHead(302,{Location:"/capture"});return res.end();}
    if(req.url==="/capture"){redirected++;return res.end();}
    if(req.method==="PROPFIND"){assert.equal(req.headers.depth,"0");res.writeHead(207);return res.end("<multistatus/>");}
    if(req.method==="PUT"){for await(const chunk of req)saved+=chunk;res.writeHead(201);return res.end();}
    res.end(saved);
  });
  dav.listen(0,"127.0.0.1");await once(dav,"listening");
  const proxy=createServer(handleWebdav);proxy.listen(0,"127.0.0.1");await once(proxy,"listening");
  const davUrl="http://127.0.0.1:"+dav.address().port;
  const proxyUrl="http://127.0.0.1:"+proxy.address().port;
  async function send(method,extra={},origin=proxyUrl){
    const response=await fetch(proxyUrl,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({url:davUrl+"/backup.json",method,username:"test",password:"pass",...extra})});
    return {status:response.status,data:await response.json()};
  }
  try {
    assert.equal((await send("PROPFIND")).data.status,207);
    assert.equal((await send("PUT",{body:'{"rules":[],"name":"测试"}'})).data.status,201);
    assert.equal((await send("GET")).data.body,'{"rules":[],"name":"测试"}');
    assert.equal(receivedAuth,"Basic "+Buffer.from("test:pass").toString("base64"));
    assert.equal((await send("GET",{},"https://unrelated.example")).status,403);
    assert.equal((await send("GET",{url:davUrl+"/redirect"})).data.status,302);
    assert.equal(redirected,0);
    assert.equal((await send("DELETE")).status,400);
    assert.equal((await send("GET",{url:"file:///etc/passwd"})).status,400);
  }finally{proxy.closeAllConnections();dav.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>dav.close(r))]);}
});function restoreHarness() {
  const rule={name:"sample",version:"1",searchURL:"https://example.com/?q={keyword}",searchList:"//a",searchName:"/text()",searchResult:"/@href",chapterRoads:"//div",chapterResult:"//a"};
  const rules=new Map([["sample",rule]]);
  const storage=new Map([["anime-theme","dark"]]);
  let history=[{id:1,watchedAt:10}], failImport=false, failSetting=false;
  const context={
    APP_VERSION:"test",BACKUP_SETTINGS:["anime-theme","anime-palette-dark"],validateBackup,mergeBackupRows,
    TextEncoder,Date,console,
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(failSetting && key==="anime-palette-dark"){failSetting=false;throw new Error("quota");}storage.set(key,value);},removeItem:key=>storage.delete(key)},
    fetchRules:async()=>[...rules.values()],
    async fetch(path,options={}) {
      if(path==="/api/watch-history") {
        if(options.method==="PUT")history=JSON.parse(options.body).list;
        return {ok:true,json:async()=>({list:history})};
      }
      if(path==="/api/kazumi/import") {
        const imported=JSON.parse(options.body).rule;rules.set(imported.name,imported);
        if(failImport){failImport=false;return {ok:false,json:async()=>({error:"write failed"})};}
        return {ok:true,json:async()=>({ok:true})};
      }
      throw new Error("Unexpected API "+path);
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../client/webdav.js",import.meta.url),"utf8").replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm,"").replaceAll("export ",""),context);
  vm.runInContext("recoveryStore = async () => {}",context);
  const input={...valid(),rules:[{...rule,version:"2"}],settings:{"anime-theme":"light","anime-palette-dark":"pink"},history:[{id:2,watchedAt:20}]};
  return {context,input,rules,storage,history:()=>history,failRule(){failImport=true;},failStorage(){failSetting=true;}};
}
test("restore rolls back an attempted rule write even if the server reports a failure afterwards", async()=>{
  const h=restoreHarness();h.failRule();
  await assert.rejects(h.context.restoreBackup(h.input),/已回退/);
  assert.equal(h.rules.get("sample").version,"1");
  assert.equal(h.storage.get("anime-theme"),"dark");
});
test("restore storage failure rolls back rules, history and previously changed preferences",async()=>{
  const h=restoreHarness();h.failStorage();
  await assert.rejects(h.context.restoreBackup(h.input),/已回退/);
  assert.equal(h.rules.get("sample").version,"1");
  assert.equal(h.storage.get("anime-theme"),"dark");
  assert.equal(h.storage.has("anime-palette-dark"),false);
  assert.deepEqual(h.history().map(item=>item.id),[1]);
});