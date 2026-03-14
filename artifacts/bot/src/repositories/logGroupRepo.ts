import { db, log_groups, log_topics } from "../db/index.js";
import { eq } from "drizzle-orm";
import type { LogGroup, InsertLogGroup } from "../db/schema/log_groups.js";
import type { LogTopic, InsertLogTopic } from "../db/schema/log_topics.js";

export async function createLogGroup(data: InsertLogGroup): Promise<LogGroup> {
  const rows = await db
    .insert(log_groups)
    .values(data)
    .onConflictDoUpdate({
      target: log_groups.chat_id,
      set: { title: data.title, updated_at: new Date() },
    })
    .returning();
  return rows[0]!;
}

export async function getLogGroupById(logGroupId: number): Promise<LogGroup | undefined> {
  const rows = await db
    .select()
    .from(log_groups)
    .where(eq(log_groups.log_group_id, logGroupId));
  return rows[0];
}

export async function getLogGroupByChatId(chatId: number): Promise<LogGroup | undefined> {
  const rows = await db
    .select()
    .from(log_groups)
    .where(eq(log_groups.chat_id, chatId));
  return rows[0];
}

export async function getAllLogGroups(): Promise<LogGroup[]> {
  return db.select().from(log_groups);
}

export async function getLogGroupsByOwner(ownerUserId: number): Promise<LogGroup[]> {
  return db.select().from(log_groups).where(eq(log_groups.owner_user_id, ownerUserId));
}

export async function deleteLogGroup(logGroupId: number): Promise<void> {
  await db.delete(log_groups).where(eq(log_groups.log_group_id, logGroupId));
}

// Log topics
export async function createLogTopic(data: InsertLogTopic): Promise<LogTopic> {
  const rows = await db.insert(log_topics).values(data).returning();
  return rows[0]!;
}

export async function getTopicsByLogGroup(logGroupId: number): Promise<LogTopic[]> {
  return db
    .select()
    .from(log_topics)
    .where(eq(log_topics.log_group_id, logGroupId));
}

export async function getLogTopicById(logTopicId: number): Promise<LogTopic | undefined> {
  const rows = await db
    .select()
    .from(log_topics)
    .where(eq(log_topics.log_topic_id, logTopicId));
  return rows[0];
}

export async function updateLogTopic(
  logTopicId: number,
  data: Partial<InsertLogTopic>
): Promise<LogTopic | undefined> {
  const rows = await db
    .update(log_topics)
    .set({ ...data, updated_at: new Date() })
    .where(eq(log_topics.log_topic_id, logTopicId))
    .returning();
  return rows[0];
}

export async function deleteLogTopic(logTopicId: number): Promise<void> {
  await db.delete(log_topics).where(eq(log_topics.log_topic_id, logTopicId));
}
