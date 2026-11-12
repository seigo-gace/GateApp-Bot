/**
 * STK-04 one-time bootstrap for the existing Master-supplied sticker Topic:
 * https://t.me/c/2373696859/4640 .
 *
 * 4640 is a candidate URL message position, NOT an independently verified
 * message_thread_id. Only a Telegram sendMessage result containing that
 * exact thread id may promote the provisional DB row to verified.
 *
 * Existing verified Topic mappings, sales ledgers, Bot sessions and Userbot
 * are never replaced. The DB receipt is claimed BEFORE any Telegram write,
 * and an uncertain write is never automatically replayed.
 */
const DESTINATION={chatId:-1002373696859,candidateThread:4640,
 title:"ステッカーの公開と販売",ownerBot:"GayBBS_bot",
 targetBot:"CreateVdobot"} as const;

type Api=(method:string,params:Record<string,unknown>)=>Promise<unknown>;
type Row={ [key:string]:unknown };
type Client={
 query(sql:string,args?:unknown[]):Promise<{rows:Row[];rowCount:number|null}>;
 release():void;
};
type Store={connect():Promise<Client>};

async function transaction<T>(pool:Store,fn:(client:Client)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  const result=await fn(db);
  await db.query("COMMIT");
  return result;
 }catch(e){
  await db.query("ROLLBACK").catch(()=>{});
  throw e;
 }finally{db.release();}
}

export async function bootstrapExistingStickerTopic({
 api,pool
}:{api:Api;pool:Store}):Promise<{
 acknowledged:boolean;messageId:number|null;threadVerified:boolean;
 alreadyAcknowledged:boolean;
}>{
 if(typeof api!=="function"||typeof pool?.connect!=="function")
  throw Error("STICKER_BOOTSTRAP_DEPENDENCIES_REQUIRED");
 const me=await api("getMe",{}) as {id?:number;username?:string;is_bot?:boolean}|null;
 if(me?.is_bot!==true||!Number.isSafeInteger(me.id)||
    me.username?.toLowerCase()!==DESTINATION.ownerBot.toLowerCase())
  throw Error("STICKER_BOOTSTRAP_GROUP_BOT_NOT_VERIFIED");
 const chat=await api("getChat",{chat_id:DESTINATION.chatId}) as
  {id?:number;type?:string;is_forum?:boolean;title?:string}|null;
 if(chat?.id!==DESTINATION.chatId||chat.type!=="supergroup"||
    chat.is_forum!==true)
  throw Error("STICKER_BOOTSTRAP_GROUP_FORUM_NOT_VERIFIED");
 const rights=await api("getChatMember",{
  chat_id:DESTINATION.chatId,user_id:me.id}) as
  {status?:string;can_pin_messages?:boolean}|null;
 if(!rights||!["administrator","creator"].includes(String(rights.status))||
    (rights.status==="administrator"&&rights.can_pin_messages!==true))
  throw Error("STICKER_BOOTSTRAP_ADMIN_PIN_RIGHT_REQUIRED");

 const claimed=await transaction(pool,async db=>{
  // Add exactly the current sticker owner's two adopted schema changes.
  // No generic migration of unrelated profiles, Rooms, GATE or sales tables.
  await db.query("ALTER TABLE posting_topics DROP CONSTRAINT IF EXISTS posting_topics_purpose_check");
  await db.query(
   "ALTER TABLE posting_topics ADD CONSTRAINT posting_topics_purpose_check"+
   " CHECK (purpose IN ('profile','room','announcement','link','sticker'))"
  );
  await db.query(
   "CREATE TABLE IF NOT EXISTS posting_sticker_entry_pins ("+
   " topic_id BIGINT PRIMARY KEY REFERENCES posting_topics(topic_id) ON DELETE RESTRICT,"+
   " creator_bot_id BIGINT NULL CHECK (creator_bot_id>0),"+
   " creator_bot_username TEXT NOT NULL CHECK (creator_bot_username ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$'),"+
   " status TEXT NOT NULL CHECK (status IN ('sending','sent','pin_requested','pinned_ack','needs_reconcile')),"+
   " telegram_message_id BIGINT NULL CHECK(telegram_message_id>0),"+
   " created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
   " updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
   " CHECK(status='sending' OR telegram_message_id IS NOT NULL))"
  );
  await db.query("ALTER TABLE posting_sticker_entry_pins ALTER COLUMN creator_bot_id DROP NOT NULL");
  // Independent operators cannot claim this Topic simultaneously.
  await db.query("SELECT pg_advisory_xact_lock($1,$2)",[237369685,4640]);
  const conflicts=await db.query(
   "SELECT purpose,title FROM posting_topics WHERE chat_id=$1 AND message_thread_id=$2"+
   " AND (purpose<>'sticker' OR title<>$3)",
   [DESTINATION.chatId,DESTINATION.candidateThread,DESTINATION.title]
  );
  if(conflicts.rows.length)throw Error("STICKER_BOOTSTRAP_THREAD_OWNED_BY_DIFFERENT_PURPOSE");
  const inserted=await db.query(
   "INSERT INTO posting_topics"+
   " (board_key,purpose,chat_id,message_thread_id,title,verified_by,verified_at,enabled)"+
   " VALUES('video_chat','sticker',$1,$2,$3,NULL,NULL,FALSE)"+
   " ON CONFLICT(board_key,purpose,chat_id,message_thread_id) DO NOTHING RETURNING topic_id",
   [DESTINATION.chatId,DESTINATION.candidateThread,DESTINATION.title]
  );
  const row=inserted.rows[0]??(await db.query(
   "SELECT topic_id FROM posting_topics WHERE board_key='video_chat' AND purpose='sticker'"+
   " AND chat_id=$1 AND message_thread_id=$2 AND title=$3",
   [DESTINATION.chatId,DESTINATION.candidateThread,DESTINATION.title]
  )).rows[0];
  if(!row||!Number.isSafeInteger(Number(row.topic_id)))
   throw Error("STICKER_BOOTSTRAP_TOPIC_RECEIPT_UNAVAILABLE");
  const topicId=Number(row.topic_id);
  const receipt=await db.query(
   "INSERT INTO posting_sticker_entry_pins"+
   " (topic_id,creator_bot_id,creator_bot_username,status)"+
   " VALUES($1,NULL,$2,'sending')"+
   " ON CONFLICT(topic_id) DO NOTHING RETURNING status",
   [topicId,DESTINATION.targetBot]
  );
  if(receipt.rowCount===1)return {topicId,claimed:true,prior:"sending"};
  const previous=await db.query(
   "SELECT status,telegram_message_id,creator_bot_username"+
   " FROM posting_sticker_entry_pins WHERE topic_id=$1",
   [topicId]
  );
  const p=previous.rows[0];
  if(!p||String(p.creator_bot_username).toLowerCase()!==DESTINATION.targetBot.toLowerCase())
   throw Error("STICKER_BOOTSTRAP_EXISTING_RECEIPT_WRONG_OWNER");
  return {topicId,claimed:false,prior:String(p.status),
   messageId:Number(p.telegram_message_id??0)};
 });
 if(!claimed.claimed){
  if(claimed.prior==="pinned_ack"&&Number(claimed.messageId)>0)
   return {acknowledged:true,messageId:Number(claimed.messageId),
    threadVerified:true,alreadyAcknowledged:true};
  throw Error("STICKER_BOOTSTRAP_PRIOR_SEND_NEEDS_RECONCILE");
 }
 const text="📌 ステッカーの作成・公開・販売はこちら\n"+
   "ステッカーやカスタム絵文字の作成、管理、販売はBotのDMから操作してください。";
 const reply_markup={inline_keyboard:[[{text:"ステッカーの作成・公開・販売はこちら",
  url:"https://t.me/"+DESTINATION.targetBot+"?start=sticker"}]]};
 // This is the FIRST actual proof of the candidate thread. No pinning before
 // the returned Telegram Message confirms the requested forum destination.
 type TelegramSent={chat?:{id?:number};message_id?:number;
   message_thread_id?:number;is_topic_message?:boolean};
 let message:TelegramSent;
 try{
  message=await api("sendMessage",{
   chat_id:DESTINATION.chatId,
   message_thread_id:DESTINATION.candidateThread,
   text,reply_markup
  }) as TelegramSent;
 }catch{
  // Persistent receipt stays "sending": no second Telegram send on retry.
  throw Error("STICKER_BOOTSTRAP_SEND_FAILED_OR_UNKNOWN");
 }
 const messageId=Number(message?.message_id);
 if(message?.chat?.id!==DESTINATION.chatId||
    !Number.isSafeInteger(messageId)||messageId<=0||
    message.message_thread_id!==DESTINATION.candidateThread||
    message.is_topic_message!==true){
  if(message?.chat?.id===DESTINATION.chatId&&Number.isSafeInteger(messageId)&&messageId>0)
   await api("deleteMessage",{chat_id:DESTINATION.chatId,message_id:messageId})
    .catch(()=>{});
  throw Error("STICKER_BOOTSTRAP_SEND_THREAD_NOT_CONFIRMED");
 }
 await transaction(pool,async db=>{
  const changed=await db.query(
   "UPDATE posting_topics SET verified_by=$2,verified_at=NOW(),enabled=TRUE"+
   " WHERE topic_id=$1 AND board_key='video_chat' AND purpose='sticker'"+
   " AND title=$3 AND enabled=FALSE RETURNING topic_id",
   [claimed.topicId,me.id,DESTINATION.title]
  );
  if(changed.rowCount!==1)throw Error("STICKER_BOOTSTRAP_TOPIC_VERIFICATION_CAS");
  const receipt=await db.query(
   "UPDATE posting_sticker_entry_pins"+
   " SET status='sent',telegram_message_id=$2,updated_at=NOW()"+
   " WHERE topic_id=$1 AND status='sending' RETURNING topic_id",
   [claimed.topicId,messageId]
  );
  if(receipt.rowCount!==1)throw Error("STICKER_BOOTSTRAP_POST_RECEIPT_CAS");
 });
 let pinResult:unknown;
 try{
  pinResult=await api("pinChatMessage",{
   chat_id:DESTINATION.chatId,message_id:messageId,disable_notification:true
  });
 }catch{
  await transaction(pool,async db=>{
   await db.query(
    "UPDATE posting_sticker_entry_pins SET status='needs_reconcile',updated_at=NOW()"+
    " WHERE topic_id=$1 AND status='sent'",[claimed.topicId]);
  }).catch(()=>{});
  throw Error("STICKER_BOOTSTRAP_PIN_ACK_UNKNOWN");
 }
 if(pinResult!==true)throw Error("STICKER_BOOTSTRAP_PIN_ACK_NOT_TRUE");
 await transaction(pool,async db=>{
  const r=await db.query(
   "UPDATE posting_sticker_entry_pins"+
   " SET status='pinned_ack',updated_at=NOW()"+
   " WHERE topic_id=$1 AND status='sent' RETURNING topic_id",
   [claimed.topicId]
  );
  if(r.rowCount!==1)throw Error("STICKER_BOOTSTRAP_PIN_RECEIPT_CAS");
 });
 return {acknowledged:true,threadVerified:true,
  messageId,alreadyAcknowledged:false};
}
