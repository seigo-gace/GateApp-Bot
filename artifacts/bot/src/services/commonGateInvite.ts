/** Copy the ONE existing canonical questionnaire Gate; group selection is downstream. */
import {pool} from "../db/index.js";
import {ADMISSION_BOARD_CHAT_IDS,hasAdoptedQuestions} from "../modules/gaybbsApproval/contract.js";

export function gateInviteCopyButton(label:string,url:string){
 if(!/^https:\/\/t\.me\/GayBBS_bot\?start=gate_[A-Za-z0-9_-]{1,48}$/.test(url))
  throw new Error("COMMON_GATE_URL_INVALID");
 return {text:label,copy_text:{text:url}};
}
/** Match the approval handler's existing first-configured Gate, not the first group ID. */
export async function commonGateUrl():Promise<string>{
 const candidates=await pool.query<{target_id:number;gate_code:string;chat_id:string}>(`
 SELECT t.target_id,t.gate_code,t.chat_id
 FROM targets t
 JOIN bot_challenges c ON c.target_id=t.target_id
 WHERE t.target_type='entry_group' AND t.chat_id=ANY($1::bigint[])
   AND c.enabled=TRUE AND c.max_fail=3
 ORDER BY array_position($1::bigint[],t.chat_id)
 `,[ADMISSION_BOARD_CHAT_IDS]);
 for(const candidate of candidates.rows){
  if(!/^[A-Za-z0-9_-]{1,48}$/.test(candidate.gate_code))continue;
  const questions=await pool.query<{
   order_index:number;enabled:boolean;question_text:string;
   button1_label:string;button2_label:string;correct_button:number
  }>(`SELECT order_index,enabled,question_text,button1_label,button2_label,correct_button
      FROM questions WHERE target_id=$1 ORDER BY order_index`,[candidate.target_id]);
  if(hasAdoptedQuestions(questions.rows))
   return "https://t.me/GayBBS_bot?start=gate_"+candidate.gate_code;
 }
 throw new Error("COMMON_GATE_ROUTE_NOT_VERIFIED");
}
