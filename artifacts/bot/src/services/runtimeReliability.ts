import type {Telegram} from "telegraf";

/** Bound the actual HTTP request via cancellation; never retry a write
 * whose Telegram outcome may be unknown. Keep media transfers separate. */
export function boundTelegramCalls(telegram:Telegram){
 const original=telegram.callApi.bind(telegram);
 telegram.callApi=(async(method:string,payload:unknown,options?:{signal?:{
  aborted:boolean;addEventListener:(type:string,fn:()=>void)=>void;
  removeEventListener:(type:string,fn:()=>void)=>void;
 }})=>{
  const upstream=options?.signal;
  const controller=new AbortController();
  const abort=()=>controller.abort();
  const media=/^(send(Photo|Video|Animation|Audio|Document|MediaGroup|Sticker|Voice|VideoNote)|editMessageMedia)$/.test(method);
  const timer=setTimeout(abort,media?120000:15000);
  upstream?.addEventListener("abort",abort);
  if(upstream?.aborted)abort();
  try{
   return await (original as unknown as (m:string,p:unknown,o:unknown)=>Promise<unknown>)(method,payload,{...options,signal:controller.signal});
  }finally{clearTimeout(timer);upstream?.removeEventListener("abort",abort);}
 }) as typeof telegram.callApi;
}

/** FIFO per actor; identical in-flight callback on the same screen is
 * coalesced. Other users, buttons and screens retain their own operations.
 * Completed callbacks are not permanently blocked. Domain revision and
 * delivery-ledger checks still own durable posting idempotency. */
export class ActorQueue {
 private tails=new Map<number,Promise<void>>();
 private pending=new Map<number,Set<string>>();
 get size(){return this.tails.size;}
 async execute(actor:number,key:string|undefined,run:()=>Promise<void>,ack:()=>Promise<void>){
  const keys=this.pending.get(actor)??new Set<string>();
  if(key!==undefined&&keys.has(key)){await ack();return;}
  if(key!==undefined){keys.add(key);this.pending.set(actor,keys);}
  const previous=this.tails.get(actor)??Promise.resolve();
  let release!:()=>void;
  const done=new Promise<void>(resolve=>{release=resolve;});
  const tail=previous.then(()=>done);
  this.tails.set(actor,tail);
  try{await previous;await run();}
  finally{
   if(key!==undefined){keys.delete(key);if(!keys.size)this.pending.delete(actor);}
   release();
   if(this.tails.get(actor)===tail)this.tails.delete(actor);
  }
 }
}
