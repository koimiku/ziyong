import { normalizeRule } from "./kazumi/engine.js";
import { importKazumiRule } from "./sources.js";
import { shareJson, copyJson } from "./json-files.js";
export async function fetchRules(name = "") {
  const response=await fetch("/api/kazumi/export"+(name?"?name="+encodeURIComponent(name):""));
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error || "无法读取规则");
  return payload.rules || [];
}
export async function openRuleEditor(name = "") {
  const dialog=document.querySelector("#ruleEditor");
  const text=document.querySelector("#ruleEditorText");
  const status=document.querySelector("#ruleEditorStatus");
  const title=document.querySelector("#ruleEditorTitle");
  const original = name ? (await fetchRules(name))[0] : {
    name:"my-rule",version:"1.0.0",type:"anime",baseURL:"https://example.com",
    searchURL:"https://example.com/search?wd={keyword}",searchList:"//a",searchName:"/text()",searchResult:"/@href",
    chapterRoads:"//div",chapterResult:"//a",
  };
  if(!original)throw new Error("规则不存在");
  text.value=JSON.stringify(original,null,2);status.textContent="";title.textContent=name?"编辑规则 · "+name:"新建规则";
  dialog.showModal();
  const checked = () => {
    if(text.value.length>1000000)throw new Error("规则超过 1 MB");
    const rule=normalizeRule(text.value);
    if(name && rule.name!==name)throw new Error("编辑时请保留规则名；新规则请使用“新建规则”");
    return rule;
  };
  const action = async fn => { try{status.textContent="";await fn();}catch(error){status.textContent=error.message || "操作失败";} };
  document.querySelector("#ruleFormat").onclick=()=>action(()=>{text.value=JSON.stringify(checked(),null,2);status.textContent="JSON 与规则字段校验通过";});
  document.querySelector("#ruleSave").onclick=()=>action(async()=>{
    const button=document.querySelector("#ruleSave");button.disabled=true;
    try{await importKazumiRule({rule:checked()});document.dispatchEvent(new Event("anime:rules-changed"));dialog.close();}
    finally{button.disabled=false;}
  });
  document.querySelector("#ruleShare").onclick=()=>action(()=>{const rule=checked();return shareJson(rule.name+".json",JSON.stringify(rule,null,2));});
  document.querySelector("#ruleCopy").onclick=()=>action(async()=>{await copyJson(JSON.stringify(checked(),null,2));status.textContent="已复制，可粘贴给其他设备导入";});
}
export async function shareRule(name) {
  const rule=(await fetchRules(name))[0];if(!rule)throw new Error("规则不存在");
  return shareJson(rule.name+".json",JSON.stringify(rule,null,2));
}
export function initializeRuleEditor() {
  document.querySelector("#ruleEditorClose").addEventListener("click",()=>document.querySelector("#ruleEditor").close());
  document.querySelector("#ruleNew").addEventListener("click",()=>openRuleEditor().catch(error=>document.querySelector("#miruStatus").textContent=error.message));
  const input=document.querySelector("#ruleImportFile");
  document.querySelector("#ruleImportFileButton").addEventListener("click",()=>input.click());
  input.addEventListener("change",async()=>{
    const file=input.files?.[0];input.value="";if(!file)return;
    try {
      if(file.size>1000000)throw new Error("规则文件超过 1 MB");
      await importKazumiRule({rule:normalizeRule(await file.text())});
      document.dispatchEvent(new Event("anime:rules-changed"));
      document.querySelector("#miruStatus").textContent="规则已导入";
    }catch(error){document.querySelector("#miruStatus").textContent=error.message;}
  });
}