import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptProcessingStatus } from "../src/components/ReceiptProcessingStatus";

const base = {
  status: "uploaded" as const,
  reading: false,
  itemCount: 0,
  error: null,
  busy: false,
  onRead: () => {},
};

describe("ReceiptProcessingStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a busy indicator while OCR runs, with no buttons", () => {
    render(<ReceiptProcessingStatus {...base} reading busy />);

    const status = screen.getByRole("status", { name: "Receipt processing status" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("progressbar", { name: "Reading the receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers to read a receipt that has only been uploaded", async () => {
    const onRead = vi.fn();
    const user = userEvent.setup();

    render(<ReceiptProcessingStatus {...base} onRead={onRead} />);
    await user.click(screen.getByRole("button", { name: "Read dishes" }));

    expect(screen.getByRole("status")).toHaveTextContent("Uploaded, not read yet.");
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, "1 dish found"],
    [6, "6 dishes found"],
  ])("reports success with %i dish(es)", (itemCount, text) => {
    render(<ReceiptProcessingStatus {...base} status="processed" itemCount={itemCount} />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "Read dishes again" })).toBeEnabled();
  });

  it("explains a failure and allows another attempt", async () => {
    const onRead = vi.fn();
    const user = userEvent.setup();

    render(
      <ReceiptProcessingStatus
        {...base}
        status="failed"
        error="OCR is not configured: OCR_SPACE_API_KEY is not set"
        onRead={onRead}
      />,
    );

    const alert = screen.getByRole("alert", { name: "Receipt processing status" });
    expect(alert).toHaveTextContent("Could not read dishes.");
    expect(alert).toHaveTextContent("OCR_SPACE_API_KEY is not set");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message when a failure has no reason", () => {
    render(<ReceiptProcessingStatus {...base} status="failed" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong while reading the receipt.",
    );
  });

  it("disables the retry button while another request is running", () => {
    render(<ReceiptProcessingStatus {...base} status="failed" error="Timed out" busy />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });
});
