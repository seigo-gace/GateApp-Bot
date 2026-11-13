/** Reusable Telegram InlineKeyboard date/time picker (JST).
 * UI only: no persistence, publishing, or Room-specific callback namespaces.
 * Callers supply action IDs; the owning wizard persists and checks revision.
 */
import {styledInlineButton} from "./inlineButtonStyle.js";
import {parseJstDateTime} from "./postingDomain.js";

type Button=ReturnType<typeof styledInlineButton>;
export type DateTimePickerActions={
 month:(month:string)=>string;
 day:(day:string)=>string;
 hour:(hour:string)=>string;
 minute:(minute:string)=>string;
 manual:string;
 back:string;
 cancel:string;
};
const JST_OFFSET_MS=9*60*60*1000;
const digits=(value:number)=>String(value).padStart(2,"0");
export function jstToday(now=new Date()):string{
 return new Date(now.getTime()+JST_OFFSET_MS).toISOString().slice(0,10).replaceAll("-","");
}
export function jstCurrentMonth(now=new Date()):string{return jstToday(now).slice(0,6);}
export function changePickerMonth(month:string,delta:-1|1):string{
 if(!/^[0-9]{6}$/.test(month))throw Error("PICKER_MONTH_INVALID");
 const y=Number(month.slice(0,4)),m=Number(month.slice(4,6));
 if(y<2020||y>2100||m<1||m>12)throw Error("PICKER_MONTH_INVALID");
 const next=new Date(Date.UTC(y,m-1+delta,1));
 return String(next.getUTCFullYear())+digits(next.getUTCMonth()+1);
}
export function validPickerMonth(month:string,now=new Date()):boolean{
 return /^[0-9]{6}$/.test(month)&&month>=jstCurrentMonth(now)&&month<="210012"&&
  Number(month.slice(4))>=1&&Number(month.slice(4))<=12;
}
export function validPickerDay(day:string,now=new Date()):boolean{
 if(!/^[0-9]{8}$/.test(day)||day<jstToday(now)||day>"21001231"||
  !validPickerMonth(day.slice(0,6),now))return false;
 const year=Number(day.slice(0,4)),month=Number(day.slice(4,6)),date=Number(day.slice(6));
 const d=new Date(Date.UTC(year,month-1,date));
 return date>=1&&d.getUTCFullYear()===year&&d.getUTCMonth()+1===month&&d.getUTCDate()===date;
}
export function pickerDateLabel(day:string):string{
 if(!/^[0-9]{8}$/.test(day))throw Error("PICKER_DAY_INVALID");
 return day.slice(0,4)+"/"+day.slice(4,6)+"/"+day.slice(6,8);
}
export function selectedPickerTime(day:string,hour:number,minute:number,now=new Date()):Date{
 if(!validPickerDay(day,now)||!Number.isInteger(hour)||hour<0||hour>23||
    !Number.isInteger(minute)||minute<0||minute>59)throw Error("PICKER_DATETIME_INVALID");
 return parseJstDateTime(pickerDateLabel(day)+" "+digits(hour)+":"+digits(minute));
}
export function pickerDateRows(month:string,actions:DateTimePickerActions,now=new Date()):Button[][]{
 if(!validPickerMonth(month,now))throw Error("PICKER_MONTH_INVALID");
 const year=Number(month.slice(0,4)),mo=Number(month.slice(4,6));
 const lastDay=new Date(Date.UTC(year,mo,0)).getUTCDate();
 const names=["日","月","火","水","木","金","土"];
 const days:Button[]=[];
 for(let n=1;n<=lastDay;n++){
  const day=month+digits(n);
  if(!validPickerDay(day,now))continue;
  const dow=new Date(Date.UTC(year,mo-1,n)).getUTCDay();
  days.push(styledInlineButton(names[dow]+n,actions.day(day),"primary"));
 }
 const rows:Button[][]=[];
 for(let i=0;i<days.length;i+=7)rows.push(days.slice(i,i+7));
 const nav:Button[]=[];
 if(month>jstCurrentMonth(now))nav.push(styledInlineButton("◀ 前月",actions.month(changePickerMonth(month,-1))));
 if(month<"210012")nav.push(styledInlineButton("次月 ▶",actions.month(changePickerMonth(month,1))));
 return [...(nav.length?[nav]:[]),...rows,
  [styledInlineButton("⌨️ 日時を入力",actions.manual)],
  [styledInlineButton("↩ 戻る",actions.back),styledInlineButton("キャンセル",actions.cancel,"danger")]];
}
export function pickerHourRows(actions:DateTimePickerActions):Button[][]{
 const hours=Array.from({length:24},(_,h)=>
  styledInlineButton(digits(h)+"時",actions.hour(digits(h)),"primary"));
 const rows:Button[][]=[];
 for(let i=0;i<hours.length;i+=4)rows.push(hours.slice(i,i+4));
 return [...rows,
  [styledInlineButton("⌨️ 時刻を入力",actions.manual)],
  [styledInlineButton("↩ 戻る",actions.back),styledInlineButton("キャンセル",actions.cancel,"danger")]];
}
export function pickerMinuteRows(actions:DateTimePickerActions):Button[][]{
 const minutes=Array.from({length:12},(_,i)=>
  styledInlineButton(digits(i*5)+"分",actions.minute(digits(i*5)),"primary"));
 const rows:Button[][]=[];
 for(let i=0;i<minutes.length;i+=4)rows.push(minutes.slice(i,i+4));
 return [...rows,
  [styledInlineButton("⌨️ 時刻を入力",actions.manual)],
  [styledInlineButton("↩ 戻る",actions.back),styledInlineButton("キャンセル",actions.cancel,"danger")]];
}
