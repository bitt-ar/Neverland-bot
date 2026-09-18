import { NextRequest, NextResponse } from "next/server";
import { getDiscordOAuthUrl, isAuthEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // If OAuth is disabled (dev mode), redirect directly to /overview or /servers
  if (!isAuthEnabled()) {
    return NextResponse.redirect(new URL("/overview", request.url));
  }

  const nextParam = request.nextUrl.searchParams.get("next") || "/servers";
  const authUrl = getDiscordOAuthUrl(nextParam);

  return NextResponse.redirect(authUrl);
}
