from pydantic import BaseModel, ConfigDict, StrictStr


class DinerWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: StrictStr


class DinerRead(BaseModel):
    id: int
    name: str
