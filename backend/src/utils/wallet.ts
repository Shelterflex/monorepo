import { randomBytes } from 'node:crypto'
import { ethers } from 'ethers'

export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}

export function createChallengeMessage(address: string, nonce: string): string {
  return `Sign this message to authenticate with ShelterFlex. This request will not trigger a blockchain transaction or cost any fees.

Address: ${address}
Nonce: ${nonce}
Timestamp: ${Date.now()}`.trim()
}

export function verifySignature(address: string, message: string, signature: string): boolean {
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature)
    return recoveredAddress.toLowerCase() === address.toLowerCase()
  } catch (error) {
    console.error('Signature verification failed:', error)
    return false
  }
}

export function isValidEthereumAddress(address: string): boolean {
  return ethers.isAddress(address)
}
