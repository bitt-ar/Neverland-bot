import { GiveawaysClient } from "./giveaways-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function GiveawaysPage({
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
          <h1 className="text-2xl font-bold tracking-tight">Giveaways</h1>
          <p className="text-sm text-muted-foreground">
            Host and manage giveaways with role requirements, multipliers, and logs.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <GiveawaysClient guildId={guildId} />;
}
