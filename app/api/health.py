"""Non-sensitive readiness information; hardware qualification is external evidence."""
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
def health(request: Request):
    return {"status": "ok", "device_mode": request.app.state.settings.device_mode, "beta_ready": False}
