import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk"
import { CustodialWalletService, KeyStore, Decryptor } from "./CustodialWalletService.js"

export class WalletNotFoundError extends Error {
  constructor(userId: string) {
    super(`Wallet not found for user: ${userId}`)
    this.name = 'WalletNotFoundError'
  }
}

/**
 * Implementation of CustodialWalletService using Stellar SDK.
 * 
 * Security notes:
 * - Decrypted secret keys are only held in memory during signing
 * - Keys are never logged or exposed outside the service boundary
 * - All signing operations are audited (without secrets)
 */
export class CustodialWalletServiceImpl implements CustodialWalletService {
  constructor(
    private readonly store: KeyStore,
    private readonly decryptor: Decryptor,
    private readonly networkPassphrase: string,
    private readonly logger: (message: string, metadata?: Record<string, unknown>) => void = (msg, meta) => {
      console.log(`[CustodialWalletService] ${msg}`, meta ? JSON.stringify(meta) : "")
    }
  ) { }

  async signMessage(userId: string, message: string): Promise<{ signature: string; publicKey: string }> {
    this.logger("Message signing invoked", {
      messageLength: message.length,
      userId,
      timestamp: new Date().toISOString(),
    })

    let keypair: Keypair | null = null
    let secretKey: Buffer | null = null

    try {
      let record
      try {
        record = await this.store.getEncryptedKey(userId)
      } catch (e) {
        throw new WalletNotFoundError(userId)
      }
      secretKey = await this.decryptor.decrypt(record.envelope)
      if (!secretKey) {
        throw new Error("Secret key decryption failed: received null buffer")
      }
      keypair = Keypair.fromSecret(secretKey.toString('utf8'))
      const publicKey = keypair.publicKey()
      secretKey.fill(0)
      secretKey = null

      const signature = keypair.sign(Buffer.from(message)).toString('base64')

      this.logger("Message signing completed", {
        publicKey,
        signatureLength: signature.length,
        timestamp: new Date().toISOString(),
      })

      return {
        signature,
        publicKey,
      }
    } catch (error) {
      this.logger("Message signing failed", {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
      if (secretKey) {
        secretKey.fill(0)
        secretKey = null
      }
      keypair = null
      throw error
    }
  }

  /**
   * Signs a Stellar/Soroban transaction XDR.
   * 
   * @param userId - The user ID for the wallet
   * @param transactionXdr - The transaction XDR string to sign
   * @returns Object containing the signature and public key
   * @throws Error if decryption, parsing, or signing fails
   */
  async signTransaction(
    userId: string,
    transactionXdr: string,
  ): Promise<{ signature: string; publicKey: string }> {
    // Audit log: signing invoked (no secrets)
    this.logger("Transaction signing invoked", {
      transactionXdrLength: transactionXdr.length,
      userId,
      timestamp: new Date().toISOString(),
    })

    let keypair: Keypair | null = null
    let secretKey: Buffer | null = null

    try {
      let record
      try {
        record = await this.store.getEncryptedKey(userId)
      } catch (e) {
        throw new WalletNotFoundError(userId)
      }

      // Decrypt the secret key
      secretKey = await this.decryptor.decrypt(record.envelope)
      if (!secretKey) {
        throw new Error("Secret key decryption failed: received null buffer")
      }

      // Derive Keypair from secret key
      keypair = Keypair.fromSecret(secretKey.toString('utf8'))

      // Get the public key before signing (for return value)
      const publicKey = keypair.publicKey()

      // Clear the secret key from memory as soon as possible
      secretKey.fill(0)
      secretKey = null

      // Parse the transaction XDR
      // Transaction.fromXDR handles both regular and Soroban transactions
      // Using type assertion because TypeScript types may not be fully up to date
      const transaction = TransactionBuilder.fromXDR(transactionXdr, this.networkPassphrase) as Transaction

      // Sign the transaction
      transaction.sign(keypair)

      // Get the signature from the transaction
      // The signature is added to the transaction's signature list
      const signatures = transaction.signatures
      if (!signatures || signatures.length === 0) {
        throw new Error("Transaction signing failed: no signatures generated")
      }

      // Extract the signature (last signature is the one we just added)
      const lastSignature = signatures[signatures.length - 1]
      const signatureBase64 = lastSignature.signature().toString("base64")

      // Audit log: signing completed successfully
      this.logger("Transaction signing completed", {
        publicKey,
        signatureLength: signatureBase64.length,
        timestamp: new Date().toISOString(),
      })

      return {
        signature: signatureBase64,
        publicKey,
      }
    } catch (error) {
      // Audit log: signing failed
      this.logger("Transaction signing failed", {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })

      // Clear any remaining secret key data
      if (secretKey) {
        secretKey.fill(0)
        secretKey = null
      }
      keypair = null

      throw error
    }
  }
}
