import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { toast as showToast } from "@/hooks/use-toast";
import {
  showSuccessToast,
  showErrorToast,
  showNetworkErrorToast,
  handleError,
} from "../toast";

const toastMock = vi.mocked(showToast);

beforeEach(() => {
  toastMock.mockClear();
});

describe("showSuccessToast", () => {
  it("shows a default-variant toast titled Success", () => {
    showSuccessToast("Saved");
    expect(toastMock).toHaveBeenCalledWith({
      title: "Success",
      description: "Saved",
      variant: "default",
    });
  });

  it("uses a custom title when one is given", () => {
    showSuccessToast("Payment received", "Done");
    expect(toastMock.mock.calls[0][0]).toMatchObject({ title: "Done" });
  });
});

describe("showErrorToast", () => {
  it("maps a backend error envelope to a destructive toast with its message", () => {
    showErrorToast({ error: { code: "UNKNOWN_ERROR", message: "Boom" } });
    expect(toastMock).toHaveBeenCalledWith({
      title: "Error",
      description: "Boom Try again.",
      variant: "destructive",
    });
  });

  it("falls back to the default message when the error has none", () => {
    showErrorToast(null, "Could not save");
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      variant: "destructive",
      description: "Could not save Try again.",
    });
  });
});

describe("showNetworkErrorToast", () => {
  it("shows the connection error copy", () => {
    showNetworkErrorToast();
    expect(toastMock).toHaveBeenCalledWith({
      title: "Connection Error",
      description:
        "Cannot connect to the server. Please check your internet connection and try again.",
      variant: "destructive",
    });
  });
});

describe("handleError", () => {
  it("routes network failures to the connection toast", () => {
    handleError(new Error("Failed to fetch"));
    expect(toastMock.mock.calls[0][0]).toMatchObject({ title: "Connection Error" });
  });

  it("routes every other error through the generic error toast", () => {
    handleError({ error: { code: "UNKNOWN_ERROR", message: "Nope" } });
    expect(toastMock.mock.calls[0][0]).toMatchObject({ title: "Error", description: "Nope Try again." });
  });
});
