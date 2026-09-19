export interface AntiSpamConfig {
  enabled: boolean;
  max_messages: number;
  seconds: number;
  action: "timeout" | "delete" | "warn";
  timeout_minutes: number;
}

export interface AntiInviteConfig {
  enabled: boolean;
  action: "delete" | "warn" | "timeout";
  whitelisted_channels: string[];
  whitelisted_roles: string[];
}

export interface AntiMentionConfig {
  enabled: boolean;
  max_mentions: number;
  action: "delete" | "warn" | "timeout";
}

export interface BadWordsConfig {
  enabled: boolean;
  action: "delete" | "warn" | "timeout";
  words: string[];
}

export interface RegexRuleConfig {
  id?: string;
  name: string;
  pattern: string;
  action: "delete" | "warn" | "timeout" | "kick" | "ban";
  timeout_minutes: number;
  enabled: boolean;
}

export interface ModerationConfig {
  mod_logs_channel_id: string | null;
  disabled_commands: string[];
  command_roles: Record<string, string[]>;
  anti_spam: AntiSpamConfig;
  anti_invite: AntiInviteConfig;
  anti_mention: AntiMentionConfig;
  bad_words: BadWordsConfig;
  custom_regex_patterns?: RegexRuleConfig[];
}

export interface ModerationConfigResponse {
  module: string;
  enabled: boolean;
  config: ModerationConfig;
}

export interface ModerationCase {
  _id?: string;
  case_id: number;
  guild_id: string | number;
  action: string;
  target_id: string;
  target_tag?: string;
  moderator_id: string;
  moderator_tag?: string;
  reason: string;
  created_at?: string;
}

export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  mod_logs_channel_id: null,
  disabled_commands: [],
  command_roles: {},
  anti_spam: {
    enabled: false,
    max_messages: 5,
    seconds: 5,
    action: "timeout",
    timeout_minutes: 5,
  },
  anti_invite: {
    enabled: false,
    action: "delete",
    whitelisted_channels: [],
    whitelisted_roles: [],
  },
  anti_mention: {
    enabled: false,
    max_mentions: 5,
    action: "warn",
  },
  bad_words: {
    enabled: false,
    action: "delete",
    words: [],
  },
  custom_regex_patterns: [],
};

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  category: "Moderation" | "Administration" | "Leveling" | "Tickets" | "Giveaways";
  defaultAdminOnly: boolean;
}

export const MODERATION_COMMANDS: CommandDefinition[] = [
  // Moderation
  { id: "kick", name: "/kick", description: "Kick a member from the server", category: "Moderation", defaultAdminOnly: true },
  { id: "ban", name: "/ban", description: "Permanently ban a member from the server", category: "Moderation", defaultAdminOnly: true },
  { id: "unban", name: "/unban", description: "Revoke a member ban", category: "Moderation", defaultAdminOnly: true },
  { id: "timeout", name: "/timeout", description: "Temporarily mute/timeout a member", category: "Moderation", defaultAdminOnly: false },
  { id: "untimeout", name: "/untimeout", description: "Remove timeout from a member", category: "Moderation", defaultAdminOnly: false },
  { id: "warn", name: "/warn", description: "Issue an official warning to a member", category: "Moderation", defaultAdminOnly: false },
  { id: "warnings", name: "/warnings", description: "List warnings for a member", category: "Moderation", defaultAdminOnly: false },
  { id: "delwarn", name: "/delwarn", description: "Delete a specific warning case", category: "Moderation", defaultAdminOnly: false },
  { id: "clear", name: "/clear", description: "Bulk delete messages in a channel", category: "Moderation", defaultAdminOnly: false },
  { id: "modlogs", name: "/modlogs", description: "Inspect recent moderation logs for a user", category: "Moderation", defaultAdminOnly: false },
  { id: "moderation_logs", name: "/moderation_logs", description: "Configure moderation audit logs channel", category: "Moderation", defaultAdminOnly: true },

  // Administration & Setup
  { id: "setup", name: "/setup (welcome, leave, view)", description: "Configure welcome, leave notifications, and server settings", category: "Administration", defaultAdminOnly: true },

  // Leveling
  { id: "xp", name: "/xp", description: "Award or modify member experience points", category: "Leveling", defaultAdminOnly: true },
  { id: "levelroles", name: "/levelroles (add, remove)", description: "Manage level-up reward roles", category: "Leveling", defaultAdminOnly: true },

  // Tickets
  { id: "tickets_publish_panel", name: "/tickets publish-panel", description: "Publish or replace ticket panel in designated channel", category: "Tickets", defaultAdminOnly: true },
  { id: "tickets_logs", name: "/tickets logs", description: "Configure ticket transcript and audit logs channel", category: "Tickets", defaultAdminOnly: true },

  // Giveaways
  { id: "giveaway", name: "/giveaway (create, end, reroll)", description: "Create and manage server community giveaways", category: "Giveaways", defaultAdminOnly: true },
];
