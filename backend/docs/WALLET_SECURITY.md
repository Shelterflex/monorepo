# Custodial Wallet Security Documentation

## Overview

This document outlines the security architecture, threat model, and operational procedures for the custodial wallet service implemented in this backend.

## Architecture

### Components

1. **Wallet Service**: Core business logic for wallet creation and signing operations
2. **Encryption Service**: Handles encryption/decryption of private keys
3. **Wallet Store**: Persistent storage for wallet data (currently in-memory, planned DB migration)
4. **API Endpoints**: RESTful interface for wallet operations

### Data Flow

```
User Request → API → Authentication → Wallet Service → Encryption Service → Storage
```

## Security Measures

### Encryption at Rest

- **Algorithm**: scrypt key derivation + XOR encryption (MVP)
- **Key Source**: Environment variable `ENCRYPTION_KEY` (minimum 32 characters)
- **Key ID**: Currently fixed to `env-key-1` (future: support key rotation)
- **Salt**: Random 16-byte salt per encryption operation

### Authentication

- **Current**: Header-based user ID (`x-user-id`) for MVP
- **Production**: Should be replaced with JWT tokens from OTP authentication
- **Authorization**: Users can only access their own wallets

### Private Key Handling

- Private keys are **never** returned by any API endpoint
- Decryption only occurs in memory during signing operations
- No persistent storage of unencrypted private keys

## Threat Model

### Threat Actors

1. **External Attackers**: Malicious actors outside the system
2. **Insider Threats**: Authorized users with malicious intent
3. **Compromised Infrastructure**: Attackers with system access

### Attack Vectors & Mitigations

#### 1. Database Compromise
- **Threat**: Attacker gains access to wallet database
- **Impact**: Encrypted private keys exposed
- **Mitigation**: Strong encryption with environment-based keys
- **Residual Risk**: High if encryption key is also compromised

#### 2. Environment Variable Exposure
- **Threat**: ENCRYPTION_KEY exposed through logs, debugging, or system compromise
- **Impact**: All encrypted keys can be decrypted
- **Mitigation**: 
  - Secure environment variable management
  - No logging of sensitive data
  - Access controls on production systems
- **Residual Risk**: Critical

#### 3. Memory Dump Attacks
- **Threat**: Attacker dumps server memory during signing operations
- **Impact**: Unencrypted private keys exposed in memory
- **Mitigation**: 
  - Minimize time private keys remain in memory
  - Consider secure memory allocation (future enhancement)
- **Residual Risk**: Medium

#### 4. API Abuse
- **Threat**: Attacker attempts to sign unauthorized transactions
- **Impact**: Financial loss, unauthorized operations
- **Mitigation**: 
  - Proper authentication and authorization
  - Rate limiting on signing endpoints
  - Transaction validation (future enhancement)
- **Residual Risk**: Low with proper auth

#### 5. Man-in-the-Middle Attacks
- **Threat**: Attacker intercepts API communications
- **Impact**: User data exposure, request tampering
- **Mitigation**: HTTPS/TLS encryption
- **Residual Risk**: Low

#### 6. Replay Attacks
- **Threat**: Attacker replays valid signed transactions
- **Impact**: Duplicate transactions, financial loss
- **Mitigation**: 
  - Transaction nonces (Stellar protocol)
  - Server-side validation
- **Residual Risk**: Low

## Security Requirements

### Production Deployment

1. **Key Management**
   - Use HSM or KMS for encryption key storage
   - Implement key rotation procedures
   - Separate encryption keys per environment

2. **Authentication**
   - Implement JWT-based authentication from OTP login
   - Add multi-factor authentication for sensitive operations
   - Session management with proper expiration

3. **Infrastructure Security**
   - Network segmentation
   - Intrusion detection systems
   - Regular security audits
   - Access logging and monitoring

4. **Compliance**
   - GDPR compliance for user data
   - Financial regulations if applicable
   - Security certifications (SOC 2, ISO 27001)

## Key Rotation Plan

### Current Limitations (MVP)

- Single encryption key with fixed ID `env-key-1`
- No automated key rotation
- Manual process for key updates

### Future Implementation

1. **Key Versioning**
   - Support multiple active encryption keys
   - Version tracking in wallet records
   - Graceful migration between key versions

2. **Rotation Process**
   ```
   1. Generate new encryption key
   2. Add to key management system
   3. Update service configuration
   4. Migrate existing wallets (background job)
   5. Decommission old key
   ```

3. **Admin Endpoint** (Planned)
   ```
   POST /api/admin/wallets/rotate-keys
   - Requires admin authentication
   - Validates new key strength
   - Initiates background migration
   - Reports migration progress
   ```

## Monitoring & Alerting

### Security Events to Monitor

1. Failed authentication attempts
2. Unusual signing patterns
3. Access from suspicious IP addresses
4. System errors in encryption/decryption
5. Configuration changes

### Alert Thresholds

- > 10 failed auth attempts per minute per user
- > 100 signing operations per minute per user
- Any encryption service errors
- Unauthorized access attempts

## Incident Response

### Breach Categories

1. **Key Compromise**: ENCRYPTION_KEY exposed
2. **Database Breach**: Wallet data accessed
3. **System Compromise**: Server access gained
4. **API Abuse**: Unauthorized operations

### Response Procedures

#### Key Compromise (Critical)
1. Immediately rotate encryption key
2. Force re-creation of all user wallets
3. Notify affected users
4. Investigate source of compromise

#### Database Breach (High)
1. Assess if encryption key was also compromised
2. Rotate keys if necessary
3. Monitor for suspicious activity
4. Audit access logs

## Development Security

### Secure Coding Practices

1. Input validation on all endpoints
2. Error handling without information leakage
3. No sensitive data in logs
4. Regular dependency updates
5. Security testing in CI/CD

### Testing

1. Unit tests for encryption/decryption
2. Integration tests for API security
3. Penetration testing
4. Code security reviews

## Compliance & Legal

### Data Protection

- User wallet addresses are public blockchain data
- Encrypted private keys are considered sensitive personal data
- Implement data retention policies
- Right to be forgotten (wallet deletion capability)

### Financial Regulations

- Consider KYC/AML requirements
- Transaction monitoring
- Reporting obligations
- Jurisdiction-specific compliance

## Future Enhancements

1. **Hardware Security Module (HSM) Integration**
2. **Multi-signature Wallet Support**
3. **Biometric Authentication**
4. **Advanced Threat Detection**
5. **Zero-knowledge Proofs for Privacy**
6. **Decentralized Key Management**
