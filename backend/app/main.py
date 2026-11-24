import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.claims.router import receipt_router as receipt_claims_router
from app.claims.router import router as claims_router
from app.db import close_pool, open_pool
from app.diners.router import router as diners_router
from app.groups.router import router as groups_router
from app.notes.router import router as notes_router
from app.receipts import ocr
from app.receipts.parse_router import router as parse_router
from app.receipts.router import router as receipts_router
from app.settlement.router import router as settlement_router
from app.users import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    ocr_warning = ocr.configuration_warning()
    if ocr_warning:
        # uvicorn's own logger, so the line shows up in `docker compose up`.
        logging.getLogger("uvicorn.error").warning(ocr_warning)
    open_pool()
    yield
    close_pool()


app = FastAPI(title="COMP9820 template API", lifespan=lifespan)

# The frontend runs in the student's browser on a different origin
# (http://localhost:5173) to the API (http://localhost:8000), so the
# browser needs an explicit CORS allow-list. CORS_ORIGINS is a
# comma-separated list read from the environment (see .env.example).
origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(groups_router)
app.include_router(notes_router)
app.include_router(receipts_router)
app.include_router(users_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(claims_router)
app.include_router(receipt_claims_router)
app.include_router(diners_router)


app.include_router(settlement_router)

app.include_router(parse_router)
