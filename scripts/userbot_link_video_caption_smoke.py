"""Private-only MP4-document fallback and caption acceptance through the authorized resident Userbot.

The fixed 1-second H.264 MP4 is synthetic test media. Sends only to @GayBBS_bot DM.
No public group action, no additional Telegram session, no credential reads.
"""
from __future__ import annotations
import asyncio
import base64
import tempfile
from datetime import datetime, timezone, timedelta

VIDEO_BASE64="AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAqB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAQAAABAAAAAAIYbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABw21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwAoPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAYeAAAAvAAAAAYc3R0cwAAAAAAAAABAAAABQAACAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAADhjdHRzAAAAAAAAAAUAAAABAAAQAAAAAAEAACgAAAAAAQAAEAAAAAABAAAAAAAAAAEAAAgAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAFAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAAALAAAAA4AAAAMAAAADAAAAAwAAAAUc3RjbwAAAAAAAAABAAADpQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDMAAAAIZnJlZQAAAGZtZGF0AAAAKGWIhAAS//7oyfzLLXnmdRqJlloPlaccwj0dI/65B2ZLyCHBWQeLicEAAAAKQZokbEP//qmdNAAAAAhBnkJ4gh8CxwAAAAgBnmF0Q/8ExAAAAAgBnmNqQ/8ExQ=="

async def _run(client, trace):
    bot=await client.get_entity("GayBBS_bot")
    if not getattr(bot,"bot",False):
        raise RuntimeError("LINK_VIDEO_BOT_INVALID")
    def labels(m):
        return [str(getattr(b,"text","")) for row in (m.buttons or []) for b in row]
    async def latest(predicate,mark,attempts=14):
        for _ in range(attempts):
            rows=await client.get_messages(bot,limit=60)
            found=[m for m in rows if not m.out and
                   (m.edit_date or m.date)>=mark-timedelta(seconds=3)
                   and predicate(m)]
            if found:return max(found,key=lambda m:(m.edit_date or m.date,m.id))
            await asyncio.sleep(1)
        raise RuntimeError("LINK_VIDEO_SCREEN_NOT_FOUND")
    trace["stage"]="menu"
    history=await client.get_messages(bot,limit=1)
    cursor=history[0].id if history else 0
    await client.send_message(bot,"/start")
    entry=None
    for _ in range(14):
        rows=await client.get_messages(bot,limit=35)
        entry=next((m for m in rows if not m.out and m.id>cursor
                    and "🔗ボタン作成" in labels(m)),None)
        if entry:break
        await asyncio.sleep(1)
    if not entry:raise RuntimeError("LINK_VIDEO_MENU_NOT_FOUND")
    t=datetime.now(timezone.utc)
    await entry.click(text="🔗ボタン作成")
    screen=await latest(lambda m:"🔗ボタンを作成する上で一緒に投稿" in (m.raw_text or "")
                        or "キャンセル" in labels(m),t)
    if "🔗ボタンを作成する上で一緒に投稿" not in (screen.raw_text or ""):
        # Resume only the uniquely identified, already-persisted test draft.
        # Never overwrite someone else's unregistered editor.
        if not ({"登録","キャンセル","動画付きのリンク"} <= set(labels(screen))):
            raise RuntimeError("LINK_VIDEO_EXISTING_DRAFT_BLOCKED")
        preview=screen
    else:
        trace["stage"]="video"
        t=datetime.now(timezone.utc)
        from telethon.tl import types
        # Deliberately send MP4 as Document to verify the link editor fallback.
        # Keep test bytes only in a disposable local file.
        with tempfile.NamedTemporaryFile(suffix=".mp4",prefix="link-video-test-",mode="w+b") as clip:
            clip.write(base64.b64decode(VIDEO_BASE64))
            clip.flush()
            sent=await client.send_file(
                bot,clip.name,caption="動画の補足",force_document=True,
                mime_type="video/mp4",supports_streaming=True,
                attributes=[types.DocumentAttributeVideo(duration=1,w=64,h=64,supports_streaming=True)])
        if not getattr(sent,"document",None):
            raise RuntimeError("LINK_MP4_DOCUMENT_NOT_SENT")
        await latest(lambda m:"1行目：ボタンのタイトル" in (m.raw_text or "")
                     and any("標準" in v for v in labels(m)),t)
        trace["stage"]="pair"
        t=datetime.now(timezone.utc)
        await client.send_message(bot,"動画付きのリンク\\nhttps://example.org/")
        preview=await latest(lambda m:"登録" in labels(m) and "キャンセル" in labels(m),t)
        if "動画付きのリンク" not in labels(preview):
            raise RuntimeError("LINK_VIDEO_REAL_URL_BUTTON_MISSING")
    trace["stage"]="register"
    t=datetime.now(timezone.utc)
    await preview.click(text="登録")
    await latest(lambda m:any("登録コードをコピー" in v for v in labels(m)),t)
    return {"status":"PASS","video_received":True,"caption_sent":True,
            "real_url_button":True,"registration_receipt":True}

VIDEO_SAFE_ERRORS=frozenset({
    "LINK_VIDEO_BOT_INVALID","LINK_VIDEO_MENU_NOT_FOUND",
    "LINK_VIDEO_SCREEN_NOT_FOUND","LINK_VIDEO_EXISTING_DRAFT_BLOCKED",
    "LINK_VIDEO_REAL_URL_BUTTON_MISSING",
    "LINK_MP4_DOCUMENT_NOT_SENT",
})

async def run(client):
    trace={"stage":"setup"}
    try:
        return await _run(client,trace)
    except Exception as exc:
        code=str(exc)
        if code=="LINK_VIDEO_SCREEN_NOT_FOUND":
            code="LINK_VIDEO_SCREEN_NOT_FOUND_"+trace["stage"].upper()
        elif code not in VIDEO_SAFE_ERRORS:
            code="LINK_VIDEO_UNCLASSIFIED_"+trace["stage"].upper()
        return {"status":"FAIL","error":code}
