import { WelcomeClient } from "./welcome-client";
import { checkGuildAccess } from "../../guild-access";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
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
          <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground">
            Configure welcome announcements, server-side PIL image cards, and automatic join roles.
          </p>
        </div>
        {guard}
      </div>
    );
  }

  return <WelcomeClient guildId={guildId} />;
}
