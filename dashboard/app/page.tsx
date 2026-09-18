import { redirect } from "next/navigation";

import { isAuthEnabled } from "@/lib/auth";

export default function RootPage() {
  if (isAuthEnabled()) {
    // Production: authenticated users land on the multi-server list.
    redirect("/servers");
  }
  // Dev mode: rely on the GUILD_ID field as the default guild when set.
  const devGuildId = process.env.GUILD_ID;
  redirect(devGuildId ? `/g/${devGuildId}/server/general` : "/servers");
}
