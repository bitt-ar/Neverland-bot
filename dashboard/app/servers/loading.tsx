import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function ServersLoading() {
  return (
    <PageLoadingSkeleton
      title="Servers"
      description="Loading connected Discord servers and administrator access..."
      count={4}
    />
  );
}
