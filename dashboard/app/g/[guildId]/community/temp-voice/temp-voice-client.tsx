"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Mic,
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Sliders,
  Radio,
  Lock,
  Unlock,
  Users,
  Clock,
  Info,
  Plus,
  Trash2,
  FolderTree,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

import {
  TempVoiceArea,
  TempVoiceConfig,
  TempVoiceConfigResponse,
  ActiveTempChannel,
  DEFAULT_TEMP_VOICE_CONFIG,
  newTempVoiceArea,
  tempVoiceConfigSchema,
} from "@/lib/modules/temp-voice";
import { GuildChannel, GuildOverview } from "@/lib/control-plane";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SelectSearchable } from "@/components/ui/select-searchable";
import {
  SavedStateStrip,
  resolveChannelName,
} from "@/components/saved-state-strip";
import { stripEmojis } from "@/lib/utils";
import TempVoiceLoading from "./loading";

interface TempVoiceClientProps {
  guildId: string;
}

const MAX_AREAS = 10;

function parseApiValidationErrors(details: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === "string") {
        errors["general"] = item;
      } else if (item && typeof item === "object") {
        const anyItem = item as Record<string, unknown>;
        if (Array.isArray(anyItem.loc) && anyItem.loc.length > 0) {
          const key = anyItem.loc[anyItem.loc.length - 1];
          const fullKey = anyItem.loc.join(".");
          const msg = typeof anyItem.msg === "string" ? anyItem.msg : "Invalid value";
          errors[String(key)] = msg;
          errors[fullKey] = msg;
        } else if (typeof anyItem.field === "string" && typeof anyItem.message === "string") {
          errors[anyItem.field] = anyItem.message;
        } else if (typeof anyItem.msg === "string") {
          errors["general"] = anyItem.msg;
        }
      }
    }
  } else if (typeof details === "string") {
    errors["general"] = details;
  }
  return errors;
}

function renderPreview(naming: string, guildName: string): string {
  if (!naming) return "";
  return naming
    .replace(/\{username\}/g, "Alex")
    .replace(/\{n\}/g, "1")
    .replace(/\{server\}/g, guildName || "Neverland");
}

export function TempVoiceClient({ guildId }: TempVoiceClientProps) {
  // Remote data state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [guildName, setGuildName] = useState<string>("Neverland");

  // Module state
  const [enabled, setEnabled] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);

  // Areas (multi temp voice areas)
  const [areas, setAreas] = useState<TempVoiceArea[]>([]);

  // Active channels list state
  const [activeChannels, setActiveChannels] = useState<ActiveTempChannel[]>([]);
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false);

  // Saved baseline config for dirty checking
  const [savedConfig, setSavedConfig] = useState<TempVoiceConfig>(DEFAULT_TEMP_VOICE_CONFIG);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Naming input refs per area (for token insertion at caret position)
  const namingInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  // Filtered voice channels and categories
  const voiceChannels = useMemo(() => {
    return channels.filter((c) => c.type === "voice");
  }, [channels]);

  const categories = useMemo(() => {
    return channels.filter((c) => c.type === "category");
  }, [channels]);

  // Load all initial data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [configRes, channelsRes, activeRes, overviewRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/modules/temp_voice/config`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/temp-voice/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/overview`, { cache: "no-store" }).catch(() => null),
      ]);

      if (!configRes.ok) {
        const errJson = await configRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch temp voice config (${configRes.status})`);
      }
      if (!channelsRes.ok) {
        throw new Error(`Failed to fetch server channels (${channelsRes.status})`);
      }

      const configData: TempVoiceConfigResponse = await configRes.json();
      const channelsData: GuildChannel[] = await channelsRes.json();
      const activeData: ActiveTempChannel[] = activeRes.ok ? await activeRes.json().catch(() => []) : [];

      if (overviewRes && overviewRes.ok) {
        const ov: GuildOverview = await overviewRes.json().catch(() => null);
        if (ov?.name) setGuildName(ov.name);
      }

      setChannels(Array.isArray(channelsData) ? channelsData : []);
      setActiveChannels(Array.isArray(activeData) ? activeData : []);

      setEnabled(Boolean(configData.enabled));

      const cfg = configData.config || DEFAULT_TEMP_VOICE_CONFIG;
      setSavedConfig(cfg);
      setAreas(Array.isArray(cfg.areas) ? cfg.areas : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load Temporary Voice configuration";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dirty state calculation
  const isDirty = useMemo(() => {
    return JSON.stringify(areas) !== JSON.stringify(savedConfig.areas ?? []);
  }, [areas, savedConfig]);

  // Discard changes
  const handleDiscardChanges = () => {
    if (!isDirty) return;
    setAreas(JSON.parse(JSON.stringify(savedConfig.areas ?? [])));
    setFieldErrors({});
    toast.info("Unsaved changes discarded");
  };

  // Insert token chip into an area's naming input at caret position
  const handleInsertToken = (areaIndex: number, token: string) => {
    const area = areas[areaIndex];
    if (!area) return;
    const input = namingInputRefs.current.get(areaIndex);

    if (!input) {
      handleUpdateArea(areaIndex, { naming: area.naming ? `${area.naming} ${token}` : token });
      return;
    }

    const start = input.selectionStart ?? area.naming.length;
    const end = input.selectionEnd ?? area.naming.length;
    const next = area.naming.substring(0, start) + token + area.naming.substring(end);
    handleUpdateArea(areaIndex, { naming: next });

    setTimeout(() => {
      input.focus();
      const newPos = start + token.length;
      input.setSelectionRange(newPos, newPos);
    }, 0);
  };

  // Area management
  const handleAddArea = () => {
    if (areas.length >= MAX_AREAS) {
      toast.error(`Maximum of ${MAX_AREAS} temp voice areas allowed`);
      return;
    }
    const area = newTempVoiceArea(areas.length);
    // Ensure unique slug
    const existingSlugs = new Set(areas.map((a) => a.id));
    let counter = areas.length + 1;
    while (existingSlugs.has(area.id)) {
      counter += 1;
      area.id = `lounge-${counter}`;
      area.title = `Lounge Area ${counter}`;
    }
    setAreas([...areas, area]);
    toast.success("New temp voice area added — configure its trigger channel, then save");
  };

  const handleRemoveArea = (index: number) => {
    const area = areas[index];
    setAreas((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(`areas.${index}`)) next[key] = value;
      }
      return next;
    });
    if (area?.id) {
      toast.info(`Area "${area.title || area.id}" removed — save to apply`);
    }
  };

  const handleUpdateArea = (index: number, updates: Partial<TempVoiceArea>) => {
    setAreas((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
    setFieldErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(`areas.${index}`)) next[key] = value;
      }
      return next;
    });
  };

  // Save config
  const handleSave = async () => {
    // Client-side validation mirroring the backend model
    const parsed = tempVoiceConfigSchema.safeParse({ areas });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.join(".")] = issue.message;
      }
      setFieldErrors(errors);
      const firstMsg = Object.values(errors)[0];
      toast.error(firstMsg || "Please fix the validation errors");
      return;
    }

    setIsSaving(true);
    setFieldErrors({});

    const payload: TempVoiceConfig = { areas };

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/temp_voice/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 422 && data.details) {
          const parsed = parseApiValidationErrors(data.details);
          setFieldErrors(parsed);
          const firstErr = Object.values(parsed)[0];
          throw new Error(firstErr || "Validation error on server");
        }
        throw new Error(data.error || `Failed to save settings (${res.status})`);
      }

      const saved: TempVoiceConfig = data && typeof data === "object" && "areas" in data ? data : payload;
      setSavedConfig(saved);
      setAreas(saved.areas ?? []);
      toast.success(`Temp Voice settings saved — ${areas.length} area${areas.length === 1 ? "" : "s"} active`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle module state
  const handleToggleModule = async (newEnabled: boolean) => {
    setIsTogglingState(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/temp_voice/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to toggle module (${res.status})`);
      }
      setEnabled(newEnabled);
      toast.success(newEnabled ? "Temp Voice module enabled" : "Temp Voice module disabled");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle module";
      toast.error(msg);
    } finally {
      setIsTogglingState(false);
    }
  };

  // Refresh active channels
  const handleRefreshChannels = async () => {
    setIsRefreshingChannels(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/temp-voice/channels`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load active channels (${res.status})`);
      }
      const data: ActiveTempChannel[] = await res.json();
      setActiveChannels(Array.isArray(data) ? data : []);
      toast.success("Active channels refreshed");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to refresh channels";
      toast.error(msg);
    } finally {
      setIsRefreshingChannels(false);
    }
  };

  if (isLoading) {
    return <TempVoiceLoading />;
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Temp Voice</h1>
          <p className="text-sm text-muted-foreground">
            Configure dynamic temporary voice lounges and active channels.
          </p>
        </div>

        <Card className="border-destructive/30 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-destructive">Failed to Load Settings</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              The bot control plane could not provide temporary voice configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground font-medium">{loadError}</p>
            <p className="text-xs text-muted-foreground">
              Verify that the bot is running, <code className="font-mono bg-muted px-1 py-0.5 rounded">CONTROL_PLANE_SECRET</code> matches, and the bot has joined this server.
            </p>
          </CardContent>
          <CardFooter className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => loadData()}>
              <RefreshCw className="size-3.5 mr-1.5" />
              <span>Retry</span>
            </Button>
            <Button variant="ghost" size="sm" render={<Link href="/settings" />}>
              <span>Diagnostics</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const enabledAreas = areas.filter((a) => a.trigger_channel_id).length;

  return (
    <div className="space-y-6">
      {/* 1. Status Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Mic className="size-6 text-primary shrink-0" />
            <h1 className="text-2xl font-bold tracking-tight">Temp Voice</h1>
            <Badge
              variant="outline"
              className={
                enabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs"
                  : "border-muted-foreground/30 bg-muted/40 text-muted-foreground text-xs"
              }
            >
              {enabled ? "Active" : "Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Create on-demand temporary voice lounges from multiple dedicated areas — each area has its own trigger channel, category, and rules.
          </p>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {isDirty && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDiscardChanges}
                disabled={isSaving}
                className="h-8 text-xs"
              >
                <RotateCcw className="size-3.5 mr-1 text-muted-foreground" />
                <span>Discard</span>
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-8 text-xs shadow-xs"
              >
                <Save className="size-3.5 mr-1" />
                <span>{isSaving ? "Saving..." : "Save Changes"}</span>
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
            <Label
              htmlFor="temp-voice-enabled-toggle"
              className="text-xs font-medium cursor-pointer text-foreground"
            >
              {enabled ? "Module Enabled" : "Module Disabled"}
            </Label>
            <Switch
              id="temp-voice-enabled-toggle"
              checked={enabled}
              onCheckedChange={handleToggleModule}
              disabled={isTogglingState}
            />
          </div>
        </div>
      </div>

      {/* Warning if enabled without any trigger channel */}
      {enabled && enabledAreas === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400">
          <Info className="size-4 mt-0.5 shrink-0" />
          <p>
            Temp Voice is enabled, but no area has a <strong>Trigger Channel</strong> yet. Add an area below and choose a voice channel to begin generating lounges.
          </p>
        </div>
      )}

      {/* Main Content Layout: Stack of Cards */}
      <div className="space-y-6">
        {/* Card 1: Areas Configuration Card */}
        <Card className="border border-border/80">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-muted-foreground" />
                <CardTitle className="text-base font-semibold">Temp Voice Areas</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {areas.length} / {MAX_AREAS}
                </Badge>
                {isDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium ml-1">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved
                  </span>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddArea}
                disabled={areas.length >= MAX_AREAS || isSaving}
                className="h-8 gap-1 text-xs"
              >
                <Plus className="size-3.5" />
                Add Area
              </Button>
            </div>
            <CardDescription>
              Register multiple dedicated areas for temporary voice. Each area pairs one trigger voice channel with a destination category and its own naming, limits, and cleanup delay — members who join the trigger instantly get a lounge in that area.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Always-Visible Saved State Strip */}
            <SavedStateStrip
              items={[
                {
                  label: "Areas",
                  value: `${savedConfig.areas?.length ?? 0} configured`,
                },
                {
                  label: "Triggers",
                  value:
                    (savedConfig.areas ?? [])
                      .filter((a) => a.trigger_channel_id)
                      .map((a) => resolveChannelName(a.trigger_channel_id, channels, "—"))
                      .length > 0 ? (
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        {(savedConfig.areas ?? [])
                          .filter((a) => a.trigger_channel_id)
                          .map((a) => (
                            <React.Fragment key={a.id}>
                              {resolveChannelName(a.trigger_channel_id, channels, "—")}
                              <span className="text-muted-foreground/50">·</span>
                            </React.Fragment>
                          ))}
                      </span>
                    ) : (
                      "None"
                    ),
                },
              ]}
              isDirty={isDirty}
              isSaving={isSaving}
              onSave={handleSave}
              onDiscard={handleDiscardChanges}
            />

            {areas.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 p-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                  <Layers className="size-6 text-muted-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  No temp voice areas yet
                </h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-md">
                  Each area is a dedicated place for temporary voice: pick a trigger channel, a destination category, and how lounges are named and cleaned up. Add as many areas as you need (up to {MAX_AREAS}).
                </p>
                <Button
                  size="sm"
                  onClick={handleAddArea}
                  disabled={isSaving}
                  className="mt-4 gap-1.5"
                >
                  <Plus className="size-4" />
                  Add your first area
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {areas.map((area, idx) => {
                  const areaErrorPrefix = `areas.${idx}`;
                  const preview = renderPreview(area.naming, guildName);
                  return (
                    <div
                      key={idx}
                      className="rounded-lg border border-border/70 bg-card p-4 space-y-4 hover:border-border transition-colors"
                    >
                      {/* Area header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                            <Mic className="size-4" />
                          </span>
                          <Input
                            value={area.title}
                            onChange={(e) => handleUpdateArea(idx, { title: e.target.value })}
                            placeholder="Area name (e.g. Gaming Lounges)"
                            maxLength={64}
                            className="h-8 w-52 font-semibold text-sm border-transparent bg-transparent hover:border-input focus-visible:border-input px-2"
                          />
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {area.id}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {area.trigger_channel_id ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-[10px] gap-1"
                            >
                              <Radio className="size-2.5" />
                              Trigger set
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]"
                            >
                              No trigger
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveArea(idx)}
                            disabled={isSaving}
                            title="Remove this area"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Trigger & Category */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor={`trigger-${idx}`} className="text-xs font-semibold text-foreground">
                            Trigger Channel <span className="text-destructive">*</span>
                          </Label>
                          <SelectSearchable
                            id={`trigger-${idx}`}
                            value={area.trigger_channel_id ?? "none"}
                            onValueChange={(val) =>
                              handleUpdateArea(idx, {
                                trigger_channel_id: val === "none" ? null : val,
                              })
                            }
                            options={[
                              { value: "none", label: "Disabled (No trigger channel)" },
                              ...voiceChannels.map((c) => ({
                                value: c.id,
                                label: stripEmojis(c.name) || c.name,
                              })),
                            ]}
                            placeholder="Select a trigger channel..."
                            searchPlaceholder="Search voice channels..."
                            aria-invalid={!!fieldErrors[`${areaErrorPrefix}.trigger_channel_id`]}
                          />
                          {fieldErrors[`${areaErrorPrefix}.trigger_channel_id`] && (
                            <p className="text-xs text-destructive">
                              {fieldErrors[`${areaErrorPrefix}.trigger_channel_id`]}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            When a member joins this channel, the bot creates a new voice lounge and moves them into it.
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`category-${idx}`} className="text-xs font-semibold text-foreground">
                            Destination Category
                          </Label>
                          <SelectSearchable
                            id={`category-${idx}`}
                            value={area.category_id ?? "none"}
                            onValueChange={(val) =>
                              handleUpdateArea(idx, {
                                category_id: val === "none" ? null : val,
                              })
                            }
                            options={[
                              { value: "none", label: "No category (Uncategorized)" },
                              ...categories.map((cat) => ({
                                value: cat.id,
                                label: stripEmojis(cat.name) || cat.name,
                              })),
                            ]}
                            placeholder="Select a category..."
                            searchPlaceholder="Search categories..."
                            aria-invalid={!!fieldErrors[`${areaErrorPrefix}.category_id`]}
                          />
                          {fieldErrors[`${areaErrorPrefix}.category_id`] && (
                            <p className="text-xs text-destructive">
                              {fieldErrors[`${areaErrorPrefix}.category_id`]}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <FolderTree className="size-3" />
                            Lounges for this area are created inside this category.
                          </p>
                        </div>
                      </div>

                      {/* Naming Pattern */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor={`naming-${idx}`} className="text-xs font-semibold text-foreground">
                            Naming Pattern <span className="text-destructive">*</span>
                          </Label>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {area.naming.length}/80 characters
                          </span>
                        </div>
                        <Input
                          id={`naming-${idx}`}
                          ref={(el) => {
                            if (el) namingInputRefs.current.set(idx, el);
                            else namingInputRefs.current.delete(idx);
                          }}
                          type="text"
                          maxLength={80}
                          value={area.naming}
                          onChange={(e) => handleUpdateArea(idx, { naming: e.target.value })}
                          className={
                            fieldErrors[`${areaErrorPrefix}.naming`]
                              ? "border-destructive focus-visible:ring-destructive font-mono text-sm"
                              : "font-mono text-sm"
                          }
                        />
                        {fieldErrors[`${areaErrorPrefix}.naming`] && (
                          <p className="text-xs text-destructive">{fieldErrors[`${areaErrorPrefix}.naming`]}</p>
                        )}

                        {/* Token Chips */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[11px] text-muted-foreground font-medium mr-1">Insert token:</span>
                          {["{username}", "{n}", "{server}"].map((token) => (
                            <button
                              key={token}
                              type="button"
                              onClick={() => handleInsertToken(idx, token)}
                              className="inline-flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-muted transition-colors cursor-pointer"
                            >
                              + &#123;{token.slice(1, -1)}&#125;
                            </button>
                          ))}
                        </div>

                        {/* Live Preview Box */}
                        <div className="rounded-lg border border-border/70 bg-muted/30 p-3 mt-2">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                            <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                              <Sliders className="size-3 text-primary" />
                              Live Channel Name Preview
                            </span>
                            <span className="font-mono">{preview.length}/80 chars</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Radio className="size-4 text-emerald-500" />
                            <span className="font-semibold">{preview || "Untitled Channel"}</span>
                          </div>
                        </div>
                      </div>

                      {/* Limits & Timers */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        <div className="space-y-1.5">
                          <Label htmlFor={`user-limit-${idx}`} className="text-xs font-semibold text-foreground">
                            Default User Limit
                          </Label>
                          <Input
                            id={`user-limit-${idx}`}
                            type="number"
                            min={0}
                            max={99}
                            value={area.user_limit}
                            onChange={(e) =>
                              handleUpdateArea(idx, { user_limit: Number(e.target.value) })
                            }
                            className={
                              fieldErrors[`${areaErrorPrefix}.user_limit`]
                                ? "border-destructive focus-visible:ring-destructive"
                                : ""
                            }
                          />
                          {fieldErrors[`${areaErrorPrefix}.user_limit`] && (
                            <p className="text-xs text-destructive">
                              {fieldErrors[`${areaErrorPrefix}.user_limit`]}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Participant cap for newly created lounges. Set to <strong>0</strong> for unlimited occupants (0–99).
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`auto-delete-${idx}`} className="text-xs font-semibold text-foreground">
                            Auto-Delete Delay (seconds) <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            id={`auto-delete-${idx}`}
                            type="number"
                            min={15}
                            max={3600}
                            value={area.auto_delete_seconds}
                            onChange={(e) =>
                              handleUpdateArea(idx, {
                                auto_delete_seconds: Number(e.target.value),
                              })
                            }
                            className={
                              fieldErrors[`${areaErrorPrefix}.auto_delete_seconds`]
                                ? "border-destructive focus-visible:ring-destructive"
                                : ""
                            }
                          />
                          {fieldErrors[`${areaErrorPrefix}.auto_delete_seconds`] && (
                            <p className="text-xs text-destructive">
                              {fieldErrors[`${areaErrorPrefix}.auto_delete_seconds`]}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Delay before an empty temporary lounge is automatically pruned (15–3600 seconds, default 60s).
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>

          {isDirty && (
            <CardFooter className="border-t border-border/50 bg-muted/10 px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-muted-foreground">You have unsaved changes in this configuration.</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDiscardChanges}
                  disabled={isSaving}
                  className="h-8 text-xs"
                >
                  <RotateCcw className="size-3.5 mr-1" />
                  <span>Discard</span>
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="h-8 text-xs shadow-xs"
                >
                  <Save className="size-3.5 mr-1" />
                  <span>{isSaving ? "Saving..." : "Save Changes"}</span>
                </Button>
              </div>
            </CardFooter>
          )}
        </Card>

        {/* Card 2: Active Channels Card */}
        <Card className="border border-border/80">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-emerald-500" />
                <CardTitle className="text-base font-semibold">Active Temporary Channels</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {activeChannels.length} active
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshChannels}
                disabled={isRefreshingChannels}
                className="h-8 text-xs"
              >
                <RefreshCw
                  className={`size-3.5 mr-1.5 ${isRefreshingChannels ? "animate-spin" : ""}`}
                />
                <span>Refresh</span>
              </Button>
            </div>
            <CardDescription>
              Live voice lounges currently maintained on your Discord server by Neverland. Empty or deleted channels are periodically pruned by the bot.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {activeChannels.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/80 p-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <Mic className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  No temporary channels right now
                </h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                  Active lounges will automatically appear here as soon as members join any area trigger channel.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60 rounded-lg border border-border/80">
                {activeChannels.map((channel) => {
                  const isStillInGuild = channels.some(
                    (c) => String(c.id) === String(channel.channel_id)
                  );
                  const area = areas.find((a) => a.id === channel.area_id);

                  return (
                    <div
                      key={channel.channel_id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-semibold text-sm text-foreground truncate break-words">
                            {channel.name}
                          </span>
                          {area && (
                            <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                              <Layers className="size-2.5" />
                              {area.title || area.id}
                            </Badge>
                          )}
                          {channel.locked ? (
                            <Badge
                              variant="outline"
                              className="border-destructive/30 bg-destructive/10 text-destructive text-[10px] gap-1 px-1.5 py-0"
                            >
                              <Lock className="size-3" />
                              Locked
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-[10px] gap-1 px-1.5 py-0"
                            >
                              <Unlock className="size-3" />
                              Unlocked
                            </Badge>
                          )}
                          {!isStillInGuild && (
                            <Badge
                              variant="outline"
                              className="border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] gap-1 px-1.5 py-0"
                              title="Channel was deleted from Discord; the bot will prune this record on its next cleanup pass"
                            >
                              <Clock className="size-2.5" />
                              Deleted on Discord (pruning soon)
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span>
                            Owner: <code className="font-mono bg-muted/60 px-1 py-0.5 rounded text-foreground text-[11px]">&lt;@{channel.owner_id}&gt;</code>
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Users className="size-3" />
                            {channel.member_count} occupant{channel.member_count === 1 ? "" : "s"}
                            {channel.user_limit > 0 && ` / ${channel.user_limit}`}
                          </span>
                          {channel.created_at && (
                            <>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" />
                                Created {new Date(channel.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-[11px] px-2 py-0.5">
                          ID: {channel.channel_id}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
