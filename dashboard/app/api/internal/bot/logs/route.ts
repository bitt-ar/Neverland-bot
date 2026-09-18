import { NextRequest, NextResponse } from "next/server";
import { checkAdminAccess, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value || null;
  const isAdmin = await checkAdminAccess({ sessionCookie: cookie });
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const secret = process.env.CONTROL_PLANE_SECRET;
  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const cleanBase = baseUrl.replace(/\/+$/, "");

  const search = request.nextUrl.search;
  const fullUrl = `${cleanBase}/bot/logs${search}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(fullUrl, {
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
        {
          ok: false,
          online: false,
          error: `Control plane returned HTTP ${res.status}: ${res.statusText}`,
          timestamp: Date.now(),
          logs: [],
        },
        { status: 200 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      ok: true,
      online: true,
      bot: data.bot || null,
      logs: data.logs || [],
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof DOMException && err.name === "AbortError";
    const errorMessage = isTimeout
      ? "Bot connection timed out (Daemon unresponsive)"
      : "Bot process is OFFLINE or crashed. Unable to connect to control plane at " + cleanBase;

    return NextResponse.json(
      {
        ok: false,
        online: false,
        error: errorMessage,
        timestamp: Date.now(),
        logs: [],
      },
      { status: 200 }
    );
  }
}
