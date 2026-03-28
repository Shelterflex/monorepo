/**
 * Semgrep Security Scanner
 * 
 * Wraps Semgrep to scan code for security vulnerabilities using pattern matching.
 * Parses Semgrep JSON output and normalizes it into the common vulnerability schema.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Vulnerability } from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * Semgrep JSON output structure
 */
interface SemgrepMatch {
  check_id: string;
  path: string;
  start: {
    line: number;
    col: number;
  };
  end: {
    line: number;
    col: number;
  };
  extra: {
    message: string;
    severity: string;
    metadata: {
      cwe?: string;
      owasp?: string;
      category?: string;
      confidence?: string;
    };
    lines: string;
  };
}

interface SemgrepOutput {
  results: SemgrepMatch[];
  errors: any[];
}

/**
 * Maps Semgrep severity to our normalized severity
 */
function mapSeverity(semgrepSeverity: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (semgrepSeverity.toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "medium";
  }
}

/**
 * Converts Semgrep match to normalized vulnerability schema
 */
function convertSemgrepMatch(match: SemgrepMatch, repoRoot: string): Vulnerability {
  // Make file path relative to repo root
  const relativePath = match.path.startsWith(repoRoot)
    ? match.path.substring(repoRoot.length + 1)
    : match.path;

  const severity = mapSeverity(match.extra.severity);
  const cwe = match.extra.metadata.cwe;
  const owasp = match.extra.metadata.owasp;

  return {
    id: uuidv4(),
    source: "code",
    severity,
    title: `${match.check_id}: ${match.extra.message}`,
    description: `Security issue detected by Semgrep: ${match.extra.message}`,
    location: {
      file: relativePath,
      line: match.start.line,
      column: match.start.col,
    },
    metadata: {
      cwe,
      references: owasp ? [`OWASP: ${owasp}`] : [],
    },
    remediation: match.extra.message,
  };
}

/**
 * Runs Semgrep on specified path and returns security vulnerabilities
 * 
 * @param scanPath - Path to scan (directory or file)
 * @param configPath - Path to Semgrep configuration file
 * @param repoRoot - Root directory of the repository
 * @returns Array of normalized vulnerabilities
 */
export function scanWithSemgrep(
  scanPath: string,
  configPath: string,
  repoRoot: string,
): Vulnerability[] {
  if (!existsSync(scanPath)) {
    console.warn(`Path ${scanPath} does not exist, skipping Semgrep scan`);
    return [];
  }

  if (!existsSync(configPath)) {
    console.warn(`Semgrep config ${configPath} not found, skipping Semgrep scan`);
    return [];
  }

  try {
    // Run Semgrep with custom configuration
    const output = execSync(
      `semgrep --config ${configPath} --json --quiet ${scanPath}`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const semgrepResult: SemgrepOutput = JSON.parse(output);
    const vulnerabilities: Vulnerability[] = [];

    // Convert each match to our schema
    for (const match of semgrepResult.results) {
      vulnerabilities.push(convertSemgrepMatch(match, repoRoot));
    }

    // Log any errors from Semgrep
    if (semgrepResult.errors.length > 0) {
      console.warn(`Semgrep reported ${semgrepResult.errors.length} errors`);
    }

    return vulnerabilities;
  } catch (error: any) {
    // Semgrep returns non-zero exit code when findings are detected
    // We still want to parse the output in this case
    if (error.stdout) {
      try {
        const semgrepResult: SemgrepOutput = JSON.parse(error.stdout);
        const vulnerabilities: Vulnerability[] = [];

        for (const match of semgrepResult.results) {
          vulnerabilities.push(convertSemgrepMatch(match, repoRoot));
        }

        return vulnerabilities;
      } catch (parseError) {
        console.error(`Failed to parse Semgrep output: ${parseError}`);
        return [];
      }
    }

    console.error(`Semgrep failed: ${error.message}`);
    return [];
  }
}

/**
 * Scans all projects with Semgrep
 * 
 * @param repoRoot - Root directory of the repository
 * @param modifiedFiles - Optional array of modified files to scan (for PR context)
 * @returns Array of all vulnerabilities found
 */
export function scanAllWithSemgrep(
  repoRoot: string,
  modifiedFiles?: string[],
): Vulnerability[] {
  const configPath = join(repoRoot, "semgrep.yml");
  const vulnerabilities: Vulnerability[] = [];

  // If modified files provided, scan only those
  if (modifiedFiles && modifiedFiles.length > 0) {
    const codeFiles = modifiedFiles.filter(
      (f) =>
        f.endsWith(".ts") ||
        f.endsWith(".tsx") ||
        f.endsWith(".js") ||
        f.endsWith(".jsx") ||
        f.endsWith(".rs"),
    );

    for (const file of codeFiles) {
      const filePath = join(repoRoot, file);
      if (existsSync(filePath)) {
        vulnerabilities.push(...scanWithSemgrep(filePath, configPath, repoRoot));
      }
    }

    return vulnerabilities;
  }

  // Otherwise scan all code directories
  const dirsToScan = ["frontend/src", "backend/src", "contracts"];

  for (const dir of dirsToScan) {
    const dirPath = join(repoRoot, dir);
    if (existsSync(dirPath)) {
      console.log(`Scanning ${dir} with Semgrep...`);
      vulnerabilities.push(...scanWithSemgrep(dirPath, configPath, repoRoot));
    }
  }

  return vulnerabilities;
}
