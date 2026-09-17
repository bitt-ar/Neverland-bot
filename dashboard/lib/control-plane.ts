export class ControlPlaneError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ControlPlaneError";
    this.status = status;
    this.data = data;
  }
}

export interface GuildOverview {
  id: string;
  name: string;
  icon_url: string | null;
  member_count: number | null;
  online_count: number | null;
  channels: {
    text: number;
    voice: number;
    categories: number;
    total: number;
  };
  roles: number;
  bot_status: string;
  stats: {
    reaction_role_pairs: number;
    level_users: number;
    tickets: number;
  };
}

export type ChannelType =
  | "text"
  | "voice"
  | "category"
  | "announcement"
  | "forum"
  | "stage"
  | "other";

export interface GuildChannel {
  id: string;
  name: string;
  type: ChannelType;
  position: number;
}

export interface GuildRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
  managed: boolean;
}

export interface GuildRolesResponse {
  roles: GuildRole[];
  bot_top_role_position: number | null;
}

export interface HealthResponse {
  status: string;
  db: boolean;
  version?: string;
}

const DEFAULT_TIMEOUT_MS = 6000;

export async function fetchControlPlane<T>(
  path: string,
  options: {
    timeoutMs?: number;
    init?: RequestInit;
  } = {}
): Promise<T> {
  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const secret = process.env.CONTROL_PLANE_SECRET;

  if (!secret) {
    throw new ControlPlaneError("CONTROL_PLANE_SECRET is not configured", 403);
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  const url = `${cleanBase}/${cleanPath}`;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options.init,
      headers: {
        "X-Internal-Secret": secret,
        Accept: "application/json",
        ...(options.init?.headers || {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errorMessage =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `Control plane returned HTTP ${res.status}`;
      throw new ControlPlaneError(errorMessage, res.status, data);
    }

    return data as T;
  } catch (err: unknown) {
    if (err instanceof ControlPlaneError) {
      throw err;
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ControlPlaneError(`Request to control plane timed out after ${timeoutMs}ms`, 504);
    }
    const message = err instanceof Error ? err.message : "Unknown error connecting to control plane";
    throw new ControlPlaneError(message, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function postControlPlane<T>(
  path: string,
  body: unknown,
  options: {
    timeoutMs?: number;
    init?: RequestInit;
  } = {}
): Promise<T> {
  return fetchControlPlane<T>(path, {
    ...options,
    init: {
      ...options.init,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.init?.headers || {}),
      },
      body: JSON.stringify(body),
    },
  });
}

export async function putControlPlane<T>(
  path: string,
  body: unknown,
  options: {
    timeoutMs?: number;
    init?: RequestInit;
  } = {}
): Promise<T> {
  return fetchControlPlane<T>(path, {
    ...options,
    init: {
      ...options.init,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(options.init?.headers || {}),
      },
      body: JSON.stringify(body),
    },
  });
}

export async function deleteControlPlane<T>(
  path: string,
  options: {
    timeoutMs?: number;
    init?: RequestInit;
  } = {}
): Promise<T> {
  return fetchControlPlane<T>(path, {
    ...options,
    init: {
      ...options.init,
      method: "DELETE",
    },
  });
}

export async function getGuildOverview(guildId: string): Promise<GuildOverview> {
  return fetchControlPlane<GuildOverview>(`/guilds/${guildId}/overview`);
}

export interface ModuleOverviewItem {
  name: string;
  title: string;
  icon: string;
  description: string;
  enabled: boolean;
  stats?: Record<string, unknown>;
}

export async function getGuildModulesOverview(guildId: string): Promise<ModuleOverviewItem[]> {
  return fetchControlPlane<ModuleOverviewItem[]>(`/guilds/${guildId}/modules/overview`);
}

export async function getGuildChannels(guildId: string): Promise<GuildChannel[]> {
  return fetchControlPlane<GuildChannel[]>(`/guilds/${guildId}/channels`);
}

export async function getGuildRoles(guildId: string): Promise<GuildRolesResponse> {
  return fetchControlPlane<GuildRolesResponse>(`/guilds/${guildId}/roles`);
}

export async function getHealth(): Promise<HealthResponse> {
  const baseUrl = process.env.CONTROL_PLANE_URL || "http://127.0.0.1:8800";
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${cleanBase}/health`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new ControlPlaneError(`Health check returned HTTP ${res.status}`, res.status, data);
    }
    return data as HealthResponse;
  } catch (err: unknown) {
    if (err instanceof ControlPlaneError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Control plane unreachable";
    throw new ControlPlaneError(message, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}
