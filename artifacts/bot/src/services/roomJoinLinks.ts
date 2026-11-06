/** Public ROOM entry is a Bot DM deep link, NEVER a meeting URL.
 * The only source of access is roomAccess, which gates until LIVE.
 */
import {randomBytes} from "node:crypto";
import {pool} from "../db/index.js";
import {getAuthorizedRoom} from "./roomAccess.js";

const TOKEN=/^[A-Za-z0-9_-]{32}$/;
function id(n:number):number{
 if(!Number.isSafeInteger(n)||n<=0)throw new Error("ROOM_LINK_ID_INVALID");
 return n;
}
export function roomJoinUrl(token:string):string{
 if(!TOKEN.test(token))throw new Error("ROOM_JOIN_TOKEN_INVALID");
 return "https://t.me/GayBBS_bot?start=j_"+token;
}
export async function makeRoomJoinLink(ownerId:number,roomId:number):Promise<string>{
 id(ownerId);id(roomId);
 const random=randomBytes(24).toString("base64url");
 const row=await pool.query(
  `INSERT INTO room_join_links(room_id,token)
    SELECT room_id,$3 FROM room_posts WHERE room_id=$1 AND owner_user_id=$2
    ON CONFLICT(room_id) DO UPDATE SET token=room_join_links.token
    RETURNING token`,[roomId,ownerId,random]);
 if(row.rows.length!==1)throw new Error("ROOM_LINK_NOT_OWNED");
 return roomJoinUrl(String(row.rows[0].token));
}
export async function resolveRoomJoinLink(userId:number,payload:string):
 Promise<{id:number;title:string;joinUrl:string}|null>{
 id(userId);
 const match=/^j_([A-Za-z0-9_-]{32})$/.exec(payload);
 if(!match)return null;
 const found=await pool.query(
  "SELECT room_id FROM room_join_links WHERE token=$1 AND enabled=TRUE",
  [match[1]]);
 if(found.rows.length!==1)return null;
 return getAuthorizedRoom(userId,Number(found.rows[0].room_id));
}
