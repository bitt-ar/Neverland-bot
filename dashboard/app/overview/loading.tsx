import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function OverviewLoading() {
  return (
    <PageLoadingSkeleton
      title="Overview & Analytics"
      description="Loading bot-wide metrics, event streams, and connected server logs..."
      count={4}
    />
  );
}
