import { ModerationClient } from "./moderation-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function ModerationPage({
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
          <h1 className="text-2xl font-bold tracking-tight">Moderation & AutoMod</h1>
          <p className="text-sm text-muted-foreground">
            Configure moderation slash commands, role-based command access, and automated moderation filters.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <ModerationClient guildId={guildId} />;
}
