import { useRef, useState } from "react";
import { apiFetch, errorMessage } from "../api/client";
import { compressForOcr } from "../utils/compressImage";

export function MemoryPhoto({ id, photo }: { id: number; photo?: string | null }) {
  const [image, setImage] = useState(photo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setError("");
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setError("Choose a JPEG or PNG photo.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Choose a photo smaller than 20 MB.");
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressForOcr(file);
      const response = await apiFetch<{ photo_data: string }>(`/api/sessions/${id}/photo`, {
        method: "PUT",
        headers: { "Content-Type": compressed.type },
        body: compressed,
      });
      setImage(response.photo_data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="memory-photo">
      {image && <img src={image} alt="Memory from this meal" loading="lazy" />}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        aria-label={`Photo for receipt ${id}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : image ? "Change photo" : "+ Add photo"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
