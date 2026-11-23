import { describe, it, expect } from "vitest";
import { landlordBenefits } from "../landlordBenefits";

describe("landlordBenefits", () => {
  it("lists at least one benefit", () => {
    expect(landlordBenefits.length).toBeGreaterThan(0);
  });

  it("gives every benefit a title and a description", () => {
    for (const benefit of landlordBenefits) {
      expect(benefit.title.trim().length).toBeGreaterThan(0);
      expect(benefit.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("has unique titles", () => {
    const titles = landlordBenefits.map((b) => b.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
