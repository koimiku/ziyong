import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function harness() {
  const storage = new Map([["anime-bangumi-token","test-token"],["anime-bangumi-user",JSON.stringify({username:"tester"})]]);
  const calls = [];
  let remote = [], fail = false;
  const context = {
    Date, Event, console, setTimeout: () => 1, clearTimeout() {},
    CustomEvent: class extends Event { constructor(name, options) { super(name); this.detail = options?.detail; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) },
    document: { addEventListener() {}, dispatchEvent() {} }, window: { addEventListener() {} },
    getWatchHistory: () => [], mergeExternalHistory() {}, resolveEpisodeNumber: () => 1,
    async bangumiRequest(path, options = {}) {
      calls.push({path, ...options});
      if (fail && options.method === "POST") return {ok:false,status:500,text:async()=>"offline"};
      if (path.startsWith("/v0/episodes?")) return {ok:true,status:200,json:async()=>({data:[{id:100,sort:1}]})};
      return {ok:true,status:200,json:async()=>({data:remote}),text:async()=>""};
    },
  };
  vm.createContext(context);
  for (const file of ["collection-store.js","bangumi-sync.js"]) {
    const code = readFileSync(new URL("../client/" + file, import.meta.url),"utf8")
      .replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm,"").replaceAll("export ","");
    vm.runInContext(code,context);
  }
  return {context,calls,remote(value){remote=value;},fail(){fail=true;}};
}
test("local pending status wins during sync and maps to the Bangumi type", async () => {
  const h=harness();
  h.remote([{subject:{id:42,name:"test"},type:3}]);
  h.context.setCollectionStatus({id:42,title:"test"},"planned");
  await h.context.syncBangumiHistory();
  assert.equal(h.calls.find(call=>call.method==="POST").body.type,1);
  assert.equal(h.context.getCollectionStatus(42),"planned");
  assert.equal(h.context.getPendingCollections().length,0);
  h.remote([{subject:{id:42,name:"test"},type:2}]);
  await h.context.syncBangumiHistory();
  assert.equal(h.context.getCollectionStatus(42),"completed");
});
test("failed upload keeps edits queued and remote data cannot erase them", async () => {
  const h=harness();
  h.context.setCollectionStatus({id:42},"watching");
  h.remote([{subject:{id:42},type:2}]);
  h.fail();
  await assert.rejects(h.context.syncBangumiHistory());
  assert.equal(h.context.getCollectionStatus(42),"watching");
  assert.equal(h.context.getPendingCollections().length,1);
});
test("watching an episode does not overwrite an explicit planned status", async () => {
  const h=harness();
  h.context.setCollectionStatus({id:42},"planned");
  await h.context.pushPendingCollections();
  await h.context.pushSubjectProgress("test-token",42,1,{finished:true});
  const types=h.calls.filter(call=>call.method==="POST").map(call=>call.body.type);
  assert.deepEqual(types,[1]);
});
test("local removal remains hidden after pulling cloud collections", async () => {
  const h=harness();
  h.context.setCollectionStatus({id:42},"");
  h.remote([{subject:{id:42,name:"test"},type:3}]);
  await h.context.syncBangumiHistory();
  assert.equal(h.context.getCollectionStatus(42),"");
  assert.equal(h.calls.filter(call=>call.method==="POST").length,0);
});
test("existing 1.5.9 collections are queued for their first cloud sync", async () => {
  const h=harness();
  h.context.localStorage.setItem("anime-collection",JSON.stringify([{id:99,collectionStatus:"completed",title:"legacy"}]));
  await h.context.pushPendingCollections();
  assert.equal(h.calls.find(call=>call.method==="POST").body.type,2);
  assert.equal(h.context.getPendingCollections().length,0);
});
