import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n/config";

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always"
});

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const targetPaths = ["/about", "/contact", "/cookies", "/privacy", "/terms"];
  const cleanPathname = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;

  // Extract the segment after locale if any
  const pathnameParts = cleanPathname.split('/');
  const hasLocalePrefix = pathnameParts.length > 1 && ["en", "es", "fr", "ar", "zh"].includes(pathnameParts[1]);
  const originalPath = hasLocalePrefix ? '/' + pathnameParts.slice(2).join('/') : cleanPathname;

  let response: NextResponse;

  if (targetPaths.includes(originalPath) || targetPaths.includes(cleanPathname)) {
    response = intlMiddleware(request);
  } else {
    response = NextResponse.next();
  }

  // Content Security Policy
  const backendUrl = "http://localhost:4000"; // Hardcoded for local development
  const cspHeader = [
    "default-src 'self'",
    `connect-src 'self' ${backendUrl} https://horizon.stellar.org https://horizon-testnet.stellar.org`,
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://vercel.live",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://vercel.live",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Security Headers
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
