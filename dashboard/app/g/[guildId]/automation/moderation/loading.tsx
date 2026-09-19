import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function ModerationLoading() {
  return (
    <PageLoadingSkeleton
      title="Moderation & AutoMod"
      description="Loading moderation rules, permissions, and infraction cases..."
    />
  );
}
