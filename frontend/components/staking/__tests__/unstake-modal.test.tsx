import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UnstakeModal } from "../unstake-modal";

function setup(props: Partial<React.ComponentProps<typeof UnstakeModal>> = {}) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <UnstakeModal isOpen onClose={onClose} onConfirm={onConfirm} maxAmount="100.000000" warmingAmount="0" {...props} />,
  );
  return { user, onClose, onConfirm, input: screen.getByRole("textbox", { name: "Amount to Unstake" }) };
}

describe("UnstakeModal", () => {
  it("renders nothing when closed", () => {
    render(<UnstakeModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} maxAmount="1" warmingAmount="0" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the cooling period, max amount and an initially disabled confirm", () => {
    setup({ coolingPeriodDays: 14 });

    expect(screen.getByRole("dialog", { name: "Unstake Tokens" })).toBeInTheDocument();
    expect(screen.getByText("Cooling Period: 14 Days")).toBeInTheDocument();
    expect(screen.getByText("Max: 100.000000 USDC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Unstake" })).toBeDisabled();
  });

  it.each(["0", "-5", "0.000000"])("keeps confirm disabled for %s", async (value) => {
    const { user, input, onConfirm } = setup();

    await user.type(input, value);
    expect(screen.getByRole("button", { name: "Confirm Unstake" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("rejects an amount above the maximum", async () => {
    const { user, input, onConfirm } = setup();

    await user.type(input, "100.5");
    await user.click(screen.getByRole("button", { name: "Confirm Unstake" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Maximum unstakeable amount is 100.000000 USDC");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fills the maximum amount from the MAX button", async () => {
    const { user, input } = setup();

    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(input).toHaveValue("100.000000");
  });

  it("only unstakes after the user confirms, then clears and closes", async () => {
    const { user, input, onConfirm, onClose } = setup();

    await user.type(input, "40");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm Unstake" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith("40");
    expect(input).toHaveValue("");
  });

  it("disables the form while the unstake is pending", async () => {
    let resolve!: () => void;
    const { user, input, onConfirm } = setup();
    onConfirm.mockReturnValue(new Promise<void>((r) => (resolve = r)));

    await user.type(input, "10");
    await user.click(screen.getByRole("button", { name: "Confirm Unstake" }));

    expect(screen.getByRole("button", { name: "Confirming..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(input).toBeDisabled();
    resolve();
    await waitFor(() => expect(input).toBeEnabled());
  });

  it("shows the error and stays open when unstaking fails", async () => {
    const { user, input, onConfirm, onClose } = setup();
    onConfirm.mockRejectedValue(new Error("Stake is still locked"));

    await user.type(input, "10");
    await user.click(screen.getByRole("button", { name: "Confirm Unstake" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Stake is still locked");
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveValue("10");
  });

  it("falls back to a generic error message", async () => {
    const { user, input, onConfirm } = setup();
    onConfirm.mockRejectedValue({});

    await user.type(input, "10");
    await user.click(screen.getByRole("button", { name: "Confirm Unstake" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to unstake tokens");
  });

  it("warns when part of the stake is still warming up", () => {
    setup({ warmingAmount: "12.500000" });

    expect(screen.getByText(/You have 12.500000 USDC currently warming up/)).toBeInTheDocument();
  });

  it("closes from Cancel without unstaking", async () => {
    const { user, onClose, onConfirm } = setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // The modal does not cap decimal places: "1.123456789" passes validation and
  // is handed to onConfirm as-is. Reported in the PR (tests-only scope).
  it.todo("rejects amounts with more decimal places than USDC supports");
});
