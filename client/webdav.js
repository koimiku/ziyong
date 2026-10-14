import { BACKUP_SETTINGS, validateBackup, mergeBackupRows } from "./backup-model.js";
import { fetchRules } from "./rule-editor.js";
import { shareJson } from "./json-files.js";
import { APP_VERSION } from "./version.js";
const LIMIT=8*1024*1024;
function readRows(key) { try{const rows=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(rows)?rows:[];}catch{return [];} }
async function api(path, options) {
  const response=await fetch(path,options);const value=await response.json();
  if(!response.ok)throw new Error(value.error || "数据操作失败");
  return value;
}
export async function createBackup() {
  const settings={};for(const key of BACKUP_SETTINGS){const value=localStorage.getItem(key);if(value!==null)settings[key]=value;}
  const serverHistory=await api("/api/watch-history");
  return validateBackup({format:"anime-backup",schema:1,appVersion:APP_VERSION,createdAt:new Date().toISOString(),
    settings,rules:await fetchRules(),history:mergeBackupRows(readRows("anime-watch-history"),serverHistory.list || [],"watchedAt"),collection:readRows("anime-collection")});
}
function serialized(backup) { const text=JSON.stringify(backup,null,2);if(new TextEncoder().encode(text).length>LIMIT)throw new Error("备份超过 8 MB");return text; }
function recoveryStore(mode, value) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("anime-backup-recovery",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("snapshots");
    request.onerror=()=>reject(new Error("无法保存恢复前副本，请检查设备存储空间"));
    request.onsuccess=()=>{
      const db=request.result, tx=db.transaction("snapshots",mode);
      const op=mode==="readwrite"?tx.objectStore("snapshots").put(value,"before-restore"):tx.objectStore("snapshots").get("before-restore");
      let result;op.onsuccess=()=>result=op.result;
      tx.oncomplete=()=>{db.close();resolve(result);};
      tx.onerror=()=>{db.close();reject(new Error("保存恢复前副本失败"));};
      tx.onabort=tx.onerror;
    };
  });
}
async function importRule(rule) { await api("/api/kazumi/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rule})}); }
export async function restoreBackup(input) {
  const backup=validateBackup(input);
  const before=await createBackup();
  await recoveryStore("readwrite",before);
  const previousRules=new Map(before.rules.map(rule=>[rule.name,rule]));
  const changed=[];
  const history=mergeBackupRows(before.history,backup.history,"watchedAt");
  const collection=mergeBackupRows(before.collection,backup.collection,"collectionUpdatedAt");
  const previousLocal=new Map([...BACKUP_SETTINGS,"anime-watch-history","anime-collection"].map(key=>[key,localStorage.getItem(key)]));
  try {
    for(const rule of backup.rules){changed.push(rule.name);await importRule(rule);}
    await api("/api/watch-history",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({list:history})});
    for(const [key,value] of Object.entries(backup.settings))localStorage.setItem(key,value);
    localStorage.setItem("anime-watch-history",JSON.stringify(history));
    localStorage.setItem("anime-collection",JSON.stringify(collection));
  }catch(error){
    let rollbackFailed=false;
    for(const [key,value] of previousLocal){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{rollbackFailed=true;}}
    for(const name of changed){try{if(previousRules.has(name))await importRule(previousRules.get(name));else await api("/api/kazumi/uninstall?name="+encodeURIComponent(name));}catch{rollbackFailed=true;}}
    try{await api("/api/watch-history",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({list:before.history})});}catch{rollbackFailed=true;}
    throw new Error(error.message+(rollbackFailed?"；部分回退失败，可导出恢复前副本重新恢复":"；已回退到恢复前状态"));
  }
}
function config() {
  const address=document.querySelector("#webdavUrl").value.trim();
  if(!address)throw new Error("请填写 WebDAV 目录地址");
  const url=new URL(address);
  if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error("请输入完整的 WebDAV 目录地址");
  if(!url.pathname.endsWith("/"))url.pathname+="/";
  const username=document.querySelector("#webdavUsername").value;
  if(username.includes(":"))throw new Error("用户名不能包含冒号");
  localStorage.setItem("anime-webdav-config",JSON.stringify({url:url.href,username}));
  return {url:url.href,username,password:document.querySelector("#webdavPassword").value};
}
export async function webdavRequest(connection,method,filename="",body="") {
  const url=new URL(filename,connection.url).href;
  const native=window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp;
  let result;
  if(native) {
    const headers={"Content-Type":method==="PROPFIND"?"application/xml":"application/json"};
    if(method==="PROPFIND")headers.Depth="0";
    if(connection.username)headers.Authorization="Basic "+btoa(Array.from(new TextEncoder().encode(connection.username+":"+connection.password),byte=>String.fromCharCode(byte)).join(""));
    const response=await native.request({url,method,headers,data:method==="GET"?undefined:method==="PUT"?JSON.parse(body):body,responseType:"text",disableRedirects:true,connectTimeout:20000,readTimeout:25000});
    result={status:response.status,body:typeof response.data==="string"?response.data:JSON.stringify(response.data)};
  } else {
    result=await api("/api/webdav",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...connection,url,method,body})});
  }
  if(new TextEncoder().encode(result.body || "").length>LIMIT)throw new Error("备份超过 8 MB");
  if(result.status>=300 && result.status<400)throw new Error("地址发生重定向，请填写真实的 WebDAV 目录地址");
  if(result.status===401)throw new Error("WebDAV 账号或密码不正确");
  if(result.status===403)throw new Error("WebDAV 目录没有访问权限");
  if(result.status===404)throw new Error(method==="PROPFIND"?"目录不存在，请先在服务器创建":"未找到备份文件");
  if(result.status<200 || result.status>=300)throw new Error("WebDAV 操作失败 ("+result.status+")");
  return result.body || "";
}
export function initializeWebdav() {
  const status=document.querySelector("#webdavStatus"),preview=document.querySelector("#backupPreview");
  let staged=null;
  try{const saved=JSON.parse(localStorage.getItem("anime-webdav-config")||"{}");document.querySelector("#webdavUrl").value=saved.url||"";document.querySelector("#webdavUsername").value=saved.username||"";}catch{}
  recoveryStore("readonly").then(value=>{if(value)document.querySelector("#backupRecovery").hidden=false;}).catch(()=>{});
  const run=async fn=>{
    const buttons=[...document.querySelectorAll("#webdavCard button")];buttons.forEach(button=>button.disabled=true);
    status.textContent="正在处理…";
    try{await fn();}catch(error){status.textContent=error.message || "操作失败";}
    finally{buttons.forEach(button=>button.disabled=false);document.querySelector("#backupRestore").disabled=!staged;}
  };
  function stage(raw) {
    staged=null;preview.hidden=true;
    if(new TextEncoder().encode(raw).length>LIMIT)throw new Error("备份超过 8 MB");
    staged=validateBackup(JSON.parse(raw));preview.hidden=false;
    document.querySelector("#backupPreviewText").textContent="备份时间："+staged.createdAt+" · "+staged.rules.length+" 条规则 · "+staged.collection.length+" 项收藏 · "+staged.history.length+" 条观看记录";
    status.textContent="已读取，请核对内容后恢复";
  }
  document.querySelector("#webdavTest").onclick=()=>run(async()=>{await webdavRequest(config(),"PROPFIND","","<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/></d:prop></d:propfind>");status.textContent="连接成功";});
  document.querySelector("#webdavUpload").onclick=()=>run(async()=>{
    const connection=config(),text=serialized(await createBackup());
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    await webdavRequest(connection,"PUT","anime-backup-"+stamp+".json",text);
    await webdavRequest(connection,"PUT","anime-backup.json",text);
    status.textContent="备份已上传，服务器保留本次独立副本";
  });
  document.querySelector("#webdavPreview").onclick=()=>run(async()=>{staged=null;preview.hidden=true;stage(await webdavRequest(config(),"GET","anime-backup.json"));});
  document.querySelector("#backupExport").onclick=()=>run(async()=>{await shareJson("anime-backup.json",serialized(await createBackup()));status.textContent="备份文件已准备";});
  const file=document.querySelector("#backupImportFile");
  document.querySelector("#backupImport").onclick=()=>file.click();
  file.onchange=()=>run(async()=>{const selected=file.files?.[0];file.value="";if(!selected)return;if(selected.size>LIMIT)throw new Error("备份超过 8 MB");stage(await selected.text());});
  document.querySelector("#backupRestore").onclick=()=>run(async()=>{if(!staged)throw new Error("请先读取备份");await restoreBackup(staged);status.textContent="恢复完成，正在刷新应用…";location.reload();});
  document.querySelector("#backupRecovery").onclick=()=>run(async()=>{const before=await recoveryStore("readonly");if(!before)throw new Error("没有恢复前副本");await shareJson("anime-before-restore.json",serialized(before));status.textContent="恢复前副本已准备";});
}