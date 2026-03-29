/** @type {import('next').NextConfig} */
import bundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

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
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: false,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
