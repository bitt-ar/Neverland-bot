import { TicketsClient } from "./tickets-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
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
          <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Configure support ticket panels, categories, and monitor active tickets.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <TicketsClient guildId={guildId} />;
}
