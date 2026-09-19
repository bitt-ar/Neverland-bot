import { NextRequest, NextResponse } from "next/server";
import {
  canManageGuild,
  createUserSessionToken,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  getAcceptedAdminIds,
  OAUTH_STATE_COOKIE,
  sanitizeRedirectPath,
  SESSION_COOKIE,
  sessionCookieOptions,
  UserSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const rawState = searchParams.get("state") || "";
  const error = searchParams.get("error");

  if (error || !code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", error || "authorization_denied");
    return NextResponse.redirect(loginUrl);
  }

  // Verify OAuth CSRF state token
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  let targetDestination = "/servers";

  if (rawState.includes(":")) {
    const [tokenPart, destPart] = rawState.split(":", 2);
    if (!stateCookie || tokenPart !== stateCookie) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "csrf_validation_failed");
      return NextResponse.redirect(loginUrl);
    }
    try {
      targetDestination = sanitizeRedirectPath(decodeURIComponent(destPart));
    } catch {
      targetDestination = "/servers";
    }
  } else if (rawState) {
    // If state was sent without token separator, ensure it matches cookie if present
    if (stateCookie && rawState !== stateCookie) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("error", "csrf_validation_failed");
      return NextResponse.redirect(loginUrl);
    }
    targetDestination = sanitizeRedirectPath(rawState);
  }

  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/callback/discord`;

  try {
    // 1. Exchange code for access token
    const tokenData = await exchangeDiscordCode(code, redirectUri);

    // 2. Fetch user profile
    const discordUser = await fetchDiscordUser(tokenData.access_token);

    // 3. Fetch user's guilds and find which ones they manage
    let managedGuildIds: string[] = [];
    try {
      const guilds = await fetchDiscordGuilds(tokenData.access_token);
      managedGuildIds = guilds
        .filter(canManageGuild)
        .map((g) => String(g.id));
    } catch {
      managedGuildIds = [];
    }

    // 4. Check if user is bot owner / admin
    const acceptedAdminIds = await getAcceptedAdminIds();
    const isOwner = acceptedAdminIds.includes(String(discordUser.id));

    // 5. Build session
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null;

    const session: UserSession = {
      id: String(discordUser.id),
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      globalName: discordUser.global_name,
      avatar: avatarUrl,
      isOwner,
      managedGuildIds,
    };

    const token = await createUserSessionToken(session);

    // 6. Redirect to target or landing page
    const destination =
      targetDestination && targetDestination !== "/servers"
        ? targetDestination
        : isOwner
        ? "/overview"
        : "/servers";

    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    // Clear the one-time OAuth state cookie
    response.cookies.delete(OAUTH_STATE_COOKIE);

    return response;
  } catch (err: unknown) {
    console.error("OAuth Discord callback failure:", err);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "oauth_exchange_failed");
    return NextResponse.redirect(loginUrl);
  }
}
