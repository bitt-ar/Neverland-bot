"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Info,
  Shield,
  Image as ImageIcon,
  Check,
  Bot,
  User,
} from "lucide-react";
import { toast } from "sonner";

import {
  WelcomeConfig,
  WelcomeConfigResponse,
  DEFAULT_WELCOME_CONFIG,
  welcomeConfigSchema,
} from "@/lib/modules/welcome";
import { GuildChannel, GuildOverview, GuildRole } from "@/lib/control-plane";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SelectSearchable } from "@/components/ui/select-searchable";
import {
  SavedStateStrip,
  resolveChannelName,
} from "@/components/saved-state-strip";
import WelcomeLoading from "./loading";

interface WelcomeClientProps {
  guildId: string;
}

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

export function WelcomeClient({ guildId }: WelcomeClientProps) {
  // Remote data state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [guildName, setGuildName] = useState<string>("Neverland");

  // Module state
  const [enabled, setEnabled] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);

  // Form states
  const [channelId, setChannelId] = useState<string | null>(null);
  const [includeImage, setIncludeImage] = useState<boolean>(true);
  const [autoRoleEnabled, setAutoRoleEnabled] = useState<boolean>(true);
  const [memberRoleIds, setMemberRoleIds] = useState<string[]>([]);
  const [botRoleIds, setBotRoleIds] = useState<string[]>([]);

  // Base snapshot to compute dirty state
  const [savedConfig, setSavedConfig] = useState<WelcomeConfig>(DEFAULT_WELCOME_CONFIG);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Filter text-capable channels
  const textChannels = useMemo(() => {
    return channels.filter(
      (c) => c.type === "text" || c.type === "announcement" || c.type === "forum"
    );
  }, [channels]);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [configRes, channelsRes, rolesRes, overviewRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/modules/welcome/config`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/internal/guilds/${guildId}/overview`, { cache: "no-store" }).catch(() => null),
      ]);

      if (!configRes.ok) {
        const errJson = await configRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch welcome config (${configRes.status})`);
      }
      if (!channelsRes.ok) {
        throw new Error(`Failed to fetch channels (${channelsRes.status})`);
      }

      const configData: WelcomeConfigResponse = await configRes.json();
      const channelsData: GuildChannel[] = await channelsRes.json();
      const rolesData = rolesRes && rolesRes.ok ? await rolesRes.json().catch(() => ({ roles: [] })) : { roles: [] };

      if (overviewRes && overviewRes.ok) {
        const overviewData: GuildOverview = await overviewRes.json().catch(() => null);
        if (overviewData?.name) {
          setGuildName(overviewData.name);
        }
      }

      setChannels(channelsData || []);
      setRoles(Array.isArray(rolesData?.roles) ? rolesData.roles : []);
      setEnabled(configData.enabled);

      const cfg = configData.config || DEFAULT_WELCOME_CONFIG;
      setSavedConfig(cfg);
      setChannelId(cfg.channel_id ?? null);
      setIncludeImage(cfg.include_image ?? true);
      setAutoRoleEnabled(cfg.auto_role_enabled ?? true);
      setMemberRoleIds(Array.isArray(cfg.member_role_ids) ? cfg.member_role_ids : []);
      setBotRoleIds(Array.isArray(cfg.bot_role_ids) ? cfg.bot_role_ids : []);
      setFieldErrors({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load welcome configuration";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dirty state
  const isDirty = useMemo(() => {
    if (channelId !== (savedConfig.channel_id ?? null)) return true;
    if (includeImage !== (savedConfig.include_image ?? true)) return true;
    if (autoRoleEnabled !== (savedConfig.auto_role_enabled ?? true)) return true;
    const savedMember = savedConfig.member_role_ids ?? [];
    const savedBot = savedConfig.bot_role_ids ?? [];
    if (memberRoleIds.length !== savedMember.length || memberRoleIds.some((id) => !savedMember.includes(id))) return true;
    if (botRoleIds.length !== savedBot.length || botRoleIds.some((id) => !savedBot.includes(id))) return true;
    return false;
  }, [channelId, includeImage, autoRoleEnabled, memberRoleIds, botRoleIds, savedConfig]);

  // Warn before unload if changes are unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Toggle module enabled state
  const handleToggleEnabled = async (nextState: boolean) => {
    const prevState = enabled;
    setEnabled(nextState);
    setIsTogglingState(true);

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/welcome/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update status (${res.status})`);
      }

      const data = await res.json();
      setEnabled(data.enabled);
      toast.success(nextState ? "Welcome module enabled" : "Welcome module disabled");
    } catch (err: unknown) {
      setEnabled(prevState);
      const msg = err instanceof Error ? err.message : "Failed to toggle welcome status";
      toast.error(msg);
    } finally {
      setIsTogglingState(false);
    }
  };

  // Discard all unsaved changes
  const handleDiscardChanges = () => {
    if (!isDirty) return;
    setChannelId(savedConfig.channel_id ?? null);
    setIncludeImage(savedConfig.include_image ?? true);
    setAutoRoleEnabled(savedConfig.auto_role_enabled ?? true);
    setMemberRoleIds([...(savedConfig.member_role_ids ?? [])]);
    setBotRoleIds([...(savedConfig.bot_role_ids ?? [])]);
    setFieldErrors({});
    toast.info("Unsaved changes discarded");
  };

  // Toggle a role in one of the auto-role lists
  const handleToggleRole = (list: "member" | "bot", roleId: string) => {
    const setter = list === "member" ? setMemberRoleIds : setBotRoleIds;
    setter((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  // Save changes
  const handleSave = async () => {
    const payload: WelcomeConfig = {
      channel_id: channelId || null,
      include_image: Boolean(includeImage),
      auto_role_enabled: Boolean(autoRoleEnabled),
      member_role_ids: memberRoleIds,
      bot_role_ids: botRoleIds,
    };

    const parsed = welcomeConfigSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path[0] ? String(issue.path[0]) : "general";
      setFieldErrors({ [field]: issue.message });
      toast.error(issue.message);
      return;
    }

    setIsSaving(true);
    setFieldErrors({});

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/welcome/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 422) {
          const apiErrors = parseApiValidationErrors(resData.details);
          setFieldErrors(apiErrors);
          const firstDetailMsg =
            Array.isArray(resData.details) && resData.details[0]
              ? typeof resData.details[0] === "object"
                ? resData.details[0].msg || resData.details[0].message
                : String(resData.details[0])
              : null;
          toast.error(firstDetailMsg || "Validation failed on the bot control plane.");
        } else {
          toast.error(resData.error || `Failed to save configuration (${res.status})`);
        }
        return;
      }

      const updatedConfig: WelcomeConfig = resData;
      setSavedConfig(updatedConfig);
      setChannelId(updatedConfig.channel_id ?? null);
      setIncludeImage(updatedConfig.include_image ?? true);
      setAutoRoleEnabled(updatedConfig.auto_role_enabled ?? true);
      setMemberRoleIds(Array.isArray(updatedConfig.member_role_ids) ? updatedConfig.member_role_ids : []);
      setBotRoleIds(Array.isArray(updatedConfig.bot_role_ids) ? updatedConfig.bot_role_ids : []);
      toast.success("Welcome configuration saved successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <WelcomeLoading />;
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground">
            Configure welcome announcements and server-side greeting cards.
          </p>
        </div>

        <Card className="border-destructive/30 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-destructive">Failed to Load Welcome Module</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              Could not retrieve welcome settings or guild channels from the bot control plane.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium text-foreground">{loadError}</p>
            <p className="text-xs text-muted-foreground">
              Verify that the bot is running and control plane endpoints are accessible.
            </p>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData}>
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

  return (
    <div className="space-y-6 min-w-0">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome</h1>
            <Badge
              variant="outline"
              className={
                enabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-mono"
                  : "border-muted-foreground/30 bg-muted/40 text-muted-foreground text-xs font-mono"
              }
            >
              {enabled ? "Active" : "Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 break-words">
            Send greeting messages and dynamic images to new members in {guildName}.
          </p>
        </div>

        {/* Header Controls */}
        <div className="flex flex-col items-end gap-2.5 shrink-0">
          {isDirty && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400 flex items-center gap-1.5 mr-1 font-mono">
                <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                Unsaved changes
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDiscardChanges}
                disabled={isSaving}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5 mr-1" />
                <span>Discard</span>
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-8 text-xs bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold shadow-xs"
              >
                <Save className="size-3.5 mr-1" />
                <span>{isSaving ? "Saving..." : "Save Changes"}</span>
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-1.5 shadow-2xs">
            <Label
              htmlFor="welcome-enabled-toggle"
              className="text-xs font-medium cursor-pointer text-foreground"
            >
              {enabled ? "Module Enabled" : "Module Disabled"}
            </Label>
            <Switch
              id="welcome-enabled-toggle"
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={isTogglingState}
            />
          </div>
        </div>
      </div>

      {/* Warning if enabled without a channel configured */}
      {enabled && channelId === null && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-600 dark:text-amber-400">
          <Info className="size-4 mt-0.5 shrink-0" />
          <p className="leading-relaxed">
            The Welcome module is enabled, but no <strong>Welcome Channel</strong> is selected. Welcome messages and generated greeting cards will not be posted until a channel is chosen below.
          </p>
        </div>
      )}

      {/* Main Stack */}
      <div className="space-y-6">
        {/* Card 1: Channel & Announcement Configuration */}
        <Card className="border border-border/80">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Channel & Image Options</CardTitle>
            </div>
            <CardDescription>
              Select where arrival messages are posted and whether server-side PIL images are generated.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Always-Visible Saved State Strip without duplicate buttons */}
            <SavedStateStrip
              items={[
                {
                  label: "Channel",
                  value: resolveChannelName(
                    savedConfig.channel_id,
                    channels,
                    "None (Disabled)"
                  ),
                },
                {
                  label: "Greeting Card",
                  value: savedConfig.include_image ? "Enabled" : "Disabled",
                },
              ]}
              isSaving={isSaving}
            />

            {/* Channel Select */}
            <div className="space-y-1.5">
              <Label htmlFor="welcome-channel-select" className="text-xs font-semibold text-foreground">
                Welcome Channel
              </Label>
              <div className="max-w-md">
                <SelectSearchable
                  id="welcome-channel-select"
                  value={channelId ?? "none"}
                  onValueChange={(val) => {
                    const nextVal = val === "none" ? null : val;
                    setChannelId(nextVal);
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.channel_id;
                      return next;
                    });
                  }}
                  options={[
                    { value: "none", label: "None (Disabled — do not send welcome messages)" },
                    ...textChannels.map((c) => ({
                      value: c.id,
                      label: `#${c.name}`,
                    })),
                  ]}
                  placeholder="Select a welcome channel..."
                  searchPlaceholder="Search text channels..."
                  aria-invalid={!!fieldErrors["channel_id"]}
                />
              </div>
              {fieldErrors["channel_id"] && (
                <p className="text-xs text-destructive">{fieldErrors["channel_id"]}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                The welcome message and generated image are sent there; None disables sending.
              </p>
            </div>

            {/* Include Image Switch */}
            <div className="pt-2 border-t border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="include-image-toggle" className="text-xs font-semibold text-foreground cursor-pointer">
                    Include Greeting Card Image
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Generates a PIL image with the member&apos;s avatar and name
                  </p>
                </div>
                <Switch
                  id="include-image-toggle"
                  checked={includeImage}
                  onCheckedChange={(checked) => {
                    setIncludeImage(checked);
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.include_image;
                      return next;
                    });
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Static Informational Preview Card */}
        <Card className="border border-border/80">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base font-semibold">Welcome Card Attachment</CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/80">
                Generated server-side with PIL
              </Badge>
            </div>
            <CardDescription>
              Architectural diagram of the dynamic greeting card composed server-side for each new member.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Muted placeholder box (honest server-side PIL label) */}
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-5 sm:p-6 text-center space-y-4">
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                <ImageIcon className="size-3.5 text-primary" />
                <span>Generated server-side with PIL</span>
              </div>

              {/* Graphic Mockup Box */}
              <div className="mx-auto max-w-md rounded-lg border border-border/60 bg-background/60 p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground border-b border-border/40 pb-2">
                  <span>Attachment: <code className="font-mono">profile.png</code></span>
                  <span>Resolution: <code className="font-mono">500 × 188 px</code></span>
                </div>

                <div className="relative flex items-center justify-between gap-4 p-2 bg-muted/20 rounded-md border border-border/30">
                  <div className="text-left space-y-1 min-w-0">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground block">
                      Typography
                    </span>
                    <div className="font-semibold text-sm truncate">
                      MemberName..
                    </div>
                    <span className="text-[10px] text-muted-foreground block truncate">
                      Font: Bodo Amat (max 9 chars)
                    </span>
                  </div>

                  <div className="flex flex-col items-center shrink-0">
                    <div className="size-14 rounded-full border-2 border-primary/40 bg-muted flex items-center justify-center shadow-inner">
                      <User className="size-6 text-muted-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground mt-1">206×206 Circle</span>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground text-left leading-relaxed">
                  The bot process fetches the member&apos;s avatar, applies a circular antialiased alpha mask, selects a random background banner (1 to 5), draws the member&apos;s display name with the server font, and uploads the stitched PNG directly to Discord.
                </div>
              </div>

              <p className="text-xs text-muted-foreground max-w-lg mx-auto leading-relaxed">
                This preview is an informational placeholder. The real graphic is rendered dynamically server-side via Python Imaging Library (Pillow) on member join.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Automatic Join Roles (configurable) */}
        <Card className="border border-border/80">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-primary" />
                <CardTitle className="text-base font-semibold">Automatic Join Roles</CardTitle>
                <Badge
                  variant="outline"
                  className={
                    autoRoleEnabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-[10px]"
                      : "border-muted-foreground/30 bg-muted/40 text-muted-foreground text-[10px]"
                  }
                >
                  {autoRoleEnabled ? "On" : "Off"}
                </Badge>
                {isDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5">
                <Label
                  htmlFor="auto-role-toggle"
                  className="text-xs font-medium cursor-pointer text-foreground"
                >
                  {autoRoleEnabled ? "Auto Roles Enabled" : "Auto Roles Disabled"}
                </Label>
                <Switch
                  id="auto-role-toggle"
                  checked={autoRoleEnabled}
                  onCheckedChange={setAutoRoleEnabled}
                />
              </div>
            </div>
            <CardDescription>
              Choose exactly which roles the bot grants when someone joins. Pick different roles for human members and for bots — click a role chip to assign or remove it.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Member roles */}
            <div className={autoRoleEnabled ? "space-y-2" : "space-y-2 opacity-50 pointer-events-none select-none transition-opacity"}>
              <div className="flex items-center gap-1.5">
                <User className="size-3.5 text-primary" />
                <Label className="text-xs font-semibold text-foreground">
                  Roles for new members <span className="text-muted-foreground font-normal">({memberRoleIds.length} selected)</span>
                </Label>
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 rounded-md border border-input bg-muted/20">
                {roles.filter((r) => !r.managed && r.name !== "@everyone").length === 0 ? (
                  <span className="text-xs text-muted-foreground">No assignable roles loaded</span>
                ) : (
                  roles
                    .filter((r) => !r.managed && r.name !== "@everyone")
                    .map((role) => {
                      const isAssigned = memberRoleIds.includes(role.id);
                      return (
                        <button
                          key={`member-${role.id}`}
                          type="button"
                          onClick={() => handleToggleRole("member", role.id)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                            isAssigned
                              ? "text-primary-foreground border-transparent font-medium shadow-2xs"
                              : "bg-background text-muted-foreground border-border/80 hover:border-foreground/40"
                          }`}
                          style={
                            isAssigned && role.color && role.color !== "#000000"
                              ? { backgroundColor: role.color }
                              : isAssigned
                              ? { backgroundColor: "var(--primary)" }
                              : undefined
                          }
                        >
                          {isAssigned && <Check className="size-3 inline mr-1" />}
                          {role.name}
                        </button>
                      );
                    })
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Granted to every human member the moment they join the server.
              </p>
            </div>

            {/* Bot roles */}
            <div className={autoRoleEnabled ? "space-y-2" : "space-y-2 opacity-50 pointer-events-none select-none transition-opacity"}>
              <div className="flex items-center gap-1.5">
                <Bot className="size-3.5 text-primary" />
                <Label className="text-xs font-semibold text-foreground">
                  Roles for new bots <span className="text-muted-foreground font-normal">({botRoleIds.length} selected)</span>
                </Label>
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 rounded-md border border-input bg-muted/20">
                {roles.filter((r) => !r.managed && r.name !== "@everyone").length === 0 ? (
                  <span className="text-xs text-muted-foreground">No assignable roles loaded</span>
                ) : (
                  roles
                    .filter((r) => !r.managed && r.name !== "@everyone")
                    .map((role) => {
                      const isAssigned = botRoleIds.includes(role.id);
                      return (
                        <button
                          key={`bot-${role.id}`}
                          type="button"
                          onClick={() => handleToggleRole("bot", role.id)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                            isAssigned
                              ? "text-primary-foreground border-transparent font-medium shadow-2xs"
                              : "bg-background text-muted-foreground border-border/80 hover:border-foreground/40"
                          }`}
                          style={
                            isAssigned && role.color && role.color !== "#000000"
                              ? { backgroundColor: role.color }
                              : isAssigned
                              ? { backgroundColor: "var(--primary)" }
                              : undefined
                          }
                        >
                          {isAssigned && <Check className="size-3 inline mr-1" />}
                          {role.name}
                        </button>
                      );
                    })
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Granted to incoming bots when they are added to the server.
              </p>
            </div>

            {/* Fallback + hierarchy notice */}
            <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2.5">
              <Info className="size-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="leading-relaxed">
                  <span className="font-medium text-foreground">No roles selected?</span> The bot falls back to the legacy behavior: assigns a role named <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">Active member</code> to members and <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">BOT</code> to bots (if those roles exist).
                </p>
                <p className="leading-relaxed">
                  The bot can only assign roles positioned <span className="font-medium text-foreground">below</span> its own role — check Discord&apos;s Server Settings → Roles.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
