/**
 * Cargo Audit Scanner
 * 
 * Wraps cargo audit to scan Rust dependencies for known vulnerabilities.
 * Parses cargo audit JSON output and normalizes it into the common vulnerability schema.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Vulnerability } from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * Cargo Audit JSON output structure (simplified)
 */
interface CargoAuditAdvisory {
  id: string; // RUSTSEC-YYYY-NNNN
  package: string;
  title: string;
  description: string;
  date: string;
  aliases: string[]; // CVE identifiers
  cvss?: string; // CVSS vector string
  keywords: string[];
  url: string;
}

interface CargoAuditVulnerability {
  advisory: CargoAuditAdvisory;
  versions: {
    patched: string[];
    unaffected: string[];
  };
  affected: {
    arch: string[];
    os: string[];
    functions: Record<string, string[]>;
  };
  package: {
    name: string;
    version: string;
    source: string;
    checksum: string;
    dependencies: any[];
    replace: any;
  };
}

interface CargoAuditOutput {
  database: {
    advisory_count: number;
    last_commit: string;
    last_updated: string;
  };
  lockfile: {
    dependency_count: number;
  };
  vulnerabilities: {
    count: number;
    found: boolean;
    list: CargoAuditVulnerability[];
  };
  warnings: {
    count: number;
    list: any[];
  };
}

/**
 * Extracts CVE identifier from advisory aliases
 */
function extractCVE(aliases: string[]): string | undefined {
  for (const alias of aliases) {
    if (alias.startsWith("CVE-")) {
      return alias;
    }
  }
  return undefined;
}

/**
 * Parses CVSS score from CVSS vector string
 * Example: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
 */
function parseCVSSScore(cvssVector?: string): number | undefined {
  if (!cvssVector) return undefined;

  // Extract base score from CVSS vector
  // This is a simplified extraction - in production, use a proper CVSS parser
  const match = cvssVector.match(/CVSS:(\d+\.\d+)/);
  if (match) {
    return parseFloat(match[1]);
  }

  // If no explicit score, estimate from metrics
  // This is a rough approximation
  if (cvssVector.includes("C:H") && cvssVector.includes("I:H") && cvssVector.includes("A:H")) {
    return 9.0; // Critical
  } else if (cvssVector.includes("C:H") || cvssVector.includes("I:H") || cvssVector.includes("A:H")) {
    return 7.5; // High
  } else if (cvssVector.includes("C:L") || cvssVector.includes("I:L") || cvssVector.includes("A:L")) {
    return 5.0; // Medium
  }

  return undefined;
}

/**
 * Determines severity based on CVSS score or keywords
 */
function determineSeverity(
  cvss?: number,
  keywords?: string[],
): "critical" | "high" | "medium" | "low" | "info" {
  if (cvss !== undefined) {
    if (cvss >= 9.0) return "critical";
    if (cvss >= 7.0) return "high";
    if (cvss >= 4.0) return "medium";
    if (cvss >= 0.1) return "low";
    return "info";
  }

  // Fallback to keyword-based severity
  if (keywords) {
    const keywordStr = keywords.join(" ").toLowerCase();
    if (keywordStr.includes("critical") || keywordStr.includes("rce")) {
      return "critical";
    }
    if (keywordStr.includes("high") || keywordStr.includes("exploit")) {
      return "high";
    }
    if (keywordStr.includes("medium") || keywordStr.includes("moderate")) {
      return "medium";
    }
  }

  return "medium"; // Default to medium if unknown
}

/**
 * Extracts fixed version from patched versions list
 */
function extractFixedVersion(patchedVersions: string[]): string | undefined {
  if (patchedVersions.length === 0) return undefined;

  // Return the first patched version as the recommended fix
  // In production, you might want to find the minimum patched version
  return patchedVersions[0];
}

/**
 * Converts cargo audit vulnerability to normalized vulnerability schema
 */
function convertCargoVulnerability(cargoVuln: CargoAuditVulnerability): Vulnerability {
  const { advisory, versions, package: pkg } = cargoVuln;
  const cve = extractCVE(advisory.aliases);
  const cvss = parseCVSSScore(advisory.cvss);
  const severity = determineSeverity(cvss, advisory.keywords);
  const fixedVersion = extractFixedVersion(versions.patched);

  return {
    id: uuidv4(),
    source: "dependency",
    severity,
    title: `${pkg.name}: ${advisory.title}`,
    description: advisory.description,
    location: {
      package: pkg.name,
      version: pkg.version,
    },
    metadata: {
      cve,
      cvss,
      references: [advisory.url],
    },
    remediation: fixedVersion
      ? `Update ${pkg.name} to version ${fixedVersion} or later`
      : `Review ${advisory.url} for remediation guidance`,
    fixedVersion,
  };
}

/**
 * Runs cargo audit on the contracts directory and returns vulnerabilities
 * 
 * @param contractsPath - Path to the contracts directory containing Cargo.lock
 * @returns Array of normalized vulnerabilities
 */
export function scanCargoDependencies(contractsPath: string): Vulnerability[] {
  const cargoLockPath = join(contractsPath, "Cargo.lock");

  // Check if Cargo.lock exists
  if (!existsSync(cargoLockPath)) {
    console.warn(`No Cargo.lock found in ${contractsPath}, skipping cargo audit`);
    return [];
  }

  try {
    // Run cargo audit with JSON output
    const output = execSync("cargo audit --json", {
      cwd: contractsPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const auditResult: CargoAuditOutput = JSON.parse(output);
    const vulnerabilities: Vulnerability[] = [];

    // Convert each vulnerability to our schema
    if (auditResult.vulnerabilities.found) {
      for (const cargoVuln of auditResult.vulnerabilities.list) {
        vulnerabilities.push(convertCargoVulnerability(cargoVuln));
      }
    }

    return vulnerabilities;
  } catch (error: any) {
    // cargo audit returns non-zero exit code when vulnerabilities are found
    // We still want to parse the output in this case
    if (error.stdout) {
      try {
        const auditResult: CargoAuditOutput = JSON.parse(error.stdout);
        const vulnerabilities: Vulnerability[] = [];

        if (auditResult.vulnerabilities.found) {
          for (const cargoVuln of auditResult.vulnerabilities.list) {
            vulnerabilities.push(convertCargoVulnerability(cargoVuln));
          }
        }

        return vulnerabilities;
      } catch (parseError) {
        console.error(`Failed to parse cargo audit output: ${parseError}`);
        return [];
      }
    }

    console.error(`cargo audit failed: ${error.message}`);
    return [];
  }
}

/**
 * Scans the contracts directory for cargo vulnerabilities
 * 
 * @param repoRoot - Root directory of the repository
 * @returns Array of all vulnerabilities found in contracts
 */
export function scanAllCargoProjects(repoRoot: string): Vulnerability[] {
  const contractsPath = join(repoRoot, "contracts");

  if (!existsSync(contractsPath)) {
    console.warn("No contracts directory found, skipping cargo audit");
    return [];
  }

  console.log("Scanning Rust contract dependencies...");
  return scanCargoDependencies(contractsPath);
}
