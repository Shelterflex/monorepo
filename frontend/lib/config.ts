import { apiFetch } from "./api";


export interface HealthResponse {
  status: string;
  version: string;
  uptimeSeconds: number;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}