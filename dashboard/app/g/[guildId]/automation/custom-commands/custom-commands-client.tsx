"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap,
  Plus,
  Trash2,
  Edit2,
  Send,
  Sparkles,
  Layers,
  RefreshCw,
  Save,
  Clock,
  Sliders,
} from "lucide-react";
import { toast } from "sonner";

import {
  GuildChannel,
  GuildRole,
  CommandDefinition,
  DropdownDefinition,
  DropdownOption,
  WorkflowAction,
} from "@/lib/control-plane";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectSearchable } from "@/components/ui/select-searchable";

interface CustomCommandsClientProps {
  guildId: string;
}

import { ActionCard, ACTION_TYPE_LABELS } from "./action-card";

const TEMPLATE_VARIABLES = [
  { tag: "{user}", desc: "User username" },
  { tag: "{user_mention}", desc: "Mention user (@User)" },
  { tag: "{user_id}", desc: "User Discord ID" },
  { tag: "{server}", desc: "Server Name" },
  { tag: "{channel}", desc: "Channel Name" },
  { tag: "{channel_mention}", desc: "Channel Mention (#chan)" },
  { tag: "{member_count}", desc: "Server Member Count" },
  { tag: "{option_label}", desc: "Selected Dropdown Option" },
];

export function CustomCommandsClient({ guildId }: CustomCommandsClientProps) {
  // Loading & State
  const [loading, setLoading] = useState(true);
  const [moduleEnabled, setModuleEnabled] = useState(false);
  const [prefix, setPrefix] = useState("!");
  const [deleteTriggerDefault, setDeleteTriggerDefault] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Data
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [commands, setCommands] = useState<CommandDefinition[]>([]);
  const [dropdowns, setDropdowns] = useState<DropdownDefinition[]>([]);

  // Search
  const [cmdSearch, setCmdSearch] = useState("");
  const [ddSearch, setDdSearch] = useState("");

  // Dialog states - Command
  const [cmdDialogOpen, setCmdDialogOpen] = useState(false);
  const [editingCmd, setEditingCmd] = useState<CommandDefinition | null>(null);
  const [cmdName, setCmdName] = useState("");
  const [cmdAliases, setCmdAliases] = useState("");
  const [cmdDesc, setCmdDesc] = useState("");
  const [cmdTriggerType, setCmdTriggerType] = useState<"prefix" | "exact" | "contains">("prefix");
  const [cmdCooldown, setCmdCooldown] = useState(0);
  const [cmdAllowedRoles, setCmdAllowedRoles] = useState<string[]>([]);
  const [cmdAllowedChannels, setCmdAllowedChannels] = useState<string[]>([]);
  const [cmdActions, setCmdActions] = useState<WorkflowAction[]>([]);
  const [cmdSubmitting, setCmdSubmitting] = useState(false);

  // Dialog states - Dropdown
  const [ddDialogOpen, setDdDialogOpen] = useState(false);
  const [editingDd, setEditingDd] = useState<DropdownDefinition | null>(null);
  const [ddTitle, setDdTitle] = useState("");
  const [ddPlaceholder, setDdPlaceholder] = useState("Select an option...");
  const [ddMinValues, setDdMinValues] = useState(1);
  const [ddMaxValues, setDdMaxValues] = useState(1);
  const [ddContent, setDdContent] = useState("");
  const [ddEmbedTitle, setDdEmbedTitle] = useState("");
  const [ddEmbedDesc, setDdEmbedDesc] = useState("");
  const [ddEmbedColor, setDdEmbedColor] = useState("#5865F2");
  const [ddOptions, setDdOptions] = useState<DropdownOption[]>([]);
  const [ddSubmitting, setDdSubmitting] = useState(false);

  // Publish Dialog state
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [targetDdToPublish, setTargetDdToPublish] = useState<DropdownDefinition | null>(null);
  const [publishChannelId, setPublishChannelId] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [stateRes, cfgRes, chanRes, roleRes, cmdsRes, ddsRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/modules/custom_commands/state`),
        fetch(`/api/internal/guilds/${guildId}/modules/custom_commands/config`),
        fetch(`/api/internal/guilds/${guildId}/channels`),
        fetch(`/api/internal/guilds/${guildId}/roles`),
        fetch(`/api/internal/guilds/${guildId}/custom-commands`),
        fetch(`/api/internal/guilds/${guildId}/custom-dropdowns`),
      ]);

      if (stateRes.ok) {
        const stateData = await stateRes.json();
        setModuleEnabled(Boolean(stateData.enabled));
      }

      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        setPrefix(cfgData.prefix || "!");
        setDeleteTriggerDefault(Boolean(cfgData.delete_trigger_default));
      }

      if (chanRes.ok) {
        const chanData = await chanRes.json();
        setChannels(Array.isArray(chanData) ? chanData : chanData.channels || []);
      }

      if (roleRes.ok) {
        const roleData = await roleRes.json();
        setRoles(Array.isArray(roleData) ? roleData : roleData.roles || []);
      }

      if (cmdsRes.ok) {
        const cmdsData = await cmdsRes.json();
        setCommands(Array.isArray(cmdsData) ? cmdsData : []);
      }

      if (ddsRes.ok) {
        const ddsData = await ddsRes.json();
        setDropdowns(Array.isArray(ddsData) ? ddsData : []);
      }
    } catch {
      toast.error("Failed to load custom commands configuration.");
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toggle Module
  const handleToggleModule = async (checked: boolean) => {
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/custom_commands/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: checked }),
      });
      if (res.ok) {
        setModuleEnabled(checked);
        toast.success(checked ? "Custom Commands module enabled." : "Custom Commands module disabled.");
      } else {
        toast.error("Failed to update module state.");
      }
    } catch {
      toast.error("Failed to update module state.");
    }
  };

  // Save Module Config
  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/modules/custom_commands/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          delete_trigger_default: deleteTriggerDefault,
        }),
      });
      if (res.ok) {
        toast.success("Settings saved successfully.");
      } else {
        toast.error("Failed to save settings.");
      }
    } catch {
      toast.error("Failed to save settings.");
    } finally {
      setSavingConfig(false);
    }
  };

  // Open Command Editor
  const handleOpenCommandDialog = (cmd?: CommandDefinition) => {
    if (cmd) {
      setEditingCmd(cmd);
      setCmdName(cmd.name);
      setCmdAliases((cmd.aliases || []).join(", "));
      setCmdDesc(cmd.description || "");
      setCmdTriggerType(cmd.trigger_type || "prefix");
      setCmdCooldown(cmd.cooldown_seconds || 0);
      setCmdAllowedRoles(cmd.allowed_roles || []);
      setCmdAllowedChannels(cmd.allowed_channels || []);
      setCmdActions(cmd.actions || []);
    } else {
      setEditingCmd(null);
      setCmdName("");
      setCmdAliases("");
      setCmdDesc("");
      setCmdTriggerType("prefix");
      setCmdCooldown(0);
      setCmdAllowedRoles([]);
      setCmdAllowedChannels([]);
      setCmdActions([{ type: "send_message", content: "Hello {user}!" }]);
    }
    setCmdDialogOpen(true);
  };

  // Save Command
  const handleSaveCommand = async () => {
    const trimmed = cmdName.trim().toLowerCase();
    if (!trimmed) {
      toast.error("Please enter a command trigger name.");
      return;
    }

    setCmdSubmitting(true);
    const payload = {
      name: trimmed,
      aliases: cmdAliases
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      description: cmdDesc.trim(),
      trigger_type: cmdTriggerType,
      cooldown_seconds: Number(cmdCooldown) || 0,
      allowed_roles: cmdAllowedRoles,
      allowed_channels: cmdAllowedChannels,
      enabled: editingCmd ? editingCmd.enabled : true,
      actions: cmdActions,
    };

    try {
      const url = editingCmd
        ? `/api/internal/guilds/${guildId}/custom-commands/${editingCmd.id}`
        : `/api/internal/guilds/${guildId}/custom-commands`;
      const method = editingCmd ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(editingCmd ? "Command updated." : "Command created.");
        setCmdDialogOpen(false);
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to save command.");
      }
    } catch {
      toast.error("Network error while saving command.");
    } finally {
      setCmdSubmitting(false);
    }
  };

  // Delete Command
  const handleDeleteCommand = async (id: string) => {
    if (!confirm("Are you sure you want to delete this command?")) return;
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/custom-commands/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Command deleted.");
        setCommands((prev) => prev.filter((c) => c.id !== id));
      } else {
        toast.error("Failed to delete command.");
      }
    } catch {
      toast.error("Network error.");
    }
  };

  // Toggle Command Enabled
  const handleToggleCommandEnabled = async (cmd: CommandDefinition) => {
    try {
      const updated = { ...cmd, enabled: !cmd.enabled };
      const res = await fetch(`/api/internal/guilds/${guildId}/custom-commands/${cmd.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setCommands((prev) => prev.map((c) => (c.id === cmd.id ? { ...c, enabled: !cmd.enabled } : c)));
        toast.success(`Command ${!cmd.enabled ? "enabled" : "disabled"}.`);
      }
    } catch {
      toast.error("Failed to toggle command.");
    }
  };

  // Open Dropdown Editor
  const handleOpenDropdownDialog = (dd?: DropdownDefinition) => {
    if (dd) {
      setEditingDd(dd);
      setDdTitle(dd.title);
      setDdPlaceholder(dd.placeholder || "Select an option...");
      setDdMinValues(dd.min_values || 1);
      setDdMaxValues(dd.max_values || 1);
      setDdContent(dd.panel_content || "");
      setDdEmbedTitle(dd.panel_embed?.title || "");
      setDdEmbedDesc(dd.panel_embed?.description || "");
      setDdEmbedColor(dd.panel_embed?.color || "#5865F2");
      setDdOptions(dd.options || []);
    } else {
      setEditingDd(null);
      setDdTitle("");
      setDdPlaceholder("Select an option...");
      setDdMinValues(1);
      setDdMaxValues(1);
      setDdContent("");
      setDdEmbedTitle("Server Roles");
      setDdEmbedDesc("Select an option from the menu below to get roles or notifications!");
      setDdEmbedColor("#5865F2");
      setDdOptions([
        {
          id: "opt_1",
          label: "Announcements Role",
          value: "announcements",
          description: "Get notified for major announcements",
          emoji: "🔔",
          actions: [{ type: "toggle_role", role_id: roles[0]?.id || "" }],
        },
      ]);
    }
    setDdDialogOpen(true);
  };

  // Save Dropdown
  const handleSaveDropdown = async () => {
    if (!ddTitle.trim()) {
      toast.error("Please enter a dropdown title.");
      return;
    }
    if (ddOptions.length === 0) {
      toast.error("Please add at least one option.");
      return;
    }

    setDdSubmitting(true);
    const payload = {
      title: ddTitle.trim(),
      placeholder: ddPlaceholder.trim(),
      min_values: Number(ddMinValues) || 1,
      max_values: Number(ddMaxValues) || 1,
      panel_content: ddContent.trim() || null,
      panel_embed: ddEmbedTitle || ddEmbedDesc ? {
        title: ddEmbedTitle.trim(),
        description: ddEmbedDesc.trim(),
        color: ddEmbedColor.trim(),
      } : null,
      options: ddOptions,
      enabled: editingDd ? editingDd.enabled : true,
    };

    try {
      const url = editingDd
        ? `/api/internal/guilds/${guildId}/custom-dropdowns/${editingDd.id}`
        : `/api/internal/guilds/${guildId}/custom-dropdowns`;
      const method = editingDd ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(editingDd ? "Dropdown menu updated." : "Dropdown menu created.");
        setDdDialogOpen(false);
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to save dropdown menu.");
      }
    } catch {
      toast.error("Network error while saving dropdown menu.");
    } finally {
      setDdSubmitting(false);
    }
  };

  // Delete Dropdown
  const handleDeleteDropdown = async (id: string) => {
    if (!confirm("Are you sure you want to delete this dropdown menu?")) return;
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/custom-dropdowns/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Dropdown menu deleted.");
        setDropdowns((prev) => prev.filter((d) => d.id !== id));
      } else {
        toast.error("Failed to delete dropdown menu.");
      }
    } catch {
      toast.error("Network error.");
    }
  };

  // Open Publish Modal
  const handleOpenPublishModal = (dd: DropdownDefinition) => {
    setTargetDdToPublish(dd);
    setPublishChannelId(dd.channel_id || channels.find((c) => c.type === "text")?.id || "");
    setPublishDialogOpen(true);
  };

  // Execute Publish
  const handlePublishDropdown = async () => {
    if (!targetDdToPublish || !publishChannelId) {
      toast.error("Please select a target channel.");
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch(
        `/api/internal/guilds/${guildId}/custom-dropdowns/${targetDdToPublish.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: publishChannelId }),
        }
      );

      if (res.ok) {
        toast.success("Dropdown panel published successfully to channel!");
        setPublishDialogOpen(false);
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || "Failed to publish dropdown.");
      }
    } catch {
      toast.error("Network error while publishing dropdown.");
    } finally {
      setPublishing(false);
    }
  };

  // Filtered lists
  const filteredCommands = useMemo(() => {
    if (!cmdSearch.trim()) return commands;
    const q = cmdSearch.toLowerCase();
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.aliases || []).some((a) => a.toLowerCase().includes(q)) ||
        (c.description || "").toLowerCase().includes(q)
    );
  }, [commands, cmdSearch]);

  const filteredDropdowns = useMemo(() => {
    if (!ddSearch.trim()) return dropdowns;
    const q = ddSearch.toLowerCase();
    return dropdowns.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.placeholder || "").toLowerCase().includes(q)
    );
  }, [dropdowns, ddSearch]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading custom commands and workflows...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Global Module Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-6 rounded-xl border">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Custom Commands & Menus</h1>
            <Badge variant={moduleEnabled ? "default" : "secondary"}>
              {moduleEnabled ? "Active" : "Disabled"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Build interactive chat commands and persistent dropdown select menus powered by multi-step workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Label htmlFor="module-toggle" className="text-sm font-medium">
            Enable Module
          </Label>
          <Switch
            id="module-toggle"
            checked={moduleEnabled}
            onCheckedChange={handleToggleModule}
          />
        </div>
      </div>

      {/* Global Config Card */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            General Command Settings
          </CardTitle>
          <CardDescription>
            Configure default prefix and trigger options for custom commands in this server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="global-prefix">Command Prefix</Label>
              <Input
                id="global-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="!"
                className="max-w-xs font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Prefix used to trigger custom commands (e.g. {prefix}rules, {prefix}roles).
              </p>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg max-w-md">
              <div className="space-y-0.5">
                <Label className="text-sm">Delete Trigger Message</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically delete user message after invoking command.
                </p>
              </div>
              <Switch
                checked={deleteTriggerDefault}
                onCheckedChange={setDeleteTriggerDefault}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="py-3 bg-muted/20 border-t flex justify-end">
          <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}>
            {savingConfig ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Settings
          </Button>
        </CardFooter>
      </Card>

      {/* Main Tabs: Commands vs Dropdowns */}
      <Tabs defaultValue="commands" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="commands" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Custom Commands ({commands.length})
          </TabsTrigger>
          <TabsTrigger value="dropdowns" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Select Menus ({dropdowns.length})
          </TabsTrigger>
        </TabsList>

        {/* ----------------- TAB 1: CUSTOM COMMANDS ----------------- */}
        <TabsContent value="commands" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <Input
              placeholder="Search commands by name, alias, or description..."
              value={cmdSearch}
              onChange={(e) => setCmdSearch(e.target.value)}
              className="max-w-md"
            />
            <Button onClick={() => handleOpenCommandDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Custom Command
            </Button>
          </div>

          {filteredCommands.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent className="space-y-3">
                <Zap className="h-10 w-10 text-muted-foreground mx-auto" />
                <h3 className="font-semibold text-lg">No custom commands yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Create custom commands that respond with embeds, assign roles, or execute multi-action workflows.
                </p>
                <Button onClick={() => handleOpenCommandDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Command
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCommands.map((cmd) => (
                <Card key={cmd.id} className="relative group flex flex-col justify-between border">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-base font-mono">
                            {cmd.trigger_type === "prefix" ? `${prefix}${cmd.name}` : cmd.name}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {cmd.trigger_type}
                          </Badge>
                          {cmd.cooldown_seconds ? (
                            <Badge variant="secondary" className="text-xs flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {cmd.cooldown_seconds}s
                            </Badge>
                          ) : null}
                        </div>
                        {cmd.aliases && cmd.aliases.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            Aliases: {cmd.aliases.map((a) => (cmd.trigger_type === "prefix" ? `${prefix}${a}` : a)).join(", ")}
                          </p>
                        )}
                      </div>
                      <Switch
                        checked={cmd.enabled}
                        onCheckedChange={() => handleToggleCommandEnabled(cmd)}
                      />
                    </div>
                    {cmd.description && (
                      <CardDescription className="line-clamp-2 mt-1">
                        {cmd.description}
                      </CardDescription>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3">
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Workflow Pipeline:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(cmd.actions || []).map((act, i) => (
                          <Badge key={i} variant="secondary" className="text-xs py-0.5">
                            {ACTION_TYPE_LABELS[act.type]?.icon || "⚡"} {ACTION_TYPE_LABELS[act.type]?.label || act.type}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {(cmd.allowed_roles && cmd.allowed_roles.length > 0) ||
                    (cmd.allowed_channels && cmd.allowed_channels.length > 0) ? (
                      <div className="text-xs text-muted-foreground flex gap-4 pt-1">
                        {cmd.allowed_roles && cmd.allowed_roles.length > 0 && (
                          <span>Roles: {cmd.allowed_roles.length} restricted</span>
                        )}
                        {cmd.allowed_channels && cmd.allowed_channels.length > 0 && (
                          <span>Channels: {cmd.allowed_channels.length} restricted</span>
                        )}
                      </div>
                    ) : null}
                  </CardContent>

                  <CardFooter className="pt-2 border-t flex justify-end gap-2 bg-muted/10">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenCommandDialog(cmd)}>
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteCommand(cmd.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ----------------- TAB 2: INTERACTIVE SELECT MENUS ----------------- */}
        <TabsContent value="dropdowns" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <Input
              placeholder="Search dropdown menus by title..."
              value={ddSearch}
              onChange={(e) => setDdSearch(e.target.value)}
              className="max-w-md"
            />
            <Button onClick={() => handleOpenDropdownDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              New Select Menu
            </Button>
          </div>

          {filteredDropdowns.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent className="space-y-3">
                <Layers className="h-10 w-10 text-muted-foreground mx-auto" />
                <h3 className="font-semibold text-lg">No interactive select menus</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Create dropdown select menus that allow members to assign roles, trigger DMs, or receive custom replies.
                </p>
                <Button onClick={() => handleOpenDropdownDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Menu
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredDropdowns.map((dd) => (
                <Card key={dd.id} className="flex flex-col justify-between border">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg font-bold">{dd.title}</CardTitle>
                        <CardDescription className="text-xs mt-1">
                          Placeholder: &quot;{dd.placeholder}&quot; • Min: {dd.min_values} / Max: {dd.max_values}
                        </CardDescription>
                      </div>
                      {dd.message_id ? (
                        <Badge variant="default" className="bg-emerald-600 text-xs">
                          Published
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Draft
                        </Badge>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 pb-3">
                    <div>
                      <span className="text-xs font-medium text-muted-foreground">Options ({dd.options?.length || 0}):</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {(dd.options || []).map((opt, i) => (
                          <Badge key={i} variant="secondary" className="text-xs py-0.5">
                            {opt.emoji ? `${opt.emoji} ` : ""}{opt.label}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {dd.channel_id && (
                      <p className="text-xs text-muted-foreground">
                        Channel: #{channels.find((c) => c.id === dd.channel_id)?.name || dd.channel_id}
                      </p>
                    )}
                  </CardContent>

                  <CardFooter className="pt-2 border-t flex items-center justify-between gap-2 bg-muted/10">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-primary hover:text-primary"
                      onClick={() => handleOpenPublishModal(dd)}
                    >
                      <Send className="h-4 w-4 mr-1" />
                      {dd.message_id ? "Re-publish Panel" : "Publish to Channel"}
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenDropdownDialog(dd)}>
                        <Edit2 className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteDropdown(dd.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ----------------- MODAL: COMMAND BUILDER ----------------- */}
      <Dialog open={cmdDialogOpen} onOpenChange={setCmdDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 overflow-hidden border border-border/80 shadow-2xl bg-card">
          <DialogHeader className="p-6 pb-4 border-b border-border/60 shrink-0">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {editingCmd ? "Edit Custom Command" : "Create Custom Command"}
            </DialogTitle>
            <DialogDescription>
              Configure the trigger condition, permissions, and multi-step action workflow for this command.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Trigger info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cmd-name">Trigger Name *</Label>
                <div className="flex items-center">
                  {cmdTriggerType === "prefix" && (
                    <span className="bg-muted px-3 py-2 border border-r-0 rounded-l-md font-mono text-sm">
                      {prefix}
                    </span>
                  )}
                  <Input
                    id="cmd-name"
                    value={cmdName}
                    onChange={(e) => setCmdName(e.target.value)}
                    placeholder="help"
                    className={cmdTriggerType === "prefix" ? "rounded-l-none font-mono" : "font-mono"}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cmd-type">Trigger Type</Label>
                <Select
                  value={cmdTriggerType}
                  onValueChange={(val: string | null) => {
                    if (val) setCmdTriggerType(val as "prefix" | "exact" | "contains");
                  }}
                >
                  <SelectTrigger id="cmd-type" className="w-full h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-64">
                    <SelectItem value="prefix">Prefix Command ({prefix}cmd)</SelectItem>
                    <SelectItem value="exact">Exact Message Match</SelectItem>
                    <SelectItem value="contains">Message Contains Word</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cmd-aliases">Aliases (comma-separated)</Label>
                <Input
                  id="cmd-aliases"
                  value={cmdAliases}
                  onChange={(e) => setCmdAliases(e.target.value)}
                  placeholder="rules, info, guide"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cmd-cooldown">Cooldown (seconds)</Label>
                <Input
                  id="cmd-cooldown"
                  type="number"
                  min={0}
                  value={cmdCooldown}
                  onChange={(e) => setCmdCooldown(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cmd-desc">Description</Label>
              <Input
                id="cmd-desc"
                value={cmdDesc}
                onChange={(e) => setCmdDesc(e.target.value)}
                placeholder="Show server guidelines and information"
              />
            </div>

            {/* Permissions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label>Allowed Roles (leave empty for everyone)</Label>
                <SelectSearchable
                  options={roles.map((r) => ({ value: r.id, label: `@${r.name}` }))}
                  value={cmdAllowedRoles[0] || ""}
                  onValueChange={(id) => {
                    if (id && !cmdAllowedRoles.includes(id)) {
                      setCmdAllowedRoles([...cmdAllowedRoles, id]);
                    }
                  }}
                  placeholder="Add allowed role..."
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {cmdAllowedRoles.map((rId) => (
                    <Badge key={rId} variant="secondary" className="text-xs">
                      @{roles.find((r) => r.id === rId)?.name || rId}
                      <button
                        onClick={() => setCmdAllowedRoles(cmdAllowedRoles.filter((id) => id !== rId))}
                        className="ml-1 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Allowed Channels (leave empty for all)</Label>
                <SelectSearchable
                  options={channels
                    .filter((c) => c.type === "text" || c.type === "announcement")
                    .map((c) => ({ value: c.id, label: `#${c.name}` }))}
                  value={cmdAllowedChannels[0] || ""}
                  onValueChange={(id) => {
                    if (id && !cmdAllowedChannels.includes(id)) {
                      setCmdAllowedChannels([...cmdAllowedChannels, id]);
                    }
                  }}
                  placeholder="Add allowed channel..."
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {cmdAllowedChannels.map((cId) => (
                    <Badge key={cId} variant="secondary" className="text-xs">
                      #{channels.find((c) => c.id === cId)?.name || cId}
                      <button
                        onClick={() => setCmdAllowedChannels(cmdAllowedChannels.filter((id) => id !== cId))}
                        className="ml-1 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Workflow Pipeline */}
            <div className="space-y-3 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Action Workflow Steps
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    These actions execute sequentially when the command is triggered.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCmdActions([...cmdActions, { type: "send_message", content: "" }])
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Action
                </Button>
              </div>

              {/* Template variables reference */}
              <div className="p-2.5 bg-muted/40 rounded-lg text-xs space-y-1">
                <span className="font-semibold text-muted-foreground">Available Placeholders:</span>
                <div className="flex flex-wrap gap-1 pt-1">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <code
                      key={v.tag}
                      className="bg-background px-1.5 py-0.5 rounded border cursor-pointer hover:bg-primary/10"
                      title={v.desc}
                      onClick={() => {
                        navigator.clipboard.writeText(v.tag);
                        toast.success(`Copied ${v.tag}`);
                      }}
                    >
                      {v.tag}
                    </code>
                  ))}
                </div>
              </div>

              {/* Actions list */}
              <div className="space-y-3">
                {cmdActions.map((act, idx) => (
                  <ActionCard
                    key={idx}
                    action={act}
                    index={idx}
                    total={cmdActions.length}
                    isDropdownOption={false}
                    channels={channels}
                    roles={roles}
                    onChange={(updated) => {
                      const copy = [...cmdActions];
                      copy[idx] = updated;
                      setCmdActions(copy);
                    }}
                    onRemove={() => setCmdActions(cmdActions.filter((_, i) => i !== idx))}
                    onMoveUp={
                      idx > 0
                        ? () => {
                            const copy = [...cmdActions];
                            const temp = copy[idx - 1];
                            copy[idx - 1] = copy[idx];
                            copy[idx] = temp;
                            setCmdActions(copy);
                          }
                        : undefined
                    }
                    onMoveDown={
                      idx < cmdActions.length - 1
                        ? () => {
                            const copy = [...cmdActions];
                            const temp = copy[idx + 1];
                            copy[idx + 1] = copy[idx];
                            copy[idx] = temp;
                            setCmdActions(copy);
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 px-6 border-t border-border/60 bg-muted/20 shrink-0 flex items-center justify-between sm:justify-between w-full m-0">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span>{cmdActions.length} action(s) in workflow</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setCmdDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveCommand} disabled={cmdSubmitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {cmdSubmitting ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {editingCmd ? "Save Changes" : "Create Command"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------- MODAL: DROPDOWN MENU BUILDER ----------------- */}
      <Dialog open={ddDialogOpen} onOpenChange={setDdDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 overflow-hidden border border-border/80 shadow-2xl bg-card">
          <DialogHeader className="p-6 pb-4 border-b border-border/60 shrink-0">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              {editingDd ? "Edit Select Menu" : "Create Select Menu"}
            </DialogTitle>
            <DialogDescription>
              Configure the panel embed and options with dynamic action workflows.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dd-title">Menu Title *</Label>
                <Input
                  id="dd-title"
                  value={ddTitle}
                  onChange={(e) => setDdTitle(e.target.value)}
                  placeholder="Role Selection"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dd-placeholder">Menu Placeholder</Label>
                <Input
                  id="dd-placeholder"
                  value={ddPlaceholder}
                  onChange={(e) => setDdPlaceholder(e.target.value)}
                  placeholder="Choose an option..."
                />
              </div>
            </div>

            {/* Selections limits */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dd-min">Min Selections</Label>
                <Input
                  id="dd-min"
                  type="number"
                  min={1}
                  max={25}
                  value={ddMinValues}
                  onChange={(e) => setDdMinValues(Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dd-max">Max Selections</Label>
                <Input
                  id="dd-max"
                  type="number"
                  min={1}
                  max={25}
                  value={ddMaxValues}
                  onChange={(e) => setDdMaxValues(Number(e.target.value) || 1)}
                />
              </div>
            </div>

            {/* Embed Panel Appearance */}
            <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
              <h4 className="text-sm font-semibold">Panel Message & Embed</h4>
              <div className="space-y-2">
                <Label className="text-xs">Plain Content (above embed)</Label>
                <Input
                  value={ddContent}
                  onChange={(e) => setDdContent(e.target.value)}
                  placeholder="Optional message text"
                  className="text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Embed Title</Label>
                  <Input
                    value={ddEmbedTitle}
                    onChange={(e) => setDdEmbedTitle(e.target.value)}
                    placeholder="Pick your roles!"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Color (Hex)</Label>
                  <Input
                    value={ddEmbedColor}
                    onChange={(e) => setDdEmbedColor(e.target.value)}
                    placeholder="#5865F2"
                    className="text-xs font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Embed Description</Label>
                <Textarea
                  value={ddEmbedDesc}
                  onChange={(e) => setDdEmbedDesc(e.target.value)}
                  placeholder="Select which notifications or roles you would like to have."
                  className="text-xs min-h-[60px]"
                />
              </div>
            </div>

            {/* Options Management */}
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold">Menu Options (max 25)</h4>
                  <p className="text-xs text-muted-foreground">
                    Define what options members see and what action each option triggers.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newId = `opt_${Date.now()}`;
                    setDdOptions([
                      ...ddOptions,
                      {
                        id: newId,
                        label: `Option ${ddOptions.length + 1}`,
                        value: newId,
                        description: "",
                        emoji: "",
                        actions: [{ type: "toggle_role", role_id: roles[0]?.id || "" }],
                      },
                    ]);
                  }}
                  disabled={ddOptions.length >= 25}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Option
                </Button>
              </div>

              <div className="space-y-3">
                {ddOptions.map((opt, oIdx) => (
                  <Card key={opt.id || oIdx} className="p-3 border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-primary">Option #{oIdx + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive"
                        onClick={() => setDdOptions(ddOptions.filter((_, i) => i !== oIdx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-2">
                        <Label className="text-xs">Emoji</Label>
                        <Input
                          placeholder="🎮"
                          value={opt.emoji || ""}
                          onChange={(e) => {
                            const copy = [...ddOptions];
                            copy[oIdx] = { ...copy[oIdx], emoji: e.target.value };
                            setDdOptions(copy);
                          }}
                          className="text-xs text-center"
                        />
                      </div>
                      <div className="col-span-5">
                        <Label className="text-xs">Label *</Label>
                        <Input
                          placeholder="Gaming"
                          value={opt.label || ""}
                          onChange={(e) => {
                            const copy = [...ddOptions];
                            copy[oIdx] = { ...copy[oIdx], label: e.target.value };
                            setDdOptions(copy);
                          }}
                          className="text-xs"
                        />
                      </div>
                      <div className="col-span-5">
                        <Label className="text-xs">Description</Label>
                        <Input
                          placeholder="Optional helper text"
                          value={opt.description || ""}
                          onChange={(e) => {
                            const copy = [...ddOptions];
                            copy[oIdx] = { ...copy[oIdx], description: e.target.value };
                            setDdOptions(copy);
                          }}
                          className="text-xs"
                        />
                      </div>
                    </div>

                    {/* Option Actions Pipeline */}
                    <div className="p-3 bg-muted/20 rounded-lg border border-border/70 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-xs font-semibold flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            Option Actions Pipeline ({(opt.actions || []).length})
                          </Label>
                          <p className="text-[11px] text-muted-foreground">
                            Executed when a server member selects this option from the dropdown menu.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => {
                            const copy = [...ddOptions];
                            const currentActs = copy[oIdx].actions || [];
                            copy[oIdx].actions = [
                              ...currentActs,
                              { type: "toggle_role", role_id: roles[0]?.id || "" },
                            ];
                            setDdOptions(copy);
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Action
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {(opt.actions && opt.actions.length > 0
                          ? opt.actions
                          : [{ type: "toggle_role", role_id: roles[0]?.id || "" }]
                        ).map((act, aIdx) => (
                          <ActionCard
                            key={aIdx}
                            action={act}
                            index={aIdx}
                            total={(opt.actions || []).length}
                            isDropdownOption={true}
                            channels={channels}
                            roles={roles}
                            onChange={(updated) => {
                              const copy = [...ddOptions];
                              const acts = [...(copy[oIdx].actions || [{ type: "toggle_role" }])];
                              acts[aIdx] = updated;
                              copy[oIdx].actions = acts;
                              setDdOptions(copy);
                            }}
                            onRemove={() => {
                              const copy = [...ddOptions];
                              const acts = (copy[oIdx].actions || []).filter((_, i) => i !== aIdx);
                              copy[oIdx].actions =
                                acts.length > 0
                                  ? acts
                                  : [{ type: "toggle_role", role_id: roles[0]?.id || "" }];
                              setDdOptions(copy);
                            }}
                            onMoveUp={
                              aIdx > 0
                                ? () => {
                                    const copy = [...ddOptions];
                                    const acts = [...(copy[oIdx].actions || [])];
                                    const temp = acts[aIdx - 1];
                                    acts[aIdx - 1] = acts[aIdx];
                                    acts[aIdx] = temp;
                                    copy[oIdx].actions = acts;
                                    setDdOptions(copy);
                                  }
                                : undefined
                            }
                            onMoveDown={
                              aIdx < (opt.actions || []).length - 1
                                ? () => {
                                    const copy = [...ddOptions];
                                    const acts = [...(copy[oIdx].actions || [])];
                                    const temp = acts[aIdx + 1];
                                    acts[aIdx + 1] = acts[aIdx];
                                    acts[aIdx] = temp;
                                    copy[oIdx].actions = acts;
                                    setDdOptions(copy);
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 px-6 border-t border-border/60 bg-muted/20 shrink-0 flex items-center justify-between sm:justify-between w-full m-0">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span>{ddOptions.length} option(s) configured (max 25)</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setDdDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveDropdown} disabled={ddSubmitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {ddSubmitting ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {editingDd ? "Save Changes" : "Create Select Menu"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------- MODAL: PUBLISH PANEL TO CHANNEL ----------------- */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="max-w-lg p-6 border border-border/80 shadow-2xl bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Publish Select Menu to Discord
            </DialogTitle>
            <DialogDescription>
              Choose the text channel where the bot will post this interactive panel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label>Target Channel</Label>
              <SelectSearchable
                options={channels
                  .filter((c) => c.type === "text" || c.type === "announcement")
                  .map((c) => ({ value: c.id, label: `#${c.name}` }))}
                value={publishChannelId}
                onValueChange={(id) => setPublishChannelId(id)}
                placeholder="Choose text channel..."
              />
            </div>

            <div className="p-3 bg-muted/30 rounded-lg text-xs space-y-1">
              <div className="font-semibold">Persistent Menu:</div>
              <p className="text-muted-foreground">
                The dropdown menu is permanent and will continue to respond automatically even after bot restarts.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePublishDropdown} disabled={publishing}>
              {publishing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publish Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
