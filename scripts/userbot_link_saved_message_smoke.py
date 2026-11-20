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
        # The adopted layout uses Telegram's real inline keyboard under
        # the rich content, not URL buttons embedded in the Rich blocks.
        rows=getattr(found,"buttons",None) or []
        urls=[getattr(button,"url",None) for row in rows for button in row]
        if not any(isinstance(url,str) and url.startswith("https://") for url in urls):
            raise RuntimeError("LINK_INLINE_POST_LINK_BUTTONS_MISSING")
        forbidden={"登録","キャンセル","［ボタンの追加］","［内容の編集］"}
        labels={str(getattr(button,"text","")) for row in rows for button in row}
        if labels.intersection(forbidden):
            raise RuntimeError("LINK_INLINE_POST_EDITOR_BUTTONS_LEAKED")
        if "動画付きのリンク" in labels:
            trace["stage"]="video_media"
            # A native video stays RichVideo; an MP4 uploaded as a document
            # must stay RichDocument. Never falsely relabel the file.
            if not any(any(kind in type(block).__name__.lower() for kind in
                           ("video","document")) for block in blocks):
                raise RuntimeError("LINK_SAVED_VIDEO_BLOCK_MISSING")
            if "動画の補足" not in str(rich):
                raise RuntimeError("LINK_SAVED_VIDEO_CAPTION_MISSING")
        if "写真付きのリンク" in labels:
            trace["stage"]="photo_media"
            if not any("photo" in type(block).__name__.lower() for block in blocks):
                raise RuntimeError("LINK_SAVED_PHOTO_BLOCK_MISSING")
            if "画像の補足" not in str(rich):
                raise RuntimeError("LINK_SAVED_PHOTO_CAPTION_MISSING")
        trace["stage"]="receipt"
        # Only the receipt containing this exact, owner-scoped code may be edited.
        # The rich body is an MTProto object; raw_text alone may be empty.
        def names(msg):
            return {str(getattr(b,"text","")) for row in (getattr(msg,"buttons",None) or []) for b in row}
        def code_visible(msg):
            return code in (getattr(msg,"raw_text",None) or "") or code in str(getattr(msg,"rich_message",None) or "")
        receipts=[m for m in await client.get_messages(bot,limit=45) if not m.out
                  and {"登録コードをコピー","編集","新規作成"} <=
                      {x.removeprefix("📋 ") for x in names(m)}
                  and code_visible(m)]
        if len(receipts)!=1:
            raise RuntimeError("LINK_REGISTERED_TEST_RECEIPT_NOT_UNIQUE")
        receipt=receipts[0]
        trace["stage"]="registered_edit"
        await receipt.click(text="編集")
        preview=None
        for _ in range(12):
            updated=await client.get_messages(bot,ids=receipt.id)
            if updated and {"登録","キャンセル"} <= names(updated):
                preview=updated
                break
            await asyncio.sleep(1)
        if preview is None:
            raise RuntimeError("LINK_REGISTERED_EDIT_PREVIEW_MISSING")
        if code_visible(preview):
            raise RuntimeError("LINK_REGISTERED_EDIT_PREVIEW_LEAKED_CODE")
        trace["stage"]="reregister"
        await preview.click(text="登録")
        final=None
        for _ in range(12):
            updated=await client.get_messages(bot,ids=receipt.id)
            if updated and "登録コードをコピー" in {x.removeprefix("📋 ") for x in names(updated)}:
                final=updated
                break
            await asyncio.sleep(1)
        if final is None or not code_visible(final):
            raise RuntimeError("LINK_REGISTERED_CODE_NOT_PRESERVED")
        return {"status":"PASS","self_post_sent":True,"rich_body_verified":True,
                "link_buttons_verified":True,"registered_edit_reopened":True,
                "registered_code_preserved":True}
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
