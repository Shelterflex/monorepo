import { apiGet } from "./apiClient";

export interface RiskState {
  isFrozen: boolean;
  freezeReason: string | null;
  deficitNgn: number;
  updatedAt: string | null;
}

interface RiskStateResponse {
  isFrozen?: boolean;
  freezeReason?: string | null;
  deficitNgn?: number;
  updatedAt?: string;
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
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");

  return asWords.charAt(0).toUpperCase() + asWords.slice(1).toLowerCase();
}

export async function getRiskState(): Promise<RiskState> {
  try {
    const risk = await apiGet<RiskStateResponse>("/api/risk/state");
    return {
      isFrozen: Boolean(risk.isFrozen),
      freezeReason: humanizeFreezeReason(risk.freezeReason),
      deficitNgn: typeof risk.deficitNgn === 'number' ? risk.deficitNgn : 0,
      updatedAt: typeof risk.updatedAt === 'string' ? risk.updatedAt : null,
    };
  } catch {
    // Fallback to /api/auth/me when risk endpoint is unavailable.
  }

  try {
    const me = await apiGet<MeResponse>("/api/auth/me");
    return {
      isFrozen: Boolean(me.user?.isFrozen),
      freezeReason: humanizeFreezeReason(me.user?.freezeReason),
      deficitNgn: 0,
      updatedAt: null,
    };
  } catch {
    return { isFrozen: false, freezeReason: null, deficitNgn: 0, updatedAt: null };
  }
}
