"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RetryButtonProps {
  checkPath?: string;
  onRetry?: () => void;
  className?: string;
}

export function RetryButton({ checkPath, onRetry, className }: RetryButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  const handleRetry = async () => {
    setLoading(true);
    try {
      if (checkPath) {
        await fetch(checkPath, { cache: "no-store" }).catch(() => {});
      }
      if (onRetry) {
        onRetry();
      }
      router.refresh();
    } finally {
      setTimeout(() => setLoading(false), 600);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={loading}
      className={className}
    >
      <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
      <span>{loading ? "Retrying..." : "Retry"}</span>
    </Button>
  );
}
