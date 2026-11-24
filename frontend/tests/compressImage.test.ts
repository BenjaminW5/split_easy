import { describe, expect, it, vi } from "vitest";
import {
  COMPRESSION_STEPS,
  type ImageEncoder,
  OCR_TARGET_BYTES,
  compressForOcr,
  formatMegabytes,
} from "../src/utils/compressImage";

const MB = 1024 * 1024;

function fileOfSize(bytes: number, name = "IMG_2041.png", type = "image/png") {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

function blobOfSize(bytes: number) {
  return new Blob([new Uint8Array(Math.round(bytes))], { type: "image/jpeg" });
}

/** An encoder whose output size is decided by the test, one per step. */
function fakeEncoder(sizes: Array<number | null>) {
  const encoder: ImageEncoder & { calls: Array<[number, number]>; closed: boolean } = {
    calls: [],
    closed: false,
    async encode(maxDimension, quality) {
      encoder.calls.push([maxDimension, quality]);
      const size = sizes[encoder.calls.length - 1];
      return size === null || size === undefined ? null : blobOfSize(size);
    },
    close() {
      encoder.closed = true;
    },
  };
  return encoder;
}

describe("compressForOcr", () => {
  it("sends a photo already under the limit unchanged, without decoding it", async () => {
    const file = fileOfSize(OCR_TARGET_BYTES);
    const open = vi.fn();

    expect(await compressForOcr(file, open)).toBe(file);
    expect(open).not.toHaveBeenCalled();
  });

  it("returns a JPEG under the limit from the first step that fits", async () => {
    const encoder = fakeEncoder([900 * 1024]);

    const result = await compressForOcr(fileOfSize(3 * MB), async () => encoder);

    expect(result.size).toBe(900 * 1024);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("IMG_2041.jpg");
    expect(encoder.calls).toEqual([[2400, 0.85]]);
    expect(encoder.closed).toBe(true);
  });

  it("keeps shrinking until the photo fits", async () => {
    const encoder = fakeEncoder([2 * MB, 1.5 * MB, 800 * 1024]);

    const result = await compressForOcr(fileOfSize(4 * MB), async () => encoder);

    expect(result.size).toBe(800 * 1024);
    expect(encoder.calls).toEqual([
      [2400, 0.85],
      [2000, 0.8],
      [1600, 0.75],
    ]);
  });

  it("sends the smallest attempt when nothing gets under the limit", async () => {
    const encoder = fakeEncoder([3 * MB, 2 * MB, 1.6 * MB, 1.2 * MB, 1.1 * MB]);

    const result = await compressForOcr(fileOfSize(4.5 * MB), async () => encoder);

    expect(encoder.calls).toHaveLength(COMPRESSION_STEPS.length);
    expect(result.size).toBe(Math.round(1.1 * MB));
  });

  it("never sends something bigger than the original", async () => {
    const original = fileOfSize(1.2 * MB);
    const encoder = fakeEncoder([1.5 * MB, 1.4 * MB, 1.3 * MB, 1.25 * MB, 1.21 * MB]);

    expect(await compressForOcr(original, async () => encoder)).toBe(original);
  });

  it("falls back to the original when the browser cannot decode the image", async () => {
    const original = fileOfSize(2 * MB);

    expect(await compressForOcr(original, async () => null)).toBe(original);
    expect(
      await compressForOcr(original, async () => {
        throw new Error("decode failed");
      }),
    ).toBe(original);
  });

  it("falls back to the original when encoding fails and still releases the image", async () => {
    const original = fileOfSize(2 * MB);
    const encoder = fakeEncoder([]);
    encoder.encode = async () => {
      throw new Error("canvas is tainted");
    };

    expect(await compressForOcr(original, async () => encoder)).toBe(original);
    expect(encoder.closed).toBe(true);
  });

  it("names the result after the original photo", async () => {
    const encoder = () => Promise.resolve(fakeEncoder([500 * 1024]));

    expect((await compressForOcr(fileOfSize(2 * MB, "dinner.receipt.jpeg"), encoder)).name).toBe(
      "dinner.receipt.jpg",
    );
    expect((await compressForOcr(fileOfSize(2 * MB, "receipt"), encoder)).name).toBe("receipt.jpg");
  });
});

describe("formatMegabytes", () => {
  it("rounds to one decimal place", () => {
    expect(formatMegabytes(3.24 * MB)).toBe("3.2 MB");
    expect(formatMegabytes(0.8 * MB)).toBe("0.8 MB");
  });
});
