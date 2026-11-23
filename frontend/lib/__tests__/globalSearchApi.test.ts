import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/propertiesApi", () => ({ searchProperties: vi.fn() }));
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  apiGet: vi.fn(),
}));

import { searchProperties } from "@/lib/propertiesApi";
import { apiGet } from "@/lib/apiClient";
import { globalSearch } from "../globalSearchApi";

const searchMock = vi.mocked(searchProperties);
const getMock = vi.mocked(apiGet);

const property = {
  listingId: "L-1",
  address: "12 Admiralty Way",
  city: "Lagos",
  area: "Lekki",
  bedrooms: 2,
  bathrooms: 1,
};

beforeEach(() => {
  searchMock.mockReset();
  getMock.mockReset();
  searchMock.mockResolvedValue({ data: [] } as never);
  getMock.mockResolvedValue({ data: [] });
});

describe("globalSearch", () => {
  it("returns nothing and makes no requests for a blank query", async () => {
    await expect(globalSearch("   ", true)).resolves.toEqual([]);
    expect(searchMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("searches only properties for anonymous users", async () => {
    searchMock.mockResolvedValueOnce({ data: [property] } as never);

    const groups = await globalSearch("lekki", false);

    expect(searchMock).toHaveBeenCalledWith({ query: "lekki", pageSize: 5 });
    expect(getMock).not.toHaveBeenCalled();
    expect(groups).toEqual([
      {
        label: "Properties",
        results: [
          {
            id: "L-1",
            type: "property",
            title: "12 Admiralty Way",
            subtitle: "Lagos - Lekki - 2 bed, 1 bath",
            href: "/properties/L-1",
          },
        ],
      },
    ]);
  });

  it("also searches deals and transactions for signed-in users, with encoded URLs", async () => {
    searchMock.mockResolvedValueOnce({ data: [] } as never);
    getMock
      .mockResolvedValueOnce({ data: [{ id: "d-1", title: "Flat deal", status: "active" }] })
      .mockResolvedValueOnce({ data: [{ id: "t-1", description: "Rent", amount: "₦50,000" }] });

    const groups = await globalSearch("rent & flat", true);

    expect(getMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/deals/search?q=rent+%26+flat&pageSize=5",
      "/api/transactions/search?q=rent+%26+flat&pageSize=5",
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Deals", "Transactions"]);
    expect(groups[0].results[0]).toEqual({
      id: "d-1",
      type: "deal",
      title: "Flat deal",
      subtitle: "active",
      href: "/deals/d-1",
    });
    expect(groups[1].results[0]).toMatchObject({
      type: "transaction",
      title: "Rent",
      subtitle: "₦50,000",
      href: "/transactions/t-1",
    });
  });

  it("omits empty groups", async () => {
    await expect(globalSearch("nothing", true)).resolves.toEqual([]);
  });

  it("treats a failing source as empty instead of failing the whole search", async () => {
    searchMock.mockRejectedValueOnce(new Error("search down"));
    getMock
      .mockRejectedValueOnce(new Error("deals down"))
      .mockResolvedValueOnce({ data: [{ id: "t-2", description: null, amount: null }] });

    const groups = await globalSearch("x", true);

    expect(groups.map((g) => g.label)).toEqual(["Transactions"]);
    expect(groups[0].results[0]).toMatchObject({ title: "Transaction", subtitle: "" });
  });
});
