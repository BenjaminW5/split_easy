import base64

from fastapi import HTTPException, Request


async def read_photo(request: Request) -> str:
    content_type = request.headers.get("content-type", "").split(";")[0]
    signatures = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
    if content_type not in signatures:
        raise HTTPException(415, "Choose a JPEG or PNG photo")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 1024 * 1024:
            raise HTTPException(413, "Photo must be smaller than 1 MB after compression")
    if not data.startswith(signatures[content_type]):
        raise HTTPException(422, "Invalid photo")
    return f"data:{content_type};base64,{base64.b64encode(data).decode()}"
