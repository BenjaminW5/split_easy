import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RECEIPT_BYTES } from "../src/api/receipts";
import { ReceiptUpload, validateReceiptFile } from "../src/components/ReceiptUpload";

function fileOfSize(bytes: number, name = "dinner.jpg", type = "image/jpeg") {
  const file = new File(["x"], name, { type });
  // Building a real 5 MB buffer would slow the test down for nothing.
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

describe("validateReceiptFile", () => {
  it.each([
    ["image/jpeg", "dinner.jpg"],
    ["image/png", "dinner.png"],
  ])("accepts %s", (type, name) => {
    expect(validateReceiptFile(fileOfSize(1024, name, type))).toBeNull();
  });

  it.each([
    ["application/pdf", "bill.pdf"],
    ["image/gif", "bill.gif"],
    ["image/heic", "bill.heic"],
    ["", "bill"],
  ])("rejects %s", (type, name) => {
    expect(validateReceiptFile(fileOfSize(1024, name, type))).toMatch("JPEG or PNG");
  });

  it("accepts a file exactly at the 5 MB limit", () => {
    expect(validateReceiptFile(fileOfSize(MAX_RECEIPT_BYTES))).toBeNull();
  });

  it("rejects a file over the 5 MB limit", () => {
    expect(validateReceiptFile(fileOfSize(MAX_RECEIPT_BYTES + 1))).toMatch("larger than 5 MB");
  });

  it("rejects an empty file", () => {
    expect(validateReceiptFile(fileOfSize(0))).toMatch("empty");
  });
});

describe("ReceiptUpload", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains which files are accepted", () => {
    render(<ReceiptUpload busy={false} uploading={false} onUpload={vi.fn()} />);

    expect(screen.getByLabelText("Receipt photo")).toHaveAccessibleDescription(
      "JPEG or PNG, up to 5 MB.",
    );
    expect(screen.getByRole("button", { name: "Upload and read dishes" })).toBeDisabled();
  });

  it("submits a valid image and clears the picker afterwards", async () => {
    const onUpload = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    const file = fileOfSize(2048, "dinner.png", "image/png");

    render(<ReceiptUpload busy={false} uploading={false} onUpload={onUpload} />);
    await user.upload(screen.getByLabelText("Receipt photo"), file);
    expect(screen.getByText("dinner.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(onUpload).toHaveBeenCalledWith(file);
    expect(await screen.findByText("No picture chosen")).toBeInTheDocument();
  });

  it("shows a clear error for an oversized image and does not submit it", async () => {
    const onUpload = vi.fn();
    const user = userEvent.setup();

    render(<ReceiptUpload busy={false} uploading={false} onUpload={onUpload} />);
    await user.upload(screen.getByLabelText("Receipt photo"), fileOfSize(MAX_RECEIPT_BYTES + 1));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "That image is larger than 5 MB. Please choose a smaller photo.",
    );
    expect(screen.getByRole("button", { name: "Upload and read dishes" })).toBeDisabled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("clears the error once a valid image is chosen instead", async () => {
    const user = userEvent.setup({ applyAccept: false });

    render(<ReceiptUpload busy={false} uploading={false} onUpload={vi.fn()} />);
    await user.upload(
      screen.getByLabelText("Receipt photo"),
      fileOfSize(100, "bill.pdf", "application/pdf"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG or PNG");

    await user.upload(screen.getByLabelText("Receipt photo"), fileOfSize(100));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload and read dishes" })).toBeEnabled();
  });

  it("shows progress and blocks a second upload while one is running", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReceiptUpload busy={false} uploading={false} onUpload={vi.fn()} />,
    );
    await user.upload(screen.getByLabelText("Receipt photo"), fileOfSize(100));

    rerender(<ReceiptUpload busy uploading onUpload={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Uploading dinner.jpg…");
  });

  it("shrinks a large photo before sending it and says so", async () => {
    const original = fileOfSize(3.2 * 1024 * 1024, "IMG_2041.jpg");
    const shrunk = fileOfSize(0.8 * 1024 * 1024, "IMG_2041.jpg");
    let finish: (file: File) => void = () => {};
    const compress = vi.fn(
      () =>
        new Promise<File>((resolve) => {
          finish = resolve;
        }),
    );
    const onUpload = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <ReceiptUpload busy={false} uploading={false} onUpload={onUpload} compress={compress} />,
    );
    await user.upload(screen.getByLabelText("Receipt photo"), original);
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(screen.getByRole("status")).toHaveTextContent("Shrinking the photo so OCR can read it…");
    expect(screen.getByRole("button", { name: "Preparing…" })).toBeDisabled();
    expect(compress).toHaveBeenCalledWith(original);

    finish(shrunk);

    expect(
      await screen.findByText("Photo shrunk from 3.2 MB to 0.8 MB so OCR can read it."),
    ).toBeInTheDocument();
    expect(onUpload).toHaveBeenCalledWith(shrunk);
  });

  it("sends a small photo as it is, with no note", async () => {
    const small = fileOfSize(200 * 1024, "dinner.png", "image/png");
    const onUpload = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(<ReceiptUpload busy={false} uploading={false} onUpload={onUpload} />);
    await user.upload(screen.getByLabelText("Receipt photo"), small);
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(onUpload).toHaveBeenCalledWith(small);
    expect(screen.queryByText(/Photo shrunk/)).not.toBeInTheDocument();
  });
});
