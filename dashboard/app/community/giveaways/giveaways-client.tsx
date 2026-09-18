"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Gift,
  Trophy,
  Clock,
  Users,
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  Sparkles,
  AlertCircle,
  Hash,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import {
  GiveawayItem,
  GiveawaysConfig,
  GiveawaysResponse,
  CreateGiveawayPayload,
} from "@/lib/modules/giveaways";
import { GuildChannel, GuildRole } from "@/lib/control-plane";
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
import { SelectSearchable } from "@/components/ui/select-searchable";

interface GiveawaysClientProps {
  guildId: string;
}

export function GiveawaysClient({ guildId }: GiveawaysClientProps) {
  // Remote data state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [giveaways, setGiveaways] = useState<GiveawayItem[]>([]);

  // Config form state
  const [logsChannelId, setLogsChannelId] = useState<string | null>(null);
  const [managerRoleIds, setManagerRoleIds] = useState<string[]>([]);
  const [savedConfig, setSavedConfig] = useState<GiveawaysConfig>({
    logs_channel_id: null,
    manager_role_ids: [],
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Create giveaway form state
  const [channelId, setChannelId] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [winnersCount, setWinnersCount] = useState<number>(1);
  const [durationValue, setDurationValue] = useState<number>(1);
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [description, setDescription] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [requiredRoleIds, setRequiredRoleIds] = useState<string[]>([]);
  const [roleMultipliers, setRoleMultipliers] = useState<Array<{ roleId: string; multiplier: number }>>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [rerollingId, setRerollingId] = useState<string | null>(null);

  const textChannels = useMemo(() => channels.filter((c) => c.type === "text"), [channels]);

  // Explorer filter & pagination states
  const [giveawayFilterTab, setGiveawayFilterTab] = useState<"all" | "active" | "ended">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const isGiveawayEnded = useCallback((g: GiveawayItem) => {
    if (g.concluded) return true;
    if (g.status === "ended") return true;
    if (g.concluded_at) return true;
    const winners = g.winners || g.Winners;
    if (Array.isArray(winners) && winners.length > 0) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    if (g.end_time && g.end_time <= nowSec) return true;
    return false;
  }, []);

  const activeCount = useMemo(() => giveaways.filter((g) => !isGiveawayEnded(g)).length, [giveaways, isGiveawayEnded]);
  const endedCount = useMemo(() => giveaways.filter((g) => isGiveawayEnded(g)).length, [giveaways, isGiveawayEnded]);

  const filteredGiveaways = useMemo(() => {
    return giveaways.filter((g) => {
      const ended = isGiveawayEnded(g);
      if (giveawayFilterTab === "active" && ended) return false;
      if (giveawayFilterTab === "ended" && !ended) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const pTitle = (g.title || g.Title || "").toLowerCase();
        const msgId = (g.message_id || "").toLowerCase();
        const desc = (g.description || g.Description || "").toLowerCase();
        if (!pTitle.includes(q) && !msgId.includes(q) && !desc.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [giveaways, giveawayFilterTab, searchQuery, isGiveawayEnded]);

  const totalPages = Math.max(1, Math.ceil(filteredGiveaways.length / pageSize));
  const paginatedGiveaways = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredGiveaways.slice(start, start + pageSize);
  }, [filteredGiveaways, currentPage, pageSize]);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [giveawayFilterTab, searchQuery, pageSize]);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [giveawaysRes, channelsRes, rolesRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/giveaways`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }),
      ]);

      if (!giveawaysRes.ok) {
        throw new Error(`Failed to fetch giveaways (${giveawaysRes.status})`);
      }
      const giveawaysData: GiveawaysResponse = await giveawaysRes.json();
      const channelsData: GuildChannel[] = channelsRes.ok ? await channelsRes.json().catch(() => []) : [];
      const rolesData = rolesRes.ok ? await rolesRes.json().catch(() => ({ roles: [] })) : { roles: [] };

      setGiveaways(Array.isArray(giveawaysData.giveaways) ? giveawaysData.giveaways : []);
      setChannels(Array.isArray(channelsData) ? channelsData : []);
      setRoles(Array.isArray(rolesData?.roles) ? rolesData.roles : []);

      const cfg: GiveawaysConfig = {
        logs_channel_id: giveawaysData.config?.logs_channel_id ? String(giveawaysData.config.logs_channel_id) : null,
        manager_role_ids: Array.isArray(giveawaysData.config?.manager_role_ids)
          ? giveawaysData.config.manager_role_ids.map(String)
          : [],
      };
      setSavedConfig(cfg);
      setLogsChannelId(cfg.logs_channel_id);
      setManagerRoleIds(cfg.manager_role_ids);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load giveaways";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check config dirty
  const isConfigDirty = useMemo(() => {
    if (logsChannelId !== savedConfig.logs_channel_id) return true;
    return JSON.stringify(managerRoleIds.slice().sort()) !== JSON.stringify(savedConfig.manager_role_ids.slice().sort());
  }, [logsChannelId, managerRoleIds, savedConfig]);

  // Save config
  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/giveaways/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logs_channel_id: logsChannelId,
          manager_role_ids: managerRoleIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save config (${res.status})`);
      }

      setSavedConfig({
        logs_channel_id: logsChannelId,
        manager_role_ids: managerRoleIds,
      });
      toast.success("Giveaways settings saved successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(msg);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Toggle manager role
  const handleToggleManagerRole = (roleId: string) => {
    setManagerRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    );
  };

  // Toggle required role
  const handleToggleRequiredRole = (roleId: string) => {
    setRequiredRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    );
  };

  // Add multiplier row
  const handleAddMultiplier = () => {
    const unselectedRole = roles.find((r) => !roleMultipliers.some((m) => m.roleId === r.id));
    if (!unselectedRole) {
      toast.error("All available roles already have multipliers configured");
      return;
    }
    setRoleMultipliers([...roleMultipliers, { roleId: unselectedRole.id, multiplier: 2 }]);
  };

  const handleUpdateMultiplier = (index: number, updates: Partial<{ roleId: string; multiplier: number }>) => {
    setRoleMultipliers((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  };

  const handleRemoveMultiplier = (index: number) => {
    setRoleMultipliers((prev) => prev.filter((_, i) => i !== index));
  };

  // Launch giveaway
  const handleLaunchGiveaway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelId) {
      toast.error("Please select a target Discord channel");
      return;
    }
    if (!title.trim()) {
      toast.error("Please enter a giveaway prize / title");
      return;
    }
    if (winnersCount < 1) {
      toast.error("Giveaway must have at least 1 winner");
      return;
    }

    let multiplierSeconds = 3600;
    if (durationUnit === "minutes") multiplierSeconds = 60;
    if (durationUnit === "days") multiplierSeconds = 86400;
    const durationSeconds = Math.max(30, durationValue * multiplierSeconds);

    const multipliersMap: Record<string, number> = {};
    for (const item of roleMultipliers) {
      if (item.roleId && item.multiplier > 1) {
        multipliersMap[item.roleId] = item.multiplier;
      }
    }

    const payload: CreateGiveawayPayload = {
      channel_id: channelId,
      title: title.trim(),
      winners_count: winnersCount,
      duration_seconds: durationSeconds,
      description: description.trim() || undefined,
      image_url: imageUrl.trim() || undefined,
      required_role_ids: requiredRoleIds.length > 0 ? requiredRoleIds : undefined,
      role_multipliers: Object.keys(multipliersMap).length > 0 ? multipliersMap : undefined,
    };

    setIsCreating(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/giveaways`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to create giveaway (${res.status})`);
      }

      toast.success("Giveaway launched successfully!");
      setTitle("");
      setDescription("");
      setImageUrl("");
      setRequiredRoleIds([]);
      setRoleMultipliers([]);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to launch giveaway";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  // Reroll giveaway
  const handleReroll = async (messageId: string) => {
    setRerollingId(messageId);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/giveaways/${messageId}/reroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to reroll (${res.status})`);
      }

      const data = await res.json();
      toast.success(`New winners rolled: ${data.winners?.map((w: string) => `<@${w}>`).join(", ") || "None"}`);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reroll giveaway";
      toast.error(msg);
    } finally {
      setRerollingId(null);
    }
  };

  const getRoleName = (rId: string | number) => {
    const role = roles.find((r) => String(r.id) === String(rId));
    return role ? role.name : String(rId);
  };

  const getChannelName = (cId: string | number | undefined | null) => {
    if (!cId) return "channel";
    const channel = channels.find((c) => String(c.id) === String(cId));
    return channel ? channel.name : String(cId);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <RefreshCw className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading giveaways & configuration...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="border border-destructive/40 bg-destructive/5 max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-5" />
            <CardTitle>Failed to load giveaways</CardTitle>
          </div>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="size-3.5 mr-2" />
            Try Again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gift className="size-6 text-primary" />
            Giveaways
          </h1>
          <p className="text-sm text-muted-foreground">
            Create and manage server giveaways with role multipliers, requirements, and logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="size-3.5 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Giveaways Settings & Create Form (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* General Config Card */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Shield className="size-4 text-primary" />
                  Giveaway Module Settings
                </CardTitle>
                {isConfigDirty && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-xs">
                    Unsaved changes
                  </Badge>
                )}
              </div>
              <CardDescription>
                Configure giveaway logs channel and staff manager roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logs Channel */}
              <div className="space-y-2">
                <Label htmlFor="giveaway-logs-channel" className="text-sm font-medium">
                  Giveaway Logs Channel
                </Label>
                <SelectSearchable
                  id="giveaway-logs-channel"
                  value={logsChannelId}
                  onValueChange={(val) => setLogsChannelId(val && val !== "none" ? val : null)}
                  options={[
                    { value: "none", label: "None (Disabled)" },
                    ...textChannels.map((ch) => ({
                      value: ch.id,
                      label: `#${ch.name}`,
                    })),
                  ]}
                  placeholder="Select a logs channel..."
                  searchPlaceholder="Search text channels..."
                />
                <p className="text-xs text-muted-foreground">
                  Upon completion, giveaway results and large entrant rosters (.txt) will be dispatched here.
                </p>
              </div>

              {/* Manager Roles */}
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Shield className="size-3 text-muted-foreground" />
                  Giveaway Manager Roles
                </Label>
                <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 rounded-md border border-input bg-muted/20">
                  {roles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No roles loaded</span>
                  ) : (
                    roles.map((role) => {
                      const isAssigned = managerRoleIds.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => handleToggleManagerRole(role.id)}
                          className={`text-xs px-3 py-1 rounded-full border transition-all ${
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
                <p className="text-xs text-muted-foreground">
                  Members with these roles can host giveaways without Administrator permissions.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={handleSaveConfig}
                disabled={!isConfigDirty || isSavingConfig}
              >
                <Save className="size-3.5 mr-2" />
                {isSavingConfig ? "Saving..." : "Save Settings"}
              </Button>
            </CardFooter>
          </Card>

          {/* Create Giveaway Card */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Launch New Giveaway
              </CardTitle>
              <CardDescription>
                Publish a new interactive giveaway directly to your server.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleLaunchGiveaway}>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Channel */}
                  <div className="space-y-2">
                    <Label htmlFor="target-channel" className="text-sm font-medium">
                      Target Channel <span className="text-destructive">*</span>
                    </Label>
                    <SelectSearchable
                      id="target-channel"
                      value={channelId}
                      onValueChange={setChannelId}
                      options={textChannels.map((ch) => ({
                        value: ch.id,
                        label: `#${ch.name}`,
                      }))}
                      placeholder="Select target channel..."
                    />
                  </div>

                  {/* Winners Count */}
                  <div className="space-y-2">
                    <Label htmlFor="winners-count" className="text-sm font-medium">
                      Number of Winners
                    </Label>
                    <Input
                      id="winners-count"
                      type="number"
                      min={1}
                      max={50}
                      value={winnersCount}
                      onChange={(e) => setWinnersCount(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                </div>

                {/* Prize / Title */}
                <div className="space-y-2">
                  <Label htmlFor="giveaway-title" className="text-sm font-medium">
                    Prize / Title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="giveaway-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Discord Nitro (1 Month)"
                    maxLength={256}
                  />
                </div>

                {/* Duration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="duration-val" className="text-sm font-medium">
                      Duration Value
                    </Label>
                    <Input
                      id="duration-val"
                      type="number"
                      min={1}
                      value={durationValue}
                      onChange={(e) => setDurationValue(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Duration Unit</Label>
                    <div className="flex gap-2">
                      {(["minutes", "hours", "days"] as const).map((unit) => (
                        <Button
                          key={unit}
                          type="button"
                          variant={durationUnit === unit ? "default" : "outline"}
                          size="sm"
                          className="capitalize flex-1"
                          onClick={() => setDurationUnit(unit)}
                        >
                          {unit}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="giveaway-desc" className="text-sm font-medium">
                    Description (Optional)
                  </Label>
                  <Textarea
                    id="giveaway-desc"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Additional instructions or giveaway rules..."
                    maxLength={1000}
                  />
                </div>

                {/* Image URL */}
                <div className="space-y-2">
                  <Label htmlFor="giveaway-image" className="text-sm font-medium">
                    Banner Image URL (Optional)
                  </Label>
                  <Input
                    id="giveaway-image"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/banner.png"
                  />
                </div>

                {/* Required Roles */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Shield className="size-3 text-muted-foreground" />
                    Required Roles (Only holders can enter)
                  </Label>
                  <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2.5 rounded-md border border-input bg-muted/20">
                    {roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No roles loaded</span>
                    ) : (
                      roles.map((role) => {
                        const isRequired = requiredRoleIds.includes(role.id);
                        return (
                          <button
                            key={role.id}
                            type="button"
                            onClick={() => handleToggleRequiredRole(role.id)}
                            className={`text-xs px-3 py-1 rounded-full border transition-all ${
                              isRequired
                                ? "bg-amber-500 text-white border-amber-500 font-medium"
                                : "bg-background text-muted-foreground border-border/80 hover:border-foreground/40"
                            }`}
                          >
                            {role.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Role Multipliers */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium flex items-center gap-1.5">
                      <Trophy className="size-3.5 text-primary" />
                      Role Multipliers (Extra Lottery Entries)
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddMultiplier}
                      className="text-xs h-7"
                    >
                      <Plus className="size-3 mr-1" />
                      Add Multiplier
                    </Button>
                  </div>

                  {roleMultipliers.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No role multipliers configured (all entrants get standard 1x entry).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {roleMultipliers.map((m, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-2 rounded-md border border-border bg-card">
                          <div className="flex-1">
                            <SelectSearchable
                              value={m.roleId}
                              onValueChange={(val) => handleUpdateMultiplier(idx, { roleId: val })}
                              options={roles.map((r) => ({
                                value: r.id,
                                label: r.name,
                              }))}
                              placeholder="Select role..."
                              size="sm"
                            />
                          </div>
                          <div className="w-28 flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={2}
                              max={100}
                              value={m.multiplier}
                              onChange={(e) =>
                                handleUpdateMultiplier(idx, {
                                  multiplier: Math.max(2, parseInt(e.target.value) || 2),
                                })
                              }
                              className="h-8 text-xs font-mono"
                            />
                            <span className="text-xs font-bold text-primary">x</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveMultiplier(idx)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-end pt-3">
                <Button type="submit" disabled={isCreating}>
                  <Sparkles className="size-3.5 mr-2" />
                  {isCreating ? "Launching Giveaway..." : "Launch Giveaway"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>

        {/* Right: Paginated Giveaways Explorer (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Gift className="size-4 text-primary" />
                  Giveaway Explorer
                </CardTitle>
                <Badge variant="outline" className="text-xs font-mono">
                  {filteredGiveaways.length} / {giveaways.length} Total
                </Badge>
              </div>

              {/* Search Box */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by prize, channel, or ID..."
                  className="pl-8 text-xs h-8"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 pt-1">
                {(
                  [
                    { id: "all", label: "All", count: giveaways.length },
                    { id: "active", label: "Active", count: activeCount },
                    { id: "ended", label: "Ended", count: endedCount },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.id}
                    type="button"
                    variant={giveawayFilterTab === tab.id ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5 flex-1"
                    onClick={() => setGiveawayFilterTab(tab.id)}
                  >
                    {tab.label}
                    <span className="ml-1 text-[10px] opacity-80">({tab.count})</span>
                  </Button>
                ))}
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {paginatedGiveaways.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-md">
                  {searchQuery.trim()
                    ? "No giveaways match your search query."
                    : giveawayFilterTab === "active"
                    ? "No active giveaways running right now."
                    : "No giveaways found."}
                </div>
              ) : (
                paginatedGiveaways.map((g) => {
                  const nowSeconds = Math.floor(Date.now() / 1000);
                  const ended = isGiveawayEnded(g);
                  const entrants = g.entrants || g.Entrants || [];
                  const winners = g.winners || g.Winners || [];
                  const pTitle = g.title || g.Title || "Giveaway";
                  const wCount = g.winners_count || g.Winner || 1;
                  const endsInSec = g.end_time ? Math.max(0, g.end_time - nowSeconds) : 0;
                  const endsInHours = Math.round(endsInSec / 3600);
                  const isRerolling = rerollingId === g.message_id;

                  return (
                    <div
                      key={g.message_id || g._id}
                      className={`border rounded-lg p-3.5 space-y-2.5 bg-card transition-colors ${
                        ended
                          ? "border-border/70"
                          : "border-emerald-500/40 hover:border-emerald-500/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-semibold text-sm leading-tight">{pTitle}</h4>
                          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 font-mono">
                            <Hash className="size-3" />
                            {getChannelName(g.channel_id || g.channel || g.Channel)}
                          </span>
                        </div>
                        <Badge
                          className={
                            ended
                              ? "text-[10px] bg-secondary text-secondary-foreground"
                              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[10px]"
                          }
                        >
                          {ended ? "Ended" : "Active"}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Trophy className="size-3 text-amber-500" />
                          {wCount} {wCount === 1 ? "Winner" : "Winners"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="size-3 text-primary" />
                          {entrants.length} Entrants
                        </span>
                        {!ended && (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <Clock className="size-3" />
                            {endsInHours > 0 ? `~${endsInHours}h left` : `${Math.round(endsInSec / 60)}m left`}
                          </span>
                        )}
                      </div>

                      {/* Required Roles & Multipliers */}
                      {g.required_role_ids && g.required_role_ids.length > 0 && (
                        <div className="flex flex-wrap gap-1 items-center pt-0.5">
                          <span className="text-[10px] text-muted-foreground">Req:</span>
                          {g.required_role_ids.map((rId) => (
                            <Badge key={String(rId)} variant="outline" className="text-[10px] py-0 px-1.5">
                              {getRoleName(rId)}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Winners Section for ended giveaways */}
                      {ended && (
                        <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="space-y-1">
                            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                              <Trophy className="size-3 text-amber-500" />
                              Winners:
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {winners.length === 0 ? (
                                <span className="text-xs text-muted-foreground italic">None drawn</span>
                              ) : (
                                winners.map((w) => (
                                  <Badge key={w} variant="outline" className="font-mono text-[10px]">
                                    {w}
                                  </Badge>
                                ))
                              )}
                            </div>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 self-end sm:self-center"
                            onClick={() => handleReroll(g.message_id)}
                            disabled={isRerolling || entrants.length === 0}
                          >
                            <RefreshCw className={`size-3 mr-1 ${isRerolling ? "animate-spin" : ""}`} />
                            {isRerolling ? "Rerolling..." : "Reroll"}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>

            {/* Pagination Controls */}
            {filteredGiveaways.length > 0 && (
              <CardFooter className="pt-2 pb-3 border-t border-border/60 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Showing{" "}
                  <strong className="text-foreground">
                    {(currentPage - 1) * pageSize + 1}
                  </strong>{" "}
                  to{" "}
                  <strong className="text-foreground">
                    {Math.min(currentPage * pageSize, filteredGiveaways.length)}
                  </strong>{" "}
                  of <strong className="text-foreground">{filteredGiveaways.length}</strong>
                </span>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">Show:</span>
                    {([5, 10, 25] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPageSize(size)}
                        className={`text-[11px] px-1.5 py-0.5 rounded border ${
                          pageSize === size
                            ? "bg-primary text-primary-foreground border-primary font-medium"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      title="Previous Page"
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <span className="text-[11px] px-1">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      title="Next Page"
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
