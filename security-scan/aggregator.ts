/**
 * Result Aggregator
 * 
 * Collects and normalizes outputs from multiple security scanners,
 * deduplicates findings, and calculates aggregate statistics.
 */

import type {
  Vulnerability,
  VulnerabilitySummary,
  ScanResult,
  ScannedComponents,
  ScanStatus,
} from "./types";

/**
 * Creates an empty vulnerability summary
 */
function createEmptySummary(): VulnerabilitySummary {
  return {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
}

/**
 * Generates a unique key for a vulnerability to enable deduplication
 */
function getVulnerabilityKey(vuln: Vulnerability): string {
  const parts = [
    vuln.source,
    vuln.severity,
    vuln.title,
    vuln.location.file || "",
    vuln.location.line?.toString() || "",
    vuln.location.package || "",
    vuln.metadata.cve || "",
    vuln.metadata.cwe || "",
  ];
  return parts.join("|");
}

/**
 * Deduplicates vulnerabilities based on their key characteristics
 */
function deduplicateVulnerabilities(
  vulnerabilities: Vulnerability[],
): Vulnerability[] {
  const seen = new Map<string, Vulnerability>();

  for (const vuln of vulnerabilities) {
    const key = getVulnerabilityKey(vuln);
    if (!seen.has(key)) {
      seen.set(key, vuln);
    }
  }

  return Array.from(seen.values());
}

/**
 * Calculates summary statistics from a list of vulnerabilities
 */
function calculateSummary(
  vulnerabilities: Vulnerability[],
): VulnerabilitySummary {
  const summary = createEmptySummary();

  for (const vuln of vulnerabilities) {
    summary.total++;
    switch (vuln.severity) {
      case "critical":
        summary.critical++;
        break;
      case "high":
        summary.high++;
        break;
      case "medium":
        summary.medium++;
        break;
      case "low":
        summary.low++;
        break;
      case "info":
        summary.info++;
        break;
    }
  }

  return summary;
}

/**
 * Determines the overall scan status based on vulnerability severity
 * - fail: if any critical or high severity vulnerabilities found
 * - pass: if only medium, low, or info vulnerabilities found (or none)
 */
function determineScanStatus(summary: VulnerabilitySummary): ScanStatus {
  if (summary.critical > 0 || summary.high > 0) {
    return "fail";
  }
  return "pass";
}

/**
 * Aggregates results from multiple scanners into a single scan result
 * 
 * @param vulnerabilities - Array of vulnerabilities from all scanners
 * @param scannedComponents - Which components were scanned
 * @param scanDuration - Total scan duration in milliseconds
 * @param failureReason - Optional reason if scan encountered errors
 * @returns Complete scan result with deduplicated vulnerabilities and statistics
 */
export function aggregateResults(
  vulnerabilities: Vulnerability[],
  scannedComponents: ScannedComponents,
  scanDuration: number,
  failureReason?: string,
): ScanResult {
  // Deduplicate vulnerabilities
  const deduplicated = deduplicateVulnerabilities(vulnerabilities);

  // Calculate summary statistics
  const summary = calculateSummary(deduplicated);

  // Determine overall status
  const status = failureReason ? "error" : determineScanStatus(summary);

  return {
    timestamp: new Date().toISOString(),
    scanDuration,
    scannedComponents,
    summary,
    vulnerabilities: deduplicated,
    status,
    failureReason,
  };
}

/**
 * Merges multiple partial scan results into a single result
 * Useful when some scanners fail but others succeed
 */
export function mergePartialResults(
  partialResults: ScanResult[],
): ScanResult {
  const allVulnerabilities: Vulnerability[] = [];
  const scannedComponents: ScannedComponents = {
    frontend: false,
    backend: false,
    contracts: false,
  };
  let totalDuration = 0;
  const failureReasons: string[] = [];

  for (const result of partialResults) {
    allVulnerabilities.push(...result.vulnerabilities);
    scannedComponents.frontend =
      scannedComponents.frontend || result.scannedComponents.frontend;
    scannedComponents.backend =
      scannedComponents.backend || result.scannedComponents.backend;
    scannedComponents.contracts =
      scannedComponents.contracts || result.scannedComponents.contracts;
    totalDuration = Math.max(totalDuration, result.scanDuration);
    if (result.failureReason) {
      failureReasons.push(result.failureReason);
    }
  }

  const failureReason =
    failureReasons.length > 0 ? failureReasons.join("; ") : undefined;

  return aggregateResults(
    allVulnerabilities,
    scannedComponents,
    totalDuration,
    failureReason,
  );
}
