import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DisputeDialog } from "../DisputeDialog";
import { createDispute, type PaymentHistoryItem } from "@/lib/tenantApi";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

vi.mock("@/lib/tenantApi", () => ({ createDispute: vi.fn() }));
vi.mock("@/lib/toast", () => ({ showErrorToast: vi.fn(), showSuccessToast: vi.fn() }));

beforeAll(() => {
  // Radix Select relies on pointer capture and scrollIntoView, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const payment = {
  id: "pay-1",
  dealId: "deal-1",
  reference: "REF-1",
  amount: 100_000,
  status: "paid",
  transactionDate: "2026-01-01",
  method: "card",
} as PaymentHistoryItem;

function setup() {
  // Radix sets pointer-events: none on <body> while the Select is open.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const onOpenChange = vi.fn();
  const onFiled = vi.fn();
  render(<DisputeDialog payment={payment} open onOpenChange={onOpenChange} onFiled={onFiled} />);
  return { user, onOpenChange, onFiled };
}

async function chooseReason(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("combobox", { name: "Reason" }));
  await user.click(await screen.findByRole("option", { name: label }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "Reason" })).toHaveTextContent(label);
}

async function describeProblem(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("textbox", { name: "Description" }));
  await user.paste(text);
}

beforeEach(() => {
  vi.mocked(createDispute).mockReset();
  vi.mocked(showErrorToast).mockReset();
  vi.mocked(showSuccessToast).mockReset();
});

describe("DisputeDialog", () => {
  it("renders an accessible dialog with labelled fields", () => {
    setup();

    expect(screen.getByRole("dialog", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reason" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
    expect(screen.getByLabelText(/evidence/i, { selector: "input" })).toBeInTheDocument();
    expect(screen.getByText("1000 characters left")).toBeInTheDocument();
  });

  it("requires a reason before submitting", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "File Dispute" }));
    expect(showErrorToast).toHaveBeenCalledWith("Please select a reason for your dispute.");
    expect(createDispute).not.toHaveBeenCalled();
  });

  it("rejects a description that is too short and clears the error on edit", async () => {
    const { user } = setup();
    await chooseReason(user, "Duplicate charge");

    const description = screen.getByRole("textbox", { name: "Description" });
    await user.type(description, "   short ");
    await user.click(screen.getByRole("button", { name: "File Dispute" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Description must be at least 10 characters.");
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description).toHaveAccessibleDescription("Description must be at least 10 characters.");
    expect(createDispute).not.toHaveBeenCalled();

    await user.type(description, "x");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(description).not.toHaveAttribute("aria-invalid");
  });

  it("rejects a description over 1000 characters and shows a negative counter", async () => {
    const { user } = setup();
    await chooseReason(user, "Other");

    const description = screen.getByRole("textbox", { name: "Description" });
    await user.click(description);
    await user.paste("a".repeat(1001));
    expect(screen.getByText("-1 characters left")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "File Dispute" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Description must be at most 1000 characters.");
    expect(createDispute).not.toHaveBeenCalled();
  });

  it("rejects unsupported evidence types and more than five files", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<DisputeDialog payment={payment} open onOpenChange={vi.fn()} onFiled={vi.fn()} />);
    const input = screen.getByLabelText(/evidence/i, { selector: "input" });

    await user.upload(input, new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported file type: text/plain");
    expect(input).toHaveAccessibleDescription("Unsupported file type: text/plain");

    const six = Array.from({ length: 6 }, (_, i) => new File(["x"], `p${i}.png`, { type: "image/png" }));
    await user.upload(input, six);
    expect(screen.getByRole("alert")).toHaveTextContent("You can upload at most 5 files.");
  });

  it("submits a valid dispute, then closes and notifies the caller", async () => {
    vi.mocked(createDispute).mockResolvedValue({} as never);
    const { user, onOpenChange, onFiled } = setup();

    await chooseReason(user, "Amount discrepancy");
    await describeProblem(user, "  I was charged the wrong amount  ");
    await user.upload(screen.getByLabelText(/evidence/i, { selector: "input" }), [
      new File(["x"], "receipt.pdf", { type: "application/pdf" }),
      new File(["x"], "screenshot.png", { type: "image/png" }),
    ]);
    expect(screen.getByText("receipt.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "File Dispute" }));

    await waitFor(() => expect(onFiled).toHaveBeenCalledTimes(1));
    expect(createDispute).toHaveBeenCalledWith({
      paymentId: "pay-1",
      dealId: "deal-1",
      reason: "amount_discrepancy",
      description: "I was charged the wrong amount",
      evidenceKeys: ["receipt.pdf", "screenshot.png"],
    });
    expect(showSuccessToast).toHaveBeenCalledWith(
      "Dispute filed. A rent release may be paused pending review.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables both actions while submitting", async () => {
    let resolve!: () => void;
    vi.mocked(createDispute).mockReturnValue(new Promise((r) => (resolve = () => r({} as never))));
    const { user } = setup();

    await chooseReason(user, "Property issue");
    await describeProblem(user, "The roof is leaking badly");
    await user.click(screen.getByRole("button", { name: "File Dispute" }));

    expect(screen.getByRole("button", { name: "File Dispute" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "File Dispute" })).toBeEnabled());
  });

  it("shows the API error and keeps the dialog open when submission fails", async () => {
    vi.mocked(createDispute).mockRejectedValue(new Error("A dispute is already pending for this payment"));
    const { user, onOpenChange, onFiled } = setup();

    await chooseReason(user, "Duplicate charge");
    await describeProblem(user, "Charged twice this month");
    await user.click(screen.getByRole("button", { name: "File Dispute" }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith("A dispute is already pending for this payment"),
    );
    expect(onFiled).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "File Dispute" })).toBeEnabled();
    // The form keeps what the tenant typed so they can retry.
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Charged twice this month");
  });

  it("falls back to a generic message when the error has none", async () => {
    vi.mocked(createDispute).mockRejectedValue({});
    const { user } = setup();

    await chooseReason(user, "Duplicate charge");
    await describeProblem(user, "Charged twice this month");
    await user.click(screen.getByRole("button", { name: "File Dispute" }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith("Failed to file dispute."));
  });

  it("closes on Cancel", async () => {
    const { user, onOpenChange } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
