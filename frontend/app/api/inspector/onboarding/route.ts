import { NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Basic validation
    if (!body.personalInfo || !body.serviceAreas || !body.bankDetails) {
      return NextResponse.json(
        { error: "Missing required onboarding data" },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("Authorization");

    const res = await fetch(`${BACKEND_URL}/api/inspector/onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message || data.error || "Failed to submit onboarding application" },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: data.message || "Inspector onboarding completed successfully",
      inspectorId: data.inspectorId,
      userId: data.userId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to submit onboarding application" },
      { status: 500 }
    );
  }
}
