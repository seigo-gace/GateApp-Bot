"""Private-only Telegram Rich-button callback acceptance via existing resident Userbot.

This is a bounded test of the already-real @GayBBS_bot DM message. It invokes
Telegram's GetBotCallbackAnswer for a real message, never a synthetic Bot
update. It cannot publish to any group. It uses one harmless draft only.
"""
from __future__ import annotations
import asyncio
import re
from datetime import datetime, timezone, timedelta

async def _run(client, trace):
    from telethon import functions
    bot=await client.get_entity("GayBBS_bot")
    if not getattr(bot,"bot",False):
        raise RuntimeError("LINK_RICH_BOT_INVALID")

    def labels(m):
        return [str(getattr(b,"text","")) for row in (m.buttons or []) for b in row]
    def cb_data(b):
        d=getattr(b,"data",None)
        if d is None:
            d=getattr(getattr(b,"button",None),"data",None)
        return d
    def revision(msg):
        for row in (msg.buttons or []):
            for button in row:
                value=cb_data(button) or b""
                match=re.fullmatch(
                    rb"post:link:(?:register|back|restart|change|cancel):(\\d+)",
                    value)
                if match:
                    return int(match.group(1))
        raise RuntimeError("LINK_RICH_REVISION_UNAVAILABLE")

    async def latest(predicate,mark,attempts=15):
        for _ in range(attempts):
            messages=await client.get_messages(bot,limit=65)
            for m in messages:
                if m.out:continue
                t=m.edit_date or m.date
                if (t and t>=mark-timedelta(seconds=3) and predicate(m)):
                    return m
            await asyncio.sleep(1)
        raise RuntimeError("LINK_RICH_SCREEN_NOT_FOUND")
    async def callback(msg,payload):
        result=await client(functions.messages.GetBotCallbackAnswerRequest(
            peer=bot,msg_id=msg.id,data=payload.encode("utf8")))
        return str(getattr(result,"message","") or "")
    def mk():return datetime.now(timezone.utc)

    trace["stage"]="menu"
    before=await client.get_messages(bot,limit=1)
    cursor=before[0].id if before else 0
    await client.send_message(bot,"/start")
    menu=None
    for _ in range(12):
        for m in await client.get_messages(bot,limit=30):
            if m.id>cursor and not m.out and "🔗ボタン作成" in labels(m):
                menu=m;break
        if menu:break
        await asyncio.sleep(1)
    if not menu:raise RuntimeError("LINK_RICH_MENU_NOT_FOUND")

    trace["stage"]="open_link"
    mark=mk();await menu.click(text="🔗ボタン作成")
    await latest(lambda m:"🔗ボタンを作成する上で一緒に投稿" in (m.raw_text or ""),mark)
    trace["stage"]="material"
    mark=mk();await client.send_message(bot,"Rich編集の安全テスト")
    await latest(lambda m:"1行目：ボタンのタイトル" in (m.raw_text or "")
                 and any("標準" in label for label in labels(m)),mark)
    trace["stage"]="first_link"
    mark=mk();await client.send_message(bot,"一番目\nhttps://example.org/")
    preview=await latest(lambda m:"登録" in labels(m) and "キャンセル" in labels(m),mark)

    rev=revision(preview)

    trace["stage"]="panel"
    mark=mk();await callback(preview,f"post:link:panel:{rev}")
    placement=await latest(lambda m:"戻る" in labels(m) and "キャンセル" in labels(m)
                           and "登録" not in labels(m),mark)
    trace["stage"]="add"
    rev=revision(placement)
    mark=mk();await callback(placement,f"post:link:add:{rev}")
    input_screen=await latest(lambda m:"1行目：ボタンのタイトル" in (m.raw_text or "")
                 and any("標準" in label for label in labels(m)),mark)
    rev=revision(input_screen)
    trace["stage"]="second_link"
    mark=mk();await client.send_message(bot,"二番目\nhttps://example.com/")
    placement=await latest(lambda m:"戻る" in labels(m)
                           and "キャンセル" in labels(m)
                           and "登録" not in labels(m),mark)
    trace["stage"]="delete"
    rev=revision(placement)
    mark=mk()
    answer=await callback(placement,f"post:link:delete:{rev}:1")
    if "削除" not in answer:
        raise RuntimeError("LINK_RICH_DELETE_NOT_ACKNOWLEDGED")

    placement=await latest(lambda m:"戻る" in labels(m) and "キャンセル" in labels(m)
                           and "登録" not in labels(m),mark)
    trace["stage"]="back"
    rev=revision(placement)
    mark=mk();await callback(placement,f"post:link:back:{rev}")
    preview=await latest(lambda m:"登録" in labels(m),mark)
    trace["stage"]="content"
    rev=revision(preview)
    mark=mk();await callback(preview,f"post:link:content:{rev}")
    content=await latest(lambda m:"変更" in labels(m) and "戻る" in labels(m),mark)
    trace["stage"]="field"
    rev=revision(content)
    mark=mk();await callback(content,f"post:link:field:{rev}:text")
    selected=await latest(lambda m:"変更" in labels(m),mark)
    trace["stage"]="change"
    rev=revision(selected)
    mark=mk();await selected.click(text="変更")
    await latest(lambda m:"新しい文章をDMで送信" in (m.raw_text or ""),mark)
    trace["stage"]="save_edit"
    mark=mk();await client.send_message(bot,"個別編集済みの安全テスト")
    await latest(lambda m:"登録" in labels(m),mark)
    return {"status":"PASS","rich_add":True,"rich_delete":True,
            "rich_field_select":True,"rich_text_change":True,
            "no_public_post":True}


async def run(client):
    # Only a bounded phase code leaves the resident process; no Telegram
    # text, identity or raw exception is returned in failure responses.
    trace={"stage":"setup"}
    try:
        return await _run(client,trace)
    except Exception:
        return {"status":"FAIL","stage":trace["stage"]}
