/**
 * Shrinks a receipt photo in the browser before it is uploaded.
 *
 * The OCR.space free tier rejects images over 1 MB, and a phone photo is
 * often 2-5 MB. Re-encoding it here as a JPEG, scaled down if needed, keeps
 * the text readable while getting under that limit, with no new dependency
 * and no change to the backend. Photos already under the limit are sent
 * exactly as chosen.
 */

/** OCR.space's free-tier limit is 1024 KB; aim a little under it. */
export const OCR_TARGET_BYTES = 1000 * 1024;

/**
 * Tried in order until one result fits: the longest side in pixels, and
 * the JPEG quality. Receipt text stays legible down to about 1000 px.
 */
export const COMPRESSION_STEPS: ReadonlyArray<{ maxDimension: number; quality: number }> = [
  { maxDimension: 2400, quality: 0.85 },
  { maxDimension: 2000, quality: 0.8 },
  { maxDimension: 1600, quality: 0.75 },
  { maxDimension: 1280, quality: 0.7 },
  { maxDimension: 1024, quality: 0.65 },
];

/** A decoded image that can be re-encoded at different sizes. */
export interface ImageEncoder {
  encode(maxDimension: number, quality: number): Promise<Blob | null>;
  close(): void;
}

export type OpenImage = (file: File) => Promise<ImageEncoder | null>;

/** Decodes with createImageBitmap and re-encodes through a canvas. */
export const openWithCanvas: OpenImage = async (file) => {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  // Honours the EXIF orientation, so a sideways phone photo stays upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    async encode(maxDimension, quality) {
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      // JPEG has no transparency: paint a transparent PNG onto white, not black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    },
    close() {
      bitmap.close();
    },
  };
};

function asJpegName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, "") || "receipt";
  return `${base}.jpg`;
}

/**
 * Returns a file of at most `targetBytes` where possible. Small files, and
 * any file the browser cannot decode, come back unchanged -- the backend
 * still validates whatever is sent, and OCR reports a clear error if the
 * image is still too large.
 */
export async function compressForOcr(
  file: File,
  open: OpenImage = openWithCanvas,
  targetBytes: number = OCR_TARGET_BYTES,
): Promise<File> {
  if (file.size <= targetBytes) return file;

  let encoder: ImageEncoder | null = null;
  try {
    encoder = await open(file);
  } catch {
    return file;
  }
  if (!encoder) return file;

  let smallest: Blob | null = null;
  try {
    for (const { maxDimension, quality } of COMPRESSION_STEPS) {
      const blob = await encoder.encode(maxDimension, quality);
      if (!blob) continue;
      if (smallest === null || blob.size < smallest.size) smallest = blob;
      if (blob.size <= targetBytes) break;
    }
  } catch {
    // Fall through with whatever was produced so far.
  } finally {
    encoder.close();
  }

  if (smallest === null || smallest.size >= file.size) return file;
  return new File([smallest], asJpegName(file.name), { type: "image/jpeg" });
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
