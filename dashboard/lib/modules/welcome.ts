import { z } from "zod";
import { fetchControlPlane, putControlPlane } from "@/lib/control-plane";

export const welcomeConfigSchema = z.object({
  channel_id: z
    .string()
    .regex(/^\d+$/, "Channel ID must be a valid Discord ID")
    .nullable()
    .default(null),
  include_image: z.boolean().default(true),
  // Auto role on join
  auto_role_enabled: z.boolean().default(true),
  member_role_ids: z
    .array(z.string().regex(/^\d+$/, "Role ID must be a valid Discord ID"))
    .default([]),
  bot_role_ids: z
    .array(z.string().regex(/^\d+$/, "Role ID must be a valid Discord ID"))
    .default([]),
});

export type WelcomeConfig = z.infer<typeof welcomeConfigSchema>;

export interface WelcomeConfigResponse {
  module: string;
  enabled: boolean;
  config: WelcomeConfig;
}

export interface WelcomeStateResponse {
  enabled: boolean;
}

export const DEFAULT_WELCOME_CONFIG: WelcomeConfig = {
  channel_id: null,
  include_image: true,
  auto_role_enabled: true,
  member_role_ids: [],
  bot_role_ids: [],
};

export async function getWelcomeConfig(guildId: string): Promise<WelcomeConfigResponse> {
  return fetchControlPlane<WelcomeConfigResponse>(`/guilds/${guildId}/modules/welcome/config`);
}

export async function setWelcomeConfig(
  guildId: string,
  payload: WelcomeConfig
): Promise<WelcomeConfig> {
  return putControlPlane<WelcomeConfig>(`/guilds/${guildId}/modules/welcome/config`, payload);
}

export async function setWelcomeEnabled(
  guildId: string,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  return putControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/welcome/state`, {
    enabled,
  });
}

export async function getWelcomeState(guildId: string): Promise<{ enabled: boolean }> {
  return fetchControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/welcome/state`);
}
