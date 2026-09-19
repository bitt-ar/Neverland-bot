import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function TempVoiceLoading() {
  return (
    <PageLoadingSkeleton
      title="Temp Voice"
      description="Loading temporary voice hubs and auto-cleanup channels..."
    />
  );
}
