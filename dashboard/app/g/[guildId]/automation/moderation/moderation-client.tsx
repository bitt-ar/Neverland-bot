"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Shield,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Save,
  RotateCcw,
  Lock,
  Trash2,
  Plus,
  X,
  Radio,
  FileText,
  Clock,
  UserX,
  MessageSquare,
  Ban,
  Slash,
  Code2,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  ModerationConfig,
  ModerationConfigResponse,
  ModerationCase,
  RegexRuleConfig,
  DEFAULT_MODERATION_CONFIG,
  MODERATION_COMMANDS,
} from "@/lib/modules/moderation";
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
import { Switch } from "@/components/ui/switch";
import { SelectSearchable } from "@/components/ui/select-searchable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ModerationClientProps {
  guildId: string;
}

export function ModerationClient({ guildId }: ModerationClientProps) {
  // Remote data state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [cases, setCases] = useState<ModerationCase[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [isTogglingState, setIsTogglingState] = useState(false);

  // Form states
  const [modLogsChannelId, setModLogsChannelId] = useState<string | null>(null);
  const [disabledCommands, setDisabledCommands] = useState<string[]>([]);
  const [commandRoles, setCommandRoles] = useState<Record<string, string[]>>({});

  // AutoMod states
  const [antiSpam, setAntiSpam] = useState(DEFAULT_MODERATION_CONFIG.anti_spam);
  const [antiInvite, setAntiInvite] = useState(DEFAULT_MODERATION_CONFIG.anti_invite);
  const [antiMention, setAntiMention] = useState(DEFAULT_MODERATION_CONFIG.anti_mention);
  const [badWords, setBadWords] = useState(DEFAULT_MODERATION_CONFIG.bad_words);
  const [newBadWord, setNewBadWord] = useState("");

  // Custom Regex AutoMod states
  const [customRegexPatterns, setCustomRegexPatterns] = useState<RegexRuleConfig[]>([]);
  const [newRegexName, setNewRegexName] = useState("");
  const [newRegexPattern, setNewRegexPattern] = useState("");
  const [newRegexAction, setNewRegexAction] = useState<"delete" | "warn" | "timeout" | "kick" | "ban">("delete");
  const [newRegexTimeout, setNewRegexTimeout] = useState(5);
  const [testRegexInput, setTestRegexInput] = useState("");
  const [testRegexResult, setTestRegexResult] = useState<{
    testing: boolean;
    valid?: boolean;
    error?: string;
    matches?: boolean;
    match?: string;
    span?: number[];
  } | null>(null);

  // Baseline config
  const [savedConfig, setSavedConfig] = useState<ModerationConfig>(DEFAULT_MODERATION_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingCaseId, setDeletingCaseId] = useState<number | null>(null);

  // Active section tab
  const [activeTab, setActiveTab] = useState<"commands" | "automod" | "cases">("commands");

  const textChannels = useMemo(() => channels.filter((c) => c.type === "text"), [channels]);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [configRes, channelsRes, rolesRes, casesRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/modules/moderation/config`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/moderation/cases`, { cache: "no-store" }),
      ]);

      if (!configRes.ok) {
        throw new Error(`Failed to fetch moderation config (${configRes.status})`);
      }

      const configData: ModerationConfigResponse = await configRes.json();
      const channelsData: GuildChannel[] = channelsRes.ok ? await channelsRes.json().catch(() => []) : [];
      const rolesData = rolesRes.ok ? await rolesRes.json().catch(() => ({ roles: [] })) : { roles: [] };
      const casesData = casesRes.ok ? await casesRes.json().catch(() => ({ cases: [] })) : { cases: [] };

      setChannels(Array.isArray(channelsData) ? channelsData : []);
      setRoles(Array.isArray(rolesData?.roles) ? rolesData.roles : []);
      setCases(Array.isArray(casesData?.cases) ? casesData.cases : Array.isArray(casesData) ? casesData : []);

      setEnabled(Boolean(configData.enabled));

      const cfg: ModerationConfig = {
        ...DEFAULT_MODERATION_CONFIG,
        ...(configData.config || {}),
        anti_spam: { ...DEFAULT_MODERATION_CONFIG.anti_spam, ...(configData.config?.anti_spam || {}) },
        anti_invite: { ...DEFAULT_MODERATION_CONFIG.anti_invite, ...(configData.config?.anti_invite || {}) },
        anti_mention: { ...DEFAULT_MODERATION_CONFIG.anti_mention, ...(configData.config?.anti_mention || {}) },
        bad_words: { ...DEFAULT_MODERATION_CONFIG.bad_words, ...(configData.config?.bad_words || {}) },
        custom_regex_patterns: configData.config?.custom_regex_patterns || [],
      };

      setSavedConfig(cfg);
      setModLogsChannelId(cfg.mod_logs_channel_id);
      setDisabledCommands(cfg.disabled_commands || []);
      setCommandRoles(cfg.command_roles || {});
      setAntiSpam(cfg.anti_spam);
      setAntiInvite(cfg.anti_invite);
      setAntiMention(cfg.anti_mention);
      setBadWords(cfg.bad_words);
      setCustomRegexPatterns(cfg.custom_regex_patterns || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load moderation configuration";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check dirty state
  const isDirty = useMemo(() => {
    if (modLogsChannelId !== savedConfig.mod_logs_channel_id) return true;
    if (JSON.stringify(disabledCommands.slice().sort()) !== JSON.stringify(savedConfig.disabled_commands.slice().sort())) return true;
    if (JSON.stringify(commandRoles) !== JSON.stringify(savedConfig.command_roles)) return true;
    if (JSON.stringify(antiSpam) !== JSON.stringify(savedConfig.anti_spam)) return true;
    if (JSON.stringify(antiInvite) !== JSON.stringify(savedConfig.anti_invite)) return true;
    if (JSON.stringify(antiMention) !== JSON.stringify(savedConfig.anti_mention)) return true;
    if (JSON.stringify(badWords) !== JSON.stringify(savedConfig.bad_words)) return true;
    if (JSON.stringify(customRegexPatterns) !== JSON.stringify(savedConfig.custom_regex_patterns || [])) return true;
    return false;
  }, [
    modLogsChannelId,
    disabledCommands,
    commandRoles,
    antiSpam,
    antiInvite,
    antiMention,
    badWords,
    customRegexPatterns,
    savedConfig,
  ]);

  // Discard changes
  const handleDiscardChanges = () => {
    if (!isDirty) return;
    setModLogsChannelId(savedConfig.mod_logs_channel_id);
    setDisabledCommands(savedConfig.disabled_commands || []);
    setCommandRoles(savedConfig.command_roles || {});
    setAntiSpam(savedConfig.anti_spam);
    setAntiInvite(savedConfig.anti_invite);
    setAntiMention(savedConfig.anti_mention);
    setBadWords(savedConfig.bad_words);
    setCustomRegexPatterns(savedConfig.custom_regex_patterns || []);
    toast.info("Unsaved changes discarded");
  };

  // Toggle module master switch
  const handleToggleEnabled = async (nextState: boolean) => {
    setIsTogglingState(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/moderation/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextState }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to update status (${res.status})`);
      }
      setEnabled(nextState);
      toast.success(nextState ? "Moderation module enabled" : "Moderation module disabled");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to toggle Moderation state";
      toast.error(msg);
    } finally {
      setIsTogglingState(false);
    }
  };

  // Save config
  const handleSaveConfig = async () => {
    setIsSaving(true);
    const payload: ModerationConfig = {
      mod_logs_channel_id: modLogsChannelId,
      disabled_commands: disabledCommands,
      command_roles: commandRoles,
      anti_spam: antiSpam,
      anti_invite: antiInvite,
      anti_mention: antiMention,
      bad_words: badWords,
      custom_regex_patterns: customRegexPatterns,
    };

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/moderation/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save configuration (${res.status})`);
      }

      setSavedConfig(payload);
      toast.success("Moderation configuration saved successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save configuration";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle command enabled / disabled
  const handleToggleCommand = (cmdId: string) => {
    setDisabledCommands((prev) =>
      prev.includes(cmdId) ? prev.filter((id) => id !== cmdId) : [...prev, cmdId]
    );
  };

  // Toggle allowed role for command
  const handleToggleCommandRole = (cmdId: string, roleId: string) => {
    setCommandRoles((prev) => {
      const existing = prev[cmdId] || [];
      const updated = existing.includes(roleId)
        ? existing.filter((id) => id !== roleId)
        : [...existing, roleId];

      const copy = { ...prev };
      if (updated.length === 0) {
        delete copy[cmdId];
      } else {
        copy[cmdId] = updated;
      }
      return copy;
    });
  };

  // Add Bad Word
  const handleAddBadWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = newBadWord.trim().toLowerCase();
    if (!word) return;
    if (badWords.words.map((w) => w.toLowerCase()).includes(word)) {
      toast.error(`"${word}" is already in the filter list`);
      return;
    }
    setBadWords((prev) => ({
      ...prev,
      words: [...prev.words, word],
    }));
    setNewBadWord("");
  };

  // Remove Bad Word
  const handleRemoveBadWord = (wordToRemove: string) => {
    setBadWords((prev) => ({
      ...prev,
      words: prev.words.filter((w) => w !== wordToRemove),
    }));
  };

  // Custom Regex Handlers
  const handleAddRegexRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRegexName.trim();
    const pattern = newRegexPattern.trim();
    if (!name || !pattern) {
      toast.error("Both rule name and regex pattern are required.");
      return;
    }

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/moderation/test-regex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, test_string: "sample" }),
      });
      const data = await res.json();
      if (!data.valid) {
        toast.error(`Invalid regex syntax: ${data.error}`);
        return;
      }
    } catch {
      // Continue if network test fails
    }

    const newRule: RegexRuleConfig = {
      id: `rx_${Date.now()}`,
      name,
      pattern,
      action: newRegexAction,
      timeout_minutes: newRegexTimeout,
      enabled: true,
    };

    setCustomRegexPatterns((prev) => [...prev, newRule]);
    setNewRegexName("");
    setNewRegexPattern("");
    toast.success(`Regex rule "${name}" added. Click Save Changes to apply.`);
  };

  const handleRemoveRegexRule = (ruleId?: string, patternStr?: string) => {
    setCustomRegexPatterns((prev) =>
      prev.filter((r) => (ruleId ? r.id !== ruleId : r.pattern !== patternStr))
    );
  };

  const handleToggleRegexRule = (idx: number) => {
    setCustomRegexPatterns((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], enabled: !copy[idx].enabled };
      return copy;
    });
  };

  const handleRunRegexTest = async (testPattern?: string) => {
    const patternToTest = testPattern || newRegexPattern || customRegexPatterns[0]?.pattern;
    if (!patternToTest) {
      toast.error("Please enter a regex pattern to test.");
      return;
    }
    if (!testRegexInput) {
      toast.error("Please enter a test message to evaluate.");
      return;
    }

    setTestRegexResult({ testing: true });
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/moderation/test-regex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: patternToTest, test_string: testRegexInput }),
      });
      const data = await res.json();
      setTestRegexResult({
        testing: false,
        valid: data.valid,
        error: data.error,
        matches: data.matches,
        match: data.match,
        span: data.span,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Test failed";
      setTestRegexResult({ testing: false, valid: false, error: msg });
    }
  };

  // Delete Case
  const handleDeleteCase = async (caseId: number) => {
    setDeletingCaseId(caseId);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/moderation/cases/${caseId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Failed to delete case (${res.status})`);
      }
      setCases((prev) => prev.filter((c) => c.case_id !== caseId));
      toast.success(`Case #${caseId} deleted`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete case";
      toast.error(msg);
    } finally {
      setDeletingCaseId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <RefreshCw className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading moderation rules and cases...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="border border-destructive/40 bg-destructive/5 max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            <CardTitle>Failed to load Moderation</CardTitle>
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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="size-6 text-primary" />
            Moderation & AutoMod
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure moderation slash commands, role-based command permissions, and AutoMod defenses.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="size-3.5 mr-1" />
            Refresh
          </Button>

          {isDirty && (
            <Button variant="ghost" size="sm" onClick={handleDiscardChanges} disabled={isSaving}>
              <RotateCcw className="size-3.5 mr-1" />
              Discard
            </Button>
          )}

          <Button size="sm" onClick={handleSaveConfig} disabled={!isDirty || isSaving}>
            <Save className="size-3.5 mr-1.5" />
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>

          <div className="h-6 w-px bg-border/60 mx-1" />

          {/* Module Master Switch */}
          <div className="flex items-center gap-2">
            <Switch
              checked={enabled}
              disabled={isTogglingState}
              onCheckedChange={handleToggleEnabled}
            />
            <span className="text-xs font-medium">{enabled ? "Enabled" : "Disabled"}</span>
          </div>
        </div>
      </div>

      {/* Primary Settings Card (Logs Channel) */}
      <Card className="border border-border/80 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Moderation Logs Channel
          </CardTitle>
          <CardDescription>
            Target channel where disciplinary actions (/kick, /ban, /timeout, /warn) and AutoMod triggers are logged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md">
            <SelectSearchable
              value={modLogsChannelId}
              onValueChange={(val) => setModLogsChannelId(val && val !== "none" ? val : null)}
              options={[
                { value: "none", label: "None (Disabled)" },
                ...textChannels.map((ch) => ({
                  value: ch.id,
                  label: `#${ch.name}`,
                })),
              ]}
              placeholder="Select a moderation logs channel..."
              searchPlaceholder="Search text channels..."
            />
          </div>
        </CardContent>
      </Card>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-border/70 pb-3">
        <Button
          variant={activeTab === "commands" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("commands")}
          className="gap-2"
        >
          <Slash className="size-4" />
          Command Permissions & Roles
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {MODERATION_COMMANDS.length}
          </Badge>
        </Button>

        <Button
          variant={activeTab === "automod" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("automod")}
          className="gap-2"
        >
          <ShieldAlert className="size-4" />
          AutoMod Defenses
          {(antiSpam.enabled || antiInvite.enabled || antiMention.enabled || badWords.enabled) && (
            <span className="size-2 rounded-full bg-emerald-500" />
          )}
        </Button>

        <Button
          variant={activeTab === "cases" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("cases")}
          className="gap-2"
        >
          <Clock className="size-4" />
          Infraction Cases
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {cases.length}
          </Badge>
        </Button>
      </div>

      {/* TAB 1: Command Roles & Toggles */}
      {activeTab === "commands" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Enable/disable commands and restrict which Discord roles are permitted to execute each command.
              If no roles are selected for a command, it defaults to server members with standard Administrator permissions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MODERATION_COMMANDS.map((cmd) => {
              const isDisabled = disabledCommands.includes(cmd.id);
              const assignedRoles = commandRoles[cmd.id] || [];

              return (
                <Card
                  key={cmd.id}
                  className={`border transition-colors ${
                    isDisabled
                      ? "opacity-60 border-border/50 bg-muted/20"
                      : "border-border/80 bg-card hover:border-border"
                  }`}
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-primary">
                          {cmd.name}
                        </span>
                        {isDisabled && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Disabled
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`cmd-toggle-${cmd.id}`} className="text-xs text-muted-foreground">
                          {isDisabled ? "Disabled" : "Active"}
                        </Label>
                        <Switch
                          id={`cmd-toggle-${cmd.id}`}
                          checked={!isDisabled}
                          onCheckedChange={() => handleToggleCommand(cmd.id)}
                        />
                      </div>
                    </div>
                    <CardDescription className="text-xs mt-1">
                      {cmd.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 pt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium flex items-center gap-1">
                        <Lock className="size-3 text-muted-foreground" />
                        Allowed Roles
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        {assignedRoles.length === 0
                          ? "Admins only"
                          : `${assignedRoles.length} role(s) authorized`}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 min-h-[32px] p-2 rounded-md border border-input bg-muted/20">
                      {roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No roles loaded</span>
                      ) : (
                        roles.map((role) => {
                          const isAssigned = assignedRoles.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => handleToggleCommandRole(cmd.id, role.id)}
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: AutoMod Defenses */}
      {activeTab === "automod" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Anti-Spam */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Radio className="size-4 text-amber-500" />
                  Anti-Spam Rate Limiter
                </CardTitle>
                <Switch
                  checked={antiSpam.enabled}
                  onCheckedChange={(val) => setAntiSpam({ ...antiSpam, enabled: val })}
                />
              </div>
              <CardDescription>
                Sliding-window rate limiter preventing message flooding in channels.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Max Messages</Label>
                  <Input
                    type="number"
                    min={2}
                    max={30}
                    value={antiSpam.max_messages}
                    onChange={(e) =>
                      setAntiSpam({ ...antiSpam, max_messages: Math.max(2, parseInt(e.target.value) || 2) })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Time Window (Seconds)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={antiSpam.seconds}
                    onChange={(e) =>
                      setAntiSpam({ ...antiSpam, seconds: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Enforcement Action</Label>
                <div className="flex gap-2">
                  {(["timeout", "delete", "warn"] as const).map((act) => (
                    <Button
                      key={act}
                      type="button"
                      variant={antiSpam.action === act ? "default" : "outline"}
                      size="sm"
                      className="capitalize flex-1"
                      onClick={() => setAntiSpam({ ...antiSpam, action: act })}
                    >
                      {act}
                    </Button>
                  ))}
                </div>
              </div>

              {antiSpam.action === "timeout" && (
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Timeout Duration (Minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={antiSpam.timeout_minutes}
                    onChange={(e) =>
                      setAntiSpam({
                        ...antiSpam,
                        timeout_minutes: Math.max(1, parseInt(e.target.value) || 5),
                      })
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Anti-Invite */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Ban className="size-4 text-rose-500" />
                  Anti-Discord Invite Links
                </CardTitle>
                <Switch
                  checked={antiInvite.enabled}
                  onCheckedChange={(val) => setAntiInvite({ ...antiInvite, enabled: val })}
                />
              </div>
              <CardDescription>
                Detects and blocks unauthorized Discord server invite links.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Enforcement Action</Label>
                <div className="flex gap-2">
                  {(["delete", "warn", "timeout"] as const).map((act) => (
                    <Button
                      key={act}
                      type="button"
                      variant={antiInvite.action === act ? "default" : "outline"}
                      size="sm"
                      className="capitalize flex-1"
                      onClick={() => setAntiInvite({ ...antiInvite, action: act })}
                    >
                      {act}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Whitelisted Roles */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Whitelisted Roles (Allowed to post invites)</Label>
                <div className="flex flex-wrap gap-1 min-h-[32px] p-2 rounded-md border border-input bg-muted/20">
                  {roles.map((role) => {
                    const isWhite = antiInvite.whitelisted_roles.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() =>
                          setAntiInvite({
                            ...antiInvite,
                            whitelisted_roles: isWhite
                              ? antiInvite.whitelisted_roles.filter((r) => r !== role.id)
                              : [...antiInvite.whitelisted_roles, role.id],
                          })
                        }
                        className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all ${
                          isWhite
                            ? "bg-emerald-600 text-white border-emerald-600 font-medium"
                            : "bg-background text-muted-foreground border-border/80 hover:border-foreground/40"
                        }`}
                      >
                        {role.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Mass Mentions */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <UserX className="size-4 text-purple-500" />
                  Anti-Mass Mentions
                </CardTitle>
                <Switch
                  checked={antiMention.enabled}
                  onCheckedChange={(val) => setAntiMention({ ...antiMention, enabled: val })}
                />
              </div>
              <CardDescription>
                Prevents spamming mentions of users or roles in a single message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Max Mentions Allowed</Label>
                <Input
                  type="number"
                  min={2}
                  max={50}
                  value={antiMention.max_mentions}
                  onChange={(e) =>
                    setAntiMention({
                      ...antiMention,
                      max_mentions: Math.max(2, parseInt(e.target.value) || 5),
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Enforcement Action</Label>
                <div className="flex gap-2">
                  {(["delete", "warn", "timeout"] as const).map((act) => (
                    <Button
                      key={act}
                      type="button"
                      variant={antiMention.action === act ? "default" : "outline"}
                      size="sm"
                      className="capitalize flex-1"
                      onClick={() => setAntiMention({ ...antiMention, action: act })}
                    >
                      {act}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Bad Words Filter */}
          <Card className="border border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MessageSquare className="size-4 text-blue-500" />
                  Bad Words & Profanity Filter
                </CardTitle>
                <Switch
                  checked={badWords.enabled}
                  onCheckedChange={(val) => setBadWords({ ...badWords, enabled: val })}
                />
              </div>
              <CardDescription>
                Normalized filter matching exact phrases and leetspeak bypass attempts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Enforcement Action</Label>
                <div className="flex gap-2">
                  {(["delete", "warn", "timeout"] as const).map((act) => (
                    <Button
                      key={act}
                      type="button"
                      variant={badWords.action === act ? "default" : "outline"}
                      size="sm"
                      className="capitalize flex-1"
                      onClick={() => setBadWords({ ...badWords, action: act })}
                    >
                      {act}
                    </Button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleAddBadWord} className="flex gap-2">
                <Input
                  value={newBadWord}
                  onChange={(e) => setNewBadWord(e.target.value)}
                  placeholder="Add blocked phrase or word..."
                  className="text-xs"
                />
                <Button type="submit" size="sm" variant="outline">
                  <Plus className="size-3.5 mr-1" />
                  Add
                </Button>
              </form>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Blocked Words ({badWords.words.length})</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[48px] p-2.5 rounded-md border border-input bg-muted/20 max-h-48 overflow-y-auto">
                  {badWords.words.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">No blocked words configured.</span>
                  ) : (
                    badWords.words.map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1 text-xs bg-card border border-border px-2.5 py-0.5 rounded-full"
                      >
                        {word}
                        <button
                          type="button"
                          onClick={() => handleRemoveBadWord(word)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Custom Regex Rules & Live Tester (راكس) */}
          <Card className="border border-border/80 shadow-xs lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Code2 className="size-4 text-emerald-500" />
                  Dynamic Regex Filter & Live Tester (راكس)
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {customRegexPatterns.filter((r) => r.enabled).length} Active Rule(s)
                </Badge>
              </div>
              <CardDescription>
                Define custom regular expression rules with automated moderation actions (delete, warn, mute, kick, ban). Test patterns in real-time against sample messages.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Add New Regex Rule Form */}
              <form onSubmit={handleAddRegexRule} className="p-4 border rounded-lg bg-muted/20 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Add New Regex Rule
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-4 space-y-1">
                    <Label className="text-xs">Rule Name *</Label>
                    <Input
                      placeholder="e.g. Block Telegram Links"
                      value={newRegexName}
                      onChange={(e) => setNewRegexName(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div className="md:col-span-5 space-y-1">
                    <Label className="text-xs">Regex Pattern *</Label>
                    <Input
                      placeholder="e.g. https?://(?:www\.)?t\.me/[a-zA-Z0-9_]+"
                      value={newRegexPattern}
                      onChange={(e) => setNewRegexPattern(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-xs">Action</Label>
                    <Select
                      value={newRegexAction}
                      onValueChange={(val: string | null) => {
                        if (val) setNewRegexAction(val as "delete" | "warn" | "timeout" | "kick" | "ban");
                      }}
                    >
                      <SelectTrigger className="text-xs h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="delete">🗑️ Delete</SelectItem>
                        <SelectItem value="warn">⚠️ Warn</SelectItem>
                        <SelectItem value="timeout">⏱️ Timeout</SelectItem>
                        <SelectItem value="kick">👢 Kick</SelectItem>
                        <SelectItem value="ban">🔨 Ban</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {newRegexAction === "timeout" && (
                  <div className="flex items-center gap-2 max-w-xs pt-1">
                    <Label className="text-xs shrink-0">Timeout Duration (Minutes):</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={newRegexTimeout}
                      onChange={(e) => setNewRegexTimeout(Number(e.target.value) || 5)}
                      className="text-xs h-8"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button type="submit" size="sm">
                    <Plus className="size-3.5 mr-1" />
                    Add Rule
                  </Button>
                </div>
              </form>

              {/* Active Rules List */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Configured Regex Rules ({customRegexPatterns.length})</Label>
                {customRegexPatterns.length === 0 ? (
                  <div className="p-4 border rounded-lg text-center text-xs text-muted-foreground italic bg-muted/10">
                    No custom regex rules defined. Add one above to start filtering messages with regex patterns.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {customRegexPatterns.map((rule, idx) => (
                      <div
                        key={rule.id || idx}
                        className="flex items-center justify-between p-3 border rounded-lg bg-card"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{rule.name}</span>
                            <Badge variant="outline" className="text-[11px] capitalize">
                              {rule.action} {rule.action === "timeout" ? `(${rule.timeout_minutes}m)` : ""}
                            </Badge>
                          </div>
                          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                            {rule.pattern}
                          </code>
                        </div>

                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => {
                              setNewRegexPattern(rule.pattern);
                              handleRunRegexTest(rule.pattern);
                            }}
                          >
                            Test
                          </Button>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={() => handleToggleRegexRule(idx)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => handleRemoveRegexRule(rule.id, rule.pattern)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Real-time Regex Tester Simulator */}
              <div className="p-4 border rounded-lg bg-muted/10 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle className="size-3.5 text-primary" />
                    Live Regex Tester Simulator
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    Instantly validates syntax and simulates detection on test text
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-9">
                    <Input
                      placeholder="Type a sample message to test against regex patterns..."
                      value={testRegexInput}
                      onChange={(e) => setTestRegexInput(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => handleRunRegexTest()}
                      disabled={testRegexResult?.testing}
                    >
                      {testRegexResult?.testing ? (
                        <RefreshCw className="size-3 mr-1 animate-spin" />
                      ) : (
                        <Code2 className="size-3 mr-1" />
                      )}
                      Test Match
                    </Button>
                  </div>
                </div>

                {testRegexResult && !testRegexResult.testing && (
                  <div
                    className={`p-3 rounded-md text-xs border ${
                      !testRegexResult.valid
                        ? "bg-destructive/10 border-destructive/30 text-destructive"
                        : testRegexResult.matches
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {!testRegexResult.valid ? (
                      <div className="font-semibold">
                        ❌ Invalid Regex: {testRegexResult.error}
                      </div>
                    ) : testRegexResult.matches ? (
                      <div className="space-y-1">
                        <div className="font-semibold flex items-center gap-1.5">
                          ⚠️ Match Triggered! (Would be blocked by AutoMod)
                        </div>
                        <div>
                          Matched snippet:{" "}
                          <code className="bg-background/80 px-1 py-0.5 rounded font-mono font-bold">
                            &quot;{testRegexResult.match}&quot;
                          </code>{" "}
                          at character range [{testRegexResult.span?.join(", ")}]
                        </div>
                      </div>
                    ) : (
                      <div className="font-semibold flex items-center gap-1.5">
                        ✅ No violation: Message passed the regex filter cleanly.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: Infraction Cases Table */}
      {activeTab === "cases" && (
        <Card className="border border-border/80 shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="size-4 text-primary" />
                Moderation Log Cases ({cases.length})
              </CardTitle>
              <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw className="size-3 mr-1" />
                Refresh Cases
              </Button>
            </div>
            <CardDescription>
              All recorded kicks, bans, warnings, timeouts, and automod triggers for this guild.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cases.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-md">
                No moderation cases logged yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-[11px] uppercase bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3">Case</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Target</th>
                      <th className="py-2.5 px-3">Moderator</th>
                      <th className="py-2.5 px-3">Reason</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3 text-right">Delete</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {cases.map((c) => {
                      const isDeleting = deletingCaseId === c.case_id;
                      let badgeVariant: "destructive" | "default" | "secondary" | "outline" = "outline";
                      if (c.action === "BAN") badgeVariant = "destructive";
                      if (c.action === "KICK") badgeVariant = "destructive";
                      if (c.action === "TIMEOUT") badgeVariant = "default";
                      if (c.action === "WARN") badgeVariant = "secondary";

                      return (
                        <tr key={c.case_id || c._id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-semibold">#{c.case_id}</td>
                          <td className="py-2.5 px-3">
                            <Badge variant={badgeVariant} className="text-[10px] font-mono">
                              {c.action}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 font-medium">
                            {c.target_tag || `<@${c.target_id}>`}
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground">
                            {c.moderator_tag || `<@${c.moderator_id}>`}
                          </td>
                          <td className="py-2.5 px-3 max-w-xs truncate" title={c.reason}>
                            {c.reason || "No reason specified"}
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                            {c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteCase(c.case_id)}
                              disabled={isDeleting}
                              title="Delete case log"
                            >
                              <Trash2 className={`size-3.5 ${isDeleting ? "animate-spin" : ""}`} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
