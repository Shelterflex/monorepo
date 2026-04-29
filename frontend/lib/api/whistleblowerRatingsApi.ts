import { apiFetch, apiPost } from "../api";

export interface RateableWhistleblower {
  id: string;
  dealId: string;
  name: string;
  apartment: string;
  rentDate: string;
  rating: number;
  reviews: number;
  hasRated: boolean;
}

export async function getRateableWhistleblowers(): Promise<RateableWhistleblower[]> {
  const res: any = await apiFetch("/api/whistleblower/tenant/rateable");
  return res.rateable || [];
}

export async function submitWhistleblowerRating(payload: {
  whistleblowerId: string;
  dealId: string;
  rating: number;
  reviewText: string;
}): Promise<any> {
  return await apiPost("/api/whistleblower/ratings", payload);
}
