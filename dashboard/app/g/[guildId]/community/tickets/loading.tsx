import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function TicketsLoading() {
  return (
    <PageLoadingSkeleton
      title="Support Tickets"
      description="Loading ticket panels, categories, and staff permissions..."
    />
  );
}
