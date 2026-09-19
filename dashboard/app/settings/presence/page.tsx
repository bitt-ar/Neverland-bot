import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { checkAdminAccess, SESSION_COOKIE } from "@/lib/auth";
import { getBotPresence, getBotInfo, BotPresence } from "@/lib/control-plane";
import { BotPresenceClient } from "./presence-client";

export const dynamic = "force-dynamic";

export default async function BotPresencePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value || null;

  // Strict Bot Owner Access Guard
  const isAdmin = await checkAdminAccess({ sessionCookie });
  if (!isAdmin) {
    notFound();
  }

  let presenceData: BotPresence = {
    status: "idle",
    activity_type: "custom",
    activity_name: "At your service",
    streaming_url: "",
    guild_count: 4,
    member_count: 13,
  };

  let botName = "Nevercraft";
  let botAvatarUrl: string | null = null;

  try {
    const [presence, botInfo] = await Promise.allSettled([
      getBotPresence(),
      getBotInfo(),
    ]);

    if (presence.status === "fulfilled" && presence.value) {
      presenceData = {
        ...presenceData,
        ...presence.value,
      };
    }

    if (botInfo.status === "fulfilled" && botInfo.value) {
      botName = botInfo.value.name || "Nevercraft";
      botAvatarUrl = botInfo.value.avatar_url || null;
    }
  } catch {
    // Control plane offline or error
  }

  return (
    <BotPresenceClient
      initialData={presenceData}
      botName={botName}
      botAvatarUrl={botAvatarUrl}
    />
  );
}
