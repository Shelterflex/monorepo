/**
 * ESLint Security Scanner
 * 
 * Wraps ESLint with security plugins to scan TypeScript/JavaScript code for security vulnerabilities.
 * Parses ESLint JSON output and normalizes it into the common vulnerability schema.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Vulnerability } from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * ESLint JSON output structure
 */
interface ESLintMessage {
  ruleId: string | null;
  severity: number; // 1 = warning, 2 = error
  message: string;
  line: number;
  column: number;
  nodeType?: string;
  messageId?: string;
  endLine?: number;
  endColumn?: number;
}

interface ESLintResult {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  source?: string;
}

type ESLintOutput = ESLintResult[];

/**
 * Security-related ESLint rule prefixes
 */
const SECURITY_RULE_PREFIXES = [
  "security/",
  "@typescript-eslint/no-unsafe-",
  "no-eval",
  "no-implied-eval",
];

/**
 * Checks if an ESLint rule is security-related
 */
function isSecurityRule(ruleId: string | null): boolean {
  if (!ruleId) return false;

  return SECURITY_RULE_PREFIXES.some((prefix) => ruleId.startsWith(prefix));
}

/**
 * Maps ESLint severity to our normalized severity
 */
function mapSeverity(eslintSeverity: number, ruleId: string): "critical" | "high" | "medium" | "low" | "info" {
  // Critical security issues
  if (
    ruleId.includes("eval") ||
    ruleId.includes("child-process") ||
    ruleId.includes("non-literal-require")
  ) {
    return "high";
  }

  // High severity for errors
  if (eslintSeverity === 2) {
    return "medium";
  }

  // Medium/Low for warnings
  return "low";
}

/**
 * Extracts CWE from rule ID if available
 */
function extractCWE(ruleId: string): string | undefined {
  // Map common ESLint rules to CWE identifiers
  const cweMap: Record<string, string> = {
    "security/detect-object-injection": "CWE-94",
    "security/detect-non-literal-regexp": "CWE-185",
    "security/detect-non-literal-require": "CWE-829",
    "security/detect-non-literal-fs-filename": "CWE-73",
    "security/detect-eval-with-expression": "CWE-95",
    "security/detect-pseudoRandomBytes": "CWE-338",
    "security/detect-possible-timing-attacks": "CWE-208",
    "security/detect-no-csrf-before-method-override": "CWE-352",
    "security/detect-unsafe-regex": "CWE-1333",
  };

  return cweMap[ruleId];
}

/**
 * Generates remediation guidance based on rule ID
 */
function generateRemediation(ruleId: string, message: string): string {
  const remediationMap: Record<string, string> = {
    "security/detect-object-injection": "Validate and sanitize object keys before use",
    "security/detect-non-literal-regexp": "Use literal regular expressions or validate input",
    "security/detect-non-literal-require": "Use static imports or whitelist allowed modules",
    "security/detect-non-literal-fs-filename": "Validate and sanitize file paths, use path.join()",
    "security/detect-eval-with-expression": "Avoid eval(), use safer alternatives like JSON.parse()",
    "security/detect-pseudoRandomBytes": "Use crypto.randomBytes() for security-sensitive operations",
    "security/detect-possible-timing-attacks": "Use constant-time comparison functions",
    "security/detect-no-csrf-before-method-override": "Ensure CSRF protection is enabled before method override",
    "security/detect-unsafe-regex": "Review regex for ReDoS vulnerabilities, simplify pattern",
  };

  return remediationMap[ruleId] || `Review and fix: ${message}`;
}

/**
 * Converts ESLint message to normalized vulnerability schema
 */
function convertESLintMessage(
  filePath: string,
  message: ESLintMessage,
  repoRoot: string,
): Vulnerability | null {
  if (!message.ruleId || !isSecurityRule(message.ruleId)) {
    return null;
  }

  // Make file path relative to repo root
  const relativePath = filePath.startsWith(repoRoot)
    ? filePath.substring(repoRoot.length + 1)
    : filePath;

  const severity = mapSeverity(message.severity, message.ruleId);
  const cwe = extractCWE(message.ruleId);
  const remediation = generateRemediation(message.ruleId, message.message);

  return {
    id: uuidv4(),
    source: "code",
    severity,
    title: `${message.ruleId}: ${message.message}`,
    description: `Security issue detected by ESLint: ${message.message}`,
    location: {
      file: relativePath,
      line: message.line,
      column: message.column,
    },
    metadata: {
      cwe,
      references: [
        `https://github.com/eslint-community/eslint-plugin-security/blob/main/docs/rules/${message.ruleId.replace("security/", "")}.md`,
      ],
    },
    remediation,
  };
}

/**
 * Runs ESLint on specified files and returns security vulnerabilities
 * 
 * @param projectPath - Path to the project directory
 * @param files - Array of file paths to scan (relative to projectPath)
 * @param repoRoot - Root directory of the repository
 * @returns Array of normalized vulnerabilities
 */
export function scanWithESLint(
  projectPath: string,
  files: string[],
  repoRoot: string,
): Vulnerability[] {
  if (files.length === 0) {
    console.log("No files to scan with ESLint");
    return [];
  }

  try {
    // Run ESLint with security configuration
    const configPath = join(repoRoot, ".eslintrc.security.js");
    const filesArg = files.join(" ");

    const output = execSync(
      `npx eslint --config ${configPath} --format json ${filesArg}`,
      {
        cwd: projectPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const eslintResults: ESLintOutput = JSON.parse(output);
    const vulnerabilities: Vulnerability[] = [];

    // Convert each security-related message to our schema
    for (const result of eslintResults) {
      for (const message of result.messages) {
        const vuln = convertESLintMessage(result.filePath, message, repoRoot);
        if (vuln) {
          vulnerabilities.push(vuln);
        }
      }
    }

    return vulnerabilities;
  } catch (error: any) {
    // ESLint returns non-zero exit code when issues are found
    // We still want to parse the output in this case
    if (error.stdout) {
      try {
        const eslintResults: ESLintOutput = JSON.parse(error.stdout);
        const vulnerabilities: Vulnerability[] = [];

        for (const result of eslintResults) {
          for (const message of result.messages) {
            const vuln = convertESLintMessage(result.filePath, message, repoRoot);
            if (vuln) {
              vulnerabilities.push(vuln);
            }
          }
        }

        return vulnerabilities;
      } catch (parseError) {
        console.error(`Failed to parse ESLint output: ${parseError}`);
        return [];
      }
    }

    console.error(`ESLint failed: ${error.message}`);
    return [];
  }
}

/**
 * Scans all TypeScript/JavaScript files in frontend and backend
 * 
 * @param repoRoot - Root directory of the repository
 * @param modifiedFiles - Optional array of modified files to scan (for PR context)
 * @returns Array of all vulnerabilities found
 */
export function scanAllWithESLint(
  repoRoot: string,
  modifiedFiles?: string[],
): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];

  // If modified files provided, scan only those
  if (modifiedFiles && modifiedFiles.length > 0) {
    const tsFiles = modifiedFiles.filter(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx"),
    );

    if (tsFiles.length > 0) {
      console.log(`Scanning ${tsFiles.length} modified files with ESLint...`);
      vulnerabilities.push(...scanWithESLint(repoRoot, tsFiles, repoRoot));
    }
    return vulnerabilities;
  }

  // Otherwise scan frontend and backend
  const frontendPath = join(repoRoot, "frontend");
  if (existsSync(frontendPath)) {
    console.log("Scanning frontend with ESLint...");
    vulnerabilities.push(...scanWithESLint(frontendPath, ["src/**/*.ts", "src/**/*.tsx"], repoRoot));
  }

  const backendPath = join(repoRoot, "backend");
  if (existsSync(backendPath)) {
    console.log("Scanning backend with ESLint...");
    vulnerabilities.push(...scanWithESLint(backendPath, ["src/**/*.ts"], repoRoot));
  }

  return vulnerabilities;
}
