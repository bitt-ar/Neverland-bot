import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface PageLoadingSkeletonProps {
  title: string;
  description?: string;
  count?: number;
}

export function PageLoadingSkeleton({
  title,
  description = "Loading module configuration and live parameters...",
  count = 3,
}: PageLoadingSkeletonProps) {
  return (
    <div className="space-y-6">
      {/* Header with real title and description per user requirement */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Unified 3-card skeleton grid matching reference image */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className="border border-border/80 bg-card">
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-8 w-full mt-4" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
