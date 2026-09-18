"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";

interface DashboardShellProps {
  children: React.ReactNode;
  authEnabled: boolean;
  isAdmin: boolean;
}

export function DashboardShell({
  children,
  authEnabled,
  isAdmin,
}: DashboardShellProps) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname?.startsWith("/login/");

  if (isAuthPage) {
    return <main className="min-h-svh flex items-center justify-center p-4">{children}</main>;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <AppSidebar isAdmin={isAdmin} />
      <SidebarInset className="min-w-0 flex flex-col min-h-svh">
        <AppHeader authEnabled={authEnabled} />
        <div className="flex-1 w-full min-w-0 overflow-x-hidden p-3.5 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
