import { LevelingClient } from "./leveling-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function LevelingPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;

  const guard = await checkGuildAccess(guildId);
  if (guard) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leveling</h1>
          <p className="text-sm text-muted-foreground">
            Configure XP progression, level-up announcements, and role rewards.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <LevelingClient guildId={guildId} />;
}
