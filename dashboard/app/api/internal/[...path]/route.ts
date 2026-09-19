import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGuildOverview } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
const MAX_REQUESTS_PER_WINDOW = 60; // 60 requests per minute
const ipRateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Proactively clean up expired entries
  if (ipRateLimits.size > 100) {
    for (const [key, entry] of ipRateLimits.entries()) {
      if (now > entry.resetAt) {
        ipRateLimits.delete(key);
      }
    }
  }

  const entry = ipRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

async function proxyRequest(
  method: string,
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  // Prefer non-spoofable sources first, then headers set by a trusted reverse
  // proxy. x-forwarded-for is client-controlled and only a last resort.
  const clientIp =
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";

  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 60 requests per minute." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateCheck.retryAfter ?? 60),
        },
      }
    );
  }

  const secret = process.env.CONTROL_PLANE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Control plane secret is not configured" },
      { status: 403 }
    );
  }

  const { path } = await context.params;
  const targetPath = (path || []).join("/");

  // Authentication Guard for internal API:
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Global bot routes (bot logs, global stats) are restricted to Bot Owners
  const isGlobalRestricted =
    targetPath === "stats" ||
    targetPath === "logs" ||
    targetPath.startsWith("bot/");

  if (isGlobalRestricted && !user.isOwner) {
    return NextResponse.json(
      { error: "Forbidden: Global bot diagnostics are restricted to bot owners." },
      { status: 403 }
    );
  }

  // Guild-level permission enforcement (C-1):
  // Check ALL HTTP methods (GET, POST, PUT, PATCH, DELETE) for any guild-scoped route
  if (path && path[0] === "guilds" && path[1] && /^\d+$/.test(path[1])) {
    const guildId = path[1];
    try {
      const overview = await getGuildOverview(guildId, user.id);
      const userIds = user.id ? user.id.split(",").map((s) => s.trim()) : [];
      const isAllowed =
        overview.is_admin === true ||
        (overview.owner_id && userIds.includes(overview.owner_id));

      if (!isAllowed) {
        return NextResponse.json(
          { error: "Forbidden: You do not have Administrator permissions in this server." },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Forbidden: Could not verify Administrator permissions." },
        { status: 403 }
      );
    }
  }

  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const cleanBase = baseUrl.replace(/\/+$/, "");

  // H-1: Never trust client-provided user_id in search params; enforce authenticated session user
  const searchParams = new URLSearchParams(request.nextUrl.search);
  searchParams.delete("user_id");
  if (user?.id) {
    searchParams.set("user_id", user.id);
  }
  const queryString = searchParams.toString();
  const fullUrl = `${cleanBase}/${targetPath}${queryString ? `?${queryString}` : ""}`;

  try {
    const isUpload = targetPath.includes("upload");
    const controller = new AbortController();
    const timeoutMs = isUpload ? 120000 : 8000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "X-Internal-Secret": secret,
      Accept: "application/json",
    };

    if (user?.id) {
      headers["X-User-Id"] = user.id;
    }

    const contentType = request.headers.get("content-type");
    let body: BodyInit | undefined = undefined;

    if (["POST", "PUT", "PATCH"].includes(method)) {
      if (contentType && contentType.toLowerCase().includes("multipart/form-data")) {
        const buffer = await request.arrayBuffer();
        headers["Content-Type"] = contentType;
        headers["Content-Length"] = String(buffer.byteLength);
        body = buffer;
      } else {
        headers["Content-Type"] = "application/json";
        try {
          const json = await request.json();
          body = JSON.stringify(json);
        } catch {
          // empty body
        }
      }
    }

    const res = await fetch(fullUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message =
      err instanceof DOMException && err.name === "AbortError"
        ? "Control plane request timed out"
        : err instanceof Error
        ? err.message
        : "Control plane proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest("GET", request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest("POST", request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest("PUT", request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest("DELETE", request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest("PATCH", request, context);
}

