import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function RootLoading() {
  return (
    <PageLoadingSkeleton
      title="Neverland Dashboard"
      description="Loading workspace and bot control plane..."
      count={3}
    />
  );
}
