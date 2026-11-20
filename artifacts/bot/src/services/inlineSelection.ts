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
