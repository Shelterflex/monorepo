import { apiFetch } from "./api";

export interface RiskState {
  isFrozen: boolean;
  freezeReason: string | null;
}

interface RiskStateResponse {
  isFrozen?: boolean;
  freezeReason?: string | null;
}

interface MeResponse {
  user?: {
    isFrozen?: boolean;
    freezeReason?: string | null;
  };
}

export function humanizeFreezeReason(reason?: string | null): string | null {
  if (!reason) return null;

  const trimmed = reason.trim();
  if (!trimmed) return null;

  const asWords = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  return asWords.charAt(0).toUpperCase() + asWords.slice(1).toLowerCase();
}

export async function getRiskState(): Promise<RiskState> {
  try {
    const risk = await apiFetch<RiskStateResponse>("/api/risk/state");
    return {
      isFrozen: Boolean(risk.isFrozen),
      freezeReason: humanizeFreezeReason(risk.freezeReason),
    };
  } catch {
    // Fallback to /api/auth/me when risk endpoint is unavailable.
  }

  try {
    const me = await apiFetch<MeResponse>("/api/auth/me");
    return {
      isFrozen: Boolean(me.user?.isFrozen),
      freezeReason: humanizeFreezeReason(me.user?.freezeReason),
    };
  } catch {
    return { isFrozen: false, freezeReason: null };
  }
}
