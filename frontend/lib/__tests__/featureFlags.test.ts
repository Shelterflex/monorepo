import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { defaultFlags, type FlagName } from "@/config/featureFlags";
import { FeatureFlagProvider, useFeatureFlag } from "../featureFlags";

function FlagProbe({ flag }: { flag: FlagName }) {
  const enabled = useFeatureFlag(flag);
  return createElement("span", { "data-testid": flag }, String(enabled));
}

const ORIGINAL_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.example.test";
});

afterEach(() => {
  if (ORIGINAL_BACKEND_URL === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
  else process.env.NEXT_PUBLIC_BACKEND_URL = ORIGINAL_BACKEND_URL;
  vi.unstubAllGlobals();
});

describe("flag defaults", () => {
  it("uses the static defaults when no provider is mounted", () => {
    render(createElement(FlagProbe, { flag: "STAKING_ENABLED" }));
    expect(screen.getByTestId("STAKING_ENABLED")).toHaveTextContent("true");
  });

  it.each(Object.keys(defaultFlags) as FlagName[])("exposes the default for %s", (flag) => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(createElement(FeatureFlagProvider, null, createElement(FlagProbe, { flag })));
    expect(screen.getByTestId(flag)).toHaveTextContent(String(defaultFlags[flag]));
  });

  it("keeps risky features off by default", () => {
    expect(defaultFlags.RENT_TO_OWN_ENABLED).toBe(false);
    expect(defaultFlags.ADVANCED_WALLET_OPS_ENABLED).toBe(false);
  });
});

describe("FeatureFlagProvider hydration", () => {
  it("does not fetch when no backend URL is configured", () => {
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(FeatureFlagProvider, null, createElement(FlagProbe, { flag: "GOVERNANCE_ENABLED" })));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("GOVERNANCE_ENABLED")).toHaveTextContent("false");
  });

  it("requests /api/config/feature-flags with credentials and overrides defaults from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { GOVERNANCE_ENABLED: true, STAKING_ENABLED: false } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(
        FeatureFlagProvider,
        null,
        createElement(FlagProbe, { flag: "GOVERNANCE_ENABLED" }),
        createElement(FlagProbe, { flag: "STAKING_ENABLED" }),
      ),
    );

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/config/feature-flags", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    await waitFor(() => expect(screen.getByTestId("GOVERNANCE_ENABLED")).toHaveTextContent("true"));
    expect(screen.getByTestId("STAKING_ENABLED")).toHaveTextContent("false");
  });

  it("keeps the defaults when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    render(createElement(FeatureFlagProvider, null, createElement(FlagProbe, { flag: "GOVERNANCE_ENABLED" })));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId("GOVERNANCE_ENABLED")).toHaveTextContent("false");
  });

  it("keeps the defaults silently when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(createElement(FeatureFlagProvider, null, createElement(FlagProbe, { flag: "STAKING_ENABLED" })));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByTestId("STAKING_ENABLED")).toHaveTextContent("true");
  });
});
