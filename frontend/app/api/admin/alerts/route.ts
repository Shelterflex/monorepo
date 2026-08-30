import { NextRequest, NextResponse } from "next/server"
const backend = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000"
export async function GET(request: NextRequest) {
  const response = await fetch(`${backend}/api/admin/alerts${request.nextUrl.search}`, { headers: { "x-admin-secret": process.env.ADMIN_SECRET || process.env.MANUAL_ADMIN_SECRET || "" }, cache: "no-store" })
  return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" } })
}
