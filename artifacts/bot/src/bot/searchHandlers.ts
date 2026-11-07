/** Shared read-only DM search: no new posting engine or private-data exposure. */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {PROFILE_AREA_BLOCKS} from "../services/profileArea.js";
import {PROFILE_POSITIONS} from "../services/profileCore.js";
import {PURPOSE_TAGS} from "../services/announcementTags.js";
import {selectionRows} from "../services/inlineSelection.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {beginSearch,getSearchSession,updateSearch,bindSearchScreen,findPublicSearchHits,type SearchSession} from "../services/searchRepository.js";
import {setSearchFilter,initialSearchFilters} from "../services/searchDomain.js";
const dm=(c:any)=>c.chat?.type==="private";
const button=(text:string,data:string)=>Markup.button.callback(text,data);
async function show(t:Telegram,id:number,s:SearchSession,text:string,rows:any[][]){
 const view=await showWizardScreen(t,id,s.screenMessageId??undefined,text,Markup.inlineKeyboard(rows));
 if(view.messageId!==s.screenMessageId)await bindSearchScreen(id,s.revision,view.messageId);
}
function homeRows(s:SearchSession){
 const r=s.revision;
 return [[button("🔍 キーワード検索",`search:keyword:${r}`),button("🎛 詳細フィルター",`search:filter:${r}`)],
 [button(s.filters.kind==="profile"?"✅ プロフ":"▫️ プロフ",`search:kind:${r}:profile`),
  button(s.filters.kind==="recruitment"?"✅ 相手募集":"▫️ 相手募集",`search:kind:${r}:recruitment`)],
 [button("🔎 検索実行",`search:run:${r}`),button("条件クリア",`search:clear:${r}`)],
 [button("↩ 戻る",`search:back:${r}`)]];
}
function summary(s:SearchSession){
 const f=s.filters;return "🔍 検索/フィルター\n対象："+(f.kind==="profile"?"プロフィール":"相手募集")+
 "\nキーワード："+(f.keyword||"指定なし")+"\nエリア："+(f.region||"指定なし")+
 "\nポジション："+(f.position||"指定なし")+"\n目的："+(f.purpose||"指定なし")+
 "\n公開済み投稿から検索します。";
}
async function home(t:Telegram,id:number,s:SearchSession){await show(t,id,s,summary(s),homeRows(s));}
function options(s:SearchSession,key:"region"|"position"|"purpose"){
 const items=key==="region"?PROFILE_AREA_BLOCKS:key==="position"?PROFILE_POSITIONS:PURPOSE_TAGS;
 const rows=[] as any[][];
 for(let i=0;i<items.length;i+=3){
  const group=items.slice(i,i+3).map((label,j)=>({label,index:i+j}));
  rows.push(...selectionRows([group.map(x=>x.label)],s.filters[key]?[s.filters[key]!]:[],
    label=>`search:pick:${s.revision}:${key}:${items.indexOf(label as never)}`).map(r=>r.map(x=>Markup.button.callback(x.text,x.callback_data))));
 }
 rows.push([button("↩ 戻る",`search:filter:${s.revision}`)]);
 return rows;
}
async function filter(t:Telegram,id:number,s:SearchSession){
 await show(t,id,s,summary(s)+"\n\n絞り込む項目を選択してください。",[
  [button("📍 エリア",`search:panel:${s.revision}:region`),
   button("ポジション",`search:panel:${s.revision}:position`),
   button("目的",`search:panel:${s.revision}:purpose`)],
  [button("🔎 検索実行",`search:run:${s.revision}`),button("↩ 戻る",`search:back:${s.revision}`)]]);
}
async function results(t:Telegram,id:number,s:SearchSession,page:number){
 const offset=page*5;
 const found=await findPublicSearchHits(s.filters,offset);
 const rows=found.hits.map((hit,i)=>[Markup.button.url((offset+i+1)+". "+hit.title,hit.url)]);
 const nav=[] as any[];
 if(page>0)nav.push(button("◀ 前へ",`search:page:${s.revision}:${page-1}`));
 if(found.hasNext)nav.push(button("次へ ▶",`search:page:${s.revision}:${page+1}`));
 if(nav.length)rows.push(nav);
 rows.push([button("🎛 条件変更",`search:filter:${s.revision}`),button("↩ 戻る",`search:back:${s.revision}`)]);
 const detail=found.hits.map((h,i)=>(offset+i+1)+". "+h.title+"｜"+h.description).join("\n");
 await show(t,id,s,summary(s)+"\n\n検索結果\n"+(detail||"該当する公開投稿はありません。"),rows);
}
export async function startSearchEditor(t:Telegram,id:number){
 const old=await getSearchSession(id);
 const s=old??await beginSearch(id);await home(t,id,s);
}
export function registerSearchHandlers(bot:Telegraf){
 bot.command("search",async ctx=>{if(dm(ctx))await startSearchEditor(ctx.telegram,ctx.from.id);});
 bot.action(/^search:(keyword|filter|run|clear|back):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const op=ctx.match[1],rev=Number(ctx.match[2]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev){await ctx.answerCbQuery("古い操作です。/search で再開してください。");return;}
  await ctx.answerCbQuery();
  if(op==="keyword"){
   const next=await updateSearch(ctx.from.id,rev,"keyword",s.filters);
   await show(ctx.telegram,ctx.from.id,next,"検索キーワードを1通で送ってください。（80文字以内）",
    [[button("↩ 戻る",`search:back:${next.revision}`)]]);
  }else if(op==="filter"){const next=await updateSearch(ctx.from.id,rev,"home",s.filters);await filter(ctx.telegram,ctx.from.id,next);}
  else if(op==="clear"){const next=await updateSearch(ctx.from.id,rev,"home",initialSearchFilters());await home(ctx.telegram,ctx.from.id,next);}
  else if(op==="run"){const next=await updateSearch(ctx.from.id,rev,"results",s.filters);await results(ctx.telegram,ctx.from.id,next,0);}
  else{const next=await updateSearch(ctx.from.id,rev,"home",s.filters);await home(ctx.telegram,ctx.from.id,next);}
 });
 bot.action(/^search:kind:(\d+):(profile|recruitment)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev){await ctx.answerCbQuery("古い操作です");return;}
  const next=await updateSearch(ctx.from.id,rev,"home",{...s.filters,kind:ctx.match[2] as "profile"|"recruitment"});
  await ctx.answerCbQuery();await home(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^search:panel:(\d+):(region|position|purpose)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),key=ctx.match[2] as "region"|"position"|"purpose";
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev){await ctx.answerCbQuery("古い操作です");return;}
  const next=await updateSearch(ctx.from.id,rev,key,s.filters);
  await ctx.answerCbQuery();await show(ctx.telegram,ctx.from.id,next,
   summary(next)+"\n\n"+key+"を選択（再押下で解除）",options(next,key));
 });
 bot.action(/^search:pick:(\d+):(region|position|purpose):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),key=ctx.match[2] as "region"|"position"|"purpose",idx=Number(ctx.match[3]);
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!==key){await ctx.answerCbQuery("古い操作です");return;}
  const values=key==="region"?PROFILE_AREA_BLOCKS:key==="position"?PROFILE_POSITIONS:PURPOSE_TAGS;
  if(!Number.isSafeInteger(idx)||idx<0||idx>=values.length){await ctx.answerCbQuery("選択肢が不正です");return;}
  const next=await updateSearch(ctx.from.id,rev,key,setSearchFilter(s.filters,key,values[idx]!));
  await ctx.answerCbQuery();await show(ctx.telegram,ctx.from.id,next,summary(next)+"\n\n"+key+"を選択（再押下で解除）",options(next,key));
 });
 bot.action(/^search:page:(\d+):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),page=Number(ctx.match[2]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!=="results"||!Number.isSafeInteger(page)||page>200){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();await results(ctx.telegram,ctx.from.id,s,page);
 });
 bot.on("text",async(ctx,next)=>{
  if(!dm(ctx)||ctx.message.text.startsWith("/"))return next();
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.step!=="keyword")return next();
  if(await currentDmTextOwner(ctx.from.id))return next();
  const deleted=await removeUserWizardInput(ctx.telegram,ctx.chat.id,ctx.message.message_id);
  const keyword=ctx.message.text.trim();
  if(keyword.length>80||/[\u0000-\u001f]/.test(keyword)){
   await show(ctx.telegram,ctx.from.id,s,"検索キーワードは80文字以内で入力してください。"+
    (deleted?"":"\n⚠️ 入力メッセージは手動削除してください。"),
    [[button("↩ 戻る",`search:back:${s.revision}`)]]);
   return;
  }
  const next=await updateSearch(ctx.from.id,s.revision,"home",{...s.filters,keyword});
  await home(ctx.telegram,ctx.from.id,next);
 });
}
