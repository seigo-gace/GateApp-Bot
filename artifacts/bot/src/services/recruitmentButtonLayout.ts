/** Group recruitment choices: default three columns; a short group may use four. */
export function recruitmentSelectionRows<T>(items:readonly T[],allowFour=false):T[][] {
 const out:T[][]=[];
 for(let i=0;i<items.length;){
  const n=items.length-i;
  const take=n===4?(allowFour?4:2):Math.min(3,n);
  out.push(items.slice(i,i+take) as T[]);
  i+=take;
 }
 return out;
}
