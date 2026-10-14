export async function shareJson(name, text) {
  const native = window.Capacitor?.Plugins?.AppFiles;
  if (native?.share) return native.share({name,text});
  const file = new File([text],name,{type:"application/json"});
  if (navigator.canShare?.({files:[file]})) return navigator.share({files:[file]});
  const url=URL.createObjectURL(file);
  const link=document.createElement("a");link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export async function copyJson(text) {
  if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input=document.createElement("textarea");input.value=text;document.body.append(input);input.select();
  const ok=document.execCommand("copy");input.remove();if(!ok)throw new Error("请手动选中并复制内容");
}