import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";
import { FullPaymentModal } from "../FullPaymentModal";
import {
  confirmFullPayment,
  getFullPaymentPreview,
  type FullPaymentPreview,
  type FullPaymentReceipt,
} from "@/lib/paymentApi";

vi.mock("@/lib/paymentApi", () => ({
  getFullPaymentPreview: vi.fn(),
  confirmFullPayment: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ handleError: vi.fn() }));

const breakdown = {
  totalAmount: 1_500_000,
  platformShare: 75_000,
  reporterShare: 15_000,
  landlordAmount: 1_410_000,
  currency: "NGN",
};

const preview: FullPaymentPreview = { paymentId: "pay-1", breakdown, expiresAt: "2026-12-01T00:00:00Z" };
const receipt: FullPaymentReceipt = {
  paymentId: "pay-1",
  reference: "FP-REF-42",
  breakdown,
  paidAt: "2026-11-24T10:00:00Z",
  status: "confirmed",
};

function setup(props: Partial<React.ComponentProps<typeof FullPaymentModal>> = {}) {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  render(
    <NextIntlClientProvider locale="en-NG" messages={messages}>
      <FullPaymentModal paymentId="pay-1" open onOpenChange={onOpenChange} onSuccess={onSuccess} {...props} />
    </NextIntlClientProvider>,
  );
  return { user, onOpenChange, onSuccess };
}

beforeEach(() => {
  vi.mocked(getFullPaymentPreview).mockReset();
  vi.mocked(confirmFullPayment).mockReset();
});

describe("FullPaymentModal", () => {
  it("shows a loading status while the preview is fetched", async () => {
    vi.mocked(getFullPaymentPreview).mockReturnValue(new Promise(() => {}));
    setup();

    expect(await screen.findByRole("status")).toHaveTextContent("Loading payment details…");
    expect(getFullPaymentPreview).toHaveBeenCalledWith("pay-1");
  });

  it("renders the preview breakdown and cancels without confirming", async () => {
    vi.mocked(getFullPaymentPreview).mockResolvedValue(preview);
    const { user, onOpenChange } = setup();

    expect(await screen.findByRole("dialog", { name: "Full payment" })).toBeInTheDocument();
    expect(screen.getByText("₦1,500,000.00")).toBeInTheDocument();
    expect(screen.getByText("₦1,410,000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(confirmFullPayment).not.toHaveBeenCalled();
  });

  it("disables both actions while confirming, then shows the receipt", async () => {
    vi.mocked(getFullPaymentPreview).mockResolvedValue(preview);
    let resolve!: (r: FullPaymentReceipt) => void;
    vi.mocked(confirmFullPayment).mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, onSuccess } = setup();

    await user.click(await screen.findByRole("button", { name: "Confirm payment" }));
    expect(confirmFullPayment).toHaveBeenCalledWith("pay-1");
    expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    resolve(receipt);
    expect(await screen.findByRole("dialog", { name: "Payment receipt" })).toBeInTheDocument();
    expect(screen.getByText("FP-REF-42")).toBeInTheDocument();
    expect(screen.getByText("Payment confirmed")).toBeInTheDocument();
    expect(screen.getByText(/^Paid on/)).toHaveTextContent("2026");
    expect(onSuccess).toHaveBeenCalledWith(receipt);
  });

  it("shows the preview error and retries", async () => {
    vi.mocked(getFullPaymentPreview)
      .mockRejectedValueOnce(new Error("Preview expired"))
      .mockResolvedValue(preview);
    const { user } = setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Preview expired");
    expect(screen.getByRole("dialog", { name: "Something went wrong" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("dialog", { name: "Full payment" })).toBeInTheDocument();
  });

  it("shows a confirmation error without calling onSuccess", async () => {
    vi.mocked(getFullPaymentPreview).mockResolvedValue(preview);
    vi.mocked(confirmFullPayment).mockRejectedValue(new Error("Insufficient funds"));
    const { user, onSuccess } = setup();

    await user.click(await screen.findByRole("button", { name: "Confirm payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient funds");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("falls back to the translated message for non-Error rejections", async () => {
    vi.mocked(getFullPaymentPreview).mockRejectedValue("boom");
    setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("closes from the error state", async () => {
    vi.mocked(getFullPaymentPreview).mockRejectedValue(new Error("nope"));
    const { user, onOpenChange } = setup();

    await screen.findByRole("alert");
    // Two "Close" buttons exist: the dialog's X (sr-only label) and the footer one.
    const closes = screen.getAllByRole("button", { name: "Close" });
    await user.click(closes[0]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
