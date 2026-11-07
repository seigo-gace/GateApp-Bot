/** Notion N14 M1/M2: two different menus, ONE @GayBBS_bot and MPB owner.
 * Never fabricate Telegram message IDs, topic IDs, Cloudflare Pages URLs,
 * missing functionality or links to a disabled document.
 */
export type NavLink={label:string;url:string;verified:boolean};
export type EntryLink={feature:"profile"|"announcement"|"room"|"link"|"search";url:string;ready:boolean};
export type PanelSpec={
 type:"general_guide"|"posting";
 board:"area_bbs"|"video_chat"|"gay_board";
 links:readonly NavLink[];
 entryLinks:readonly EntryLink[];
};
export type ButtonSpec={text:string;url:string};
export type RenderedPanel={text:string;rows:ButtonSpec[][]};

/** No empty Telegram inline-keyboard cells. A final single button occupies
 * the whole last row. Preserve semantic order; never fabricate padding links.
 */
export function packButtonRows(items:readonly ButtonSpec[],columns:2|3=2):ButtonSpec[][]{
 if(!items.length)throw new Error("BUTTON_ROWS_EMPTY");
 const rows:ButtonSpec[][]=[];
 for(let i=0;i<items.length;i+=columns)rows.push(items.slice(i,i+columns));
 return rows;
}
export type AreaBlockBoardSpec={
 blockTitle:string;
 description:string;
 areaLinks:readonly NavLink[];
 searchLink:NavLink;
 filterLink:NavLink;
 chatLink:NavLink;
 backLink:NavLink;
};
/** L1 navigation only: region destinations, search, common talk, and L0 back.
 * Profile and ROOM creation belong to L2 posting menus / their Bot DM.
 * Search/Filter are read-only entrypoints, never post-editor actions.
 */
export function renderAreaBlockBoard(spec:AreaBlockBoardSpec):RenderedPanel{
 if(!spec.blockTitle.trim()||spec.blockTitle.length>80||
    !spec.description.trim()||spec.description.length>3300||
    spec.areaLinks.length===0||spec.areaLinks.length>40)
  throw new Error("AREA_BLOCK_CONTENT_INCOMPLETE");
 const seen=new Set<string>();
 const checked=(link:NavLink):ButtonSpec=>{
  assertPublishedLink(link);
  if(!link.label.trim()||link.label.length>64||seen.has(link.label))
   throw new Error("AREA_BLOCK_LABEL_DUPLICATE");
  seen.add(link.label);
  return {text:link.label,url:link.url};
 };
 const regions=spec.areaLinks.map(checked);
 const search=checked(spec.searchLink);
 const filter=checked(spec.filterLink);
 const chat=checked(spec.chatLink);
 const back=checked(spec.backLink);
 return {
  text:spec.blockTitle+"\\n"+spec.description,
  rows:[
   ...packButtonRows(regions,2),
   [search,filter],
   [chat,back],
  ],
 };
}

function safeUrl(url:string):boolean{
 try{
  const x=new URL(url);
  return x.protocol==="https:"&&!x.username&&!x.password&&
   (x.hostname==="t.me"||x.hostname==="telegram.me"||
    x.hostname.endsWith(".pages.dev")||x.hostname==="hentaigay.org"||
    x.hostname.endsWith(".hentaigay.org")||x.hostname==="g-acebot.com"||
    x.hostname.endsWith(".g-acebot.com"));
 }catch{return false;}
}
function assertPublishedLink(link:NavLink|EntryLink):void{
 if(!safeUrl(link.url)||!("verified" in link?link.verified:link.ready))
  throw new Error("PANEL_LINK_NOT_VERIFIED");
}
/** Master-approved top-level panels. Row identity is part of the design
 * contract: never pad rows, reorder labels, or expose broken destinations.
 */
export const APPROVED_POSTING_ROWS = [
 ["相手募集","募集+Room","告知/予告"],
 ["クリエーター有料ビデオ投稿"],
 ["🔗ボタン作成","検索/フィルター"],
 ["雑談","紹介/招待","操作説明"],
] as const;
export const APPROVED_GUIDE_ROWS = [
 ["お知らせ","フリートーク/雑談"],
 ["全国エリアボード","カテゴリーボード"],
 ["ビデオチャット/動画","検索/フィルター"],
 ["みんなのプロフ","コミュニティリンク"],
 ["グループルール","使い方"],
 ["安全ガイド","利用規約"],
] as const;
export const APPROVED_HELP_ROWS = [
 ["プロフ","Room+募集","告知/予告"],
 ["🔗ボタン作成","検索/フィルター","戻る"],
] as const;

export type ApprovedPanel="posting"|"general_guide"|"operation_help";
export function approvedLayoutRows(kind:ApprovedPanel):readonly (readonly string[])[]{
 return kind==="posting"?APPROVED_POSTING_ROWS:
   kind==="general_guide"?APPROVED_GUIDE_ROWS:APPROVED_HELP_ROWS;
}
export function renderApprovedLinks(kind:ApprovedPanel,
 links:readonly NavLink[]):ButtonSpec[][]{
 const expected=approvedLayoutRows(kind);
 const all:readonly string[]=expected.flat();
 const seen=new Map<string,NavLink>();
 for(const link of links){
  assertPublishedLink(link);
  if(seen.has(link.label)||!all.includes(link.label))
   throw new Error("APPROVED_MENU_UNEXPECTED_OR_DUPLICATE");
  seen.set(link.label,link);
 }
 // Failure means stop publication, not insert an invented placeholder link.
 if(seen.size!==all.length||all.some(label=>!seen.has(label)))
  throw new Error("APPROVED_MENU_MISSING_VERIFIED_LINKS");
 return expected.map(row=>row.map(label=>({
  text:label,url:seen.get(label)!.url,
 })));
}
export function renderMenuPanel(spec:PanelSpec):RenderedPanel{
 if(!["area_bbs","video_chat","gay_board"].includes(spec.board))
  throw new Error("PANEL_BOARD_INVALID");
 if(spec.type==="general_guide"){
  if(spec.entryLinks.length)throw new Error("GUIDE_EDITOR_ENTRY_FORBIDDEN");
  return {text:"📌 総合案内\\n各ボタンから案内やトピックへ移動できます。",
   rows:renderApprovedLinks("general_guide",spec.links)};
 }
 if(spec.type!=="posting")throw new Error("PANEL_TYPE_INVALID");
 // Existing limited feature-release gates cannot yet supply every approved
 // posting-menu button, so fail closed instead of showing an incorrect menu.
 if(spec.entryLinks.length)throw new Error("POSTING_ENTRY_LINK_MUST_MATCH_APPROVED_MENU");
 return {text:"📝 投稿メニュー\\nボタンを選択してください。",
   rows:renderApprovedLinks("posting",spec.links)};
}
