from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NoteCreate(BaseModel):
    title: str
    body: str = ""


class NoteUpdate(BaseModel):
    title: str
    body: str = ""


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    body: str
    created_at: datetime
    updated_at: datetime
