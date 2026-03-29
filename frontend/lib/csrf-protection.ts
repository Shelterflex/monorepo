interface CSRFToken {
  token: string
  expires: number
}

class CSRFProtection {
  private static instance: CSRFProtection
  private readonly tokenStorageKey = 'csrf_token'
  private readonly headerName = 'X-CSRF-Token'
  private readonly tokenLength = 32
  private readonly tokenExpiry = 60 * 60 * 1000 // 1 hour

  static getInstance(): CSRFProtection {
    if (!CSRFProtection.instance) {
      CSRFProtection.instance = new CSRFProtection()
    }
    return CSRFProtection.instance
  }

  private generateToken(): string {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
      const array = new Uint8Array(this.tokenLength)
      globalThis.crypto.getRandomValues(array)
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
    }
    
    // Fallback for environments without crypto
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Date.now().toString(36)
  }

  private storeToken(token: string): void {
    if (typeof globalThis === 'undefined') return

    const csrfData: CSRFToken = {
      token,
      expires: Date.now() + this.tokenExpiry
    }

    try {
      globalThis.localStorage?.setItem(this.tokenStorageKey, JSON.stringify(csrfData))
    } catch (error) {
      console.warn('Failed to store CSRF token:', error)
    }
  }

  private getStoredToken(): CSRFToken | null {
    if (typeof globalThis === 'undefined') return null

    try {
      const stored = globalThis.localStorage?.getItem(this.tokenStorageKey)
      if (!stored) return null

      const tokenData: CSRFToken = JSON.parse(stored)
      
      // Check if token has expired
      if (Date.now() > tokenData.expires) {
        this.removeToken()
        return null
      }

      return tokenData
    } catch (error) {
      console.warn('Failed to retrieve CSRF token:', error)
      return null
    }
  }

  private removeToken(): void {
    if (typeof globalThis === 'undefined') return
    globalThis.localStorage?.removeItem(this.tokenStorageKey)
  }

  generateNewToken(): string {
    const token = this.generateToken()
    this.storeToken(token)
    return token
  }

  getCurrentToken(): string | null {
    const tokenData = this.getStoredToken()
    return tokenData ? tokenData.token : null
  }

  isTokenValid(token?: string): boolean {
    const currentToken = token || this.getCurrentToken()
    if (!currentToken) return false

    const storedToken = this.getStoredToken()
    return storedToken ? storedToken.token === currentToken : false
  }

  refreshToken(): string {
    return this.generateNewToken()
  }

  // Add CSRF token to request headers
  addTokenToHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const token = this.getCurrentToken()
    if (token) {
      headers[this.headerName] = token
    }
    return headers
  }

  // Validate CSRF token from response headers
  validateResponseToken(headers: Record<string, string>): boolean {
    const responseToken = headers[this.headerName.toLowerCase()]
    return responseToken ? this.isTokenValid(responseToken) : false
  }

  // Middleware for fetch requests
  async fetchWithCSRF(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    
    // Add CSRF token to headers
    const token = this.getCurrentToken()
    if (token) {
      headers.set(this.headerName, token)
    }

    const response = await fetch(input, {
      ...init,
      headers
    })

    // Validate CSRF token from response if present
    const responseToken = response.headers.get(this.headerName)
    if (responseToken && !this.isTokenValid(responseToken)) {
      throw new Error('CSRF token validation failed')
    }

    return response
  }

  // Hook for React components
  useCSRFToken() {
    const getToken = () => this.getCurrentToken()
    const refreshToken = () => this.refreshToken()
    const isTokenValid = (token?: string) => this.isTokenValid(token)

    return {
      getToken,
      refreshToken,
      isTokenValid,
      headerName: this.headerName
    }
  }

  // Initialize CSRF protection
  initialize(): string {
    const existingToken = this.getCurrentToken()
    if (existingToken) {
      return existingToken
    }
    return this.generateNewToken()
  }

  // Clear all CSRF data
  clear(): void {
    this.removeToken()
  }
}

// Export singleton instance
export const csrfProtection = CSRFProtection.getInstance()

// Utility functions for common patterns
export const addCSRFToFormData = (formData: FormData): FormData => {
  const token = csrfProtection.getCurrentToken()
  if (token) {
    formData.set('csrf_token', token)
  }
  return formData
}

export const validateCSRFToken = (request: Request): boolean => {
  const token = request.headers.get('X-CSRF-Token') || 
                request.headers.get('x-csrf-token')
  return csrfProtection.isTokenValid(token || undefined)
}

// React Hook (if using React) - requires React to be imported separately
// export const useCSRFProtection = () => {
//   const [token, setToken] = React.useState<string | null>(null)
//
//   React.useEffect(() => {
//     const initializeToken = () => {
//       const currentToken = csrfProtection.initialize()
//       setToken(currentToken)
//     }
//
//     initializeToken()
//
//     // Refresh token periodically
//     const interval = setInterval(() => {
//       const newToken = csrfProtection.refreshToken()
//       setToken(newToken)
//     }, 30 * 60 * 1000) // Every 30 minutes
//
//     return () => clearInterval(interval)
//   }, [])
//
//   const addTokenToRequest = (init: RequestInit = {}): RequestInit => {
//     const headers = new Headers(init.headers)
//     if (token) {
//       headers.set('X-CSRF-Token', token)
//     }
//     return { ...init, headers }
//   }
//
//   const validateToken = (responseToken?: string): boolean => {
//     return csrfProtection.isTokenValid(responseToken)
//   }
//
//   return {
//     token,
//     addTokenToRequest,
//     validateToken,
//     refreshToken: () => {
//       const newToken = csrfProtection.refreshToken()
//       setToken(newToken)
//     }
//   }
// }

export default CSRFProtection
