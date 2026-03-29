# Automated Security Scanner

Comprehensive security scanning system for the CI/CD pipeline that detects vulnerabilities in dependencies, code, and commits.

## Features

- **Dependency Scanning**: Checks npm and cargo dependencies for known vulnerabilities
- **Static Code Analysis**: Analyzes TypeScript/JavaScript/Rust code for security issues
- **Secret Detection**: Scans commits for exposed credentials and API keys
- **PR Integration**: Automatically updates pull requests with scan results
- **Fail-Fast**: Blocks merges when critical or high severity vulnerabilities are detected

## Components

### Scanners

- `npm-audit.ts`: Scans Node.js dependencies using npm audit
- `cargo-audit.ts`: Scans Rust dependencies using cargo audit
- `eslint-scanner.ts`: Analyzes code with ESLint security plugins
- `semgrep-scanner.ts`: Pattern-based security analysis with Semgrep
- `gitleaks-scanner.ts`: Detects secrets in commits with Gitleaks

### Core Modules

- `types.ts`: TypeScript interfaces for vulnerability data
- `aggregator.ts`: Collects and normalizes scanner outputs
- `report-generator.ts`: Generates JSON and Markdown reports
- `orchestrator.ts`: Coordinates all scanners and manages execution

## Configuration Files

- `.gitleaks.toml`: Gitleaks secret detection patterns
- `semgrep.yml`: Semgrep security rules
- `.eslintrc.security.js`: ESLint security configuration

## Usage

### In GitHub Actions

The security scanner runs automatically on all pull requests via `.github/workflows/security-scan.yml`.

### Local Testing

```bash
# Install dependencies
cd security-scan
npm install

# Build the scanner
npm run build

# Run the scan
npm run scan
```

### Test Mode

To validate scanner configuration without blocking PRs:

```bash
TEST_MODE=true npm run scan
```

## Severity Levels

| Severity | CVSS Score | Action             |
| -------- | ---------- | ------------------ |
| Critical | 9.0-10.0   | Block merge        |
| High     | 7.0-8.9    | Block merge        |
| Medium   | 4.0-6.9    | Warn, allow merge  |
| Low      | 0.1-3.9    | Warn, allow merge  |
| Info     | 0.0        | Informational only |

## Output

### JSON Report

Machine-readable format saved as `security-scan-results.json`:

```json
{
  "timestamp": "2026-03-27T10:30:00.000Z",
  "scanDuration": 45000,
  "scannedComponents": {
    "frontend": true,
    "backend": true,
    "contracts": true
  },
  "summary": {
    "total": 5,
    "critical": 1,
    "high": 2,
    "medium": 2,
    "low": 0,
    "info": 0
  },
  "vulnerabilities": [...],
  "status": "fail"
}
```

### Markdown Report

Human-readable format saved as `security-scan-report.md` with detailed findings grouped by severity.

### PR Comment

Condensed summary posted as a comment on the pull request with links to detailed reports.

## Validation

To validate the scanner is working correctly:

1. **Test Vulnerable Dependency**: Add `lodash@4.17.15` to package.json
2. **Test Secret Detection**: Commit a file with `const API_KEY = "sk-test123..."`
3. **Test Code Issue**: Commit SQL injection pattern like `db.query("SELECT * FROM users WHERE id = " + userId)`

All three should be detected by the scanner.

## Troubleshooting

### Scanner Timeouts

- Individual scanners timeout after 2 minutes
- Overall scan times out after 5 minutes
- Timeouts don't block merges, only report warnings

### Scanner Failures

- If a scanner fails, other scanners continue
- Partial results are reported
- Scanner failures don't block merges

### False Positives

- Update `.gitleaks.toml` allowlist for secret false positives
- Adjust Semgrep rules in `semgrep.yml`
- Configure ESLint rule severity in `.eslintrc.security.js`

## Maintenance

### Updating Scanner Tools

```bash
# Update Gitleaks
wget https://github.com/gitleaks/gitleaks/releases/download/vX.Y.Z/gitleaks_X.Y.Z_linux_x64.tar.gz

# Update Semgrep
pip install --upgrade semgrep

# Update cargo-audit
cargo install cargo-audit --locked --force
```

### Adding Custom Rules

- **Gitleaks**: Add rules to `.gitleaks.toml`
- **Semgrep**: Add rules to `semgrep.yml`
- **ESLint**: Add rules to `.eslintrc.security.js`
