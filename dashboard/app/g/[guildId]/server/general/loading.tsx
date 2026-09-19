import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function ServerGeneralLoading() {
  return (
    <PageLoadingSkeleton
      title="Server General"
      description="Loading server identity, channels, roles, and module snapshots..."
    />
  );
}
