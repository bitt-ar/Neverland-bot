import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

export default function LoginLoading() {
  return (
    <PageLoadingSkeleton
      title="Neverland Authentication"
      description="Verifying Discord session and permissions..."
      count={1}
    />
  );
}
