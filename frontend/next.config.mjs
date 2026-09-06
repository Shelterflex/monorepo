/** @type {import('next').NextConfig} */
import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import { performanceConfig } from "./next.config.performance.mjs";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const withNextIntl = createNextIntlPlugin("./i18n.ts");

if (!process.env.NEXT_PUBLIC_BACKEND_URL && process.env.NODE_ENV === 'production' && !process.env.GITHUB_ACTIONS) {
  throw new Error(
    'NEXT_PUBLIC_BACKEND_URL must be set in production builds. ' +
    'Without it, the CSP connect-src directive (and any code relying on this ' +
    'build-time value) would silently fall back to http://localhost:4000.'
  )
}

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

/**
 * Content Security Policy directives.
 * Tighten script-src / style-src in production once inline styles are removed.
 */
const cspDirectives = [
  "default-src 'self'",
  `connect-src 'self' ${backendUrl} https://horizon.stellar.org https://horizon-testnet.stellar.org`,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",   // tighten after removing inline scripts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspDirectives,
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
  ...performanceConfig,
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
