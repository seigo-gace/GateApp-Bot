import {pgTable,bigserial,bigint,integer,text,boolean,timestamp,uniqueIndex,index} from "drizzle-orm/pg-core";
export const gate_consents=pgTable("gate_consents",{
 id:bigserial("id",{mode:"number"}).primaryKey(),
 target_id:integer("target_id").notNull(),
 tg_user_id:bigint("tg_user_id",{mode:"number"}).notNull(),
 attempt_id:text("attempt_id").notNull(),
 stage:text("stage").notNull(),
 document_version:text("document_version").notNull(),
 accepted:boolean("accepted").notNull(),
 accepted_at:timestamp("accepted_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
 uniqueIndex("gate_consents_attempt_stage_uidx").on(t.target_id,t.tg_user_id,t.attempt_id,t.stage),
 index("gate_consents_target_user_idx").on(t.target_id,t.tg_user_id,t.accepted_at),
]);
