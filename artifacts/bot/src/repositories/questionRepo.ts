import { db, questions } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import type { Question, InsertQuestion } from "../db/schema/questions.js";

export async function getQuestionsByTarget(targetId: number): Promise<Question[]> {
  return db
    .select()
    .from(questions)
    .where(eq(questions.target_id, targetId))
    .orderBy(questions.order_index);
}

export async function getQuestionByTargetAndOrder(
  targetId: number,
  orderIndex: number
): Promise<Question | undefined> {
  const rows = await db
    .select()
    .from(questions)
    .where(and(eq(questions.target_id, targetId), eq(questions.order_index, orderIndex)));
  return rows[0];
}

export async function upsertQuestion(data: InsertQuestion): Promise<Question> {
  const existing = await getQuestionByTargetAndOrder(data.target_id, data.order_index);
  if (existing) {
    const rows = await db
      .update(questions)
      .set({ ...data, updated_at: new Date() })
      .where(eq(questions.question_id, existing.question_id))
      .returning();
    return rows[0]!;
  }
  const rows = await db.insert(questions).values(data).returning();
  return rows[0]!;
}

export async function updateQuestion(
  questionId: number,
  data: Partial<InsertQuestion>
): Promise<Question | undefined> {
  const rows = await db
    .update(questions)
    .set({ ...data, updated_at: new Date() })
    .where(eq(questions.question_id, questionId))
    .returning();
  return rows[0];
}
