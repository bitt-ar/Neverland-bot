"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsUpDown,
  Search,
  Server,
  Terminal,
} from "lucide-react";
import { NeverlandLogo } from "@/components/logo";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";

interface GuildInfo {
  id: string;
  name: string;
  icon_url: string | null;
}

interface AppHeaderProps {
  authEnabled?: boolean;
}

export function AppHeader({ authEnabled = false }: AppHeaderProps) {
  const pathname = usePathname();
  const [guilds, setGuilds] = React.useState<GuildInfo[]>([]);
  const [selectedGuild, setSelectedGuild] = React.useState<GuildInfo | null>(null);
  const [healthStatus, setHealthStatus] = React.useState<"ok" | "error" | "checking">("checking");

  const fetchGuilds = React.useCallback(async () => {
    try {
      const res = await fetch("/api/internal/guilds");
      if (res.ok) {
        const data: GuildInfo[] = await res.json();
        setGuilds(data);
        if (data.length > 0) {
          setSelectedGuild(data[0]);
        }
      }
    } catch {
      setGuilds([]);
    }
  }, []);

  const fetchHealth = React.useCallback(async () => {
    try {
      const res = await fetch("/api/internal/health");
      if (res.ok) {
        const data = await res.json();
        setHealthStatus(data.status === "ok" ? "ok" : "error");
      } else {
        setHealthStatus("error");
      }
    } catch {
      setHealthStatus("error");
    }
  }, []);

  React.useEffect(() => {
    fetchGuilds();
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchGuilds, fetchHealth]);

  // Derive breadcrumb from pathname
  const pageLabel = React.useMemo(() => {
    if (!pathname || pathname === "/" || pathname === "/overview") return "Overview";
    if (pathname.startsWith("/server/general")) return "General Settings";
    if (pathname.startsWith("/automation/reaction-roles")) return "Reaction Roles";
    if (pathname.startsWith("/automation/welcome")) return "Welcome";
    if (pathname.startsWith("/community/leveling")) return "Leveling";
    if (pathname.startsWith("/community/temp-voice")) return "Temp Voice";
    if (pathname.startsWith("/community/tickets")) return "Tickets";
    if (pathname.startsWith("/settings")) return "Diagnostics";
    return pathname.replace(/^\//, "").split("/")[0];
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 sm:px-4 backdrop-blur-xs font-sans">
      {/* Left side: Supabase Breadcrumb Rail */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 text-xs">
        <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground size-7 shrink-0 rounded hover:bg-muted/50 transition-colors" />
        
        <Separator orientation="vertical" className="h-3.5 bg-border shrink-0" />

        {/* Project Name + Pro Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href="/"
            className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
          >
            <NeverlandLogo className="size-3.5 text-primary" />
            <span className="font-semibold tracking-tight">Neverland</span>
          </Link>
          <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 leading-none">
            Pro
          </span>
        </div>

        <span className="text-muted-foreground/60 select-none">/</span>

        {/* Guild Selector (styled like Supabase branch selector meme.town) */}
        {guilds.length > 0 && selectedGuild ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-[4px] border border-border/80 bg-muted/20 px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/50 hover:border-border transition-colors focus:outline-hidden min-w-0">
              <Avatar className="size-4 rounded-xs shrink-0">
                {selectedGuild.icon_url && (
                  <AvatarImage src={selectedGuild.icon_url} alt={selectedGuild.name} />
                )}
                <AvatarFallback className="rounded-xs bg-primary/20 text-[9px] text-primary font-bold">
                  {selectedGuild.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-[100px] sm:max-w-[160px] truncate">{selectedGuild.name}</span>
              <ChevronsUpDown className="size-3 text-muted-foreground shrink-0 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60 bg-card border-border shadow-xl">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                Configured Server
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border" />
              {guilds.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setSelectedGuild(g)}
                  className="flex items-center gap-2 cursor-pointer text-xs hover:bg-muted/40"
                >
                  <Avatar className="size-4 rounded-xs">
                    {g.icon_url && <AvatarImage src={g.icon_url} alt={g.name} />}
                    <AvatarFallback className="rounded-xs text-[9px]">
                      {g.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col truncate">
                    <span className="font-medium truncate">{g.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{g.id}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-1.5 rounded-[4px] border border-border/60 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground min-w-0">
            <Server className="size-3 shrink-0" />
            <span className="truncate max-w-[90px] sm:max-w-none text-[11px]">No server</span>
          </div>
        )}

        <span className="text-muted-foreground/60 select-none hidden sm:inline">/</span>

        {/* Current Page Title */}
        <span className="text-muted-foreground font-medium truncate hidden sm:inline">
          {pageLabel}
        </span>
      </div>

      {/* Right side: Search + Health + Feedback + Theme */}
      <div className="flex items-center gap-2 shrink-0">
        {!authEnabled && (
          <span className="hidden md:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground border border-border/60">
            dev mode
          </span>
        )}

        {/* Supabase style search button */}
        <div className="hidden lg:flex items-center gap-2 px-2 py-1 rounded-[4px] border border-border/60 bg-muted/20 text-xs text-muted-foreground">
          <Search className="size-3" />
          <span className="text-[11px]">Search collections...</span>
          <kbd className="text-[10px] font-mono px-1 py-0.2 bg-muted/60 border border-border/60 rounded text-muted-foreground/80">
            ⌘K
          </kbd>
        </div>

        {/* Control Plane Health Indicator with Supabase Green status */}
        <Tooltip>
          <TooltipTrigger className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors">
            <span className="relative flex size-2">
              {healthStatus === "ok" ? (
                <>
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </>
              ) : healthStatus === "error" ? (
                <span className="relative inline-flex size-2 rounded-full bg-red-500" />
              ) : (
                <span className="relative inline-flex size-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </span>
            <span className="hidden sm:inline font-mono text-[11px]">
              {healthStatus === "ok"
                ? "Control plane online"
                : healthStatus === "error"
                ? "Control plane offline"
                : "Checking..."}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="text-xs font-mono">
            <span>
              {healthStatus === "ok"
                ? "Control Plane: Online (http /health ok)"
                : healthStatus === "error"
                ? "Control Plane: Offline or Unreachable"
                : "Checking Control Plane status..."}
            </span>
          </TooltipContent>
        </Tooltip>

        <Link
          href="/settings"
          className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-[4px] hover:bg-muted/40 transition-colors"
        >
          <Terminal className="size-3.5" />
          <span>Diagnostics</span>
        </Link>

        <ThemeToggle />
      </div>
    </header>
  );
}
