/**
 * Security Scan Orchestrator
 * 
 * Coordinates execution of all security scanning components and aggregates results.
 * Manages parallel execution, timeouts, and error handling.
 */

import { scanAllNpmProjects } from "./scanners/npm-audit";
import { scanAllCargoProjects } from "./scanners/cargo-audit";
import { scanAllWithESLint } from "./scanners/eslint-scanner";
import { scanAllWithSemgrep } from "./scanners/semgrep-scanner";
import { scanForSecrets } from "./scanners/gitleaks-scanner";
import { aggregateResults } from "./aggregator";
import type { Vulnerability, ScanResult, ScannedComponents } from "./types";

/**
 * Scanner execution result
 */
interface ScannerResult {
  name: string;
  vulnerabilities: Vulnerability[];
  error?: string;
  duration: number;
}

/**
 * Executes a scanner with timeout and error handling
 */
async function executeScannerWithTimeout(
  name: string,
  scannerFn: () => Vulnerability[],
  timeoutMs: number,
): Promise<ScannerResult> {
  const startTime = Date.now();

  try {
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Scanner timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    // Create a promise that resolves with scanner results
    const scanPromise = new Promise<Vulnerability[]>((resolve) => {
      resolve(scannerFn());
    });

    // Race between scanner and timeout
    const vulnerabilities = await Promise.race([scanPromise, timeoutPromise]);
    const duration = Date.now() - startTime;

    return {
      name,
      vulnerabilities,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`Scanner ${name} failed: ${error.message}`);

    return {
      name,
      vulnerabilities: [],
      error: error.message,
      duration,
    };
  }
}

/**
 * Determines which components were successfully scanned
 */
function determineScannedComponents(
  scannerResults: ScannerResult[],
): ScannedComponents {
  const components: ScannedComponents = {
    frontend: false,
    backend: false,
    contracts: false,
  };

  for (const result of scannerResults) {
    if (!result.error) {
      if (result.name.includes("npm")) {
        components.frontend = true;
        components.backend = true;
      }
      if (result.name.includes("cargo")) {
        components.contracts = true;
      }
      if (result.name.includes("eslint") || result.name.includes("semgrep")) {
        components.frontend = true;
        components.backend = true;
        components.contracts = true;
      }
    }
  }

  return components;
}

/**
 * Main orchestrator function that coordinates all security scans
 * 
 * @param repoRoot - Root directory of the repository
 * @param modifiedFiles - Optional array of modified files (for PR context)
 * @returns Complete scan result with all findings
 */
export async function runSecurityScan(
  repoRoot: string,
  modifiedFiles?: string[],
): Promise<ScanResult> {
  const overallStartTime = Date.now();
  const SCANNER_TIMEOUT = 2 * 60 * 1000; // 2 minutes per scanner
  const OVERALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes overall

  console.log("Starting security scan orchestrator...");
  console.log(`Repository root: ${repoRoot}`);
  if (modifiedFiles) {
    console.log(`Scanning ${modifiedFiles.length} modified files`);
  }

  try {
    // Execute all scanners in parallel with individual timeouts
    const scannerPromises = [
      executeScannerWithTimeout(
        "npm-audit",
        () => scanAllNpmProjects(repoRoot),
        SCANNER_TIMEOUT,
      ),
      executeScannerWithTimeout(
        "cargo-audit",
        () => scanAllCargoProjects(repoRoot),
        SCANNER_TIMEOUT,
      ),
      executeScannerWithTimeout(
        "eslint",
        () => scanAllWithESLint(repoRoot, modifiedFiles),
        SCANNER_TIMEOUT,
      ),
      executeScannerWithTimeout(
        "semgrep",
        () => scanAllWithSemgrep(repoRoot, modifiedFiles),
        SCANNER_TIMEOUT,
      ),
      executeScannerWithTimeout(
        "gitleaks",
        () => scanForSecrets(repoRoot),
        SCANNER_TIMEOUT,
      ),
    ];

    // Create overall timeout
    const overallTimeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Overall scan timeout after ${OVERALL_TIMEOUT}ms`)),
        OVERALL_TIMEOUT,
      );
    });

    // Race between all scanners completing and overall timeout
    const scannerResults = await Promise.race([
      Promise.all(scannerPromises),
      overallTimeoutPromise,
    ]);

    // Collect all vulnerabilities
    const allVulnerabilities: Vulnerability[] = [];
    const failedScanners: string[] = [];

    for (const result of scannerResults) {
      console.log(
        `Scanner ${result.name}: ${result.vulnerabilities.length} vulnerabilities found in ${result.duration}ms`,
      );

      if (result.error) {
        failedScanners.push(`${result.name}: ${result.error}`);
      } else {
        allVulnerabilities.push(...result.vulnerabilities);
      }
    }

    // Determine which components were scanned
    const scannedComponents = determineScannedComponents(scannerResults);

    // Calculate total duration
    const scanDuration = Date.now() - overallStartTime;

    // Generate failure reason if any scanners failed
    const failureReason =
      failedScanners.length > 0
        ? `Some scanners failed: ${failedScanners.join("; ")}`
        : undefined;

    // Aggregate results
    const result = aggregateResults(
      allVulnerabilities,
      scannedComponents,
      scanDuration,
      failureReason,
    );

    console.log(`\nScan complete in ${scanDuration}ms`);
    console.log(`Total vulnerabilities: ${result.summary.total}`);
    console.log(`  Critical: ${result.summary.critical}`);
    console.log(`  High: ${result.summary.high}`);
    console.log(`  Medium: ${result.summary.medium}`);
    console.log(`  Low: ${result.summary.low}`);
    console.log(`  Info: ${result.summary.info}`);
    console.log(`Status: ${result.status}`);

    return result;
  } catch (error: any) {
    const scanDuration = Date.now() - overallStartTime;

    console.error(`Security scan orchestrator failed: ${error.message}`);

    // Return error result
    return aggregateResults(
      [],
      { frontend: false, backend: false, contracts: false },
      scanDuration,
      `Orchestrator error: ${error.message}`,
    );
  }
}

/**
 * CLI entry point for the orchestrator
 */
export async function main() {
  const repoRoot = process.cwd();
  const modifiedFilesArg = process.env.MODIFIED_FILES;
  const modifiedFiles = modifiedFilesArg ? modifiedFilesArg.split(",") : undefined;
  const testMode = process.env.TEST_MODE === "true" || process.argv.includes("--test-mode");

  if (testMode) {
    console.log("🧪 Running in TEST MODE - results will not block PRs");
  }

  const result = await runSecurityScan(repoRoot, modifiedFiles);

  // Write result to file for GitHub Actions to consume
  const fs = require("fs");
  fs.writeFileSync(
    "security-scan-results.json",
    JSON.stringify(result, null, 2),
  );

  // In test mode, always exit successfully
  if (testMode) {
    console.log("\n✅ Test mode complete - scan results saved but not enforced");
    process.exit(0);
  }

  // Exit with appropriate code
  if (result.status === "fail") {
    console.error("\n❌ Security scan failed - critical or high vulnerabilities detected");
    process.exit(1);
  } else if (result.status === "error") {
    console.error("\n⚠️  Security scan encountered errors");
    process.exit(0); // Don't block merge on scanner errors
  } else {
    console.log("\n✅ Security scan passed");
    process.exit(0);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
