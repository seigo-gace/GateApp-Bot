/** ROOM host self-reported lifecycle, no unsafe Telegram group live controls.
 * Room remains distinct from Announcement (notice owner) and MPB (delivery).
 */
import { Markup,type Telegraf } from "telegraf";
import {pool} from "../db/index.js";
import {updateRoomState,changeRoomVisibility,reportRoomParticipation,type RoomAction} from "../services/roomLifecycle.js";
import {parseJstDateTime} from "../services/postingDomain.js";
import {getAuthorizedRoom,listAuthorizedRooms} from "../services/roomAccess.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
function actions(roomId:number,revision:number,status:string,visibility?:string){
 const allowed:Record<string,RoomAction[]>={
  draft:["schedule","prepare","cancel"],
  scheduled:["prepare","postpone","cancel"],
  ready:["start","postpone","cancel"],
  live:["finish","postpone","cancel"],
  postponed:["schedule","prepare","cancel"],
 };
 const labels:Record<RoomAction,string>={schedule:"📅 予約",prepare:"✅ 準備完了",
  start:"▶ 開始を申告",postpone:"⏸ 延期",cancel:"❌ 中止",finish:"■ 終了を申告"};
 const rows=(allowed[status]||[]).map(x=>[
  Markup.button.callback(labels[x],`room:action:${roomId}:${revision}:${x}`)]);
 if(["draft","scheduled","ready"].includes(status)&&visibility){
  const next=visibility==="public"?"approved_only":"public";
  rows.push([Markup.button.callback(
    next==="public"?"🔓 自由参加へ変更":"🔐 承認制へ変更",
    `room:visibility:${roomId}:${revision}:${next}`)]);
 }
 return Markup.inlineKeyboard(rows);
}
export function registerRoomHandlers(bot:Telegraf):void{
 bot.command("joinrooms",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const rooms=await listAuthorizedRooms(ctx.from.id);
  if(!rooms.length){
   await ctx.reply("参加許可のあるROOMはありません。募集の承認後に表示されます。");
   return;
  }
  for(const room of rooms){
   await ctx.reply("🎬 "+room.title+" / "+room.status,
    Markup.inlineKeyboard([[Markup.button.callback(
      "🔗 このROOMの参加リンクを表示","room:join:"+room.id)]]));
  }
 });
 bot.action(/^room:join:(\d+)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const room=await getAuthorizedRoom(ctx.from.id,Number(ctx.match[1]));
  if(!room){
   await ctx.answerCbQuery("参加権限がないかROOMが終了しています");
   return;
  }
  await ctx.answerCbQuery();
  // Return only in the requesting user's private chat; never reply in a group.
  await ctx.reply("🎬 "+room.title+"\n準備完了・開催中のROOMだけ参加できます。",
   Markup.inlineKeyboard([[Markup.button.url("🔗 ROOMへ参加",room.joinUrl)]]));
 });
 bot.command("myrooms",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const r=await pool.query(
   `SELECT room_id,title,status,revision,join_visibility FROM room_posts
    WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 20`,[ctx.from.id]);
  if(!r.rows.length){await ctx.reply("ROOMはまだありません。/room で下書きから作成できます。");return;}
  for(const x of r.rows){
   await ctx.reply("🎬 "+String(x.title)+"\n状態："+String(x.status)+
    "\nROOM #"+x.room_id,actions(Number(x.room_id),Number(x.revision),x.status,x.join_visibility));
  }
 });
 bot.action(/^room:visibility:(\d+):(\d+):(public|approved_only)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const roomId=Number(ctx.match[1]),expectedRevision=Number(ctx.match[2]);
  const visibility=ctx.match[3] as "public"|"approved_only";
  try{
   const update=await changeRoomVisibility(
    ctx.from.id,roomId,expectedRevision,visibility);
   await ctx.answerCbQuery("参加方式を保存しました");
   const current=await pool.query(
    "SELECT status FROM room_posts WHERE room_id=$1 AND owner_user_id=$2",
    [roomId,ctx.from.id]);
   await ctx.editMessageText("ROOM #"+roomId+" の参加方式："+
    (visibility==="public"?"自由参加":"承認制")+
    "\n既存投稿の更新要求をDBへ登録しました。会議URLは公開していません。",
    actions(roomId,update.revision,current.rows[0]?.status||"draft",visibility));
  }catch{
   await ctx.answerCbQuery("設定を変更できません。/myrooms で状態を確認してください。");
  }
 });
 bot.action(/^room:action:(\d+):(\d+):(schedule|prepare|start|postpone|cancel|finish)$/,async ctx=>{
  if(ctx.chat?.type!=="private")return;
  const roomId=Number(ctx.match[1]),rev=Number(ctx.match[2]),
   action=ctx.match[3] as RoomAction;
  if(action==="schedule"||action==="postpone"){
   await ctx.answerCbQuery();
   await pool.query(
    `INSERT INTO room_host_sessions
      (owner_user_id,room_id,expected_revision,requested_action,expires_at)
     VALUES($1,$2,$3,$4,NOW()+INTERVAL '20 minutes')
     ON CONFLICT(owner_user_id) DO UPDATE SET
      room_id=EXCLUDED.room_id,expected_revision=EXCLUDED.expected_revision,
      requested_action=EXCLUDED.requested_action,expires_at=EXCLUDED.expires_at,
      updated_at=NOW()`,
    [ctx.from.id,roomId,rev,action]);
   await ctx.reply("変更後の開催日時を日本時間で入力してください。例：2026/11/20 20:00");
   return;
  }
  try{
   const res=await updateRoomState(ctx.from.id,roomId,rev,action);
   await ctx.answerCbQuery("操作を保存しました");
   await ctx.editMessageText("🎬 ROOM #"+roomId+" / 状態："+res.state+
    "\n関連する告知への通知は永続イベントに登録しました。",
    actions(roomId,res.revision,res.state));
  }catch{await ctx.answerCbQuery("状態が変わったか権限がありません。/myrooms で確認してください。");}
 });
 bot.on("text",async(ctx,next)=>{
  if(ctx.chat.type!=="private"||ctx.message.text.startsWith("/"))return next();
  if(await currentDmTextOwner(ctx.from.id)!=="room_host")return next();
  const d=await pool.query(
   `SELECT room_id,expected_revision,requested_action FROM room_host_sessions
     WHERE owner_user_id=$1 AND expires_at>NOW()`,[ctx.from.id]);
  if(d.rows.length!==1)return next();
  try{
   const data=d.rows[0];
   const date=parseJstDateTime(ctx.message.text);
   const outcome=await updateRoomState(ctx.from.id,Number(data.room_id),
    Number(data.expected_revision),data.requested_action,date);
   await pool.query(
    "DELETE FROM room_host_sessions WHERE owner_user_id=$1 AND room_id=$2",
    [ctx.from.id,Number(data.room_id)]);
   await ctx.reply("✅ 開催日時を保存しました。ROOM #"+data.room_id+
    "\n状態："+outcome.state+"\n/myrooms から確認できます。");
  }catch(e){await ctx.reply("日時かROOMの状態を確認できません。/myrooms から開き直してください。");}
 });
 bot.command("roomreport",async ctx=>{
  if(ctx.chat.type!=="private")return;
  const parts=ctx.message.text.split(/\s+/);
  const roomId=Number(parts[1]);const kind=parts[2];
  if(!Number.isSafeInteger(roomId)||roomId<=0||!["join_failed","left"].includes(kind)){
   await ctx.reply("形式：/roomreport ROOM番号 join_failed または left");return;
  }
  await reportRoomParticipation(ctx.from.id,roomId,kind as "join_failed"|"left");
  await ctx.reply("参加状況の報告を記録しました。");
 });
}
