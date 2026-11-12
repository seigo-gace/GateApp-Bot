export const PROFILE_OVERVIEW_ROWS = [
 [{id:"basic",label:"基本情報"},{id:"appearance",label:"容姿/エリア"},{id:"media",label:"🖼️画像🎬動画/自己PR"}],
 [{id:"like",label:"#Like"},{id:"love",label:"#Love"},{id:"preview",label:"プレビュー"}],
 [{id:"save",label:"保存"},{id:"cancel",label:"キャンセル"}],
] as const;
export function profileOverviewButtons(revision:number) {
 if(!Number.isSafeInteger(revision)||revision<1)throw new Error("PROFILE_REVISION_INVALID");
 return PROFILE_OVERVIEW_ROWS.map(row=>row.map(x=>({text:x.label,callback_data:"pf:overview:"+revision+":"+x.id})));
}