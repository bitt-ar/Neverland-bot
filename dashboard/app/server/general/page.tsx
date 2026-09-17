import Link from "next/link";
import { AlertTriangle, Info, Settings } from "lucide-react";

import { getGuildOverview, GuildOverview, ControlPlaneError } from "@/lib/control-plane";
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

export default async function ServerGeneralPage() {
  const guildId = process.env.GUILD_ID;

  if (!guildId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Server General</h1>
          <p className="text-sm text-muted-foreground">
            Read-only server identity and configuration overview.
          </p>
        </div>

        <Card className="border border-border/80 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="size-5 text-muted-foreground" />
              <CardTitle>Dev Setup Required: GUILD_ID Unset</CardTitle>
            </div>
            <CardDescription>
              The dashboard is running in development mode, but no guild has been configured yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              To inspect server identity and properties, configure your Discord Server (Guild) ID
              in the environment.
            </p>
            <div className="rounded-md bg-muted/60 p-3 font-mono text-xs text-foreground select-all">
              GUILD_ID=your_discord_guild_id_here
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm" render={<Link href="/settings" />}>
              <Settings className="size-3.5" />
              <span>View Settings & Diagnostics</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  let overview: GuildOverview | null = null;
  let error: string | null = null;

  try {
    overview = await getGuildOverview(guildId);
  } catch (err: unknown) {
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

        <Card className="border-destructive/30 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-destructive">Failed to Load Server Information</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              The control plane could not provide identity details for guild {guildId}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground/90 font-medium">{error}</p>
          </CardContent>
          <CardFooter className="flex items-center gap-3">
            <RetryButton checkPath={`/api/internal/guilds/${guildId}/overview`} />
            <Button variant="ghost" size="sm" render={<Link href="/overview" />}>
              <span>Back to Overview</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Server General</h1>
        <p className="text-sm text-muted-foreground">
          Read-only identity and cache attributes for {overview.name}.
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
    </div>
  );
}
