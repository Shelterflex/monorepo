import { describe, it, expect } from "vitest";
import { getTenantPaymentStatusPresentation } from "../tenantPaymentStatus";

describe("getTenantPaymentStatusPresentation", () => {
  it.each([
    ["paid", "Paid", "secondary"],
    ["upcoming", "Upcoming", "default"],
    ["pending", "Pending", "outline"],
  ] as const)("maps %s to its label and variant", (status, label, variant) => {
    const presentation = getTenantPaymentStatusPresentation(status);
    expect(presentation.label).toBe(label);
    expect(presentation.variant).toBe(variant);
  });

  it("gives every known status complete styling", () => {
    for (const status of ["paid", "upcoming", "pending"]) {
      const p = getTenantPaymentStatusPresentation(status);
      expect(p.className).toEqual(expect.any(String));
      expect(p.textClassName).toEqual(expect.any(String));
      expect(p.iconContainerClassName).toEqual(expect.any(String));
      expect(p.className.length).toBeGreaterThan(0);
      expect(p.textClassName.length).toBeGreaterThan(0);
      expect(p.iconContainerClassName.length).toBeGreaterThan(0);
    }
  });

  it("matches statuses regardless of case", () => {
    expect(getTenantPaymentStatusPresentation("PAID").label).toBe("Paid");
    expect(getTenantPaymentStatusPresentation("Upcoming").label).toBe("Upcoming");
  });

  it("falls back to the pending presentation for an unknown status", () => {
    expect(getTenantPaymentStatusPresentation("overdue")).toEqual(
      getTenantPaymentStatusPresentation("pending"),
    );
  });
});
