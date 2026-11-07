/** TGtumbler group about + four named text hyperlinks.
 * Telegram setChatDescription accepts PLAIN text (0..255 chars), with no
 * parse_mode/entities. Rich text hyperlinks MUST be a Bot message, not the
 * group description. Never mistake Markdown anchors for clickable about text.
 */
export const GROUP_ABOUT_TARGETS={
 area_bbs:{chatId:-1003847210571,communityTopicUrl:"https://t.me/c/3847210571/273"},
 video_chat:{chatId:-1002373696859,communityTopicUrl:"https://t.me/c/2373696859/1724"},
 gay_board:{chatId:-1003770334893,communityTopicUrl:"https://t.me/c/3770334893/18"},
} as const;
export type GroupAboutKey=keyof typeof GROUP_ABOUT_TARGETS;
export const GROUP_ABOUT_INTROS:Readonly<Record<GroupAboutKey,string>>={
 area_bbs:"エリア’s BBS｜地域別に友達・交流相手を探せる掲示板。",
 video_chat:"ビデオChat｜交流・画像・動画投稿と動画出品の掲示板。",
 gay_board:"ゲイのための掲示板♂｜目的・カテゴリー別の友達探し。",
};
export const FOUR_NAV_LABELS=[
 "🔗エリアｓ",
 "🔗ビデオチャットの掲示板",
 "🔗ゲイのための掲示板",
 "🔗ONLINEビデオチャット",
] as const;
export type FourNavKey="area_bbs"|"video_chat"|"gay_board"|"online";
export const FOUR_NAV_KEYS=["area_bbs","video_chat","gay_board","online"] as const;

export function groupAboutText(key:GroupAboutKey,links:readonly VerifiedNavigationLink[]):string{
 if(!GROUP_ABOUT_TARGETS[key])throw new Error("GROUP_ABOUT_UNKNOWN_GROUP");
 // A Telegram group description supports plain text only; present bare HTTPS
 // URLs after the individual introduction. NO rich anchors or labels.
 const urls=verifiedGroupAboutUrls(links);
 const about=GROUP_ABOUT_INTROS[key]+"\\n"+urls.join("\\n");
 if([...about].length>255)throw new Error("GROUP_DESCRIPTION_LIMIT_255");
 return about;
}
function verifiedGroupAboutUrls(links:readonly VerifiedNavigationLink[]):readonly string[]{
 return verifiedRouteMap(links).map(x=>x.url);
}
export type VerifiedNavigationLink={key:FourNavKey;url:string;verified:boolean};
/** These are Bot DM/GATE START urls, verified from existing runtime/DB.
 * Do not reuse ONLINE B/C/D room links for ONLINE hub navigation.
 */
function verifiedRouteMap(links:readonly VerifiedNavigationLink[]){
 if(links.length!==4)throw new Error("GROUP_NAV_FOUR_LINKS_REQUIRED");
 const byKey=new Map<FourNavKey,string>();
 for(const link of links){
  if(!FOUR_NAV_KEYS.includes(link.key)||byKey.has(link.key))
   throw new Error("GROUP_NAV_UNKNOWN_OR_DUPLICATE");
  if(!link.verified||!/^https:\\/\\/t\\.me\\/[A-Za-z][A-Za-z0-9_]{4,31}\\?start=[A-Za-z0-9_-]{1,64}$/.test(link.url))
   throw new Error("GROUP_NAV_GATE_URL_UNVERIFIED:"+link.key);
  byKey.set(link.key,link.url);
 }
 for(const key of FOUR_NAV_KEYS)
  if(!byKey.has(key))throw new Error("GROUP_NAV_LINK_MISSING:"+key);
 return FOUR_NAV_KEYS.map(key=>({key,url:byKey.get(key)!}));
}
export function fourNamedLinks(links:readonly VerifiedNavigationLink[]){
 if(links.length!==4)throw new Error("GROUP_NAV_FOUR_LINKS_REQUIRED");
 const routes=verifiedRouteMap(links);
 const escape=(s:string)=>s.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
 const text=FOUR_NAV_KEYS.map((key,i)=>
  '<a href="'+escape(routes[i]!.url)+'">'+escape(FOUR_NAV_LABELS[i]!)+"</a>"
 ).join("\n");
 if(text.length>4096)throw new Error("GROUP_NAV_MESSAGE_LIMIT");
 return text;
}
