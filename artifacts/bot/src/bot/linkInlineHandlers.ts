/** Existing GayBBS Bot inline mode: a saved owner-scoped post code maps to
 * exactly one result. Uses the same LinkDraft and buttonGrid, not a new bot.
 */
import type {Telegraf} from "telegraf";
import {linkInlineResult,readLinkShare} from "../services/linkInlineShare.js";

export function registerLinkInlineHandlers(bot:Telegraf):void{
 bot.on("inline_query",async ctx=>{
  const code=ctx.inlineQuery.query.trim();
  try{
   const post=await readLinkShare(ctx.from.id,code);
   const results=post?[linkInlineResult(post)]:[];
   await ctx.answerInlineQuery(results as unknown as Parameters<typeof ctx.answerInlineQuery>[0],
    {is_personal:true,cache_time:0});
  }catch(error){
   console.error("[LINK_INLINE_QUERY_FAILED]",
    error instanceof Error?error.message:"unknown");
   await ctx.answerInlineQuery([],{is_personal:true,cache_time:0});
  }
 });
}
