/** Approved topic-board copy and historical Telegram destination links.
 * This is NOT an API-verified message_thread_id registry.
 * The /board publisher must confirm destinations and the existing pinned post
 * before writing to Telegram; never derive a thread id from these URLs.
 * General guide, community links, and free chat belong to fixed menu buttons.
 */
export type BoardName="video"|"category"|"national";
export type BoardEntry={label:string;description:string;url:string};
export type AreaBlock={label:string;url:string;children:readonly {label:string;url?:string}[]};
const c=(id:number,n:number)=>`https://t.me/c/${id}/${n}`;
const VIDEO=2373696859, GAY=3770334893, AREA=3847210571;
export const VIDEO_TOPICS:readonly BoardEntry[]=[
 {label:"🆕運営からのお知らせ",description:"運営からのお知らせや大切な情報を確認する掲示板です。",url:c(VIDEO,1)},
 {label:"👀ビデオチャット",description:"ビデオチャットで交流する仲間を探す専用掲示板です。",url:c(VIDEO,1605)},
 {label:"アガる🔥画像🖼️/動画🎞",description:"画像・動画を投稿し、みんなで楽しむ掲示板です。",url:c(VIDEO,1634)},
 {label:"🎬️みんなのハメ撮り投稿",description:"自作の撮影動画を投稿して紹介する専用掲示板です。",url:c(VIDEO,1692)},
 {label:"💰️稼げる有料動画投稿",description:"自作動画を価格設定して出品する専用掲示板です。",url:c(VIDEO,1695)},
 {label:"🎦China逆輸入ビデオ",description:"China逆輸入ビデオの紹介専用掲示板です。",url:c(VIDEO,1696)},
 {label:"🪪みんなのプロフ",description:"プロフィールを見て、交流したい相手を探す掲示板です。",url:c(VIDEO,1613)},
];
export const CATEGORY_TOPICS:readonly BoardEntry[]=[
 {label:"🆕運営からのお知らせ",description:"運営からのお知らせや大切な情報を確認する掲示板です。",url:c(GAY,1)},
 {label:"👤サシ",description:"1対1で交流する相手を探す掲示板です。",url:c(GAY,2)},
 {label:"👥複数",description:"複数人での交流や仲間を探す掲示板です。",url:c(GAY,3)},
 {label:"見せ合い👀",description:"映像での見せ合いや交流の相手を探す掲示板です。",url:c(GAY,4)},
 {label:"🎭趣味/嗜好/フェチ",description:"共通の趣味や好みの相手を探す掲示板です。",url:c(GAY,14)},
 {label:"S⚔M",description:"S・Mの好みに合う相手を探す掲示板です。",url:c(GAY,15)},
 {label:"アダルトおもちゃ",description:"アダルトグッズの紹介や情報交換をする掲示板です。",url:c(GAY,25)},
 {label:"露出、野外",description:"露出・野外について趣味の合う相手を探す掲示板です。法令とグループルールを守って利用してください。",url:c(GAY,41)},
 {label:"みんなのプロフ",description:"プロフィールから交流相手を探す掲示板です。",url:c(GAY,210)},
];
/** Children without a historical URL must be resolved against an actual
 * existing Telegram topic. Do not substitute a block URL for a child URL. */
export const AREA_BLOCKS:readonly AreaBlock[]=[
 {label:"北海道",url:c(AREA,49),children:[{label:"北海道",url:c(AREA,49)}]},
 {label:"東北",url:c(AREA,621),children:[{label:"青森"},{label:"秋田"},{label:"岩手"},{label:"山形",url:c(AREA,53)},{label:"宮城"},{label:"福島"}]},
 {label:"甲信越",url:c(AREA,990),children:[{label:"新潟"},{label:"長野"},{label:"山梨"}]},
 {label:"北陸",url:c(AREA,991),children:[{label:"富山"},{label:"石川",url:c(AREA,60)},{label:"福井"}]},
 {label:"北関東",url:c(AREA,992),children:[{label:"群馬"},{label:"栃木"},{label:"茨城"}]},
 {label:"東京",url:c(AREA,993),children:[{label:"池袋"},{label:"新宿",url:c(AREA,66)},{label:"渋谷"},{label:"品川"},{label:"都心",url:c(AREA,69)},{label:"区東部",url:c(AREA,70)},{label:"都下"}]},
 {label:"南関東",url:c(AREA,994),children:[{label:"千葉"},{label:"埼玉"},{label:"横須賀・湘南・小田原",url:c(AREA,74)},{label:"横浜・川崎"},{label:"町田・相模原・厚木"}]},
 {label:"東海",url:c(AREA,995),children:[{label:"静岡"},{label:"愛知",url:c(AREA,78)},{label:"岐阜",url:c(AREA,79)},{label:"三重",url:c(AREA,80)}]},
 {label:"関西",url:c(AREA,996),children:[{label:"滋賀",url:c(AREA,81)},{label:"京都",url:c(AREA,82)},{label:"大阪キタ",url:c(AREA,83)},{label:"大阪ミナミ",url:c(AREA,84)},{label:"兵庫",url:c(AREA,85)},{label:"奈良",url:c(AREA,86)},{label:"和歌山",url:c(AREA,87)}]},
 {label:"中国",url:c(AREA,997),children:[{label:"鳥取",url:c(AREA,88)},{label:"島根",url:c(AREA,89)},{label:"岡山",url:c(AREA,90)},{label:"広島",url:c(AREA,91)},{label:"山口",url:c(AREA,92)}]},
 {label:"四国",url:c(AREA,998),children:[{label:"徳島",url:c(AREA,93)},{label:"香川",url:c(AREA,94)},{label:"愛媛",url:c(AREA,95)},{label:"高知",url:c(AREA,96)}]},
 {label:"九州",url:c(AREA,999),children:[{label:"福岡",url:c(AREA,97)},{label:"大分",url:c(AREA,98)},{label:"佐賀",url:c(AREA,99)},{label:"長崎",url:c(AREA,100)},{label:"熊本",url:c(AREA,101)},{label:"宮崎",url:c(AREA,102)},{label:"鹿児島",url:c(AREA,103)}]},
 {label:"沖縄",url:c(AREA,104),children:[{label:"沖縄",url:c(AREA,104)}]},
];
/** Adopted L1 copy structure: concrete Topic names and L2 creation guidance.
 * Fine geographic boundaries were NOT formally approved in the 2026-10-28
 * decision ledger. Do not invent wards, municipalities or station catchments.
 * When a boundary is adopted, preserve it in the board's approved copy.
 */
export const AREA_BLOCK_DESCRIPTIONS:Readonly<Record<string,string>>={
 "北海道":"北海道全域を対象とするエリアです。札幌・小樽など道央、旭川など道北、函館など道南、帯広・釧路など道東から交流先を探せます。北海道は独立した下位エリアを増やさず、この掲示板を利用します。",
 "東北":"青森（青森・弘前・八戸）、秋田（秋田・横手）、岩手（盛岡・花巻・一関）、山形（山形・米沢・鶴岡）、宮城（仙台・石巻）、福島（福島・郡山・いわき）の6県別です。会いたい場所または活動する県を選び、県境付近は主に交流する地域を目安にしてください。",
 "甲信越":"新潟（新潟・長岡・上越）、長野（長野・松本・上田・飯田）、山梨（甲府・富士吉田）を県別に案内します。生活圏や待ち合わせしやすい県を選んでください。",
 "北陸":"富山（富山・高岡）、石川（金沢・小松・能登）、福井（福井・敦賀・越前）の3県別です。探したい相手の主な活動地域に近い県を選んでください。",
 "北関東":"群馬（前橋・高崎・太田）、栃木（宇都宮・小山・那須）、茨城（水戸・つくば・土浦・日立）の3県別です。県境をまたぐ場合は、交流や待ち合わせの中心となる県を目安にしてください。",
 "東京":"池袋＝池袋駅とその周辺、豊島区北部方面。新宿＝新宿駅・歌舞伎町・新大久保周辺。渋谷＝渋谷駅・原宿・恵比寿周辺。品川＝品川駅・大崎・五反田方面。都心＝東京駅・銀座・新橋・六本木などの中心部。区東部＝上野・浅草・錦糸町・亀戸・葛西など東側の区部。都下＝立川・八王子・町田を除く多摩地域方面を目安にします。これは掲示板を選ぶための代表地点で、行政境界の厳密な区分ではありません。複数に当てはまる場合は、会いたい場所の最寄りエリアを選んでください。",
 "南関東":"千葉＝千葉・船橋・柏など千葉県方面。埼玉＝さいたま・川越・川口など埼玉県方面。横須賀・湘南・小田原＝横須賀・鎌倉・藤沢・茅ヶ崎・小田原など神奈川県南部／西部。横浜・川崎＝横浜市・川崎市周辺。町田・相模原・厚木＝町田市（東京都）と相模原・厚木周辺の県境生活圏です。町田は東京の都下ではなく、採用済みのこの専用エリアを優先してください。",
 "東海":"静岡（静岡・浜松・沼津）、愛知（名古屋・豊橋・岡崎）、岐阜（岐阜・大垣・高山）、三重（津・四日市・伊勢）の県別です。交流の拠点となる県を選んでください。",
 "関西":"滋賀＝大津・草津・彦根方面。京都＝京都市・宇治・福知山方面。大阪キタ＝梅田・大阪駅・中津・天満など大阪市北側中心。大阪ミナミ＝難波・心斎橋・道頓堀・日本橋・天王寺など大阪市南側中心。兵庫＝神戸・西宮・姫路方面。奈良＝奈良・橿原方面。和歌山＝和歌山・田辺方面です。大阪府内でキタ／ミナミのどちらにも当てはまらない場合は、主に交流する繁華街や待ち合わせ場所を目安にしてください。行政区画による厳密な線引きではありません。",
 "中国":"鳥取（鳥取・米子）、島根（松江・出雲・浜田）、岡山（岡山・倉敷）、広島（広島・福山・呉）、山口（下関・山口・周南・岩国）の県別です。住んでいる場所に限らず、交流したい県から選べます。",
 "四国":"徳島（徳島・鳴門）、香川（高松・丸亀）、愛媛（松山・今治・新居浜）、高知（高知・四万十）の県別です。行きやすい場所や交流したい県を選んでください。",
 "九州":"福岡（福岡・北九州・久留米）、大分（大分・別府・中津）、佐賀（佐賀・鳥栖・唐津）、長崎（長崎・佐世保）、熊本（熊本・八代）、宮崎（宮崎・都城・延岡）、鹿児島（鹿児島・霧島・鹿屋）の7県別です。県をまたぐ場合は主に交流する場所の掲示板を選んでください。",
 "沖縄":"沖縄県全域の掲示板です。那覇・浦添・沖縄市などの本島中南部、名護など本島北部、宮古・八重山など離島方面を含みます。沖縄は独立した下位エリアを増やさず、この掲示板を利用します。",
};
export const AREA_BLOCK_POSTING_GUIDE=
 "投稿するときは、下からエリアを選び、移動先の青い固定「📝 投稿メニュー」からBot個別チャットで作成してください。公開前に投稿先を確認できます。";
export function areaBlockDescription(block:string,approvedScope?:string):string {
 const description=AREA_BLOCK_DESCRIPTIONS[block];
 if(!description||!AREA_BLOCKS.some(x=>x.label===block))
  throw new Error("AREA_BLOCK_DESCRIPTION_MISSING");
 const scope=approvedScope?.trim();
 if(approvedScope!==undefined&&(!scope||scope.length>1200))
  throw new Error("AREA_BLOCK_SCOPE_NOT_APPROVED");
 return description+(scope?"\\n\\n"+scope:"")+
  "\\n\\n"+AREA_BLOCK_POSTING_GUIDE;
}
const escapeHtml=(s:string):string=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const link=(label:string,url:string)=>`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
const ensureLink=(url:string,expected:number)=>{
 if(!new RegExp(`^https://t\\.me/c/${expected}/[1-9][0-9]*$`).test(url))throw new Error("BOARD_LINK_INVALID");
};
export function renderTopicBoard(board:"video"|"category"):string {
 const entries=board==="video"?VIDEO_TOPICS:CATEGORY_TOPICS;
 const group=board==="video"?VIDEO:GAY;
 const title=board==="video"?"🎥 ビデオChatの掲示板｜トピック案内":"♂️ ゲイのための掲示板｜カテゴリーボード";
 const intro=board==="video"?
  "動画・画像・ビデオチャット・作品の出品など、目的に合わせて掲示板を選んで交流しましょう。":
  "趣味・好み・交流目的に合わせて、気になるカテゴリーから友達や仲間を探しましょう。";
 const body=entries.map(x=>{ensureLink(x.url,group);return `<b>${escapeHtml(x.label)}</b>\n${escapeHtml(x.description)}\n${link("🔗 掲示板を開く",x.url)}`;});
 const text=`<b>${escapeHtml(title)}</b>\n\n${escapeHtml(intro)}\n\n${body.join("\n\n")}`;
 if(text.length>4096)throw new Error("BOARD_TEXT_TOO_LONG");
 return text;
}
export function renderNationalBoard():string {
 const rows=AREA_BLOCKS.map(b=>{ensureLink(b.url,AREA);return `${link("📍 "+b.label,b.url)} — ${b.children.map(x=>escapeHtml(x.label)).join("・")}`;});
 const text=`<b>🗾 全国エリアボード</b>\n\nお住まいの地域や旅先のエリアを選び、地域の掲示板へ移動できます。\n\n${rows.join("\n\n")}`;
 if(text.length>4096)throw new Error("BOARD_TEXT_TOO_LONG");
 return text;
}
export function renderAreaBlock(label:string,resolved:Readonly<Record<string,string>>={}):string {
 const block=AREA_BLOCKS.find(b=>b.label===label);
 if(!block)throw new Error("AREA_BLOCK_UNKNOWN");
 const rows=block.children.map(child=>{
  const key=`${label}/${child.label}`;
  const url=resolved[key]??child.url;
  if(!url)throw new Error(`AREA_CHILD_LINK_UNVERIFIED:${key}`);
  ensureLink(url,AREA);
  return link("📍 "+child.label,url);
 });
 const text=`<b>📍 ${escapeHtml(label)}｜エリアボード</b>\n\n地域を選んで、各掲示板へ移動できます。\n\n${rows.join("\n")}`;
 if(text.length>4096)throw new Error("BOARD_TEXT_TOO_LONG");
 return text;
}
/** No posting without independently verified chat/thread IDs and a known
 * existing post receipt: this service is a rendering contract, not a publisher. */
