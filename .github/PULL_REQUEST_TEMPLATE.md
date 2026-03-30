## Summary

Briefly describe the change. This section is required for CI PR validation.
If this is a contract upgrade, include:

- Which contract is being upgraded
- Why the upgrade is needed
- Link to any discussion/issues

## Linked issue (recommended)

Example: `Closes #123`

## Changes

This section is required for CI PR validation.

## Contract Upgrade Details (if applicable)

This section is required for CI PR validation if this is a contract upgrade.

### Network

- [ ] Testnet
- [ ] Mainnet

### New Contract

- **Contract ID**: `C...`
- **WASM Hash**: `sha256:...`
- **Deployer Public Key**: `G...`
- **Deploy Transaction**: `[link to transaction explorer]`

### Upgrade Governance

- [ ] Admin/upgrade authority is a multisig requiring maintainer sign-off
- [ ] Maintainer has reviewed and approved the upgrade
- [ ] Upgrade transaction is ready for maintainer signature (provide transaction XDR if applicable)

### Verification Steps

- [ ] New contract deployed successfully
- [ ] All existing tests pass against the new contract
- [ ] Manual testing checklist completed (describe what you tested)
- [ ] No breaking changes for existing integrations (or list them)

## How to test

This section is required for CI PR validation.

- [ ] All automated tests pass
- [ ] Integration tests pass (if applicable)
- [ ] Manual testing completed (describe what you tested)

## Security Considerations

This section is required for CI PR validation.

- [ ] No secrets or sensitive data are logged
- [ ] No changes to authentication/authorization logic without review
- [ ] No changes to admin/upgrade logic without review

## Screenshots (if UI)

Include before/after screenshots for any UI changes. For new features, show different states (loading, error, success). For responsive changes, include mobile/tablet/desktop views.

## Checklist

This section is required for CI PR validation.

- [ ] I linked an issue (or explained why one is not needed)
- [ ] I tested locally
- [ ] I did not commit secrets
- [ ] I updated docs if needed
- [ ] Code follows the project's style guidelines
- [ ] CI checks pass
- [ ] If UI changes: I included before/after screenshots
- [ ] If images added/changed: I verified they are optimized and accessible
