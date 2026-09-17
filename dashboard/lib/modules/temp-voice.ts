import { z } from "zod";
import { fetchControlPlane, putControlPlane } from "@/lib/control-plane";

// Discord snowflakes exceed Number.MAX_SAFE_INTEGER — IDs must stay strings.
export const tempVoiceAreaSchema = z.object({
  id: z
    .string()
    .min(1, "Area slug cannot be empty")
    .max(32, "Area slug cannot exceed 32 characters")
    .regex(/^[a-z0-9_-]+$/, "Slug can only contain letters, numbers, hyphens, and underscores"),
  title: z
    .string()
    .min(1, "Area title cannot be empty")
    .max(64, "Area title cannot exceed 64 characters"),
  trigger_channel_id: z
    .string()
    .regex(/^\d+$/, "Trigger channel ID must be a valid Discord ID")
    .nullable()
    .default(null),
  category_id: z
    .string()
    .regex(/^\d+$/, "Category ID must be a valid Discord ID")
    .nullable()
    .default(null),
  naming: z
    .string()
    .min(1, "Naming pattern cannot be empty")
    .max(80, "Naming pattern cannot exceed 80 characters")
    .default("{username}'s lounge"),
  user_limit: z.coerce
    .number()
    .int("User limit must be an integer")
    .min(0, "User limit must be at least 0")
    .max(99, "User limit cannot exceed 99")
    .default(0),
  auto_delete_seconds: z.coerce
    .number()
    .int("Auto-delete delay must be an integer")
    .min(15, "Auto-delete delay must be at least 15 seconds")
    .max(3600, "Auto-delete delay cannot exceed 3600 seconds (1 hour)")
    .default(60),
});

export const tempVoiceConfigSchema = z
  .object({
    areas: z.array(tempVoiceAreaSchema).max(10, "Maximum 10 temp voice areas allowed").default([]),
  })
  .superRefine((cfg, ctx) => {
    const seenIds = new Set<string>();
    const seenTriggers = new Set<string>();
    cfg.areas.forEach((area, index) => {
      if (seenIds.has(area.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate area slug "${area.id}"`,
          path: ["areas", index, "id"],
        });
      }
      seenIds.add(area.id);
      if (area.trigger_channel_id) {
        if (seenTriggers.has(area.trigger_channel_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "This trigger channel is already used by another area",
            path: ["areas", index, "trigger_channel_id"],
          });
        }
        seenTriggers.add(area.trigger_channel_id);
      }
    });
  });

export type TempVoiceArea = z.infer<typeof tempVoiceAreaSchema>;
export type TempVoiceConfig = z.infer<typeof tempVoiceConfigSchema>;

export interface TempVoiceConfigResponse {
  module: string;
  enabled: boolean;
  config: TempVoiceConfig;
}

export interface TempVoiceStateResponse {
  enabled: boolean;
}

export interface ActiveTempChannel {
  channel_id: string;
  name: string;
  owner_id: string;
  locked: boolean;
  member_ids: string[];
  member_count: number;
  user_limit: number;
  created_at: string | null;
  area_id?: string | null;
}

export const DEFAULT_TEMP_VOICE_CONFIG: TempVoiceConfig = {
  areas: [],
};

export function newTempVoiceArea(index: number): TempVoiceArea {
  return {
    id: `lounge-${index + 1}`,
    title: `Lounge Area ${index + 1}`,
    trigger_channel_id: null,
    category_id: null,
    naming: "{username}'s lounge",
    user_limit: 0,
    auto_delete_seconds: 60,
  };
}

export async function getTempVoiceConfig(
  guildId: string
): Promise<TempVoiceConfigResponse> {
  return fetchControlPlane<TempVoiceConfigResponse>(
    `/guilds/${guildId}/modules/temp_voice/config`
  );
}

export async function setTempVoiceConfig(
  guildId: string,
  payload: TempVoiceConfig
): Promise<TempVoiceConfig> {
  return putControlPlane<TempVoiceConfig>(
    `/guilds/${guildId}/modules/temp_voice/config`,
    payload
  );
}

export async function setTempVoiceEnabled(
  guildId: string,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  return putControlPlane<{ enabled: boolean }>(
    `/guilds/${guildId}/modules/temp_voice/state`,
    { enabled }
  );
}

export async function getTempVoiceState(
  guildId: string
): Promise<{ enabled: boolean }> {
  return fetchControlPlane<{ enabled: boolean }>(
    `/guilds/${guildId}/modules/temp_voice/state`
  );
}

export async function getTempVoiceChannels(
  guildId: string
): Promise<ActiveTempChannel[]> {
  return fetchControlPlane<ActiveTempChannel[]>(
    `/guilds/${guildId}/temp-voice/channels`
  );
}
