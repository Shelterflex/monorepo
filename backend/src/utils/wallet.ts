import { randomBytes } from 'node:crypto'
import {
  Account,
  Keypair,
  Memo,
  MemoType,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk'

export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}

export function generateChallengeXdr(publicKey: string, nonce: string): string {
  const clientAccount = new Account(publicKey, '0') // Sequence number 0

  const challengeMemo = `SEP-0010 challenge: ${nonce}`

  const transaction = new TransactionBuilder(clientAccount, {
    fee: '100',
    networkPassphrase: Networks.TESTNET, // TODO: Make configurable
    timebounds: {
      minTime: Math.floor(Date.now() / 1000),
      maxTime: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    },
  })
    .addMemo(Memo.text(challengeMemo))
    .addOperation(Operation.manageData({
      name: 'web_auth_domain',
      value: 'shelterflex.com', // TODO: Make configurable
    }))
    .build()

  // Do not sign the transaction - client will sign it
  return transaction.toEnvelope().toXDR('base64')
}

export function verifySignedChallenge(publicKey: string, signedXdr: string, expectedNonce: string): boolean {
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64')
    const transaction = new Transaction(envelope, Networks.TESTNET) // TODO: Make configurable

    // Verify the transaction was signed by the public key
    const keypair = Keypair.fromPublicKey(publicKey)
    const txHash = transaction.hash()
    
    // Get signatures from envelope
    let signatures: xdr.DecoratedSignature[] = []
    if (envelope.switch().name === 'envelopeTypeTx') {
      signatures = envelope.v0().signatures()
    } else if (envelope.switch().name === 'envelopeTypeTxV0') {
      signatures = envelope.v0().signatures()
    }
    
    const validSignature = signatures.some((sig: xdr.DecoratedSignature) => {
      try {
        return keypair.verify(txHash, sig.signature())
      } catch {
        return false
      }
    })
    if (!validSignature) {
      return false
    }

    // Verify memo contains the expected nonce
    const memo = transaction.memo
    if (!(memo instanceof Memo)) {
      return false
    }

    const memoText = memo.value?.toString()
    if (!memoText?.includes(`SEP-0010 challenge: ${expectedNonce}`)) {
      return false
    }

    // Verify time bounds
    const timeBounds = transaction.timeBounds
    if (!timeBounds) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    const minTime = parseInt(timeBounds.minTime)
    const maxTime = parseInt(timeBounds.maxTime)
    if (now < minTime || now > maxTime) {
      return false
    }

    return true
  } catch (error) {
    console.error('Challenge verification failed:', error)
    return false
  }
}

export function isValidStellarPublicKey(publicKey: string): boolean {
  try {
    Keypair.fromPublicKey(publicKey)
    return true
  } catch {
    return false
  }
}
