import { NextRequest, NextResponse } from "next/server";
import {
  canManageGuild,
  createUserSessionToken,
  exchangeDiscordCode,
  fetchDiscordGuilds,
  fetchDiscordUser,
  getAcceptedAdminIds,
  SESSION_COOKIE,
  sessionCookieOptions,
  UserSession,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state") || "/servers";
  const error = searchParams.get("error");

  if (error || !code) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", error || "authorization_denied");
    return NextResponse.redirect(loginUrl);
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
      state.startsWith("/") && state !== "/login"
        ? state
        : isOwner
        ? "/overview"
        : "/servers";

    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", encodeURIComponent(message));
    return NextResponse.redirect(loginUrl);
  }
}
