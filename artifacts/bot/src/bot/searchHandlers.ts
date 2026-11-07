/** Shared read-only DM search: no new posting engine or private-data exposure. */
import {Markup,type Telegraf,type Telegram} from "telegraf";
import {PROFILE_AREA_BLOCKS} from "../services/profileArea.js";
import {PROFILE_POSITIONS} from "../services/profileCore.js";
import {LIKE_CATEGORIES,LIKE_PAGE_SIZE} from "../services/profileLike.js";
import {PURPOSE_TAGS} from "../services/announcementTags.js";
import {selectionRows} from "../services/inlineSelection.js";
import {showWizardScreen,removeUserWizardInput} from "../services/dmWizardScreen.js";
import {currentDmTextOwner} from "../services/dmInputOwner.js";
import {beginSearch,getSearchSession,updateSearch,bindSearchScreen,findPublicSearchHits,type SearchSession} from "../services/searchRepository.js";
import {setSearchFilter,initialSearchFilters,searchOptions,toggleSearchTag,parseSearchAge,type SearchOptionKey} from "../services/searchDomain.js";
import {authorizedSearchGroupIds} from "../services/searchAccess.js";
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
 (f.kind==="profile"?
  "\n年齢："+(f.ageMin===null?"指定なし":f.ageMin+"〜"+f.ageMax+"歳")+
  "\n髪型："+(f.hair||"指定なし")+" / 体型："+(f.body||"指定なし")+
  "\n#Like："+(f.like?.tag||"指定なし")+" / #Love："+(f.love?.tag||"指定なし"):"")+
 "\n公開済み投稿から検索します。";
}
async function home(t:Telegram,id:number,s:SearchSession){await show(t,id,s,summary(s),homeRows(s));}
function options(s:SearchSession,key:SearchOptionKey){
 const items=searchOptions(key);
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
 const r=s.revision;
 const rows=s.filters.kind==="profile"?[
  [button("📍 エリア",`search:panel:${r}:region`),button("年齢",`search:age:${r}`),
   button("ポジション",`search:panel:${r}:position`)],
  [button("体型",`search:panel:${r}:body`),button("髪型",`search:panel:${r}:hair`),
   button("目的",`search:panel:${r}:purpose`)],
  [button("#Like",`search:tag:${r}:like`),button("#Love",`search:tag:${r}:love`)],
 ]:[
  [button("📍 エリア",`search:panel:${r}:region`),
   button("ポジション",`search:panel:${r}:position`),
   button("目的",`search:panel:${r}:purpose`)],
 ];
 rows.push([button("🔎 検索実行",`search:run:${r}`),button("↩ 戻る",`search:back:${r}`)]);
 await show(t,id,s,summary(s)+"\n\n絞り込む項目を選択してください。",rows);
}
async function tagCategories(t:Telegram,id:number,s:SearchSession,kind:"like"|"love"){
 const rows:any[][]=[];
 for(let i=0;i<LIKE_CATEGORIES.length;i+=3)
  rows.push(LIKE_CATEGORIES.slice(i,i+3).map((cat,j)=>
   button((s.filters[kind]?.category===cat.name?"✅ ":"▫️ ")+cat.name,
    `search:tagpage:${s.revision}:${kind}:${i+j}:0`)));
 rows.push([button("↩ 戻る",`search:filter:${s.revision}`)]);
 await show(t,id,s,summary(s)+"\n\n"+(kind==="like"?"#Like":"#Love")+"：分類を選択",rows);
}
async function tagItems(t:Telegram,id:number,s:SearchSession,kind:"like"|"love",category:number,page:number){
 const cat=LIKE_CATEGORIES[category];
 if(!cat||!Number.isSafeInteger(page)||page<0||page>=Math.ceil(cat.items.length/LIKE_PAGE_SIZE))
  throw Error("SEARCH_TAG_PAGE_INVALID");
 const start=page*LIKE_PAGE_SIZE,items=cat.items.slice(start,start+LIKE_PAGE_SIZE);
 const rows:any[][]=[];
 for(let i=0;i<items.length;i+=3)
  rows.push(items.slice(i,i+3).map((label,j)=>button(
   (s.filters[kind]?.category===cat.name&&s.filters[kind]?.tag===label?"✅ ":"▫️ ")+label,
   `search:tagpick:${s.revision}:${kind}:${category}:${start+i+j}`)));
 const nav:any[]=[];
 if(page>0)nav.push(button("◀ 前へ",`search:tagpage:${s.revision}:${kind}:${category}:${page-1}`));
 if(start+LIKE_PAGE_SIZE<cat.items.length)nav.push(button("次へ ▶",`search:tagpage:${s.revision}:${kind}:${category}:${page+1}`));
 if(nav.length)rows.push(nav);
 rows.push([button("↩ 分類へ",`search:tag:${s.revision}:${kind}`),
  button("🎛 条件へ",`search:filter:${s.revision}`)]);
 await show(t,id,s,summary(s)+"\n\n"+cat.name+"：1件選択（同じ項目で解除）",rows);
}
async function results(t:Telegram,id:number,s:SearchSession,page:number){
 const offset=page*5;
 const allowed=await authorizedSearchGroupIds(t,id);
 const found=await findPublicSearchHits(s.filters,offset,5,allowed);
 const rows:any[][]=found.hits.map((hit,i)=>[Markup.button.url((offset+i+1)+". "+hit.title,hit.url)]);
 const nav=[] as any[];
 if(page>0)nav.push(button("◀ 前へ",`search:page:${s.revision}:${page-1}`));
 if(found.hasNext)nav.push(button("次へ ▶",`search:page:${s.revision}:${page+1}`));
 if(nav.length)rows.push(nav);
 rows.push([button("🎛 条件変更",`search:filter:${s.revision}`),button("↩ 戻る",`search:back:${s.revision}`)]);
 const detail=found.hits.map((h,i)=>(offset+i+1)+". "+h.title+"｜"+h.description).join("\n");
 await show(t,id,s,summary(s)+"\n\n検索結果（参加済みグループ内）\n"+
  (detail||"該当する公開投稿はありません。"),rows);
}
export async function startSearchEditor(t:Telegram,id:number){
 const old=await getSearchSession(id);
 const s=old?(old.step==="home"?old:await updateSearch(id,old.revision,"home",old.filters)):
  await beginSearch(id);
 await home(t,id,s);
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
  const kind=ctx.match[2] as "profile"|"recruitment";
  const next=await updateSearch(ctx.from.id,rev,"home",kind==="recruitment"?
   {...s.filters,kind,hair:null,body:null,ageMin:null,ageMax:null,like:null,love:null}:
   {...s.filters,kind});
  await ctx.answerCbQuery();await home(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^search:panel:(\d+):(region|position|purpose|hair|body)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),key=ctx.match[2] as SearchOptionKey;
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev){await ctx.answerCbQuery("古い操作です");return;}
  const next=await updateSearch(ctx.from.id,rev,key,s.filters);
  await ctx.answerCbQuery();await show(ctx.telegram,ctx.from.id,next,
   summary(next)+"\n\n"+key+"を選択（再押下で解除）",options(next,key));
 });
 bot.action(/^search:pick:(\d+):(region|position|purpose|hair|body):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),key=ctx.match[2] as SearchOptionKey,idx=Number(ctx.match[3]);
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!==key){await ctx.answerCbQuery("古い操作です");return;}
  const values=searchOptions(key);
  if(!Number.isSafeInteger(idx)||idx<0||idx>=values.length){await ctx.answerCbQuery("選択肢が不正です");return;}
  const next=await updateSearch(ctx.from.id,rev,key,setSearchFilter(s.filters,key,values[idx]!));
  await ctx.answerCbQuery();await show(ctx.telegram,ctx.from.id,next,summary(next)+"\n\n"+key+"を選択（再押下で解除）",options(next,key));
 });
 bot.action(/^search:age:(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.filters.kind!=="profile"){
   await ctx.answerCbQuery("古い操作です");return;
  }
  const next=await updateSearch(ctx.from.id,rev,"age",s.filters);
  await ctx.answerCbQuery();
  await show(ctx.telegram,ctx.from.id,next,
   summary(next)+"\n\n年齢を 18-49 のように範囲で、または35のように1値で入力してください。（18〜89）",
   [[button("年齢条件を解除",`search:ageclear:${next.revision}`),
     button("↩ 戻る",`search:filter:${next.revision}`)]]);
 });
 bot.action(/^search:ageclear:(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!=="age"){await ctx.answerCbQuery("古い操作です");return;}
  const next=await updateSearch(ctx.from.id,rev,"home",{...s.filters,ageMin:null,ageMax:null});
  await ctx.answerCbQuery();await filter(ctx.telegram,ctx.from.id,next);
 });
 bot.action(/^search:tag:(\d+):(like|love)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),kind=ctx.match[2] as "like"|"love";
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.filters.kind!=="profile"){await ctx.answerCbQuery("古い操作です");return;}
  const next=await updateSearch(ctx.from.id,rev,kind,s.filters);
  await ctx.answerCbQuery();await tagCategories(ctx.telegram,ctx.from.id,next,kind);
 });
 bot.action(/^search:tagpage:(\d+):(like|love):(\d+):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),kind=ctx.match[2] as "like"|"love",
   category=Number(ctx.match[3]),page=Number(ctx.match[4]);
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!==kind){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();await tagItems(ctx.telegram,ctx.from.id,s,kind,category,page);
 });
 bot.action(/^search:tagpick:(\d+):(like|love):(\d+):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),kind=ctx.match[2] as "like"|"love",
   category=Number(ctx.match[3]),item=Number(ctx.match[4]);
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!==kind){await ctx.answerCbQuery("古い操作です");return;}
  const selected=toggleSearchTag(s.filters,kind,category,item);
  const next=await updateSearch(ctx.from.id,rev,kind,selected);
  await ctx.answerCbQuery();
  await tagItems(ctx.telegram,ctx.from.id,next,kind,category,Math.floor(item/LIKE_PAGE_SIZE));
 });
 bot.action(/^search:page:(\d+):(\d+)$/,async ctx=>{
  if(!dm(ctx))return;
  const rev=Number(ctx.match[1]),page=Number(ctx.match[2]),s=await getSearchSession(ctx.from.id);
  if(!s||s.revision!==rev||s.step!=="results"||!Number.isSafeInteger(page)||page>200){await ctx.answerCbQuery("古い操作です");return;}
  await ctx.answerCbQuery();await results(ctx.telegram,ctx.from.id,s,page);
 });
 bot.on("text",async(ctx,goNext)=>{
  if(!dm(ctx)||ctx.message.text.startsWith("/"))return goNext();
  const s=await getSearchSession(ctx.from.id);
  if(!s||s.step!=="keyword")return goNext();
  if(await currentDmTextOwner(ctx.from.id)!=="search")return goNext();
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
