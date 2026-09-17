import { NextResponse } from "next/server";
import { getGuildOverview } from "@/lib/control-plane";

export async function GET() {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    return NextResponse.json([]);
  }

  try {
    const overview = await getGuildOverview(guildId);
    return NextResponse.json([
      {
        id: overview.id,
        name: overview.name,
        icon_url: overview.icon_url,
      },
    ]);
  } catch {
    return NextResponse.json([]);
  }
}
