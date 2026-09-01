import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Repository guard for the rule that motivated `<MoneyValue>`: a monetary value
 * must never be rendered from a loading or error fallback.
 *
 * `formatNgn(balance ?? 0)` and `₦{total || 0}` are indistinguishable from a
 * real zero once rendered, so a user can be shown — and act on — an amount the
 * server never sent. This test fails the build if that pattern comes back.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage", "e2e"]);

/** Formatters whose output a user reads as money. */
const MONEY_FORMATTERS = [
  "formatCurrency",
  "formatNgn",
  "formatUsdc",
  "formatNaira",
  "formatAmount",
  "formatDual",
  "formatMoney",
];

/**
 * `formatNgn(x ?? 0)` / `formatCurrency(a.b || 0)` — a formatter called on an
 * expression that falls back to a literal zero.
 */
const FORMATTER_FALLBACK = new RegExp(
  String.raw`\b(?:${MONEY_FORMATTERS.join("|")})\s*\([^)]*?(?:\?\?|\|\|)\s*0(?:\.0+)?\s*[,)]`,
);

/**
 * `₦{amount ?? 0}` / `₦${(fee || 0).toLocaleString()}` — a naira-prefixed
 * fallback. Anchored on the ₦ sign so a bare `${x ?? 0}` template hole, which
 * is not necessarily money, does not trip the check.
 */
const CURRENCY_PREFIX_FALLBACK =
  /₦\s*\{?\$?\{?\(?[^{}()\n]*?(?:\?\?|\|\|)\s*0(?:\.0+)?\s*[)}]/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no monetary value renders from a fallback", () => {
  const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(ROOT, dir)));

  it("scans the whole frontend source tree", () => {
    // Guards against the walker silently matching nothing and passing vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it("has no money formatter called on a zero fallback", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (FORMATTER_FALLBACK.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Use <MoneyValue> so an unknown amount renders as a dash, not as zero:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no currency-prefixed zero fallback", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (CURRENCY_PREFIX_FALLBACK.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Use <MoneyValue> so an unknown amount renders as a dash, not as zero:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("catches zero fallbacks in second or later argument positions", () => {
    // Regression fixtures from issue #1579 (multi-argument formatter calls)
    const secondArgFallback1 = "const formatPair = (usdc) => (ngn) => formatAmount(ngn, usdc ?? 0);";
    const secondArgFallback2 = "format={(ngn) => formatDual(ngn, earningsData.totals.totalUsdc ?? 0)}";
    const firstArgFallback = "formatNgn(balance ?? 0)";

    expect(FORMATTER_FALLBACK.test(secondArgFallback1)).toBe(true);
    expect(FORMATTER_FALLBACK.test(secondArgFallback2)).toBe(true);
    expect(FORMATTER_FALLBACK.test(firstArgFallback)).toBe(true);
  });
});

describe("error states offer a retry rather than a page reload", () => {
  const files = SCAN_DIRS.flatMap((dir) => collectSourceFiles(join(ROOT, dir)));

  /**
   * `window.location.reload()` throws away every other section on the page to
   * recover one. The service worker and the offline fallback are the legitimate
   * exceptions — there, reloading *is* the action.
   */
  const ALLOWED_RELOADS = new Set([
    "components/service-worker-register.tsx",
    "app/offline/page.tsx",
  ]);

  it("has no reload-based retry outside the offline path", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWED_RELOADS.has(rel)) continue;

      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (/window\.location\.reload\s*\(/.test(line)) {
          offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Use <ErrorState onRetry={...}> to re-run the failed fetch instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
