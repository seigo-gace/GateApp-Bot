#!/usr/bin/env python3
"""No Telegram network, secrets, session or worker lifecycle used in these tests."""
import asyncio
import unittest
import pathlib
import tempfile
from unittest.mock import patch
from types import SimpleNamespace

from userbot_resident_ipc import EXPECTED_MENU, process_request


class MockClient:
    def __init__(self, authorized=True, menu=None):
        self.authorized = authorized
        self.menu = menu if menu is not None else EXPECTED_MENU
        self.sent = []

    async def is_user_authorized(self):
        return self.authorized

    def is_connected(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return SimpleNamespace(bot=True)

    async def get_messages(self, bot, limit):
        if not self.sent:
            return [SimpleNamespace(id=10)]
        buttons = [[SimpleNamespace(text=x) for x in row] for row in self.menu]
        return [SimpleNamespace(id=11, out=False, buttons=buttons)]

    async def send_message(self, bot, message):
        self.sent.append(message)


class ResidentSafetyTests(unittest.TestCase):
    def test_health_only_reads_authorization(self):
        c = MockClient()
        out = asyncio.run(process_request(c, {"request_id": "health-1", "action": "health"}))
        self.assertEqual(out["status"], "PASS")
        self.assertEqual(c.sent, [])

    def test_live_bot_menu_allowlisted(self):
        c = MockClient()
        out = asyncio.run(process_request(c, {"request_id": "menu-1", "action": "bot_start_menu"}))
        self.assertEqual(out["status"], "PASS")
        self.assertEqual(out["row_sizes"], [3, 2, 2, 3, 1])
        self.assertEqual(c.sent, ["/start"])

    def test_link_button_smoke_uses_existing_bot_dm_without_session_restart(self):
        from datetime import datetime, timezone
        class LinkClient(MockClient):
            async def get_messages(self, bot, limit):
                if getattr(self, "clicked", False):
                    return [SimpleNamespace(id=12, out=False,
                        raw_text="🔗ボタンを作成する上で一緒に投稿",
                        edit_date=datetime.now(timezone.utc), date=datetime.now(timezone.utc))]
                messages=await super().get_messages(bot, limit)
                for m in messages:
                    async def click(text):
                        if text != "🔗ボタン作成":
                            raise RuntimeError("WRONG_LINK_BUTTON")
                        self.clicked=True
                    m.click=click
                return messages
        c=LinkClient()
        out=asyncio.run(process_request(c,{
            "request_id":"link-smoke-1", "action":"link_button_smoke"}))
        self.assertEqual(out["status"],"PASS")
        self.assertTrue(out["link_editor_opened"])
        self.assertEqual(c.sent,["/start"])

    def test_help_burst_is_fixed_five_private_clicks_on_one_screen(self):
        class HelpClient(MockClient):
            def __init__(self, duplicate=False):
                super().__init__()
                self.clicks = 0
                self.duplicate = duplicate
            async def get_messages(self, bot, limit):
                if self.clicks:
                    ids = [11, 12] if self.duplicate else [11]
                    return [SimpleNamespace(id=i, out=False,
                        raw_text="📚 操作説明\n知りたい機能を選択してください。") for i in ids]
                messages = await super().get_messages(bot, limit)
                for m in messages:
                    async def click(text):
                        assert text == "操作説明"
                        self.clicks += 1
                        await asyncio.sleep(0)
                    m.click = click
                return messages
        c = HelpClient()
        request = {"request_id":"help-burst-1", "action":"help_button_burst_smoke"}
        result = asyncio.run(process_request(c, request))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(c.clicks, 5)
        self.assertEqual(result["screen_count"], 1)
        self.assertEqual(result["accepted_callbacks"], 5)
        self.assertEqual(c.sent, ["/start"])
        with self.assertRaisesRegex(RuntimeError, "HELP_BURST_SCREEN_DUPLICATED"):
            asyncio.run(process_request(HelpClient(duplicate=True), request))

    def test_link_registration_uses_only_resident_allowlisted_action(self):
        from unittest.mock import AsyncMock
        c=MockClient()
        with patch("userbot_link_flow_smoke.run", new=AsyncMock(return_value={
            "status":"PASS", "registration_receipt":True})) as run:
            out=asyncio.run(process_request(c,{
                "request_id":"link-registration-1", "action":"link_registration_smoke"}))
        self.assertEqual(out["status"],"PASS")
        self.assertTrue(out["registration_receipt"])
        run.assert_awaited_once_with(c)
        self.assertEqual(c.sent,[])

    def test_inline_query_is_bounded_to_owner_code_and_no_post(self):
        class InlineClient(MockClient):
            def __init__(self):
                super().__init__()
                self.codes=[]
            async def inline_query(self, bot, code):
                self.codes.append(code)
                return [SimpleNamespace(title="リンクのプレビュー")]
        c=InlineClient()
        code="Abcdef123456ABCDEFxyz_--"
        self.assertEqual(len(code),24)
        out=asyncio.run(process_request(c,{
            "request_id":"inline-verify-1","action":"link_inline_query_smoke","code":code}))
        self.assertTrue(out["inline_result_found"])
        self.assertEqual(c.codes,[code])
        self.assertEqual(c.sent,[])
        with self.assertRaises(ValueError):
            asyncio.run(process_request(c,{
                "request_id":"inline-verify-2","action":"link_inline_query_smoke","code":"bad"}))

    def test_wrong_menu_not_pass(self):
        c = MockClient(menu=[["wrong"]])
        out = asyncio.run(process_request(c, {"request_id": "menu-2", "action": "bot_start_menu"}))
        self.assertEqual(out["status"], "FAIL")

    def test_no_arbitrary_actions_or_args(self):
        c = MockClient()
        for req in (
            {"request_id": "a", "action": "logout"},
            {"request_id": "a", "action": "stop_service"},
            {"request_id": "a", "action": "python", "script": "print(1)"},
            {"request_id": "../", "action": "health"},
            {"request_id": "a", "action": []},
        ):
            with self.assertRaises((ValueError, TypeError)):
                asyncio.run(process_request(c, req))
        self.assertEqual(c.sent, [])

    def test_expired_session_refused_without_login(self):
        c = MockClient(authorized=False)
        with self.assertRaises(RuntimeError):
            asyncio.run(process_request(c, {"request_id": "x", "action": "health"}))
        self.assertEqual(c.sent, [])


class ExactProfileTopicReadbackTests(unittest.TestCase):
    """Exact DB-bound topic IDs, no Telegram session, group join or credentials."""
    def test_rejects_wrong_shape_before_any_telegram_read(self):
        c = MockClient()
        for ids in (None, [], [4, 5], [4, 5, True], ["4", 5, 6],
                    [4, 5, 0], [4, 5, 2147483648]):
            with self.assertRaises(ValueError):
                asyncio.run(process_request(c, {
                    "request_id": "topic-reject", "action": "profile_topics_by_id",
                    "topic_ids": ids
                }))
        self.assertEqual(c.sent, [])

    def test_uses_exact_ids_and_existing_dialogs_without_revealing_titles(self):
        import sys
        ids = [77, 88, 99]
        class TopicClient:
            def __init__(self, mismatch=False):
                self.mismatch = mismatch
                self.calls = []
            async def is_user_authorized(self):
                return True
            async def get_dialogs(self, limit=500):
                self.calls.append(("dialogs", limit))
                return [
                    SimpleNamespace(id=chat, entity=SimpleNamespace(id=abs(chat)))
                    for chat in (-1003847210571, -1002373696859, -1003770334893)
                ]
            async def __call__(self, request):
                wanted = {1003847210571: 77, 1002373696859: 88,
                          1003770334893: 99}[request.peer.id]
                self.calls.append(("topic", wanted))
                title = "雑談" if self.mismatch and wanted == 88 else "みんなのプロフ"
                return SimpleNamespace(topics=[SimpleNamespace(id=wanted, title=title)])
        messages = SimpleNamespace(GetForumTopicsRequest=lambda **kwargs:
                                   SimpleNamespace(**kwargs))
        with patch.dict(sys.modules, {"telethon": SimpleNamespace(
                functions=SimpleNamespace(messages=messages))}):
            client = TopicClient()
            result = asyncio.run(process_request(client, {
                "request_id": "profile-exact", "action": "profile_topics_by_id",
                "topic_ids": ids
            }))
            self.assertEqual(result["status"], "PASS")
            self.assertEqual([x["found"] for x in result["topics"]], [True]*3)
            self.assertEqual(client.calls, [("dialogs", 500),
                                            ("topic", 77), ("topic", 88), ("topic", 99)])
            self.assertNotIn("みんなのプロフ", repr(result))
            bad = asyncio.run(process_request(TopicClient(mismatch=True), {
                "request_id": "profile-mismatch", "action": "profile_topics_by_id",
                "topic_ids": ids
            }))
            self.assertEqual([x["found"] for x in bad["topics"]], [True, False, True])

    def test_page_two_exact_id_still_found_without_title_query(self):
        import sys
        class PagingClient:
            def __init__(self):
                self.page2 = False
            async def is_user_authorized(self):
                return True
            async def get_dialogs(self, limit=500):
                return [SimpleNamespace(id=k, entity=SimpleNamespace(id=abs(k)))
                        for k in (-1003847210571,-1002373696859,-1003770334893)]
            async def __call__(self, request):
                self.assertable_query = request.q
                wanted={1003847210571:777,1002373696859:888,
                        1003770334893:999}[request.peer.id]
                if wanted == 777 and request.offset_topic == 0:
                    return SimpleNamespace(topics=[
                        SimpleNamespace(id=i,title="雑談",date=1,top_message=i)
                        for i in range(1,101)])
                return SimpleNamespace(topics=[
                    SimpleNamespace(id=wanted,title="みんなのプロフ")])
        messages = SimpleNamespace(GetForumTopicsRequest=lambda **kwargs:
                                   SimpleNamespace(**kwargs))
        with patch.dict(sys.modules, {"telethon": SimpleNamespace(
                functions=SimpleNamespace(messages=messages))}):
            client=PagingClient()
            result=asyncio.run(process_request(client,{
                "request_id":"topic-page2","action":"profile_topics_by_id",
                "topic_ids":[777,888,999]}))
            self.assertEqual([x["found"] for x in result["topics"]],[True,True,True])
            self.assertEqual(client.assertable_query,"")


class UserbotInboxProvisionTests(unittest.TestCase):
    def test_secure_setup_idempotent_and_no_identity_in_response(self):
        client = MockClient()
        async def get_me():
            return SimpleNamespace(id=123456789, bot=False)
        client.get_me = get_me
        with tempfile.TemporaryDirectory() as tmp:
            with patch("userbot_resident_ipc.SECRETS", pathlib.Path(tmp)):
                request = {"request_id": "inbox-1", "action": "bug_report_inbox_provision"}
                first = asyncio.run(process_request(client, request))
                second = asyncio.run(process_request(client, request))
                target = pathlib.Path(tmp) / "bug_report_userbot_account.txt"
                self.assertEqual(target.read_text(encoding="ascii"), "123456789\n")
                self.assertEqual(target.stat().st_mode & 0o077, 0)
                self.assertTrue(first["provisioned"])
                self.assertTrue(second["identity_unchanged"])
                self.assertNotIn("123456789", repr(first))
                self.assertEqual(client.sent, [])

    def test_setup_refuses_conflicting_existing_identity(self):
        client = MockClient()
        async def get_me():
            return SimpleNamespace(id=123456789, bot=False)
        client.get_me = get_me
        with tempfile.TemporaryDirectory() as tmp:
            target = pathlib.Path(tmp) / "bug_report_userbot_account.txt"
            target.write_text("987654321\n", encoding="ascii")
            target.chmod(0o600)
            with patch("userbot_resident_ipc.SECRETS", pathlib.Path(tmp)):
                with self.assertRaisesRegex(RuntimeError, "USERBOT_REPORT_IDENTITY_CONFLICT"):
                    asyncio.run(process_request(client, {
                        "request_id": "inbox-2", "action": "bug_report_inbox_provision"
                    }))
            self.assertEqual(target.read_text(encoding="ascii"), "987654321\n")


class RoomMessage:
    id = 11
    out = False

    def __init__(self, client):
        self.client = client

    @property
    def raw_text(self):
        if self.client.state == "guide":
            return "募集+Room 1行目タイトル 2行目以降説明 3行目ニックネーム"
        if self.client.state == "preview":
            return "募集+Room E2E動作検証（未投稿）"
        return "募集+Room" if self.client.state == "method" else "投稿メニュー"

    @property
    def buttons(self):
        labels = {
            "menu": EXPECTED_MENU,
            "method": [["Room作成"], ["キャンセル"]],
            "guide": [["キャンセル"]],
            "preview": [["キャンセル"], ["投稿する"]],
        }.get(self.client.state, [])
        return [[SimpleNamespace(text=label) for label in row] for row in labels]

    async def click(self, text):
        transitions = {
            ("menu", "募集+Room"): "method",
            ("method", "Room作成"): "guide",
            ("guide", "キャンセル"): "menu",
            ("method", "キャンセル"): "menu",
            ("preview", "キャンセル"): "menu",
        }
        self.client.state = transitions[(self.client.state, text)]


class RoomClient:
    """Private DM fake; no network, no session and no public publish capability."""
    def __init__(self, input_deleted=True):
        self.state = "initial"
        self.input_deleted = input_deleted
        self.sent = []
        self.bot = SimpleNamespace(bot=True)
        self.message = RoomMessage(self)

    async def is_user_authorized(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return self.bot

    async def get_messages(self, bot, limit=None, ids=None):
        assert bot is self.bot
        if ids == 99:
            return None if self.input_deleted else SimpleNamespace(id=99)
        if ids is not None:
            return self.message if ids == 11 else None
        return [SimpleNamespace(id=10)] if self.state == "initial" else [self.message]

    async def send_message(self, bot, message):
        assert bot is self.bot
        self.sent.append(message)
        if message == "/start":
            self.state = "menu"
            return SimpleNamespace(id=12)
        if self.state != "guide":
            raise AssertionError("PRIVATE_ROOM_TEST_SENT_AT_UNEXPECTED_STEP")
        self.state = "preview"
        return SimpleNamespace(id=99)


class ResidentRoomSafetyTests(unittest.TestCase):
    def test_private_room_wizard_returns_to_menu_without_publishing(self):
        client = RoomClient()
        result = asyncio.run(process_request(
            client, {"request_id": "room-private-1", "action": "room_private_smoke"}))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["action"], "room_private_smoke")
        self.assertEqual(result["steps"], [
            "start_menu", "room_method", "room_input_preview",
            "room_input_deleted", "cancel_menu_restored",
        ])
        self.assertEqual(client.state, "menu")
        self.assertEqual(len(client.sent), 2)
        self.assertEqual(client.sent[0], "/start")
        self.assertIn("未投稿", client.sent[1])

    def test_missing_new_input_deletion_fails_and_still_cancels(self):
        client = RoomClient(input_deleted=False)
        with self.assertRaisesRegex(RuntimeError, "ROOM_INPUT_MESSAGE_NOT_DELETED"):
            asyncio.run(process_request(
                client, {"request_id": "room-private-2", "action": "room_private_smoke"}))
        self.assertEqual(client.state, "menu")
        self.assertEqual(len(client.sent), 2)



class PublicRoomReadClient:
    """Simulated existing Telegram message; no network or sending methods."""
    def __init__(self, marker="finished", has_join=False, owner_id=42, visible=True):
        self.marker = marker
        self.has_join = has_join
        self.owner_id = owner_id
        self.visible = visible
        self.requests = []

    async def is_user_authorized(self):
        return True

    async def get_entity(self, name):
        assert name == "GayBBS_bot"
        return SimpleNamespace(bot=True, id=42)

    async def get_messages(self, chat_id, ids=None):
        assert chat_id == -1003847210571
        assert ids == 123
        self.requests.append((chat_id, ids))
        if not self.visible:
            return None
        states = {"finished": "✅ 終了", "live": "🔴 LIVE中",
                  "scheduled": "📅 予告中", "unknown": "状態不明"}
        return SimpleNamespace(
            id=123, sender_id=self.owner_id,
            raw_text="🎬 ROOM\n状態：" + states[self.marker],
            buttons=[[SimpleNamespace(text="参加する")]] if self.has_join else [],
        )


class RoomPublicReadbackTests(unittest.TestCase):
    def test_existing_finished_public_card_reads_without_sending(self):
        client = PublicRoomReadClient()
        result = asyncio.run(process_request(client, {
            "request_id": "public-read-1", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["marker"], "finished")
        self.assertEqual(result["has_join_button"], False)
        self.assertNotIn("chat_id", result)
        self.assertNotIn("message_id", result)
        self.assertEqual(client.requests, [(-1003847210571, 123)])

    def test_live_card_with_join_button_is_detected(self):
        result = asyncio.run(process_request(PublicRoomReadClient("live", True), {
            "request_id": "public-read-2", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual((result["marker"], result["has_join_button"]), ("live", True))

    def test_target_validation_precedes_any_telegram_group_read(self):
        client = PublicRoomReadClient()
        for invalid in (
            {"chat_id": -1001, "message_id": 123},
            {"chat_id": -1003847210571, "message_id": 0},
            {"chat_id": -1003847210571, "message_id": True},
            {"chat_id": -1003847210571, "message_id": "123"},
        ):
            with self.assertRaises(ValueError):
                asyncio.run(process_request(client, {
                    "request_id": "public-negative", "action": "room_public_readback",
                    **invalid,
                }))
        self.assertEqual(client.requests, [])

    def test_message_owner_must_be_real_target_bot(self):
        with self.assertRaisesRegex(RuntimeError, "ROOM_PUBLIC_MESSAGE_OWNER_MISMATCH"):
            asyncio.run(process_request(PublicRoomReadClient(owner_id=99), {
                "request_id": "owner-check", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))

    def test_missing_message_is_explicit_failure(self):
        with self.assertRaisesRegex(RuntimeError, "ROOM_PUBLIC_MESSAGE_NOT_VISIBLE"):
            asyncio.run(process_request(PublicRoomReadClient(visible=False), {
                "request_id": "visible-check", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))



class DialogResolvedClient(PublicRoomReadClient):
    """Only existing joined dialogs can provide missing Telegram input entities."""
    def __init__(self, joined=True):
        super().__init__()
        self.joined = joined
        self.entity = SimpleNamespace(id=3847210571)

    async def get_dialogs(self, limit=None):
        self.requested_dialog_limit = limit
        if not self.joined:
            return []
        return [SimpleNamespace(id=-1003847210571, entity=self.entity)]

    async def get_messages(self, chat, ids=None):
        if type(chat) is int:
            raise ValueError("Telethon private entity details must be redacted")
        assert chat is self.entity
        return await super().get_messages(-1003847210571, ids=ids)


class ResidentDialogResolutionTests(unittest.TestCase):
    def test_cold_cache_reads_only_joined_group(self):
        client = DialogResolvedClient()
        result = asyncio.run(process_request(client, {
            "request_id": "joined-read", "action": "room_public_readback",
            "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(result["marker"], "finished")
        self.assertEqual(client.requested_dialog_limit, 500)

    def test_not_joined_fails_without_joining(self):
        client = DialogResolvedClient(joined=False)
        with self.assertRaisesRegex(RuntimeError, "ROOM_READ_GROUP_NOT_IN_EXISTING_DIALOGS"):
            asyncio.run(process_request(client, {
                "request_id": "not-joined", "action": "room_public_readback",
                "chat_id": -1003847210571, "message_id": 123}))
        self.assertEqual(client.requests, [])


class NativePaidVideoReadbackTests(unittest.TestCase):
    def test_reads_real_message_shapes_without_writing_or_new_session(self):
        paid = type("MessageMediaPaidMedia", (), {"stars_amount": 10, "extended_media": [type("MessageExtendedMediaPreview", (), {})()]})()
        reply = SimpleNamespace(reply_to_top_id=4650, reply_to_msg_id=None)
        class ReadOnlyClient:
            def __init__(self):
                self.calls = []
            async def is_user_authorized(self):
                return True
            async def get_entity(self, username):
                self.calls.append(("identity", username))
                return SimpleNamespace(id=500100, bot=True)
            async def get_messages(self, chat_id, ids):
                self.calls.append(("read", chat_id, tuple(ids)))
                return [
                    SimpleNamespace(id=111, sender_id=500100, grouped_id=900, reply_to=reply, media=object()),
                    SimpleNamespace(id=112, sender_id=500100, grouped_id=900, reply_to=reply, media=object()),
                    SimpleNamespace(id=113, sender_id=500100, grouped_id=None, reply_to=reply, media=paid),
                ]
        c=ReadOnlyClient()
        result=asyncio.run(process_request(c,{
            "request_id":"video-sale-read-1","action":"video_sale_readback",
            "chat_id":-1002373696859,"thread_id":4650,
            "message_ids":[111,112,113]}))
        self.assertTrue(result["free_album_grouped"])
        self.assertTrue(result["paid_media_native"])
        self.assertTrue(result["preview_for_reader"])
        self.assertEqual(result["paid_stars"],10)
        self.assertTrue(result["target_topic_confirmed"])
        self.assertEqual(c.calls,[("identity","CreateVdobot"),
                                  ("read",-1002373696859,(111,112,113))])

    def test_stars_purchase_form_is_read_only_and_requires_matching_native_paid_media(self):
        from telethon import functions, types
        reply=SimpleNamespace(reply_to_top_id=4650,reply_to_msg_id=None)
        media=type("MessageMediaPaidMedia",(),{"stars_amount":10,
             "extended_media":[type("MessageExtendedMediaPreview",(),{})()]})()
        class Buyer:
            def __init__(self):
                self.calls=[]
            async def is_user_authorized(self):
                return True
            async def get_entity(self,username):
                return SimpleNamespace(bot=True,id=700)
            async def get_messages(self,chat,ids):
                return [
                    SimpleNamespace(id=ids[0],sender_id=700,grouped_id=900,reply_to=reply,media=object()),
                    SimpleNamespace(id=ids[1],sender_id=700,grouped_id=900,reply_to=reply,media=object()),
                    SimpleNamespace(id=ids[2],sender_id=700,grouped_id=None,reply_to=reply,media=media)]
            async def get_input_entity(self,chat):
                assert chat==-1002373696859
                return SimpleNamespace()
            async def __call__(self,request):
                assert isinstance(request,functions.payments.GetPaymentFormRequest)
                assert isinstance(request.invoice,types.InputInvoiceMessage)
                assert request.invoice.msg_id==113
                self.calls.append("getPaymentForm")
                return type("PaymentFormStars",(),{"invoice":SimpleNamespace(currency="XTR",
                    prices=[SimpleNamespace(amount=10)])})()
        buyer=Buyer()
        result=asyncio.run(process_request(buyer,{"request_id":"quote-1",
            "action":"video_sale_payment_form","chat_id":-1002373696859,
            "thread_id":4650,"message_ids":[111,112,113]}))
        self.assertTrue(result["stars_purchase_form"])
        self.assertTrue(result["currency_xtr"])
        self.assertTrue(result["quote_matches_media"])
        self.assertEqual(buyer.calls,["getPaymentForm"])
        for wrong in ({"chat_id":-100999},{"message_ids":[111,112,112]},
                      {"message_ids":[111,112,True]}):
            with self.assertRaises(ValueError):
                asyncio.run(process_request(buyer,{"request_id":"quote-wrong",
                    "action":"video_sale_payment_form","chat_id":-1002373696859,
                    "thread_id":4650,"message_ids":[111,112,113],**wrong}))
        self.assertEqual(buyer.calls,["getPaymentForm"])

    def test_rejects_arbitrary_chat_or_unbounded_messages_before_read(self):
        class GuardClient:
            def __init__(self):
                self.calls=0
            async def is_user_authorized(self):
                return True
            async def get_entity(self,*args):
                self.calls+=1
                return None
        c=GuardClient()
        for overrides in (
            {"chat_id":-100999},
            {"message_ids":[111,111,112]},
            {"message_ids":[111,112]},
            {"message_ids":[111,112,True]},
            {"thread_id":0},
        ):
            payload={"request_id":"video-sale-reject","action":"video_sale_readback",
                     "chat_id":-1002373696859,"thread_id":4650,
                     "message_ids":[111,112,113]}
            payload.update(overrides)
            with self.assertRaises(ValueError):
                asyncio.run(process_request(c,payload))
        self.assertEqual(c.calls,0)


if __name__ == "__main__":
    unittest.main()
