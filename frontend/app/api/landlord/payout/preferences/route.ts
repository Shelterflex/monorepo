import { NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { schedule } = body ?? {};

    if (!schedule || !["activation", "weekly", "monthly"].includes(schedule)) {
      return NextResponse.json(
        { error: "Valid schedule preference is required" },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("Authorization");

    const res = await fetch(`${BACKEND_URL}/api/landlord/payout/preferences`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        schedule,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message || data.error || "Failed to update preferences" },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      preferences: data.preferences || { schedule },
      message: data.message || "Payout preferences updated successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to update preferences" },
      { status: 500 }
    );
  }
}
