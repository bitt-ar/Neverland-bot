"use client";

import * as React from "react";
import { useState } from "react";
import {
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  Info,
  AlertTriangle,
  Sparkles,
  FileText,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { GuildChannel, GuildRole, WorkflowAction } from "@/lib/control-plane";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectSearchable } from "@/components/ui/select-searchable";

export interface ActionCategoryItem {
  type: string;
  label: string;
  icon: string;
  desc: string;
  isModal?: boolean;
}

export const ACTION_CATEGORIES: { category: string; actions: ActionCategoryItem[] }[] = [
  {
    category: "Communication",
    actions: [
      { type: "send_message", label: "Send Channel Message", icon: "💬", desc: "Send message or embed in a channel" },
      { type: "reply_ephemeral", label: "Private Ephemeral Reply", icon: "🔒", desc: "Reply visible only to the user" },
      { type: "send_dm", label: "Send Direct Message (DM)", icon: "✉️", desc: "Send private DM to the user" },
      { type: "add_reaction", label: "Add Reaction Emoji", icon: "😀", desc: "React to trigger or bot message" },
      { type: "random_response", label: "Random Response", icon: "🎲", desc: "Pick and send one random variation" },
    ],
  },
  {
    category: "Roles & Identity",
    actions: [
      { type: "add_role", label: "Add Role", icon: "➕", desc: "Grant a role to the user" },
      { type: "remove_role", label: "Remove Role", icon: "➖", desc: "Remove a role from the user" },
      { type: "toggle_role", label: "Toggle Role", icon: "🔄", desc: "Add role if missing, remove if present" },
      { type: "change_nickname", label: "Change Nickname", icon: "🏷️", desc: "Change the member's server nickname" },
    ],
  },
  {
    category: "Channel Control",
    actions: [
      { type: "delete_trigger", label: "Delete Trigger Message", icon: "🗑️", desc: "Delete message that invoked command" },
      { type: "pin_message", label: "Pin Message", icon: "📌", desc: "Pin bot message or trigger in channel" },
      { type: "slowmode_channel", label: "Set Slowmode Delay", icon: "⏱️", desc: "Adjust chat rate limit (0-21600s)" },
      { type: "lock_channel", label: "Lock / Unlock Channel", icon: "🔐", desc: "Control @everyone send message permission" },
      { type: "create_temp_voice", label: "Create Temp Voice Room", icon: "🔊", desc: "Auto-delete temporary voice room" },
    ],
  },
  {
    category: "Moderation",
    actions: [
      { type: "timeout_member", label: "Timeout Member", icon: "⏳", desc: "Timeout member for a period of time" },
      { type: "kick_member", label: "Kick Member", icon: "👢", desc: "Kick member from server" },
      { type: "ban_member", label: "Ban Member", icon: "🔨", desc: "Ban member from server" },
      { type: "send_log", label: "Send Audit Log", icon: "📋", desc: "Log audit record in a staff channel" },
    ],
  },
  {
    category: "Timing & Flow",
    actions: [
      { type: "wait_delay", label: "Wait Delay", icon: "⏸️", desc: "Wait N seconds before next step" },
    ],
  },
  {
    category: "Forms & Modals",
    actions: [
      { type: "show_modal", label: "Show Modal Form", icon: "📝", desc: "Interactive popup form (Select Menus)", isModal: true },
    ],
  },
];

export const ACTION_TYPE_LABELS: Record<string, { label: string; icon: string }> = {};
ACTION_CATEGORIES.forEach((cat) => {
  cat.actions.forEach((act) => {
    ACTION_TYPE_LABELS[act.type] = { label: act.label, icon: act.icon };
  });
});

interface ActionCardProps {
  action: WorkflowAction;
  index: number;
  total: number;
  isDropdownOption?: boolean;
  channels: GuildChannel[];
  roles: GuildRole[];
  onChange: (updated: WorkflowAction) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function ActionCard({
  action,
  index,
  total,
  isDropdownOption = false,
  channels,
  roles,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ActionCardProps) {
  const [embedOpen, setEmbedOpen] = useState(
    Boolean(
      action.embed?.title ||
      action.embed?.description ||
      action.embed?.footer ||
      action.embed?.thumbnail ||
      action.embed?.image
    )
  );

  const textChannels = channels.filter((c) => c.type === "text" || c.type === "announcement");
  const categoryChannels = channels.filter((c) => c.type === "category");

  // Helper for quick emoji chips
  const quickEmojis = ["✅", "❌", "👍", "👎", "⭐", "🎉", "🔥", "❤️", "👀", "🤖"];

  return (
    <Card className="p-4 border border-border/80 shadow-sm relative space-y-3 bg-card/60">
      {/* Header: Step Number, Type Selector, Order & Delete Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold shrink-0">
            {index + 1}
          </span>

          <Select
            value={action.type || "send_message"}
            onValueChange={(val: string | null) => {
              if (val) onChange({ ...action, type: val });
            }}
          >
            <SelectTrigger className="w-[260px] h-8 text-xs font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {ACTION_CATEGORIES.map((cat) => (
                <SelectGroup key={cat.category}>
                  <SelectLabel className="text-xs font-semibold text-muted-foreground">
                    {cat.category}
                  </SelectLabel>
                  {cat.actions.map((item) => (
                    <SelectItem key={item.type} value={item.type} className="text-xs">
                      <span className="mr-1.5">{item.icon}</span>
                      <span>{item.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          {ACTION_TYPE_LABELS[action.type] && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Step #{index + 1}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onMoveUp && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={index === 0}
              onClick={onMoveUp}
              title="Move Up"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          {onMoveDown && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={index === total - 1}
              onClick={onMoveDown}
              title="Move Down"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={onRemove}
            title="Delete Action"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Notice for show_modal outside of interactions */}
      {action.type === "show_modal" && !isDropdownOption && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-500 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>Discord API Notice:</strong> Pop-up Modal Forms can only be opened in response to interactive components (such as Dropdown Select Menus). They cannot be triggered by chat prefix commands.
          </span>
        </div>
      )}

      {/* ----------------- ACTION SPECIFIC CONFIGURATIONS ----------------- */}

      {/* 1. COMMUNICATION: send_message, reply_ephemeral, send_dm */}
      {["send_message", "reply_ephemeral", "send_dm"].includes(action.type) && (
        <div className="space-y-3 pt-1">
          {action.type === "send_message" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Destination Channel (optional, defaults to current channel)</Label>
              <SelectSearchable
                options={textChannels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
                value={action.channel_id || ""}
                onValueChange={(cId) => onChange({ ...action, channel_id: cId || null })}
                placeholder="Current Channel"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Message Content</Label>
            <Textarea
              value={action.content || ""}
              onChange={(e) => onChange({ ...action, content: e.target.value })}
              placeholder="Type message content... (supports {user}, {server}, {channel}, etc.)"
              className="text-xs min-h-[60px]"
            />
          </div>

          {/* Embed Collapsible Accordion */}
          <div className="border rounded-md p-2.5 bg-muted/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Rich Embed Message
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setEmbedOpen(!embedOpen)}
              >
                {embedOpen ? "Hide Embed" : "Configure Embed"}
              </Button>
            </div>

            {embedOpen && (
              <div className="space-y-2 pt-2 border-t">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder="Embed Title"
                    value={action.embed?.title || ""}
                    onChange={(e) =>
                      onChange({
                        ...action,
                        embed: { ...action.embed, title: e.target.value },
                      })
                    }
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="Hex Color (e.g. #5865F2)"
                    value={action.embed?.color || ""}
                    onChange={(e) =>
                      onChange({
                        ...action,
                        embed: { ...action.embed, color: e.target.value },
                      })
                    }
                    className="text-xs h-8 font-mono"
                  />
                </div>
                <Textarea
                  placeholder="Embed Description"
                  value={action.embed?.description || ""}
                  onChange={(e) =>
                    onChange({
                      ...action,
                      embed: { ...action.embed, description: e.target.value },
                    })
                  }
                  className="text-xs min-h-[50px]"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    placeholder="Footer Text"
                    value={action.embed?.footer || ""}
                    onChange={(e) =>
                      onChange({
                        ...action,
                        embed: { ...action.embed, footer: e.target.value },
                      })
                    }
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="Thumbnail URL"
                    value={action.embed?.thumbnail || ""}
                    onChange={(e) =>
                      onChange({
                        ...action,
                        embed: { ...action.embed, thumbnail: e.target.value },
                      })
                    }
                    className="text-xs h-8"
                  />
                  <Input
                    placeholder="Large Image URL"
                    value={action.embed?.image || ""}
                    onChange={(e) =>
                      onChange({
                        ...action,
                        embed: { ...action.embed, image: e.target.value },
                      })
                    }
                    className="text-xs h-8"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. COMMUNICATION: add_reaction */}
      {action.type === "add_reaction" && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Reaction Emoji</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Emoji (e.g. ⭐ or :thumbsup:)"
                value={action.emoji || ""}
                onChange={(e) => onChange({ ...action, emoji: e.target.value })}
                className="text-xs h-8 max-w-xs"
              />
              <div className="flex items-center gap-1 flex-wrap">
                {quickEmojis.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => onChange({ ...action, emoji: em })}
                    className="px-1.5 py-0.5 text-sm bg-muted hover:bg-primary/20 rounded border transition-colors"
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. COMMUNICATION: random_response */}
      {action.type === "random_response" && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Random Response Variations (one will be chosen)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                const choices = Array.isArray(action.choices) ? [...action.choices] : [];
                onChange({
                  ...action,
                  choices: [...choices, `Response #${choices.length + 1}`],
                });
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Variation
            </Button>
          </div>

          <div className="space-y-2">
            {(Array.isArray(action.choices) && action.choices.length > 0
              ? action.choices
              : ["Default response 1", "Default response 2"]
            ).map((choice, cIdx) => {
              const strVal = typeof choice === "string" ? choice : choice?.content || "";
              return (
                <div key={cIdx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-4">{cIdx + 1}.</span>
                  <Input
                    value={strVal}
                    onChange={(e) => {
                      const cur = Array.isArray(action.choices)
                        ? [...action.choices]
                        : ["Default response 1", "Default response 2"];
                      cur[cIdx] = e.target.value;
                      onChange({ ...action, choices: cur });
                    }}
                    placeholder={`Response choice ${cIdx + 1}`}
                    className="text-xs h-8 flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => {
                      const cur = Array.isArray(action.choices) ? [...action.choices] : [];
                      onChange({ ...action, choices: cur.filter((_, i) => i !== cIdx) });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch
              id={`ephemeral-${index}`}
              checked={Boolean(action.ephemeral)}
              onCheckedChange={(checked) => onChange({ ...action, ephemeral: checked })}
            />
            <Label htmlFor={`ephemeral-${index}`} className="text-xs cursor-pointer">
              Send response ephemerally (visible only to user)
            </Label>
          </div>
        </div>
      )}

      {/* 4. ROLES: add_role, remove_role, toggle_role */}
      {["add_role", "remove_role", "toggle_role"].includes(action.type) && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">Target Server Role</Label>
          <SelectSearchable
            options={roles.map((r) => ({ value: r.id, label: `@${r.name}` }))}
            value={action.role_id || ""}
            onValueChange={(rId) => onChange({ ...action, role_id: rId || null })}
            placeholder="Select target role..."
          />
        </div>
      )}

      {/* 5. ROLES: change_nickname */}
      {action.type === "change_nickname" && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">New Server Nickname Template</Label>
          <Input
            value={action.nickname || ""}
            onChange={(e) => onChange({ ...action, nickname: e.target.value })}
            placeholder="[Member] {user}"
            className="text-xs h-8"
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 rounded">&#123;user&#125;</code> to insert username. Leave blank to reset nickname to default.
          </p>
        </div>
      )}

      {/* 6. CHANNELS: delete_trigger */}
      {action.type === "delete_trigger" && (
        <div className="p-2.5 bg-muted/40 rounded-md text-xs text-muted-foreground flex items-center gap-2">
          <Info className="h-4 w-4 text-primary shrink-0" />
          <span>
            Deletes the user message that triggered this command immediately upon execution.
          </span>
        </div>
      )}

      {/* 7. CHANNELS: pin_message */}
      {action.type === "pin_message" && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">Message to Pin</Label>
          <Select
            value={action.target || "bot_message"}
            onValueChange={(val: string | null) => {
              if (val) onChange({ ...action, target: val as "bot_message" | "trigger" });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bot_message" className="text-xs">
                Bot&apos;s last sent message
              </SelectItem>
              <SelectItem value="trigger" className="text-xs">
                User&apos;s triggering command message
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 8. CHANNELS: slowmode_channel */}
      {action.type === "slowmode_channel" && (
        <div className="space-y-2 pt-1">
          <Label className="text-xs">Slowmode Delay (seconds, 0 to 21600)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={21600}
              value={action.seconds ?? 0}
              onChange={(e) => onChange({ ...action, seconds: Number(e.target.value) || 0 })}
              className="text-xs h-8 max-w-[120px]"
            />
            <div className="flex items-center gap-1 flex-wrap">
              {[0, 5, 10, 30, 60, 300].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onChange({ ...action, seconds: sec })}
                  className="px-2 py-0.5 text-xs bg-muted hover:bg-primary/20 rounded border transition-colors"
                >
                  {sec === 0 ? "Off" : `${sec}s`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 9. CHANNELS: lock_channel */}
      {action.type === "lock_channel" && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">Lock Operation</Label>
          <Select
            value={action.action || "lock"}
            onValueChange={(val: string | null) => {
              if (val) onChange({ ...action, action: val as "lock" | "unlock" });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lock" className="text-xs">
                🔒 Lock Channel (Deny @everyone send messages)
              </SelectItem>
              <SelectItem value="unlock" className="text-xs">
                🔓 Unlock Channel (Allow @everyone send messages)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 10. CHANNELS: create_temp_voice */}
      {action.type === "create_temp_voice" && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Voice Channel Name</Label>
              <Input
                value={action.name || ""}
                onChange={(e) => onChange({ ...action, name: e.target.value })}
                placeholder="{user}'s Voice"
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">User Limit (0 = Unlimited, max 99)</Label>
              <Input
                type="number"
                min={0}
                max={99}
                value={action.user_limit ?? 0}
                onChange={(e) => onChange({ ...action, user_limit: Number(e.target.value) || 0 })}
                className="text-xs h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Category (Optional)</Label>
            <SelectSearchable
              options={categoryChannels.map((c) => ({ value: c.id, label: `📁 ${c.name}` }))}
              value={action.category_id || ""}
              onValueChange={(catId) => onChange({ ...action, category_id: catId || null })}
              placeholder="Select parent category (optional)..."
            />
          </div>

          {/* Inherit Category Permissions Toggle */}
          <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border/50">
            <div className="space-y-0.5 pr-2">
              <Label className="text-xs font-medium cursor-pointer" htmlFor={`inherit-cat-${index}`}>
                Inherit Category Settings & Permissions
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Syncs private/public status and role access from the category. The room creator is automatically granted full access.
              </p>
            </div>
            <Switch
              id={`inherit-cat-${index}`}
              checked={action.inherit_category_permissions !== false}
              onCheckedChange={(checked) => onChange({ ...action, inherit_category_permissions: checked })}
            />
          </div>

          {/* Empty Timeout / Auto-Delete Setting */}
          <div className="space-y-2 p-2.5 rounded-md bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Auto-Delete Delay when Empty</Label>
              <span className="text-[11px]">
                {action.empty_timeout === 0 ? (
                  <span className="text-emerald-400 font-medium">Permanent Room (0)</span>
                ) : (
                  <span className="text-amber-400 font-medium">
                    Deletes after {action.empty_timeout ?? 60}s empty
                  </span>
                )}
              </span>
            </div>
            <Input
              type="number"
              min={0}
              value={action.empty_timeout ?? 60}
              onChange={(e) =>
                onChange({ ...action, empty_timeout: Math.max(0, parseInt(e.target.value) || 0) })
              }
              className="text-xs h-8"
              placeholder="0 for permanent, or seconds (e.g. 60)"
            />
            {/* Quick preset chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[10px] text-muted-foreground mr-1">Presets:</span>
              {[
                { label: "0 (Permanent)", val: 0 },
                { label: "30s", val: 30 },
                { label: "1 min", val: 60 },
                { label: "3 min", val: 180 },
                { label: "5 min", val: 300 },
                { label: "10 min", val: 600 },
              ].map((chip) => (
                <button
                  key={chip.val}
                  type="button"
                  onClick={() => onChange({ ...action, empty_timeout: chip.val })}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer",
                    (action.empty_timeout ?? 60) === chip.val
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "bg-background hover:bg-muted text-muted-foreground border-border/60"
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 bg-muted/40 rounded-md text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              {action.empty_timeout === 0 ? (
                <span>
                  <strong>Permanent Room:</strong> This channel will remain open indefinitely and will <strong>not</strong> be auto-deleted even when empty.
                </span>
              ) : (
                <span>
                  <strong>Temporary Room:</strong> Channel will automatically delete if no one joins within <strong>{action.empty_timeout ?? 60}s</strong> of creation, or <strong>{action.empty_timeout ?? 60}s</strong> after all members leave.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 11. MODERATION: timeout_member */}
      {action.type === "timeout_member" && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Duration (minutes)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={40320}
                value={action.duration_minutes ?? 10}
                onChange={(e) => onChange({ ...action, duration_minutes: Number(e.target.value) || 10 })}
                className="text-xs h-8 max-w-[120px]"
              />
              <div className="flex items-center gap-1 flex-wrap">
                {[5, 10, 60, 1440, 10080].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ ...action, duration_minutes: m })}
                    className="px-2 py-0.5 text-xs bg-muted hover:bg-primary/20 rounded border transition-colors"
                  >
                    {m < 60 ? `${m}m` : m === 60 ? "1h" : m === 1440 ? "1d" : "1w"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reason (Optional)</Label>
            <Input
              value={action.reason || ""}
              onChange={(e) => onChange({ ...action, reason: e.target.value })}
              placeholder="Custom command timeout"
              className="text-xs h-8"
            />
          </div>
        </div>
      )}

      {/* 12. MODERATION: kick_member */}
      {action.type === "kick_member" && (
        <div className="space-y-2 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (Optional)</Label>
            <Input
              value={action.reason || ""}
              onChange={(e) => onChange({ ...action, reason: e.target.value })}
              placeholder="Custom workflow kick"
              className="text-xs h-8"
            />
          </div>
          <p className="text-xs text-amber-500 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Bot will skip kicking server administrators or members with higher roles.
          </p>
        </div>
      )}

      {/* 13. MODERATION: ban_member */}
      {action.type === "ban_member" && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Delete Message History</Label>
              <Select
                value={String(action.delete_days ?? 0)}
                onValueChange={(val: string | null) => {
                  if (val) onChange({ ...action, delete_days: Number(val) });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0" className="text-xs">Don&apos;t delete messages</SelectItem>
                  <SelectItem value="1" className="text-xs">Delete past 24 hours</SelectItem>
                  <SelectItem value="7" className="text-xs">Delete past 7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason (Optional)</Label>
              <Input
                value={action.reason || ""}
                onChange={(e) => onChange({ ...action, reason: e.target.value })}
                placeholder="Custom workflow ban"
                className="text-xs h-8"
              />
            </div>
          </div>
        </div>
      )}

      {/* 14. MODERATION: send_log */}
      {action.type === "send_log" && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Audit Log Channel</Label>
            <SelectSearchable
              options={textChannels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
              value={action.channel_id || ""}
              onValueChange={(cId) => onChange({ ...action, channel_id: cId || null })}
              placeholder="Select staff audit channel..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Log Message Content (optional)</Label>
            <Input
              value={action.content || ""}
              onChange={(e) => onChange({ ...action, content: e.target.value })}
              placeholder="Command {trigger} used by {user} in {channel}"
              className="text-xs h-8"
            />
          </div>
        </div>
      )}

      {/* 15. TIMING: wait_delay */}
      {action.type === "wait_delay" && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">Wait Duration (seconds, 1 to 60)</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={60}
              value={action.seconds ?? 2}
              onChange={(e) => onChange({ ...action, seconds: Number(e.target.value) || 2 })}
              className="text-xs h-8 max-w-[120px]"
            />
            <span className="text-xs text-muted-foreground">
              Pauses execution before running the next action in this pipeline.
            </span>
          </div>
        </div>
      )}

      {/* 16. FORMS: show_modal */}
      {action.type === "show_modal" && (
        <div className="space-y-4 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Modal Form Title * (max 45 chars)</Label>
              <Input
                value={action.title || ""}
                onChange={(e) => onChange({ ...action, title: e.target.value.slice(0, 45) })}
                placeholder="Application Form"
                className="text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Submission Channel (where answers are posted)</Label>
              <SelectSearchable
                options={textChannels.map((c) => ({ value: c.id, label: `#${c.name}` }))}
                value={action.submission_channel_id || ""}
                onValueChange={(cId) => onChange({ ...action, submission_channel_id: cId || null })}
                placeholder="Select submissions channel..."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Confirmation Message (ephemeral reply after submitting)</Label>
            <Input
              value={action.response_message || ""}
              onChange={(e) => onChange({ ...action, response_message: e.target.value })}
              placeholder="Thank you! Your response has been submitted."
              className="text-xs h-8"
            />
          </div>

          {/* Form Questions List (up to 5) */}
          <div className="border rounded-md p-3 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Form Questions / Input Fields (Max 5)
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Discord allows up to 5 questions in a single modal popup.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-xs"
                disabled={(action.fields || []).length >= 5}
                onClick={() => {
                  const fields = action.fields ? [...action.fields] : [];
                  onChange({
                    ...action,
                    fields: [
                      ...fields,
                      {
                        label: `Question ${fields.length + 1}`,
                        style: "paragraph",
                        placeholder: "Type your answer...",
                        required: true,
                      },
                    ],
                  });
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Question
              </Button>
            </div>

            <div className="space-y-2 pt-1">
              {(action.fields && action.fields.length > 0
                ? action.fields
                : [
                    {
                      label: "Your Response",
                      style: "paragraph" as const,
                      placeholder: "Enter details here...",
                      required: true,
                    },
                  ]
              ).map((f, qIdx) => (
                <div key={qIdx} className="p-2.5 border rounded bg-background space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-muted-foreground">#{qIdx + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
                      onClick={() => {
                        const cur = action.fields ? [...action.fields] : [];
                        onChange({ ...action, fields: cur.filter((_, i) => i !== qIdx) });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">Question Label *</Label>
                      <Input
                        value={f.label || ""}
                        onChange={(e) => {
                          const cur = action.fields ? [...action.fields] : [];
                          cur[qIdx] = { ...cur[qIdx], label: e.target.value.slice(0, 45) };
                          onChange({ ...action, fields: cur });
                        }}
                        placeholder="e.g. Why do you want to join?"
                        className="text-xs h-7"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Input Style</Label>
                      <Select
                        value={f.style || "paragraph"}
                        onValueChange={(val: string | null) => {
                          if (val) {
                            const cur = action.fields ? [...action.fields] : [];
                            cur[qIdx] = { ...cur[qIdx], style: val as "short" | "paragraph" };
                            onChange({ ...action, fields: cur });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short" className="text-xs">Short Text (Single Line)</SelectItem>
                          <SelectItem value="paragraph" className="text-xs">Paragraph (Multi-line)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Input
                      value={f.placeholder || ""}
                      onChange={(e) => {
                        const cur = action.fields ? [...action.fields] : [];
                        cur[qIdx] = { ...cur[qIdx], placeholder: e.target.value };
                        onChange({ ...action, fields: cur });
                      }}
                      placeholder="Placeholder helper text..."
                      className="text-xs h-7 flex-1"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Switch
                        id={`req-${index}-${qIdx}`}
                        checked={f.required !== false}
                        onCheckedChange={(chk) => {
                          const cur = action.fields ? [...action.fields] : [];
                          cur[qIdx] = { ...cur[qIdx], required: chk };
                          onChange({ ...action, fields: cur });
                        }}
                      />
                      <Label htmlFor={`req-${index}-${qIdx}`} className="text-[11px] cursor-pointer">
                        Required
                      </Label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
