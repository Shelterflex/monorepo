/**
 * Gitleaks Secret Scanner
 * 
 * Wraps Gitleaks to scan commits for exposed secrets and credentials.
 * Parses Gitleaks JSON output and normalizes it into the common vulnerability schema.
 * Ensures secret values are never included in the output.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Vulnerability } from "../types";
import { v4 as uuidv4 } from "uuid";

/**
 * Gitleaks JSON output structure
 */
interface GitleaksMatch {
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string; // The actual secret value - MUST BE REDACTED
  Secret: string; // The actual secret value - MUST BE REDACTED
  File: string;
  SymlinkFile: string;
  Commit: string;
  Entropy: number;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
  Tags: string[];
  RuleID: string;
  Fingerprint: string;
}

type GitleaksOutput = GitleaksMatch[];

/**
 * Redacts secret value from text
 * Replaces the secret with asterisks while preserving length indication
 */
function redactSecret(secret: string): string {
  if (secret.length <= 4) {
    return "****";
  }
  // Show first 2 and last 2 characters, redact the middle
  return `${secret.substring(0, 2)}${"*".repeat(Math.min(secret.length - 4, 20))}${secret.substring(secret.length - 2)}`;
}

/**
 * Generates user-friendly secret type description
 */
function getSecretTypeDescription(ruleId: string): string {
  const typeMap: Record<string, string> = {
    "generic-api-key": "Generic API Key",
    "generic-secret": "Generic Secret or Password",
    "database-connection-string": "Database Connection String",
    "private-key": "Private Key",
    "aws-access-key": "AWS Access Key",
    "github-token": "GitHub Personal Access Token",
    "github-oauth": "GitHub OAuth Token",
    "slack-token": "Slack API Token",
    "stripe-api-key": "Stripe API Key",
    "jwt-token": "JWT Token",
    "stellar-secret-key": "Stellar Secret Key",
  };

  return typeMap[ruleId] || ruleId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generates remediation guidance based on secret type
 */
function generateRemediation(ruleId: string): string {
  const remediationMap: Record<string, string> = {
    "generic-api-key": "Remove the API key from code. Use environment variables or secret management systems. Rotate the exposed key immediately.",
    "generic-secret": "Remove the secret from code. Use environment variables or secret management systems. Rotate the exposed secret immediately.",
    "database-connection-string": "Remove the connection string from code. Use environment variables. Rotate database credentials immediately.",
    "private-key": "Remove the private key from code. Store in secure key management system. Generate new key pair immediately.",
    "aws-access-key": "Remove AWS credentials from code. Use IAM roles or environment variables. Rotate the exposed credentials immediately in AWS Console.",
    "github-token": "Remove GitHub token from code. Use GitHub Secrets for CI/CD. Revoke the exposed token immediately in GitHub Settings.",
    "slack-token": "Remove Slack token from code. Use environment variables. Rotate the token immediately in Slack App Settings.",
    "stripe-api-key": "Remove Stripe key from code. Use environment variables. Rotate the key immediately in Stripe Dashboard.",
    "jwt-token": "Remove JWT from code. JWTs should never be hardcoded. Invalidate this token if possible.",
    "stellar-secret-key": "Remove Stellar secret key from code. Use secure key storage. Generate new keypair and update account immediately.",
  };

  return (
    remediationMap[ruleId] ||
    "Remove the secret from code. Use environment variables or secret management systems. Rotate the exposed secret immediately."
  );
}

/**
 * Converts Gitleaks match to normalized vulnerability schema
 * CRITICAL: Ensures secret values are never included in the output
 */
function convertGitleaksMatch(match: GitleaksMatch, repoRoot: string): Vulnerability {
  // Make file path relative to repo root
  const relativePath = match.File.startsWith(repoRoot)
    ? match.File.substring(repoRoot.length + 1)
    : match.File;

  const secretType = getSecretTypeDescription(match.RuleID);
  const redactedValue = redactSecret(match.Secret);

  return {
    id: uuidv4(),
    source: "secret",
    severity: "critical", // All secrets are critical
    title: `${secretType} detected`,
    description: `A ${secretType.toLowerCase()} was found in the code. The secret has been redacted in this report. Immediate action required.`,
    location: {
      file: relativePath,
      line: match.StartLine,
      column: match.StartColumn,
    },
    metadata: {
      cwe: "CWE-798", // Use of Hard-coded Credentials
      references: [
        "https://cwe.mitre.org/data/definitions/798.html",
        "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
      ],
    },
    remediation: generateRemediation(match.RuleID),
  };
}

/**
 * Runs Gitleaks on the repository and returns detected secrets
 * 
 * @param repoRoot - Root directory of the repository
 * @param configPath - Path to Gitleaks configuration file
 * @returns Array of normalized vulnerabilities (with secrets redacted)
 */
export function scanWithGitleaks(repoRoot: string, configPath: string): Vulnerability[] {
  if (!existsSync(configPath)) {
    console.warn(`Gitleaks config ${configPath} not found, using default rules`);
  }

  try {
    // Run Gitleaks on git diff
    // Use --no-git flag to scan uncommitted changes, or scan specific commits
    const configArg = existsSync(configPath) ? `--config=${configPath}` : "";
    const output = execSync(
      `gitleaks detect ${configArg} --report-format=json --report-path=/dev/stdout --no-banner`,
      {
        cwd: repoRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const gitleaksResults: GitleaksOutput = JSON.parse(output);
    const vulnerabilities: Vulnerability[] = [];

    // Convert each match to our schema (with redaction)
    for (const match of gitleaksResults) {
      vulnerabilities.push(convertGitleaksMatch(match, repoRoot));
    }

    return vulnerabilities;
  } catch (error: any) {
    // Gitleaks returns non-zero exit code when secrets are found
    // We still want to parse the output in this case
    if (error.stdout) {
      try {
        const gitleaksResults: GitleaksOutput = JSON.parse(error.stdout);
        const vulnerabilities: Vulnerability[] = [];

        for (const match of gitleaksResults) {
          vulnerabilities.push(convertGitleaksMatch(match, repoRoot));
        }

        return vulnerabilities;
      } catch (parseError) {
        console.error(`Failed to parse Gitleaks output: ${parseError}`);
        return [];
      }
    }

    // If no secrets found, Gitleaks returns exit code 0 with empty output
    if (error.status === 0 || error.message.includes("no leaks found")) {
      console.log("No secrets detected by Gitleaks");
      return [];
    }

    console.error(`Gitleaks failed: ${error.message}`);
    return [];
  }
}

/**
 * Scans the repository for secrets in recent commits or uncommitted changes
 * 
 * @param repoRoot - Root directory of the repository
 * @returns Array of all secrets found (with values redacted)
 */
export function scanForSecrets(repoRoot: string): Vulnerability[] {
  const configPath = join(repoRoot, ".gitleaks.toml");

  console.log("Scanning for exposed secrets with Gitleaks...");
  return scanWithGitleaks(repoRoot, configPath);
}
