import { redirect } from "next/navigation";

export default async function GuildIndexPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}) {
  const { guildId } = await params;
  redirect(`/g/${guildId}/server/general`);
}
