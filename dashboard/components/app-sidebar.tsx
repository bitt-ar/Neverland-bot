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

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = React.useState("");

  const isOverviewActive = pathname === "/" || pathname === "/overview";
  const isServerGeneralActive = pathname === "/server/general";
  const isSettingsActive = pathname === "/settings";
  const isReactionRolesActive = pathname.startsWith("/automation/reaction-roles");
  const isWelcomeActive = pathname.startsWith("/automation/welcome");
  const isModerationActive = pathname.startsWith("/automation/moderation");
  const isLevelingActive = pathname.startsWith("/community/leveling");
  const isTempVoiceActive = pathname.startsWith("/community/temp-voice");
  const isTicketsActive = pathname.startsWith("/community/tickets");
  const isGiveawaysActive = pathname.startsWith("/community/giveaways");

  const filteredGroups = React.useMemo(() => {
    const groups = [
      {
        label: "COLLECTIONS",
        items: [
          {
            title: "Overview",
            href: "/",
            icon: LayoutDashboard,
            isActive: isOverviewActive,
            badge: "Live",
          },
          {
            title: "Server General",
            href: "/server/general",
            icon: Server,
            isActive: isServerGeneralActive,
          },
        ],
      },
      {
        label: "AUTOMATION",
        items: [
          {
            title: "Moderation & AutoMod",
            href: "/automation/moderation",
            icon: ShieldCheck,
            isActive: isModerationActive,
          },
          {
            title: "Reaction Roles",
            href: "/automation/reaction-roles",
            icon: Tags,
            isActive: isReactionRolesActive,
          },
          {
            title: "Welcome Greetings",
            href: "/automation/welcome",
            icon: UserPlus,
            isActive: isWelcomeActive,
          },
        ],
      },
      {
        label: "COMMUNITY",
        items: [
          {
            title: "Giveaways",
            href: "/community/giveaways",
            icon: Gift,
            isActive: isGiveawaysActive,
          },
          {
            title: "Leveling & XP",
            href: "/community/leveling",
            icon: Award,
            isActive: isLevelingActive,
          },
          {
            title: "Temp Voice",
            href: "/community/temp-voice",
            icon: Volume2,
            isActive: isTempVoiceActive,
          },
          {
            title: "Support Tickets",
            href: "/community/tickets",
            icon: Ticket,
            isActive: isTicketsActive,
          },
        ],
      },
      {
        label: "CONFIGURATION",
        items: [
          {
            title: "Diagnostics & Health",
            href: "/settings",
            icon: Terminal,
            isActive: isSettingsActive,
          },
        ],
      },
    ];

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
    searchQuery,
    isOverviewActive,
    isServerGeneralActive,
    isSettingsActive,
    isReactionRolesActive,
    isWelcomeActive,
    isLevelingActive,
    isTempVoiceActive,
    isTicketsActive,
    isGiveawaysActive,
    isModerationActive,
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
                    <SidebarMenuItem key={item.href}>
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

      {/* Supabase-style Quick Status Drawer Card */}
      <SidebarFooter className="border-t border-border/60 p-2 group-data-[collapsible=icon]:hidden">
        <div className="rounded-[4px] border border-border/60 bg-muted/15 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground uppercase">
            <span>BOT GATEWAY</span>
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ONLINE
            </span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/80 flex items-center justify-between">
            <span>DISCORD API</span>
            <span className="text-foreground">OK (200)</span>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
