"""Invitation sessions with exact-origin and CSRF checks on every authenticated write."""
import hmac
import re

from fastapi import APIRouter, HTTPException, Request, Response

from app.db.store import csrf_for

router = APIRouter()
COOKIE = "satinlore_session"
TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")


def require_origin(request: Request):
    if request.headers.get("origin") != request.app.state.settings.app_origin:
        raise HTTPException(403, "Request origin is not allowed.")
    if request.headers.get("sec-fetch-site") not in {None, "same-origin", "none"}:
        raise HTTPException(403, "Cross-site request is not allowed.")


async def json_object(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
        raise HTTPException(415, "Use application/json.")
    try:
        value = await request.json()
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON.") from None
    if not isinstance(value, dict):
        raise HTTPException(400, "Expected a JSON object.")
    return value


def current_session(request: Request):
    token = request.cookies.get(COOKIE, "")
    if not TOKEN.fullmatch(token):
        raise HTTPException(401, "A valid invitation session is required.")
    session = request.app.state.store.session(token)
    if session is None:
        raise HTTPException(401, "The session has expired or been signed out.")
    return {**session, "csrf_token": csrf_for(token)}


def require_write(request: Request):
    require_origin(request)
    session = current_session(request)
    supplied = request.headers.get("x-csrf-token", "")
    if not re.fullmatch(r"[a-f0-9]{64}", supplied) or not hmac.compare_digest(supplied, session["csrf_token"]):
        raise HTTPException(403, "Invalid CSRF token.")
    return session


@router.post("/invites/redeem")
async def redeem(request: Request, response: Response):
    require_origin(request)
    store = request.app.state.store
    # Do not trust forwarded headers. This server is loopback-only until deployment work.
    address = request.client.host if request.client else "unknown"
    if not store.allow("invite:" + address, limit=8, window_seconds=300):
        raise HTTPException(429, "Too many invitation attempts. Try again later.", headers={"Retry-After": "300"})
    value = await json_object(request)
    if set(value) != {"token"} or not isinstance(value["token"], str) or not TOKEN.fullmatch(value["token"]):
        raise HTTPException(400, "Provide one valid invitation token.")
    session = store.redeem(value["token"], request.app.state.settings.session_ttl_seconds)
    if session is None:
        raise HTTPException(400, "Invitation is invalid, expired or already used.")
    previous = request.cookies.get(COOKIE)
    if previous:
        store.revoke(previous)
    response.set_cookie(
        COOKIE, session["token"], max_age=request.app.state.settings.session_ttl_seconds,
        httponly=True, secure=request.app.state.settings.secure_cookie, samesite="strict", path="/api",
    )
    return {"user_id": session["user_id"], "expires_at": session["expires_at"],
            "csrf_token": csrf_for(session["token"])}


@router.get("/me")
def me(request: Request):
    return current_session(request)


@router.post("/logout", status_code=204)
def logout(request: Request):
    require_write(request)
    request.app.state.store.revoke(request.cookies[COOKIE])
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path="/api", secure=request.app.state.settings.secure_cookie,
                           httponly=True, samesite="strict")
    return response
