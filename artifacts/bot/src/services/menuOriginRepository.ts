import { pool } from "../db/index.js";
import {assertMenuOrigin, decodeMenuStartPayload,tokenHash, type MenuOrigin} from "./menuOrigin.js";
export async function activateMenuOrigin(
 telegramUserId:number,startPayload:string
):Promise<MenuOrigin>{
 if(!Number.isSafeInteger(telegramUserId)||telegramUserId<=0)
  throw new Error("MENU_ACTOR_INVALID");
 const digest=tokenHash(decodeMenuStartPayload(startPayload));
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  const found=await c.query(
   `SELECT t.panel_id,t.feature,p.chat_id,p.message_thread_id
    FROM board_menu_entry_tokens t JOIN board_menu_panels p ON p.panel_id=t.panel_id
    WHERE t.token_hash=$1 AND t.enabled=TRUE AND t.expires_at>NOW()
      AND p.state='published'`,[digest]);
  if(found.rows.length!==1)throw new Error("MENU_ORIGIN_NOT_VERIFIED");
  const item=found.rows[0];
  const origin:MenuOrigin={
   panelId:Number(item.panel_id),feature:item.feature,
   chatId:Number(item.chat_id),threadId:Number(item.message_thread_id)
  };
  assertMenuOrigin(origin);
  await c.query(
   `INSERT INTO board_menu_sessions(owner_user_id,token_hash,feature,expires_at)
    VALUES($1,$2,$3,NOW()+INTERVAL '24 hours')
    ON CONFLICT(owner_user_id) DO UPDATE SET
      token_hash=EXCLUDED.token_hash,feature=EXCLUDED.feature,
      created_at=NOW(),expires_at=EXCLUDED.expires_at`,
   [telegramUserId,digest,origin.feature]);
  await c.query("COMMIT");
  return origin;
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
export async function currentMenuOrigin(userId:number):Promise<MenuOrigin|null>{
 const r=await pool.query(
  `SELECT p.panel_id,p.chat_id,p.message_thread_id,s.feature
   FROM board_menu_sessions s
   JOIN board_menu_entry_tokens t ON t.token_hash=s.token_hash
   JOIN board_menu_panels p ON p.panel_id=t.panel_id
   WHERE s.owner_user_id=$1 AND s.expires_at>NOW()
      AND t.enabled=TRUE AND t.expires_at>NOW() AND p.state='published'`,
  [userId]);
 if(r.rows.length!==1)return null;
 const x=r.rows[0];
 const origin:MenuOrigin={panelId:Number(x.panel_id),chatId:Number(x.chat_id),
  threadId:Number(x.message_thread_id),feature:x.feature};
 assertMenuOrigin(origin);
 return origin;
}
