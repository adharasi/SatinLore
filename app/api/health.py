"""Non-sensitive readiness information for the development scaffold."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "device_mode": "simulator", "beta_ready": False}
