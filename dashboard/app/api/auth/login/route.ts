import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  isAuthEnabled,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { error: "Authentication is not configured (set DASHBOARD_PASSWORD)." },
      { status: 400 }
    );
  }

  const ip = clientIp(request);
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = String(body?.password ?? "");
  } catch {
    // fallthrough — empty password will fail the check below
  }

  // Hash both sides before comparing so the comparison is constant-time
  // regardless of input length.
  const provided = crypto.createHash("sha256").update(password).digest();
  const expected = crypto
    .createHash("sha256")
    .update(process.env.DASHBOARD_PASSWORD || "")
    .digest();
  const valid = crypto.timingSafeEqual(provided, expected);

  if (!valid) {
    if (!entry || now >= entry.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    } else {
      entry.count += 1;
    }
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  loginAttempts.delete(ip);

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
