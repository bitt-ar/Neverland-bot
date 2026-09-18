import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Hash,
  Info,
  Layers,
  Shield,
  Tags,
  Ticket,
  UserPlus,
  Users,
  Volume2,
} from "lucide-react";

import {
  getGuildOverview,
  getGuildModulesOverview,
  GuildOverview,
  ModuleOverviewItem,
  ControlPlaneError,
} from "@/lib/control-plane";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RetryButton } from "@/components/retry-button";

export const dynamic = "force-dynamic";

interface BuiltModuleDef {
  key: string;
  name: string;
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  getStatText: (
    stats: Record<string, unknown> | undefined,
    ov: GuildOverview["stats"]
  ) => { value: string | number; subtitle: string };
}

const BUILT_MODULES: BuiltModuleDef[] = [
  {
    key: "reaction_roles",
    name: "reaction_roles",
    path: "automation/reaction-roles",
    label: "Reaction Roles",
    icon: Tags,
    getStatText: (stats, ov) => {
      const count = typeof stats?.pairs === "number" ? stats.pairs : ov.reaction_role_pairs;
      return { value: count, subtitle: count === 1 ? "active pair" : "active pairs" };
    },
  },
  {
    key: "welcome",
    name: "welcome",
    path: "automation/welcome",
    label: "Welcome",
    icon: UserPlus,
    getStatText: (stats) => {
      const hasChannel = Boolean(stats?.channel_id);
      return {
        value: hasChannel ? "Active" : "No Channel",
        subtitle: hasChannel ? "Channel configured" : "Messages disabled",
      };
    },
  },
  {
    key: "leveling",
    name: "leveling",
    path: "community/leveling",
    label: "Leveling",
    icon: Award,
    getStatText: (stats, ov) => {
      const count = typeof stats?.users === "number" ? stats.users : ov.level_users;
      return { value: count, subtitle: count === 1 ? "member tracked" : "members tracked" };
    },
  },
  {
    key: "temp_voice",
    name: "temp_voice",
    path: "community/temp-voice",
    label: "Temp Voice",
    icon: Volume2,
    getStatText: (stats) => {
      const count = typeof stats?.active_channels === "number" ? stats.active_channels : 0;
      return { value: count, subtitle: count === 1 ? "active lounge" : "active lounges" };
    },
  },
  {
    key: "tickets",
    name: "tickets",
    path: "community/tickets",
    label: "Tickets",
    icon: Ticket,
    getStatText: (stats, ov) => {
      const count = typeof stats?.tickets === "number" ? stats.tickets : ov.tickets;
      return { value: count, subtitle: count === 1 ? "ticket logged" : "tickets logged" };
    },
  },
];

export default async function ServerGeneralPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;

  let overview: GuildOverview | null = null;
  let modulesList: ModuleOverviewItem[] = [];
  let error: string | null = null;
  let notFound = false;

  try {
    const [ov, mods] = await Promise.all([
      getGuildOverview(guildId),
      getGuildModulesOverview(guildId).catch(() => [] as ModuleOverviewItem[]),
    ]);
    overview = ov;
    modulesList = mods || [];
  } catch (err: unknown) {
    notFound = err instanceof ControlPlaneError && err.status === 404;
    error =
      err instanceof ControlPlaneError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Failed to load server data";
  }

  if (error || !overview) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Server General</h1>
          <p className="text-sm text-muted-foreground">
            Read-only server identity and configuration overview.
          </p>
        </div>

        <Card className={notFound ? "border border-border/80 max-w-2xl" : "border-destructive/30 bg-destructive/5 max-w-2xl"}>
          <CardHeader>
            <div className={`flex items-center gap-2 ${notFound ? "text-muted-foreground" : "text-destructive"}`}>
              {notFound ? <Info className="size-5" /> : <AlertTriangle className="size-5" />}
              <CardTitle className={notFound ? "" : "text-destructive"}>
                {notFound ? "Bot is not in this server" : "Failed to Load Server Information"}
              </CardTitle>
            </div>
            <CardDescription className={notFound ? "" : "text-destructive/80"}>
              {notFound
                ? `The bot is not a member of guild ${guildId}. Pick one of the servers the bot is in instead.`
                : `The control plane could not provide identity details for guild ${guildId}.`}
            </CardDescription>
          </CardHeader>
          {!notFound && (
            <CardContent className="space-y-2">
              <p className="text-sm text-foreground/90 font-medium">{error}</p>
            </CardContent>
          )}
          <CardFooter className="flex items-center gap-3">
            <Button variant="outline" size="sm" render={<Link href="/servers" />}>
              <span>All Servers</span>
            </Button>
            {!notFound && <RetryButton checkPath={`/api/internal/guilds/${guildId}/overview`} />}
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Build live map by module name
  const modulesMap = new Map<string, ModuleOverviewItem>();
  for (const m of modulesList) {
    modulesMap.set(m.name, m);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Server General</h1>
        <p className="text-sm text-muted-foreground">
          Identity, live stats, and module snapshot for {overview.name}.
        </p>
      </div>

      {/* Main Definition Grid Card */}
      <Card className="border border-border/80">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="size-14 rounded-lg border border-border shrink-0">
                {overview.icon_url && (
                  <AvatarImage src={overview.icon_url} alt={overview.name} />
                )}
                <AvatarFallback className="rounded-lg bg-muted text-base font-semibold">
                  {overview.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg truncate">{overview.name}</CardTitle>
                <CardDescription className="font-mono text-xs truncate">
                  ID: {overview.id}
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-xs shrink-0">
              Bot Status: {overview.bot_status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Server Name */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1 min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Server Name</dt>
              <dd className="text-sm font-semibold text-foreground truncate break-words">{overview.name}</dd>
            </div>

            {/* Guild ID */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1 min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Guild Snowflake ID</dt>
              <dd className="font-mono text-xs font-semibold text-foreground select-all break-all">{overview.id}</dd>
            </div>

            {/* Server Icon */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1 min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Server Icon</dt>
              <dd className="text-xs text-foreground min-w-0">
                {overview.icon_url ? (
                  <a
                    href={overview.icon_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono break-all block"
                  >
                    {overview.icon_url}
                  </a>
                ) : (
                  <span className="text-muted-foreground italic">None configured</span>
                )}
              </dd>
            </div>

            {/* Member Counts */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1 min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Member Counts</dt>
              <dd className="text-sm text-foreground flex items-center gap-2 sm:gap-3 flex-wrap">
                <span className="font-semibold">
                  {overview.member_count !== null ? `${overview.member_count.toLocaleString()} total` : "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({overview.online_count !== null ? `${overview.online_count.toLocaleString()} online` : "Presence unavailable"})
                </span>
              </dd>
            </div>

            {/* Channel Breakdown */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">Channels ({overview.channels.total} total)</dt>
              <dd className="text-xs text-muted-foreground flex flex-wrap gap-2 pt-0.5">
                <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                  {overview.channels.text} text
                </span>
                <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                  {overview.channels.voice} voice
                </span>
                <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                  {overview.channels.categories} categories
                </span>
              </dd>
            </div>

            {/* Roles Count */}
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-1">
              <dt className="text-xs font-medium text-muted-foreground">Roles</dt>
              <dd className="text-sm font-semibold text-foreground">
                {overview.roles} configured roles
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Server Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Members
            </span>
            <Users className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {overview.member_count !== null ? overview.member_count.toLocaleString() : "—"}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            {overview.online_count !== null
              ? `${overview.online_count.toLocaleString()} online in cache`
              : "Presence unavailable"}
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
            {overview.channels.total}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
            <span>{overview.channels.text} text</span>
            <span>•</span>
            <span>{overview.channels.voice} voice</span>
          </div>
        </div>

        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Roles
            </span>
            <Shield className="size-3.5 text-muted-foreground" />
          </div>
          <div className="text-xl font-bold font-mono tracking-tight text-foreground">
            {overview.roles}
          </div>
          <p className="text-[11px] text-muted-foreground font-mono">
            Configured discord roles
          </p>
        </div>
      </div>

      {/* Feature Snapshot (Live module states for this server) */}
      <div className="rounded-[4px] border border-border/70 bg-card p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Feature Snapshot</h3>
            <p className="text-xs text-muted-foreground">
              Operational module status and quick parameters for this server.
            </p>
          </div>
          <Layers className="size-4 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {BUILT_MODULES.map((modDef) => {
            const liveItem = modulesMap.get(modDef.name);
            const isEnabled = liveItem !== undefined ? liveItem.enabled : true;
            const Icon = modDef.icon;
            const stat = modDef.getStatText(liveItem?.stats, overview.stats);

            return (
              <Link
                key={modDef.key}
                href={`/g/${guildId}/${modDef.path}`}
                className="group rounded-[4px] border border-border/70 bg-muted/10 p-3 hover:border-primary/50 hover:bg-muted/25 transition-colors flex flex-col justify-between space-y-3 min-w-0"
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="size-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    <span className="text-xs font-semibold text-foreground truncate">
                      {modDef.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`size-1.5 rounded-full ${
                        isEnabled ? "bg-emerald-400" : "bg-zinc-600"
                      }`}
                    />
                    <span
                      className={`text-[10px] font-mono ${
                        isEnabled ? "text-emerald-400" : "text-muted-foreground"
                      }`}
                    >
                      {isEnabled ? "ACTIVE" : "OFF"}
                    </span>
                  </div>
                </div>

                <div className="space-y-0.5 min-w-0">
                  <div className="text-base font-bold font-mono tracking-tight text-foreground truncate">
                    {stat.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {stat.subtitle}
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">
                  <span>Manage</span>
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
