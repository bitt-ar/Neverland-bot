import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function WelcomeLoading() {
  return (
    <PageLoadingSkeleton
      title="Welcome"
      description="Loading welcome greetings and dynamic card configuration..."
    />
  );
}
