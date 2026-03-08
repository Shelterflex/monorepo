# OTP Auth Flow with ReturnTo - Implementation Summary

## Changes Made

### 1. Updated `auth-guard.tsx`
- Added `usePathname` to capture current URL
- Modified redirect to go to `/verify-otp?returnTo={encodedPathname}` instead of `/login`
- Preserves target URL for post-authentication redirect

### 2. Enhanced `auth.ts`
- Added `logout()` function that clears token and redirects to homepage
- Added `handleAuthRedirect(returnTo?)` function for safe redirects
- Added infinite redirect loop protection
- Improved server-side rendering safety checks

### 3. Updated `verify-otp/page.tsx`
- Added import for `handleAuthRedirect`
- Extract `returnTo` parameter from URL
- After successful OTP verification:
  - If `returnTo` exists: redirect to original target URL
  - If no `returnTo`: fallback to role-based dashboard routing

### 4. Updated `login/page.tsx`
- Added `useSearchParams` import
- Extract `returnTo` parameter from URL
- Preserve `returnTo` when redirecting to verify-otp page
- Constructs proper URL with both email and returnTo parameters

### 5. Protected `staking/page.tsx`
- Wrapped `StakingPage` component with `AuthGuard`
- Now requires authentication to access

## Flow Examples

### Deep Link Flow (Unauthenticated User)
1. User visits `/staking` while logged out
2. `AuthGuard` redirects to `/verify-otp?returnTo=%2Fstaking`
3. User needs OTP, so they go to `/login?returnTo=%2Fstaking`
4. After login, they go to `/verify-otp?email=user%40example.com&returnTo=%2Fstaking`
5. After successful OTP verification, they're redirected back to `/staking`

### Normal Login Flow (Authenticated User)
1. User visits `/login` directly (no returnTo)
2. After OTP verification, they're redirected to role-based dashboard

### Logout Flow
1. User calls `logout()` function
2. Token is cleared from localStorage
3. User is redirected to homepage (`/`)

## Acceptance Criteria Met

✅ **Deep linking works**: Unauthenticated users accessing protected pages are redirected through the auth flow and back to their original destination

✅ **No infinite redirect loops**: `handleAuthRedirect` includes protection against redirect loops

✅ **Session persistence**: Token is stored in localStorage and persists across page refreshes

✅ **Clean logout**: `logout()` function clears token and redirects to homepage

✅ **ReturnTo parameter handling**: Both login and verify-otp pages properly preserve and use the returnTo parameter

## Technical Notes

- Uses localStorage for token storage (as requested, cookie support would require backend changes)
- All redirects use `encodeURIComponent`/`decodeURIComponent` for safe URL handling
- Server-side rendering safety checks prevent hydration issues
- AuthGuard can be applied to any page that requires authentication

## Usage

To protect any page:
```tsx
import { AuthGuard } from "@/components/auth-guard";

export default function ProtectedPage() {
  return (
    <AuthGuard>
      <YourPageComponent />
    </AuthGuard>
  );
}
```

To trigger logout:
```tsx
import { logout } from "@/lib/auth";

logout(); // Clears token and redirects to homepage
```
