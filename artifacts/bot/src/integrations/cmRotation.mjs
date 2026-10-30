/** Pure CM selector. Caller owns durable cursor, authorization and send readback. */
export function validateCampaignLink(item) {
  if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 60) throw new Error('invalid CM entry');
  let url;
  try { url = new URL(item.url); } catch { throw new Error('invalid CM URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || item.url.includes('\n')) throw new Error('insecure CM URL');
  return { id: item.id, label: item.label, url: url.href, enabled: item.enabled !== false };
}
export function previewCmRotation(items, cursor = 0, count = 3) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(count) || count < 0 || count > 3) throw new Error('invalid rotation');
  const active = items.map(validateCampaignLink).filter(x => x.enabled).sort((a,b) => a.id.localeCompare(b.id));
  if (!active.length || !count) return { selected: [], nextCursor: cursor };
  const offset = cursor % active.length;
  const selected = Array.from({ length: Math.min(count, active.length) }, (_, i) => active[(offset+i) % active.length]);
  return { selected, nextCursor: cursor + selected.length };
}
export function appendCmButtons(existingRows, selected) {
  const rows = existingRows.map(row => row.map(button => ({...button})));
  for (const item of selected) rows.push([{ text: '🔗 ' + item.label, url: item.url }]);
  return rows;
}
