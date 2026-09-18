export interface GiveawayItem {
  _id: string;
  guild_id: string | number;
  channel_id: string | number;
  message_id: string;
  title?: string;
  Title?: string;
  winners_count?: number;
  Winner?: number;
  duration?: number;
  end_time?: number;
  created_at?: string;
  concluded?: boolean;
  concluded_at?: string;
  entrants?: string[];
  Entrants?: string[];
  winners?: string[];
  Winners?: string[];
  required_role_ids?: (string | number)[];
  role_multipliers?: Record<string, number>;
  image_url?: string;
  description?: string;
  Description?: string;
  status?: string;
  channel?: string;
  Channel?: string;
}

export interface GiveawaysConfig {
  guild_id?: string | number;
  logs_channel_id: string | null;
  manager_role_ids: string[];
}

export interface GiveawaysResponse {
  giveaways: GiveawayItem[];
  config: GiveawaysConfig;
}

export interface CreateGiveawayPayload {
  channel_id: string;
  title: string;
  winners_count: number;
  duration_seconds: number;
  description?: string;
  image_url?: string;
  required_role_ids?: string[];
  role_multipliers?: Record<string, number>;
}
