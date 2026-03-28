# Quick Start Guide

Get the security scanner running in 5 minutes.

## For Contributors (Local Testing)

### 1. Install Required Tools

**On Linux:**

```bash
# Gitleaks
wget https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz
tar -xzf gitleaks_8.18.0_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/

# Semgrep
pip install semgrep

# cargo-audit
cargo install cargo-audit --locked
```

**On macOS:**

```bash
brew install gitleaks
pip install semgrep
cargo install cargo-audit --locked
```

### 2. Build and Run

```bash
cd security-scan
npm install
npm run build
npm run scan
```

### 3. View Results

```bash
cat ../security-scan-results.json | jq '.summary'
```

## For CI/CD (GitHub Actions)

No setup required! The security scanner runs automatically on all pull requests.

### What Happens:

1. You open a PR
2. Security scan workflow triggers
3. All scanners run (dependencies, code, secrets)
4. Results posted as:
   - PR check (pass/fail)
   - PR comment with summary
   - Artifacts (JSON + Markdown reports)

### If Scan Fails:

- **Critical/High vulnerabilities**: PR blocked, must fix before merge
- **Medium/Low vulnerabilities**: Warning only, can still merge
- **Scanner errors**: Warning only, doesn't block merge

## Test Mode

Run scans without blocking:

```bash
TEST_MODE=true npm run scan
```

## Validation

Test that all scanners work:

```bash
./validation-tests.sh
```

This runs 4 tests:

1. Vulnerable dependency detection
2. Secret detection
3. SQL injection detection
4. Round-trip property (add → remove → clean)

## Next Steps

- See [README.md](README.md) for detailed documentation
- See [INSTALLATION.md](INSTALLATION.md) for tool installation details
- Review configuration files: `.gitleaks.toml`, `semgrep.yml`, `.eslintrc.security.js`
