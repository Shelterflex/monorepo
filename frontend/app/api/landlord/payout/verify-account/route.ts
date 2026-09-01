import { NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bankName, bankCode, accountNumber } = body ?? {};

    // Basic validation
    if (!bankName && !bankCode) {
      return NextResponse.json(
        { error: "Bank name and account number are required" },
        { status: 400 }
      );
    }

    if (!accountNumber || String(accountNumber).trim().length < 10) {
      return NextResponse.json(
        { error: "Invalid account number length" },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("Authorization");

    const res = await fetch(`${BACKEND_URL}/api/landlord/payout/verify-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        bankName,
        bankCode,
        accountNumber,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message || data.error || "Failed to verify account" },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      accountName: data.accountName,
      accountNumber: data.accountNumber,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to verify account" },
      { status: 500 }
    );
  }
}
