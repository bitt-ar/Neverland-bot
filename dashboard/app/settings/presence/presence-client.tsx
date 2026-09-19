"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Loader2, RotateCcw, Save, Tv } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type BotStatus = "online" | "idle" | "dnd" | "invisible";
export type ActivityType = "custom" | "playing" | "streaming" | "listening" | "watching" | "competing" | "none";

interface BotPresenceData {
  status: BotStatus;
  activity_type: ActivityType;
  activity_name: string;
  streaming_url?: string;
  guild_count?: number;
  member_count?: number;
  updated_at?: string | null;
}

interface PresenceClientProps {
  initialData: BotPresenceData;
  botName?: string;
  botAvatarUrl?: string | null;
}

const STATUS_OPTIONS: { id: BotStatus; label: string; description: string; color: string }[] = [
  { id: "online", label: "Online", description: "Visible & active on Discord", color: "bg-emerald-500" },
  { id: "idle", label: "Idle", description: "Away / Standby crescent moon", color: "bg-amber-400" },
  { id: "dnd", label: "Do Not Disturb", description: "Red mute indicator", color: "bg-red-500" },
  { id: "invisible", label: "Invisible", description: "Shows offline to users", color: "bg-zinc-400" },
];

const ACTIVITY_OPTIONS: { id: ActivityType; label: string; prefix: string; placeholder: string }[] = [
  { id: "custom", label: "Custom Status", prefix: "", placeholder: "At your service" },
  { id: "playing", label: "Playing", prefix: "Playing", placeholder: "Minecraft / with slash commands" },
  { id: "streaming", label: "Streaming", prefix: "Streaming", placeholder: "Live Community Stream" },
  { id: "listening", label: "Listening to", prefix: "Listening to", placeholder: "Spotify / user requests" },
  { id: "watching", label: "Watching", prefix: "Watching", placeholder: "over {members} users in {servers} servers" },
  { id: "competing", label: "Competing in", prefix: "Competing in", placeholder: "Neverland Championship" },
  { id: "none", label: "None / Clear", prefix: "", placeholder: "(No activity text)" },
];

export function BotPresenceClient({ initialData, botName = "Nevercraft", botAvatarUrl }: PresenceClientProps) {
  const [status, setStatus] = React.useState<BotStatus>(initialData.status || "idle");
  const [activityType, setActivityType] = React.useState<ActivityType>(initialData.activity_type || "custom");
  const [activityName, setActivityName] = React.useState<string>(initialData.activity_name || "At your service");
  const [streamingUrl, setStreamingUrl] = React.useState<string>(initialData.streaming_url || "");
  const [isSaving, setIsSaving] = React.useState(false);
  const [lastSaved, setLastSaved] = React.useState<BotPresenceData>(initialData);

  const isDirty = React.useMemo(() => {
    return (
      status !== lastSaved.status ||
      activityType !== lastSaved.activity_type ||
      activityName !== (lastSaved.activity_name || "") ||
      streamingUrl !== (lastSaved.streaming_url || "")
    );
  }, [status, activityType, activityName, streamingUrl, lastSaved]);

  const resolvedActivityText = React.useMemo(() => {
    let text = activityName;
    const servers = String(initialData.guild_count ?? 4);
    const members = String(initialData.member_count ?? 13);
    text = text.replace(/{servers}/gi, servers).replace(/{guilds}/gi, servers);
    text = text.replace(/{members}/gi, members).replace(/{users}/gi, members);
    text = text.replace(/{version}/gi, "0.1.0");
    return text;
  }, [activityName, initialData.guild_count, initialData.member_count]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = {
        status,
        activity_type: activityType,
        activity_name: activityName.trim(),
        streaming_url: streamingUrl.trim(),
      };
      const res = await fetch("/api/internal/bot/presence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const updated = (await res.json()) as BotPresenceData;
      setLastSaved({
        ...updated,
        guild_count: initialData.guild_count,
        member_count: initialData.member_count,
      });
      toast.success("Bot presence updated live on Discord!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update presence";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = () => {
    setStatus("idle");
    setActivityType("custom");
    setActivityName("At your service");
    setStreamingUrl("");
  };

  const handleInsertToken = (token: string) => {
    setActivityName((prev) => `${prev} ${token}`.trim());
  };

  return (
    <div className="space-y-6">
      {/* Header bar matching Custom Commands style */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Bot Status & Presence</h1>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-xs font-mono">
              Owner Only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Dynamic control over bot presence, status indicator, and Discord rich activity.
          </p>
        </div>

        {/* Top Header Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {isDirty && (
            <span className="text-xs text-amber-400 flex items-center gap-1.5 mr-1 font-mono">
              <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetToDefault}
            disabled={isSaving}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5 mr-1.5" />
            Reset Default
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !isDirty}
            className="h-8 text-xs bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all shadow-xs"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                Updating Discord...
              </>
            ) : (
              <>
                <Save className="size-3.5 mr-1.5" />
                Save & Apply Live
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Main Grid: Controls & Discord Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: Status & Activity Settings (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card 1: Online Status Indicator */}
          <Card className="border border-border/80 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Gateway Status</CardTitle>
              <CardDescription>
                Select the presence indicator shown on your bot profile across all servers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {STATUS_OPTIONS.map((opt) => {
                  const isSelected = status === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStatus(opt.id)}
                      className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                        isSelected
                          ? "border-primary/60 bg-primary/10 shadow-xs"
                          : "border-border/60 bg-muted/10 hover:bg-muted/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2 w-full justify-between mb-1.5">
                        <span className={`size-3 rounded-full ${opt.color} ring-2 ring-background`} />
                        {isSelected && <Check className="size-3.5 text-primary" />}
                      </div>
                      <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Activity Type & Content */}
          <Card className="border border-border/80 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Activity & Status Text</CardTitle>
              <CardDescription>
                Customize what the bot is doing (e.g. Playing, Streaming, Custom Status, Listening).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Activity Type Selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Activity Type</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ACTIVITY_OPTIONS.map((opt) => {
                    const isSelected = activityType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setActivityType(opt.id)}
                        className={`px-3 py-2 rounded-md border text-xs font-medium text-left transition-all flex items-center justify-between ${
                          isSelected
                            ? "border-primary/60 bg-primary/10 text-primary font-semibold"
                            : "border-border/60 bg-muted/10 text-muted-foreground hover:text-foreground hover:bg-muted/20"
                        }`}
                      >
                        <span className="truncate">{opt.label}</span>
                        {isSelected && <Check className="size-3 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Activity Name Input */}
              {activityType !== "none" && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="activity_text" className="text-xs font-medium text-muted-foreground">
                      Status Text
                    </Label>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {activityName.length}/128
                    </span>
                  </div>
                  <Input
                    id="activity_text"
                    value={activityName}
                    onChange={(e) => setActivityName(e.target.value.slice(0, 128))}
                    placeholder={
                      ACTIVITY_OPTIONS.find((a) => a.id === activityType)?.placeholder || "At your service"
                    }
                    className="h-9 text-xs bg-muted/20 border-border/60 font-medium text-foreground"
                  />

                  {/* Dynamic Template Tokens */}
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] text-muted-foreground block">
                      Insert dynamic placeholders (computed at runtime):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleInsertToken("{servers}")}
                        className="px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 border border-border/50 text-[11px] font-mono text-foreground transition-colors"
                      >
                        + &#123;servers&#125; ({initialData.guild_count ?? 4})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInsertToken("{members}")}
                        className="px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 border border-border/50 text-[11px] font-mono text-foreground transition-colors"
                      >
                        + &#123;members&#125; ({initialData.member_count ?? 13})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInsertToken("{version}")}
                        className="px-2 py-0.5 rounded bg-muted/40 hover:bg-muted/70 border border-border/50 text-[11px] font-mono text-foreground transition-colors"
                      >
                        + &#123;version&#125;
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Streaming URL (Only if Streaming) */}
              {activityType === "streaming" && (
                <div className="space-y-1.5 pt-2 border-t border-border/40">
                  <Label htmlFor="stream_url" className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Tv className="size-3.5 text-purple-400" />
                    Twitch / YouTube Stream URL
                  </Label>
                  <Input
                    id="stream_url"
                    value={streamingUrl}
                    onChange={(e) => setStreamingUrl(e.target.value)}
                    placeholder="https://twitch.tv/yourchannel"
                    className="h-9 text-xs bg-muted/20 border-border/60 text-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Discord requires a valid Twitch or YouTube channel URL to display purple streaming status.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Live Discord Profile Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border border-border/80 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Discord Live Preview</CardTitle>
              <CardDescription>
                Simulated view of how Neverland appears in member lists and chat profiles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Discord Sidebar Member Item Preview */}
              <div className="rounded-lg bg-[#2b2d31] p-3 text-[#dbdee1] border border-border/40 space-y-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Member List Item
                </div>
                <div className="flex items-center gap-3 p-2 rounded-md hover:bg-[#35373c] transition-colors cursor-pointer">
                  {/* Avatar with Status badge */}
                  <div className="relative size-9 shrink-0">
                    <div className="size-9 rounded-full bg-emerald-700/40 border border-emerald-500/30 flex items-center justify-center font-bold text-white overflow-hidden">
                      {botAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={botAvatarUrl} alt={botName} className="size-full object-cover" />
                      ) : (
                        <span>N</span>
                      )}
                    </div>
                    {/* Status Badge */}
                    <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-[#2b2d31] flex items-center justify-center">
                      {status === "online" && <div className="size-2.5 rounded-full bg-[#23a55a]" />}
                      {status === "idle" && (
                        <div className="size-2.5 rounded-full bg-[#f0b232] relative">
                          <div className="absolute -top-0.5 -left-0.5 size-1.5 rounded-full bg-[#2b2d31]" />
                        </div>
                      )}
                      {status === "dnd" && (
                        <div className="size-2.5 rounded-full bg-[#f23f43] flex items-center justify-center">
                          <div className="w-1.5 h-0.5 bg-[#2b2d31] rounded-full" />
                        </div>
                      )}
                      {status === "invisible" && <div className="size-2 rounded-full border border-[#80848e] bg-transparent" />}
                    </div>
                  </div>

                  {/* Name and Activity */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 leading-tight">
                      <span className="font-semibold text-xs text-white truncate">{botName}</span>
                      <span className="bg-[#5865f2] text-white text-[9px] font-bold px-1 py-0.2 rounded leading-none uppercase">
                        APP
                      </span>
                    </div>

                    {/* Subtitle / Activity Text */}
                    {activityType !== "none" && resolvedActivityText && (
                      <div className="text-[11px] text-[#949ba4] truncate flex items-center gap-1 mt-0.5">
                        {activityType === "streaming" && (
                          <span className="text-purple-400 font-medium">Streaming</span>
                        )}
                        {activityType === "playing" && (
                          <span className="text-zinc-400">Playing</span>
                        )}
                        {activityType === "listening" && (
                          <span className="text-zinc-400">Listening to</span>
                        )}
                        {activityType === "watching" && (
                          <span className="text-zinc-400">Watching</span>
                        )}
                        {activityType === "competing" && (
                          <span className="text-zinc-400">Competing in</span>
                        )}
                        <span className="text-[#dbdee1] font-medium truncate">{resolvedActivityText}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Discord Profile Card Popup Simulation */}
                <div className="pt-2 border-t border-[#3f4147]/60 space-y-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                    Mini Profile Banner
                  </div>
                  <div className="rounded-md bg-[#111214] p-3 border border-[#313338] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{botName}</span>
                      <Badge variant="outline" className="border-border text-[10px] text-muted-foreground font-mono">
                        Discord Bot
                      </Badge>
                    </div>
                    <div className="bg-[#232428] rounded p-2 text-xs space-y-1">
                      <div className="text-[10px] font-semibold uppercase text-zinc-400">ACTIVITY</div>
                      <div className="text-white text-xs font-medium">
                        {activityType === "custom" && resolvedActivityText}
                        {activityType === "playing" && `Playing ${resolvedActivityText}`}
                        {activityType === "streaming" && `Streaming ${resolvedActivityText}`}
                        {activityType === "listening" && `Listening to ${resolvedActivityText}`}
                        {activityType === "watching" && `Watching ${resolvedActivityText}`}
                        {activityType === "competing" && `Competing in ${resolvedActivityText}`}
                        {activityType === "none" && <span className="text-muted-foreground italic">None</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
