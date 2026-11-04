/** Bounded, opt-in workers for the dedicated GayBBS Gserver app.
 * Default is disabled; no external Telegram effects before release admission.
 */
import type {Telegram} from "telegraf";
import {projectNextRoomEvent} from "./announcementRoomEvents.js";
import {deliverNextAnnouncementNotification} from "./announcementNotifications.js";
import {purgeDisposableAnnouncements,purgeAbandonedDrafts} from "./announcementPurge.js";

type Worker={name:string;enabled:boolean;busy:boolean;run:()=>Promise<unknown>};
export function startGayBbsWorkers(telegram:Telegram):()=>void{
 const workers:Worker[]=[
  {name:"room-announcement",enabled:process.env.GAYBBS_ROOM_EVENT_WORKER_ENABLED==="enabled",
   busy:false,run:()=>projectNextRoomEvent()},
  {name:"disposable-db-cleanup",
   enabled:process.env.GAYBBS_DISPOSABLE_CLEANUP_ENABLED==="enabled",
   busy:false,run:async()=>{
    // One bounded batch every tick; transactions remove meeting-related
    // personal data, not whole shared bot/MPB tables.
    const removed=await purgeDisposableAnnouncements(20);
    if(removed===0)await purgeAbandonedDrafts(7);
    return removed;
   }},
  {name:"announcement-notification",
   enabled:process.env.GAYBBS_NOTIFICATION_DELIVERY_ENABLED==="enabled",
   busy:false,run:()=>deliverNextAnnouncementNotification(telegram)},
 ];
 // For a non-enabled worker there is no timer or DB/Telegram access.
 const enabled=workers.filter(w=>w.enabled);
 if(!enabled.length)return ()=>{};
 let stopped=false;
 const timer=setInterval(()=>{
  if(stopped)return;
  for(const w of enabled){
   if(w.busy)continue;
   w.busy=true;
   void w.run().catch(error=>{
    // Do not print raw Telegram/DB exceptions, secrets or user payload.
    console.error("GAYBBS_WORKER_CHECK_FAILED",w.name,
      error instanceof Error?error.name:"unknown");
   }).finally(()=>{w.busy=false;});
  }
 },15000);
 return ()=>{stopped=true;clearInterval(timer)};
}
