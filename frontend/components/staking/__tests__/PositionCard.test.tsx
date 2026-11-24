import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PositionCard, formatUsdc } from "../PositionCard";

function cardValue(label: string) {
  // CardDescription and CardTitle are siblings inside the CardHeader.
  return screen.getByText(label).nextElementSibling!.textContent;
}

describe("formatUsdc", () => {
  it.each([
    [undefined, "0.000000"],
    [null, "0.000000"],
    ["", "0.000000"],
    ["abc", "0.000000"],
    [0, "0.000000"],
    ["1.5", "1.500000"],
    [1234567.1234567, "1,234,567.123457"],
  ])("formats %p as %p", (input, expected) => {
    expect(formatUsdc(input as string | number | null | undefined)).toBe(expected);
  });
});

describe("PositionCard", () => {
  it("shows zero balances and hides the composition when there is no position", () => {
    render(<PositionCard position={null} />);

    expect(cardValue("Your Staked Balance")).toBe("0.000000USDC");
    expect(cardValue("Claimable Rewards")).toBe("0.000000USDC");
    expect(cardValue("Platform Total Staked")).toBe("15,840,250.000000USDC");
    expect(cardValue("Current APY")).toBe("18.50%Var");
    expect(screen.queryByText("Staking Composition")).not.toBeInTheDocument();
  });

  it("renders staked and claimable amounts, including large values", () => {
    render(
      <PositionCard
        position={{ staked: "987654321.5", claimable: "12.345678", warming: "0", cooling: "0" }}
        platformTotalStaked="1000000000"
        currentApy={7}
      />,
    );

    expect(cardValue("Your Staked Balance")).toBe("987,654,321.500000USDC");
    expect(cardValue("Claimable Rewards")).toBe("12.345678USDC");
    expect(cardValue("Platform Total Staked")).toBe("1,000,000,000.000000USDC");
    expect(cardValue("Current APY")).toBe("7.00%Var");
    // All stake is active, so there is nothing to break down.
    expect(screen.queryByText("Staking Composition")).not.toBeInTheDocument();
  });

  it("shows the composition with a text alternative when stake is warming or cooling", () => {
    render(<PositionCard position={{ staked: "60", claimable: "0", warming: "30", cooling: "10" }} />);

    expect(screen.getByText("Staking Composition")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Stake composition: active 60.000000 USDC, warming 30.000000 USDC, cooling 10.000000 USDC",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More information about staking composition" })).toBeInTheDocument();
  });

  it("exposes the APY info trigger by name", () => {
    render(<PositionCard position={null} />);

    expect(screen.getByRole("button", { name: "More information about APY" })).toBeInTheDocument();
  });
});
