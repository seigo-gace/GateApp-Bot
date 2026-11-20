"""Select a registered GayBBS inline result in OWN Saved Messages and verify Rich body.

The only destination is the resident Userbot's Saved Messages. Never sends
to groups, chats or other people. Deletes only the newly created test result.
"""
from __future__ import annotations
import asyncio
import re

async def _run(client,code,trace):
    if not isinstance(code,str) or not re.fullmatch(r"[A-Za-z0-9_-]{24}",code):
        raise ValueError("LINK_CODE_INVALID")
    trace["stage"]="bot"
    bot=await client.get_entity("GayBBS_bot")
    if not getattr(bot,"bot",False):
        raise RuntimeError("LINK_INLINE_BOT_INVALID")
    self_user=await client.get_me()
    if not self_user or getattr(self_user,"bot",False):
        raise RuntimeError("LINK_SELF_IDENTITY_NOT_VERIFIED")
    before=await client.get_messages("me",limit=1)
    cursor=before[0].id if before else 0
    trace["stage"]="query"
    results=await client.inline_query(bot,code)
    if len(results)!=1:
        raise RuntimeError("LINK_INLINE_RESULT_NOT_FOUND")
    sent_id=None
    try:
        trace["stage"]="select"
        output=await results[0].click("me")
        if output and getattr(output,"id",0)>cursor:
            sent_id=output.id
        trace["stage"]="readback"
        found=None
        for _ in range(12):
            rows=await client.get_messages("me",limit=15)
            for msg in rows:
                if msg.id<=cursor or not getattr(msg,"out",False):
                    continue
                if getattr(msg,"via_bot_id",None)!=bot.id:
                    continue
                if sent_id is not None and msg.id!=sent_id:
                    continue
                sent_id=msg.id
                found=msg
                break
            if found:break
            await asyncio.sleep(1)
        if found is None:
            raise RuntimeError("LINK_INLINE_SELF_POST_NOT_CONFIRMED")
        trace["stage"]="rich"
        rich=getattr(found,"rich_message",None)
        if rich is None:
            raise RuntimeError("LINK_INLINE_POST_MISSING_RICH")
        blocks=getattr(rich,"blocks",None)
        if not blocks:
            raise RuntimeError("LINK_INLINE_POST_EMPTY_RICH")
        trace["stage"]="buttons"
        # Telethon TL type names differ by installed protocol layer. Check
        # the actual buttons payload, not an English class-name substring.
        have_buttons=any(bool(getattr(b,"buttons",None)) for b in blocks)
        if not have_buttons:
            names={type(b).__name__ for b in blocks}
            trace["stage"]="buttons_paragraph" if names=={"RichBlockParagraph"} else "buttons_missing"
            raise RuntimeError("LINK_INLINE_POST_LINK_BUTTONS_MISSING")
        return {"status":"PASS","self_post_sent":True,"rich_body_verified":True,
                "link_buttons_verified":True}
    finally:
        if sent_id is not None and sent_id>cursor:
            await client.delete_messages("me",[sent_id],revoke=True)

async def run(client,code):
    trace={"stage":"setup"}
    try:
        return await _run(client,code,trace)
    except Exception as exc:
        kind=type(exc).__name__
        allowed={"ButtonDataInvalidError","ChatWriteForbiddenError",
                 "MediaEmptyError","MediaInvalidError","BotInlineDisabledError",
                 "InlineResultExpiredError","MessageIdInvalidError"}
        return {"status":"FAIL","stage":trace["stage"],
                "error_class":kind if kind in allowed else "OTHER"}
