import { z } from "zod";
import { fetchControlPlane, putControlPlane } from "@/lib/control-plane";

export const levelingConfigSchema = z
  .object({
    xp_min: z.coerce
      .number()
      .int("Minimum XP must be an integer")
      .min(1, "Minimum XP must be at least 1")
      .max(100, "Minimum XP cannot exceed 100")
      .default(1),
    xp_max: z.coerce
      .number()
      .int("Maximum XP must be an integer")
      .min(1, "Maximum XP must be at least 1")
      .max(100, "Maximum XP cannot exceed 100")
      .default(30),
    cooldown_seconds: z.coerce
      .number()
      .int("Cooldown must be an integer")
      .min(0, "Cooldown must be at least 0 seconds")
      .max(600, "Cooldown cannot exceed 600 seconds")
      .default(60),
    voice_xp_enabled: z.boolean().default(true),
    voice_xp_per_minute: z.coerce
      .number()
      .int("Voice XP rate must be an integer")
      .min(0, "Voice XP rate must be at least 0")
      .max(1000, "Voice XP rate cannot exceed 1000")
      .default(30),
    announce_channel_id: z
      .string()
      .regex(/^\d+$/, "Channel ID must be a valid Discord ID")
      .nullable()
      .default(null),
    announce_message: z
      .string()
      .max(500, "Announcement message cannot exceed 500 characters")
      .default("{user} has leveled up to level {level}!"),
    rewards: z
      .record(
        z.string().regex(/^\d+$/, "Reward level must be a valid level number"),
        z.string().regex(/^\d+$/, "Role ID must be a valid Discord ID")
      )
      .default({}),
  })
  .refine((data) => data.xp_max >= data.xp_min, {
    message: "xp_max must be greater than or equal to xp_min",
    path: ["xp_max"],
  });

export type LevelingConfig = z.infer<typeof levelingConfigSchema>;

export interface LevelingConfigResponse {
  module: string;
  enabled: boolean;
  config: LevelingConfig;
}

export interface LevelingStateResponse {
  enabled: boolean;
}

export const DEFAULT_LEVELING_CONFIG: LevelingConfig = {
  xp_min: 1,
  xp_max: 30,
  cooldown_seconds: 60,
  voice_xp_enabled: true,
  voice_xp_per_minute: 30,
  announce_channel_id: null,
  announce_message: "{user} has leveled up to level {level}!",
  rewards: {},
};

export async function getLevelingConfig(guildId: string): Promise<LevelingConfigResponse> {
  return fetchControlPlane<LevelingConfigResponse>(`/guilds/${guildId}/modules/leveling/config`);
}

export async function setLevelingConfig(
  guildId: string,
  payload: LevelingConfig
): Promise<LevelingConfig> {
  return putControlPlane<LevelingConfig>(`/guilds/${guildId}/modules/leveling/config`, payload);
}

export async function setLevelingEnabled(
  guildId: string,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  return putControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/leveling/state`, {
    enabled,
  });
}

export async function getLevelingState(guildId: string): Promise<{ enabled: boolean }> {
  return fetchControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/leveling/state`);
}
