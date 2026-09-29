import {
  extractFieldErrors,
  parseFormError,
  toMessage,
} from "./formErrors";
import { describe, expect, it } from "vitest";

describe("toMessage", () => {
  it("returns the string value as-is", () => {
    expect(toMessage("error message")).toBe("error message");
  });

  it("joins an array of strings with a comma and space", () => {
    expect(toMessage(["error1", "error2"])).toBe("error1, error2");
  });

  it("returns empty string for null", () => {
    expect(toMessage(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(toMessage(undefined)).toBe("");
  });

  it("returns empty string for non-string non-array values", () => {
    expect(toMessage(123)).toBe("");
    expect(toMessage(true)).toBe("");
    expect(toMessage({})).toBe("");
  });

  it("filters out empty strings from array", () => {
    expect(toMessage(["error1", "", "error2"])).toBe("error1, error2");
  });
});

describe("extractFieldErrors", () => {
  it("returns empty object for non-object input", () => {
    expect(extractFieldErrors(null)).toEqual({});
    expect(extractFieldErrors(undefined)).toEqual({});
    expect(extractFieldErrors("string")).toEqual({});
    expect(extractFieldErrors(123)).toEqual({});
  });

  it("handles flat shape with valid field errors", () => {
    const input = {
      email: "Invalid email",
      password: ["Too short", "Weak password"],
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Invalid email",
      password: "Too short, Weak password",
    });
  });

  it("handles fieldErrors-wrapped shape", () => {
    const input = {
      fieldErrors: {
        email: "Invalid email",
        password: ["Too short"],
      },
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Invalid email",
      password: "Too short",
    });
  });

  it("filters out falsy/empty messages", () => {
    const input = {
      email: "Invalid email",
      name: "",
      age: null,
      address: undefined,
      emptyArray: [],
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Invalid email",
    });
  });

  it("prioritizes fieldErrors over flat shape", () => {
    const input = {
      fieldErrors: {
        email: "Wrapped error",
      },
      email: "Flat error",
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Wrapped error",
    });
  });

  it("ignores fieldErrors if it is not an object", () => {
    const input = {
      fieldErrors: "not an object",
      email: "Flat error",
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Flat error",
    });
  });

  it("ignores fieldErrors if it is an array", () => {
    const input = {
      fieldErrors: ["error1"],
      email: "Flat error",
    };
    expect(extractFieldErrors(input)).toEqual({
      email: "Flat error",
    });
  });
});

describe("parseFormError", () => {
  it("returns the message for string input", () => {
    expect(parseFormError("error message")).toBe("error message");
  });

  it("returns fallback for non-string non-object input", () => {
    expect(parseFormError(123)).toBe("An unexpected error occurred");
    expect(parseFormError(null)).toBe("An unexpected error occurred");
    expect(parseFormError(undefined)).toBe("An unexpected error occurred");
  });

  it("extracts field errors for object input with fieldErrors", () => {
    const input = {
      fieldErrors: {
        email: "Invalid email",
      },
    };
    expect(parseFormError(input)).toEqual({
      email: "Invalid email",
    });
  });

  it("returns fallback for object input without valid fieldErrors", () => {
    const input = {
      otherProperty: "value",
    };
    expect(parseFormError(input)).toBe("An unexpected error occurred");
  });

  it("returns fallback for empty object", () => {
    expect(parseFormError({})).toBe("An unexpected error occurred");
  });
});