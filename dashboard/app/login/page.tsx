"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";
import { Shield, Sparkles } from "lucide-react";
import { NeverlandLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className || "size-5"}
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const rawError = searchParams.get("error");
  const nextParam = searchParams.get("next") || "/servers";

  const error = React.useMemo(() => {
    if (!rawError) return null;
    try {
      return decodeURIComponent(rawError);
    } catch {
      return rawError;
    }
  }, [rawError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12 font-sans">
      <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-6 sm:p-8 shadow-xl space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-xs">
            <NeverlandLogo className="size-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Neverland Dashboard
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              Sign in with your Discord account to manage server configurations, moderation, reaction roles, and tickets.
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Shield className="size-3.5" />
              <span>Authentication Error</span>
            </div>
            <p className="text-[11px] text-destructive/90">{error}</p>
          </div>
        )}

        {/* Discord Login Button */}
        <div className="space-y-3">
          <Button
            className="w-full h-11 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium text-sm transition-all shadow-md flex items-center justify-center gap-2.5 rounded-lg cursor-pointer"
            render={<Link href={`/api/auth/discord?next=${encodeURIComponent(nextParam)}`} />}
          >
            <DiscordIcon className="size-5" />
            <span>Login with Discord</span>
          </Button>

          <p className="text-[11px] text-center text-muted-foreground leading-normal">
            Only servers where you have <span className="font-semibold text-foreground/80">Administrator</span> permissions or are the server owner will be accessible.
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="border-t border-border/60 pt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary shrink-0" />
            <span>Bot Owner gets instant access to global metrics & diagnostics</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="size-3.5 text-primary shrink-0" />
            <span>Administrators manage only their authorized servers securely</span>
          </div>
        </div>
      </div>
    </div>
  );
}
