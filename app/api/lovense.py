"""Explicit integration boundary; there are no vendor requests in this scaffold."""
from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/lovense/session")
def lovense_session():
    raise HTTPException(501, "Real device integration is not implemented. Use the simulator.")
