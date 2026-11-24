import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalDialog } from "../ModalDialog";

function renderModal(isOpen = true, onClose = vi.fn()) {
  render(
    <>
      <button type="button">Outside</button>
      <ModalDialog isOpen={isOpen} onClose={onClose}>
        <button type="button">Approve</button>
        <button type="button">Reject</button>
      </ModalDialog>
    </>,
  );
  return onClose;
}

describe("ModalDialog", () => {
  it("renders nothing when closed", () => {
    renderModal(false);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("renders an accessibly named dialog with its children when open", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Dialog" });
    expect(dialog).toHaveAccessibleDescription("Admin action dialog");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("moves focus into the dialog and traps Tab / Shift+Tab inside it", async () => {
    const user = userEvent.setup();
    renderModal();

    const approve = screen.getByRole("button", { name: "Approve" });
    const reject = screen.getByRole("button", { name: "Reject" });
    const close = screen.getByRole("button", { name: "Close" });
    expect(approve).toHaveFocus();

    await user.tab();
    expect(reject).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    // Wraps instead of escaping to the button behind the dialog.
    await user.tab();
    expect(approve).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();

    // The background is hidden from assistive tech while the modal is open.
    expect(screen.queryByRole("button", { name: "Outside" })).not.toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = renderModal();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the close button", async () => {
    const user = userEvent.setup();
    const onClose = renderModal();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for interactions inside the dialog", async () => {
    const user = userEvent.setup();
    const onClose = renderModal();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
