"""Resident-only private DM test of photo media and caption in the link wizard.

Creates a tiny harmless PNG in-memory, never sends to groups. The already
existing resident test draft is cancelled only after Host ownership guard.
"""
from __future__ import annotations
import asyncio
import io
import re
import struct
import zlib
from datetime import datetime, timedelta, timezone

def png():
    def chunk(kind,data):
        return struct.pack(">I",len(data))+kind+data+struct.pack(">I",zlib.crc32(kind+data)&0xffffffff)
    w=h=64
    raw=b"".join(b"\x00"+b"\x32\x98\xde"*w for _ in range(h))
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw))+chunk(b"IEND",b"")

async def run(client):
    bot=await client.get_entity("GayBBS_bot")
    if not getattr(bot,"bot",False):
        raise RuntimeError("LINK_PHOTO_BOT_INVALID")
    def labels(m):
        return [str(getattr(b,"text","")) for row in (m.buttons or []) for b in row]
    def mark():return datetime.now(timezone.utc)
    async def latest(predicate,t,attempts=14):
        for _ in range(attempts):
            rows=await client.get_messages(bot,limit=60)
            matches=[m for m in rows if not m.out and
                     (m.edit_date or m.date)>=t-timedelta(seconds=3) and predicate(m)]
            if matches:return max(matches,key=lambda m:(m.edit_date or m.date,m.id))
            await asyncio.sleep(1)
        raise RuntimeError("LINK_PHOTO_SCREEN_NOT_FOUND")

    async def menu():
        last=await client.get_messages(bot,limit=1)
        cursor=last[0].id if last else 0
        await client.send_message(bot,"/start")
        for _ in range(12):
            rows=await client.get_messages(bot,limit=30)
            for m in rows:
                if m.id>cursor and not m.out and "🔗ボタン作成" in labels(m):
                    return m
            await asyncio.sleep(1)
        raise RuntimeError("LINK_PHOTO_MENU_NOT_FOUND")
    entry=await menu()
    t=mark();await entry.click(text="🔗ボタン作成")
    current=await latest(lambda m:
        "🔗ボタンを作成する上で一緒に投稿" in (m.raw_text or "") or
        "キャンセル" in labels(m),t)
    if "🔗ボタンを作成する上で一緒に投稿" not in (current.raw_text or ""):
        # Existing draft is test-owned and test-only (Host preflight check).
        if "キャンセル" not in labels(current):
            raise RuntimeError("LINK_PHOTO_TEST_DRAFT_UNEXPECTED")
        await current.click(text="キャンセル")
        entry=await menu()
        t=mark();await entry.click(text="🔗ボタン作成")
        await latest(lambda m:"🔗ボタンを作成する上で一緒に投稿" in (m.raw_text or ""),t)

    image=io.BytesIO(png())
    image.name="link-test-photo.png"
    t=mark()
    await client.send_file(bot,image,caption="画像の補足")
    await latest(lambda m:"1行目：ボタンのタイトル" in (m.raw_text or "")
                 and any("標準" in b for b in labels(m)),t)
    t=mark()
    await client.send_message(bot,"写真付きのリンク\nhttps://example.org/")
    preview=await latest(lambda m:"登録" in labels(m) and "キャンセル" in labels(m),t)
    if not any("写真付きのリンク" in x for x in labels(preview)):
        raise RuntimeError("LINK_PHOTO_REAL_URL_BUTTON_MISSING")
    t=mark()
    await preview.click(text="登録")
    receipt=await latest(lambda m:any("登録コードをコピー" in b for b in labels(m)),t)
    code=re.search(r"@GayBBS_bot ([A-Za-z0-9_-]{24})",receipt.raw_text or "")
    if not code:
        raise RuntimeError("LINK_PHOTO_REGISTERED_CODE_MISSING")
    t=mark()
    await receipt.click(text="編集")
    reopened=await latest(lambda m:"登録" in labels(m) and "キャンセル" in labels(m),t)
    if not any("写真付きのリンク" in x for x in labels(reopened)):
        raise RuntimeError("LINK_PHOTO_EDIT_PREVIEW_URL_MISSING")
    t=mark()
    await reopened.click(text="登録")
    final=await latest(lambda m:any("登録コードをコピー" in b for b in labels(m)),t)
    if code.group(1) not in (final.raw_text or ""):
        raise RuntimeError("LINK_PHOTO_EDIT_CODE_CHANGED")
    return {"status":"PASS","photo_received":True,
            "caption_input_sent":True,"preview_ready":True,
            "photo_registration_receipt":True,
            "registered_edit_preview":True,"registered_code_preserved":True}
