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
import * as approvalRepo from "../../repositories/approvalRepo.js";
import {sendLog} from "../../services/loggingService.js";
import {generateChallenge, type ChallengeQuestion} from "../../services/challengeService.js";
import {showWizardScreen} from "../../services/dmWizardScreen.js";
import {pool} from "../../db/index.js";
import {APPROVAL_DOC_KEYS, APPROVAL_QUESTIONS,
 APPROVAL_SUMMARY,RULES_CONSENT_QUESTION,hasAdoptedQuestions,isSafeDocUrl,
 ADMISSION_BOARD_CHAT_IDS,sharedAdmissionDocumentVersion} from "./contract.js";
import {openAttempt,readAttempt,rememberScreen,transition,consentsComplete,
 saveIssuedInvites,currentIssuedInvites,verifiedApprovalDocumentLinks,getRequestEligibility,
 withAdmissionClient,type GateAttempt} from "./store.js";

const token=()=>randomBytes(9).toString("hex");
const action=(a:GateAttempt,choice:string)=>`gba:${a.step_token}:${a.step}:${choice}`;
type BoardConfig={
 target:NonNullable<Awaited<ReturnType<typeof targetRepo.getTargetById>>>;
 ruleText:string;
 links:Record<"guideline"|"terms"|"privacy"|"rules",string>;
};
type GateConfig={
 target:BoardConfig["target"]; // Canonical owner of ONE common questionnaire.
 challenge:NonNullable<Awaited<ReturnType<typeof challengeRepo.getChallengeByTarget>>>;
 boards:BoardConfig[];
 documentVersion:string;
};
async function configured(targetId:number):Promise<GateConfig|null>{
 // Explicit allowlist prevents an unrelated legacy entry group joining the common gate.
 const mapped=await pool.query<{target_id:number;chat_id:string}>(`
  SELECT target_id,chat_id FROM targets
  WHERE target_type='entry_group' AND chat_id=ANY($1::bigint[])`,
  [ADMISSION_BOARD_CHAT_IDS]);
 if(mapped.rows.length!==3 || new Set(mapped.rows.map(x=>x.target_id)).size!==3 ||
  !mapped.rows.some(x=>Number(x.target_id)===targetId))return null;
 const boards:BoardConfig[]=[];
 for(const chatId of ADMISSION_BOARD_CHAT_IDS){
  const found=mapped.rows.filter(x=>Number(x.chat_id)===chatId);
  if(found.length!==1)return null;
  const candidate=await targetRepo.getTargetById(Number(found[0]!.target_id));
  if(!candidate || candidate.target_type!=="entry_group" ||
    Number(candidate.chat_id)!==chatId || !candidate.title.trim())return null;
  const [rule,links]=await Promise.all([
   ruleRepo.getRuleByTarget(candidate.target_id),
   verifiedApprovalDocumentLinks(candidate.chat_id)
  ]);
  if(!rule?.rule_text?.trim() || !links ||
   !APPROVAL_DOC_KEYS.every(k=>isSafeDocUrl(links[k]??"") &&
    !/^https:\/\/t\.me\/c\//i.test(links[k]??"")))return null;
  boards.push({target:candidate,ruleText:rule.rule_text,
   links:links as BoardConfig["links"]});
 }
 // Questions/Bot challenge are configured ONCE, not independently 3 times.
 // Reuse the earliest already-configured group in the adopted mapping.
 const existing=await Promise.all(boards.map(async b=>{
  const [challenge,questions]=await Promise.all([
   challengeRepo.getChallengeByTarget(b.target.target_id),
   questionRepo.getQuestionsByTarget(b.target.target_id)
  ]);
  return challenge?.enabled && challenge.max_fail===3 &&
   hasAdoptedQuestions(questions)?challenge:null;
 }));
 const canonicalIndex=existing.findIndex(Boolean);
 if(canonicalIndex<0 || boards.length!==3)return null;
 const documentVersion=sharedAdmissionDocumentVersion(boards.map(b=>({
  targetId:b.target.target_id,chatId:Number(b.target.chat_id),
  title:b.target.title,rulesText:b.ruleText,links:b.links,
 })));
 return {target:boards[canonicalIndex]!.target,challenge:existing[canonicalIndex]!,boards,documentVersion};
}
async function show(telegram:Telegram,a:GateAttempt,cfg:GateConfig):Promise<void>{
 if(a.document_version!==cfg.documentVersion)throw new Error("GATE_DOCUMENT_STALE");
 if(a.step==="approved"){
  const links=await currentIssuedInvites(a);
  const remaining=cfg.boards.flatMap((board,i)=>{
   const found=links.find(link=>link.targetId===board.target.target_id);
   return found?[Markup.button.url(`${i+1}．${board.target.title}`,found.link)]:[];
  });
  if(!remaining.length){
   const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,
    "審査済みの参加リンクは使用済み、または期限切れです。利用可能な参加リンクはありません。一定時間後に審査リンクから改めて申請してください。");
   await rememberScreen(a,out.messageId);
   return;
  }
  const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,
   "✅ 3グループ共通の承認が完了しました。各グループへの参加申請ボタンから進んでください。審査質問の再回答は不要です。",
   Markup.inlineKeyboard([remaining.slice(0,2),...(remaining.length>2?[remaining.slice(2)]:[])]));
  await rememberScreen(a,out.messageId);
  return;
 }
 let text="", rows:ReturnType<typeof Markup.button.callback>[][]=[];
 if(a.step==="intro"){
  text=`【3グループ共通の参加審査】\n${cfg.boards.map((b,i)=>`${i+1}．${b.target.title}`).join("\n")}\n\n参加前に各グループの①〜④の全文を確認してください。\n\n${APPROVAL_SUMMARY}\n\n確認後、Bot対策の問題から始まります。質問は3グループ共通で1回だけです。`;
  // URL buttons have a distinct Telegram type from callback buttons.
  if(text.length>4096)throw new Error("GATE_DOCUMENT_EXCEEDS_TELEGRAM_LIMIT");
  const docRows=cfg.boards.flatMap((board,i)=>[
   [Markup.button.url(`${i+1}①ガイドライン`,board.links.guideline),Markup.button.url(`${i+1}②規約`,board.links.terms)],
   [Markup.button.url(`${i+1}③Privacy Policy`,board.links.privacy),Markup.button.url(`${i+1}④グループルール`,board.links.rules)],
  ]);
  const links=Markup.inlineKeyboard([...docRows,
   [Markup.button.callback("✅ 確認して審査を開始",action(a,"continue"))],
  ]);
  const out=await showWizardScreen(telegram,Number(a.tg_user_id),a.last_message_id??undefined,text,links);
  await rememberScreen(a,out.messageId);
  return;
 }
 if(a.step==="challenge"){
  const q=a.challenge_data as ChallengeQuestion|null;
  if(!q || !Array.isArray(q.options) || !Number.isInteger(q.correctIndex))throw new Error("GATE_CHALLENGE_MISSING");
  text=`【3グループ共通・Bot対策】\nBotによる自動参加を防ぐため、問題に答えてください。\n\n${q.text}`;
  rows=[q.options.map((o,i)=>Markup.button.callback(o,action(a,String(i))))];
 }else if(a.step==="q1"||a.step==="q2"){
  const q=APPROVAL_QUESTIONS[a.step==="q1"?0:1];
  text=`【3グループ共通】\n${q.title}\n\n${q.text}`;
  rows=[[Markup.button.callback(q.yes,action(a,"yes")),
   Markup.button.callback(q.no,action(a,"no"))]];
 }else if(a.step==="rules"){
  text=`【3グループ共通・最終ルール承諾】\n${RULES_CONSENT_QUESTION}\n\n${cfg.boards.map((b,i)=>`【${i+1}．${b.target.title} のルール】\n${b.ruleText}`).join("\n\n")}`;
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
async function emitAdmissionLog(telegram:Telegram,userId:number,cfg:GateConfig,
 type:"approved"|"rejected"|"bot_failed",reason?:string):Promise<void>{
 try{
  const p=await approvalRepo.getLatestApproval(cfg.target.target_id,userId);
  await sendLog({telegram} as unknown as Telegraf,{
   type,targetTitle:cfg.target.title,userId,
   displayName:p?.display_name??String(userId),username:p?.username??undefined,
   isPremium:p?.is_premium??false,reason,
   logChatId:cfg.target.log_chat_id?Number(cfg.target.log_chat_id):null,
   logThreadId:cfg.target.log_thread_id?Number(cfg.target.log_thread_id):null,
  });
 }catch{console.warn("[GAYBBS_GATE] Admission log could not be delivered");}
}
async function issueInvite(telegram:Telegram,a:GateAttempt,cfg:GateConfig):Promise<void>{
 if(a.document_version!==cfg.documentVersion || a.step!=="issuing" ||
   !await consentsComplete(a))throw new Error("GATE_CONSENTS_INCOMPLETE");
 // Telegram needs one user-confirmed join request per group. The questionnaire,
 // acceptance and receipts are shared; nobody can be silently joined to a group.
 const expires=new Date(Date.now()+24*60*60*1000);
 const created:{chatId:number;targetId:number;link:string;expires:Date}[]=[];
 let saved=false;
 try{
  for(const board of cfg.boards){
   const link=await telegram.createChatInviteLink(board.target.chat_id,{
    name:"TGtumbler common admission",creates_join_request:true,
    expire_date:Math.floor(expires.getTime()/1000),
   });
   created.push({chatId:board.target.chat_id,targetId:board.target.target_id,
    link:link.invite_link,expires});
  }
  saved=await saveIssuedInvites(a,created);
  if(!saved)throw new Error("GATE_THREE_INVITES_PERSIST_FAILED");
 }finally{
  if(!saved){
   for(const entry of created){
    try{await telegram.revokeChatInviteLink(entry.chatId,entry.link)}
    catch{console.warn("[GAYBBS_GATE] Orphan invitation requires reconciliation");}
   }
  }
 }
 await emitAdmissionLog(telegram,Number(a.tg_user_id),cfg,"approved");
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
  const result=await openAttempt(ctx.from.id,cfg.target.target_id,token(),{
   username:ctx.from.username,
   displayName:[ctx.from.first_name,ctx.from.last_name].filter(Boolean).join(" "),
   isPremium:(ctx.from as {is_premium?:boolean}).is_premium??false,
  },cfg.documentVersion);
  if(result.attempt.step==="issuing"){
   await issueInvite(ctx.telegram,result.attempt,cfg);return;
  }
  await show(ctx.telegram,result.attempt,cfg);
 }catch(e){
  const message=e instanceof Error && e.message==="GATE_ANOTHER_TARGET_ACTIVE"
   ?"別のグループへの参加審査が進行中です。先にその審査を終えてください。"
   :e instanceof Error && e.message==="GATE_COOLDOWN"
   ?"連続申請は制限されています。一定時間後に改めて申請してください。"
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
 if(a.document_version!==cfg.documentVersion){
  await ctx.answerCbQuery("審査文書が更新されました。元の参加リンクから再申請してください。");
  return;
 }
 const reject=async(reason:string,consent?:{stage:"question1"|"question2"|"rules";accepted:boolean})=>{
  const changed=await transition({attempt:a,messageId,next:"rejected",newToken:token(),consent});
  if(!changed){await ctx.answerCbQuery("処理済みの操作です。");return}
  await ctx.answerCbQuery("参加申請を終了しました");
  await emitAdmissionLog(ctx.telegram,ctx.from!.id,cfg,step==="challenge"?"bot_failed":"rejected",reason);
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
   if(a.challenge_fails>=2){await reject("Bot対策の問題で3回不正解でした。");return}
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
  const cfg=await configured(targetId);
  if(!cfg)return; // Do not touch unknown/unverified groups.
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
     const check=await getRequestEligibility(c,{targetId,userId:applicant,url:inviteUrl,
      expectedDocumentVersion:cfg.documentVersion});
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
