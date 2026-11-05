/** @GayBBS_bot admission module: link -> verified documents -> arithmetic
 * -> exactly 2 accepted questions -> group rules -> user-bound join request.
 * Existing GateApp admin Bot handlers are not mounted or rewritten.
 */
import {randomBytes} from "node:crypto";
import {Markup, type Telegraf, type Context, type Telegram} from "telegraf";
import * as targetRepo from "../../repositories/targetRepo.js";
import * as questionRepo from "../../repositories/questionRepo.js";
import * as ruleRepo from "../../repositories/ruleRepo.js";
import * as challengeRepo from "../../repositories/challengeRepo.js";
import * as blacklistRepo from "../../repositories/blacklistRepo.js";
import {generateChallenge, type ChallengeQuestion} from "../../services/challengeService.js";
import {showWizardScreen} from "../../services/dmWizardScreen.js";
import {pool} from "../../db/index.js";
import {APPROVAL_DOC_KEYS, APPROVAL_QUESTIONS,
 APPROVAL_SUMMARY,RULES_CONSENT_QUESTION,hasAdoptedQuestions,isSafeDocUrl} from "./contract.js";
import {openAttempt,readAttempt,rememberScreen,transition,consentsComplete,
 saveIssuedInvite,currentIssuedInvite,verifiedApprovalDocumentLinks,getRequestEligibility,
 withAdmissionClient,type GateAttempt} from "./store.js";

const token=()=>randomBytes(9).toString("hex");
const action=(a:GateAttempt,choice:string)=>`gba:${a.step_token}:${a.step}:${choice}`;
type GateConfig={
 target:NonNullable<Awaited<ReturnType<typeof targetRepo.getTargetById>>>;
 challenge:NonNullable<Awaited<ReturnType<typeof challengeRepo.getChallengeByTarget>>>;
 rule:NonNullable<Awaited<ReturnType<typeof ruleRepo.getRuleByTarget>>>;
 links:Record<string,string>;
};
async function configured(targetId:number):Promise<GateConfig|null>{
 const target=await targetRepo.getTargetById(targetId);
 if(!target || target.target_type!=="entry_group" || !Number.isSafeInteger(target.chat_id)||target.chat_id>=0)return null;
 const [challenge,questions,rule,links]=await Promise.all([
  challengeRepo.getChallengeByTarget(targetId),questionRepo.getQuestionsByTarget(targetId),
  ruleRepo.getRuleByTarget(targetId),verifiedApprovalDocumentLinks(target.chat_id)
 ]);
 if(!challenge?.enabled || challenge.max_fail!==3 || !rule?.rule_text?.trim() ||
  !hasAdoptedQuestions(questions) || !links ||
  !APPROVAL_DOC_KEYS.every(k=>isSafeDocUrl(links[k]??"") &&
     // Private Telegram topic message links cannot be read by applicants.
     !/^https:\/\/t\.me\/c\//i.test(links[k]??"")))return null;
 return {target,challenge,rule,links};
}
async function show(telegram:Telegram,a:GateAttempt,cfg:GateConfig):Promise<void>{
 if(a.step==="approved"){
  const link=await currentIssuedInvite(a);
  if(!link)return;
  const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,
   `【${cfg.target.title}】\n✅ 審査が完了しました。下のボタンから本人が参加申請してください。`,
   Markup.inlineKeyboard([[Markup.button.url("🎉 参加申請へ",link)]]));
  await rememberScreen(a,out.messageId);
  return;
 }
 let text="", rows:ReturnType<typeof Markup.button.callback>[][]=[];
 if(a.step==="intro"){
  text=`【${cfg.target.title}】\n参加前に必ず①〜④の全文を確認してください。\n\n${APPROVAL_SUMMARY}\n\n全文を確認したら下のボタンから本人確認へ進んでください。`;
  // URL buttons have a distinct Telegram type from callback buttons.
  const links=Markup.inlineKeyboard([
   [Markup.button.url("①ガイドライン",cfg.links.guideline),Markup.button.url("②規約",cfg.links.terms)],
   [Markup.button.url("③Privacy Policy",cfg.links.privacy),Markup.button.url("④グループルール",cfg.links.rules)],
   [Markup.button.callback("✅ 確認して審査を開始",action(a,"continue"))],
  ]);
  const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,text,links);
  await rememberScreen(a,out.messageId);
  return;
 }
 if(a.step==="challenge"){
  const q=a.challenge_data as ChallengeQuestion|null;
  if(!q || !Array.isArray(q.options) || !Number.isInteger(q.correctIndex))throw new Error("GATE_CHALLENGE_MISSING");
  text=`【${cfg.target.title}】\n本人確認のため、問題に答えてください。\n\n${q.text}`;
  rows=[q.options.map((o,i)=>Markup.button.callback(o,action(a,String(i))))];
 }else if(a.step==="q1"||a.step==="q2"){
  const q=APPROVAL_QUESTIONS[a.step==="q1"?0:1];
  text=`【${cfg.target.title}】\n${q.title}\n\n${q.text}`;
  rows=[[Markup.button.callback(q.yes,action(a,"yes")),
   Markup.button.callback(q.no,action(a,"no"))]];
 }else if(a.step==="rules"){
  text=`【${cfg.target.title}】\n最終ルール承諾\n\n${RULES_CONSENT_QUESTION}\n\n【${cfg.target.title} の固有ルール】\n${cfg.rule.rule_text}`;
  rows=[[Markup.button.callback("✅規則・ルールを承諾する",action(a,"yes")),
   Markup.button.callback("❌承諾しない",action(a,"no"))]];
 }else{return}
 // Telegram text messages have a 4096-character limit: never silently truncate rules.
 if(text.length>4096)throw new Error("GATE_DOCUMENT_EXCEEDS_TELEGRAM_LIMIT");
 const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,
  text,Markup.inlineKeyboard(rows));
 await rememberScreen(a,out.messageId);
}
async function denyScreen(telegram:Telegram,a:GateAttempt,reason:string):Promise<void>{
 const msg=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,
  `今回は参加できません。理由：${reason}\n必要な場合は、条件を確認して改めて申請してください。`);
 await rememberScreen(a,msg.messageId);
}
async function issueInvite(telegram:Telegram,a:GateAttempt,cfg:GateConfig):Promise<void>{
 if(a.step!=="issuing" || !await consentsComplete(a))throw new Error("GATE_CONSENTS_INCOMPLETE");
 // Never use member_limit with creates_join_request. Only the verified applicant
 // will be approved when Telegram sends chat_join_request.
 const expires=new Date(Date.now()+24*60*60*1000);
 const created=await telegram.createChatInviteLink(cfg.target.chat_id,{
  name:"GayBBS admission",creates_join_request:true,
  expire_date:Math.floor(expires.getTime()/1000),
 });
 let saved=false;
 try{saved=await saveIssuedInvite(a,created.invite_link,expires)}
 finally{
  if(!saved){
   try{await telegram.revokeChatInviteLink(cfg.target.chat_id,created.invite_link)}
   catch{console.error("[GAYBBS_GATE] Orphan invite requires reconciliation");}
  }
 }
 if(!saved)throw new Error("GATE_INVITE_PERSIST_FAILED");
 const next=await readAttempt(Number(a.tg_user_id));
 if(next)await show(telegram,next,cfg);
}
export async function startGayBbsAdmission(ctx:Context,payload:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 const gateCode=payload.startsWith("gate_")?payload.slice(5):"";
 if(!/^[a-zA-Z0-9_-]{1,48}$/.test(gateCode)){
  await ctx.reply("参加申請リンクが無効です。");return;
 }
 const target=await targetRepo.getTargetByGateCode(gateCode);
 if(!target){await ctx.reply("参加申請リンクが無効です。");return}
 const cfg=await configured(target.target_id);
 if(!cfg){await ctx.reply("参加審査の設定・公開文書が未確認のため、現在申請できません。");return}
 if(!ctx.from.username){
  await ctx.reply("Telegramのユーザーネームを設定してから申請してください。");return;
 }
 const bl=await blacklistRepo.getBlacklisted(ctx.from.id);
 if(bl?.status==="blocked"){
  await ctx.reply("参加できません。");return;
 }
 try{
  const result=await openAttempt(ctx.from.id,target.target_id,token());
  if(result.attempt.step==="issuing"){
   await issueInvite(ctx.telegram,result.attempt,cfg);return;
  }
  await show(ctx.telegram,result.attempt,cfg);
 }catch(e){
  const message=e instanceof Error && e.message==="GATE_ANOTHER_TARGET_ACTIVE"
   ?"別のグループへの参加審査が進行中です。先にその審査を終えてください。"
   :"申請処理を続行できません。後ほど同じ審査リンクから再開してください。";
  await ctx.reply(message);
 }
}
async function onAction(ctx:Context,step:string,choice:string,stepToken:string):Promise<void>{
 if(ctx.chat?.type!=="private"||!ctx.from)return;
 const messageId=("message" in (ctx.callbackQuery??{}))?
  (ctx.callbackQuery as {message?:{message_id?:number}}).message?.message_id:undefined;
 const a=await readAttempt(ctx.from.id);
 if(!a||a.step!==step||a.step_token!==stepToken||
  !messageId||a.last_message_id!==messageId){
  await ctx.answerCbQuery("このボタンは期限切れです。");return;
 }
 const cfg=await configured(a.target_id);
 if(!cfg){await ctx.answerCbQuery("審査設定を確認できません。");return}
 const reject=async(reason:string,consent?:{stage:"question1"|"question2"|"rules";accepted:boolean})=>{
  const changed=await transition({attempt:a,messageId,next:"rejected",newToken:token(),consent});
  if(!changed){await ctx.answerCbQuery("処理済みの操作です。");return}
  await ctx.answerCbQuery("参加申請を終了しました");
  const updated=await readAttempt(ctx.from!.id);
  if(updated)await denyScreen(ctx.telegram,updated,reason);
 };
 if(step==="intro"){
  if(choice!=="continue"){await ctx.answerCbQuery("無効な操作です");return}
  const q=generateChallenge(cfg.challenge.difficulty);
  const changed=await transition({attempt:a,messageId,next:"challenge",newToken:token(),challengeData:q});
  if(!changed){await ctx.answerCbQuery("処理済みです");return}
 }else if(step==="challenge"){
  const q=a.challenge_data as ChallengeQuestion|null;
  const index=Number(choice);
  if(!q||!Number.isInteger(index)||index<0||index>=q.options.length){
   await ctx.answerCbQuery("無効な操作です");return;
  }
  if(index!==q.correctIndex){
   if(a.challenge_fails>=2){await reject("本人確認の3回の回答が不正解でした。");return}
   const changed=await transition({attempt:a,messageId,next:"challenge",newToken:token(),
    fails:a.challenge_fails+1,challengeData:generateChallenge(cfg.challenge.difficulty)});
   if(!changed){await ctx.answerCbQuery("処理済みです");return}
  }else{
   const changed=await transition({attempt:a,messageId,next:"q1",newToken:token()});
   if(!changed){await ctx.answerCbQuery("処理済みです");return}
  }
 }else if(step==="q1"||step==="q2"||step==="rules"){
  if(choice!=="yes"&&choice!=="no"){await ctx.answerCbQuery("無効な操作です");return}
  const consent=step==="q1"?"question1":step==="q2"?"question2":"rules";
  if(choice==="no"){await reject("参加条件または規約への承諾がありません。",{stage:consent,accepted:false});return}
  const next=step==="q1"?"q2":step==="q2"?"rules":"issuing";
  const changed=await transition({attempt:a,messageId,next,newToken:token(),
   consent:{stage:consent,accepted:true}});
  if(!changed){await ctx.answerCbQuery("処理済みです");return}
 }else{await ctx.answerCbQuery("無効な操作です");return}
 await ctx.answerCbQuery();
 const updated=await readAttempt(ctx.from.id);
 if(!updated)return;
 if(updated.step==="issuing")await issueInvite(ctx.telegram,updated,cfg);
 else await show(ctx.telegram,updated,cfg);
}
export function registerGayBbsApprovalHandlers(bot:Telegraf):void{
 bot.action(/^gba:([0-9a-f]{18}):(intro|challenge|q1|q2|rules):([a-z0-9]+)$/,async ctx=>{
  try{await onAction(ctx,ctx.match[2]!,ctx.match[3]!,ctx.match[1]!)}
  catch{try{await ctx.answerCbQuery("処理に失敗しました。審査リンクから再開してください。")}catch{}
   console.error("[GAYBBS_GATE] Callback failed");}
 });
 bot.on("chat_join_request",async ctx=>{
  const req=ctx.chatJoinRequest;
  const mapped=await pool.query("SELECT target_id FROM targets WHERE chat_id=$1 AND target_type='entry_group'",[req.chat.id]);
  if(mapped.rowCount!==1)return; // Don't touch unowned or ambiguous groups.
  const targetId=Number(mapped.rows[0].target_id);
  const applicant=req.from.id;
  const inviteUrl=req.invite_link?.invite_link;
  const blocked=await blacklistRepo.getBlacklisted(applicant);
  if(!req.from.username||blocked?.status==="blocked"||!inviteUrl){
   try{await ctx.telegram.declineChatJoinRequest(req.chat.id,applicant)}catch{}
   return;
  }
  let granted=false;
  try{
   await withAdmissionClient(async c=>{
    await c.query("BEGIN");
    try{
     const check=await getRequestEligibility(c,{targetId,userId:applicant,url:inviteUrl});
     if(!check.allowed||check.inviteId===null){
      await c.query("ROLLBACK");return;
     }
     // The invite row is locked until Telegram's decision and the used receipt.
     await ctx.telegram.approveChatJoinRequest(req.chat.id,applicant);
     await c.query("UPDATE invite_links SET used_at=NOW() WHERE invite_id=$1",[check.inviteId]);
     await c.query("COMMIT");
     granted=true;
    }catch(e){await c.query("ROLLBACK");throw e}
   });
  }catch{console.error("[GAYBBS_GATE] Join-request reconciliation required");return}
  if(!granted){
   try{await ctx.telegram.declineChatJoinRequest(req.chat.id,applicant)}catch{}
   return;
  }
  try{await ctx.telegram.revokeChatInviteLink(req.chat.id,inviteUrl)}
  catch{console.warn("[GAYBBS_GATE] Used invite revoke failed; DB replay guard remains");}
 });
}
