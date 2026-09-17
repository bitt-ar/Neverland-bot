"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Check, Folder, RotateCcw, Save, Volume2 } from "lucide-react";
import { cn, stripEmojis } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface SavedStateItem {
  label: string;
  value: React.ReactNode;
}

export interface SavedStateStripProps {
  /**
   * The list of label/value pairs representing the currently SAVED values.
   */
  items: SavedStateItem[];

  /**
   * True if the draft form differs from the saved baseline.
   */
  isDirty?: boolean;

  /**
   * True while a save operation is in-flight.
   */
  isSaving?: boolean;

  /**
   * Called when the user clicks the inline Save button.
   */
  onSave?: () => void | Promise<void>;

  /**
   * Called when the user clicks the inline Discard button.
   */
  onDiscard?: () => void;

  /**
   * Optional manual override to trigger the temporary ~2s "Saved" flash.
   */
  justSaved?: boolean;

  /**
   * Optional custom className for outer wrapper.
   */
  className?: string;
}

/**
 * Compact, always-visible strip rendered at the top of configuration cards.
 * Displays the persisted baseline values, unsaved indicator + Discard/Save actions,
 * and a 2s green confirmation flash upon successful save.
 */
export function SavedStateStrip({
  items,
  isDirty = false,
  isSaving = false,
  onSave,
  onDiscard,
  justSaved = false,
  className,
}: SavedStateStripProps) {
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const prevIsSaving = useRef(isSaving);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // When isSaving transitions from true to false and card is no longer dirty, flash "Saved" for ~2s
    if (prevIsSaving.current && !isSaving && !isDirty) {
      setShowSavedFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setShowSavedFlash(false);
      }, 2000);
    }
    prevIsSaving.current = isSaving;
  }, [isSaving, isDirty]);

  useEffect(() => {
    if (justSaved) {
      setShowSavedFlash(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setShowSavedFlash(false);
      }, 2000);
    }
  }, [justSaved]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  return (
    <div
      role="region"
      aria-label="Saved configuration baseline"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors duration-180 ease-out-soft",
        isDirty
          ? "border-amber-500/35 bg-amber-500/5 text-foreground"
          : showSavedFlash
          ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
          : "border-border/70 bg-muted/30 text-muted-foreground",
        className
      )}
    >
      {/* Left: Saved values chips / text */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0 select-none mr-0.5">
          Saved:
        </span>
        {items.length === 0 ? (
          <span className="text-muted-foreground italic">No saved configuration</span>
        ) : (
          items.map((item, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && (
                <span className="text-muted-foreground/40 select-none px-0.5">·</span>
              )}
              <span className="inline-flex items-center gap-1">
                <span className="text-muted-foreground font-normal">{item.label}:</span>
                <span className="font-medium text-foreground">{item.value}</span>
              </span>
            </React.Fragment>
          ))
        )}
      </div>

      {/* Right: State indicator and actions */}
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        {isDirty ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              Unsaved changes
            </span>
            {onDiscard && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onDiscard}
                disabled={isSaving}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3 mr-1" />
                <span>Discard</span>
              </Button>
            )}
            {onSave && (
              <Button
                type="button"
                size="xs"
                onClick={onSave}
                disabled={isSaving}
                className="h-6 px-2 text-xs shadow-2xs gap-1"
              >
                <Save className="size-3" />
                <span>{isSaving ? "Saving..." : "Save"}</span>
              </Button>
            )}
          </>
        ) : showSavedFlash ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 transition-opacity duration-180">
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Saved</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 select-none">
            <Check className="size-3 text-emerald-500/70" />
            <span>Saved</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value-Resolution Helpers (never show raw IDs when names can be resolved)
// ---------------------------------------------------------------------------

export function resolveChannelName(
  channelId: number | string | null | undefined,
  channels: { id: string | number; name: string; type?: string }[],
  fallback: string = "None"
): React.ReactNode {
  if (
    channelId === null ||
    channelId === undefined ||
    channelId === "" ||
    channelId === "none"
  ) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  const match = channels.find((c) => String(c.id) === String(channelId));
  if (match) {
    const cleanName = stripEmojis(match.name) || match.name;
    if (match.type === "voice") {
      return (
        <span className="inline-flex items-center gap-1">
          <Volume2 className="size-3 text-muted-foreground" />
          <span>{cleanName}</span>
        </span>
      );
    }
    if (match.type === "category") {
      return (
        <span className="inline-flex items-center gap-1">
          <Folder className="size-3 text-muted-foreground" />
          <span>{cleanName}</span>
        </span>
      );
    }
    return <span>#{cleanName}</span>;
  }
  return <span className="italic text-muted-foreground text-xs">(deleted channel)</span>;
}

export function resolveCategoryName(
  categoryId: number | string | null | undefined,
  channels: { id: string | number; name: string; type?: string }[],
  fallback: string = "None"
): React.ReactNode {
  if (
    categoryId === null ||
    categoryId === undefined ||
    categoryId === "" ||
    categoryId === "none"
  ) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  const match = channels.find((c) => String(c.id) === String(categoryId));
  if (match) {
    const cleanName = stripEmojis(match.name) || match.name;
    return (
      <span className="inline-flex items-center gap-1">
        <Folder className="size-3 text-muted-foreground" />
        <span>{cleanName}</span>
      </span>
    );
  }
  return <span className="italic text-muted-foreground text-xs">(deleted category)</span>;
}

export function resolveRoleName(
  roleId: number | string | null | undefined,
  roles: { id: string | number; name: string }[],
  fallback: string = "None"
): React.ReactNode {
  if (
    roleId === null ||
    roleId === undefined ||
    roleId === "" ||
    roleId === "none"
  ) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }
  const match = roles.find((r) => String(r.id) === String(roleId));
  if (match) {
    const cleanName = stripEmojis(match.name) || match.name;
    return <span>@{cleanName}</span>;
  }
  return <span className="italic text-muted-foreground text-xs">(deleted role)</span>;
}
