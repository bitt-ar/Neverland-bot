import { TempVoiceClient } from "./temp-voice-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function TempVoicePage({
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
          <h1 className="text-2xl font-bold tracking-tight">Temp Voice</h1>
          <p className="text-sm text-muted-foreground">
            Configure dynamic temporary voice lounges and monitor active voice channels.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <TempVoiceClient guildId={guildId} />;
}
