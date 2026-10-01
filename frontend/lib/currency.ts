export type DisplayCurrency = "NGN" | "USDC";

export type SupportedCurrency = DisplayCurrency;

interface CurrencyPolicy {
  locale: string;
  fractionDigits: number;
  style: "currency" | "decimal";
  currencyDisplay?: Intl.NumberFormatOptions["currencyDisplay"];
}

interface FormatMoneyOptions {
  locale?: string;
  /**
   * Override the currency policy's decimal precision (minimum and maximum).
   * Whole-naira call sites (wallet modals, share metadata) pass 0 so every
   * call site keeps its intended precision without local reimplementations
   * of the formatter (#1849).
   */
  fractionDigits?: number;
}

interface FormatDecimalOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

const DEFAULT_LOCALE = "en-NG";

export const CURRENCY_POLICIES: Record<SupportedCurrency, CurrencyPolicy> = {
  NGN: {
    locale: DEFAULT_LOCALE,
    fractionDigits: 2,
    style: "currency",
    currencyDisplay: "symbol",
  },
  USDC: {
    locale: "en-US",
    fractionDigits: 2,
    style: "decimal",
  },
};

function toFiniteNumber(amount: number | string): number {
  const value = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Shelterflex displays monetary values with commercial half-up rounding:
 * ties at the currency precision round away from zero (1.005 -> 1.01,
 * -1.005 -> -1.01). Keep transaction and receipt displays on this path.
 */
export function roundCurrencyAmount(
  amount: number | string,
  currency: SupportedCurrency,
): number {
  const value = toFiniteNumber(amount);
  const digits = CURRENCY_POLICIES[currency].fractionDigits;
  const factor = 10 ** digits;
  const roundedMagnitude = Math.round((Math.abs(value) + Number.EPSILON) * factor);

  return Math.sign(value) * (roundedMagnitude / factor);
}

export function formatMoney(
  amount: number | string,
  currency: SupportedCurrency,
  options: FormatMoneyOptions = {},
): string {
  const policy = CURRENCY_POLICIES[currency];
  const locale = options.locale ?? policy.locale;
  const rounded = roundCurrencyAmount(amount, currency);
  const fractionDigits = options.fractionDigits ?? policy.fractionDigits;
  const formatterOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };

  if (policy.style === "currency") {
    formatterOptions.style = "currency";
    formatterOptions.currency = currency;
    formatterOptions.currencyDisplay = policy.currencyDisplay;
  }

  const formatted = new Intl.NumberFormat(locale, formatterOptions).format(rounded);

  return currency === "USDC" ? `${formatted} USDC` : formatted;
}

export function formatNgn(
  amount: number | string,
  locale?: string,
  options?: { fractionDigits?: number },
): string {
  return formatMoney(amount, "NGN", { locale, ...options });
}

export function formatCompactNgn(amount: number | string, locale = DEFAULT_LOCALE): string {
  const rounded = roundCurrencyAmount(amount, "NGN");

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "NGN",
    currencyDisplay: "symbol",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(rounded);
}

export function formatUsdc(amount: number | string, locale?: string): string {
  return formatMoney(amount, "USDC", { locale });
}

export function formatDecimal(
  amount: number | string,
  options: FormatDecimalOptions = {},
): string {
  const value = toFiniteNumber(amount);

  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  }).format(value);
}

export function formatConversionRate(
  rate: number | string,
  outputCurrency: SupportedCurrency,
  locale?: string,
): string {
  return `${formatDecimal(rate, {
    locale,
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })} ${outputCurrency}`;
}

export function formatDual(
  ngn: number | string,
  usdc: number | string,
  locale?: string,
): string {
  return `${formatNgn(ngn, locale)} · ${formatUsdc(usdc, locale)}`;
}

export function formatByPreference(
  amountNgn: number | string,
  amountUsdc: number | string,
  preference: DisplayCurrency,
  locale?: string,
): string {
  return preference === "USDC" ? formatUsdc(amountUsdc, locale) : formatNgn(amountNgn, locale);
}
