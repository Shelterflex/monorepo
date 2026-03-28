# Security Scanner Installation Guide

This guide helps you set up the required security scanning tools for local development and CI/CD.

## Required Tools

### 1. Gitleaks (Secret Scanner)

**Linux:**

```bash
wget https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz
tar -xzf gitleaks_8.18.0_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/
chmod +x /usr/local/bin/gitleaks
```

**macOS:**

```bash
brew install gitleaks
```

**Verify:**

```bash
gitleaks version
```

### 2. Semgrep (Static Analysis)

**All platforms:**

```bash
pip install semgrep
```

**Verify:**

```bash
semgrep --version
```

### 3. cargo-audit (Rust Dependency Scanner)

**All platforms:**

```bash
cargo install cargo-audit --locked
```

**Verify:**

```bash
cargo audit --version
```

### 4. ESLint Security Plugin

This is installed automatically via npm when you run:

```bash
cd security-scan
npm install
```

## GitHub Actions Setup

The security scanner runs automatically in GitHub Actions. No additional setup required - the workflow installs all tools automatically.

## Local Development Setup

1. **Install all tools** (see above)

2. **Install scanner dependencies:**

   ```bash
   cd security-scan
   npm install
   ```

3. **Build the scanner:**

   ```bash
   npm run build
   ```

4. **Run validation tests:**

   ```bash
   ./validate.sh
   ```

5. **Run a scan:**
   ```bash
   npm run scan
   ```

## Troubleshooting

### Gitleaks not found

- Ensure `/usr/local/bin` is in your PATH
- Try running with full path: `/usr/local/bin/gitleaks version`

### Semgrep not found

- Ensure Python pip bin directory is in your PATH
- Try: `python3 -m semgrep --version`

### cargo-audit not found

- Ensure `~/.cargo/bin` is in your PATH
- Add to your shell profile: `export PATH="$HOME/.cargo/bin:$PATH"`

### npm audit fails

- Ensure you're running Node.js 18 or later
- Try: `npm audit --version`

## Optional: Pre-commit Hook

To run security scanning before each commit:

```bash
# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
echo "Running security scan..."
cd security-scan
TEST_MODE=true npm run scan
EOF

chmod +x .git/hooks/pre-commit
```

This runs the scanner in test mode (non-blocking) before each commit.
