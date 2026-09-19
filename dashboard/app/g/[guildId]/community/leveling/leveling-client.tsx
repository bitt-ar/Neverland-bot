"use client";

import * as React from "react";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Trash2,
  Plus,
  ArrowRight,
  Save,
  RotateCcw,
  Info,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

import {
  LevelingConfig,
  LevelingConfigResponse,
  DEFAULT_LEVELING_CONFIG,
  levelingConfigSchema,
} from "@/lib/modules/leveling";
import { GuildChannel, GuildRole, GuildRolesResponse, GuildOverview } from "@/lib/control-plane";
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
import { cn } from "cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectSearchable } from "@/components/ui/select-searchable";
import {
  SavedStateStrip,
  resolveChannelName,
  resolveRoleName,
} from "@/components/saved-state-strip";
import LevelingLoading from "./loading";

interface LevelingClientProps {
  guildId: string;
}

interface RewardRow {
  id: string;
  level: number | "";
  roleId: string;
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
          if (String(anyItem.loc[0]) === "rewards") {
            errors["rewards"] = msg;
          }
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

export function LevelingClient({ guildId }: LevelingClientProps) {
  // Remote data state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [botTopRolePos, setBotTopRolePos] = useState<number | null>(null);
  const [guildName, setGuildName] = useState<string>("Neverland");

  // Module state
  const [enabled, setEnabled] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);

  // Form states
  const [xpMin, setXpMin] = useState<number>(1);
  const [xpMax, setXpMax] = useState<number>(30);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(60);
  const [voiceXpEnabled, setVoiceXpEnabled] = useState<boolean>(true);
  const [voiceXpPerMinute, setVoiceXpPerMinute] = useState<number>(30);
  const [announceChannelId, setAnnounceChannelId] = useState<string | null>(null);
  const [announceMessage, setAnnounceMessage] = useState<string>(
    "{user} has leveled up to level {level}!"
  );
  const [rewardRows, setRewardRows] = useState<RewardRow[]>([]);

  // Base snapshot to compute dirty state
  const [savedConfig, setSavedConfig] = useState<LevelingConfig>(DEFAULT_LEVELING_CONFIG);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Textarea ref for token insertion
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Filter text channels
  const textChannels = useMemo(() => {
    return channels.filter(
      (c) => c.type === "text" || c.type === "announcement" || c.type === "forum"
    );
  }, [channels]);

  // Memoized role items for Base UI Select
  const roleItems = useMemo(() => {
    return roles.map((r) => {
      const isHigher = botTopRolePos !== null && r.position >= botTopRolePos;
      const isEveryone = r.name === "@everyone";
      const isDisabled = isHigher || isEveryone || r.managed;
      const suffix = isEveryone
        ? " (@everyone)"
        : r.managed
        ? " (managed)"
        : isHigher
        ? " (above bot)"
        : "";
      return {
        value: String(r.id),
        label: `${r.name}${suffix}`,
        disabled: isDisabled,
      };
    });
  }, [roles, botTopRolePos]);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [configRes, channelsRes, rolesRes, overviewRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/modules/leveling/config`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/overview`, { cache: "no-store" }).catch(() => null),
      ]);

      if (!configRes.ok) {
        const errJson = await configRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch leveling config (${configRes.status})`);
      }
      if (!channelsRes.ok) {
        throw new Error(`Failed to fetch channels (${channelsRes.status})`);
      }
      if (!rolesRes.ok) {
        throw new Error(`Failed to fetch roles (${rolesRes.status})`);
      }

      const configData: LevelingConfigResponse = await configRes.json();
      const channelsData: GuildChannel[] = await channelsRes.json();
      const rolesData: GuildRolesResponse = await rolesRes.json();

      if (overviewRes && overviewRes.ok) {
        const overviewData: GuildOverview = await overviewRes.json().catch(() => null);
        if (overviewData?.name) {
          setGuildName(overviewData.name);
        }
      }

      setChannels(channelsData || []);
      setRoles(rolesData.roles || []);
      setBotTopRolePos(rolesData.bot_top_role_position ?? null);

      setEnabled(configData.enabled);

      const cfg = configData.config || DEFAULT_LEVELING_CONFIG;
      setSavedConfig(cfg);

      setXpMin(cfg.xp_min ?? 1);
      setXpMax(cfg.xp_max ?? 30);
      setCooldownSeconds(cfg.cooldown_seconds ?? 60);
      setVoiceXpEnabled(cfg.voice_xp_enabled ?? true);
      setVoiceXpPerMinute(cfg.voice_xp_per_minute ?? 30);
      setAnnounceChannelId(cfg.announce_channel_id ?? null);
      setAnnounceMessage(cfg.announce_message ?? "{user} has leveled up to level {level}!");

      // Transform rewards dictionary into sorted reward rows
      const rewardsDict = cfg.rewards || {};
      const rows: RewardRow[] = Object.entries(rewardsDict).map(([lvlStr, roleId]) => ({
        id: Math.random().toString(36).substring(2, 9),
        level: Number(lvlStr),
        roleId: String(roleId),
      }));
      rows.sort((a, b) => Number(a.level) - Number(b.level));
      setRewardRows(rows);

      setFieldErrors({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load leveling configuration";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dirty state computations per card
  const isXpDirty = useMemo(() => {
    return (
      xpMin !== savedConfig.xp_min ||
      xpMax !== savedConfig.xp_max ||
      cooldownSeconds !== savedConfig.cooldown_seconds ||
      voiceXpEnabled !== savedConfig.voice_xp_enabled ||
      voiceXpPerMinute !== savedConfig.voice_xp_per_minute
    );
  }, [xpMin, xpMax, cooldownSeconds, voiceXpEnabled, voiceXpPerMinute, savedConfig]);

  const isAnnouncementsDirty = useMemo(() => {
    return (
      announceChannelId !== (savedConfig.announce_channel_id ?? null) ||
      announceMessage !== (savedConfig.announce_message ?? "")
    );
  }, [announceChannelId, announceMessage, savedConfig]);

  const currentRewardsDict = useMemo(() => {
    const dict: Record<string, string> = {};
    for (const row of rewardRows) {
      if (row.level !== "" && row.roleId !== "") {
        dict[String(row.level)] = String(row.roleId);
      }
    }
    return dict;
  }, [rewardRows]);

  const isRewardsDirty = useMemo(() => {
    const savedDict = savedConfig.rewards || {};
    const currKeys = Object.keys(currentRewardsDict).sort();
    const savedKeys = Object.keys(savedDict).sort();

    if (currKeys.length !== savedKeys.length) return true;
    for (const k of currKeys) {
      if (currentRewardsDict[k] !== savedDict[k]) return true;
    }
    return false;
  }, [currentRewardsDict, savedConfig]);

  const savedRewardEntries = useMemo(() => {
    return Object.entries(savedConfig.rewards || {}).sort(
      (a, b) => Number(a[0]) - Number(b[0])
    );
  }, [savedConfig.rewards]);

  const isDirty = isXpDirty || isAnnouncementsDirty || isRewardsDirty;

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

  // Duplicate level detection
  const duplicateLevels = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const r of rewardRows) {
      if (typeof r.level === "number" && !isNaN(r.level)) {
        counts[r.level] = (counts[r.level] || 0) + 1;
      }
    }
    return new Set(
      Object.keys(counts)
        .filter((lvl) => counts[Number(lvl)] > 1)
        .map(Number)
    );
  }, [rewardRows]);

  // Toggle module enabled state (optimistic UI)
  const handleToggleEnabled = async (nextState: boolean) => {
    const prevState = enabled;
    setEnabled(nextState);
    setIsTogglingState(true);

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/leveling/state`, {
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
      toast.success(nextState ? "Leveling module enabled" : "Leveling module disabled");
    } catch (err: unknown) {
      setEnabled(prevState);
      const msg = err instanceof Error ? err.message : "Failed to toggle leveling status";
      toast.error(msg);
    } finally {
      setIsTogglingState(false);
    }
  };

  // Insert token chip into announce message
  const handleInsertToken = (token: string) => {
    const textarea = messageTextareaRef.current;
    if (!textarea) {
      setAnnounceMessage((prev) => (prev ? `${prev} ${token}` : token));
      return;
    }

    const start = textarea.selectionStart ?? announceMessage.length;
    const end = textarea.selectionEnd ?? announceMessage.length;
    const next =
      announceMessage.substring(0, start) + token + announceMessage.substring(end);

    setAnnounceMessage(next);
    setTimeout(() => {
      textarea.focus();
      const newPos = start + token.length;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  // Add reward row
  const handleAddReward = () => {
    const numericLevels = rewardRows
      .map((r) => Number(r.level))
      .filter((n) => !isNaN(n) && n > 0);
    const maxLevel = numericLevels.length > 0 ? Math.max(...numericLevels) : 0;
    const nextLevel = maxLevel + 5 || 5;

    const newRow: RewardRow = {
      id: Math.random().toString(36).substring(2, 9),
      level: nextLevel,
      roleId: "",
    };

    setRewardRows((prev) => {
      const updated = [...prev, newRow];
      updated.sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
      return updated;
    });
  };

  // Remove reward row
  const handleRemoveReward = (id: string) => {
    setRewardRows((prev) => prev.filter((r) => r.id !== id));
  };

  // Update reward row
  const handleRewardChange = (
    id: string,
    field: "level" | "roleId",
    value: string | number
  ) => {
    setRewardRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        if (field === "level") {
          return { ...row, level: value === "" ? "" : Number(value) };
        }
        return { ...row, roleId: String(value) };
      })
    );
  };

  // Sort rows on blur
  const handleSortRewards = () => {
    setRewardRows((prev) => {
      const sorted = [...prev].sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
      return sorted;
    });
  };

  // Discard all unsaved changes
  const handleDiscardChanges = () => {
    if (!isDirty) return;
    const confirmed = window.confirm("Discard all unsaved changes?");
    if (!confirmed) return;

    setXpMin(savedConfig.xp_min ?? 1);
    setXpMax(savedConfig.xp_max ?? 30);
    setCooldownSeconds(savedConfig.cooldown_seconds ?? 60);
    setVoiceXpEnabled(savedConfig.voice_xp_enabled ?? true);
    setVoiceXpPerMinute(savedConfig.voice_xp_per_minute ?? 30);
    setAnnounceChannelId(savedConfig.announce_channel_id ?? null);
    setAnnounceMessage(
      savedConfig.announce_message ?? "{user} has leveled up to level {level}!"
    );

    const rewardsDict = savedConfig.rewards || {};
    const rows: RewardRow[] = Object.entries(rewardsDict).map(([lvlStr, roleId]) => ({
      id: Math.random().toString(36).substring(2, 9),
      level: Number(lvlStr),
      roleId: String(roleId),
    }));
    rows.sort((a, b) => Number(a.level) - Number(b.level));
    setRewardRows(rows);

    setFieldErrors({});
    toast.info("Unsaved changes discarded");
  };

  // Save changes
  const handleSave = async (sectionName?: string) => {
    const errors: Record<string, string> = {};

    // Validate XP settings
    if (isNaN(xpMin) || xpMin < 1 || xpMin > 100) {
      errors["xp_min"] = "Minimum XP must be between 1 and 100";
    }
    if (isNaN(xpMax) || xpMax < 1 || xpMax > 100) {
      errors["xp_max"] = "Maximum XP must be between 1 and 100";
    }
    if (!errors["xp_min"] && !errors["xp_max"] && xpMax < xpMin) {
      errors["xp_max"] = "Maximum XP must be greater than or equal to minimum XP";
    }

    if (isNaN(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 600) {
      errors["cooldown_seconds"] = "Cooldown must be between 0 and 600 seconds";
    }

    if (
      isNaN(voiceXpPerMinute) ||
      voiceXpPerMinute < 0 ||
      voiceXpPerMinute > 1000
    ) {
      errors["voice_xp_per_minute"] = "Voice XP rate must be between 0 and 1000";
    }

    // Validate announcement message
    if (announceMessage.length > 500) {
      errors["announce_message"] = "Announcement message cannot exceed 500 characters";
    }

    // Validate rewards
    if (duplicateLevels.size > 0) {
      const dupes = Array.from(duplicateLevels).join(", ");
      errors["rewards"] = `Duplicate level detected (Level ${dupes}). Each level must have at most one reward.`;
    }

    for (const r of rewardRows) {
      if (r.level === "" || isNaN(Number(r.level)) || Number(r.level) <= 0) {
        errors[`reward_${r.id}_level`] = "Please enter a valid level greater than 0";
      }
      if (!r.roleId) {
        errors[`reward_${r.id}_role`] = "Please select a role";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstMsg = Object.values(errors)[0];
      toast.error(firstMsg || "Please fix validation errors before saving.");
      return;
    }

    // Clean deleted roles automatically on save
    const cleanedRewards: Record<string, string> = {};
    for (const r of rewardRows) {
      if (r.level !== "" && r.roleId !== "") {
        const exists = roles.some((role) => role.id === r.roleId);
        if (exists) {
          cleanedRewards[String(r.level)] = String(r.roleId);
        }
      }
    }

    const payload: LevelingConfig = {
      xp_min: Number(xpMin),
      xp_max: Number(xpMax),
      cooldown_seconds: Number(cooldownSeconds),
      voice_xp_enabled: Boolean(voiceXpEnabled),
      voice_xp_per_minute: Number(voiceXpPerMinute),
      announce_channel_id: announceChannelId || null,
      announce_message: announceMessage,
      rewards: cleanedRewards,
    };

    // Client-side schema verification
    const parsed = levelingConfigSchema.safeParse(payload);
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
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/leveling/config`, {
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

      // Updated config returned by server
      const updatedConfig: LevelingConfig = resData;
      setSavedConfig(updatedConfig);

      // Synchronize rows with cleaned rewards from response
      const updatedRows: RewardRow[] = Object.entries(updatedConfig.rewards || {}).map(
        ([lvlStr, roleId]) => ({
          id: Math.random().toString(36).substring(2, 9),
          level: Number(lvlStr),
          roleId: String(roleId),
        })
      );
      updatedRows.sort((a, b) => Number(a.level) - Number(b.level));
      setRewardRows(updatedRows);

      const successLabel = sectionName
        ? `${sectionName} saved successfully`
        : "Leveling configuration saved successfully";
      toast.success(successLabel);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error while saving";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Render loading skeleton
  if (isLoading) {
    return <LevelingLoading />;
  }

  // Render error card with retry
  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leveling</h1>
          <p className="text-sm text-muted-foreground">
            Configure XP progression, level-up announcements, and role rewards.
          </p>
        </div>

        <Card className="border-destructive/30 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-destructive">Failed to Load Leveling Settings</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              The bot control plane could not provide leveling configuration for guild {guildId}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-foreground font-medium">{loadError}</p>
            <p className="text-xs text-muted-foreground">
              Verify that the bot is running, <code className="font-mono bg-muted px-1 py-0.5 rounded">CONTROL_PLANE_SECRET</code> matches, and the bot is joined to this server.
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

  // Live announcement preview string
  const livePreview = announceMessage
    ? announceMessage
        .replace(/\{user\}/g, "@Alex")
        .replace(/\{level\}/g, "5")
        .replace(/\{server\}/g, guildName)
    : "";

  return (
    <div className="space-y-6">
      {/* 1. Status Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Leveling</h1>
            <Badge
              variant="outline"
              className={
                enabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 text-xs font-mono"
                  : "border-muted-foreground/30 bg-muted/40 text-muted-foreground text-xs font-mono"
              }
            >
              {enabled ? "Active" : "Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure XP progression, level-up announcements, and role rewards.
          </p>
        </div>

        {/* Header Actions: Enabled Switch & Global Save */}
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
                onClick={() => handleSave()}
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
              htmlFor="leveling-master-switch"
              className="text-xs font-medium cursor-pointer text-foreground"
            >
              {enabled ? "Module Enabled" : "Module Disabled"}
            </Label>
            <Switch
              id="leveling-master-switch"
              checked={enabled}
              disabled={isTogglingState}
              onCheckedChange={handleToggleEnabled}
            />
          </div>
        </div>
      </div>

      {/* Disabled Banner */}
      {!enabled && (
        <div className="flex items-center gap-3 rounded-lg border border-border/80 bg-muted/40 p-4 text-sm text-muted-foreground shadow-2xs">
          <Info className="size-5 shrink-0 text-muted-foreground" />
          <div>
            <span className="font-semibold text-foreground">Leveling is disabled</span>
            <span> — members earn no XP</span>
          </div>
        </div>
      )}

      {/* General validation error banner */}
      {fieldErrors["general"] && (
        <div className="flex items-center gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{fieldErrors["general"]}</span>
        </div>
      )}

      <div className="space-y-6">
        {/* 2. XP Settings Card */}
        <Card className="border border-border/80 shadow-2xs">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">XP Settings</CardTitle>
                {isXpDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium ml-1">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved
                  </span>
                )}
              </div>
            </div>
            <CardDescription>
              Configure message cooldowns, XP award ranges per text message, and voice activity rates.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Always-Visible Saved State Strip */}
            <SavedStateStrip
              items={[
                {
                  label: "XP Range",
                  value: `${savedConfig.xp_min ?? 1}–${savedConfig.xp_max ?? 30} XP`,
                },
                {
                  label: "Cooldown",
                  value: `${savedConfig.cooldown_seconds ?? 60}s`,
                },
                {
                  label: "Voice XP",
                  value: savedConfig.voice_xp_enabled
                    ? `${savedConfig.voice_xp_per_minute ?? 30} XP/min`
                    : "Disabled",
                },
              ]}
            />

            {/* XP Range (Min / Max) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">
                XP Per Message Range <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium">Minimum XP</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={xpMin}
                    onChange={(e) => {
                      setXpMin(Number(e.target.value));
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.xp_min;
                        delete next.xp_max;
                        return next;
                      });
                    }}
                    className={
                      fieldErrors["xp_min"]
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                  {fieldErrors["xp_min"] && (
                    <p className="text-xs text-destructive">{fieldErrors["xp_min"]}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground font-medium">Maximum XP</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={xpMax}
                    onChange={(e) => {
                      setXpMax(Number(e.target.value));
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.xp_min;
                        delete next.xp_max;
                        return next;
                      });
                    }}
                    className={
                      fieldErrors["xp_max"]
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                  {fieldErrors["xp_max"] && (
                    <p className="text-xs text-destructive">{fieldErrors["xp_max"]}</p>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pt-0.5">
                A random amount between Min XP and Max XP is awarded per text message (1–100).
              </p>
            </div>

            {/* Cooldown Seconds */}
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="cooldown-input" className="text-xs font-semibold text-foreground">
                Message Cooldown (seconds) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cooldown-input"
                type="number"
                min={0}
                max={600}
                value={cooldownSeconds}
                onChange={(e) => {
                  setCooldownSeconds(Number(e.target.value));
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.cooldown_seconds;
                    return next;
                  });
                }}
                className={
                  fieldErrors["cooldown_seconds"]
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {fieldErrors["cooldown_seconds"] && (
                <p className="text-xs text-destructive">{fieldErrors["cooldown_seconds"]}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Minimum wait time between XP awards for the same member (0–600 seconds).
              </p>
            </div>

            {/* Voice XP Switch and Rate Input */}
            <div className="rounded-lg border border-border/70 bg-muted/20 p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="voice-xp-switch"
                    className="text-xs font-semibold text-foreground cursor-pointer"
                  >
                    Voice Activity XP
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Periodically award XP to members chatting in non-AFK voice channels.
                  </p>
                </div>
                <Switch
                  id="voice-xp-switch"
                  checked={voiceXpEnabled}
                  onCheckedChange={(checked) => setVoiceXpEnabled(checked)}
                />
              </div>

              {voiceXpEnabled && (
                <div className="space-y-1.5 max-w-sm pt-2 border-t border-border/50">
                  <Label htmlFor="voice-rate-input" className="text-xs font-medium text-foreground">
                    Voice XP Rate (per minute)
                  </Label>
                  <Input
                    id="voice-rate-input"
                    type="number"
                    min={0}
                    max={1000}
                    value={voiceXpPerMinute}
                    onChange={(e) => {
                      setVoiceXpPerMinute(Number(e.target.value));
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.voice_xp_per_minute;
                        return next;
                      });
                    }}
                    className={
                      fieldErrors["voice_xp_per_minute"]
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                  {fieldErrors["voice_xp_per_minute"] && (
                    <p className="text-xs text-destructive">
                      {fieldErrors["voice_xp_per_minute"]}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    XP granted each minute while active in a voice channel (0–1000).
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 3. Announcements Card */}
        <Card className="border border-border/80 shadow-2xs">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Announcements</CardTitle>
                {isAnnouncementsDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium ml-1">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved
                  </span>
                )}
              </div>
            </div>
            <CardDescription>
              Configure the destination channel and customize the message template sent on level up.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Always-Visible Saved State Strip */}
            <SavedStateStrip
              items={[
                {
                  label: "Channel",
                  value: resolveChannelName(
                    savedConfig.announce_channel_id,
                    channels,
                    "Same channel"
                  ),
                },
                {
                  label: "Template",
                  value: savedConfig.announce_message
                    ? savedConfig.announce_message.length > 28
                      ? `${savedConfig.announce_message.slice(0, 28)}…`
                      : savedConfig.announce_message
                    : "{user} has leveled up to level {level}!",
                },
              ]}
            />

            {/* Channel Select with 'Same channel' none option */}
            <div className="space-y-1.5 max-w-md">
              <Label htmlFor="announce-channel" className="text-xs font-semibold text-foreground">
                Announcement Channel
              </Label>
              <SelectSearchable
                id="announce-channel"
                value={announceChannelId ?? "none"}
                onValueChange={(val) => {
                  setAnnounceChannelId(val === "none" ? null : val);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.announce_channel_id;
                    return next;
                  });
                }}
                options={[
                  { value: "none", label: "Same channel (where member leveled up)" },
                  ...textChannels.map((c) => ({
                    value: c.id,
                    label: `#${c.name}${c.type === "announcement" ? " (announcement)" : ""}`,
                  })),
                ]}
                placeholder="Select an announcement channel..."
                searchPlaceholder="Search text channels..."
                aria-invalid={!!fieldErrors["announce_channel_id"]}
              />
              {fieldErrors["announce_channel_id"] && (
                <p className="text-xs text-destructive">
                  {fieldErrors["announce_channel_id"]}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Pick a dedicated channel or broadcast directly in the channel where the message was sent.
              </p>
            </div>

            {/* Announcement Message & Token Chips */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="announce-message" className="text-xs font-semibold text-foreground">
                  Announcement Message Template
                </Label>
                <span
                  className={`text-[11px] font-mono ${
                    announceMessage.length > 500
                      ? "text-destructive font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  {announceMessage.length} / 500
                </span>
              </div>

              <Textarea
                ref={messageTextareaRef}
                id="announce-message"
                rows={3}
                maxLength={500}
                value={announceMessage}
                onChange={(e) => {
                  setAnnounceMessage(e.target.value);
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.announce_message;
                    return next;
                  });
                }}
                placeholder="{user} has leveled up to level {level}!"
                className={
                  fieldErrors["announce_message"]
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {fieldErrors["announce_message"] && (
                <p className="text-xs text-destructive">{fieldErrors["announce_message"]}</p>
              )}

              {/* Token Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-muted-foreground">Insert variables:</span>
                {[
                  { token: "{user}", desc: "User mention (@Alex)" },
                  { token: "{level}", desc: "New level (5)" },
                  { token: "{server}", desc: "Server name" },
                ].map(({ token, desc }) => (
                  <Button
                    key={token}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs font-mono px-2 rounded-md hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
                    onClick={() => handleInsertToken(token)}
                    title={desc}
                  >
                    <Sparkles className="size-3 mr-1 text-primary" />
                    {token}
                  </Button>
                ))}
              </div>
            </div>

            {/* Live Example Line */}
            <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/30 p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold uppercase tracking-wider text-[11px]">
                  Live Preview
                </span>
                <span className="text-[11px]">
                  Sample values: <code className="font-mono text-primary">@Alex</code>,{" "}
                  <code className="font-mono text-primary">5</code>,{" "}
                  <code className="font-mono text-primary">{guildName}</code>
                </span>
              </div>
              <p className="text-sm text-foreground font-sans break-words leading-relaxed">
                {livePreview || (
                  <span className="text-muted-foreground italic">
                    No announcement message configured
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 4. Role Rewards Card */}
        <Card className="border border-border/80 shadow-2xs">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Role Rewards</CardTitle>
                {isRewardsDirty && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 font-medium ml-1">
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddReward}
                className="h-8 text-xs"
              >
                <Plus className="size-3.5 mr-1" />
                <span>Add Reward</span>
              </Button>
            </div>
            <CardDescription>
              Assign Discord roles automatically when members reach designated levels. Sorted by level.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Always-Visible Saved State Strip */}
            <SavedStateStrip
              items={[
                {
                  label: "Configured",
                  value:
                    savedRewardEntries.length === 0
                      ? "None"
                      : `${savedRewardEntries.length} role reward${
                          savedRewardEntries.length === 1 ? "" : "s"
                        }`,
                },
                ...(savedRewardEntries.length > 0
                  ? [
                      {
                        label: "Milestones",
                        value: (
                          <span className="inline-flex items-center gap-1 flex-wrap">
                            {savedRewardEntries.slice(0, 3).map(([lvl, rId], i) => (
                              <React.Fragment key={lvl}>
                                {i > 0 && (
                                  <span className="text-muted-foreground/40 px-0.5">·</span>
                                )}
                                <span>
                                  Lvl {lvl} → {resolveRoleName(rId, roles)}
                                </span>
                              </React.Fragment>
                            ))}
                            {savedRewardEntries.length > 3 && (
                              <span className="text-muted-foreground">
                                (+{savedRewardEntries.length - 3} more)
                              </span>
                            )}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />

            {fieldErrors["rewards"] && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{fieldErrors["rewards"]}</span>
              </div>
            )}

            {rewardRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 p-8 text-center space-y-3">
                <div className="flex justify-center">
                  <div className="rounded-full bg-muted/60 p-3 text-muted-foreground">
                    <Shield className="size-6" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">No role rewards configured</p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    Members will level up through text and voice activity, but no roles will be granted.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddReward}
                  className="text-xs"
                >
                  <Plus className="size-3.5 mr-1" />
                  <span>Create First Reward</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {rewardRows.map((row) => {
                  const isRoleDeleted =
                    row.roleId !== "" && !roles.some((r) => r.id === row.roleId);
                  const isDuplicate =
                    typeof row.level === "number" && duplicateLevels.has(row.level);
                  const selectedRole = roles.find((r) => r.id === row.roleId);

                  if (isRoleDeleted) {
                    return (
                      <div
                        key={row.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive text-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <AlertTriangle className="size-4 shrink-0 text-destructive" />
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="border-destructive/40 text-destructive font-mono text-xs"
                            >
                              Level {row.level}
                            </Badge>
                            <span className="text-xs text-destructive font-medium">
                              Role ID <code className="font-mono text-[11px]">{row.roleId}</code>
                            </span>
                            <span className="text-xs text-destructive/90">
                              — Role deleted — will be cleaned on save
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveReward(row.id)}
                          className="text-destructive hover:bg-destructive/20 hover:text-destructive shrink-0 h-8 self-end sm:self-auto"
                        >
                          <Trash2 className="size-4 mr-1.5" />
                          <span>Remove</span>
                        </Button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={row.id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 p-2.5 rounded-lg border bg-card/60 transition-colors ${
                        isDuplicate
                          ? "border-destructive/60 bg-destructive/5"
                          : "border-border/70 hover:border-border"
                      }`}
                    >
                      {/* Level Input */}
                      <div className="flex items-center gap-2 w-full sm:w-36 shrink-0">
                        <Label
                          htmlFor={`level-${row.id}`}
                          className="text-xs text-muted-foreground font-medium shrink-0"
                        >
                          Level
                        </Label>
                        <Input
                          id={`level-${row.id}`}
                          type="number"
                          min={1}
                          max={9999}
                          value={row.level}
                          onBlur={handleSortRewards}
                          onChange={(e) =>
                            handleRewardChange(row.id, "level", e.target.value)
                          }
                          className={`h-9 text-xs font-semibold ${
                            isDuplicate || fieldErrors[`reward_${row.id}_level`]
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }`}
                        />
                      </div>

                      {/* Arrow Icon */}
                      <ArrowRight className="size-3.5 text-muted-foreground shrink-0 hidden sm:block" />

                      {/* Role Select */}
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        {selectedRole?.color && (
                          <span
                            className="size-3 rounded-full shrink-0 border border-border/50 hidden sm:inline-block"
                            style={{ backgroundColor: selectedRole.color }}
                          />
                        )}
                        <Select
                          value={row.roleId || null}
                          onValueChange={(val) =>
                            handleRewardChange(row.id, "roleId", val ?? "")
                          }
                          items={roleItems}
                        >
                          <SelectTrigger
                            id={`role-${row.id}`}
                            size="sm"
                            className={cn(
                              "w-full h-9 text-xs",
                              fieldErrors[`reward_${row.id}_role`]
                                ? "border-destructive focus-visible:ring-destructive"
                                : "border-input focus-visible:ring-ring"
                            )}
                          >
                            <SelectValue placeholder="Select a role..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roleItems.map((r) => (
                              <SelectItem key={r.value} value={r.value} disabled={r.disabled}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Remove Button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveReward(row.id)}
                        className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 self-end sm:self-auto"
                        title={`Remove Level ${row.level} Reward`}
                      >
                        <Trash2 className="size-4" />
                      </Button>

                      {/* Duplicate error text on mobile/wrap */}
                      {isDuplicate && (
                        <div className="w-full sm:hidden text-[11px] text-destructive">
                          Duplicate level: Level {row.level} is already configured
                        </div>
                      )}
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
