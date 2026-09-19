import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function GuildLoading() {
  return (
    <PageLoadingSkeleton
      title="Server Workspace"
      description="Connecting to Discord guild context and parameters..."
      count={3}
    />
  );
}
