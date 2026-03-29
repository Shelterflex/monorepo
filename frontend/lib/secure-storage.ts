interface StorageItem {
  value: string
  expires?: number
  iv?: string
}

class SecureStorage {
  private readonly prefix = 'secure_'
  private readonly encryptionKey = 'fallback-key-for-development'

  private async encrypt(data: string): Promise<{ encrypted: string; iv: string }> {
    if (typeof globalThis === 'undefined' || !globalThis.crypto?.subtle) {
      // Fallback for environments without Web Crypto API
      return { encrypted: btoa(data), iv: 'no-crypto' }
    }

    const encoder = new TextEncoder()
    const keyData = encoder.encode(this.encryptionKey)
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )

    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    )

    return {
      encrypted: btoa(String.fromCodePoint(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCodePoint(...iv))
    }
  }

  private async decrypt(encrypted: string, iv: string): Promise<string> {
    if (typeof globalThis === 'undefined' || !globalThis.crypto?.subtle) {
      // Fallback for environments without Web Crypto API
      return atob(encrypted)
    }

    if (iv === 'no-crypto') {
      return atob(encrypted)
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const keyData = encoder.encode(this.encryptionKey)
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )

    const ivArray = new Uint8Array(atob(iv).split('').map(char => char.codePointAt(0) || 0))
    const encryptedArray = new Uint8Array(atob(encrypted).split('').map(char => char.codePointAt(0) || 0))

    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivArray },
      key,
      encryptedArray
    )

    return decoder.decode(decrypted)
  }

  async setItem(key: string, value: string, ttl?: number): Promise<void> {
    if (typeof globalThis === 'undefined') return

    const item: StorageItem = {
      value,
      expires: ttl ? Date.now() + ttl : undefined
    }

    try {
      const { encrypted, iv } = await this.encrypt(value)
      item.value = encrypted
      item.iv = iv
      globalThis.localStorage?.setItem(this.prefix + key, JSON.stringify(item))
    } catch (error) {
      console.warn('Encryption failed, storing unencrypted:', error)
      globalThis.localStorage?.setItem(this.prefix + key, JSON.stringify(item))
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (typeof globalThis === 'undefined') return null

    try {
      const itemStr = globalThis.localStorage?.getItem(this.prefix + key)
      if (!itemStr) return null

      const item: StorageItem = JSON.parse(itemStr)

      // Check expiration
      if (item.expires && Date.now() > item.expires) {
        this.removeItem(key)
        return null
      }

      // Decrypt if encrypted
      if (item.iv) {
        return await this.decrypt(item.value, item.iv)
      }

      return item.value
    } catch (error) {
      console.warn('Failed to retrieve secure item:', error)
      return null
    }
  }

  removeItem(key: string): void {
    if (typeof globalThis === 'undefined') return
    globalThis.localStorage?.removeItem(this.prefix + key)
  }

  clear(): void {
    if (typeof globalThis === 'undefined') return
    
    const keys = Object.keys(globalThis.localStorage || {})
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        globalThis.localStorage?.removeItem(key)
      }
    })
  }

  // Session storage variant (less persistent)
  async setSessionItem(key: string, value: string, ttl?: number): Promise<void> {
    if (typeof globalThis === 'undefined') return

    const item: StorageItem = {
      value,
      expires: ttl ? Date.now() + ttl : undefined
    }

    try {
      const { encrypted, iv } = await this.encrypt(value)
      item.value = encrypted
      item.iv = iv
      globalThis.sessionStorage?.setItem(this.prefix + key, JSON.stringify(item))
    } catch (error) {
      console.warn('Encryption failed, storing unencrypted:', error)
      globalThis.sessionStorage?.setItem(this.prefix + key, JSON.stringify(item))
    }
  }

  async getSessionItem(key: string): Promise<string | null> {
    if (typeof globalThis === 'undefined') return null

    try {
      const itemStr = globalThis.sessionStorage?.getItem(this.prefix + key)
      if (!itemStr) return null

      const item: StorageItem = JSON.parse(itemStr)

      // Check expiration
      if (item.expires && Date.now() > item.expires) {
        this.removeSessionItem(key)
        return null
      }

      // Decrypt if encrypted
      if (item.iv) {
        return await this.decrypt(item.value, item.iv)
      }

      return item.value
    } catch (error) {
      console.warn('Failed to retrieve secure session item:', error)
      return null
    }
  }

  removeSessionItem(key: string): void {
    if (typeof globalThis === 'undefined') return
    globalThis.sessionStorage?.removeItem(this.prefix + key)
  }
}

export const secureStorage = new SecureStorage()
export default SecureStorage
