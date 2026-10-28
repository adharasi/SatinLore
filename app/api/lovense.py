"""Per-session vendor credentials; client-supplied identities are never accepted."""
from fastapi import APIRouter, HTTPException, Request

from app.api.auth import json_object, require_write
from app.services.lovense import VendorUnavailable

router = APIRouter()


@router.post("/lovense/session")
async def lovense_session(request: Request):
    session = require_write(request)
    body = await request.body()
    if body and await json_object(request) != {}:
        raise HTTPException(400, "This endpoint does not accept user identity or other parameters.")
    settings = request.app.state.settings
    if settings.device_mode != "lovense":
        raise HTTPException(503, "Lovense mode is not configured. The simulator remains available.")
    if not request.app.state.store.allow("vendor:" + session["user_id"], limit=3, window_seconds=60):
        raise HTTPException(429, "Too many connection requests. Try again later.", headers={"Retry-After": "60"})
    try:
        token = await request.app.state.lovense_tokens.issue(session["user_id"])
    except VendorUnavailable:
        raise HTTPException(502, "Lovense could not establish a session. Try again later.") from None
    # Revocation/expiry can happen while the external request is in flight.
    renewed = require_write(request)
    return {"uid": renewed["user_id"], "platform": settings.lovense_platform_name,
            "authToken": token, "expires_at": renewed["expires_at"]}
