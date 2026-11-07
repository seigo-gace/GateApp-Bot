/**
 * Read-only inventory of currently persisted forum topic identities for the
 * three TGtumbler boards. No Telegram API requests, no migrations, no writes.
 *
 * Run inside an existing @workspace/bot checkout with DATABASE_URL configured:
 * pnpm --dir artifacts/bot exec tsx scripts/exportCommunityTopics.ts
 *
 * This scans available persisted topic mappings. It CANNOT guarantee Telegram
 * forum completeness: Telegram Bot API has no list-all-forum-topics method.
 */
import pg from "pg";

const CHATS = [
  { chat_id: "-1003847210571", board: "area_bbs" },
  { chat_id: "-1002373696859", board: "video_chat" },
  { chat_id: "-1003770334893", board: "gay_board" },
] as const;
const allowed = new Set<string>(CHATS.map(x => x.chat_id));
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("TOPIC_INVENTORY_DATABASE_URL_MISSING");
  process.exit(2);
}
const client = new pg.Client({ connectionString: dbUrl, application_name: "tgtumbler_topic_inventory_readonly" });
type TopicEvidence = {
  chat_id: string; thread_id: string; title: string | null;
  source_table: string; purpose: string | null; verified: boolean;
};
const rows: TopicEvidence[] = [];
const examined: { table: string; count: number; reason?: string }[] = [];
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const meta = await client.query<{table_name:string,column_name:string}>(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN (
          'posting_topics','general_guide_topics','board_menu_panels',
          'profile_publications','log_topics'
        ) ORDER BY table_name,column_name`
  );
  const cols = new Map<string, Set<string>>();
  for (const item of meta.rows) {
    if (!cols.has(item.table_name)) cols.set(item.table_name, new Set());
    cols.get(item.table_name)!.add(item.column_name);
  }
  for (const [table, present] of cols) {
    const chat = ["chat_id", "group_id", "log_group_id"].find(k => present.has(k));
    const thread = ["message_thread_id", "thread_id", "topic_id"].find(k => present.has(k));
    if (!chat || !thread) { examined.push({table,count:0,reason:"no_chat_thread_columns"}); continue; }
    const title = ["topic_title_exact", "topic_title", "title", "name"].find(k => present.has(k));
    const purpose = ["purpose", "panel_type", "document_type"].find(k => present.has(k));
    const verified = present.has("verified_at");
    const enabled = present.has("enabled");
    // All identifiers above are static allow-listed; table name is allow-listed too.
    const where = `WHERE "${chat}"::text = ANY($1::text[]) AND "${thread}" IS NOT NULL`;
    const sql = `SELECT "${chat}"::text AS chat_id, "${thread}"::text AS thread_id,
      ${title ? `"${title}"::text` : "NULL::text"} AS title,
      ${purpose ? `"${purpose}"::text` : "NULL::text"} AS purpose,
      ${verified ? `("verified_at" IS NOT NULL)` : "false"} AS verified
      FROM "${table}" ${where}
      ${enabled ? 'AND "enabled" = TRUE' : ""}`;
    const got = await client.query(sql, [CHATS.map(x=>x.chat_id)]);
    for (const item of got.rows) {
      if (!allowed.has(String(item.chat_id)) || !/^\\d+$/.test(String(item.thread_id))) continue;
      rows.push({
        chat_id:String(item.chat_id), thread_id:String(item.thread_id),
        title:item.title==null?null:String(item.title),purpose:item.purpose==null?null:String(item.purpose),
        source_table:table,verified:item.verified===true,
      });
    }
    examined.push({table,count:got.rowCount ?? got.rows.length});
  }
  await client.query("COMMIT");
  const sorted = rows.sort((a,b) => a.chat_id.localeCompare(b.chat_id) ||
    Number(a.thread_id)-Number(b.thread_id) || a.source_table.localeCompare(b.source_table));
  const byGroup = CHATS.map(g => {
    const groupEvidence=sorted.filter(r=>r.chat_id===g.chat_id);
    const unique = [...new Set(groupEvidence.map(r=>r.thread_id))];
    return { ...g, observed_unique_thread_count:unique.length,
      rows:groupEvidence, unresolved_missing_title:unique.filter(id=>!groupEvidence.some(r=>r.thread_id===id && r.title)) };
  });
  process.stdout.write(JSON.stringify({
    schema:"tgtumbler.bot-topic-evidence/v1", collected_at:new Date().toISOString(),
    scope:"PERSISTED_BOT_DB_ONLY_NOT_TELEGRAM_FULL_INVENTORY",
    groups:byGroup, sources:examined,
    warning:"Bot API cannot enumerate all existing forum topics; unobserved topics remain unknown."
  },null,2)+"\\n");
} catch (err) {
  try { await client.query("ROLLBACK"); } catch {}
  console.error("TOPIC_INVENTORY_READ_FAILED", err instanceof Error ? err.message.replace(/postgres(?:ql)?:\\/\\/[^\\s]+/g,"[DB_URL_REDACTED]") : "unknown");
  process.exitCode=1;
} finally {
  await client.end();
}
