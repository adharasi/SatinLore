import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import secrets
import sqlite3

import httpx
import pytest

from app.api.auth import COOKIE
from app.core.config import Settings
from app.db.store import Store
from app.main import create_app
from app.services.lovense import LovenseTokens, TOKEN_URL

ORIGIN = "http://testserver"


def harness(tmp_path, *, mode="simulator", vendor=None, https=False):
    now = [1_800_000_000]
    settings = Settings(environment="test", app_origin="https://testserver" if https else ORIGIN,
                        database_path=tmp_path / "beta.sqlite3", session_ttl_seconds=60,
                        device_mode=mode, lovense_developer_token="test-developer-secret" if mode == "lovense" else "",
                        lovense_platform_name="SatinLore test" if mode == "lovense" else "")
    store = Store(settings.database_path, clock=lambda: now[0])
    app = create_app(settings, store=store, lovense_tokens=vendor)
    return app, store, now


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=app.state.settings.app_origin)


async def login(client, store):
    response = await client.post("/api/invites/redeem", json={"token": store.create_invite()}, headers={"origin": str(client.base_url).rstrip("/")})
    assert response.status_code == 200, response.text
    return response


def headers(response):
    return {"origin": ORIGIN, "x-csrf-token": response.json()["csrf_token"]}


def test_invitation_is_single_use_and_sessions_expire(tmp_path):
    app, store, now = harness(tmp_path)
    token = store.create_invite(60)
    async def scenario():
        async with client_for(app) as client:
            first = await client.post("/api/invites/redeem", json={"token": token}, headers={"origin": ORIGIN})
            assert first.status_code == 200
            assert set(first.json()) == {"user_id", "csrf_token", "expires_at"}
            cookie = first.headers["set-cookie"]
            assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/api" in cookie
            assert "Secure" not in cookie
            replay = await client.post("/api/invites/redeem", json={"token": token}, headers={"origin": ORIGIN})
            assert replay.status_code == 400
            assert (await client.get("/api/me")).json() == first.json()
            now[0] += 60
            assert (await client.get("/api/me")).status_code == 401
    asyncio.run(scenario())
    expired = store.create_invite(60)
    now[0] += 60
    assert store.redeem(expired, 60) is None


def test_simultaneous_redemption_has_one_winner(tmp_path):
    _, store, _ = harness(tmp_path)
    token = store.create_invite()
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: store.redeem(token, 60), range(8)))
    assert sum(result is not None for result in results) == 1


def test_origin_csrf_and_logout_revoke_replayed_cookie(tmp_path):
    app, store, _ = harness(tmp_path)
    async def scenario():
        async with client_for(app) as client:
            for origin in [None, "null", "http://evil.example", "http://testserver/"]:
                response = await client.post("/api/invites/redeem", json={"token": store.create_invite()},
                                             headers={} if origin is None else {"origin": origin})
                assert response.status_code == 403
            logged_in = await login(client, store)
            raw_cookie = client.cookies.get(COOKIE)
            for bad in [{"origin": ORIGIN}, {"origin": ORIGIN, "x-csrf-token": "invalid"},
                        {**headers(logged_in), "origin": "null"}]:
                assert (await client.post("/api/logout", headers=bad)).status_code == 403
            assert (await client.post("/api/logout", headers=headers(logged_in))).status_code == 204
            client.cookies.set(COOKIE, raw_cookie)
            assert (await client.get("/api/me")).status_code == 401
    asyncio.run(scenario())


def test_tokens_are_hashed_and_secure_cookie_follows_https(tmp_path):
    app, store, _ = harness(tmp_path, https=True)
    invite = store.create_invite()
    async def scenario():
        async with client_for(app) as client:
            response = await client.post("/api/invites/redeem", json={"token": invite}, headers={"origin": "https://testserver"})
            assert response.status_code == 200
            assert "Secure" in response.headers["set-cookie"]
            return client.cookies.get(COOKIE), response.json()["csrf_token"]
    raw_cookie, csrf = asyncio.run(scenario())
    with sqlite3.connect(store.path) as db:
        dump = "\n".join(db.iterdump())
    assert invite not in dump and raw_cookie not in dump and csrf not in dump


def test_redeem_limits_persist_and_body_is_bounded(tmp_path):
    app, store, now = harness(tmp_path)
    async def scenario():
        async with client_for(app) as client:
            huge = await client.post("/api/invites/redeem", content=b"x" * 4097, headers={"origin": ORIGIN})
            assert huge.status_code == 413
            async def chunks():
                yield b"x" * 3000
                yield b"x" * 3000
            streamed = await client.post("/api/invites/redeem", content=chunks(), headers={"origin": ORIGIN})
            assert streamed.status_code == 413
            for _ in range(8):
                assert (await client.post("/api/invites/redeem", json={"token": secrets.token_urlsafe(32)}, headers={"origin": ORIGIN})).status_code == 400
        restarted = create_app(app.state.settings, store=Store(store.path, clock=lambda: now[0]))
        async with client_for(restarted) as client:
            blocked = await client.post("/api/invites/redeem", json={"token": store.create_invite()}, headers={"origin": ORIGIN})
            assert blocked.status_code == 429 and blocked.headers["retry-after"] == "300"
            now[0] += 300
            assert (await login(client, store)).status_code == 200
    asyncio.run(scenario())


def test_payload_restrictions_and_simulator_preserved(tmp_path):
    app, store, _ = harness(tmp_path)
    async def scenario():
        async with client_for(app) as client:
            invalid = await client.post("/api/invites/redeem", json={"token": store.create_invite(), "uid": "victim"}, headers={"origin": ORIGIN})
            assert invalid.status_code == 400
            assert (await client.post("/api/invites/redeem", content="not-json", headers={"origin": ORIGIN})).status_code == 415
            logged_in = await login(client, store)
            assert (await client.post("/api/lovense/session", json={"uid": "victim"}, headers=headers(logged_in))).status_code == 400
            assert (await client.post("/api/lovense/session", json={}, headers=headers(logged_in))).status_code == 503
    asyncio.run(scenario())


def test_vendor_identity_is_server_derived_and_users_are_isolated(tmp_path):
    requests = []
    def vendor(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert str(request.url) == TOKEN_URL
        assert payload["token"] == "test-developer-secret"
        return httpx.Response(200, json={"code": 0, "data": {"authToken": "vendor-" + payload["uid"]}})
    service = LovenseTokens("test-developer-secret", transport=httpx.MockTransport(vendor))
    app, store, _ = harness(tmp_path, mode="lovense", vendor=service)
    async def scenario():
        async with client_for(app) as first, client_for(app) as second:
            a, b = await login(first, store), await login(second, store)
            assert a.json()["user_id"] != b.json()["user_id"]
            assert (await first.post("/api/lovense/session", headers=headers(b))).status_code == 403
            assert (await first.post("/api/lovense/session", json={"uid": b.json()["user_id"]}, headers=headers(a))).status_code == 400
            for client, session in [(first, a), (second, b)]:
                response = await client.post("/api/lovense/session", json={}, headers=headers(session))
                assert response.status_code == 200
                assert response.json()["uid"] == session.json()["user_id"]
                assert response.json()["authToken"] == "vendor-" + session.json()["user_id"]
                assert "test-developer-secret" not in response.text
            assert [x["uid"] for x in requests] == [a.json()["user_id"], b.json()["user_id"]]
            for _ in range(2):
                assert (await first.post("/api/lovense/session", headers=headers(a))).status_code == 200
            assert (await first.post("/api/lovense/session", headers=headers(a))).status_code == 429
    asyncio.run(scenario())


@pytest.mark.parametrize("response", [
    httpx.Response(302, headers={"location": "https://evil.example"}),
    httpx.Response(200, content=b"x" * 16385),
    httpx.Response(200, json={"code": 0, "data": {"authToken": "test-developer-secret"}}),
    httpx.Response(200, json={"code": False, "data": {"authToken": "bad"}}),
    httpx.Response(200, json={"code": 400, "message": "test-developer-secret"}),
    httpx.Response(200, content="invalid json"),
])
def test_vendor_errors_are_bounded_and_redacted(tmp_path, response):
    service = LovenseTokens("test-developer-secret", transport=httpx.MockTransport(lambda request: response))
    app, store, _ = harness(tmp_path, mode="lovense", vendor=service)
    async def scenario():
        async with client_for(app) as client:
            logged_in = await login(client, store)
            result = await client.post("/api/lovense/session", headers=headers(logged_in))
            assert result.status_code == 502
            assert "test-developer-secret" not in result.text and "invalid json" not in result.text
    asyncio.run(scenario())


def test_session_expiry_during_vendor_request_does_not_release_token(tmp_path):
    app, store, now = harness(tmp_path, mode="lovense")
    class DelayedVendor:
        async def issue(self, uid):
            now[0] += 60
            return "must-not-reach-client"
    app.state.lovense_tokens = DelayedVendor()
    async def scenario():
        async with client_for(app) as client:
            logged_in = await login(client, store)
            result = await client.post("/api/lovense/session", headers=headers(logged_in))
            assert result.status_code == 401 and "must-not-reach-client" not in result.text
    asyncio.run(scenario())


def test_logout_during_vendor_request_does_not_release_token(tmp_path):
    app, store, _ = harness(tmp_path, mode="lovense")
    async def scenario():
        async with client_for(app) as client:
            logged_in = await login(client, store)
            cookie = client.cookies.get(COOKIE)
            class RevokedVendor:
                async def issue(self, uid):
                    store.revoke(cookie)
                    return "must-not-reach-client"
            app.state.lovense_tokens = RevokedVendor()
            result = await client.post("/api/lovense/session", headers=headers(logged_in))
            assert result.status_code == 401 and "must-not-reach-client" not in result.text
    asyncio.run(scenario())


def test_vendor_timeout_is_generic(tmp_path):
    def fail(request):
        raise httpx.ReadTimeout("private vendor diagnostic test-developer-secret")
    service = LovenseTokens("test-developer-secret", transport=httpx.MockTransport(fail))
    app, store, _ = harness(tmp_path, mode="lovense", vendor=service)
    async def scenario():
        async with client_for(app) as client:
            logged_in = await login(client, store)
            result = await client.post("/api/lovense/session", headers=headers(logged_in))
            assert result.status_code == 502 and "private vendor" not in result.text
    asyncio.run(scenario())
