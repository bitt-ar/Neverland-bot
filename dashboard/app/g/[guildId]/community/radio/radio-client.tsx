"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play,
  Square,
  Repeat,
  Upload,
  Plus,
  Trash2,
  Volume2,
  Bot,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  ExternalLink,
  Music,
  FileAudio,
  Shield,
  Layers,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PageLoadingSkeleton } from "@/components/page-loading-skeleton";

interface RadioBot {
  slot: number;
  name: string;
  id: string | null;
  avatar: string | null;
  is_configured: boolean;
  is_online: boolean;
  in_voice: boolean;
  channel_id: string | null;
  channel_name: string | null;
  is_playing: boolean;
  current_track: { id: string; title: string; duration: number } | null;
  has_token?: boolean;
  masked_token?: string | null;
  active_stream?: Record<string, unknown> | null;
}

interface RadioPlaylist {
  id: string;
  name: string;
  loop: boolean;
  track_count: number;
  total_size_bytes: number;
  total_size_mb: number;
  max_size_mb: number;
  total_duration_seconds: number;
  created_at: string;
}

interface RadioTrack {
  id: string;
  title: string;
  original_filename: string;
  file_size_bytes: number;
  duration_seconds: number;
  order: number;
  mime_type: string;
  created_at: string;
}

interface GuildChannel {
  id: string;
  name: string;
  type: string;
}

interface RadioConfig {
  max_playlist_storage_mb: number;
  max_playlists_per_guild: number;
  max_upload_size_mb: number;
  radio_bots_count: number;
  default_volume: number;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function RadioClient({ guildId }: { guildId: string }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Core data states
  const [bots, setBots] = useState<RadioBot[]>([]);
  const [playlists, setPlaylists] = useState<RadioPlaylist[]>([]);
  const [voiceChannels, setVoiceChannels] = useState<GuildChannel[]>([]);
  const [config, setConfig] = useState<RadioConfig>({
    max_playlist_storage_mb: 50,
    max_playlists_per_guild: 6,
    max_upload_size_mb: 25,
    radio_bots_count: 3,
    default_volume: 100,
  });

  // Dispatcher form state
  const [selectedBotSlot, setSelectedBotSlot] = useState<number>(0);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [loopEnabled, setLoopEnabled] = useState<boolean>(true);
  const [dispatching, setDispatching] = useState<boolean>(false);

  // Playlists management state
  const [activePlaylistId, setActivePlaylistId] = useState<string>("");
  const [playlistTracks, setPlaylistTracks] = useState<Record<string, RadioTrack[]>>({});
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Auxiliary Bots token configuration state
  const [aux1Token, setAux1Token] = useState("");
  const [aux2Token, setAux2Token] = useState("");
  const [savingAux1, setSavingAux1] = useState(false);
  const [savingAux2, setSavingAux2] = useState(false);
  const [inviteUrls, setInviteUrls] = useState<{ [slot: number]: string }>({});

  // Memoized maps for Select items label display
  const channelItemsMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of voiceChannels) {
      map[c.id] = `🔊 ${c.name}`;
    }
    return map;
  }, [voiceChannels]);

  const playlistItemsMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of playlists) {
      map[p.id] = `🎵 ${p.name}`;
    }
    return map;
  }, [playlists]);

  const selectedChannel = voiceChannels.find((c) => c.id === selectedChannelId);
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadPlaylistTracks = useCallback(
    async (pid: string) => {
      if (!pid) return;
      try {
        const res = await fetch(`/api/internal/guilds/${guildId}/radio/playlists/${pid}/tracks`);
        if (res.ok) {
          const tracks = await res.json();
          setPlaylistTracks((prev) => ({ ...prev, [pid]: tracks }));
        }
      } catch {
        toast.error("Failed to fetch playlist tracks.");
      }
    },
    [guildId]
  );

  const fetchData = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);

      try {
        const [cfgRes, botsRes, plRes, chRes] = await Promise.all([
          fetch(`/api/internal/guilds/${guildId}/radio/config`),
          fetch(`/api/internal/guilds/${guildId}/radio/bots`),
          fetch(`/api/internal/guilds/${guildId}/radio/playlists`),
          fetch(`/api/internal/guilds/${guildId}/channels`),
        ]);

        if (cfgRes.ok) {
          const cfgData = await cfgRes.json();
          setConfig(cfgData);
        }

        if (botsRes.ok) {
          const botsData = await botsRes.json();
          setBots(botsData);
        }

        let firstPlId = "";
        if (plRes.ok) {
          const plData = await plRes.json();
          setPlaylists(plData);
          if (plData.length > 0) {
            firstPlId = plData[0].id;
          }
          setSelectedPlaylistId((prev) => prev || firstPlId);
          setActivePlaylistId((prev) => {
            const target = prev || firstPlId;
            if (target) {
              loadPlaylistTracks(target);
            }
            return target;
          });
        }

        if (chRes.ok) {
          const chData = await chRes.json();
          const vChannels = chData.filter(
            (c: GuildChannel) => c.type === "voice" || c.type === "stage"
          );
          setVoiceChannels(vChannels);
          if (vChannels.length > 0) {
            setSelectedChannelId((prev) => prev || vChannels[0].id);
          }
        }
      } catch {
        toast.error("Failed to load radio status.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [guildId, loadPlaylistTracks]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (activePlaylistId) {
      loadPlaylistTracks(activePlaylistId);
    }
  }, [activePlaylistId, loadPlaylistTracks]);

  // Broadcast Actions
  const handleStartBroadcast = async () => {
    if (!selectedChannelId) {
      toast.error("Please select a voice channel.");
      return;
    }
    if (!selectedPlaylistId) {
      toast.error("Please select a playlist.");
      return;
    }

    setDispatching(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_slot: selectedBotSlot,
          voice_channel_id: selectedChannelId,
          playlist_id: selectedPlaylistId,
          loop: loopEnabled,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to start broadcast.");
      } else {
        toast.success(data.message || "Broadcast started successfully!");
        fetchData(true);
      }
    } catch {
      toast.error("Network error starting broadcast.");
    } finally {
      setDispatching(false);
    }
  };

  const handleStopBroadcast = async (slot: number) => {
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_slot: slot }),
      });

      if (res.ok) {
        toast.success(`Broadcast stopped for Bot ${slot === 0 ? "Main" : slot}.`);
        fetchData(true);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to stop stream.");
      }
    } catch {
      toast.error("Network error stopping broadcast.");
    }
  };

  // Playlists Management
  const handleCreatePlaylist = async () => {
    if (playlists.length >= 3) {
      toast.error("Maximum 3 playlists allowed per server.");
      return;
    }

    setCreatingPlaylist(true);
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/playlists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPlaylistName || `Playlist ${playlists.length + 1}` }),
      });

      if (res.ok) {
        toast.success("Playlist created successfully!");
        setNewPlaylistName("");
        await fetchData(true);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create playlist.");
      }
    } catch {
      toast.error("Network error creating playlist.");
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleDeletePlaylist = async (pid: string) => {
    if (!confirm("Are you sure you want to delete this playlist and all its audio tracks?")) return;

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/playlists/${pid}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Playlist deleted.");
        fetchData(true);
      } else {
        toast.error("Failed to delete playlist.");
      }
    } catch {
      toast.error("Network error deleting playlist.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activePlaylistId) return;

    const file = files[0];
    const maxUploadBytes = (config.max_upload_size_mb || 25) * 1024 * 1024;
    if (file.size > maxUploadBytes) {
      toast.error(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed upload size of ${config.max_upload_size_mb || 25} MB.`
      );
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    const toastId = toast.loading(`Uploading "${file.name}"...`);

    try {
      const res = await fetch(
        `/api/internal/guilds/${guildId}/radio/playlists/${activePlaylistId}/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();
      if (res.ok) {
        toast.success(`"${file.name}" added to playlist!`, { id: toastId });
        await loadPlaylistTracks(activePlaylistId);
        await fetchData(true);
      } else {
        toast.error(data.error || "Failed to upload audio file.", { id: toastId });
      }
    } catch {
      toast.error("Upload error. Check network or file size.", { id: toastId });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteTrack = async (pid: string, tid: string) => {
    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/playlists/${pid}/tracks/${tid}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Track removed.");
        await loadPlaylistTracks(pid);
        await fetchData(true);
      } else {
        toast.error("Failed to delete track.");
      }
    } catch {
      toast.error("Network error deleting track.");
    }
  };

  // Aux Bots Management
  const handleSaveAuxBot = async (slot: 1 | 2) => {
    const token = slot === 1 ? aux1Token : aux2Token;
    if (!token.trim()) {
      toast.error("Please enter a valid Discord bot token.");
      return;
    }

    if (slot === 1) setSavingAux1(true);
    else setSavingAux2(true);

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_slot: slot, token: token.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Auxiliary Bot ${slot} configured successfully!`);
        if (slot === 1) setAux1Token("");
        else setAux2Token("");
        if (data.invite_url) {
          setInviteUrls((prev) => ({ ...prev, [slot]: data.invite_url }));
        }
        await fetchData(true);
      } else {
        toast.error(data.error || `Failed to configure bot slot ${slot}.`);
      }
    } catch {
      toast.error("Network error saving bot token.");
    } finally {
      if (slot === 1) setSavingAux1(false);
      else setSavingAux2(false);
    }
  };

  const handleDeleteAuxBot = async (slot: 1 | 2) => {
    if (!confirm(`Are you sure you want to remove Auxiliary Bot ${slot}?`)) return;

    try {
      const res = await fetch(`/api/internal/guilds/${guildId}/radio/bots/${slot}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success(`Auxiliary Bot ${slot} removed.`);
        await fetchData(true);
      } else {
        toast.error("Failed to remove auxiliary bot.");
      }
    } catch {
      toast.error("Network error removing bot.");
    }
  };


  const activeStreamsCount = bots.filter((b) => b.is_playing).length;

  if (loading) {
    return (
      <PageLoadingSkeleton
        title="Radio & 24/7 Broadcast"
        description="Fetching playlists, bot slots, and voice channels..."
      />
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Radio & 24/7 Broadcast</h1>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-mono text-xs">
              Multi-Bot 24/7
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stream 24/7 audio playlists across up to 3 voice channels simultaneously using Main and Auxiliary bots.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="gap-2 border-border hover:border-emerald-500/40 hover:text-emerald-400 h-8 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-emerald-500" : ""}`} />
          Refresh Status
        </Button>
      </div>

      {/* Top Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-border/70 hover:border-emerald-500/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Broadcast Bots</CardTitle>
            <Bot className="h-4 w-4 text-emerald-500/80" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {bots.filter((b) => b.is_configured).length} / {config.radio_bots_count || 3}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              1 Primary + {Math.max(0, (config.radio_bots_count || 3) - 1)} Auxiliary Slots
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/70 hover:border-emerald-500/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Playlists Quota</CardTitle>
            <Layers className="h-4 w-4 text-emerald-500/80" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {playlists.length} / {config.max_playlists_per_guild || 6}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Maximum {config.max_playlists_per_guild || 6} allowed</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/70 hover:border-emerald-500/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Storage Quota</CardTitle>
            <HardDrive className="h-4 w-4 text-emerald-500/80" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{config.max_playlist_storage_mb} MB</div>
            <p className="text-xs text-muted-foreground mt-1">
              Per playlist (Total: {(config.max_playlists_per_guild || 6) * config.max_playlist_storage_mb} MB)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/70 hover:border-emerald-500/30 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Broadcasts</CardTitle>
            <Volume2 className="h-4 w-4 text-emerald-500/80" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeStreamsCount} <span className="text-sm font-normal text-muted-foreground">Live</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Voice connections active
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="dispatcher" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-[480px] bg-muted/40 p-1 border border-border/50 rounded-lg">
          <TabsTrigger
            value="dispatcher"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all text-xs"
          >
            Dispatch
          </TabsTrigger>
          <TabsTrigger
            value="playlists"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all text-xs"
          >
            Playlists
          </TabsTrigger>
          <TabsTrigger
            value="bots"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all text-xs"
          >
            Bots (3)
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all text-xs"
          >
            Settings
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: DISPATCHER CONSOLE */}
        <TabsContent value="dispatcher" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Dispatcher Form */}
            <Card className="lg:col-span-2 border-border/80 hover:border-emerald-500/30 transition-colors">
              <CardHeader>
                <CardTitle>Live Broadcast Dispatcher</CardTitle>
                <CardDescription>
                  Select a bot instance, target voice channel, and playlist to initiate or update a broadcast.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* 1. Bot Selector */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">1. Select Broadcast Bot</Label>
                  <div
                    className={`grid grid-cols-1 ${
                      (config.radio_bots_count || 3) === 1
                        ? "sm:grid-cols-1 max-w-sm"
                        : (config.radio_bots_count || 3) === 2
                        ? "sm:grid-cols-2"
                        : "sm:grid-cols-3"
                    } gap-3`}
                  >
                    {bots.map((b) => {
                      const isSelected = selectedBotSlot === b.slot;
                      return (
                        <div
                          key={b.slot}
                          onClick={() => setSelectedBotSlot(b.slot)}
                          className={`cursor-pointer rounded-lg border p-3 transition-all ${
                            isSelected
                              ? "border-primary bg-primary/10 shadow-sm"
                              : "border-border hover:border-muted-foreground/40 bg-card/40"
                          } ${!b.is_configured ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">
                              {b.slot === 0 ? "Main Bot" : `Aux Bot ${b.slot}`}
                            </span>
                            {b.is_playing ? (
                              <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 text-xs">
                                Live
                              </Badge>
                            ) : b.is_online ? (
                              <Badge variant="outline" className="text-muted-foreground text-xs">
                                Ready
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                Offline
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {b.name || (b.slot === 0 ? "Neverland" : "Unconfigured")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Voice Channel Selector */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">2. Select Target Voice Channel</Label>
                  {voiceChannels.length === 0 ? (
                    <p className="text-xs text-amber-400">No voice channels found in this server.</p>
                  ) : (
                    <Select
                      items={channelItemsMap}
                      value={selectedChannelId}
                      onValueChange={(val) => setSelectedChannelId(val || "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a voice channel">
                          {selectedChannel ? `🔊 ${selectedChannel.name}` : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {voiceChannels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            🔊 {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* 3. Playlist Selector */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">3. Select Playlist</Label>
                  {playlists.length === 0 ? (
                    <p className="text-xs text-amber-400">
                      No playlists available. Please create a playlist in the Playlists tab first.
                    </p>
                  ) : (
                    <Select
                      items={playlistItemsMap}
                      value={selectedPlaylistId}
                      onValueChange={(val) => setSelectedPlaylistId(val || "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select playlist">
                          {selectedPlaylist
                            ? `🎵 ${selectedPlaylist.name} (${selectedPlaylist.track_count} tracks • ${selectedPlaylist.total_size_mb} MB)`
                            : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {playlists.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            🎵 {p.name} ({p.track_count} tracks • {p.total_size_mb} MB)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* 4. Continuous Loop Switch */}
                <div className="flex items-center justify-between rounded-lg border p-4 bg-background/50">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Repeat className="h-4 w-4 text-primary" />
                      <Label className="text-sm font-medium">Repeat Continuously (24/7 Loop)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When enabled, the bot repeats the playlist indefinitely without stopping.
                    </p>
                  </div>
                  <Switch checked={loopEnabled} onCheckedChange={setLoopEnabled} />
                </div>
              </CardContent>
              <CardFooter className="flex gap-3 justify-end border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => handleStopBroadcast(selectedBotSlot)}
                  className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Square className="h-4 w-4" />
                  Stop Bot {selectedBotSlot === 0 ? "Main" : selectedBotSlot}
                </Button>
                <Button
                  onClick={handleStartBroadcast}
                  disabled={dispatching || playlists.length === 0 || voiceChannels.length === 0}
                  className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow-sm"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {dispatching ? "Sending..." : "Start Broadcast (Send)"}
                </Button>
              </CardFooter>
            </Card>

            {/* Live Streaming Monitor Cards */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Live Channels Monitor
              </h3>
              {bots.map((b) => (
                <Card key={b.slot} className="bg-card/60">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            b.is_playing ? "bg-emerald-500 animate-pulse" : "bg-muted"
                          }`}
                        />
                        <span className="font-semibold text-sm">
                          {b.slot === 0 ? "Main Bot" : `Aux Bot ${b.slot}`}
                        </span>
                      </div>
                      {b.is_playing ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                          Broadcasting
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Idle
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-1 space-y-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Channel:</span>
                      <span className="text-foreground font-medium">
                        {b.channel_name ? `🔊 ${b.channel_name}` : "Not in voice"}
                      </span>
                    </div>
                    {b.is_playing && b.current_track && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Track:</span>
                        <span className="text-primary font-medium truncate max-w-[140px]">
                          {b.current_track.title}
                        </span>
                      </div>
                    )}
                    {b.is_playing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStopBroadcast(b.slot)}
                        className="w-full text-destructive hover:bg-destructive/10 h-7 text-xs mt-2"
                      >
                        Stop Stream
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: PLAYLISTS & AUDIO MANAGER */}
        <TabsContent value="playlists" className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Playlists Management</h2>
                <Badge variant="outline" className="text-xs">
                  {playlists.length} / {config.max_playlists_per_guild || 6}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage playlists, upload audio tracks (MP3, OGG, WAV, FLAC), and organize music.
              </p>
            </div>
            {playlists.length < (config.max_playlists_per_guild || 6) ? (
              <div className="flex gap-2">
                <Input
                  placeholder="Playlist Name"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  className="w-48 h-9 text-xs"
                />
                <Button
                  size="sm"
                  onClick={handleCreatePlaylist}
                  disabled={creatingPlaylist}
                  className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
                >
                  <Plus className="h-4 w-4" />
                  Create
                </Button>
              </div>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400 py-1.5 px-3 text-xs">
                Playlist Quota Reached ({playlists.length}/{config.max_playlists_per_guild || 6})
              </Badge>
            )}
          </div>

          {/* Quota Formula Notice */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary shrink-0" />
              <span>
                <strong>Storage Policy:</strong> {config.max_playlist_storage_mb} MB quota applies to <strong>each</strong> playlist independently.
              </span>
            </div>
            <div className="text-muted-foreground font-mono">
              Server Total: {config.max_playlists_per_guild || 6} playlists × {config.max_playlist_storage_mb} MB = {(config.max_playlists_per_guild || 6) * config.max_playlist_storage_mb} MB potential storage
            </div>
          </div>

          {/* Playlists Tabs / Selector */}
          {playlists.length === 0 ? (
            <Card className="p-8 text-center bg-card/30">
              <Music className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-40" />
              <h3 className="text-base font-semibold">No Playlists Created Yet</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Create your first playlist above to start uploading audio files and streaming.
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="flex gap-2 border-b pb-2 overflow-x-auto flex-nowrap scrollbar-none py-1">
                {playlists.map((pl) => (
                  <Button
                    key={pl.id}
                    variant={activePlaylistId === pl.id ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setActivePlaylistId(pl.id);
                      loadPlaylistTracks(pl.id);
                    }}
                    className={`gap-2 font-medium shrink-0 transition-all ${
                      activePlaylistId === pl.id
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Music className={`h-4 w-4 ${activePlaylistId === pl.id ? "text-emerald-400" : "text-muted-foreground"}`} />
                    <span className="truncate max-w-[150px]">{pl.name}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ml-1 ${
                        activePlaylistId === pl.id
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : ""
                      }`}
                    >
                      {pl.track_count}
                    </Badge>
                  </Button>
                ))}
              </div>

              {/* Active Playlist Details */}
              {playlists
                .filter((pl) => pl.id === activePlaylistId)
                .map((pl) => {
                  const tracks = playlistTracks[pl.id] || [];
                  const usedPercent = Math.min(
                    100,
                    Math.round((pl.total_size_mb / (pl.max_size_mb || 100)) * 100)
                  );
                  return (
                    <Card key={pl.id} className="space-y-4 p-6">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold">{pl.name}</h3>
                            <Badge variant="secondary" className="text-xs">
                              {pl.track_count} Tracks
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Total Duration: {formatDuration(pl.total_duration_seconds)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="file"
                            ref={fileInputRef}
                            accept="audio/mp3,audio/mpeg,audio/ogg,audio/wav,audio/flac"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                          <Button
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow-xs"
                          >
                            <Upload className="h-4 w-4" />
                            {uploading ? "Uploading..." : `Upload Audio (Max ${config.max_upload_size_mb || 25} MB)`}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeletePlaylist(pl.id)}
                            className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Storage Progress */}
                      <div className="space-y-1.5 rounded-lg border p-3 bg-card/40">
                        <div className="flex justify-between text-xs font-medium">
                          <span>Playlist Storage Usage</span>
                          <span
                            className={
                              usedPercent > 90
                                ? "text-destructive font-bold"
                                : "text-muted-foreground"
                            }
                          >
                            {pl.total_size_mb} MB / {pl.max_size_mb} MB ({usedPercent}%)
                          </span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              usedPercent > 90 ? "bg-destructive" : "bg-primary"
                            }`}
                            style={{ width: `${usedPercent}%` }}
                          />
                        </div>
                      </div>

                      {/* Tracks List */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Audio Tracks ({tracks.length})
                        </h4>
                        {tracks.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                            No tracks uploaded in this playlist yet. Click &quot;Upload Audio&quot; to add files.
                          </div>
                        ) : (
                          <div className="divide-y rounded-lg border">
                            {tracks.map((t, idx) => (
                              <div
                                key={t.id}
                                className="flex items-center justify-between p-3 text-xs hover:bg-muted/30 transition-colors"
                              >
                                <div className="flex items-center gap-3 truncate pr-4">
                                  <span className="text-muted-foreground w-5 text-right font-mono">
                                    {idx + 1}
                                  </span>
                                  <FileAudio className="h-4 w-4 text-primary shrink-0" />
                                  <div className="truncate">
                                    <p className="font-medium text-foreground truncate">{t.title}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {t.original_filename} • {(t.file_size_bytes / (1024 * 1024)).toFixed(2)} MB
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 shrink-0">
                                  <span className="text-muted-foreground font-mono">
                                    {formatDuration(t.duration_seconds)}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteTrack(pl.id, t.id)}
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>

        {/* TAB 3: AUXILIARY BOTS CONFIGURATION */}
        <TabsContent value="bots" className="space-y-6">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-3 items-start">
            <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-foreground">Multi-Bot Voice Architecture</p>
              <p className="text-muted-foreground">
                Discord limits a single bot account to 1 voice connection per server. Currently,{" "}
                <strong>{config.radio_bots_count || 3} bot {config.radio_bots_count === 1 ? "instance" : "instances"}</strong>{" "}
                are enabled in your environment. Tokens are securely encrypted using AES-256 at rest.
                {(config.radio_bots_count || 3) < 3 && (
                  <span> To change the number of active bots (1 to 3), run <code className="bg-background px-1 rounded font-mono">neverland config</code>.</span>
                )}
              </p>
            </div>
          </div>

          {(config.radio_bots_count || 3) === 1 ? (
            <Card className="p-8 text-center bg-card/30">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-3 opacity-40" />
              <h3 className="text-base font-semibold">Single Bot Mode Enabled</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Auxiliary bots are disabled under current configuration (RADIO_BOTS_COUNT=1).
                The primary bot manages all voice streaming for one channel at a time.
                To activate auxiliary bots for multiple concurrent channels, update your configuration with <code className="font-mono bg-muted px-1.5 py-0.5 rounded">neverland config</code>.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Slot 1: Aux Bot 1 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">Auxiliary Bot 1</CardTitle>
                    </div>
                    {bots.find((b) => b.slot === 1)?.is_configured ? (
                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Not Configured
                      </Badge>
                    )}
                  </div>
                  <CardDescription>Second bot instance for simultaneous voice streaming.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {bots.find((b) => b.slot === 1)?.is_configured && (
                    <div className="rounded-lg border p-3 bg-muted/20 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bot Username:</span>
                        <span className="font-semibold">{bots.find((b) => b.slot === 1)?.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Masked Token:</span>
                        <span className="font-mono">{bots.find((b) => b.slot === 1)?.masked_token}</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Discord Bot Token</Label>
                    <Input
                      type="password"
                      placeholder="Enter bot token..."
                      value={aux1Token}
                      onChange={(e) => setAux1Token(e.target.value)}
                      className="text-xs font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Get token from Discord Developer Portal &gt; Applications &gt; Bot &gt; Reset Token.
                    </p>
                  </div>

                  {inviteUrls[1] && (
                    <div className="p-2.5 rounded bg-primary/10 border border-primary/20 flex justify-between items-center text-xs">
                      <span>Invite this bot to your server:</span>
                      <a
                        href={inviteUrls[1]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary font-semibold hover:underline inline-flex items-center gap-1"
                      >
                        Invite Bot <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between border-t pt-4">
                  {bots.find((b) => b.slot === 1)?.is_configured ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteAuxBot(1)}
                      className="text-destructive hover:bg-destructive/10 text-xs"
                    >
                      Remove Bot
                    </Button>
                  ) : (
                    <div />
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleSaveAuxBot(1)}
                    disabled={savingAux1 || !aux1Token.trim()}
                    className="gap-2 text-xs"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {savingAux1 ? "Connecting..." : "Save & Verify"}
                  </Button>
                </CardFooter>
              </Card>

              {/* Slot 2: Aux Bot 2 (if radio_bots_count >= 3) */}
              {(config.radio_bots_count || 3) >= 3 ? (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">Auxiliary Bot 2</CardTitle>
                      </div>
                      {bots.find((b) => b.slot === 2)?.is_configured ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                          Configured
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Not Configured
                        </Badge>
                      )}
                    </div>
                    <CardDescription>Third bot instance for simultaneous voice streaming.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {bots.find((b) => b.slot === 2)?.is_configured && (
                      <div className="rounded-lg border p-3 bg-muted/20 text-xs space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Bot Username:</span>
                          <span className="font-semibold">{bots.find((b) => b.slot === 2)?.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Masked Token:</span>
                          <span className="font-mono">{bots.find((b) => b.slot === 2)?.masked_token}</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Discord Bot Token</Label>
                      <Input
                        type="password"
                        placeholder="Enter bot token..."
                        value={aux2Token}
                        onChange={(e) => setAux2Token(e.target.value)}
                        className="text-xs font-mono"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Get token from Discord Developer Portal &gt; Applications &gt; Bot &gt; Reset Token.
                      </p>
                    </div>

                    {inviteUrls[2] && (
                      <div className="p-2.5 rounded bg-primary/10 border border-primary/20 flex justify-between items-center text-xs">
                        <span>Invite this bot to your server:</span>
                        <a
                          href={inviteUrls[2]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          Invite Bot <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex justify-between border-t pt-4">
                    {bots.find((b) => b.slot === 2)?.is_configured ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAuxBot(2)}
                        className="text-destructive hover:bg-destructive/10 text-xs"
                      >
                        Remove Bot
                      </Button>
                    ) : (
                      <div />
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSaveAuxBot(2)}
                      disabled={savingAux2 || !aux2Token.trim()}
                      className="gap-2 text-xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {savingAux2 ? "Connecting..." : "Save & Verify"}
                    </Button>
                  </CardFooter>
                </Card>
              ) : (
                <Card className="opacity-60 border-dashed">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                      <CardTitle className="text-base text-muted-foreground">Auxiliary Bot 2 (Slot 2)</CardTitle>
                    </div>
                    <CardDescription>Slot disabled under current configuration (RADIO_BOTS_COUNT=2).</CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    To enable a 3rd concurrent voice stream, set Radio Bots to 3 in <code className="font-mono bg-muted px-1.5 py-0.5 rounded">neverland config</code>.
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* TAB 4: RADIO SETTINGS */}
        <TabsContent value="settings" className="space-y-6">
          <Card className="max-w-2xl border-primary/20">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Radio Storage & Quota Policy</CardTitle>
                </div>
                <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary text-xs">
                  <Lock className="h-3 w-3" /> Enforced by Bot Owner
                </Badge>
              </div>
              <CardDescription>
                Storage constraints are globally governed by the Bot Owner via the server environment (.env).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Maximum Storage Allowed Per Playlist:</span>
                  <span className="text-base font-bold text-primary">{config.max_playlist_storage_mb} MB</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Configured in <code className="bg-background px-1.5 py-0.5 rounded text-xs border font-mono">.env</code> via <code className="bg-background px-1.5 py-0.5 rounded text-xs border font-mono">RADIO_MAX_PLAYLIST_STORAGE_MB</code>.
                  Whenever the bot restarts, it updates and syncs the database with this value to ensure server and disk resources are protected.
                </p>
              </div>

              <Separator />

              <div className="space-y-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Specifications & Active Constraints:</p>
                <ul className="list-disc list-inside space-y-1.5 pl-1">
                  <li>Maximum <strong>{config.max_playlists_per_guild || 6} playlists</strong> allowed per Discord server.</li>
                  <li>Storage quota: <strong>{config.max_playlist_storage_mb} MB</strong> per playlist (validated at backend and database layers).</li>
                  <li>
                    Server total capacity: {config.max_playlists_per_guild || 6} playlists × {config.max_playlist_storage_mb} MB ={" "}
                    <strong className="text-primary font-mono">{(config.max_playlists_per_guild || 6) * config.max_playlist_storage_mb} MB</strong> maximum audio storage.
                  </li>
                  <li>Single audio track upload limit: <strong>{config.max_upload_size_mb || 25} MB</strong>.</li>
                  <li>Allowed audio formats: MP3, OGG, WAV, FLAC (magic bytes binary validation enforced).</li>
                  <li>
                    Concurrent streaming capacity: Up to {config.radio_bots_count || 3} separate voice channels simultaneously{" "}
                    ({(config.radio_bots_count || 3) === 1 ? "Main Bot only" : (config.radio_bots_count || 3) === 2 ? "Main + 1 Aux Bot" : "Main + 2 Aux Bots"}).
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
