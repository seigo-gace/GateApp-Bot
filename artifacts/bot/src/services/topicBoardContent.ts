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
 "北海道":"北海道ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "東北":"東北ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "甲信越":"甲信越ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "北陸":"北陸ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "北関東":"北関東ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "東京":"東京ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "南関東":"南関東ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "東海":"東海ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "関西":"関西ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "中国":"中国ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "四国":"四国ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "九州":"九州ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
 "沖縄":"沖縄ブロックの各ボタンが担当する地域の目安です。地域名のボタンと下の説明を照らし合わせて選んでください。",
};
export const AREA_CHILD_COVERAGE:Readonly<Record<string,Readonly<Record<string,string>>>>={
 "北海道":{"北海道":"北海道全域。道央（札幌・小樽）、道北（旭川・稚内）、道南（函館）、道東（帯広・釧路・網走）、離島を含む。"},
 "東北":{"青森":"青森県全域。青森・弘前・八戸・むつ周辺など。","秋田":"秋田県全域。秋田・横手・大館・由利本荘周辺など。","岩手":"岩手県全域。盛岡・花巻・北上・一関・宮古周辺など。","山形":"山形県全域。山形・米沢・天童・鶴岡・酒田周辺など。","宮城":"宮城県全域。仙台・石巻・大崎・名取・気仙沼周辺など。","福島":"福島県全域。福島・郡山・会津若松・いわき・相馬周辺など。"},
 "甲信越":{"新潟":"新潟県全域。新潟・長岡・上越・三条・佐渡など。","長野":"長野県全域。長野・松本・上田・諏訪・伊那・飯田など。","山梨":"山梨県全域。甲府・笛吹・韮崎・富士吉田・河口湖周辺など。"},
 "北陸":{"富山":"富山県全域。富山・高岡・魚津・砺波など。","石川":"石川県全域。金沢・小松・白山・七尾・能登方面など。","福井":"福井県全域。福井・坂井・越前・敦賀・小浜など。"},
 "北関東":{"群馬":"群馬県全域。前橋・高崎・伊勢崎・太田・沼田など。","栃木":"栃木県全域。宇都宮・小山・栃木・足利・那須方面など。","茨城":"茨城県全域。水戸・つくば・土浦・日立・取手・神栖など。"},
 "東京":{"池袋":"池袋駅を中心に、東池袋・西池袋・北池袋・目白・大塚など豊島区周辺の活動圏。","新宿":"新宿駅・歌舞伎町・新大久保・西新宿・高田馬場など新宿周辺の活動圏。","渋谷":"渋谷駅・原宿・表参道・代官山・恵比寿など渋谷周辺の活動圏。","品川":"品川駅・大崎・五反田・大井町・天王洲・大森など品川方面の活動圏。","都心":"東京駅・丸の内・日本橋・銀座・有楽町・新橋・赤坂・六本木など都心部。","区東部":"上野・浅草・錦糸町・亀戸・押上・北千住・葛西など東京23区東側の活動圏。","都下":"立川・八王子・武蔵野・三鷹・調布・府中・小平・青梅など多摩地域。町田は『町田・相模原・厚木』を優先。"},
 "南関東":{"千葉":"千葉県全域。千葉・船橋・市川・松戸・柏・成田・木更津・館山など。","埼玉":"埼玉県全域。さいたま・川口・川越・所沢・越谷・熊谷・秩父など。","横須賀・湘南・小田原":"神奈川県の三浦半島・湘南・県西方面。横須賀・三浦・鎌倉・逗子・藤沢・茅ヶ崎・平塚・小田原など。","横浜・川崎":"神奈川県の横浜市・川崎市全域。横浜駅・関内・新横浜・川崎駅・武蔵小杉など。","町田・相模原・厚木":"東京都町田市と神奈川県央の相模原・厚木・海老名・座間・大和・愛川周辺。町田は東京の『都下』よりこちらを優先。"},
 "東海":{"静岡":"静岡県全域。静岡・浜松・沼津・富士・熱海・伊豆・掛川など。","愛知":"愛知県全域。名古屋・豊橋・岡崎・豊田・一宮・春日井など。","岐阜":"岐阜県全域。岐阜・大垣・各務原・多治見・高山・飛騨など。","三重":"三重県全域。津・四日市・桑名・鈴鹿・伊勢・松阪・伊賀・尾鷲など。"},
 "関西":{"滋賀":"滋賀県全域。大津・草津・守山・彦根・長浜・甲賀など。","京都":"京都府全域。京都市・宇治・亀岡・福知山・舞鶴・宮津など。","大阪キタ":"大阪駅・梅田を中心に北新地・中津・茶屋町・天満・中之島・十三など、大阪市北側の交流圏。","大阪ミナミ":"難波・心斎橋を中心に道頓堀・日本橋・堀江・千日前・新世界・天王寺など大阪市南側の交流圏。","兵庫":"兵庫県全域。神戸・西宮・尼崎・宝塚・明石・姫路・豊岡・淡路島など。","奈良":"奈良県全域。奈良・生駒・大和郡山・橿原・天理・吉野など。","和歌山":"和歌山県全域。和歌山・海南・橋本・田辺・白浜・新宮など。"},
 "中国":{"鳥取":"鳥取県全域。鳥取・米子・倉吉・境港など。","島根":"島根県全域。松江・出雲・浜田・益田・隠岐など。","岡山":"岡山県全域。岡山・倉敷・津山・総社・玉野など。","広島":"広島県全域。広島・福山・呉・東広島・尾道・三次など。","山口":"山口県全域。下関・山口・宇部・周南・岩国・萩など。"},
 "四国":{"徳島":"徳島県全域。徳島・鳴門・阿南・美馬・三好など。","香川":"香川県全域。高松・丸亀・坂出・観音寺・小豆島など。","愛媛":"愛媛県全域。松山・今治・新居浜・西条・宇和島など。","高知":"高知県全域。高知・南国・四万十・須崎・安芸・宿毛など。"},
 "九州":{"福岡":"福岡県全域。福岡・北九州・久留米・飯塚・大牟田・糸島など。","大分":"大分県全域。大分・別府・中津・日田・佐伯・由布など。","佐賀":"佐賀県全域。佐賀・鳥栖・唐津・伊万里・武雄など。","長崎":"長崎県全域。長崎・佐世保・諫早・大村・島原・五島・対馬など。","熊本":"熊本県全域。熊本・八代・天草・玉名・阿蘇・人吉など。","宮崎":"宮崎県全域。宮崎・都城・延岡・日南・日向など。","鹿児島":"鹿児島県全域。鹿児島・霧島・鹿屋・指宿・薩摩川内・奄美・種子島・屋久島など。"},
 "沖縄":{"沖縄":"沖縄県全域。那覇・浦添・沖縄市・うるま・名護など本島、宮古・八重山・久米島など離島も含む。"},
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
 const child=AREA_BLOCKS.find(x=>x.label===block)!.children;
 const cover=AREA_CHILD_COVERAGE[block];
 if(!cover||Object.keys(cover).length!==child.length||
    child.some(x=>!cover[x.label]||!cover[x.label].trim()))
  throw new Error("AREA_CHILD_COVERAGE_MISSING:"+block);
 const coverageText=child.map(x=>"【"+x.label+"】"+cover[x.label]).join("\\n");
 return description+"\\n\\n"+coverageText+(scope?"\\n\\n"+scope:"")+
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
