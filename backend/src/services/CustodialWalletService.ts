/**
 * Interface for custodial wallet service operations.
 * Handles secret key decryption and transaction signing.
 */
export interface CustodialWalletService {
  /**
   * Signs a Stellar/Soroban transaction XDR.
   * 
   * @param userId - The user ID for the wallet
   * @param transactionXdr - The transaction XDR string to sign
   * @returns Object containing the signature and public key
   * @throws Error if decryption or signing fails
   */
  signTransaction(
    userId: string,
    transactionXdr: string,
  ): Promise<{ signature: string; publicKey: string }>

  /**
   * Signs a message.
   * 
   * @param userId - The user ID for the wallet
   * @param message - The message string to sign
   * @returns Object containing the signature and public key
   * @throws Error if decryption or signing fails
   */
  signMessage(
    userId: string,
    message: string,
  ): Promise<{ signature: string; publicKey: string }>
}

export interface EncryptedKeyRecord {
  envelope: unknown
  keyVersion: string
  publicAddress: string
}

export interface KeyStore {
  getEncryptedKey(userId: string): Promise<EncryptedKeyRecord>
  getPublicAddress(userId: string): Promise<string>
}

export interface Decryptor {
  decrypt(envelope: unknown): Promise<Buffer>
}
