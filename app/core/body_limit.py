"""Bound API write bodies before JSON parsing, including streamed requests."""
from starlette.responses import JSONResponse


class BodyLimitMiddleware:
    def __init__(self, app, maximum=4096):
        self.app = app
        self.maximum = maximum

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/") or scope["method"] not in {
            "POST", "PUT", "PATCH", "DELETE"
        }:
            return await self.app(scope, receive, send)
        chunks = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            incoming = message.get("body", b"")
            if len(chunks) + len(incoming) > self.maximum:
                return await JSONResponse({"detail": "Request body is too large."}, status_code=413)(scope, receive, send)
            chunks.extend(incoming)
            if not message.get("more_body", False):
                break
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(chunks), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)
