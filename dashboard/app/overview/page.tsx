import Link from "next/link";
import {
  Users,
  Hash,
  Shield,
  Layers,
  Settings,
  AlertTriangle,
  Info,
  ArrowRight,
  Tags,
  UserPlus,
  Award,
  Volume2,
  Ticket,
} from "lucide-react";

import {
  getGuildOverview,
  getGuildModulesOverview,
  getHealth,
  GuildOverview,
  ModuleOverviewItem,
  HealthResponse,
  ControlPlaneError,
} from "@/lib/control-plane";
import { getTicketsList, TicketItem } from "@/lib/modules/tickets";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RetryButton } from "@/components/retry-button";

export const dynamic = "force-dynamic";

interface BuiltModuleDef {
  key: string;
  name: string;
  href: string;
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
    href: "/automation/reaction-roles",
    label: "Reaction Roles",
    icon: Tags,
    getStatText: (stats, ov) => {
      const count = typeof stats?.pairs === "number" ? stats.pairs : ov.reaction_role_pairs;
      return {
        value: count,
        subtitle: count === 1 ? "active pair" : "active pairs",
      };
    },
  },
  {
    key: "welcome",
    name: "welcome",
    href: "/automation/welcome",
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
    href: "/community/leveling",
    label: "Leveling",
    icon: Award,
    getStatText: (stats, ov) => {
      const count = typeof stats?.users === "number" ? stats.users : ov.level_users;
      return {
        value: count,
        subtitle: count === 1 ? "member tracked" : "members tracked",
      };
    },
  },
  {
    key: "temp_voice",
    name: "temp_voice",
    href: "/community/temp-voice",
    label: "Temp Voice",
    icon: Volume2,
    getStatText: (stats) => {
      const count = typeof stats?.active_channels === "number" ? stats.active_channels : 0;
      return {
        value: count,
        subtitle: count === 1 ? "active lounge" : "active lounges",
      };
    },
  },
  {
    key: "tickets",
    name: "tickets",
    href: "/community/tickets",
    label: "Tickets",
    icon: Ticket,
    getStatText: (stats, ov) => {
      const count = typeof stats?.tickets === "number" ? stats.tickets : ov.tickets;
      return {
        value: count,
        subtitle: count === 1 ? "ticket logged" : "tickets logged",
      };
    },
  },
];

const UNBUILT_MODULES = [
  { name: "moderation", label: "Moderation", desc: "Infractions & automod strikes" },
  { name: "logging", label: "Logging", desc: "Channel & role audit trail" },
  { name: "automod", label: "AutoMod", desc: "Filter spam, invites & links" },
  { name: "custom_commands", label: "Custom Commands", desc: "Server macros & triggers" },
];


export default async function OverviewPage() {
  const guildId = process.env.GUILD_ID;

  // Empty/dev state: GUILD_ID unset
  if (!guildId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">
            Server metrics and module status.
          </p>
        </div>

        <Card className="border border-border/80 max-w-2xl bg-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Dev Setup Required: GUILD_ID Unset</CardTitle>
            </div>
            <CardDescription className="text-xs">
              The dashboard is running in development mode, but no guild has been configured yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              To inspect server metrics and manage bot modules, specify your Discord Server (Guild) ID
              in your environment variables.
            </p>
            <div className="rounded-[4px] bg-muted/50 p-2.5 font-mono text-xs text-foreground select-all border border-border/60">
              GUILD_ID=your_discord_guild_id_here
            </div>
            <p className="text-[11px] text-muted-foreground">
              Add this to your <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">.env</code> file
              and restart the dashboard server.
            </p>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button variant="outline" size="sm" render={<Link href="/settings" />} className="text-xs">
              <Settings className="size-3.5 mr-1" />
              <span>View Diagnostics</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Fetch overview, modules, tickets, and health in parallel
  let overview: GuildOverview | null = null;
  let modulesList: ModuleOverviewItem[] = [];
  let ticketsList: TicketItem[] = [];
  let health: HealthResponse = { status: "ok", db: true, version: "0.1.0" };
  let error: string | null = null;

  try {
    const [ov, mods, tix, hlth] = await Promise.all([
      getGuildOverview(guildId),
      getGuildModulesOverview(guildId).catch(() => []),
      getTicketsList(guildId).catch(() => []),
      getHealth().catch(() => ({ status: "ok", db: true, version: "0.1.0" })),
    ]);
    overview = ov;
    modulesList = mods || [];
    ticketsList = tix || [];
    health = hlth;
  } catch (err: unknown) {
    error =
      err instanceof ControlPlaneError
        ? err.message
        : err instanceof Error
        ? err.message
        : "Failed to connect to control plane";
  }

  // Error state: Card with Retry
  if (error || !overview) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Overview</h1>
          <p className="text-xs text-muted-foreground">
            Server metrics and module status.
          </p>
        </div>

        <Card className="border-destructive/40 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" />
              <CardTitle className="text-sm font-semibold text-destructive">Failed to Load Server Overview</CardTitle>
            </div>
            <CardDescription className="text-xs text-destructive/80">
              The control plane could not provide overview data for guild {guildId}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-foreground/90 font-mono">{error}</p>
            <p className="text-[11px] text-muted-foreground">
              Verify that the bot process is running, <code className="font-mono bg-muted px-1 py-0.5 rounded text-[10px]">CONTROL_PLANE_SECRET</code> matches, and the bot is joined to the specified guild.
            </p>
          </CardContent>
          <CardFooter className="flex items-center gap-3">
            <RetryButton checkPath={`/api/internal/guilds/${guildId}/overview`} />
            <Button variant="ghost" size="sm" render={<Link href="/settings" />} className="text-xs">
              <span>Diagnostics</span>
            </Button>
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
    <div className="space-y-6 min-w-0 font-sans">
      {/* Real Interactive Logs & Analytics */}
      <LogsAnalyticsView
        guildId={guildId}
        overview={overview}
        modulesList={modulesList}
        tickets={ticketsList}
        health={health}
      />

      {/* Grid of Server Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Card 1: Server Identity */}
        <div className="rounded-[4px] border border-border/70 bg-card p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium text-muted-foreground uppercase">
              Target Server
            </span>
            <span className="size-2 rounded-full bg-emerald-400" />
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="size-8 rounded-[4px] border border-border shrink-0">
              {overview.icon_url && (
                <AvatarImage src={overview.icon_url} alt={overview.name} />
              )}
              <AvatarFallback className="rounded-[4px] bg-muted text-xs font-semibold">
                {overview.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-xs truncate text-foreground">{overview.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground truncate">
                {overview.id}
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Members */}
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
              : "Presence cached"}
          </p>
        </div>

        {/* Card 3: Channels Breakdown */}
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

        {/* Card 4: Roles */}
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

      {/* Feature Snapshot (Live module states) */}
      <div className="rounded-[4px] border border-border/70 bg-card p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Feature Snapshot</h3>
            <p className="text-xs text-muted-foreground">
              Operational module status and quick parameters.
            </p>
          </div>
          <Layers className="size-4 text-muted-foreground" />
        </div>

        {/* Built Modules Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {BUILT_MODULES.map((modDef) => {
            const liveItem = modulesMap.get(modDef.name);
            const isEnabled = liveItem !== undefined ? liveItem.enabled : true;
            const Icon = modDef.icon;
            const stat = modDef.getStatText(liveItem?.stats, overview.stats);

            return (
              <Link
                key={modDef.key}
                href={modDef.href}
                className="group rounded-[4px] border border-border/70 bg-muted/10 p-3 hover:border-primary/50 hover:bg-muted/25 transition-colors flex flex-col justify-between space-y-3 min-w-0"
              >
                {/* Header: Title + Live Status Dot */}
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

                {/* Stat / Metric */}
                <div className="space-y-0.5 min-w-0">
                  <div className="text-base font-bold font-mono tracking-tight text-foreground truncate">
                    {stat.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {stat.subtitle}
                  </div>
                </div>

                {/* Bottom Action Hint */}
                <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">
                  <span>Manage</span>
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Roadmap Modules */}
        <div className="pt-3 border-t border-border/60">
          <div className="mb-2 text-[11px] font-mono text-muted-foreground uppercase font-semibold">
            Roadmap Modules (Unbuilt)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {u.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
