"use client";

import * as React from "react";
import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Tags,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Edit2,
  AlertTriangle,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import {
  ReactionRoleMessage,
  reactionRoleMessageSchema,
} from "@/lib/modules/reaction-roles";
import { GuildChannel, GuildRole, GuildRolesResponse } from "@/lib/control-plane";
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
import { cn, stripEmojis } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { SelectSearchable } from "@/components/ui/select-searchable";
import { RetryButton } from "@/components/retry-button";
import {
  resolveChannelName,
  resolveRoleName,
} from "@/components/saved-state-strip";
import ReactionRolesLoading from "./loading";

interface ReactionRolesClientProps {
  guildId: string;
}

interface PairFormItem {
  id: string;
  emoji: string;
  label?: string;
  role_id: string | "";
}

const DEFAULT_EMOJIS = [
  "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟",
  "⭐", "🎮", "🔔", "📢", "💬", "🛡️", "👑", "🔥", "🚀", "💡",
];

const STYLE_OPTIONS = [
  { value: "reactions", label: "Reactions (Emoji reactions under message)" },
  { value: "buttons", label: "Buttons (Interactive Discord buttons)" },
  { value: "select", label: "Select Menu (Interactive role dropdown)" },
];

export function ReactionRolesClient({ guildId }: ReactionRolesClientProps) {
  const [messages, setMessages] = useState<ReactionRoleMessage[]>([]);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [botTopRolePos, setBotTopRolePos] = useState<number | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editor Dialog State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ReactionRoleMessage | null>(null);

  // Form Fields
  const [channelId, setChannelId] = useState<string>("");
  const [style, setStyle] = useState<"reactions" | "buttons" | "select">("reactions");
  const [content, setContent] = useState("");
  const [includeEmbed, setIncludeEmbed] = useState(false);
  const [embedTitle, setEmbedTitle] = useState("");
  const [embedDesc, setEmbedDesc] = useState("");
  const [embedColor, setEmbedColor] = useState("#5865F2");
  const [enabled, setEnabled] = useState(false);
  const [pairs, setPairs] = useState<PairFormItem[]>([
    { id: "1", emoji: "1️⃣", label: "", role_id: "" },
  ]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Delete Confirmation Dialog State
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<ReactionRoleMessage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Text-capable channels
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

  // Load server data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [messagesRes, channelsRes, rolesRes] = await Promise.all([
        fetch(`/api/internal/guilds/${guildId}/reaction-roles`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/channels`, { cache: "no-store" }),
        fetch(`/api/internal/guilds/${guildId}/roles`, { cache: "no-store" }),
      ]);

      if (!messagesRes.ok) {
        const errJson = await messagesRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to fetch reaction roles (${messagesRes.status})`);
      }
      if (!channelsRes.ok) {
        throw new Error(`Failed to fetch channels (${channelsRes.status})`);
      }
      if (!rolesRes.ok) {
        throw new Error(`Failed to fetch roles (${rolesRes.status})`);
      }

      const messagesData = await messagesRes.json();
      const channelsData = await channelsRes.json();
      const rolesData: GuildRolesResponse = await rolesRes.json();

      setMessages(messagesData.messages || []);
      setChannels(channelsData || []);
      setRoles(rolesData.roles || []);
      setBotTopRolePos(rolesData.bot_top_role_position ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load data from server";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Unsaved changes beforeunload guard
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

  // Open Editor to create
  const handleOpenCreate = () => {
    const defaultChannel = textChannels[0]?.id || "";
    setEditingMessage(null);
    setChannelId(defaultChannel);
    setStyle("reactions");
    setContent("React to this message to claim your roles!");
    setIncludeEmbed(false);
    setEmbedTitle("");
    setEmbedDesc("");
    setEmbedColor("#5865F2");
    setEnabled(true);
    setPairs([
      { id: Math.random().toString(), emoji: "1️⃣", label: "", role_id: "" },
    ]);
    setFieldErrors({});
    setIsDirty(false);
    setIsEditorOpen(true);
  };

  // Open Editor to edit
  const handleOpenEdit = (msg: ReactionRoleMessage) => {
    setEditingMessage(msg);
    setChannelId(String(msg.channel_id));
    setStyle(msg.style);
    setContent(msg.content || "");
    const hasEmb = Boolean(msg.embed && (msg.embed.title || msg.embed.description || msg.embed.color));
    setIncludeEmbed(hasEmb);
    setEmbedTitle(msg.embed?.title || "");
    setEmbedDesc(msg.embed?.description || "");
    setEmbedColor(msg.embed?.color || "#5865F2");
    setEnabled(msg.enabled);
    setPairs(
      msg.pairs.length > 0
        ? msg.pairs.map((p) => ({
            id: Math.random().toString(),
            emoji: p.emoji || "",
            label: p.label || "",
            role_id: p.role_id,
          }))
        : [{ id: Math.random().toString(), emoji: "1️⃣", label: "", role_id: "" }]
    );
    setFieldErrors({});
    setIsDirty(false);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    if (isDirty) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?"
      );
      if (!confirmDiscard) return;
    }
    setIsEditorOpen(false);
    setIsDirty(false);
  };

  // Add a pair row
  const handleAddPair = () => {
    const maxAllowed = style === "select" ? 25 : 20;
    if (pairs.length >= maxAllowed) {
      toast.error(`Maximum ${maxAllowed} pairs allowed for ${style} style.`);
      return;
    }
    setIsDirty(true);
    const defaultEmoji = DEFAULT_EMOJIS[pairs.length % DEFAULT_EMOJIS.length] || "⭐";
    setPairs((prev) => [
      ...prev,
      { id: Math.random().toString(), emoji: defaultEmoji, label: "", role_id: "" },
    ]);
  };

  // Remove a pair row
  const handleRemovePair = (index: number) => {
    if (pairs.length <= 1) {
      toast.error("At least one reaction role pair is required.");
      return;
    }
    setIsDirty(true);
    setPairs((prev) => prev.filter((_, i) => i !== index));
  };

  // Reorder pair up
  const handleMovePairUp = (index: number) => {
    if (index === 0) return;
    setIsDirty(true);
    setPairs((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  // Reorder pair down
  const handleMovePairDown = (index: number) => {
    if (index === pairs.length - 1) return;
    setIsDirty(true);
    setPairs((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  // Update pair field
  const handlePairChange = (index: number, field: "emoji" | "role_id" | "label", val: string) => {
    setIsDirty(true);
    setPairs((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  // Save / Publish
  const handleSave = async () => {
    setFieldErrors({});

    const pairsData = pairs.map((p, i) => ({
      emoji: style === "select" ? (p.emoji?.trim() || "") : p.emoji.trim(),
      label: p.label?.trim() || "",
      role_id: p.role_id || "",
      order: i,
    }));

    const embedPayload =
      includeEmbed && (embedTitle.trim() || embedDesc.trim() || embedColor)
        ? {
            title: embedTitle.trim() || null,
            description: embedDesc.trim() || null,
            color: embedColor || null,
          }
        : null;

    const payload = {
      channel_id: channelId,
      style,
      content: content.trim() || null,
      embed: embedPayload,
      enabled,
      pairs: pairsData,
    };

    // 1. Zod client validation
    const validationResult = reactionRoleMessageSchema.safeParse(payload);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.issues.forEach((issue) => {
        const path = issue.path.join(".");
        errors[path] = issue.message;
      });
      setFieldErrors(errors);
      toast.error(validationResult.error.issues[0]?.message || "Please resolve validation errors.");
      return;
    }

    // Additional check: every role_id selected
    const unselectedRoleIndex = pairs.findIndex((p) => !p.role_id);
    if (unselectedRoleIndex !== -1) {
      const path = `pairs[${unselectedRoleIndex}].role_id`;
      setFieldErrors((prev) => ({ ...prev, [path]: "Please select a role for this pair." }));
      toast.error(`Please select a role for pair ${unselectedRoleIndex + 1}.`);
      return;
    }

    setIsSaving(true);
    try {
      const isEditing = Boolean(editingMessage);
      const url = isEditing
        ? `/api/internal/guilds/${guildId}/reaction-roles/${editingMessage!.message_id}`
        : `/api/internal/guilds/${guildId}/reaction-roles`;
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 422 && Array.isArray(resData.details)) {
          const apiErrors: Record<string, string> = {};
          resData.details.forEach((d: { field?: string; message?: string } | string) => {
            if (typeof d === "object" && d.field && d.message) {
              apiErrors[d.field] = d.message;
            } else if (typeof d === "string") {
              apiErrors["general"] = d;
            }
          });
          setFieldErrors(apiErrors);
          const firstMsg =
            typeof resData.details[0] === "object"
              ? resData.details[0].message
              : resData.details[0];
          toast.error(firstMsg || "Validation failed on the bot control plane.");
        } else {
          toast.error(resData.error || resData.details || `Error ${res.status}: Failed to save`);
        }
        return;
      }

      toast.success(
        isEditing
          ? "Reaction role message updated successfully!"
          : "Reaction role message published to Discord!"
      );
      setIsDirty(false);
      setIsEditorOpen(false);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error while saving";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete message
  const handleDeleteConfirm = async () => {
    if (!messageToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/internal/guilds/${guildId}/reaction-roles/${messageToDelete.message_id}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to delete message (${res.status})`);
      }
      toast.success("Reaction role message deleted from Discord and database.");
      setDeleteDialogOpen(false);
      setMessageToDelete(null);
      if (isEditorOpen && editingMessage?.message_id === messageToDelete.message_id) {
        setIsEditorOpen(false);
        setIsDirty(false);
      }
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete message";
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // Memoized Live Preview state
  const livePreview = useMemo(() => {
    const validPairs = pairs.map((p, idx) => {
      const r = roles.find((role) => String(role.id) === String(p.role_id));
      return {
        emoji: p.emoji.trim() || String(idx + 1),
        label: p.label?.trim() || "",
        roleName: r ? r.name : "Select a role",
        roleColor: r?.color || null,
      };
    });

    return {
      content: content.trim(),
      embed:
        includeEmbed && (embedTitle.trim() || embedDesc.trim())
          ? {
              title: embedTitle.trim(),
              description: embedDesc.trim(),
              color: embedColor || "#5865f2",
            }
          : null,
      style,
      pairs: validPairs,
    };
  }, [content, includeEmbed, embedTitle, embedDesc, embedColor, style, pairs, roles]);

  const maxPairsAllowed = style === "select" ? 25 : 20;

  // Render Loading State
  if (isLoading) {
    return <ReactionRolesLoading />;
  }

  // Render Error State
  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reaction Roles</h1>
          <p className="text-sm text-muted-foreground">
            Allow members to assign themselves roles via reactions, buttons, or menus.
          </p>
        </div>

        <Card className="border-destructive/40 bg-destructive/5 max-w-2xl">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              <CardTitle className="text-destructive">Failed to Load Reaction Roles</CardTitle>
            </div>
            <CardDescription className="text-destructive/80">
              Unable to communicate with the bot control plane.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium text-foreground">{loadError}</p>
          </CardContent>
          <CardFooter className="flex items-center gap-3">
            <RetryButton onRetry={loadData} />
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Reaction Roles</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure automated role assignment via Discord reactions, buttons, or select dropdowns.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2 shrink-0">
          <Plus className="size-4" />
          <span>Create Reaction Role</span>
        </Button>
      </div>

      {/* Empty State */}
      {messages.length === 0 ? (
        <Card className="border-dashed border-2 border-border/80 bg-muted/10 p-8 text-center">
          <div className="flex flex-col items-center justify-center space-y-4 max-w-md mx-auto">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Tags className="size-7 text-primary" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-semibold text-lg">No reaction roles configured</h3>
              <p className="text-sm text-muted-foreground">
                Give your community an easy way to pick their notification, game, or vanity roles
                directly within Discord channels.
              </p>
            </div>
            <Button onClick={handleOpenCreate} className="gap-2">
              <Plus className="size-4" />
              <span>Create your first reaction role</span>
            </Button>
          </div>
        </Card>
      ) : (
        /* Messages Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {messages.map((msg) => {
            return (
              <div
                key={msg.message_id}
                className="rounded-lg border border-border/80 bg-card p-4 flex flex-col justify-between space-y-4 hover:border-border transition-colors shadow-2xs"
              >
                {/* Card Header */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-mono text-primary font-medium min-w-0">
                      <MessageSquare className="size-3.5 shrink-0" />
                      <span className="truncate">{resolveChannelName(msg.channel_id, channels, "channel")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="text-[10px] font-mono capitalize px-1.5 py-0.2 bg-muted/30">
                        {msg.style}
                      </Badge>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-mono border ${
                          msg.enabled
                            ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                            : "border-border/60 text-muted-foreground bg-muted/20"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            msg.enabled ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                          }`}
                        />
                        <span>{msg.enabled ? "Active" : "Disabled"}</span>
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm text-foreground tracking-tight line-clamp-1">
                      {msg.embed?.title || (msg.content ? msg.content.slice(0, 45) : `Message ${msg.message_id}`)}
                    </h3>
                    <p className="font-mono text-[10px] text-muted-foreground/70 truncate mt-0.5">
                      ID: {msg.message_id}
                    </p>
                  </div>
                </div>

                {/* Card Body */}
                <div className="space-y-3 flex-1">
                  {msg.content && (
                    <p className="text-xs text-muted-foreground line-clamp-2 bg-muted/20 border-l-2 border-primary/40 pl-2.5 py-1 rounded-r font-sans">
                      {msg.content}
                    </p>
                  )}

                  {/* Mapped Roles (Strictly Zero Emojis) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                      <span>MAPPED ROLES ({msg.pairs?.length || 0})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.pairs?.slice(0, 6).map((p, idx) => {
                        const roleNode = resolveRoleName(p.role_id, roles);
                        // Sanitize all emojis thoroughly
                        const cleanTag = stripEmojis(p.emoji);

                        return (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 bg-muted/30 text-xs px-2 py-1 rounded-[4px] border border-border/60 text-[11px]"
                          >
                            {cleanTag ? (
                              <span className="font-mono text-[10px] font-semibold text-primary">
                                {cleanTag}
                              </span>
                            ) : (
                              <Tags className="size-3 text-primary shrink-0" />
                            )}
                            <span className="truncate max-w-[120px] text-foreground font-medium">
                              {roleNode}
                            </span>
                          </span>
                        );
                      })}
                      {(msg.pairs?.length || 0) > 6 && (
                        <span className="text-[11px] font-mono text-muted-foreground self-center px-1">
                          +{msg.pairs.length - 6} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-2.5 border-t border-border/60 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground/80">
                    {msg.pairs?.length || 0} pairs
                  </span>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEdit(msg)}
                      className="h-7 px-2.5 text-xs gap-1 border-border/70 hover:border-border"
                    >
                      <Edit2 className="size-3" />
                      <span>Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMessageToDelete(msg);
                        setDeleteDialogOpen(true);
                      }}
                      className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10 gap-1"
                    >
                      <Trash2 className="size-3" />
                      <span>Delete</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={isEditorOpen} onOpenChange={(open) => (!open ? handleCloseEditor() : null)}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl">
                  {editingMessage ? "Edit Reaction Role Message" : "Create Reaction Role Message"}
                </DialogTitle>
                {isDirty && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[10px]">
                    ● Unsaved changes
                  </Badge>
                )}
              </div>
            </div>
            <DialogDescription>
              Deploy a customizable message to Discord with interactive reaction, button, or menu role assignments.
            </DialogDescription>
          </DialogHeader>

          {/* Form and Preview Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            {/* Left: Configuration Form (7 cols) */}
            <div className="lg:col-span-7 space-y-5">
              {/* Channel and Style */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Channel Select */}
                <div className="space-y-1.5">
                  <Label htmlFor="rr-channel" className="text-xs font-semibold">
                    Discord Channel <span className="text-destructive">*</span>
                  </Label>
                  <SelectSearchable
                    id="rr-channel"
                    value={channelId || null}
                    onValueChange={(val) => {
                      setIsDirty(true);
                      setChannelId(val);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.channel_id;
                        return next;
                      });
                    }}
                    options={textChannels.map((c) => ({
                      value: String(c.id),
                      label: `#${c.name} (${c.type})`,
                    }))}
                    placeholder={
                      textChannels.length === 0
                        ? "No text channels available"
                        : "Select a channel..."
                    }
                    searchPlaceholder="Search text channels..."
                    disabled={textChannels.length === 0}
                    aria-invalid={!!fieldErrors["channel_id"]}
                  />
                  {fieldErrors["channel_id"] && (
                    <p className="text-xs text-destructive">{fieldErrors["channel_id"]}</p>
                  )}
                </div>

                {/* Style Select */}
                <div className="space-y-1.5">
                  <Label htmlFor="rr-style" className="text-xs font-semibold">
                    Interaction Style <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={style}
                    onValueChange={(val) => {
                      if (val) {
                        setIsDirty(true);
                        setStyle(val as "reactions" | "buttons" | "select");
                      }
                    }}
                    items={STYLE_OPTIONS}
                  >
                    <SelectTrigger id="rr-style" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {style === "reactions" && "Members react with Discord emojis to toggle roles."}
                    {style === "buttons" && "Members click interactive buttons to toggle roles."}
                    {style === "select" && "Members pick a single role from an interactive dropdown menu."}
                  </p>
                </div>
              </div>

              {/* Message Content */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="rr-content" className="text-xs font-semibold">
                    Message Content (Markdown)
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {content.length}/2000
                  </span>
                </div>
                <Textarea
                  id="rr-content"
                  rows={3}
                  placeholder="e.g. Choose your roles below to unlock specific channel categories!"
                  value={content}
                  onChange={(e) => {
                    setIsDirty(true);
                    setContent(e.target.value);
                  }}
                  className="resize-y text-sm font-sans"
                />
                {fieldErrors["content"] && (
                  <p className="text-xs text-destructive">{fieldErrors["content"]}</p>
                )}
              </div>

              {/* Embed Toggle & Fields */}
              <div className="rounded-lg border border-border/70 p-4 space-y-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-semibold">Attach Discord Embed</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Display styled card with colored side bar, title, and description.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={includeEmbed}
                    onChange={(e) => {
                      setIsDirty(true);
                      setIncludeEmbed(e.target.checked);
                    }}
                    className="size-4 rounded accent-primary cursor-pointer"
                  />
                </div>

                {includeEmbed && (
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1">
                        <Label htmlFor="embed-title" className="text-xs">
                          Embed Title
                        </Label>
                        <Input
                          id="embed-title"
                          placeholder="e.g. Role Selection Hub"
                          value={embedTitle}
                          onChange={(e) => {
                            setIsDirty(true);
                            setEmbedTitle(e.target.value);
                          }}
                          className="h-8 text-xs"
                        />
                        {fieldErrors["embed.title"] && (
                          <p className="text-xs text-destructive">{fieldErrors["embed.title"]}</p>
                        )}
                      </div>

                      {/* Color Picker */}
                      <div className="space-y-1">
                        <Label htmlFor="embed-color" className="text-xs">
                          Color (Hex)
                        </Label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={embedColor.startsWith("#") ? embedColor : `#${embedColor}`}
                            onChange={(e) => {
                              setIsDirty(true);
                              setEmbedColor(e.target.value.toUpperCase());
                            }}
                            className="size-8 rounded cursor-pointer border border-input p-0 bg-transparent shrink-0"
                          />
                          <Input
                            id="embed-color"
                            value={embedColor}
                            placeholder="#5865F2"
                            onChange={(e) => {
                              setIsDirty(true);
                              setEmbedColor(e.target.value);
                            }}
                            className="h-8 text-xs font-mono"
                          />
                        </div>
                        {fieldErrors["embed.color"] && (
                          <p className="text-xs text-destructive">{fieldErrors["embed.color"]}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="embed-desc" className="text-xs">
                        Embed Description
                      </Label>
                      <Textarea
                        id="embed-desc"
                        rows={2}
                        placeholder="e.g. Select the roles that best represent your interests."
                        value={embedDesc}
                        onChange={(e) => {
                          setIsDirty(true);
                          setEmbedDesc(e.target.value);
                        }}
                        className="text-xs"
                      />
                      {fieldErrors["embed.description"] && (
                        <p className="text-xs text-destructive">{fieldErrors["embed.description"]}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Pairs Editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-semibold">
                      {style === "select" ? "Dropdown Options (Text & Roles)" : "Emoji & Role Pairs"}
                    </Label>
                    <Badge variant="outline" className="text-[11px] font-mono">
                      {pairs.length}/{maxPairsAllowed}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddPair}
                    disabled={pairs.length >= maxPairsAllowed}
                    className="h-7 text-xs gap-1"
                  >
                    <Plus className="size-3.5" />
                    <span>{style === "select" ? "Add Option" : "Add Pair"}</span>
                  </Button>
                </div>

                {fieldErrors["pairs"] && (
                  <p className="text-xs text-destructive">{fieldErrors["pairs"]}</p>
                )}

                {/* Pairs List */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {pairs.map((pair, index) => {
                    const roleKey = `pairs[${index}].role_id`;
                    const emojiKey = `pairs[${index}].emoji`;

                    return (
                      <div key={pair.id} className="space-y-1">
                        <div
                          className={`flex items-center gap-2 rounded-md border bg-muted/10 p-2 ${
                            fieldErrors[roleKey] || (style !== "select" && fieldErrors[emojiKey])
                              ? "border-destructive/60 bg-destructive/5"
                              : "border-border/60"
                          }`}
                        >
                          {/* Up/Down Reorder */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMovePairUp(index)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === pairs.length - 1}
                              onClick={() => handleMovePairDown(index)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </div>

                          {/* Option Input: Text Label if Select Menu, Emoji if Reactions/Buttons */}
                          {style === "select" ? (
                            <div className="w-44 sm:w-52 shrink-0">
                              <Input
                                placeholder="Option Text (Defaults to Role)"
                                value={pair.label || ""}
                                onChange={(e) => handlePairChange(index, "label", e.target.value)}
                                className="h-8 text-xs font-sans"
                              />
                            </div>
                          ) : (
                            <div className="w-24 shrink-0">
                              <Input
                                placeholder="Emoji"
                                value={pair.emoji}
                                onChange={(e) => handlePairChange(index, "emoji", e.target.value)}
                                className={`h-8 text-center text-sm font-emoji ${
                                  fieldErrors[emojiKey] ? "border-destructive focus-visible:ring-destructive" : ""
                                }`}
                              />
                            </div>
                          )}

                          {/* Role Select */}
                          <div className="flex-1 min-w-0">
                            <Select
                              value={pair.role_id ? String(pair.role_id) : null}
                              onValueChange={(val) => handlePairChange(index, "role_id", val ?? "")}
                              items={roleItems}
                            >
                              <SelectTrigger
                                size="sm"
                                className={cn(
                                  "w-full h-8 text-xs",
                                  fieldErrors[roleKey]
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

                          {/* Remove Pair */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemovePair(index)}
                            className="size-8 text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                        {(fieldErrors[emojiKey] || fieldErrors[roleKey]) && (
                          <p className="text-[11px] text-destructive pl-7">
                            {fieldErrors[emojiKey] || fieldErrors[roleKey]}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: Discord-Accurate Live Preview Panel (5 cols) */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="flex items-center justify-between pb-2">
                <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <span>Discord Static Live Preview</span>
                </Label>
                <Badge variant="outline" className="text-[10px] uppercase font-mono">
                  {style}
                </Badge>
              </div>

              {/* Discord Mock Container */}
              <div className="flex-1 rounded-xl bg-[#313338] border border-[#232428] p-4 text-[#dbdee1] flex flex-col justify-start select-none shadow-inner min-h-[360px]">
                {/* Discord Message Header */}
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-xs">
                    N
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-white hover:underline cursor-pointer">
                        Neverland
                      </span>
                      <span className="bg-[#5865F2] text-white text-[9px] font-bold px-1 rounded leading-normal">
                        BOT
                      </span>
                      <span className="text-[11px] text-[#949ba4] ml-1">Today at 12:00 PM</span>
                    </div>

                    {/* Discord Message Body */}
                    {livePreview.content ? (
                      <div className="text-sm text-[#dbdee1] mt-1 whitespace-pre-wrap break-words leading-relaxed font-sans">
                        {livePreview.content}
                      </div>
                    ) : (
                      <div className="text-xs text-[#949ba4] italic mt-1 font-sans">
                        (No text content)
                      </div>
                    )}

                    {/* Discord Embed */}
                    {livePreview.embed && (
                      <div
                        className="mt-2 rounded-md bg-[#2b2d31] p-3 text-sm border-l-4 shadow-xs"
                        style={{ borderLeftColor: livePreview.embed.color }}
                      >
                        {livePreview.embed.title && (
                          <div className="font-bold text-white text-sm mb-1 leading-snug">
                            {livePreview.embed.title}
                          </div>
                        )}
                        {livePreview.embed.description && (
                          <div className="text-xs text-[#dbdee1] whitespace-pre-wrap leading-relaxed">
                            {livePreview.embed.description}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Discord Interactive Components Preview */}
                    <div className="mt-3 pt-1">
                      {/* Style 1: Reactions */}
                      {livePreview.style === "reactions" && (
                        <div className="flex flex-wrap gap-1.5">
                          {livePreview.pairs.map((p, idx) => (
                            <div
                              key={idx}
                              className="inline-flex items-center gap-1.5 bg-[#2b2d31] hover:bg-[#35373c] border border-[#3f4147] rounded-md px-2 py-0.5 text-xs text-[#b5bac1] font-medium"
                            >
                              <span>{p.emoji}</span>
                              <span className="text-[#949ba4] text-[11px]">1</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Style 2: Buttons */}
                      {livePreview.style === "buttons" && (
                        <div className="flex flex-wrap gap-2">
                          {livePreview.pairs.map((p, idx) => (
                            <div
                              key={idx}
                              className="inline-flex items-center gap-1.5 bg-[#4e5058] hover:bg-[#5c5e66] text-white rounded px-2.5 py-1.5 text-xs font-medium shadow-xs"
                            >
                              <span>{p.emoji}</span>
                              <span className="truncate max-w-[120px]">{p.roleName}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Style 3: Select Menu */}
                      {livePreview.style === "select" && (
                        <div className="space-y-1.5">
                          <div className="rounded-md bg-[#1e1f22] border border-[#3f4147] p-2.5 text-xs text-[#949ba4] flex items-center justify-between">
                            <span className="text-xs font-medium">Select a role...</span>
                            <ChevronDown className="size-3.5 text-[#949ba4]" />
                          </div>
                          {livePreview.pairs.length > 0 && (
                            <div className="rounded-md bg-[#2b2d31] border border-[#3f4147] p-1 space-y-0.5">
                              {livePreview.pairs.map((p, idx) => (
                                <div
                                  key={idx}
                                  className="px-2 py-1.5 rounded hover:bg-[#35373c] text-white flex items-center justify-between text-xs"
                                >
                                  <span className="font-medium text-[#dbdee1]">{p.label || p.roleName}</span>
                                  {p.label && (
                                    <span className="text-[10px] text-[#949ba4]">@{p.roleName}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dialog Footer */}
          <DialogFooter className="mt-6 border-t border-border/50 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              {editingMessage && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMessageToDelete(editingMessage);
                    setDeleteDialogOpen(true);
                  }}
                  className="text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5 mr-1" />
                  <span>Delete message</span>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseEditor}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="gap-2 min-w-[120px]"
              >
                {isSaving ? (
                  <>
                    <span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" />
                    <span>{editingMessage ? "Save Changes" : "Save & Publish"}</span>
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5 text-destructive" />
              <DialogTitle className="text-destructive">Delete Reaction Role</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-foreground/90">
              Are you sure you want to delete this reaction role message? This will delete the
              message from Discord and remove its role mappings from the bot database.
            </DialogDescription>
            {messageToDelete && (
              <div className="mt-3 rounded-lg border border-border/80 bg-muted/40 p-3 space-y-1.5 text-xs text-muted-foreground text-left">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate max-w-[220px]">
                    {messageToDelete.embed?.title ||
                      (messageToDelete.content
                        ? messageToDelete.content.slice(0, 35) + "…"
                        : `Message ${messageToDelete.message_id}`)}
                  </span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {messageToDelete.style}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span>
                    Channel:{" "}
                    {resolveChannelName(
                      messageToDelete.channel_id,
                      channels,
                      "channel"
                    )}
                  </span>
                  <span>·</span>
                  <span>
                    {messageToDelete.pairs?.length || 0} role pair
                    {messageToDelete.pairs?.length === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span className="font-mono text-[10px]">
                    ID: {messageToDelete.message_id}
                  </span>
                </div>
              </div>
            )}
          </DialogHeader>
          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="gap-2"
            >
              {isDeleting ? (
                <>
                  <span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="size-4" />
                  <span>Delete</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
