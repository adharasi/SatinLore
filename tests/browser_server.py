"""Ephemeral browser-test server. Never deploy this fixture or use real credentials."""
import os
from pathlib import Path

import httpx

from app.core.config import Settings
from app.main import create_app
from app.services.lovense import LovenseTokens


def vendor(request):
    # The transport replaces all outbound HTTP; no vendor service is contacted.
    assert request.url == "https://api.lovense-api.com/api/basicApi/getToken"
    return httpx.Response(200, json={"code": 0, "data": {"authToken": "browser-test-auth-token"}})


settings = Settings(
    environment="test", device_mode="lovense",
    app_origin=os.environ["SATINLORE_BROWSER_TEST_ORIGIN"],
    database_path=Path(os.environ["SATINLORE_BROWSER_TEST_DB"]),
    lovense_developer_token="browser-test-developer-token", lovense_platform_name="SatinLore test",
)
app = create_app(settings, lovense_tokens=LovenseTokens(
    settings.lovense_developer_token, transport=httpx.MockTransport(vendor),
))
