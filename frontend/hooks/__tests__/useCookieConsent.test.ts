import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ConsentPreferences } from "@/lib/consent-manager";

type HookModule = typeof import("../useCookieConsent");
type ManagerModule = typeof import("@/lib/consent-manager");

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => unknown,
      getServerSnapshot?: () => unknown,
    ) => {
      const [snapshot, setSnapshot] = actual.useState<unknown>(() =>
        getServerSnapshot ? getServerSnapshot() : getSnapshot(),
      );

      actual.useEffect(() => {
        const checkSnapshot = () => {
          const next = getSnapshot();
          setSnapshot((previous: unknown) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
        };

        checkSnapshot();
        return subscribe(checkSnapshot);
      }, [subscribe, getSnapshot]);

      return snapshot;
    },
  };
});

vi.mock("@/lib/analytics", () => ({
  analytics: {
    setConsent: vi.fn(),
    initialize: vi.fn(),
    track: vi.fn(),
    getEvents: vi.fn(() => []),
    reset: vi.fn(),
  },
}));

vi.mock("@/lib/performance-tracking", () => ({
  performanceTracking: {
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    getMetrics: vi.fn(() => ({})),
    reset: vi.fn(),
  },
}));

let useCookieConsent: HookModule["useCookieConsent"];
let consentManager: ManagerModule["consentManager"];

async function loadFreshModules() {
  const managerModule = await import("@/lib/consent-manager");
  const hookModule = await import("../useCookieConsent");
  consentManager = managerModule.consentManager;
  useCookieConsent = hookModule.useCookieConsent;
}

describe("useCookieConsent", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    localStorage.clear();
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadFreshModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("shows the banner and applies accept and reject actions", () => {
    const { result } = renderHook(() => useCookieConsent());

    expect(result.current.isLoaded).toBe(true);
    expect(result.current.consent).toBeNull();
    expect(result.current.showBanner).toBe(true);
    expect(result.current.hasConsent("analytics")).toBe(false);

    act(() => {
      result.current.acceptAll();
    });

    const stored = JSON.parse(
      localStorage.getItem("consent_preferences")!,
    ) as ConsentPreferences;
    expect(stored).toEqual(
      expect.objectContaining({
        analytics: true,
        performance: true,
        functional: true,
        marketing: true,
        version: "1.0",
      }),
    );
    expect(result.current.consent?.categories).toEqual({
      analytics: true,
      marketing: true,
      functional: true,
    });
    expect(result.current.consent?.timestamp).toBe(
      new Date(Date.now()).toISOString(),
    );
    expect(result.current.showBanner).toBe(false);
    expect(result.current.hasConsent("marketing")).toBe(true);

    act(() => {
      result.current.rejectNonEssential();
    });

    expect(result.current.consent?.categories).toEqual({
      analytics: false,
      marketing: false,
      functional: false,
    });
    expect(result.current.hasConsent("analytics")).toBe(false);
  });

  it("updates granular preferences and controls the preferences dialog", () => {
    const { result } = renderHook(() => useCookieConsent());

    act(() => {
      result.current.openPreferences();
    });
    expect(result.current.isPreferencesOpen).toBe(true);

    act(() => {
      result.current.updateConsent({ analytics: true, functional: true });
    });

    expect(result.current.isPreferencesOpen).toBe(false);
    const stored = JSON.parse(
      localStorage.getItem("consent_preferences")!,
    ) as ConsentPreferences;
    expect(stored.analytics).toBe(true);
    expect(stored.performance).toBe(true);
    expect(stored.functional).toBe(true);
    expect(stored.marketing).toBe(false);
    expect(result.current.consent?.categories.analytics).toBe(true);

    act(() => {
      result.current.openPreferences();
    });
    act(() => {
      result.current.closePreferences();
    });
    expect(result.current.isPreferencesOpen).toBe(false);
  });

  it("keeps the banner visible for a stored policy version mismatch", async () => {
    const stored: ConsentPreferences = {
      analytics: true,
      performance: true,
      functional: true,
      marketing: true,
      version: "0.9",
      timestamp: Date.now(),
    };
    localStorage.setItem("consent_preferences", JSON.stringify(stored));

    vi.resetModules();
    await loadFreshModules();

    const { result } = renderHook(() => useCookieConsent());

    expect(result.current.consent?.version).toBe("0.9");
    expect(result.current.showBanner).toBe(true);
    expect(result.current.hasConsent("analytics")).toBe(true);
  });

  it("treats malformed stored consent as missing", async () => {
    localStorage.setItem("consent_preferences", "{broken");

    vi.resetModules();
    await loadFreshModules();

    const { result } = renderHook(() => useCookieConsent());

    expect(result.current.consent).toBeNull();
    expect(result.current.showBanner).toBe(true);
    expect(result.current.hasConsent("functional")).toBe(false);
    expect(consentManager.getPreferences().timestamp).toBe(0);
  });
});
