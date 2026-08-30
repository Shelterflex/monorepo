import freighterApi from '@stellar/freighter-api'

export const EXPECTED_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'

export async function isFreighterInstalled(): Promise<boolean> {
  try {
    const res = await freighterApi.isConnected();
    if (typeof res === 'boolean') return res;
    return Boolean((res as unknown as { isConnected?: boolean })?.isConnected);
  } catch {
    return false
  }
}

export async function connectWallet(): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('Wallet connection requires browser environment')
  }
  const { address } = await freighterApi.getAddress()
  if (!address) {
    throw new Error('Failed to get public key from Freighter')
  }
  return address
}

/**
 * Whether the site already has the user's permission to talk to Freighter.
 * Combined with an empty address this is what tells a *locked* wallet apart from
 * one that has simply never been connected — the two need different instructions.
 */
export async function isWalletAllowed(): Promise<boolean> {
  try {
    const result = await (freighterApi as unknown as { isAllowed?: () => Promise<{ isAllowed?: boolean }> }).isAllowed?.()
    return result?.isAllowed === true
  } catch {
    return false
  }
}

/** Returns current address without triggering a connection popup. Returns null when locked/unavailable. */
export async function getActiveAddress(): Promise<string | null> {
  try {
    const { address } = await freighterApi.getAddress()
    return address || null
  } catch {
    return null
  }
}

/** Returns the network passphrase Freighter is currently using, or '' on error. */
export async function getWalletNetwork(): Promise<string> {
  try {
    const result = await (freighterApi as any).getNetwork()
    return result?.networkPassphrase ?? ''
  } catch {
    return ''
  }
}

export function disconnectWallet(): void {
  const KEY = 'shelterflex_wallet'
  if (typeof window !== 'undefined') {
    localStorage.removeItem(KEY)
  }
}

export async function signTransaction(xdr: string): Promise<string> {
  const result = await freighterApi.signTransaction(xdr, {
    networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
  })
  if (!result || !result.signedTxXdr) {
    throw new Error('Failed to sign transaction')
  }
  return result.signedTxXdr
}
