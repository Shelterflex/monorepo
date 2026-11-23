import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFocusTrap } from "../useFocusTrap";

function Trap({ onClose }: { onClose?: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);

  return (
    <div ref={ref}>
      <button type="button" data-testid="first">First</button>
      <button type="button" data-testid="middle">Middle</button>
      <button type="button" data-testid="last">Last</button>
    </div>
  );
}

function EmptyTrap() {
  const ref = useFocusTrap<HTMLDivElement>(true);

  return <div ref={ref} data-testid="empty-trap" />;
}

describe("useFocusTrap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("focuses the first element and wraps Tab and Shift+Tab", () => {
    render(<Trap />);

    expect(screen.getByTestId("first")).toHaveFocus();

    screen.getByTestId("last").focus();
    expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(false);
    expect(screen.getByTestId("first")).toHaveFocus();

    expect(fireEvent.keyDown(window, { key: "Tab", shiftKey: true })).toBe(false);
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Trap onClose={onClose} />);

    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on unmount", () => {
    render(<button type="button" data-testid="outside">Outside</button>);
    const outside = screen.getByTestId("outside");
    outside.focus();

    const trap = render(<Trap />);
    expect(screen.getByTestId("first")).toHaveFocus();

    act(() => {
      trap.unmount();
    });

    expect(outside).toHaveFocus();
  });

  it("focuses the container and traps Tab when there are no focusable children", () => {
    render(<EmptyTrap />);

    const container = screen.getByTestId("empty-trap");
    expect(container).toHaveFocus();
    expect(container).toHaveAttribute("tabindex", "-1");
    expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(false);
  });

  it("ignores Escape when no close handler is provided", () => {
    render(<Trap />);

    expect(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    }).not.toThrow();
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
  });
});
