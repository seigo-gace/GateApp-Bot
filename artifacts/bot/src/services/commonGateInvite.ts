/** Reuse the existing three-board admission gate, never mint a new invitation. */
import {pool} from "../db/index.js";
import {ADMISSION_BOARD_CHAT_IDS} from "../modules/gaybbsApproval/contract.js";

export function gateInviteCopyButton(label:string,url:string){
 if(!/^https:\/\/t\.me\/GayBBS_bot\?start=gate_[A-Za-z0-9_-]{1,48}$/.test(url))
  throw new Error("COMMON_GATE_URL_INVALID");
 return {text:label,copy_text:{text:url}};
}
/** One questionnaire; the approved user chooses among all three groups. */
export async function commonGateUrl():Promise<string>{
 const r=await pool.query<{chat_id:string;gate_code:string}>(`
 SELECT chat_id,gate_code FROM targets
 WHERE target_type='entry_group' AND chat_id=ANY($1::bigint[])
 ORDER BY chat_id`,[ADMISSION_BOARD_CHAT_IDS]);
 if(r.rows.length!==ADMISSION_BOARD_CHAT_IDS.length ||
    new Set(r.rows.map(x=>String(x.chat_id))).size!==ADMISSION_BOARD_CHAT_IDS.length ||
    r.rows.some(x=>!ADMISSION_BOARD_CHAT_IDS.includes(Number(x.chat_id) as typeof ADMISSION_BOARD_CHAT_IDS[number]) ||
      !/^[A-Za-z0-9_-]{1,48}$/.test(String(x.gate_code))))
  throw new Error("COMMON_GATE_ROUTE_NOT_VERIFIED");
 return "https://t.me/GayBBS_bot?start=gate_"+r.rows[0]!.gate_code;
}
