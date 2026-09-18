import Link from "next/link";
import { cookies } from "next/headers";
import {
  Users,
  Hash,
  Layers,
  AlertTriangle,
  ArrowRight,
  Server,
  Wrench,
} from "lucide-react";

import {
  getBotStats,
  getGuilds,
  getHealth,
  BotStats,
  GuildOverview,
  GuildSummary,
  HealthResponse,
  ControlPlaneError,
} from "@/lib/control-plane";
import { SESSION_COOKIE, checkAdminAccess } from "@/lib/auth";
import { LogsAnalyticsView } from "@/components/logs-analytics-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RetryButton } from "@/components/retry-button";

export const dynamic = "force-dynamic";

const UNBUILT_MODULES = [
  { name: "logging", label: "Logging", desc: "Channel & role audit trail" },
  { name: "automod", label: "AutoMod", desc: "Filter spam, invites & links" },
  { name: "custom_commands", label: "Custom Commands", desc: "Server macros & triggers" },
];

export default async function OverviewPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value || null;

  const isAdmin = await checkAdminAccess({ sessionCookie });
  if (!isAdmin) {
    notFound();
  }

  let stats: BotStats | null = null;
  let guilds: GuildSummary[] = [];
  let health: HealthResponse = { status: "ok", db: true, version: "0.1.0" };
  let error: string | null = null;

  try {
    const [st, gl, hlth] = await Promise.all([
      getBotStats(),
      getGuilds().catch(() => [] as GuildSummary[]),
      getHealth().catch(() => ({ status: "ok", db: true, version: "0.1.0" }) as HealthResponse),
    ]);
    stats = st;
    guilds = gl;
    health = hlth;
  } catch (err: unknown) {
    error =
      err instanceof ControlPlaneError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Failed to connect to control plane";
  }

  if (error || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">
            Bot-wide metrics across all servers the bot is in.
          </p>
        </div>

        <Card className="border-destructive/40 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <CardTitle className="text-sm font-semibold text-destructive">
                Failed to Load Bot Stats
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-destructive/80">
              The control plane could not provide bot-wide statistics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-foreground/90 font-mono">{error}</p>
            <p className="text-[11px] text-muted-foreground">
              Verify that the bot process is running and{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">
                CONTROL_PLANE_SECRET
              </code>{" "}
              matches.
            </p>
          </CardContent>
          <CardFooter className="flex items-center gap-3">
            <RetryButton checkPath="/api/internal/stats" />
            <Button variant="ghost" size="sm" render={<Link href="/settings" />} className="text-xs">
              <span>Diagnostics</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const modulesEnabledTotal = Object.values(stats.modules_enabled || {}).reduce(
    (sum, count) => sum + count,
    0
  );
  const topModules = Object.entries(stats.modules_enabled || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Synthetic bot-wide overview so Logs & Analytics renders on global data.
  const globalOverview: GuildOverview = {
    id: "all-servers",
    name: "All Servers",
    icon_url: null,
    member_count: stats.total_members,
    online_count: null,
    channels: { text: 0, voice: 0, categories: 0, total: stats.total_channels },
    roles: stats.total_roles,
    bot_status: health.status === "ok" ? "connected" : "offline",
    stats: { reaction_role_pairs: 0, level_users: 0, tickets: 0 },
  };

  return (
    <div className="space-y-6 min-w-0 font-sans">
      {/* Logs & Analytics (global feed) */}
      <LogsAnalyticsView
        guildId="all-servers"
        overview={globalOverview}
        modulesList={[]}
        tickets={[]}
        health={health}
      />

      {/* Bot-wide stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Servers
            </span>
            <Server className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {stats.guild_count.toLocaleString()}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            servers with the bot
          </p>
        </div>

        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Members
            </span>
            <Users className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {stats.total_members.toLocaleString()}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            across all servers
          </p>
        </div>

        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Channels
            </span>
            <Hash className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {stats.total_channels.toLocaleString()}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            {stats.total_roles.toLocaleString()} roles in total
          </p>
        </div>

        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Modules
            </span>
            <Layers className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {modulesEnabledTotal.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground flex-wrap">
            {topModules.length > 0 ? (
              topModules.map(([name, count]) => (
                <span key={name} className="rounded bg-muted px-1.5 py-0.5">
                  {name}: {count}
                </span>
              ))
            ) : (
              <span>no modules enabled yet</span>
            )}
          </div>
        </div>
      </div>

      {/* All servers list */}
      <div className="rounded-[4px] border border-border/70 bg-card p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Servers</h3>
            <p className="text-xs text-muted-foreground">
              Every server the bot is a member of. Open one to manage its settings.
            </p>
          </div>
          <Wrench className="size-4 text-muted-foreground" />
        </div>

        {guilds.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3">
            No servers reported by the control plane yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {guilds.map((guild) => (
              <Link
                key={guild.id}
                href={`/g/${guild.id}/server/general`}
                className="group rounded-[4px] border border-border/70 bg-muted/10 p-3 hover:border-primary/50 hover:bg-muted/25 transition-colors space-y-3 min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="size-8 rounded-[4px] border border-border shrink-0">
                    {guild.icon_url && (
                      <AvatarImage src={guild.icon_url} alt={guild.name} />
                    )}
                    <AvatarFallback className="rounded-[4px] bg-muted text-xs font-semibold">
                      {guild.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground truncate">
                      {guild.name}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      {guild.id}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span>
                    {guild.member_count !== null && guild.member_count !== undefined
                      ? `${guild.member_count.toLocaleString()} members`
                      : "—"}
                  </span>
                  <span className="flex items-center gap-1 group-hover:text-foreground transition-colors">
                    Manage
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Roadmap (Unbuilt) */}
      <div className="rounded-[4px] border border-border/70 bg-card p-4 space-y-3">
        <div className="text-[11px] font-mono text-muted-foreground uppercase font-semibold">
          Roadmap Modules (Unbuilt)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {UNBUILT_MODULES.map((u) => (
            <div
              key={u.name}
              className="rounded-[4px] border border-border/40 bg-muted/10 p-2.5 flex flex-col justify-between space-y-1 opacity-70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{u.label}</span>
                <Badge
                  variant="outline"
                  className="text-[9px] font-mono text-muted-foreground border-border/60 font-normal px-1 py-0"
                >
                  Unbuilt
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">{u.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
