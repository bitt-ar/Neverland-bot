/**
 * Discord OAuth2 and Session Management for Neverland Dashboard.
 *
 * - In Development (AUTH_ENABLED=false or non-production without AUTH_ENABLED=true):
 *   No Discord login is required. The dashboard automatically assumes the identity
 *   of DEV_USER_ID (configured in .env, defaults to OWNER_DISCORD_ID).
 *   If DEV_USER_ID is the bot owner (or in ADMIN_DISCORD_IDS), they get full
 *   bot-owner access (Overview and all bot guilds).
 *   If DEV_USER_ID is changed to any other ID for testing, they get regular-user
 *   access (Overview is 404, only their managed guilds are visible).
 *
 * - In Production (AUTH_ENABLED=true):
 *   Requires signing in with Discord OAuth2 (scopes: identify, guilds).
 *   The session token is `<expiry>.<base64url(payload)>.<hmac_sha256>`.
 *   Bot owners see Overview + all bot servers.
 *   Regular users see only the servers they own or have Manage Server/Admin in.
 */

export const SESSION_COOKIE = "nl_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface UserSession {
  id: string;
  username: string;
  discriminator?: string;
  avatar: string | null;
  globalName?: string | null;
  isOwner: boolean;
  managedGuildIds?: string[];
}

const encoder = new TextEncoder();

function getSigningSecret(): string {
  const secret =
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.CONTROL_PLANE_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: DASHBOARD_SESSION_SECRET or CONTROL_PLANE_SECRET must be configured in production.");
    }
    return "neverland_dev_secret_key_change_in_production";
  }

  return secret;
}

export function isAuthEnabled(): boolean {
  return (
    process.env.AUTH_ENABLED === "true" ||
    (process.env.NODE_ENV === "production" && process.env.AUTH_ENABLED !== "false")
  );
}

export function getEnvAdminIds(): string[] {
  const ids = new Set<string>();
  if (process.env.OWNER_DISCORD_ID) {
    ids.add(process.env.OWNER_DISCORD_ID.trim());
  }
  if (process.env.DEV_ADMIN_ID) {
    ids.add(process.env.DEV_ADMIN_ID.trim());
  }
  const rawList = process.env.ADMIN_DISCORD_IDS || "";
  for (const part of rawList.split(",")) {
    const trimmed = part.trim();
    if (trimmed) ids.add(trimmed);
  }
  return Array.from(ids);
}

export function getDevAdminIds(): string[] {
  return getEnvAdminIds();
}

export async function getAcceptedAdminIds(): Promise<string[]> {
  const ids = new Set<string>(getEnvAdminIds());
  try {
    const { getBotInfo } = await import("@/lib/control-plane");
    const botInfo = await getBotInfo();
    for (const ownerId of botInfo.owner_ids || []) {
      if (ownerId) ids.add(String(ownerId).trim());
    }
  } catch {
    // Control plane offline
  }
  return Array.from(ids);
}

async function hmacHex(payload: string): Promise<string> {
  const secret = getSigningSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf-8").toString("base64url");
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "base64url").toString("utf-8");
  }
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return atob(base64);
}

export async function createUserSessionToken(
  user: UserSession,
  ttlSeconds: number = SESSION_TTL_SECONDS
): Promise<string> {
  const expiry = Date.now() + ttlSeconds * 1000;
  const payload = base64UrlEncode(JSON.stringify(user));
  const data = `${expiry}.${payload}`;
  const signature = await hmacHex(data);
  return `${data}.${signature}`;
}

export async function verifyUserSessionToken(
  token: string | undefined | null
): Promise<UserSession | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [expiryPart, payloadPart, signature] = parts;
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;

  const expectedSig = await hmacHex(`${expiryPart}.${payloadPart}`);
  if (expectedSig.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const rawJson = base64UrlDecode(payloadPart);
    const data = JSON.parse(rawJson) as UserSession;
    if (!data?.id) return null;
    return data;
  } catch {
    return null;
  }
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<boolean> {
  const user = await verifyUserSessionToken(token);
  return Boolean(user);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function getCurrentUser(cookieGetter?: {
  get: (name: string) => { value: string } | undefined;
}): Promise<UserSession | null> {
  const authEnabled = isAuthEnabled();

  // In Development Mode:
  if (!authEnabled) {
    const devUserId =
      process.env.DEV_USER_ID?.trim() ||
      process.env.OWNER_DISCORD_ID?.trim() ||
      "";

    const acceptedIds = await getAcceptedAdminIds();
    const devIds = devUserId ? devUserId.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const isOwner = devIds.some((id) => acceptedIds.includes(id));

    return {
      id: devUserId || "dev-user",
      username: isOwner ? "Bot Owner (Dev)" : "Server Admin (Dev)",
      avatar: null,
      globalName: isOwner ? "Bot Owner" : "Dev User",
      isOwner,
      managedGuildIds: (process.env.DEV_MANAGED_GUILD_IDS || process.env.GUILD_ID || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  // In Production Mode:
  let cookieObj = cookieGetter;
  if (!cookieObj) {
    try {
      const { cookies } = await import("next/headers");
      cookieObj = await cookies();
    } catch {
      // not in request context
    }
  }

  const token = cookieObj?.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return verifyUserSessionToken(token);
}

export async function checkAdminAccess(options?: {
  sessionCookie?: string | null;
  adminCookie?: string | null;
}): Promise<boolean> {
  const user = await getCurrentUser(
    options?.sessionCookie
      ? { get: () => ({ value: options.sessionCookie! }) }
      : undefined
  );
  return Boolean(user?.isOwner);
}

export const OAUTH_STATE_COOKIE = "neverland_oauth_state";

export function sanitizeRedirectPath(path: string | null | undefined): string {
  if (!path) return "/servers";
  // Must start with exactly one "/" and never with "//" or "/\"
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/servers";
  }
  if (path === "/login") {
    return "/servers";
  }
  try {
    const parsed = new URL(path, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return "/servers";
    }
    return parsed.pathname + parsed.search;
  } catch {
    return "/servers";
  }
}

/**
 * Dynamically resolves the canonical public base URL of the dashboard.
 * Prioritizes:
 * 1. Forwarded headers from reverse proxies (X-Forwarded-Host, X-Forwarded-Proto)
 * 2. NEXT_PUBLIC_APP_URL if configured and not pointing to internal 0.0.0.0
 * 3. DISCORD_REDIRECT_URI origin
 * 4. Request URL origin (if not 0.0.0.0)
 * 5. Fallback localhost
 */
export function getAppBaseUrl(request?: { headers?: { get: (name: string) => string | null }; url?: string }): string {
  // 1. Check request headers first (dynamically adapts to reverse proxy, subdomain, Cloudflare, etc.)
  if (request?.headers) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost || request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") || "https";

    if (host && !host.startsWith("0.0.0.0") && !host.startsWith("127.0.0.1")) {
      return `${proto}://${host}`;
    }
  }

  // 2. Check NEXT_PUBLIC_APP_URL environment variable
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl && !envUrl.includes("0.0.0.0") && !envUrl.includes("127.0.0.1")) {
    return envUrl.replace(/\/+$/, "");
  }

  // 3. Check DISCORD_REDIRECT_URI origin
  if (process.env.DISCORD_REDIRECT_URI) {
    try {
      const parsed = new URL(process.env.DISCORD_REDIRECT_URI);
      if (!parsed.hostname.startsWith("0.0.0.0") && !parsed.hostname.startsWith("127.0.0.1")) {
        return parsed.origin;
      }
    } catch {}
  }

  // 4. Request URL origin fallback if valid and not 0.0.0.0
  if (request?.url) {
    try {
      const url = new URL(request.url);
      if (!url.hostname.startsWith("0.0.0.0") && !url.hostname.startsWith("127.0.0.1")) {
        return url.origin;
      }
    } catch {}
  }

  return envUrl ? envUrl.replace(/\/+$/, "") : "http://localhost:3000";
}

/**
 * Creates an absolute URL for redirects that is guaranteed to point to the
 * valid public domain, preventing redirects to internal binding addresses like 0.0.0.0.
 */
export function createRedirectUrl(destination: string, request?: { headers?: { get: (name: string) => string | null }; url?: string }): URL {
  const base = getAppBaseUrl(request);
  const cleanPath = destination.startsWith("/") ? destination : `/${destination}`;
  return new URL(cleanPath, base);
}

export function getDiscordOAuthUrl(state?: string, request?: { headers?: { get: (name: string) => string | null }; url?: string }): string {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    `${getAppBaseUrl(request)}/api/auth/callback/discord`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify guilds",
    prompt: "consent",
  });

  if (state) {
    params.set("state", state);
  }

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface DiscordUserResponse {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name?: string | null;
}

export interface DiscordGuildResponse {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export async function exchangeDiscordCode(
  code: string,
  redirectUri: string
): Promise<DiscordTokenResponse> {
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to exchange Discord code (${res.status}): ${errText}`);
  }

  return (await res.json()) as DiscordTokenResponse;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUserResponse> {
  const res = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Discord user profile (${res.status})`);
  }
  return (await res.json()) as DiscordUserResponse;
}

export async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuildResponse[]> {
  const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Discord user guilds (${res.status})`);
  }
  return (await res.json()) as DiscordGuildResponse[];
}

/**
 * Checks if a user has Admin permissions.
 * Permissions bit 0x8 = ADMINISTRATOR.
 * MANAGE_GUILD (0x20) is intentionally excluded per security requirements:
 * a user MUST have the Administrator permission/role or be the server owner.
 */
export function canManageGuild(guild: DiscordGuildResponse): boolean {
  if (guild.owner) return true;
  try {
    const perms = BigInt(guild.permissions);
    const ADMINISTRATOR = BigInt(0x8);
    return (perms & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}
