import asyncio

from httpx import ASGITransport, AsyncClient
import pytest

from app.core.config import Settings, load_settings
from app.main import create_app


@pytest.fixture
def app(tmp_path):
    return create_app(Settings(environment="test", app_origin="http://testserver", database_path=tmp_path / "test.sqlite3"))


def request(app, method, path, **kwargs):
    async def run():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(run())


def test_starter_cannot_claim_real_device_readiness(app):
    assert request(app, "GET", "/api/health").json() == {
        "status": "ok", "device_mode": "simulator", "beta_ready": False
    }
    assert request(app, "POST", "/api/lovense/session", headers={"origin": "http://testserver"}).status_code == 401


def test_only_public_static_files_are_exposed(app):
    for path in ["/", "/static/app.mjs", "/static/devices/mock.mjs", "/static/reader/import.mjs"]:
        assert request(app, "GET", path).status_code == 200
    for path in ["/.env", "/app/main.py", "/static/%2e%2e/%2e%2e/.env", "/data/satinlore.sqlite3"]:
        assert request(app, "GET", path).status_code == 404


def test_host_and_script_boundaries(app):
    assert request(app, "GET", "/", headers={"host": "attacker.example"}).status_code == 400
    response = request(app, "GET", "/")
    policy = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in policy and "lovense" not in policy
    assert "unsafe-inline" not in policy
    assert response.headers["Cache-Control"] == "no-store"
    module = request(app, "GET", "/static/devices/mock.mjs", headers={"origin": "null"})
    assert module.headers["access-control-allow-origin"] == "*"
    api = request(app, "GET", "/api/me", headers={"origin": "null"})
    assert "access-control-allow-origin" not in api.headers


def test_no_story_upload_endpoint(app):
    assert request(app, "POST", "/api/stories", json={"text": "private sample"}).status_code == 404


def test_unsupported_modes_fail_at_startup(monkeypatch, tmp_path):
    monkeypatch.setenv("SATINLORE_DEVICE_MODE", "real")
    with pytest.raises(ValueError, match="Unknown device mode"):
        load_settings()
    monkeypatch.setenv("SATINLORE_DEVICE_MODE", "simulator")
    monkeypatch.setenv("SATINLORE_ENV", "production")
    with pytest.raises(ValueError, match="local development"):
        load_settings()
    with pytest.raises(ValueError, match="requires"):
        Settings(device_mode="lovense")
    with pytest.raises(ValueError, match="outside"):
        Settings(database_path="app/static/private.sqlite3")
    for origin in ["http://localhost:bad", "http://localhost:65536", "http://localhost:0"]:
        with pytest.raises(ValueError, match="invalid port"):
            Settings(app_origin=origin)
    with pytest.raises(ValueError, match="exact local"):
        Settings(app_origin="https://evil.example")


def test_vendor_secret_never_appears_in_public_responses(app, monkeypatch):
    marker = "test-only-secret-do-not-publish-to-client"
    monkeypatch.setenv("LOVENSE_DEVELOPER_TOKEN", marker)
    for method, path in [("GET", "/api/health"), ("GET", "/"), ("POST", "/api/lovense/session")]:
        assert marker not in request(app, method, path).text
