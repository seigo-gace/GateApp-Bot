import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInternalRequest } from '../src/integrations/privateAdmission.mjs';
const secret = '01234567890123456789012345678901';
const now = 1000000000;
const obj = {action:'telegram.list_campaigns',target:'group_1',nonce:'nonce-01234567890',timestamp:now};
const body = JSON.stringify(obj);
const sign = x => createHmac('sha256',secret).update(x).digest('hex');
const invoke = (payload=body, sig=sign(payload), nonce=()=>true) => verifyInternalRequest({body:payload,signature:sig,secret,now,useNonce:nonce});
test('valid signed read-only internal request',()=>assert.deepEqual(invoke(),{action:'telegram.list_campaigns',target:'group_1'}));
test('reject changed payload after signature',()=>assert.throws(()=>invoke(body+' ',sign(body))));
test('reject stale timestamp even with valid HMAC',()=>{const x=JSON.stringify({...obj,timestamp:now-600000}); assert.throws(()=>invoke(x,sign(x)))});
test('reject arbitrary write from AI',()=>{const x=JSON.stringify({...obj,action:'telegram.delete_group'}); assert.throws(()=>invoke(x,sign(x)))});
test('reject replay nonce',()=>assert.throws(()=>invoke(body,sign(body),()=>false)));
test('reject invalid secret and missing nonce sink',()=>{
 assert.throws(()=>verifyInternalRequest({body,signature:sign(body),secret:'too-short',now,useNonce:()=>true}));
 assert.throws(()=>verifyInternalRequest({body,signature:sign(body),secret,now}));
});
