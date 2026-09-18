"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Ticket,
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Send,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Info,
  Clock,
  Crown,
  User,
  Shield,
  Tag,
  Hash,
} from "lucide-react";
import { toast } from "sonner";

import {
  TicketsConfig,
  TicketsConfigResponse,
  TicketCategory,
  TicketItem,
  TicketsSummaryResponse,
  DEFAULT_TICKETS_CONFIG,
  ticketsConfigSchema,
} from "@/lib/modules/tickets";
import { GuildChannel, GuildRole, GuildOverview } from "@/lib/control-plane";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SelectSearchable } from "@/components/ui/select-searchable";
import {
  SavedStateStrip,
  resolveChannelName,
} from "@/components/saved-state-strip";
import TicketsLoading from "./loading";

interface TicketsClientProps {
  guildId: string;
}

const PRESET_COLORS = [
  { label: "Blurple", value: "#5865F2" },
  { label: "Emerald", value: "#10B981" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Rose", value: "#F43F5E" },
  { label: "Indigo", value: "#6366F1" },
  { label: "Slate", value: "#64748B" },
];

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

export function TicketsClient({ guildId }: TicketsClientProps) {
  // Remote data
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [guildName, setGuildName] = useState<string>("Neverland");

  // Module state
  const [enabled, setEnabled] = useState(true);
  const [isTogglingState, setIsTogglingState] = useState(false);

  // Form states
  const [panelChannelId, setPanelChannelId] = useState<string | null>(null);
  const [logsChannelId, setLogsChannelId] = useState<string | null>(null);
  const [panelContent, setPanelContent] = useState<string>("");
  const [panelEmbedTitle, setPanelEmbedTitle] = useState<string>("Support Tickets");
  const [panelEmbedDescription, setPanelEmbedDescription] = useState<string>(
    "Select a category below to open a ticket."
  );
  const [panelEmbedColor, setPanelEmbedColor] = useState<string>("#5865F2");
  const [buttonLabel, setButtonLabel] = useState<string>("Open a ticket");
  const [buttonEmoji, setButtonEmoji] = useState<string>("");
  const [maxOpenTickets, setMaxOpenTickets] = useState<number>(1);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [categories, setCategories] = useState<TicketCategory[]>([
    {
      id: "general",
      name: "General Support",
      emoji: "",
      category_channel_id: null,
      staff_role_ids: [],
      naming: "ticket-{username}-{number}",
    },
  ]);

  // Baseline config for dirty check
  const [savedConfig, setSavedConfig] = useState<TicketsConfig>(DEFAULT_TICKETS_CONFIG);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // Tickets list and summary
  const [ticketsList, setTicketsList] = useState<TicketItem[]>([]);
  const [summary, setSummary] = useState<TicketsSummaryResponse>({ open_count: 0, total_count: 0 });
  const [isRefreshingTickets, setIsRefreshingTickets] = useState(false);

  // Filter text & category channels
  const textChannels = useMemo(() => channels.filter((c) => c.type === "text"), [channels]);
  const categoryChannels = useMemo(() => channels.filter((c) => c.type === "category"), [channels]);

  // Initial data loading
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [configRes, channelsRes, rolesRes, summaryRes, listRes, overviewRes] =
        await Promise.all([
          fetch(`/api/internal/guilds/${guildId}/modules/tickets/config`, { cache: "no-store" }),
          fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
          fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }),
          fetch(`/api/internal/guilds/${guildId}/tickets`, { cache: "no-store" }),
          fetch(`/api/internal/guilds/${guildId}/tickets/list`, { cache: "no-store" }),
          fetch(`/api/internal/guilds/${guildId}/overview`, { cache: "no-store" }).catch(() => null),
        ]);

      if (!configRes.ok) {
        const err = await configRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch tickets config (${configRes.status})`);
      }
      if (!channelsRes.ok) {
        throw new Error(`Failed to fetch channels (${channelsRes.status})`);
      }

      const configData: TicketsConfigResponse = await configRes.json();
      const channelsData: GuildChannel[] = await channelsRes.json();
      const rolesData = rolesRes.ok ? await rolesRes.json().catch(() => ({ roles: [] })) : { roles: [] };
      const summaryData: TicketsSummaryResponse = summaryRes.ok
        ? await summaryRes.json().catch(() => ({ open_count: 0, total_count: 0 }))
        : { open_count: 0, total_count: 0 };
      const listData: TicketItem[] = listRes.ok ? await listRes.json().catch(() => []) : [];

      if (overviewRes && overviewRes.ok) {
        const ov: GuildOverview = await overviewRes.json().catch(() => null);
        if (ov?.name) setGuildName(ov.name);
      }

      setChannels(Array.isArray(channelsData) ? channelsData : []);
      setRoles(Array.isArray(rolesData?.roles) ? rolesData.roles : []);
      setSummary(summaryData);
      setTicketsList(Array.isArray(listData) ? listData : []);

      setEnabled(Boolean(configData.enabled));

      const cfg = configData.config || DEFAULT_TICKETS_CONFIG;
      setSavedConfig(cfg);
      setPanelChannelId(cfg.panel_channel_id ?? null);
      setLogsChannelId(cfg.logs_channel_id ?? null);
      setPanelContent(cfg.panel_content ?? "");
      setPanelEmbedTitle(cfg.panel_embed?.title ?? "Support Tickets");
      setPanelEmbedDescription(cfg.panel_embed?.description ?? "Select a category below to open a ticket.");
      setPanelEmbedColor(cfg.panel_embed?.color ?? "#5865F2");
      setButtonLabel(cfg.button_label ?? "Open a ticket");
      setButtonEmoji(cfg.button_emoji ?? "");
      setMaxOpenTickets(cfg.max_open_tickets ?? 1);
      setCooldownSeconds(cfg.cooldown_seconds ?? 0);
      setCategories(Array.isArray(cfg.categories) && cfg.categories.length > 0 ? cfg.categories : DEFAULT_TICKETS_CONFIG.categories);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load Tickets configuration";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh recent tickets list
  const handleRefreshTickets = async () => {
    setIsRefreshingTickets(true);
    try {
      const [sumRes, listRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/tickets`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/tickets/list`, { cache: "no-store" }),
      ]);
      if (sumRes.ok) {
        const sum = await sumRes.json();
        setSummary(sum);
      }
      if (listRes.ok) {
        const list = await listRes.json();
        setTicketsList(Array.isArray(list) ? list : []);
      }
      toast.success("Tickets list refreshed");
    } catch {
      toast.error("Failed to refresh tickets");
    } finally {
      setIsRefreshingTickets(false);
    }
  };

  // Check dirty state
  const isDirty = useMemo(() => {
    if (panelChannelId !== (savedConfig.panel_channel_id ?? null)) return true;
    if (logsChannelId !== (savedConfig.logs_channel_id ?? null)) return true;
    if (panelContent !== (savedConfig.panel_content ?? "")) return true;
    if (panelEmbedTitle !== (savedConfig.panel_embed?.title ?? "Support Tickets")) return true;
    if (panelEmbedDescription !== (savedConfig.panel_embed?.description ?? "Select a category below to open a ticket."))
      return true;
    if (panelEmbedColor !== (savedConfig.panel_embed?.color ?? "#5865F2")) return true;
    if (buttonLabel !== (savedConfig.button_label ?? "Open a ticket")) return true;
    if (buttonEmoji !== (savedConfig.button_emoji ?? "")) return true;
    if (maxOpenTickets !== (savedConfig.max_open_tickets ?? 1)) return true;
    if (cooldownSeconds !== (savedConfig.cooldown_seconds ?? 0)) return true;
    return JSON.stringify(categories) !== JSON.stringify(savedConfig.categories ?? []);
  }, [
    panelChannelId,
    logsChannelId,
    panelContent,
    panelEmbedTitle,
    panelEmbedDescription,
    panelEmbedColor,
    buttonLabel,
    buttonEmoji,
    maxOpenTickets,
    cooldownSeconds,
    categories,
    savedConfig,
  ]);

  // Discard changes
  const handleDiscardChanges = () => {
    if (!isDirty) return;
    setPanelChannelId(savedConfig.panel_channel_id ?? null);
    setLogsChannelId(savedConfig.logs_channel_id ?? null);
    setPanelContent(savedConfig.panel_content ?? "");
    setPanelEmbedTitle(savedConfig.panel_embed?.title ?? "Support Tickets");
    setPanelEmbedDescription(savedConfig.panel_embed?.description ?? "Select a category below to open a ticket.");
    setPanelEmbedColor(savedConfig.panel_embed?.color ?? "#5865F2");
    setButtonLabel(savedConfig.button_label ?? "Open a ticket");
    setButtonEmoji(savedConfig.button_emoji ?? "");
    setMaxOpenTickets(savedConfig.max_open_tickets ?? 1);
    setCooldownSeconds(savedConfig.cooldown_seconds ?? 0);
    setCategories(savedConfig.categories ?? DEFAULT_TICKETS_CONFIG.categories);
    setFieldErrors({});
    toast.info("Unsaved changes discarded");
  };

  // Toggle module state
  const handleToggleEnabled = async (nextState: boolean) => {
    setIsTogglingState(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/tickets/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update status (${res.status})`);
      }
      setEnabled(nextState);
      toast.success(nextState ? "Tickets module enabled" : "Tickets module disabled");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle Tickets state";
      toast.error(msg);
    } finally {
      setIsTogglingState(false);
    }
  };

  // Category management helpers
  const handleAddCategory = () => {
    if (categories.length >= 25) {
      toast.error("Maximum of 25 ticket categories allowed");
      return;
    }
    const nextIndex = categories.length + 1;
    const newCat: TicketCategory = {
      id: `support-${nextIndex}`,
      name: `Category ${nextIndex}`,
      emoji: "",
      category_channel_id: null,
      staff_role_ids: [],
      naming: "ticket-{username}-{number}",
    };
    setCategories([...categories, newCat]);
    toast.success("Category added");
  };

  const handleUpdateCategory = (index: number, updates: Partial<TicketCategory>) => {
    setCategories((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  };

  const handleRemoveCategory = (index: number) => {
    if (categories.length <= 1) {
      toast.error("At least one ticket category is required");
      return;
    }
    setCategories((prev) => prev.filter((_, i) => i !== index));
    toast.info("Category removed");
  };

  const handleMoveCategory = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === categories.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    setCategories((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleToggleStaffRole = (catIndex: number, roleId: string) => {
    const currentRoles = categories[catIndex].staff_role_ids || [];
    const exists = currentRoles.includes(roleId);
    const updated = exists ? currentRoles.filter((id) => id !== roleId) : [...currentRoles, roleId];
    handleUpdateCategory(catIndex, { staff_role_ids: updated });
  };

  // Save config
  const handleSaveConfig = async () => {
    setFieldErrors({});

    const payload: TicketsConfig = {
      panel_channel_id: panelChannelId,
      logs_channel_id: logsChannelId,
      panel_content: panelContent,
      panel_embed: {
        title: panelEmbedTitle || null,
        description: panelEmbedDescription || null,
        color: panelEmbedColor || null,
      },
      button_label: buttonLabel,
      button_emoji: buttonEmoji.trim() || "🎫",
      max_open_tickets: Number(maxOpenTickets) || 1,
      cooldown_seconds: Number(cooldownSeconds) || 0,
      categories: categories,
    };

    // Client validation
    const parsed = ticketsConfigSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        errors[path] = issue.message;
      }
      setFieldErrors(errors);
      const firstError = Object.values(errors)[0] || "Validation failed";
      toast.error(firstError);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/tickets/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 422 && errJson.details) {
          const parsedErrors = parseApiValidationErrors(errJson.details);
          setFieldErrors(parsedErrors);
          throw new Error("Validation error from server");
        }
        throw new Error(errJson.error || `Failed to save config (${res.status})`);
      }

      const updated = await res.json();
      setSavedConfig(updated);
      toast.success("Ticket configuration saved successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Publish / Replace panel
  const handlePublishPanel = async () => {
    if (!panelChannelId) {
      toast.error("Please select a panel channel before publishing");
      return;
    }

    setIsPublishing(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/tickets/publish-panel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Publish failed (${res.status})`);
      }

      const chName = textChannels.find((c) => String(c.id) === panelChannelId)?.name || "channel";
      toast.success(`Ticket panel published in #${chName}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to publish ticket panel";
      toast.error(msg);
    } finally {
      setIsPublishing(false);
    }
  };

  if (isLoading) {
    return <TicketsLoading />;
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Configure support ticket panels and manage user requests.
          </p>
        </div>

        <Card className="border border-destructive/50 bg-destructive/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle>Failed to load Tickets data</CardTitle>
            </div>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="size-4 mr-2" />
              Retry Connection
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Status Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
            <Badge variant={enabled ? "default" : "secondary"} className="text-xs">
              {enabled ? "Module Active" : "Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Design interactive support panels, define categories with dedicated staff, and track support requests for {guildName}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="tickets-toggle" className="text-xs text-muted-foreground cursor-pointer">
            {enabled ? "Module is enabled" : "Module is disabled"}
          </Label>
          <Switch
            id="tickets-toggle"
            checked={enabled}
            disabled={isTogglingState}
            onCheckedChange={handleToggleEnabled}
          />
        </div>
      </div>

      {/* Main Grid: Left Builder & Right Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Panel Builder & Categories Form (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Ticket className="size-4 text-primary" />
                  Panel Settings
                </CardTitle>
                {isDirty && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-xs">
                    Unsaved changes
                  </Badge>
                )}
              </div>
              <CardDescription>
                Configure where the ticket panel is published and customize the message and embed.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* Always-Visible Saved State Strip */}
              <SavedStateStrip
                items={[
                  {
                    label: "Channel",
                    value: resolveChannelName(
                      savedConfig.panel_channel_id,
                      channels,
                      "None"
                    ),
                  },
                  {
                    label: "Logs Channel",
                    value: resolveChannelName(
                      savedConfig.logs_channel_id,
                      channels,
                      "None"
                    ),
                  },
                  {
                    label: "Title",
                    value: savedConfig.panel_embed?.title || "Support Tickets",
                  },
                  {
                    label: "Color",
                    value: (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className="size-2 rounded-full border border-border"
                          style={{
                            backgroundColor:
                              savedConfig.panel_embed?.color || "#5865F2",
                          }}
                        />
                        <span className="font-mono">
                          {savedConfig.panel_embed?.color || "#5865F2"}
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: "Button",
                    value: savedConfig.button_label || "Open a ticket",
                  },
                  {
                    label: "Categories",
                    value: `${savedConfig.categories?.length || 0} configured`,
                  },
                ]}
                isDirty={isDirty}
                isSaving={isSaving}
                onSave={handleSaveConfig}
                onDiscard={handleDiscardChanges}
              />

              {/* Target Channel */}
              <div className="space-y-2">
                <Label htmlFor="panel-channel" className="text-sm font-medium">
                  Panel Channel <span className="text-destructive">*</span>
                </Label>
                <SelectSearchable
                  id="panel-channel"
                  value={panelChannelId ?? null}
                  onValueChange={(val) =>
                    setPanelChannelId(val && val !== "none" ? val : null)
                  }
                  options={textChannels.map((ch) => ({
                    value: ch.id,
                    label: `#${ch.name}`,
                  }))}
                  placeholder="Select a text channel..."
                  searchPlaceholder="Search text channels..."
                  aria-invalid={!!fieldErrors["panel_channel_id"]}
                />
                {fieldErrors["panel_channel_id"] && (
                  <p className="text-xs text-destructive">{fieldErrors["panel_channel_id"]}</p>
                )}
              </div>

              {/* Ticket Logs Channel */}
              <div className="space-y-2">
                <Label htmlFor="logs-channel" className="text-sm font-medium">
                  Ticket Logs Channel
                </Label>
                <SelectSearchable
                  id="logs-channel"
                  value={logsChannelId ?? null}
                  onValueChange={(val) =>
                    setLogsChannelId(val && val !== "none" ? val : null)
                  }
                  options={[
                    { value: "none", label: "None (Disabled)" },
                    ...textChannels.map((ch) => ({
                      value: ch.id,
                      label: `#${ch.name}`,
                    })),
                  ]}
                  placeholder="Select a logs channel (optional)..."
                  searchPlaceholder="Search text channels..."
                  aria-invalid={!!fieldErrors["logs_channel_id"]}
                />
                <p className="text-xs text-muted-foreground">
                  Transcripts and ticket lifecycle events (opened, claimed, closed, deleted) will be dispatched here.
                </p>
                {fieldErrors["logs_channel_id"] && (
                  <p className="text-xs text-destructive">{fieldErrors["logs_channel_id"]}</p>
                )}
              </div>

              {/* Panel Content */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="panel-content" className="text-sm font-medium">
                    Panel Message Content
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    {panelContent.length}/2000
                  </span>
                </div>
                <Textarea
                  id="panel-content"
                  rows={2}
                  value={panelContent}
                  onChange={(e) => setPanelContent(e.target.value)}
                  placeholder="Need help? Open a support ticket below."
                  maxLength={2000}
                />
                {fieldErrors["panel_content"] && (
                  <p className="text-xs text-destructive">{fieldErrors["panel_content"]}</p>
                )}
              </div>

              {/* Panel Embed Fields */}
              <div className="border border-border/60 rounded-lg p-4 space-y-4 bg-muted/20">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Tag className="size-3.5" />
                  Embed Customization
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="embed-title" className="text-xs font-medium">
                      Embed Title
                    </Label>
                    <Input
                      id="embed-title"
                      value={panelEmbedTitle}
                      onChange={(e) => setPanelEmbedTitle(e.target.value)}
                      placeholder="Support Tickets"
                      maxLength={256}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="embed-color" className="text-xs font-medium">
                      Embed Color (Hex)
                    </Label>
                    <div className="flex gap-2 items-center">
                      <Input
                        id="embed-color"
                        value={panelEmbedColor}
                        onChange={(e) => setPanelEmbedColor(e.target.value)}
                        placeholder="#5865F2"
                        className="font-mono text-xs"
                      />
                      <div
                        className="size-8 rounded-md border border-border shrink-0 shadow-xs"
                        style={{ backgroundColor: panelEmbedColor || "#5865F2" }}
                      />
                    </div>
                  </div>
                </div>

                {/* Preset color swatches */}
                <div className="flex flex-wrap gap-2 items-center pt-1">
                  <span className="text-xs text-muted-foreground mr-1">Presets:</span>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setPanelEmbedColor(c.value)}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                        panelEmbedColor.toLowerCase() === c.value.toLowerCase()
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border/60 hover:bg-muted"
                      }`}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: c.value }} />
                      {c.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="embed-desc" className="text-xs font-medium">
                    Embed Description
                  </Label>
                  <Textarea
                    id="embed-desc"
                    rows={3}
                    value={panelEmbedDescription}
                    onChange={(e) => setPanelEmbedDescription(e.target.value)}
                    placeholder="Select a category from the dropdown below to open a private ticket."
                    maxLength={4000}
                  />
                </div>
              </div>

              {/* Button Settings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="button-label" className="text-sm font-medium">
                    Button Label
                  </Label>
                  <Input
                    id="button-label"
                    value={buttonLabel}
                    onChange={(e) => setButtonLabel(e.target.value)}
                    placeholder="Open a ticket"
                    maxLength={80}
                  />
                  {fieldErrors["button_label"] && (
                    <p className="text-xs text-destructive">{fieldErrors["button_label"]}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="button-emoji" className="text-sm font-medium">
                    Button Emoji
                  </Label>
                  <Input
                    id="button-emoji"
                    value={buttonEmoji}
                    onChange={(e) => setButtonEmoji(e.target.value)}
                    placeholder="ticket or tag"
                    maxLength={32}
                  />
                  {fieldErrors["button_emoji"] && (
                    <p className="text-xs text-destructive">{fieldErrors["button_emoji"]}</p>
                  )}
                </div>
              </div>

              {/* Ticket Limits & Cooldown */}
              <div className="border border-border/60 rounded-lg p-4 space-y-4 bg-muted/20">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  Limits & Cooldown
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="max-open-tickets" className="text-xs font-medium">
                      Max Concurrent Tickets Per Member
                    </Label>
                    <Input
                      id="max-open-tickets"
                      type="number"
                      min={1}
                      max={20}
                      value={maxOpenTickets}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setMaxOpenTickets(isNaN(val) ? 1 : Math.max(1, Math.min(20, val)));
                      }}
                      placeholder="1"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Maximum number of active tickets a single user can have open simultaneously (1–20).
                    </p>
                    {fieldErrors["max_open_tickets"] && (
                      <p className="text-xs text-destructive">{fieldErrors["max_open_tickets"]}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cooldown-seconds" className="text-xs font-medium">
                      Creation Cooldown (Seconds)
                    </Label>
                    <Input
                      id="cooldown-seconds"
                      type="number"
                      min={0}
                      max={86400}
                      value={cooldownSeconds}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setCooldownSeconds(isNaN(val) ? 0 : Math.max(0, Math.min(86400, val)));
                      }}
                      placeholder="0"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Cooldown before a user can open another ticket (0 to disable, e.g. 60s = 1m, 300s = 5m).
                    </p>
                    {fieldErrors["cooldown_seconds"] && (
                      <p className="text-xs text-destructive">{fieldErrors["cooldown_seconds"]}</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Categories Card */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Shield className="size-4 text-primary" />
                    Ticket Categories
                  </CardTitle>
                  <CardDescription>
                    Configure up to 25 ticket categories, designated parent channels, and assigned staff roles.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddCategory}
                  disabled={categories.length >= 25}
                  className="gap-1 text-xs"
                >
                  <Plus className="size-3.5" />
                  Add Category
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {categories.map((cat, idx) => {
                const categoryErrorPrefix = `categories.${idx}`;
                return (
                  <div
                    key={idx}
                    className="border border-border/70 rounded-lg p-4 space-y-4 bg-card hover:border-border transition-colors"
                  >
                    {/* Category Top Row: Name, Slug, Emoji, Reorder & Delete */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                      <div className="flex items-center gap-2">
                        <Ticket className="size-4 text-primary" />
                        <span className="font-semibold text-sm">{cat.name || "Untitled Category"}</span>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {cat.id}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => handleMoveCategory(idx, "up")}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          <ChevronUp className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => handleMoveCategory(idx, "down")}
                          disabled={idx === categories.length - 1}
                          title="Move down"
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveCategory(idx)}
                          disabled={categories.length <= 1}
                          title="Delete category"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Category Input Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Category Name</Label>
                        <Input
                          value={cat.name}
                          onChange={(e) => handleUpdateCategory(idx, { name: e.target.value })}
                          placeholder="General Support"
                          maxLength={100}
                        />
                        {fieldErrors[`${categoryErrorPrefix}.name`] && (
                          <p className="text-xs text-destructive">
                            {fieldErrors[`${categoryErrorPrefix}.name`]}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Slug / ID</Label>
                        <Input
                          value={cat.id}
                          onChange={(e) =>
                            handleUpdateCategory(idx, {
                              id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                            })
                          }
                          placeholder="general"
                          maxLength={32}
                          className="font-mono text-xs"
                        />
                        {fieldErrors[`${categoryErrorPrefix}.id`] && (
                          <p className="text-xs text-destructive">
                            {fieldErrors[`${categoryErrorPrefix}.id`]}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Tag / Identifier</Label>
                        <Input
                          value={cat.emoji}
                          onChange={(e) => handleUpdateCategory(idx, { emoji: e.target.value })}
                          placeholder="tag or code"
                          maxLength={32}
                        />
                      </div>
                    </div>

                    {/* Discord Channel Category */}
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Discord Category Section</Label>
                      <SelectSearchable
                        value={cat.category_channel_id ?? "none"}
                        onValueChange={(val) =>
                          handleUpdateCategory(idx, {
                            category_channel_id: val === "none" || !val ? null : val,
                          })
                        }
                        options={[
                          { value: "none", label: "None (create at server top level)" },
                          ...categoryChannels.map((c) => ({
                            value: c.id,
                            label: c.name,
                          })),
                        ]}
                        placeholder="Select a category..."
                        searchPlaceholder="Search categories..."
                        size="sm"
                      />
                    </div>

                    {/* Staff Roles Selection */}
                    <div className="space-y-2">
                      <Label className="text-xs font-medium flex items-center gap-1.5">
                        <Shield className="size-3 text-muted-foreground" />
                        Assigned Staff Roles
                      </Label>
                      <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 rounded-md border border-input bg-muted/20">
                        {roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No roles loaded</span>
                        ) : (
                          roles.map((role) => {
                            const isAssigned = (cat.staff_role_ids || []).includes(role.id);
                            return (
                              <button
                                key={role.id}
                                type="button"
                                onClick={() => handleToggleStaffRole(idx, role.id)}
                                className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all ${
                                  isAssigned
                                    ? "bg-primary text-primary-foreground border-primary font-medium"
                                    : "bg-background text-muted-foreground border-border/80 hover:border-foreground/40"
                                }`}
                              >
                                {role.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Click roles to toggle staff access. Staff roles can claim, close, reopen, and manage tickets in this category.
                      </p>
                    </div>

                    {/* Naming Template with Token Hints */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Channel Naming Pattern</Label>
                      <Input
                        value={cat.naming}
                        onChange={(e) => handleUpdateCategory(idx, { naming: e.target.value })}
                        placeholder="ticket-{username}-{number}"
                        maxLength={80}
                        className="font-mono text-xs"
                      />
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-[11px] text-muted-foreground">Insert token:</span>
                        {["{username}", "{number}", "{category}"].map((token) => (
                          <button
                            key={token}
                            type="button"
                            onClick={() => {
                              const current = cat.naming || "";
                              handleUpdateCategory(idx, {
                                naming: current ? `${current}-${token}` : token,
                              });
                            }}
                            className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border/60 hover:bg-muted/80 text-foreground"
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>

            <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveConfig}
                  disabled={!isDirty || isSaving}
                  size="sm"
                  className="gap-1.5"
                >
                  <Save className="size-3.5" />
                  {isSaving ? "Saving..." : "Save Changes"}
                </Button>
                {isDirty && (
                  <Button variant="ghost" size="sm" onClick={handleDiscardChanges}>
                    <RotateCcw className="size-3.5 mr-1" />
                    Discard
                  </Button>
                )}
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={handlePublishPanel}
                disabled={isPublishing || !panelChannelId}
                className="gap-1.5"
              >
                <Send className="size-3.5" />
                {isPublishing ? "Publishing..." : "Publish / Replace Panel"}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Right: Live Discord Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Hash className="size-4 text-primary" />
                Discord Panel Preview
              </CardTitle>
              <CardDescription>
                Live preview of how the panel message and embed will look in Discord.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {/* Discord Message Simulator */}
              <div className="bg-[#313338] text-[#dbdee1] rounded-lg p-4 font-sans text-sm shadow-inner border border-[#232428] space-y-3">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm shrink-0">
                    N
                  </div>
                  <div className="leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white text-sm">Neverland</span>
                      <span className="bg-[#5865F2] text-white text-[10px] font-bold px-1 py-0.2 rounded">
                        BOT
                      </span>
                    </div>
                    <span className="text-[11px] text-[#949ba4]">Today at 12:00 PM</span>
                  </div>
                </div>

                {/* Plain text content */}
                {panelContent && (
                  <div className="text-sm text-[#dbdee1] whitespace-pre-wrap leading-relaxed pl-0 sm:pl-13 break-words">
                    {panelContent}
                  </div>
                )}

                {/* Discord Embed Container */}
                <div
                  className="rounded-r bg-[#2b2d31] p-3 space-y-2 border-l-4 ml-0 sm:ml-13 min-w-0 break-words"
                  style={{ borderLeftColor: panelEmbedColor || "#5865F2" }}
                >
                  {panelEmbedTitle && (
                    <div className="font-bold text-white text-sm">{panelEmbedTitle}</div>
                  )}

                  {panelEmbedDescription && (
                    <div className="text-xs text-[#dbdee1] whitespace-pre-wrap leading-relaxed">
                      {panelEmbedDescription}
                    </div>
                  )}

                  {/* Categories preview inside embed */}
                  {categories.length > 0 && (
                    <div className="pt-2 border-t border-[#383a40] space-y-1">
                      <div className="text-[11px] font-semibold uppercase text-[#949ba4]">
                        Available Categories
                      </div>
                      <div className="grid grid-cols-1 gap-1">
                        {categories.map((c, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-[#dbdee1]">
                            <Ticket className="size-3 text-muted-foreground" />
                            <span className="font-medium text-white">{c.name || "Untitled"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Discord Button Preview */}
                <div className="pl-13 pt-1">
                  <div className="inline-flex items-center gap-1.5 bg-[#5865F2] text-white text-xs font-medium px-3 py-1.5 rounded shadow-xs cursor-default">
                    <Ticket className="size-3 text-white" />
                    <span>{buttonLabel || "Open a ticket"}</span>
                  </div>
                </div>
              </div>

              {/* Status footer hints */}
              <div className="mt-4 p-3 rounded-md bg-muted/40 text-xs text-muted-foreground flex items-start gap-2">
                <Info className="size-4 shrink-0 mt-0.5 text-primary" />
                <div>
                  When clicked, this button responds with an ephemeral category menu. Users select a category to spawn their private ticket channel under your designated category channel.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Section 2: Recent Tickets List */}
      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Recent Tickets</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {summary.open_count} Open
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {summary.total_count} Total
                </Badge>
              </div>
              <CardDescription>
                Recent support tickets created on this server (up to 50, newest first).
              </CardDescription>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshTickets}
              disabled={isRefreshingTickets}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`size-3.5 ${isRefreshingTickets ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {ticketsList.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border/80 rounded-lg space-y-3">
              <div className="size-10 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Ticket className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-sm">No tickets found</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  When members use the published ticket panel to open support requests, they will appear here with real-time status.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border/80 overflow-hidden">
              {ticketsList.map((tk) => {
                const category = categories.find((c) => c.id === tk.category_id);
                return (
                  <div
                    key={tk.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div className="size-8 rounded-md bg-muted/80 flex items-center justify-center text-xs font-mono font-semibold shrink-0">
                        #{String(tk.number).padStart(4, "0")}
                      </div>

                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">
                            {category?.name || tk.category_id || "General"}
                          </span>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {tk.category_id}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <User className="size-3" />
                            <code className="text-[11px]">&lt;@{tk.user_id}&gt;</code>
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {tk.created_at ? new Date(tk.created_at).toLocaleString() : "Unknown"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap shrink-0">
                      {tk.status === "open" && (
                        <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30 text-xs">
                          Open
                        </Badge>
                      )}
                      {tk.status === "claimed" && (
                        <Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/20 border-amber-500/30 text-xs flex items-center gap-1">
                          <Crown className="size-3 text-amber-400" />
                          <span>Claimed {tk.claimed_by && `by <@${tk.claimed_by}>`}</span>
                        </Badge>
                      )}
                      {tk.status === "closed" && (
                        <Badge variant="secondary" className="text-xs">
                          Closed
                        </Badge>
                      )}

                      <span className="text-xs text-muted-foreground font-mono">
                        #{tk.channel_id}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
