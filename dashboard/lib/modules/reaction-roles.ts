import { z } from "zod";
import {
  fetchControlPlane,
  postControlPlane,
  putControlPlane,
  deleteControlPlane,
} from "@/lib/control-plane";

export const reactionRolePairSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
  role_id: z.string().regex(/^\d+$/, "A valid role must be selected"),
  order: z.number().int().optional(),
});

export const reactionRoleEmbedSchema = z
  .object({
    title: z.string().max(256, "Title must be at most 256 characters").optional().nullable(),
    description: z.string().max(4096, "Description must be at most 4096 characters").optional().nullable(),
    color: z
      .string()
      .regex(/^#?[0-9a-fA-F]{6}$/, "Must be a valid 6-hex color code (e.g. #5865F2)")
      .optional()
      .nullable()
      .or(z.literal("")),
  })
  .optional()
  .nullable();

export const reactionRoleMessageSchema = z
  .object({
    channel_id: z.string().regex(/^\d+$/, "Channel is required"),
    style: z.enum(["reactions", "buttons", "select"]),
    content: z.string().max(2000, "Content cannot exceed 2000 characters").optional().nullable(),
    embed: reactionRoleEmbedSchema,
    enabled: z.boolean().default(true),
    pairs: z
      .array(reactionRolePairSchema)
      .min(1, "At least one reaction role pair is required"),
  })
  .refine(
    (data) => {
      const maxAllowed = data.style === "select" ? 25 : 20;
      return data.pairs.length <= maxAllowed;
    },
    {
      message: "Maximum pairs exceeded for chosen style (max 20 for reactions/buttons, 25 for select)",
      path: ["pairs"],
    }
  )
  .refine(
    (data) => {
      const emojis = data.pairs.map((p) => p.emoji.trim()).filter(Boolean);
      return new Set(emojis).size === emojis.length;
    },
    {
      message: "Every emoji in the pairs list must be unique",
      path: ["pairs"],
    }
  )
  .refine(
    (data) => {
      const roleIds = data.pairs.map((p) => p.role_id).filter((id) => /^\d+$/.test(id));
      return new Set(roleIds).size === roleIds.length;
    },
    {
      message: "Every role in the pairs list must be unique",
      path: ["pairs"],
    }
  )
  .refine(
    (data) => {
      const hasContent = Boolean(data.content && data.content.trim().length > 0);
      const hasEmbed = Boolean(
        data.embed &&
          ((data.embed.title && data.embed.title.trim().length > 0) ||
            (data.embed.description && data.embed.description.trim().length > 0))
      );
      return hasContent || hasEmbed;
    },
    {
      message: "Either message content or embed (title/description) must be provided",
      path: ["content"],
    }
  );

export type ReactionRolePair = z.infer<typeof reactionRolePairSchema>;
export type ReactionRoleEmbed = z.infer<typeof reactionRoleEmbedSchema>;
export type ReactionRoleMessageInput = z.infer<typeof reactionRoleMessageSchema>;

export interface ReactionRoleMessage {
  guild_id: string;
  message_id: string;
  channel_id: string;
  style: "reactions" | "buttons" | "select";
  content: string | null;
  embed: {
    title?: string | null;
    description?: string | null;
    color?: string | null;
  } | null;
  enabled: boolean;
  pairs: Array<{
    emoji: string;
    role_id: string;
    order: number;
  }>;
}

export interface ReactionRolesListResponse {
  messages: ReactionRoleMessage[];
}

export async function getReactionRoles(guildId: string): Promise<ReactionRolesListResponse> {
  return fetchControlPlane<ReactionRolesListResponse>(`/guilds/${guildId}/reaction-roles`);
}

export async function getReactionRole(
  guildId: string,
  messageId: string
): Promise<ReactionRoleMessage> {
  return fetchControlPlane<ReactionRoleMessage>(`/guilds/${guildId}/reaction-roles/${messageId}`);
}

export async function createReactionRole(
  guildId: string,
  payload: ReactionRoleMessageInput
): Promise<ReactionRoleMessage> {
  return postControlPlane<ReactionRoleMessage>(`/guilds/${guildId}/reaction-roles`, payload);
}

export async function updateReactionRole(
  guildId: string,
  messageId: string,
  payload: ReactionRoleMessageInput
): Promise<ReactionRoleMessage> {
  return putControlPlane<ReactionRoleMessage>(
    `/guilds/${guildId}/reaction-roles/${messageId}`,
    payload
  );
}

export async function deleteReactionRole(
  guildId: string,
  messageId: string
): Promise<{ deleted: boolean }> {
  return deleteControlPlane<{ deleted: boolean }>(
    `/guilds/${guildId}/reaction-roles/${messageId}`
  );
}
