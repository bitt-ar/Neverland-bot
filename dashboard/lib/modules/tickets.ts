import { z } from "zod";
import { fetchControlPlane, putControlPlane, postControlPlane } from "@/lib/control-plane";

export const panelEmbedSchema = z
  .object({
    title: z.string().max(256, "Title cannot exceed 256 characters").nullable().optional(),
    description: z.string().max(4000, "Description cannot exceed 4000 characters").nullable().optional(),
    color: z
      .string()
      .regex(/^#?([0-9a-fA-F]{6})$/, "Color must be a valid 6-digit hex code, e.g. #5865F2")
      .nullable()
      .optional()
      .or(z.literal("")),
  })
  .nullable()
  .optional();

export const ticketCategorySchema = z.object({
  id: z
    .string()
    .min(1, "Category slug cannot be empty")
    .max(32, "Category slug cannot exceed 32 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Slug can only contain letters, numbers, hyphens, and underscores"),
  name: z
    .string()
    .min(1, "Category name cannot be empty")
    .max(100, "Category name cannot exceed 100 characters"),
  emoji: z.string().max(32, "Emoji is too long").default(""),
  category_channel_id: z
    .string()
    .regex(/^\d+$/, "Category channel ID must be a valid Discord ID")
    .nullable()
    .default(null),
  staff_role_ids: z
    .array(z.string().regex(/^\d+$/, "Role ID must be a valid Discord ID"))
    .default([]),
  naming: z
    .string()
    .min(1, "Naming pattern cannot be empty")
    .max(80, "Naming pattern cannot exceed 80 characters")
    .default("ticket-{username}-{number}"),
});

export const ticketsConfigSchema = z.object({
  panel_channel_id: z
    .string()
    .regex(/^\d+$/, "Channel ID must be a valid Discord ID")
    .nullable()
    .default(null),
  panel_content: z.string().max(2000, "Content cannot exceed 2000 characters").default(""),
  panel_embed: panelEmbedSchema,
  button_label: z
    .string()
    .min(1, "Button label cannot be empty")
    .max(80, "Button label cannot exceed 80 characters")
    .default("Open a ticket"),
  button_emoji: z.string().max(32, "Emoji is too long").default(""),
  categories: z
    .array(ticketCategorySchema)
    .max(25, "Maximum 25 categories allowed")
    .default([])
    .superRefine((cats, ctx) => {
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      cats.forEach((cat, index) => {
        const idLower = cat.id.trim().toLowerCase();
        const nameLower = cat.name.trim().toLowerCase();
        if (seenIds.has(idLower)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate category slug "${cat.id}"`,
            path: [index, "id"],
          });
        }
        seenIds.add(idLower);
        if (seenNames.has(nameLower)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate category name "${cat.name}"`,
            path: [index, "name"],
          });
        }
        seenNames.add(nameLower);
      });
    }),
});

export type PanelEmbed = z.infer<typeof panelEmbedSchema>;
export type TicketCategory = z.infer<typeof ticketCategorySchema>;
export type TicketsConfig = z.infer<typeof ticketsConfigSchema>;

export interface TicketsConfigResponse {
  module: string;
  enabled: boolean;
  config: TicketsConfig;
}

export interface TicketItem {
  id: string;
  channel_id: string;
  user_id: string;
  category_id: string;
  status: "open" | "claimed" | "closed";
  claimed_by: string | null;
  participants: string[];
  number: number;
  created_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
}

export interface TicketsSummaryResponse {
  open_count: number;
  total_count: number;
}

export interface PublishPanelResponse {
  ok: boolean;
  message_id: string;
  channel_id: string;
}

export const DEFAULT_TICKETS_CONFIG: TicketsConfig = {
  panel_channel_id: null,
  panel_content: "Need help? Open a support ticket below.",
  panel_embed: {
    title: "Support Tickets",
    description: "Select a category from the menu to open a private support ticket with our team.",
    color: "#5865F2",
  },
  button_label: "Open a ticket",
  button_emoji: "",
  categories: [
    {
      id: "general",
      name: "General Support",
      emoji: "",
      category_channel_id: null,
      staff_role_ids: [],
      naming: "ticket-{username}-{number}",
    },
  ],
};

export async function getTicketsConfig(guildId: string): Promise<TicketsConfigResponse> {
  return fetchControlPlane<TicketsConfigResponse>(`/guilds/${guildId}/modules/tickets/config`);
}

export async function setTicketsConfig(guildId: string, payload: TicketsConfig): Promise<TicketsConfig> {
  return putControlPlane<TicketsConfig>(`/guilds/${guildId}/modules/tickets/config`, payload);
}

export async function getTicketsState(guildId: string): Promise<{ enabled: boolean }> {
  return fetchControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/tickets/state`);
}

export async function setTicketsEnabled(guildId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return putControlPlane<{ enabled: boolean }>(`/guilds/${guildId}/modules/tickets/state`, { enabled });
}

export async function getTicketsSummary(guildId: string): Promise<TicketsSummaryResponse> {
  return fetchControlPlane<TicketsSummaryResponse>(`/guilds/${guildId}/tickets`);
}

export async function getTicketsList(guildId: string): Promise<TicketItem[]> {
  return fetchControlPlane<TicketItem[]>(`/guilds/${guildId}/tickets/list`);
}

export async function publishTicketsPanel(guildId: string): Promise<PublishPanelResponse> {
  return postControlPlane<PublishPanelResponse>(`/guilds/${guildId}/tickets/publish-panel`, {});
}
