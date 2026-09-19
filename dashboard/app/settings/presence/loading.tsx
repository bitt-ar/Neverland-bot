import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function BotPresenceLoading() {
  return (
    <PageLoadingSkeleton
      title="Bot Presence & Status"
      description="Loading live bot gateway status, activity config, and presence parameters..."
      count={3}
    />
  );
}
