import { RadioClient } from "./radio-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function RadioPage({
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
          <h1 className="text-2xl font-bold tracking-tight">Radio & 24/7 Broadcast</h1>
          <p className="text-sm text-muted-foreground">
            Stream 24/7 audio playlists across multiple voice channels simultaneously.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <RadioClient guildId={guildId} />;
}
