import Link from "next/link";
import { Info, Settings } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TempVoiceClient } from "./temp-voice-client";

export const dynamic = "force-dynamic";

export default async function TempVoicePage() {
  const guildId = process.env.GUILD_ID;

  if (!guildId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Temp Voice</h1>
          <p className="text-sm text-muted-foreground">
            Configure dynamic temporary voice lounges and monitor active voice channels.
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
              To configure temporary voice lounges, specify your Discord Server (Guild) ID
              in your environment variables.
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

  return <TempVoiceClient guildId={guildId} />;
}
