import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCampaignLink, previewCmRotation, appendCmButtons} from '../src/integrations/cmRotation.mjs';
const items = Array.from({length:5},(_,i)=>({id:String(i+1),label:'CM'+(i+1),url:'https://example.org/'+i}));
test('rotate 3 of 5 without duplicates',()=>{
 const a=previewCmRotation(items,0);
 const b=previewCmRotation(items,a.nextCursor);
 assert.deepEqual(a.selected.map(x=>x.id),['1','2','3']);
 assert.deepEqual(b.selected.map(x=>x.id),['4','5','1']);
});
test('disabled links are skipped',()=>assert.equal(previewCmRotation([...items,{id:'6',label:'off',url:'https://example.org',enabled:false}]).selected.length,3));
test('short list is not repeated',()=>assert.equal(previewCmRotation(items.slice(0,2)).selected.length,2));
test('insecure url rejected',()=>{
 for(const url of ['http://example.org','javascript:alert(1)','https://user:pass@example.org']) assert.throws(()=>validateCampaignLink({id:'x',label:'x',url}));
});
test('original Telegram buttons stay first',()=>{
 const rows=[[{text:'参加',callback_data:'join'}]];
 const output=appendCmButtons(rows,previewCmRotation(items).selected);
 assert.deepEqual(rows,[[{text:'参加',callback_data:'join'}]]);
 assert.equal(output[0][0].callback_data,'join');
 assert.equal(output.length,4);
});
test('preview is pure and cursor may be committed only after verified send',()=>{
 assert.deepEqual(previewCmRotation(items,3),previewCmRotation(items,3));
 assert.throws(()=>previewCmRotation(items,-1));
});
