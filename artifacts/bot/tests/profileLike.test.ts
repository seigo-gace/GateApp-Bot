import test from "node:test";
import assert from "node:assert/strict";
import {LIKE_CATEGORIES,LIKE_PAGE_SIZE,validLikeTags,toggleLike,likeCategoryRows,likeItemRows,tagPurposeDescription} from "../src/services/profileLike.js";
test("shared 140 literal candidates in six stable categories",()=>{
 assert.deepEqual(LIKE_CATEGORIES.map(c=>[c.name,c.items.length]),[
  ["エロワード",11],["パーツ",22],["プレイ",54],["雰囲気/外見",25],["着衣/装備",16],["性感帯",12]]);
 assert.equal(LIKE_CATEGORIES.reduce((n,c)=>n+c.items.length,0),140);
 assert.equal(LIKE_PAGE_SIZE,12);
 assert.match(tagPurposeDescription("like"),/自分/);
 assert.match(tagPurposeDescription("love"),/相手/);
});
test("identical tag in different categories remains distinct; toggle reverses only clicked item",()=>{
 const first=toggleLike([],1,0);
 const second=toggleLike(first,5,0);
 assert.equal(second.length,2);
 assert.deepEqual(toggleLike(second,1,0),[{category:"性感帯",tag:"乳首"}]);
 assert.throws(()=>validLikeTags([{category:"パーツ",tag:"別のタグ"}]));
 assert.throws(()=>validLikeTags([first[0]!,first[0]!]));
});
test("both purposes use the same 3/3/2-category rows and every screen has Save",()=>{
 for(const purpose of ["like","love"] as const){
  const parent=likeCategoryRows(1,[],purpose);
  assert.deepEqual(parent.map(r=>r.length),[3,3,2]);
  assert.ok(parent[2].some(b=>b.text==="保存"&&b.callback_data.endsWith(":save")));
  for(let i=0;i<6;i++){
   const category=LIKE_CATEGORIES[i]!;
   const pages=Math.ceil(category.items.length/LIKE_PAGE_SIZE);
   for(let p=0;p<pages;p++){
    const rows=likeItemRows(1,i,p,[],purpose);
    const options=rows.flat().filter(b=>b.callback_data.includes(":tag:"));
    assert.equal(options.length,Math.min(LIKE_PAGE_SIZE,category.items.length-p*LIKE_PAGE_SIZE));
    assert.ok(rows.at(-1)!.some(b=>b.text==="保存"&&b.callback_data.endsWith(":save")));
    assert.ok(rows.at(-1)!.some(b=>b.text==="↩ 戻る"));
    assert.ok(rows.at(-1)!.some(b=>b.text==="この分類を解除"));
    assert.ok(rows.every(row=>row.length>=1&&row.length<=3));
    assert.ok(rows.flat().every(b=>Buffer.byteLength(b.callback_data,"utf8")<=64));
   }
  }
 }
});
