import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import * as receiptsApi from "../src/api/receipts";
import { ReceiptsPage } from "../src/pages/ReceiptsPage";

// Keep the module's real constants (accepted types, size limit) and mock
// only the functions that would make HTTP requests. A plain automock would
// empty the ACCEPTED_RECEIPT_TYPES array.
vi.mock("../src/api/receipts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/receipts")>();
  return {
    ...actual,
    listReceipts: vi.fn(),
    getReceipt: vi.fn(),
    uploadReceipt: vi.fn(),
    runOcr: vi.fn(),
    getReceiptImage: vi.fn(),
    deleteReceipt: vi.fn(),
  };
});

const uploaded: receiptsApi.ReceiptDetail = {
  id: 5,
  user_id: 1,
  filename: "dinner.png",
  content_type: "image/png",
  size_bytes: 1234,
  status: "uploaded",
  ocr_provider: null,
  ocr_error: null,
  ocr_total_cents: null,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
  ocr_text: null,
  items: [],
  items_total_cents: 0,
};

const processed: receiptsApi.ReceiptDetail = {
  ...uploaded,
  status: "processed",
  ocr_provider: "ocrspace",
  ocr_text: "Margherita Pizza 24.00\nCoke x3 13.50\nTOTAL 37.50",
  ocr_total_cents: 3750,
  items: [
    {
      id: 1,
      receipt_id: 5,
      position: 1,
      name: "Margherita Pizza",
      quantity: 1,
      total_cents: 2400,
      unit_price_cents: 2400,
    },
    {
      id: 2,
      receipt_id: 5,
      position: 2,
      name: "Coke",
      quantity: 3,
      total_cents: 1350,
      unit_price_cents: 450,
    },
  ],
  items_total_cents: 3750,
};

function pngFile(name = "dinner.png") {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

describe("ReceiptsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([]);
    vi.mocked(receiptsApi.getReceiptImage).mockResolvedValue(new Blob(["png"]));
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => "blob:receipt");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows an empty state when there are no receipts", async () => {
    render(<ReceiptsPage />);

    expect(await screen.findByText(/No receipts yet/)).toBeInTheDocument();
  });

  it("lists receipts loaded from the API", async () => {
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([processed]);

    render(<ReceiptsPage />);

    const list = await screen.findByRole("list", { name: "Uploaded receipts" });
    expect(within(list).getByRole("button", { name: "dinner.png" })).toBeInTheDocument();
    expect(within(list).getByText("Dishes read")).toBeInTheDocument();
  });

  it("uploads a photo, reads the dishes and shows them", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const user = userEvent.setup();
    const file = pngFile();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), file);
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    const table = await screen.findByRole("table", { name: "Dishes" });
    const [pizza, coke] = within(table).getAllByRole("row").slice(1, 3);
    expect(
      within(pizza)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Margherita Pizza", "1", "$24.00", "$24.00"]);
    expect(
      within(coke)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Coke", "3", "$4.50", "$13.50"]);
    expect(within(table).getByText("$37.50")).toBeInTheDocument();
    expect(receiptsApi.uploadReceipt).toHaveBeenCalledWith(file);
    expect(receiptsApi.runOcr).toHaveBeenCalledWith(5);
    expect(screen.getByRole("img", { name: "Receipt dinner.png" })).toHaveAttribute(
      "src",
      "blob:receipt",
    );
  });

  it("rejects a file that is not a JPEG or PNG without uploading it", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const pdf = new File(["%PDF"], "bill.pdf", { type: "application/pdf" });

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pdf);
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("JPEG or PNG");
    expect(receiptsApi.uploadReceipt).not.toHaveBeenCalled();
  });

  it("shows the server's message when an upload is refused", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockRejectedValue(
      new ApiError(415, JSON.stringify({ detail: "The file is not a valid image/png image" })),
    );
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file is not a valid image/png image",
    );
    expect(receiptsApi.runOcr).not.toHaveBeenCalled();
  });

  it("shows why OCR could not read any dishes", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue({
      ...uploaded,
      status: "failed",
      ocr_provider: "ocrspace",
      ocr_error: "Could not reach the OCR service",
    });
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    const status = await screen.findByRole("alert", { name: "Receipt processing status" });
    expect(status).toHaveTextContent("Could not read dishes.");
    expect(status).toHaveTextContent("Could not reach the OCR service");
    expect(within(status).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("warns when the dishes do not add up to the receipt total", async () => {
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([processed]);
    vi.mocked(receiptsApi.getReceipt).mockResolvedValue({ ...processed, ocr_total_cents: 4000 });
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.click(await screen.findByRole("button", { name: "dinner.png" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The dishes add up to $37.50, but the receipt total is $40.00",
    );
  });

  it("labels results from the mock OCR provider as sample data", async () => {
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([processed]);
    vi.mocked(receiptsApi.getReceipt).mockResolvedValue({ ...processed, ocr_provider: "mock" });
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.click(await screen.findByRole("button", { name: "dinner.png" }));

    expect(await screen.findByText(/these are sample dishes/)).toBeInTheDocument();
  });

  it("re-runs OCR on an existing receipt", async () => {
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([uploaded]);
    vi.mocked(receiptsApi.getReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.click(await screen.findByRole("button", { name: "dinner.png" }));
    await user.click(await screen.findByRole("button", { name: "Read dishes" }));

    expect(await screen.findByRole("table", { name: "Dishes" })).toBeInTheDocument();
    expect(receiptsApi.runOcr).toHaveBeenCalledWith(5);
  });

  it("deletes the selected receipt", async () => {
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([processed]);
    vi.mocked(receiptsApi.getReceipt).mockResolvedValue(processed);
    vi.mocked(receiptsApi.deleteReceipt).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.click(await screen.findByRole("button", { name: "dinner.png" }));
    await user.click(await screen.findByRole("button", { name: "Delete receipt" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "dinner.png" })).not.toBeInTheDocument();
    });
    expect(receiptsApi.deleteReceipt).toHaveBeenCalledWith(5);
    expect(screen.getByText(/No receipts yet/)).toBeInTheDocument();
  });

  it("shows a processing indicator while the receipt is being read", async () => {
    let finishOcr: (detail: receiptsApi.ReceiptDetail) => void = () => {};
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockReturnValue(
      new Promise((resolve) => {
        finishOcr = resolve;
      }),
    );
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    const status = await screen.findByRole("status", { name: "Receipt processing status" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Reading dishes from the receipt…");
    expect(within(status).getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete receipt" })).toBeDisabled();

    finishOcr(processed);

    expect(await screen.findByText(/2 dishes found/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("opens the extracted dishes for review after a successful read", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    const heading = await screen.findByRole("heading", { name: "Review dishes" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("region", { name: "Review dishes" })).toContainElement(
      screen.getByRole("table", { name: "Dishes" }),
    );
  });

  it("passes the processed receipt straight to a custom items editor", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const renderItems = vi.fn((receipt: receiptsApi.ReceiptDetail) => (
      <p>Editing {receipt.items.length} dishes</p>
    ));
    const user = userEvent.setup();

    render(<ReceiptsPage renderItems={renderItems} />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(await screen.findByText("Editing 2 dishes")).toBeInTheDocument();
    expect(renderItems).toHaveBeenLastCalledWith(processed);
    expect(screen.queryByRole("table", { name: "Dishes" })).not.toBeInTheDocument();
  });

  it("lets the user try again when the OCR request itself fails", async () => {
    vi.mocked(receiptsApi.uploadReceipt).mockResolvedValue(uploaded);
    vi.mocked(receiptsApi.runOcr)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(processed);
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), pngFile());
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    const status = await screen.findByRole("alert", { name: "Receipt processing status" });
    expect(status).toHaveTextContent("Failed to fetch");

    await user.click(within(status).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Dishes" })).toBeInTheDocument();
    expect(receiptsApi.runOcr).toHaveBeenCalledTimes(2);
    expect(receiptsApi.uploadReceipt).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("alert", { name: "Receipt processing status" }),
    ).not.toBeInTheDocument();
  });

  it("retries a receipt whose earlier read failed", async () => {
    const failed: receiptsApi.ReceiptDetail = {
      ...uploaded,
      status: "failed",
      ocr_provider: "ocrspace",
      ocr_error: "No dishes could be read from this receipt.",
    };
    vi.mocked(receiptsApi.listReceipts).mockResolvedValue([failed]);
    vi.mocked(receiptsApi.getReceipt).mockResolvedValue(failed);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const user = userEvent.setup();

    render(<ReceiptsPage />);
    await user.click(await screen.findByRole("button", { name: "dinner.png" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Dishes" })).toBeInTheDocument();
    expect(receiptsApi.runOcr).toHaveBeenCalledWith(5);
    const list = screen.getByRole("list", { name: "Uploaded receipts" });
    expect(within(list).getByText("Dishes read")).toBeInTheDocument();
  });

  it("keeps the chosen photo after a failed upload so it can be sent again", async () => {
    vi.mocked(receiptsApi.uploadReceipt)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(uploaded);
    vi.mocked(receiptsApi.runOcr).mockResolvedValue(processed);
    const user = userEvent.setup();
    const file = pngFile();

    render(<ReceiptsPage />);
    await user.upload(screen.getByLabelText("Receipt photo"), file);
    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(screen.getByText("dinner.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Upload and read dishes" }));

    expect(await screen.findByRole("table", { name: "Dishes" })).toBeInTheDocument();
    expect(receiptsApi.uploadReceipt).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No picture chosen")).toBeInTheDocument();
  });
});
