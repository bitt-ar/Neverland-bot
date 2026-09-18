import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Activity, CheckCircle2, Cpu, KeyRound, XCircle } from "lucide-react";

import pkg from "../../package.json";
import { getHealth, HealthResponse } from "@/lib/control-plane";
import { getDevAdminIds, isAuthEnabled, checkAdminAccess, SESSION_COOKIE } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RetryButton } from "@/components/retry-button";
import { DiscordLiveLogs } from "./discord-live-logs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value || null;

  const isAdmin = await checkAdminAccess({ sessionCookie });
  if (!isAdmin) {
    notFound();
  }

  const isSecretConfigured = Boolean(process.env.CONTROL_PLANE_SECRET);
  const guildId = process.env.GUILD_ID;
  const authEnabled = isAuthEnabled();
  const devUserId = process.env.DEV_USER_ID || process.env.OWNER_DISCORD_ID || "Not configured";
  const discordClientId = process.env.DISCORD_CLIENT_ID;
  const adminIdsConfigured = getDevAdminIds().length > 0;
  const dashboardVersion = pkg.version || "0.1.0";

  let health: HealthResponse | null = null;
  try {
    health = await getHealth();
  } catch {
    health = null;
  }

  const isControlPlaneOnline = health?.status === "ok";
  const isDbConnected = Boolean(health?.db);
  const botVersion = health?.version || (isControlPlaneOnline ? "0.1.0" : "Offline / Unreachable");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings & Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            System configuration, service health, and runtime diagnostic parameters.
          </p>
        </div>
        <RetryButton checkPath="/api/internal/health" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Control Plane Health */}
        <Card className="border border-border/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Control Plane Health</CardTitle>
              </div>
              <Badge
                variant="outline"
                className={
                  isControlPlaneOnline
                    ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10 text-xs"
                    : "border-destructive/30 text-destructive bg-destructive/10 text-xs"
                }
              >
                {isControlPlaneOnline ? (
                  <>
                    <CheckCircle2 className="size-3 mr-1" />
                    Online
                  </>
                ) : (
                  <>
                    <XCircle className="size-3 mr-1" />
                    Offline
                  </>
                )}
              </Badge>
            </div>
            <CardDescription>
              HTTP connection status to bot control plane daemon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Endpoint</span>
              <span className="font-mono text-foreground break-all text-right">
                {process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Database Ping</span>
              <span className="flex items-center gap-1.5 font-medium">
                {isDbConnected ? (
                  <span className="text-emerald-500">Connected</span>
                ) : (
                  <span className="text-muted-foreground">Disconnected</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Health Check</span>
              <span className="font-mono text-muted-foreground break-all">
                {isControlPlaneOnline ? "GET /health 200 OK" : "Unreachable"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Environment Configuration */}
        <Card className="border border-border/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Environment & Auth</CardTitle>
              </div>
            </div>
            <CardDescription>
              Internal secret presence and developer credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            {/* CONTROL_PLANE_SECRET boolean check */}
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Control Plane Secret</span>
              <Badge
                variant="outline"
                className={
                  isSecretConfigured
                    ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10 shrink-0"
                    : "border-destructive/30 text-destructive bg-destructive/10 shrink-0"
                }
              >
                {isSecretConfigured ? "Configured (Hidden)" : "Not Configured"}
              </Badge>
            </div>

            {/* GUILD_ID presence (dev-mode default guild) */}
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">GUILD_ID (Dev default)</span>
              {guildId ? (
                <span className="font-mono text-foreground font-semibold break-all">{guildId}</span>
              ) : (
                <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/10 shrink-0">
                  Unset
                </Badge>
              )}
            </div>

            {/* Auth mode */}
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Authentication</span>
              <Badge variant="secondary" className="font-normal text-[11px] shrink-0">
                {authEnabled ? "Discord OAuth2 (Production)" : "DEV_USER_ID Simulation (Dev Mode)"}
              </Badge>
            </div>

            {/* Active Developer User */}
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Dev User / Owner ID</span>
              <span className="font-mono text-foreground font-semibold break-all">{devUserId}</span>
            </div>

            {/* Discord OAuth Client ID */}
            <div className="flex items-center justify-between text-xs border-b border-border/40 pb-2 flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">Discord Client ID</span>
              <Badge
                variant="outline"
                className={
                  discordClientId
                    ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10 shrink-0 font-mono"
                    : "border-amber-500/30 text-amber-500 bg-amber-500/10 shrink-0"
                }
              >
                {discordClientId || "Not Set"}
              </Badge>
            </div>

            {/* ADMIN_DISCORD_IDS presence */}
            <div className="flex items-center justify-between text-xs flex-wrap gap-1.5 min-w-0">
              <span className="text-muted-foreground shrink-0">ADMIN_DISCORD_IDS</span>
              <Badge variant="secondary" className="font-normal text-[11px] shrink-0">
                {adminIdsConfigured ? "Configured" : "Unset (app owner used)"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Discord Live Server Logs (with slow mode and crash watchdog) */}
        <DiscordLiveLogs />

        {/* Card 3: Version Info */}
        <Card className="border border-border/80 md:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Version Information</CardTitle>
            </div>
            <CardDescription>
              Software versions for the Neverland ecosystem components.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1">
              <div className="text-xs text-muted-foreground font-medium">Dashboard Version</div>
              <div className="font-mono text-base font-semibold text-foreground">
                v{dashboardVersion}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Next.js 15 App Router + Tailwind v4
              </div>
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1">
              <div className="text-xs text-muted-foreground font-medium">Bot & Control Plane</div>
              <div className="font-mono text-base font-semibold text-foreground">
                v{botVersion}
              </div>
              <div className="text-[11px] text-muted-foreground">
                discord.py + aiohttp internal daemon
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
