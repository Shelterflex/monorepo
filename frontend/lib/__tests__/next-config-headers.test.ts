import { describe, it, expect } from 'vitest';
import nextConfigPromise from '../../next.config.mjs';

describe('next.config.mjs security headers', () => {
  it('defines headers function that returns security headers for all routes', async () => {
    // nextConfig exported from withBundleAnalyzer(withNextIntl(nextConfig))
    const config = (await nextConfigPromise) as any;
    expect(config).toBeDefined();
    expect(typeof config?.headers).toBe('function');

    const headersConfig = await config.headers();
    expect(Array.isArray(headersConfig)).toBe(true);

    const allRoutesHeader = headersConfig.find((h: any) => h.source === '/(.*)');
    expect(allRoutesHeader).toBeDefined();

    const headersMap = new Map(allRoutesHeader.headers.map((h: any) => [h.key, h.value]));

    expect(headersMap.has('Content-Security-Policy')).toBe(true);
    expect(headersMap.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headersMap.get('Content-Security-Policy')).toContain("object-src 'none'");
    expect(headersMap.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");

    expect(headersMap.get('X-Frame-Options')).toBe('DENY');
    expect(headersMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headersMap.get('X-XSS-Protection')).toBe('1; mode=block');
    expect(headersMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});
