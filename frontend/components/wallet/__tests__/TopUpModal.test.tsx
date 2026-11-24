import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TopUpModal } from "../TopUpModal";
import { initiateTopUp, type TopUpResponse } from "@/lib/walletApi";
import { handleError, showSuccessToast } from "@/lib/toast";

vi.mock("@/lib/walletApi", () => ({ initiateTopUp: vi.fn() }));
vi.mock("@/lib/toast", () => ({ handleError: vi.fn(), showSuccessToast: vi.fn() }));

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const bankResult: TopUpResponse = {
  id: "t1",
  amountNgn: 250_000,
  rail: "bank_transfer",
  status: "pending",
  reference: "TOPUP-REF-9",
  bankTransfer: { bankName: "Wema Bank", accountNumber: "9988776655", accountName: "Shelterflex Collections" } as never,
  createdAt: "2026-11-24T10:00:00Z",
  expiresAt: "2026-11-25T10:00:00Z",
};

function setup() {
  // Radix sets pointer-events: none on <body> while the Select is open.
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(<TopUpModal open onOpenChange={onOpenChange} onSuccess={onSuccess} />);
  return { user, onOpenChange, onSuccess };
}

async function fill(user: ReturnType<typeof userEvent.setup>, amount: string, rail?: string) {
  const input = screen.getByRole("spinbutton", { name: "Amount (NGN)" });
  await user.clear(input);
  await user.type(input, amount);
  if (rail) {
    await user.click(screen.getByRole("combobox", { name: "Payment Method" }));
    await user.click(await screen.findByRole("option", { name: rail }));
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }
}

beforeEach(() => {
  vi.mocked(initiateTopUp).mockReset();
  vi.mocked(handleError).mockReset();
  vi.mocked(showSuccessToast).mockReset();
});

describe("TopUpModal — input step", () => {
  it("renders the labelled form with Continue disabled until both fields are set", async () => {
    const { user } = setup();

    expect(screen.getByRole("dialog", { name: "Top Up Wallet" })).toBeInTheDocument();
    expect(screen.getByText("Min: ₦100 · Max: ₦1,000,000")).toBeInTheDocument();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();

    await fill(user, "500");
    expect(cont).toBeDisabled();
    await fill(user, "500", "Paystack (Card/Transfer)");
    expect(cont).toBeEnabled();
  });

  it.each([
    ["0", "Please enter a valid amount"],
    ["-50", "Please enter a valid amount"],
    ["99", "Minimum top-up is ₦100"],
    ["1000001", "Maximum top-up is ₦1,000,000"],
  ])("rejects %s with %p", async (amount, message) => {
    const { user } = setup();

    await fill(user, amount, "Flutterwave");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(initiateTopUp).not.toHaveBeenCalled();
  });

  it("clears the validation error when the amount changes", async () => {
    const { user } = setup();

    await fill(user, "50", "Flutterwave");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton", { name: "Amount (NGN)" }), "0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the form while the request is in flight", async () => {
    vi.mocked(initiateTopUp).mockReturnValue(new Promise(() => {}));
    const { user } = setup();

    await fill(user, "1000", "Bank Transfer");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("button", { name: "Processing..." })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Payment Method" })).toBeDisabled();
    expect(initiateTopUp).toHaveBeenCalledTimes(1);
  });
});

describe("TopUpModal — confirmation step", () => {
  it("shows bank transfer instructions with copy buttons", async () => {
    vi.mocked(initiateTopUp).mockResolvedValue(bankResult);
    const { user, onSuccess } = setup();

    await fill(user, "250000", "Bank Transfer");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("dialog", { name: "Confirm Your Deposit" })).toBeInTheDocument();
    expect(initiateTopUp).toHaveBeenCalledWith({ amountNgn: 250000, rail: "bank_transfer" });
    expect(showSuccessToast).toHaveBeenCalledWith("Top-up initiated successfully");
    expect(onSuccess).toHaveBeenCalledTimes(1);

    expect(screen.getByText("₦250,000")).toBeInTheDocument();
    expect(screen.getByText("Wema Bank")).toBeInTheDocument();
    expect(screen.getByText("Shelterflex Collections")).toBeInTheDocument();
    expect(screen.getByText("Pending Confirmation")).toBeInTheDocument();
    expect(screen.getByText(/^Expires:/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy account number" }));
    expect(await navigator.clipboard.readText()).toBe("9988776655");
    await user.click(screen.getByRole("button", { name: "Copy narration reference" }));
    expect(await navigator.clipboard.readText()).toBe("TOPUP-REF-9");
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await navigator.clipboard.readText()).toBe("TOPUP-REF-9");
  });

  it("redirects to the payment provider for card rails", async () => {
    vi.mocked(initiateTopUp).mockResolvedValue({
      ...bankResult,
      rail: "paystack",
      bankTransfer: null,
      redirectUrl: "https://checkout.paystack.test/abc",
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = setup();

    await fill(user, "5000", "Paystack (Card/Transfer)");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue to Payment" }));

    expect(open).toHaveBeenCalledWith("https://checkout.paystack.test/abc", "_blank", "noopener,noreferrer");
    expect(screen.queryByText("Bank Transfer Instructions")).not.toBeInTheDocument();
  });

  it("starts a new top-up from the confirmation", async () => {
    vi.mocked(initiateTopUp).mockResolvedValue(bankResult);
    const { user } = setup();

    await fill(user, "250000", "Bank Transfer");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "New Top-Up" }));

    expect(screen.getByRole("dialog", { name: "Top Up Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toHaveValue(null);
  });
});

describe("TopUpModal — error step", () => {
  it("shows the API error and lets the user try again", async () => {
    vi.mocked(initiateTopUp).mockRejectedValue(new Error("Provider unavailable"));
    const { user, onSuccess } = setup();

    await fill(user, "1000", "Flutterwave");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("dialog", { name: "Top-Up Failed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
    expect(handleError).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(screen.getByRole("dialog", { name: "Top Up Wallet" })).toBeInTheDocument();
    // The amount survives a retry.
    expect(screen.getByRole("spinbutton", { name: "Amount (NGN)" })).toHaveValue(1000);
  });

  it("closes and resets from the error step", async () => {
    vi.mocked(initiateTopUp).mockRejectedValue("boom");
    const { user, onOpenChange } = setup();

    await fill(user, "1000", "Flutterwave");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to initiate top-up");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
