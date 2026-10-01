import { URL } from 'node:url'

// Private IP ranges (IPv4)
const PRIVATE_IP_RANGES = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^127\./,                    // 127.0.0.0/8 (loopback)
  /^0\./,                      // 0.0.0.0/8
  /^169\.254\./,               // 169.254.0.0/16 (link-local)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./,  // 100.64.0.0/10 (carrier-grade NAT)
  /^192\.0\.0\./,              // 192.0.0.0/24 (IETF Protocol Assignments)
  /^192\.0\.2\./,              // 192.0.2.0/24 (TEST-NET-1)
  /^198\.51\.100\./,           // 198.51.100.0/24 (TEST-NET-2)
  /^203\.0\.113\./,            // 203.0.113.0/24 (TEST-NET-3)
  /^224\./,                    // 224.0.0.0/4 (multicast)
  /^240\./,                    // 240.0.0.0/4 (reserved)
  /^255\.255\.255\.255/,       // broadcast
]

// Localhost hostnames
const LOCALHOST_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]

/**
 * Validates that a URL is not pointing to a private/internal IP address.
 * Throws an error if the URL is invalid or points to a restricted address.
 */
export function validateUrlForSSRF(urlString: string): void {
  let url: URL

  try {
    url = new URL(urlString)
  } catch (error) {
    throw new Error('Invalid URL format')
  }

  // Only allow HTTPS
  if (url.protocol !== 'https:') {
    throw new Error('URL must use HTTPS protocol')
  }

  const hostname = url.hostname.toLowerCase()

  // Block localhost hostnames
  if (LOCALHOST_HOSTNAMES.includes(hostname)) {
    throw new Error('URL cannot point to localhost')
  }

  // Block IP addresses
  const ipMatch = hostname.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (ipMatch) {
    const ip = ipMatch[1]
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(ip)) {
        throw new Error('URL cannot point to private IP addresses')
      }
    }
  }

  // Block IPv6 addresses (simplified - block all for safety)
  if (hostname.includes(':')) {
    throw new Error('IPv6 addresses are not supported')
  }

  // Block non-fully qualified domain names (no dots in hostname, not localhost)
  if (!hostname.includes('.') && !LOCALHOST_HOSTNAMES.includes(hostname)) {
    throw new Error('URL must use a fully qualified domain name')
  }
}

/**
 * Re-validates a URL at delivery time to ensure it hasn't been changed
 * to point to a restricted address. Returns true if valid, false otherwise.
 */
export function revalidateUrlForSSRF(urlString: string): boolean {
  try {
    validateUrlForSSRF(urlString)
    return true
  } catch {
    return false
  }
}
