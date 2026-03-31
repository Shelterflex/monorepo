const TOKEN_KEY = "shelterflex_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout(): void {
  clearToken();
  // Redirect to homepage after logout
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}

// Function to handle post-authentication redirect
export function handleAuthRedirect(returnTo?: string): void {
  if (typeof window === "undefined") return;
  
  const targetUrl = returnTo ? decodeURIComponent(returnTo) : "/";
  
  // Prevent infinite redirect loops
  if (window.location.pathname === targetUrl) {
    return;
  }
  
  window.location.href = targetUrl;
}