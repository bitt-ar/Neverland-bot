import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Neverland Dashboard",
  description: "Management dashboard for Neverland Discord bot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authEnabled = process.env.AUTH_ENABLED === "true";

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakartaSans.variable} ${jetbrainsMono.variable} font-sans antialiased bg-background text-foreground min-h-svh`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={true}
          disableTransitionOnChange
        >
          <TooltipProvider>
            <SidebarProvider defaultOpen={true}>
              <AppSidebar />
              <SidebarInset className="min-w-0 flex flex-col min-h-svh">
                <AppHeader authEnabled={authEnabled} />
                <div className="flex-1 w-full min-w-0 overflow-x-hidden p-3.5 sm:p-6 lg:p-8">
                  <div className="mx-auto w-full max-w-6xl">
                    {children}
                  </div>
                </div>
              </SidebarInset>
            </SidebarProvider>
            <Toaster position="bottom-right" richColors={false} />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
