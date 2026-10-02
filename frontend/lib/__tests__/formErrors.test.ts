import { describe, expect, it } from "vitest";
import { extractFieldErrors, parseFormError } from "../formErrors";

describe("formErrors", () => {
  describe("extractFieldErrors and toMessage", () => {
    it("returns {} for non-object or falsy details", () => {
      expect(extractFieldErrors(null)).toEqual({});
      expect(extractFieldErrors(undefined)).toEqual({});
      expect(extractFieldErrors("string")).toEqual({});
      expect(extractFieldErrors(123)).toEqual({});
      expect(extractFieldErrors([])).toEqual({});
    });

    it("handles flat shape with string, array of strings, and other/unexpected value types", () => {
      const details = {
        email: "Invalid email",
        password: ["Password too short", 123, null],
        age: 18,
        tags: [],
        bio: ["Valid bio"],
      };
      expect(extractFieldErrors(details)).toEqual({
        email: "Invalid email",
        password: "Password too short",
        bio: "Valid bio",
      });
    });

    it("handles fieldErrors-wrapped shape", () => {
      const details = {
        fieldErrors: {
          username: "Username is taken",
          phone: ["Invalid phone number"],
          ref: { nested: "object" },
        },
      };
      expect(extractFieldErrors(details)).toEqual({
        username: "Username is taken",
        phone: "Invalid phone number",
      });
    });

    it("filters out falsy or empty messages", () => {
      const details = {
        field1: "",
        field2: null,
        field3: undefined,
        field4: 0,
        field5: [],
        field6: [123],
        field7: "Valid error",
      };
      expect(extractFieldErrors(details)).toEqual({
        field7: "Valid error",
      });
    });
  });

  describe("parseFormError", () => {
    it("uses fallbackMessage when parsed error has no userMessage or details", () => {
      const fallback = "Something went wrong";
      const result = parseFormError("random error string", fallback);
      expect(result.message).toBe("random error string"); // parseBackendError uses string as userMessage
      expect(result.fieldErrors).toEqual({});
    });

    it("uses fallbackMessage when backend error returns default/unknown without message", () => {
      const fallback = "Default fallback";
      const result = parseFormError(null, fallback);
      expect(result.message).toBe(fallback);
      expect(result.fieldErrors).toEqual({});
    });

    it("parses fieldErrors from parsed.details or error.details", () => {
      const fallback = "Fallback";
      const errorWithDetails = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: {
            fieldErrors: {
              email: "Email required",
            },
          },
        },
      };
      const result = parseFormError(errorWithDetails, fallback);
      expect(result.fieldErrors).toEqual({
        email: "Email required",
      });
    });

    it("falls back to error.details when parsed.details is absent", () => {
      const fallback = "Fallback";
      const errorObj = {
        message: "Some error",
        details: {
          password: "Too weak",
        },
      };
      const result = parseFormError(errorObj, fallback);
      expect(result.fieldErrors).toEqual({
        password: "Too weak",
      });
    });
  });
});
