import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMonthYear,
  formatTime,
  formatRelativeTime,
  parseDate,
  isValidDate,
} from "../date";

describe("lib/date.ts", () => {
  describe("parseDate & isValidDate", () => {
    it("parses Date object", () => {
      const d = new Date(2026, 0, 15);
      expect(parseDate(d)).toEqual(d);
      expect(isValidDate(d)).toBe(true);
    });

    it("parses ISO string", () => {
      const iso = "2026-08-15T12:00:00.000Z";
      const parsed = parseDate(iso);
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe(iso);
      expect(isValidDate(iso)).toBe(true);
    });

    it("parses numeric timestamp", () => {
      const ts = 1755259200000;
      expect(parseDate(ts)?.getTime()).toBe(ts);
      expect(isValidDate(ts)).toBe(true);
    });

    it("handles invalid inputs gracefully", () => {
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate("invalid-date-string")).toBeNull();
      expect(isValidDate(null)).toBe(false);
      expect(isValidDate("not-a-date")).toBe(false);
    });
  });

  describe("formatDate", () => {
    it("formats standard date with default en-NG locale", () => {
      const d = new Date(2026, 7, 15); // Aug 15, 2026
      const res = formatDate(d);
      expect(res).toContain("2026");
      expect(res).toMatch(/Aug|08/);
    });

    it("supports custom locale and options", () => {
      const d = new Date(2026, 0, 5);
      const res = formatDate(d, {
        locale: "en-US",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      expect(res).toBe("Jan 5, 2026");
    });

    it("returns fallback for invalid date", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate("invalid", { fallback: "N/A" })).toBe("N/A");
    });
  });

  describe("formatDateTime", () => {
    it("formats date and time together", () => {
      const d = new Date(2026, 0, 15, 14, 30);
      const res = formatDateTime(d, { locale: "en-US" });
      expect(res).toContain("2026");
      expect(res).toMatch(/2:30|14:30/);
    });

    it("returns fallback for invalid date", () => {
      expect(formatDateTime(null)).toBe("—");
    });
  });

  describe("formatMonthYear", () => {
    it("formats short month and year", () => {
      const d = new Date(2026, 4, 1);
      const res = formatMonthYear(d, "en-US");
      expect(res).toBe("May 2026");
    });
  });

  describe("formatTime", () => {
    it("formats time correctly", () => {
      const d = new Date(2026, 0, 1, 9, 15);
      const res = formatTime(d, "en-US");
      expect(res).toMatch(/9:15/);
    });
  });

  describe("formatRelativeTime", () => {
    const base = new Date("2026-08-20T12:00:00Z");

    it("formats just now", () => {
      const recent = new Date("2026-08-20T11:59:30Z");
      expect(formatRelativeTime(recent, base)).toBe("just now");
    });

    it("formats minutes ago", () => {
      const mins = new Date("2026-08-20T11:45:00Z");
      expect(formatRelativeTime(mins, base)).toBe("15m ago");
    });

    it("formats hours ago", () => {
      const hours = new Date("2026-08-20T08:00:00Z");
      expect(formatRelativeTime(hours, base)).toBe("4h ago");
    });

    it("formats days ago", () => {
      const days = new Date("2026-08-17T12:00:00Z");
      expect(formatRelativeTime(days, base)).toBe("3d ago");
    });

    it("returns fallback on invalid date", () => {
      expect(formatRelativeTime(null, base)).toBe("—");
    });
  });
});
