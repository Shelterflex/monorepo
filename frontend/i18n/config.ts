// Supported locales
export const locales = ["en", "es", "fr", "ar", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

// RTL languages
export const rtlLocales: Locale[] = ["ar"];
