"""Bounded public-feature smoke in the resident account's private @GayBBS_bot DM.

Only a harmless example.org URL and test title are submitted. No public post,
group join, extra session, credentials or arbitrary Telegram API commands.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta, timezone

async def run(client):
    bot=await client.get_entity("GayBBS_bot")
    if not getattr(bot,"bot",False):
        raise RuntimeError("LINK_TEST_BOT_IDENTITY_INVALID")

    def labels(msg):
        return [[str(getattr(b,"text","")) for b in row]
                for row in (getattr(msg,"buttons",None) or [])]

    async def wait(predicate, started, attempts=14):
        for _ in range(attempts):
            for msg in await client.get_messages(bot,limit=80):
                if getattr(msg,"out",False):
                    continue
                changed=getattr(msg,"edit_date",None) or getattr(msg,"date",None)
                if changed and changed>=started-timedelta(seconds=2) and predicate(msg):
                    return msg
            await asyncio.sleep(1)
        raise RuntimeError("LINK_DM_EXPECTED_SCREEN_TIMEOUT")

    from userbot_resident_ipc import EXPECTED_MENU
    last=await client.get_messages(bot,limit=1)
    cursor=last[0].id if last else 0
    await client.send_message(bot,"/start")
    async def new_menu():
        for _ in range(12):
            for msg in await client.get_messages(bot,limit=25):
                if msg.id>cursor and not msg.out and labels(msg)==EXPECTED_MENU:
                    return msg
            await asyncio.sleep(1)
        raise RuntimeError("LINK_TEST_MENU_NOT_RECEIVED")
    menu=await new_menu()
    mark=datetime.now(timezone.utc)
    await menu.click(text="🔗ボタン作成")
    await wait(lambda m:"🔗ボタンを作成する上で一緒に投稿" in (m.raw_text or ""),mark)

    mark=datetime.now(timezone.utc)
    material=await client.send_message(bot,"リンク機能テスト用の本文")
    stage=await wait(lambda m:"1行目：ボタンのタイトル" in (m.raw_text or "")
                     and any("青" in b for row in labels(m) for b in row),mark)
    blue=next((b for row in labels(stage) for b in row if "青" in b),None)
    if not blue:
        raise RuntimeError("LINK_TEST_COLOR_MISSING")
    mark=datetime.now(timezone.utc)
    await stage.click(text=blue)
    await wait(lambda m:any("✅ 青" in b for row in labels(m) for b in row),mark)

    mark=datetime.now(timezone.utc)
    pair=await client.send_message(bot,"リンク機能テスト\nhttps://example.org/")
    preview=await wait(lambda m:any("登録"==b for row in labels(m) for b in row)
                       and any("キャンセル"==b for row in labels(m) for b in row),mark)
    mark=datetime.now(timezone.utc)
    await preview.click(text="登録")
    receipt=await wait(lambda m:any("投稿コードをコピー" in b
                         for row in labels(m) for b in row),mark)
    if not receipt:
        raise RuntimeError("LINK_TEST_REGISTER_NO_RECEIPT")
    # Input deletion is independently checked without reproducing private DM.
    pair_deleted=await client.get_messages(bot,ids=pair.id) is None
    return {"status":"PASS","link_editor_opened":True,
            "two_line_button_accepted":True,"blue_selected":True,
            "preview_present":True,"registration_receipt":True,
            "input_deleted":pair_deleted}
