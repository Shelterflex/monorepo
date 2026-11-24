import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SkipLink from "./SkipLink";

describe("SkipLink", () => {
  it("renders a link to the main content by default", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("supports a custom target", () => {
    render(<SkipLink href="#content" />);
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveAttribute(
      "href",
      "#content",
    );
  });

  it("is the first focusable element reached by Tab", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SkipLink />
        <button>Other</button>
      </div>,
    );
    await user.tab();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveFocus();
  });
});
