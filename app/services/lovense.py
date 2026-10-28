"""Server-only vendor exchange. Never relay vendor errors or request payloads."""
import json

import httpx

TOKEN_URL = "https://api.lovense-api.com/api/basicApi/getToken"
MAX_RESPONSE_BYTES = 16384


class VendorUnavailable(Exception):
    pass


class LovenseTokens:
    def __init__(self, developer_token: str, transport=None):
        self._developer_token = developer_token
        self._transport = transport

    async def issue(self, user_id: str):
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=httpx.Timeout(8.0), follow_redirects=False,
                trust_env=False,
            ) as client:
                async with client.stream("POST", TOKEN_URL, json={
                    "token": self._developer_token, "uid": user_id,
                }) as response:
                    if response.status_code != 200:
                        raise VendorUnavailable()
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > MAX_RESPONSE_BYTES:
                            raise VendorUnavailable()
            result = json.loads(chunks)
            if not isinstance(result, dict) or type(result.get("code")) is not int or result.get("code") != 0:
                raise VendorUnavailable()
            data = result.get("data")
            token = data.get("authToken") if isinstance(data, dict) else None
            if not isinstance(token, str) or not token.strip() or not 1 <= len(token) <= 8192 or token == self._developer_token:
                raise VendorUnavailable()
            return token
        except (httpx.HTTPError, ValueError, TypeError):
            raise VendorUnavailable() from None
