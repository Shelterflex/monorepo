/**
 * Shared Date & Time Formatting Utilities
 * Single source of truth for date formatting across the platform.
 */

export const DEFAULT_DATE_LOCALE = "en-NG";

export type DateInput = Date | string | number | null | undefined;

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  locale?: string;
  fallback?: string;
}

/**
 * Safely parses any date input into a valid Date object.
 * Returns null if the input is null, undefined, or an invalid date.
 */
export function parseDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") {
    return null;
  }
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Checks whether a given input is a valid date.
 */
export function isValidDate(input: unknown): boolean {
  if (!input) return false;
  const date = input instanceof Date ? input : new Date(input as string | number);
  return !Number.isNaN(date.getTime());
}

/**
 * Formats a date using Intl.DateTimeFormat with standardized locale and options.
 * Defaults to "en-NG" and standard numeric or formatted dates.
 */
export function formatDate(
  input: DateInput,
  optionsOrLocale?: FormatDateOptions | string,
  extraOptions?: Intl.DateTimeFormatOptions,
): string {
  const date = parseDate(input);
  const options: FormatDateOptions =
    typeof optionsOrLocale === "string"
      ? { locale: optionsOrLocale, ...extraOptions }
      : { ...optionsOrLocale, ...extraOptions };

  const fallback = options.fallback ?? "—";
  if (!date) return fallback;

  const locale = options.locale ?? DEFAULT_DATE_LOCALE;
  const { locale: _l, fallback: _f, ...intlOptions } = options;

  const formatOptions: Intl.DateTimeFormatOptions =
    Object.keys(intlOptions).length > 0
      ? intlOptions
      : {
          year: "numeric",
          month: "short",
          day: "numeric",
        };

  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(date);
  } catch {
    return date.toLocaleDateString(locale, formatOptions);
  }
}

/**
 * Formats a date and time together.
 */
export function formatDateTime(
  input: DateInput,
  optionsOrLocale?: FormatDateOptions | string,
  extraOptions?: Intl.DateTimeFormatOptions,
): string {
  const date = parseDate(input);
  const options: FormatDateOptions =
    typeof optionsOrLocale === "string"
      ? { locale: optionsOrLocale, ...extraOptions }
      : { ...optionsOrLocale, ...extraOptions };

  const fallback = options.fallback ?? "—";
  if (!date) return fallback;

  const locale = options.locale ?? DEFAULT_DATE_LOCALE;
  const { locale: _l, fallback: _f, ...intlOptions } = options;

  const formatOptions: Intl.DateTimeFormatOptions =
    Object.keys(intlOptions).length > 0
      ? intlOptions
      : {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        };

  try {
    return new Intl.DateTimeFormat(locale, formatOptions).format(date);
  } catch {
    return date.toLocaleString(locale, formatOptions);
  }
}

/**
 * Formats date as Month Year (e.g., "Jan 2026").
 */
export function formatMonthYear(
  input: DateInput,
  locale: string = DEFAULT_DATE_LOCALE,
): string {
  return formatDate(input, {
    locale,
    year: "numeric",
    month: "short",
  });
}

/**
 * Formats time portion only (e.g., "10:30 AM").
 */
export function formatTime(
  input: DateInput,
  locale: string = DEFAULT_DATE_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = parseDate(input);
  if (!date) return "—";

  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

/**
 * Formats a relative time string (e.g., "just now", "5 minutes ago", "2 days ago").
 */
export function formatRelativeTime(
  input: DateInput,
  baseDate: Date = new Date(),
): string {
  const date = parseDate(input);
  if (!date) return "—";

  const diffMs = baseDate.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return formatDate(date, { month: "short", day: "numeric", year: "numeric" });
}
