/** Isolated PostgreSQL integration test: never connect to a production DB.
 * CI assigns temporary Postgres 16 and a dedicated test database.
 */
import assert from "node:assert/strict";
import {runMigrations} from "../src/db/migrate.js";
import {pool,closePool} from "../src/db/index.js";
import {submitApplication,decideApplication} from "../src/services/announcementApplications.js";
if(!process.env.DATABASE_URL?.endsWith("/gaybbs_test"))
 throw new Error("INTEGRATION_MUST_USE_GAYBBS_TEST_DB");

try{
 await runMigrations();
 await runMigrations(); // idempotency when a container is restarted.
 for(const table of ["profiles","profile_tags","profile_media","profile_publications",
  "posting_topics","posting_deliveries","public_post_drafts",
  "room_posts","announcement_posts","announcement_applications",
  "announcement_notifications","announcement_application_entries",
  "link_button_posts","general_guide_topics","general_guide_documents",
  "board_menu_panels","board_menu_entry_tokens","gaybbs_feature_release_gates"]){
  const found=await pool.query("SELECT to_regclass($1)::text AS reg",[table]);
  assert.ok(found.rows[0]?.reg,table);
 }
 const draft=await pool.query(
  `INSERT INTO announcement_posts
    (request_key,owner_user_id,kind,text,status,capacity,accept_applications)
   VALUES('db-int-1',111001,'recruitment','テスト募集','published',1,TRUE)
   RETURNING announcement_id`);
 const id=Number(draft.rows[0].announcement_id);
 const a=await submitApplication(id,222001,null);
 const b=await submitApplication(id,222002,null);
 assert.equal(a.duplicate,false);
 assert.equal((await submitApplication(id,222001,null)).duplicate,true);
 assert.equal(b.duplicate,false);
 const decisions=await Promise.allSettled([
  decideApplication(111001,id,a.applicationId,"accepted"),
  decideApplication(111001,id,b.applicationId,"accepted"),
 ]);
 assert.equal(decisions.filter(x=>x.status==="fulfilled").length,1,
  "capacity=1 concurrent decisions must commit one only");
 assert.equal(decisions.filter(x=>x.status==="rejected").length,1);
 const posts=await pool.query(
  "SELECT status,accept_applications FROM announcement_posts WHERE announcement_id=$1",[id]);
 assert.equal(posts.rows[0].status,"filled");
 assert.equal(posts.rows[0].accept_applications,false);
 const count=await pool.query(
  `SELECT count(*)::int AS n FROM announcement_applications
   WHERE announcement_id=$1 AND status='accepted'`,[id]);
 assert.equal(Number(count.rows[0].n),1);
 const notify=await pool.query(
  "SELECT count(*)::int AS n FROM announcement_notifications WHERE announcement_id=$1",[id]);
 assert.equal(Number(notify.rows[0].n),3,
  "two submitted notifications and one owner decision notification");
 console.log("GAYBBS_DB_MIGRATION_AND_APPLICATION_CONCURRENCY=PASS");
}finally{await closePool();}
