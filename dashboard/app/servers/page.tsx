import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Info, PlusCircle, Server, Users } from "lucide-react";

import { getBotInviteUrl, getGuilds, GuildSummary } from "@/lib/control-plane";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const user = await getCurrentUser();

  if (!user && isAuthEnabled()) {
    redirect("/login");
  }

  let allGuilds: GuildSummary[] = [];
  let error: string | null = null;

  try {
    allGuilds = await getGuilds(user?.id);
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : "Failed to connect to control plane";
  }

  // Filter guilds based on user ownership or live bot admin permissions:
  // Both Bot Owner and Regular User only see servers where they hold Administrator or Ownership!
  const isOwner = Boolean(user?.isOwner);
  const userIds = user?.id ? user.id.split(",").map((s) => s.trim()) : [];
  const visibleGuilds = allGuilds.filter((g) => {
    if (!isAuthEnabled() || isOwner) return true;
    if (g.is_admin === true) return true;
    if (userIds.includes(g.owner_id)) return true;
    return false;
  });

  const botInviteUrl = await getBotInviteUrl();

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Servers</h1>
            {isOwner && (
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                Bot Owner
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono border-border/80 text-muted-foreground">
              My Connected Servers
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Discord servers where you have management permissions and Neverland bot is connected.
          </p>
        </div>

        {botInviteUrl && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 self-start sm:self-auto"
            render={<a href={botInviteUrl} target="_blank" rel="noreferrer" />}
          >
            <PlusCircle className="size-3.5" />
            <span>Invite Bot</span>
          </Button>
        )}
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <CardTitle className="text-sm font-semibold text-destructive">
              Failed to Load Server List
            </CardTitle>
            <CardDescription className="text-xs text-destructive/80">
              The control plane is unreachable or rejected the request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-foreground/90 font-mono">{error}</p>
          </CardContent>
        </Card>
      ) : visibleGuilds.length === 0 ? (
        <Card className="border border-border/80 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="size-5 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">
                No connected servers found
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              You don&apos;t currently own or manage any servers where Neverland bot is added. Invite the bot to your server to configure and manage it here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {botInviteUrl && (
              <Button
                className="text-xs gap-1.5"
                render={<a href={botInviteUrl} target="_blank" rel="noreferrer" />}
              >
                <PlusCircle className="size-3.5" />
                <span>Invite Neverland Bot</span>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleGuilds.map((guild) => (
            <Card
              key={guild.id}
              className="group border border-border/80 hover:border-primary/50 transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="size-10 rounded-[6px] border border-border shrink-0">
                    {guild.icon_url && (
                      <AvatarImage src={guild.icon_url} alt={guild.name} />
                    )}
                    <AvatarFallback className="rounded-[6px] bg-muted text-sm font-semibold">
                      {guild.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm truncate">{guild.name}</CardTitle>
                    <CardDescription className="font-mono text-[10px] truncate">
                      {guild.id}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <Users className="size-3.5" />
                    {guild.member_count !== null && guild.member_count !== undefined
                      ? guild.member_count.toLocaleString()
                      : "—"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    render={<Link href={`/g/${guild.id}/server/general`} />}
                  >
                    <Server className="size-3.5" />
                    <span>Manage</span>
                    <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
