/** Generic Telegram InlineKeyboard selection state (no Telegram-specific toggle primitive).
 * Persist state and enforce revision/owner in the caller before redrawing a screen.
 */
export type SelectionMode = "single-required" | "single-optional" | "multiple";
export function nextSelection<T extends string>(
 mode:SelectionMode,
 current:readonly T[],
 clicked:T,
 allowed:readonly T[],
):T[]{
 if(!allowed.includes(clicked)||new Set(allowed).size!==allowed.length)throw new Error("SELECTION_OPTION_INVALID");
 if(new Set(current).size!==current.length||current.some(x=>!allowed.includes(x)))throw new Error("SELECTION_STATE_INVALID");
 if(mode==="single-required"||mode==="single-optional"){
   if(current.length>1)throw new Error("SELECTION_STATE_INVALID");
   if(current[0]===clicked)return mode==="single-required"?[clicked]:[];
   return [clicked];
 }
 if(mode==="multiple")return current.includes(clicked)
   ?current.filter(x=>x!==clicked):[...current,clicked];
 throw new Error("SELECTION_MODE_INVALID");
}
export function selectionLabel(label:string,checked:boolean):string{
 return (checked?"✅ ":"▫️ ")+label;
}
export function selectionRows<T extends string>(
 rows:readonly (readonly T[])[],
 selected:readonly T[],
 makeCallback:(value:T)=>string,
):{text:string;callback_data:string}[][]{
 if(new Set(rows.flat()).size!==rows.flat().length)throw new Error("SELECTION_OPTION_DUPLICATE");
 return rows.map(row=>row.map(value=>{
  const callback_data=makeCallback(value);
  if(!callback_data||Buffer.byteLength(callback_data,"utf8")>64)
    throw new Error("SELECTION_CALLBACK_INVALID");
  return {text:selectionLabel(value,selected.includes(value)),callback_data};
 }));
}

/** Common Telegram InlineKeyboard choice layout (Master 2026-11-12).
 * Best-effort 4 / 3 / 2 columns based on caption display width.
 * The Telegram client owns the final pixel width, so this is not a
 * guarantee against clipping; live iOS/Android readback is required.
 * A single choice is allowed only when it is the entire candidate set.
 * Footer and decision controls are composed separately by the caller.
 */
export function adaptiveChoiceRows<T extends {text:string}>(items:readonly T[]):T[][]{
 const count=items.length;
 if(count===0)return [];
 if(count===1)return [[items[0]!]];
 const longest=Math.max(...items.map(item=>Array.from(item.text).reduce(
  (sum,ch)=>sum+(/[\u0000-\u007f]/.test(ch)?1:2),0)));
 const maxCols=longest<=6?4:longest<=10?3:2;
 const out:T[][]=[];
 let start=0;
 while(count-start>maxCols){
  const remaining=count-start;
  if(maxCols===2&&remaining%2===1){
   // A final three-wide row is preferable to a one-wide orphan or
   // incorrectly widening an earlier two-wide row to five items.
   if(remaining===3)break;
   out.push(items.slice(start,start+2) as T[]);
   start+=2;
  }else{
   let take=maxCols;
   if(remaining-take===1&&take>2)take--;
   out.push(items.slice(start,start+take) as T[]);
   start+=take;
  }
 }
 out.push(items.slice(start) as T[]);
 if(out.some(row=>row.length<2||row.length>4))
  throw new Error("ADAPTIVE_LAYOUT_INVALID");
 return out;
}
