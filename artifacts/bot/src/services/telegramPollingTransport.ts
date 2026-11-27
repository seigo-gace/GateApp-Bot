/** Use a dedicated bounded IPv4 transport for Telegram's update receiver.
 * Telegraf still owns offsets, allowed updates, dispatch and shutdown. Never
 * acknowledge a batch ourselves or discard pending updates. Other API calls
 * retain the existing Telegram client, including multipart Rich Messages.
 */
import https from "node:https";
import type {ClientRequest,IncomingMessage,RequestOptions} from "node:http";
import {TelegramError,type Telegram} from "telegraf";

type Request=(url:URL,options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ClientRequest;
type Signal=Pick<AbortSignal,"aborted"|"addEventListener"|"removeEventListener">;
type PollMethod="getUpdates"|"deleteWebhook";
function namedError(name:string,message:string){const e=Error(message);e.name=name;return e;}
export function pollApiRequest(token:string,method:PollMethod,payload:Record<string,unknown>,
 signal?:Signal,request:Request=https.request):Promise<unknown>{
 if((method==="deleteWebhook"&&payload.drop_pending_updates===true)||
    (method==="getUpdates"&&typeof payload.offset==="number"&&payload.offset<0))
  return Promise.reject(Error("GAYBBS_POLLING_DISCARD_FORBIDDEN"));
 if(signal?.aborted)return Promise.reject(namedError("AbortError","Polling stopped"));
 const timeout=method==="getUpdates"?Math.min(50,Math.max(0,Number(payload.timeout)||0))*1000+15000:15000;
 const body=JSON.stringify(payload);
 return new Promise((resolve,reject)=>{
  let settled=false,timer:ReturnType<typeof setTimeout>|undefined,req:ClientRequest|undefined;
  const finish=(err:unknown,value?:unknown)=>{
   if(settled)return;settled=true;
   if(timer)clearTimeout(timer);signal?.removeEventListener("abort",abort);
   if(err)reject(err);else resolve(value);
  };
  const abort=()=>{finish(namedError("AbortError","Polling stopped"));req?.destroy();};
  const transportError=()=>finish(namedError("FetchError","Telegram polling transport failed"));
  try{
   req=request(new URL("https://api.telegram.org/bot"+token+"/"+method),{
    method:"POST",family:4,agent:false,headers:{"content-type":"application/json","content-length":Buffer.byteLength(body)}
   },res=>{
    const chunks:Buffer[]=[];let bytes=0;
    res.on("data",(chunk:Buffer)=>{
     bytes+=chunk.length;
     if(bytes>32*1024*1024){transportError();res.destroy();req?.destroy();return;}
     chunks.push(Buffer.from(chunk));
    });
    res.on("error",transportError);res.on("aborted",transportError);
    res.on("end",()=>{
     try{
      const j=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if(j.ok!==true){
       const code=Number(j.error_code)||res.statusCode||502;
       const retry=Number(j.parameters?.retry_after);
       finish(new TelegramError({error_code:code,description:"Telegram polling API error",
        ...(Number.isFinite(retry)&&retry>0?{parameters:{retry_after:retry}}:{})}));return;
      }
      if(method==="getUpdates"&&!Array.isArray(j.result)){transportError();return;}
      if(method==="deleteWebhook"&&j.result!==true){transportError();return;}
      finish(null,j.result);
     }catch{transportError();}
    });
   });
   req.on("error",transportError);
   timer=setTimeout(()=>{transportError();req?.destroy();},timeout);
   signal?.addEventListener("abort",abort,{once:true});
   if(signal?.aborted){abort();return;}
   req.end(body);
  }catch{transportError();}
 });
}
export function installPollingTransport(telegram:Telegram,token:string,request:Request=https.request):void{
 const original=telegram.callApi.bind(telegram) as (method:string,payload:unknown,options?:unknown)=>Promise<unknown>;
 let ready=false;
 telegram.callApi=(async(method:string,payload:Record<string,unknown>,options?:{signal?:Signal})=>{
  if(method!=="getUpdates"&&method!=="deleteWebhook")return original(method,payload,options);
  const result=await pollApiRequest(token,method,payload,options?.signal,request);
  if(method==="getUpdates"){
   if(!ready){ready=true;console.log("GAYBBS_POLLING_READY");}
   const count=(result as unknown[]).length;
   if(count)console.log("GAYBBS_UPDATE_BATCH_RECEIVED count="+count);
  }
  return result;
 }) as typeof telegram.callApi;
}
