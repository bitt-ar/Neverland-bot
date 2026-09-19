import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function SettingsLoading() {
  return (
    <PageLoadingSkeleton
      title="Settings & Diagnostics"
      description="Loading system configuration, service health, and diagnostics..."
      count={4}
    />
  );
}
