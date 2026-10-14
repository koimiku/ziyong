import { writeJson } from "./utils.mjs";
const LIMIT = 8 * 1024 * 1024;
export async function handleWebdav(request, response) {
  try {
    if (request.method !== "POST") return writeJson(response, 405, {error:"只接受 POST 请求"});
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) return writeJson(response,403,{error:"请求来源不匹配"});
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > LIMIT) throw new Error("备份超过 8 MB"); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const target = new URL(input.url);
    if (!["http:","https:"].includes(target.protocol) || target.username || target.password) throw new Error("WebDAV 地址无效");
    if (!["GET","PUT","PROPFIND"].includes(input.method)) throw new Error("不支持的 WebDAV 操作");
    const headers = { "Content-Type": input.method === "PROPFIND" ? "application/xml" : "application/json" };
    if (input.username) headers.Authorization = "Basic " + Buffer.from(String(input.username)+":"+String(input.password || "")).toString("base64");
    if (input.method === "PROPFIND") headers.Depth = "0";
    const upstream = await fetch(target, { method:input.method, headers, body:input.method==="GET"?undefined:String(input.body || ""), redirect:"manual", signal:AbortSignal.timeout(25000) });
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if(contentLength > LIMIT) throw new Error("备份超过 8 MB");
    let body = "";
    if (upstream.body) {
      const reader = upstream.body.getReader(); const parts=[]; let bytes=0;
      try { while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>LIMIT)throw new Error("备份超过 8 MB");parts.push(Buffer.from(value));} }
      finally { await reader.cancel().catch(()=>{}); }
      body=Buffer.concat(parts).toString("utf8");
    }
    writeJson(response,200,{status:upstream.status,body});
  } catch(error) { writeJson(response,400,{error:error.name==="TimeoutError"?"WebDAV 请求超时":String(error.message || error)}); }
}