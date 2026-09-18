import Link from "next/link";
import { AlertTriangle, ArrowLeft, Info, ShieldAlert } from "lucide-react";

import { ControlPlaneError, getGuildOverview } from "@/lib/control-plane";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RetryButton } from "@/components/retry-button";

/**
 * Shared guard for guild-scoped pages:
 * 1. Checks that the user is logged in (in production).
 * 2. Verifies that the user has permission to manage this guild (bot owners can manage all;
 *    regular users can only manage their own authorized guilds).
 * 3. Verifies that the bot is actually in the guild.
 */
export async function checkGuildAccess(guildId: string) {
  const authEnabled = isAuthEnabled();
  const user = await getCurrentUser();

  if (authEnabled && !user) {
    return (
      <div className="space-y-6">
        <Card className="max-w-2xl border-destructive/40 bg-destructive/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5" />
              <CardTitle className="text-destructive">Authentication Required</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              You must sign in with Discord to manage this server.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button size="sm" render={<Link href="/login" />}>
              Sign In with Discord
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  try {
    const overview = await getGuildOverview(guildId, user?.id);

    // Strict Permission check: user MUST be the server owner or have an Administrator role
    if (user) {
      const userIds = user.id ? user.id.split(",").map((s) => s.trim()) : [];
      const isAllowed =
        overview.is_admin === true ||
        (overview.owner_id && userIds.includes(overview.owner_id));

      if (!isAllowed) {
        return (
          <div className="space-y-6">
            <Card className="max-w-2xl border-destructive/40 bg-destructive/5">
              <CardHeader>
                <div className="flex items-center gap-2 text-destructive">
                  <ShieldAlert className="size-5" />
                  <CardTitle className="text-destructive">Access Denied</CardTitle>
                </div>
                <CardDescription className="text-destructive/80">
                  You do not have Administrator permissions in this server.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  You can only view and manage servers that belong to you or where you have an active Administrator role.
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="outline" size="sm" render={<Link href="/servers" />}>
                  <ArrowLeft className="size-3.5" />
                  <span>Back to My Servers</span>
                </Button>
              </CardFooter>
            </Card>
          </div>
        );
      }
    }

    return null;
  } catch (err: unknown) {
    const status = err instanceof ControlPlaneError ? err.status : null;
    const message =
      err instanceof Error ? err.message : "Failed to connect to control plane";
    const notFound = status === 404;

    return (
      <div className="space-y-6">
        <Card
          className={`max-w-2xl ${
            notFound
              ? "border border-border/80"
              : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <CardHeader>
            <div
              className={`flex items-center gap-2 ${
                notFound ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {notFound ? (
                <Info className="size-5" />
              ) : (
                <AlertTriangle className="size-5" />
              )}
              <CardTitle className={notFound ? "" : "text-destructive"}>
                {notFound
                  ? "Bot is not in this server"
                  : "Failed to reach control plane"}
              </CardTitle>
            </div>
            <CardDescription className={notFound ? "" : "text-destructive/80"}>
              {notFound
                ? `The bot is not a member of guild ${guildId}. Pick one of the servers the bot is in instead.`
                : `Could not verify guild ${guildId} against the control plane.`}
            </CardDescription>
          </CardHeader>
          {!notFound && (
            <CardContent className="space-y-2">
              <p className="text-xs text-foreground/90 font-mono">{message}</p>
            </CardContent>
          )}
          <CardFooter className="flex items-center gap-3">
            <Button variant="outline" size="sm" render={<Link href="/servers" />}>
              <ArrowLeft className="size-3.5" />
              <span>All Servers</span>
            </Button>
            {!notFound && (
              <RetryButton checkPath={`/api/internal/guilds/${guildId}/overview`} />
            )}
          </CardFooter>
        </Card>
      </div>
    );
  }
}
