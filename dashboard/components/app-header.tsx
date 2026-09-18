"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  LogOut,
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
  DropdownMenuGroup,
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
  member_count?: number | null;
  owner_id?: string;
  is_admin?: boolean;
  is_owner?: boolean;
}

interface AppHeaderProps {
  authEnabled?: boolean;
}

interface UserState {
  id: string;
  username: string;
  avatar: string | null;
  globalName?: string | null;
  isOwner: boolean;
  managedGuildIds?: string[];
}

export function AppHeader({ authEnabled = false }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [guilds, setGuilds] = React.useState<GuildInfo[]>([]);
  const [healthStatus, setHealthStatus] = React.useState<"ok" | "error" | "checking">("checking");
  const [currentUser, setCurrentUser] = React.useState<UserState | null>(null);

  // Fetch current user auth state
  React.useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  // Current guild comes from the URL (/g/<guildId>/...), never from local state.
  const currentGuildId = React.useMemo(() => {
    const match = pathname?.match(/^\/g\/(\d+)/);
    return match ? match[1] : null;
  }, [pathname]);

  const selectedGuild = React.useMemo(
    () => guilds.find((g) => g.id === currentGuildId) ?? null,
    [guilds, currentGuildId]
  );

  const fetchGuilds = React.useCallback(async () => {
    try {
      const url = currentUser?.id
        ? `/api/internal/guilds?user_id=${encodeURIComponent(currentUser.id)}`
        : "/api/internal/guilds";
      const res = await fetch(url);
      if (res.ok) {
        const data: GuildInfo[] = await res.json();
        setGuilds(data);
      }
    } catch {
      setGuilds([]);
    }
  }, [currentUser?.id]);

  // Filter guilds visible to the current user (only their own managed servers in prod, all in dev)
  const visibleGuilds = React.useMemo(() => {
    if (!authEnabled) return guilds;
    if (!currentUser) return guilds;
    return guilds.filter((g) => {
      if (g.is_admin === true) return true;
      if (g.owner_id === currentUser.id) return true;
      if (currentUser.managedGuildIds && currentUser.managedGuildIds.includes(g.id)) return true;
      return false;
    });
  }, [guilds, currentUser, authEnabled]);


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

  // Derive breadcrumb from pathname (strips the /g/<guildId> segment)
  const pageLabel = React.useMemo(() => {
    if (!pathname || pathname === "/" || pathname === "/overview") return "Overview";
    if (pathname === "/servers") return "All Servers";
    const sub = pathname.replace(/^\/g\/[^/]+/, "") || "/";
    if (sub === "/" ) return "Server";
    if (sub.startsWith("/server/general")) return "General Settings";
    if (sub.startsWith("/automation/moderation")) return "Moderation";
    if (sub.startsWith("/automation/reaction-roles")) return "Reaction Roles";
    if (sub.startsWith("/automation/welcome")) return "Welcome";
    if (sub.startsWith("/community/giveaways")) return "Giveaways";
    if (sub.startsWith("/community/leveling")) return "Leveling";
    if (sub.startsWith("/community/temp-voice")) return "Temp Voice";
    if (sub.startsWith("/community/tickets")) return "Tickets";
    if (sub.startsWith("/settings")) return "Diagnostics";
    return sub.replace(/^\//, "").split("/")[0];
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

        {/* Guild Selector (shown only when in a guild route /g/...) */}
        {currentGuildId && selectedGuild ? (
          <>
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
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                    {`My Servers (${visibleGuilds.length})`}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-border" />
                  {visibleGuilds.map((g) => (
                    <DropdownMenuItem
                      key={g.id}
                      onClick={() => {
                        try {
                          localStorage.setItem("nl_active_guild", g.id);
                          document.cookie = `nl_active_guild=${g.id}; path=/; max-age=2592000; SameSite=Lax`;
                        } catch {}
                        router.push(`/g/${g.id}/server/general`);
                      }}
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
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {typeof g.member_count === "number" ? `${g.member_count.toLocaleString()} members` : g.id}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => router.push("/servers")}
                    className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  >
                    <Server className="size-3.5" />
                    <span>All My Servers</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-muted-foreground/60 select-none hidden sm:inline">/</span>
          </>
        ) : null}

        {/* Current Page Title */}
        <span className="text-muted-foreground font-medium truncate hidden sm:inline">
          {pageLabel}
        </span>
      </div>

      {/* Right side: Search + Server Switcher + Health + User Profile + Theme */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Quick server switcher when on global pages */}
        {visibleGuilds.length > 0 && !currentGuildId && (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-[4px] border border-border/70 bg-muted/20 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
              <Server className="size-3 text-muted-foreground" />
              <span className="hidden sm:inline text-[11px]">Manage Server</span>
              <ChevronsUpDown className="size-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 bg-card border-border shadow-xl">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                  Select Server to Manage
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                {visibleGuilds.map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    onClick={() => {
                      try {
                        localStorage.setItem("nl_active_guild", g.id);
                        document.cookie = `nl_active_guild=${g.id}; path=/; max-age=2592000; SameSite=Lax`;
                      } catch {}
                      router.push(`/g/${g.id}/server/general`);
                    }}
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
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {typeof g.member_count === "number" ? `${g.member_count.toLocaleString()} members` : g.id}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {!authEnabled && (
          <span className="hidden md:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground border border-border/60">
            {currentUser?.isOwner ? "dev (owner)" : "dev (user)"}
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

        {/* Control Plane Health Indicator */}
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

        {currentUser?.isOwner && (
          <Link
            href="/settings"
            className="hidden md:inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-[4px] hover:bg-muted/40 transition-colors"
          >
            <Terminal className="size-3.5" />
            <span>Diagnostics</span>
          </Link>
        )}

        {/* User Identity / Avatar */}
        {currentUser && (
          <div className="flex items-center gap-1.5 pl-1">
            <Avatar className="size-6 rounded-full border border-border">
              {currentUser.avatar && (
                <AvatarImage src={currentUser.avatar} alt={currentUser.username} />
              )}
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                {currentUser.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-[11px] font-medium text-foreground hidden xl:inline max-w-[90px] truncate">
              {currentUser.globalName || currentUser.username}
            </span>
          </div>
        )}

        {authEnabled && (
          <button
            type="button"
            onClick={async () => {
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } finally {
                router.push("/login");
                router.refresh();
              }
            }}
            title="Logout"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive px-2 py-1 rounded-[4px] hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        )}

        <ThemeToggle />
      </div>
    </header>
  );
}
