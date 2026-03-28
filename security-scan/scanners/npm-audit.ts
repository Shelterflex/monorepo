/**
 * NPM Audit Scanner
 * 
 * Wraps npm audit to scan Node.js dependencies for known vulnerabilities.
 * Parses npm audit JSON output and normalizes it into the common vulnerability schema.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Vulnerability } from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * NPM Audit JSON output structure (simplified)
 */
interface NpmAuditVulnerability {
  name: string;
  severity: string;
  via: Array<{
    title?: string;
    url?: string;
    source?: number;
    name?: string;
    dependency?: string;
    title?: string;
    url?: string;
    severity?: string;
    cwe?: string[];
    cvss?: {
      score: number;
    };
    range?: string;
  }>;
  effects?: string[];
  range?: string;
  nodes?: string[];
  fixAvailable?: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

interface NpmAuditOutput {
  vulnerabilities: Record<string, NpmAuditVulnerability>;
  metadata: {
    vulnerabilities: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      total: number;
    };
  };
}

/**
 * Maps npm audit severity to our normalized severity
 */
function mapSeverity(npmSeverity: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (npmSeverity.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "medium";
    case "low":
      return "low";
    case "info":
      return "info";
    default:
      return "info";
  }
}

/**
 * Extracts CVE identifier from vulnerability data
 */
function extractCVE(via: NpmAuditVulnerability["via"]): string | undefined {
  for (const item of via) {
    if (typeof item === "object" && item.url) {
      const cveMatch = item.url.match(/CVE-\d{4}-\d+/);
      if (cveMatch) {
        return cveMatch[0];
      }
    }
  }
  return undefined;
}

/**
 * Extracts CWE identifiers from vulnerability data
 */
function extractCWE(via: NpmAuditVulnerability["via"]): string | undefined {
  for (const item of via) {
    if (typeof item === "object" && item.cwe && item.cwe.length > 0) {
      return item.cwe[0];
    }
  }
  return undefined;
}

/**
 * Extracts CVSS score from vulnerability data
 */
function extractCVSS(via: NpmAuditVulnerability["via"]): number | undefined {
  for (const item of via) {
    if (typeof item === "object" && item.cvss) {
      return item.cvss.score;
    }
  }
  return undefined;
}

/**
 * Extracts reference URLs from vulnerability data
 */
function extractReferences(via: NpmAuditVulnerability["via"]): string[] {
  const refs: string[] = [];
  for (const item of via) {
    if (typeof item === "object" && item.url) {
      refs.push(item.url);
    }
  }
  return refs;
}

/**
 * Extracts title/description from vulnerability data
 */
function extractTitle(via: NpmAuditVulnerability["via"]): string {
  for (const item of via) {
    if (typeof item === "object" && item.title) {
      return item.title;
    }
  }
  return "Dependency vulnerability";
}

/**
 * Extracts fixed version from fixAvailable field
 */
function extractFixedVersion(fixAvailable: NpmAuditVulnerability["fixAvailable"]): string | undefined {
  if (typeof fixAvailable === "object" && fixAvailable.version) {
    return fixAvailable.version;
  }
  return undefined;
}

/**
 * Converts npm audit vulnerability to normalized vulnerability schema
 */
function convertNpmVulnerability(
  packageName: string,
  npmVuln: NpmAuditVulnerability,
): Vulnerability {
  const cve = extractCVE(npmVuln.via);
  const cwe = extractCWE(npmVuln.via);
  const cvss = extractCVSS(npmVuln.via);
  const references = extractReferences(npmVuln.via);
  const title = extractTitle(npmVuln.via);
  const fixedVersion = extractFixedVersion(npmVuln.fixAvailable);

  return {
    id: uuidv4(),
    source: "dependency",
    severity: mapSeverity(npmVuln.severity),
    title: `${packageName}: ${title}`,
    description: `Vulnerability found in ${packageName}. ${title}`,
    location: {
      package: packageName,
      version: npmVuln.range || "unknown",
    },
    metadata: {
      cve,
      cwe,
      cvss,
      references,
    },
    remediation: fixedVersion
      ? `Update ${packageName} to version ${fixedVersion} or later`
      : `Review and update ${packageName} to a secure version`,
    fixedVersion,
  };
}

/**
 * Runs npm audit on a specific directory and returns vulnerabilities
 * 
 * @param projectPath - Path to the project directory containing package-lock.json
 * @returns Array of normalized vulnerabilities
 */
export function scanNpmDependencies(projectPath: string): Vulnerability[] {
  const packageLockPath = join(projectPath, "package-lock.json");

  // Check if package-lock.json exists
  if (!existsSync(packageLockPath)) {
    console.warn(`No package-lock.json found in ${projectPath}, skipping npm audit`);
    return [];
  }

  try {
    // Run npm audit with JSON output
    // Note: npm audit returns non-zero exit code when vulnerabilities are found
    // We use try-catch to handle this and still parse the output
    const output = execSync("npm audit --json", {
      cwd: projectPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const auditResult: NpmAuditOutput = JSON.parse(output);
    const vulnerabilities: Vulnerability[] = [];

    // Convert each vulnerability to our schema
    for (const [packageName, npmVuln] of Object.entries(auditResult.vulnerabilities)) {
      vulnerabilities.push(convertNpmVulnerability(packageName, npmVuln));
    }

    return vulnerabilities;
  } catch (error: any) {
    // npm audit returns exit code 1 when vulnerabilities are found
    // We still want to parse the output in this case
    if (error.stdout) {
      try {
        const auditResult: NpmAuditOutput = JSON.parse(error.stdout);
        const vulnerabilities: Vulnerability[] = [];

        for (const [packageName, npmVuln] of Object.entries(auditResult.vulnerabilities)) {
          vulnerabilities.push(convertNpmVulnerability(packageName, npmVuln));
        }

        return vulnerabilities;
      } catch (parseError) {
        console.error(`Failed to parse npm audit output: ${parseError}`);
        return [];
      }
    }

    console.error(`npm audit failed: ${error.message}`);
    return [];
  }
}

/**
 * Scans both frontend and backend directories for npm vulnerabilities
 * 
 * @param repoRoot - Root directory of the repository
 * @returns Array of all vulnerabilities found in frontend and backend
 */
export function scanAllNpmProjects(repoRoot: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  // Scan frontend
  const frontendPath = join(repoRoot, "frontend");
  if (existsSync(frontendPath)) {
    console.log("Scanning frontend dependencies...");
    vulnerabilities.push(...scanNpmDependencies(frontendPath));
  }

  // Scan backend
  const backendPath = join(repoRoot, "backend");
  if (existsSync(backendPath)) {
    console.log("Scanning backend dependencies...");
    vulnerabilities.push(...scanNpmDependencies(backendPath));
  }

  return vulnerabilities;
}
