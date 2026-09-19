import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value || null;
  const isAdmin = await checkAdminAccess({ sessionCookie: cookie });
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized: Bot presence configuration is restricted to bot owners." }, { status: 403 });
  }

  const secret = process.env.CONTROL_PLANE_SECRET;
  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const cleanBase = baseUrl.replace(/\/+$/, "");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`${cleanBase}/bot/presence`, {
      method: "GET",
      headers: {
        ...(secret ? { "X-Internal-Secret": secret } : {}),
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Control plane returned HTTP ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch bot presence";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value || null;
  const isAdmin = await checkAdminAccess({ sessionCookie: cookie });
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized: Bot presence configuration is restricted to bot owners." }, { status: 403 });
  }

  const secret = process.env.CONTROL_PLANE_SECRET;
  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const cleanBase = baseUrl.replace(/\/+$/, "");

  try {
    const body = await request.json();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${cleanBase}/bot/presence`, {
      method: "PUT",
      headers: {
        ...(secret ? { "X-Internal-Secret": secret } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update bot presence";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}
