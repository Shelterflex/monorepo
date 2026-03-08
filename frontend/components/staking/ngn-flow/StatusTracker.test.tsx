import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusTracker, type StakingPosition } from "./StatusTracker";

describe("StatusTracker", () => {
  const mockTransactionId = "txn_123456";

  describe("DepositPendingStatus", () => {
    it("should display waiting for deposit message", () => {
      render(
        <StatusTracker
          status="deposit_pending"
          transactionId={mockTransactionId}
        />
      );

      expect(screen.getByText("Waiting for your deposit")).toBeInTheDocument();
      expect(
        screen.getByText("We'll proceed once your payment is confirmed")
      ).toBeInTheDocument();
    });

    it("should display loading spinner", () => {
      render(
        <StatusTracker
          status="deposit_pending"
          transactionId={mockTransactionId}
        />
      );

      const spinner = screen.getByRole("status");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("ConversionPendingStatus", () => {
    it("should display conversion message", () => {
      render(
        <StatusTracker
          status="conversion_pending"
          transactionId={mockTransactionId}
        />
      );

      expect(screen.getByText("Converting NGN to USDC")).toBeInTheDocument();
      expect(
        screen.getByText("Your currency conversion is in progress")
      ).toBeInTheDocument();
    });

    it("should display loading spinner", () => {
      render(
        <StatusTracker
          status="conversion_pending"
          transactionId={mockTransactionId}
        />
      );

      const spinner = screen.getByRole("status");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("StakingQueuedStatus", () => {
    it("should display staking queued message", () => {
      render(
        <StatusTracker
          status="staking_queued"
          transactionId={mockTransactionId}
        />
      );

      expect(
        screen.getByText("Staking queued — processing shortly")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Your USDC will be staked momentarily")
      ).toBeInTheDocument();
    });

    it("should display loading spinner", () => {
      render(
        <StatusTracker
          status="staking_queued"
          transactionId={mockTransactionId}
        />
      );

      const spinner = screen.getByRole("status");
      expect(spinner).toBeInTheDocument();
    });
  });

  describe("ConfirmedStatus", () => {
    const mockPosition: StakingPosition = {
      amount: 1000.5,
      startDate: "2024-01-15T10:30:00Z",
      expectedYield: 12.5,
    };

    it("should display staking complete message", () => {
      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={mockPosition}
        />
      );

      expect(screen.getByText("Staking Complete")).toBeInTheDocument();
      expect(screen.getByText("Your position is now active")).toBeInTheDocument();
    });

    it("should display staked amount", () => {
      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={mockPosition}
        />
      );

      expect(screen.getByText("Staked Amount")).toBeInTheDocument();
      expect(screen.getByText("1,000.50 USDC")).toBeInTheDocument();
    });

    it("should display start date", () => {
      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={mockPosition}
        />
      );

      expect(screen.getByText("Start Date")).toBeInTheDocument();
      expect(screen.getByText("January 15, 2024")).toBeInTheDocument();
    });

    it("should display expected yield", () => {
      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={mockPosition}
        />
      );

      expect(screen.getByText("Expected Yield (APY)")).toBeInTheDocument();
      expect(screen.getByText("12.50%")).toBeInTheDocument();
    });

    it("should display maturity date when provided", () => {
      const positionWithMaturity: StakingPosition = {
        ...mockPosition,
        maturityDate: "2025-01-15T10:30:00Z",
      };

      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={positionWithMaturity}
        />
      );

      expect(screen.getByText("Maturity Date")).toBeInTheDocument();
      expect(screen.getByText("January 15, 2025")).toBeInTheDocument();
    });

    it("should not display maturity date when not provided", () => {
      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={mockPosition}
        />
      );

      expect(screen.queryByText("Maturity Date")).not.toBeInTheDocument();
    });

    it("should format large amounts correctly", () => {
      const largePosition: StakingPosition = {
        amount: 1234567.89,
        startDate: "2024-01-15T10:30:00Z",
        expectedYield: 8.75,
      };

      render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
          stakingPosition={largePosition}
        />
      );

      expect(screen.getByText("1,234,567.89 USDC")).toBeInTheDocument();
    });

    it("should handle confirmed status without stakingPosition gracefully", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { container } = render(
        <StatusTracker
          status="confirmed"
          transactionId={mockTransactionId}
        />
      );

      expect(container.firstChild).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "StatusTracker: stakingPosition is required for confirmed status"
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Status transitions", () => {
    it("should render different components for different statuses", () => {
      const { rerender } = render(
        <StatusTracker
          status="deposit_pending"
          transactionId={mockTransactionId}
        />
      );

      expect(screen.getByText("Waiting for your deposit")).toBeInTheDocument();

      rerender(
        <StatusTracker
          status="conversion_pending"
          transactionId={mockTransactionId}
        />
      );

      expect(screen.getByText("Converting NGN to USDC")).toBeInTheDocument();

      rerender(
        <StatusTracker
          status="staking_queued"
          transactionId={mockTransactionId}
        />
      );

      expect(
        screen.getByText("Staking queued — processing shortly")
      ).toBeInTheDocument();
    });
  });

  describe("Error handling", () => {
    it("should handle unknown status gracefully", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { container } = render(
        <StatusTracker
          status={"unknown_status" as any}
          transactionId={mockTransactionId}
        />
      );

      expect(container.firstChild).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'StatusTracker: Unknown status "unknown_status"'
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
