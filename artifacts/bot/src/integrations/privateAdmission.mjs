import { createHmac, timingSafeEqual } from 'node:crypto';

const ACTIONS = new Set(['telegram.preview_announcement', 'telegram.list_campaigns', 'telegram.check_membership']);
const MAX_AGE_MS = 5 * 60 * 1000;

/** This function verifies signed internal messages only. It is not an HTTP handler. */
export function verifyInternalRequest({body, signature, secret, now = Date.now(), useNonce}) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 8192 || typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('invalid security configuration');
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('invalid signature');
  const expected = createHmac('sha256', secret).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new Error('signature mismatch');
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('malformed payload'); }
  if (!data || !ACTIONS.has(data.action) || typeof data.nonce !== 'string' || !/^[\w-]{16,128}$/.test(data.nonce) || !Number.isSafeInteger(data.timestamp) || Math.abs(now - data.timestamp) > MAX_AGE_MS) throw new Error('request not admissible');
  if (!data.target || typeof data.target !== 'string' || data.target.length > 128 || !/^[-_a-zA-Z0-9:]+$/.test(data.target)) throw new Error('invalid target');
  if (typeof useNonce !== 'function' || useNonce(data.nonce, data.timestamp) !== true) throw new Error('replayed request');
  return { action: data.action, target: data.target };
}
