"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Flame,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Sliders,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BotLogEntry {
  id: string;
  timestamp: number;
  time: string;
  iso?: string;
  level: string;
  logger: string;
  message: string;
}

export interface BotStatusInfo {
  user: string;
  user_id: string | null;
  is_ready: boolean;
  latency_ms: number;
  guild_count: number;
  shard_count: number;
}

type ModeType = "realtime" | "slow" | "paused";

export function DiscordLiveLogs() {
  const [logs, setLogs] = React.useState<BotLogEntry[]>([]);
  const [botInfo, setBotInfo] = React.useState<BotStatusInfo | null>(null);
  const [isOnline, setIsOnline] = React.useState<boolean | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<ModeType>("realtime");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedLevel, setSelectedLevel] = React.useState<string>("all");
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [isFetching, setIsFetching] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const terminalRef = React.useRef<HTMLDivElement>(null);
  const lastOnlineRef = React.useRef<boolean | null>(null);

  const fetchLogs = React.useCallback(async () => {
    setIsFetching(true);
    try {
      const res = await fetch("/api/internal/bot/logs");
      const data = await res.json();

      if (data.online) {
        setIsOnline(true);
        setLastError(null);
        if (data.bot) setBotInfo(data.bot);

        // If transitioning from offline to online, insert a recovery entry
        if (lastOnlineRef.current === false) {
          const recoveryEntry: BotLogEntry = {
            id: `recovery-${Date.now()}`,
            timestamp: Date.now() / 1000,
            time: new Date().toLocaleTimeString(),
            level: "INFO",
            logger: "system.watchdog",
            message: "Bot connection restored! Control plane daemon is ONLINE and Gateway is responding.",
          };
          setLogs((prev) => [...prev, recoveryEntry]);
        }
        lastOnlineRef.current = true;

        if (Array.isArray(data.logs) && data.logs.length > 0) {
          setLogs((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEntries = data.logs.filter((e: BotLogEntry) => !existingIds.has(e.id));
            if (newEntries.length === 0) return prev;
            return [...prev, ...newEntries].slice(-300);
          });
        }
      } else {
        // Bot crashed or dropped!
        setIsOnline(false);
        const errMsg = data.error || "Bot daemon connection failed. Process is offline.";
        setLastError(errMsg);

        // Only push a crash entry when first detecting the drop
        if (lastOnlineRef.current !== false) {
          const crashEntry: BotLogEntry = {
            id: `crash-${Date.now()}`,
            timestamp: Date.now() / 1000,
            time: new Date().toLocaleTimeString(),
            level: "ERROR",
            logger: "system.watchdog",
            message: `CRITICAL ALERT: Bot process crashed or unreachable! ${errMsg}`,
          };
          setLogs((prev) => [...prev, crashEntry]);
        }
        lastOnlineRef.current = false;
      }
    } catch {
      setIsOnline(false);
      const errMsg = "Failed to connect to internal API router (Network/Server down)";
      setLastError(errMsg);
      if (lastOnlineRef.current !== false) {
        const crashEntry: BotLogEntry = {
          id: `net-crash-${Date.now()}`,
          timestamp: Date.now() / 1000,
          time: new Date().toLocaleTimeString(),
          level: "ERROR",
          logger: "system.watchdog",
          message: `CRITICAL ALERT: ${errMsg}`,
        };
        setLogs((prev) => [...prev, crashEntry]);
      }
      lastOnlineRef.current = false;
    } finally {
      setIsFetching(false);
    }
  }, []);

  // Polling timer according to mode (realtime = 1200ms, slow = 5000ms, paused = none)
  React.useEffect(() => {
    fetchLogs();
    if (mode === "paused") return;

    const intervalMs = mode === "slow" ? 5000 : 1200;
    const timer = setInterval(fetchLogs, intervalMs);
    return () => clearInterval(timer);
  }, [fetchLogs, mode]);

  // Auto-scroll terminal to bottom
  React.useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filtered logs
  const filteredLogs = React.useMemo(() => {
    return logs.filter((log) => {
      if (selectedLevel !== "all" && log.level.toUpperCase() !== selectedLevel.toUpperCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMsg = log.message.toLowerCase().includes(query);
        const matchesLogger = log.logger.toLowerCase().includes(query);
        const matchesLevel = log.level.toLowerCase().includes(query);
        return matchesMsg || matchesLogger || matchesLevel;
      }
      return true;
    });
  }, [logs, selectedLevel, searchQuery]);

  const copyAllLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.time}] [${l.level}] [${l.logger}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Logs copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.time}] [${l.level}] [${l.logger}] ${l.message}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neverland-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs exported");
  };

  return (
    <Card className="border border-border/80 shadow-sm md:col-span-2 overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Terminal className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Discord Live Server Logs</CardTitle>
                {isOnline === true ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px] font-mono gap-1"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE
                  </Badge>
                ) : isOnline === false ? (
                  <Badge
                    variant="outline"
                    className="border-red-500/40 text-red-400 bg-red-500/15 text-[10px] font-mono gap-1"
                  >
                    <span className="size-1.5 rounded-full bg-red-400" />
                    BOT CRASHED / OFFLINE
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                    CONNECTING...
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs">
                Real-time bot runtime logs, Discord WebSocket gateway events, and crash watchdog.
              </CardDescription>
            </div>
          </div>

          {/* Bot telemetry chips */}
          <div className="flex items-center flex-wrap gap-2">
            {botInfo && (
              <>
                <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/60">
                  <span className="text-foreground/80 font-semibold">{botInfo.user}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/60">
                  <Wifi className="size-3 text-emerald-400" />
                  <span>{botInfo.latency_ms}ms</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border/60">
                  <span>Shard {botInfo.shard_count}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Speed / Mode Switcher ("سلاو مود") */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-border/40">
          <div className="flex items-center gap-1.5 bg-muted/30 p-1 rounded-lg border border-border/60 text-xs">
            <span className="text-[11px] font-medium text-muted-foreground px-1.5 flex items-center gap-1">
              <Sliders className="size-3" />
              <span>Speed:</span>
            </span>

            {/* Real-time */}
            <button
              onClick={() => setMode("realtime")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all flex items-center gap-1 ${
                mode === "realtime"
                  ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Zap className="size-3" />
              <span>Real-Time (1s)</span>
            </button>

            {/* Slow Mode */}
            <button
              onClick={() => setMode("slow")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all flex items-center gap-1 ${
                mode === "slow"
                  ? "bg-amber-500 text-white shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Clock className="size-3" />
              <span>Slow Mode (5s)</span>
            </button>

            {/* Paused */}
            <button
              onClick={() => setMode("paused")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all flex items-center gap-1 ${
                mode === "paused"
                  ? "bg-muted-foreground text-background shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Pause className="size-3" />
              <span>Paused</span>
            </button>
          </div>

          {/* Quick controls */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchLogs()}
              disabled={isFetching}
              className="h-7 text-xs gap-1"
            >
              <RefreshCw className={`size-3 ${isFetching ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyAllLogs}
              className="h-7 text-xs gap-1"
            >
              <Copy className="size-3" />
              <span>{copied ? "Copied!" : "Copy"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadLogs}
              className="h-7 text-xs gap-1"
            >
              <Download className="size-3" />
              <span>Export</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLogs([])}
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
              <span>Clear</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Crash / Error Banner if bot goes offline */}
      {isOnline === false && (
        <div className="bg-red-500/15 border-b border-red-500/30 p-3 text-xs text-red-400 flex items-start gap-2.5 animate-pulse">
          <AlertTriangle className="size-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold flex items-center gap-1.5">
              <span>BOT PROCESS CRASHED / DISCONNECTED</span>
            </div>
            <p className="text-[11px] text-red-400/90 font-mono">
              {lastError || "Failed to reach bot control plane daemon. The Discord bot process may have crashed or stopped."}
            </p>
          </div>
        </div>
      )}

      {/* Terminal Filter Toolbar */}
      <div className="px-4 py-2 border-b border-border/40 bg-muted/20 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="relative w-full">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs, errors, events..."
              className="h-7 pl-8 text-xs font-mono bg-background/60"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {["all", "INFO", "WARNING", "ERROR"].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setSelectedLevel(lvl)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                selectedLevel === lvl
                  ? lvl === "ERROR"
                    ? "bg-red-500/20 text-red-400 border border-red-500/40"
                    : lvl === "WARNING"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground bg-muted/40"
              }`}
            >
              {lvl.toUpperCase()}
            </button>
          ))}

          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="size-3 rounded border-border"
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Terminal Logs Window */}
      <CardContent className="p-0">
        <div
          ref={terminalRef}
          className="h-[380px] overflow-y-auto bg-[#0a0c10] text-[#e6edf3] font-mono text-xs p-3.5 space-y-1 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-1.5 py-12">
              <Terminal className="size-6 opacity-40" />
              <p className="text-xs">
                {isOnline === false
                  ? "Bot process is currently offline. Logs will resume when reconnected."
                  : "No logs captured yet. Listening to bot & gateway events..."}
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const lvl = log.level.toUpperCase();
              const isError = lvl === "ERROR" || lvl === "CRITICAL";
              const isWarn = lvl === "WARNING" || lvl === "WARN";
              const isDebug = lvl === "DEBUG";

              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-2 py-0.5 leading-relaxed rounded px-1 -mx-1 transition-colors ${
                    isError
                      ? "bg-red-950/30 text-red-300 font-semibold"
                      : isWarn
                      ? "bg-amber-950/20 text-amber-300"
                      : "hover:bg-white/5"
                  }`}
                >
                  <span className="text-muted-foreground shrink-0 select-none text-[11px]">
                    [{log.time}]
                  </span>
                  <span
                    className={`shrink-0 font-bold text-[10px] px-1 rounded uppercase select-none ${
                      isError
                        ? "bg-red-500/30 text-red-400 border border-red-500/50"
                        : isWarn
                        ? "bg-amber-500/30 text-amber-400 border border-amber-500/50"
                        : isDebug
                        ? "bg-blue-500/20 text-blue-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-cyan-400 shrink-0 select-none text-[11px]">
                    [{log.logger}]
                  </span>
                  <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
