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

export interface ModerationConfig {
  mod_logs_channel_id: string | null;
  disabled_commands: string[];
  command_roles: Record<string, string[]>;
  anti_spam: AntiSpamConfig;
  anti_invite: AntiInviteConfig;
  anti_mention: AntiMentionConfig;
  bad_words: BadWordsConfig;
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
};

export const MODERATION_COMMANDS = [
  { id: "kick", name: "/kick", description: "Kick a member from the server", defaultAdminOnly: true },
  { id: "ban", name: "/ban", description: "Permanently ban a member from the server", defaultAdminOnly: true },
  { id: "unban", name: "/unban", description: "Revoke a member ban", defaultAdminOnly: true },
  { id: "timeout", name: "/timeout", description: "Temporarily mute/timeout a member", defaultAdminOnly: false },
  { id: "untimeout", name: "/untimeout", description: "Remove timeout from a member", defaultAdminOnly: false },
  { id: "warn", name: "/warn", description: "Issue an official warning to a member", defaultAdminOnly: false },
  { id: "warnings", name: "/warnings", description: "List warnings for a member", defaultAdminOnly: false },
  { id: "delwarn", name: "/delwarn", description: "Delete a specific warning case", defaultAdminOnly: false },
  { id: "clear", name: "/clear", description: "Bulk delete messages in a channel", defaultAdminOnly: false },
  { id: "modlogs", name: "/modlogs", description: "Inspect recent moderation logs for a user", defaultAdminOnly: false },
  { id: "moderation_logs", name: "/moderation_logs", description: "Set or toggle moderation logs channel", defaultAdminOnly: true },
];
