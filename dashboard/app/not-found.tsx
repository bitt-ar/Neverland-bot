import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-4">
      <div className="size-12 rounded-lg bg-muted/40 border border-border/80 flex items-center justify-center text-muted-foreground mb-4">
        <AlertCircle className="size-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Page Not Found</h2>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        The requested resource or page does not exist in the dashboard workspace.
      </p>
      <div className="mt-5">
        <Button variant="outline" size="sm" render={<Link href="/overview" />} className="text-xs gap-1.5">
          <ArrowLeft className="size-3.5" />
          <span>Back to Overview</span>
        </Button>
      </div>
    </div>
  );
}
