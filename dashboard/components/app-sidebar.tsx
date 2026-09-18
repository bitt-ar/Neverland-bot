"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  Gift,
  LayoutDashboard,
  Search,
  Server,
  ServerCog,
  ShieldCheck,
  Tags,
  Terminal,
  Ticket,
  UserPlus,
  Volume2,
} from "lucide-react";
import { NeverlandLogo } from "@/components/logo";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  badge?: string;
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  isAdmin?: boolean;
}

export function AppSidebar({ isAdmin, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [healthStatus, setHealthStatus] = React.useState<"ok" | "error" | "checking">("checking");
  const [clientIsAdmin, setClientIsAdmin] = React.useState<boolean | null>(isAdmin ?? null);
  const [persistedGuildId, setPersistedGuildId] = React.useState<string | null>(null);

  // Current guild comes from the URL (/g/<guildId>/...).
  const currentGuildId = React.useMemo(() => {
    const match = pathname?.match(/^\/g\/(\d+)/);
    return match ? match[1] : null;
  }, [pathname]);

  // Save current guild to localStorage and cookie when on a guild route
  React.useEffect(() => {
    if (currentGuildId) {
      try {
        localStorage.setItem("nl_active_guild", currentGuildId);
        document.cookie = `nl_active_guild=${currentGuildId}; path=/; max-age=2592000; SameSite=Lax`;
        setPersistedGuildId(currentGuildId);
      } catch {
        // ignore storage errors
      }
    } else if (!persistedGuildId) {
      try {
        const saved = localStorage.getItem("nl_active_guild");
        if (saved) {
          setPersistedGuildId(saved);
        }
      } catch {
        // ignore
      }
    }
  }, [currentGuildId, persistedGuildId]);

  // Sub-path after the guild segment: /g/123/community/tickets -> /community/tickets
  const subPath = React.useMemo(
    () => pathname?.replace(/^\/g\/[^/]+/, "") || pathname || "/",
    [pathname]
  );

  // Fetch auth status on mount if not provided as prop
  React.useEffect(() => {
    if (clientIsAdmin !== null) return;
    fetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((data) => {
        setClientIsAdmin(Boolean(data?.isAdmin));
        if (
          !persistedGuildId &&
          !currentGuildId &&
          Array.isArray(data?.user?.managedGuildIds) &&
          data.user.managedGuildIds.length > 0
        ) {
          setPersistedGuildId(String(data.user.managedGuildIds[0]));
        }
      })
      .catch(() => setClientIsAdmin(false));
  }, [clientIsAdmin, persistedGuildId, currentGuildId]);

  // Fallback to the first available managed guild if no guild is stored
  React.useEffect(() => {
    if (persistedGuildId || currentGuildId) return;
    fetch("/api/internal/guilds")
      .then((res) => (res.ok ? res.json() : []))
      .then((guilds: Array<{ id: string }>) => {
        if (Array.isArray(guilds) && guilds.length > 0 && guilds[0]?.id) {
          setPersistedGuildId(String(guilds[0].id));
        }
      })
      .catch(() => {});
  }, [persistedGuildId, currentGuildId]);

  const activeGuildId = currentGuildId || persistedGuildId;

  // Guild-scoped pages link to active guild if available, otherwise server list.
  const guildHref = React.useCallback(
    (path: string) => (activeGuildId ? `/g/${activeGuildId}/${path}` : "/servers"),
    [activeGuildId]
  );

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
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const effectiveIsAdmin = clientIsAdmin ?? isAdmin ?? false;

  const filteredGroups = React.useMemo(() => {
    const collectionItems: NavItem[] = [];

    // Overview is only shown to authorized bot owners / admins
    if (effectiveIsAdmin) {
      collectionItems.push({
        title: "Overview",
        href: "/overview",
        icon: LayoutDashboard,
        isActive: pathname === "/overview",
        badge: "Admin",
      });
    }

    collectionItems.push(
      {
        title: "Servers",
        href: "/servers",
        icon: Server,
        isActive: pathname === "/servers",
      },
      {
        title: "Server General",
        href: guildHref("server/general"),
        icon: ServerCog,
        isActive: subPath.startsWith("/server/general"),
      }
    );

    const groups = [
      {
        label: "COLLECTIONS",
        items: collectionItems,
      },
      {
        label: "AUTOMATION",
        items: [
          {
            title: "Moderation & AutoMod",
            href: guildHref("automation/moderation"),
            icon: ShieldCheck,
            isActive: subPath.startsWith("/automation/moderation"),
          },
          {
            title: "Reaction Roles",
            href: guildHref("automation/reaction-roles"),
            icon: Tags,
            isActive: subPath.startsWith("/automation/reaction-roles"),
          },
          {
            title: "Welcome Greetings",
            href: guildHref("automation/welcome"),
            icon: UserPlus,
            isActive: subPath.startsWith("/automation/welcome"),
          },
        ],
      },
      {
        label: "COMMUNITY",
        items: [
          {
            title: "Giveaways",
            href: guildHref("community/giveaways"),
            icon: Gift,
            isActive: subPath.startsWith("/community/giveaways"),
          },
          {
            title: "Leveling & XP",
            href: guildHref("community/leveling"),
            icon: Award,
            isActive: subPath.startsWith("/community/leveling"),
          },
          {
            title: "Temp Voice",
            href: guildHref("community/temp-voice"),
            icon: Volume2,
            isActive: subPath.startsWith("/community/temp-voice"),
          },
          {
            title: "Support Tickets",
            href: guildHref("community/tickets"),
            icon: Ticket,
            isActive: subPath.startsWith("/community/tickets"),
          },
        ],
      },
    ] as { label: string; items: NavItem[] }[];

    if (effectiveIsAdmin) {
      groups.push({
        label: "CONFIGURATION",
        items: [
          {
            title: "Diagnostics & Health",
            href: "/settings",
            icon: Terminal,
            isActive: pathname === "/settings",
          },
        ],
      });
    }

    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.href.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [
    effectiveIsAdmin,
    pathname,
    searchQuery,
    subPath,
    guildHref,
  ]);

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-sidebar font-sans" {...props}>
      {/* Top Header: Supabase Style App Identifier */}
      <SidebarHeader className="border-b border-border/60 p-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 px-1 font-semibold text-sm tracking-tight text-foreground transition-opacity hover:opacity-90"
        >
          <div className="flex size-7 items-center justify-center rounded-[5px] bg-primary/10 border border-primary/30 text-primary font-bold shadow-xs">
            <NeverlandLogo className="size-4 text-primary" />
          </div>
          <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm tracking-tight text-foreground">Neverland</span>
              <span className="text-[9px] font-mono font-medium px-1 rounded bg-muted/60 text-muted-foreground border border-border/50">
                v0.1
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground/80 font-mono">Control Dashboard</span>
          </div>
        </Link>
      </SidebarHeader>

      {/* Supabase Collection Quick Filter */}
      <div className="p-2 group-data-[collapsible=icon]:hidden border-b border-border/40">
        <div className="relative">
          <Search className="size-3.5 absolute left-2 top-2.5 text-muted-foreground/70 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search collections..."
            className="w-full h-8 pl-7 pr-2 rounded-[4px] bg-muted/20 border border-border/60 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:border-primary/60 transition-colors"
          />
        </div>
      </div>

      <SidebarContent className="px-2 py-1 space-y-2">
        {filteredGroups.map((group) => (
          <SidebarGroup key={group.label} className="p-0">
            <SidebarGroupLabel className="text-[10px] font-mono font-semibold tracking-wider text-muted-foreground/70 uppercase px-2 py-1 select-none">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        render={<Link href={item.href} />}
                        isActive={item.isActive}
                        tooltip={item.title}
                        className={`h-8 px-2.5 rounded-md text-xs font-medium transition-colors flex items-center justify-between ${
                          item.isActive
                            ? "bg-accent text-accent-foreground font-semibold shadow-2xs"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon
                            className={`size-3.5 shrink-0 ${
                              item.isActive ? "text-primary" : "text-muted-foreground"
                            }`}
                          />
                          <span className="truncate">{item.title}</span>
                        </div>
                        {item.badge && (
                          <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Live control-plane status (real health, polled every 30s) */}
      <SidebarFooter className="border-t border-border/60 p-2 group-data-[collapsible=icon]:hidden">
        <div className="rounded-[4px] border border-border/60 bg-muted/15 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground uppercase">
            <span>CONTROL PLANE</span>
            <span
              className={`flex items-center gap-1 font-medium ${
                healthStatus === "ok"
                  ? "text-emerald-400"
                  : healthStatus === "error"
                  ? "text-red-400"
                  : "text-amber-400"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  healthStatus === "ok"
                    ? "bg-emerald-400 animate-pulse"
                    : healthStatus === "error"
                    ? "bg-red-400"
                    : "bg-amber-400 animate-pulse"
                }`}
              />
              {healthStatus === "ok" ? "ONLINE" : healthStatus === "error" ? "OFFLINE" : "..."}
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/80 flex items-center justify-between">
            <span>DISCORD API</span>
            <span className="text-foreground">
              {healthStatus === "ok" ? "OK (200)" : healthStatus === "error" ? "UNREACHABLE" : "..."}
            </span>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
