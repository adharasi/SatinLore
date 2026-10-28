import asyncio

from httpx import ASGITransport, AsyncClient
import pytest

from app.core.config import Settings, load_settings
from app.main import create_app


def request(method, path, **kwargs):
    async def run():
        async with AsyncClient(
            transport=ASGITransport(app=create_app(Settings(environment="test"))),
            base_url="http://testserver",
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(run())


def test_starter_cannot_claim_real_device_readiness():
    assert request("GET", "/api/health").json() == {
        "status": "ok", "device_mode": "simulator", "beta_ready": False
    }
    assert request("POST", "/api/lovense/session").status_code == 501


def test_only_public_static_files_are_exposed():
    for path in ["/", "/static/app.mjs", "/static/devices/mock.mjs", "/static/reader/import.mjs"]:
        assert request("GET", path).status_code == 200
    for path in ["/.env", "/app/main.py", "/static/%2e%2e/%2e%2e/.env"]:
        assert request("GET", path).status_code == 404


def test_host_and_script_boundaries():
    assert request("GET", "/", headers={"host": "attacker.example"}).status_code == 400
    response = request("GET", "/")
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    assert "unsafe-inline" not in response.headers["Content-Security-Policy"]
    assert response.headers["Cache-Control"] == "no-store"


def test_no_story_upload_endpoint():
    assert request("POST", "/api/stories", json={"text": "private sample"}).status_code == 404


def test_unsupported_modes_fail_at_startup(monkeypatch):
    monkeypatch.setenv("SATINLORE_DEVICE_MODE", "real")
    with pytest.raises(ValueError, match="not implemented"):
        load_settings()
    monkeypatch.setenv("SATINLORE_DEVICE_MODE", "simulator")
    monkeypatch.setenv("SATINLORE_ENV", "production")
    with pytest.raises(ValueError, match="local development"):
        load_settings()


def test_vendor_secret_never_appears_in_public_responses(monkeypatch):
    marker = "test-only-secret-do-not-publish-to-client"
    monkeypatch.setenv("LOVENSE_DEVELOPER_TOKEN", marker)
    for method, path in [("GET", "/api/health"), ("GET", "/"), ("POST", "/api/lovense/session")]:
        assert marker not in request(method, path).text
