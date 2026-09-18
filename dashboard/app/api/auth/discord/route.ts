import { NextRequest, NextResponse } from "next/server";
import { getDiscordOAuthUrl, isAuthEnabled, OAUTH_STATE_COOKIE, sanitizeRedirectPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // If OAuth is disabled (dev mode), redirect directly to /overview or /servers
  if (!isAuthEnabled()) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  const rawNext = request.nextUrl.searchParams.get("next");
  const safeNext = sanitizeRedirectPath(rawNext);

  // Generate cryptographically secure random token for CSRF protection
  const csrfToken = crypto.randomUUID();
  const statePayload = `${csrfToken}:${encodeURIComponent(safeNext)}`;

  const authUrl = getDiscordOAuthUrl(statePayload);
  const response = NextResponse.redirect(authUrl);

  response.cookies.set(OAUTH_STATE_COOKIE, csrfToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  return response;
}
