import { getRequestConfig } from "next-intl/server";
import { locales, Locale } from "./config";
import { notFound } from "next/navigation";

export default getRequestConfig(async ({ locale }) => {
  if (!locales.includes(locale as Locale)) notFound();

  let messages;
  switch (locale) {
    case "es":
      messages = (await import("../messages/es.json")).default;
      break;
    case "fr":
      messages = (await import("../messages/fr.json")).default;
      break;
    case "zh":
      messages = (await import("../messages/zh.json")).default;
      break;
    case "ar":
      messages = (await import("../messages/ar.json")).default;
      break;
    case "en":
    default:
      messages = (await import("../messages/en.json")).default;
      break;
  }

  return { messages };
});
