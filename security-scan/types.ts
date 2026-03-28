/**
 * Security Scanning Type Definitions
 * 
 * This module defines the core data structures for the automated security scanning system.
 * All scanner outputs are normalized into these common interfaces for consistent reporting.
 */

/**
 * Source of the vulnerability detection
 */
export type VulnerabilitySource = "dependency" | "code" | "secret";

/**
 * Severity classification based on CVSS scoring
 * - critical: CVSS 9.0-10.0 (RCE, auth bypass)
 * - high: CVSS 7.0-8.9 (privilege escalation, data exposure)
 * - medium: CVSS 4.0-6.9 (information disclosure, DoS)
 * - low: CVSS 0.1-3.9 (minor issues, best practices)
 * - info: CVSS 0.0 (informational findings)
 */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/**
 * Location information for a vulnerability
 */
export interface VulnerabilityLocation {
  /** File path relative to repository root (for code/secret vulnerabilities) */
  file?: string;
  /** Line number in the file (for code/secret vulnerabilities) */
  line?: number;
  /** Column number in the file (for code vulnerabilities) */
  column?: number;
  /** Package name (for dependency vulnerabilities) */
  package?: string;
  /** Installed version (for dependency vulnerabilities) */
  version?: string;
}

/**
 * Metadata about the vulnerability
 */
export interface VulnerabilityMetadata {
  /** CVE identifier (e.g., CVE-2021-44228) */
  cve?: string;
  /** CWE identifier (e.g., CWE-79 for XSS) */
  cwe?: string;
  /** CVSS score (0-10) */
  cvss?: number;
  /** URLs to advisories, documentation, or references */
  references?: string[];
}

/**
 * A single security vulnerability finding
 */
export interface Vulnerability {
  /** Unique identifier for this finding */
  id: string;
  /** Source of the vulnerability detection */
  source: VulnerabilitySource;
  /** Severity classification */
  severity: Severity;
  /** Short description of the vulnerability */
  title: string;
  /** Detailed explanation of the issue */
  description: string;
  /** Location information */
  location: VulnerabilityLocation;
  /** Additional metadata */
  metadata: VulnerabilityMetadata;
  /** How to fix the issue */
  remediation: string;
  /** Version that fixes the issue (for dependency vulnerabilities) */
  fixedVersion?: string;
}

/**
 * Components that were scanned
 */
export interface ScannedComponents {
  frontend: boolean;
  backend: boolean;
  contracts: boolean;
}

/**
 * Summary statistics of vulnerabilities by severity
 */
export interface VulnerabilitySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/**
 * Overall scan status
 */
export type ScanStatus = "pass" | "fail" | "error";

/**
 * Complete scan result containing all findings
 */
export interface ScanResult {
  /** ISO 8601 timestamp when scan completed */
  timestamp: string;
  /** Scan duration in milliseconds */
  scanDuration: number;
  /** Which components were scanned */
  scannedComponents: ScannedComponents;
  /** Summary statistics */
  summary: VulnerabilitySummary;
  /** All detected vulnerabilities */
  vulnerabilities: Vulnerability[];
  /** Overall scan status */
  status: ScanStatus;
  /** Reason for failure or error (if applicable) */
  failureReason?: string;
}
