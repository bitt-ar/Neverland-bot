"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "cn"
import { Search, X, ChevronDownIcon } from "lucide-react"
import { SelectItem } from "./select"

export interface SelectOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export interface SelectSearchableProps {
  id?: string
  value?: string | null
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  size?: "sm" | "default"
  "aria-invalid"?: boolean | "true" | "false"
}

export function SelectSearchable({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select an option...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  className,
  size = "default",
  "aria-invalid": ariaInvalid,
}: SelectSearchableProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Map of value -> label for Base UI SelectValue display
  const itemsMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const opt of options) {
      map[opt.value] = opt.label
    }
    return map
  }, [options])

  // Filtered options based on search term
  const filteredOptions = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(term) ||
        (opt.hint && opt.hint.toLowerCase().includes(term))
    )
  }, [options, search])

  // Focus input when popup opens
  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 10)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      const first = filteredOptions.find((o) => !o.disabled)
      if (first) {
        onValueChange(first.value)
        setOpen(false)
      }
      return
    }
    if (e.key === "Escape" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Allow Base UI to handle popup dismissal and list navigation
      return
    }
    // Stop propagation for all other keys (letters, spaces, etc.) to prevent
    // Base UI useTypeahead from catching keystrokes intended for the search input
    e.stopPropagation()
  }

  return (
    <SelectPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setSearch("")
        }
      }}
      value={value ?? null}
      onValueChange={(nextVal) => {
        if (nextVal !== null && nextVal !== undefined) {
          onValueChange(nextVal)
        }
      }}
      items={itemsMap}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        data-slot="select-trigger"
        data-size={size}
        aria-invalid={ariaInvalid}
        className={cn(
          "flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors duration-normal ease-out-soft outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
      >
        <SelectPrimitive.Value
          data-slot="select-value"
          className="flex flex-1 text-left truncate"
          placeholder={placeholder}
        />
        <SelectPrimitive.Icon
          render={
            <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
          }
        />
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          sideOffset={4}
          align="start"
          alignItemWithTrigger={false}
          className="isolate z-50"
        >
          <SelectPrimitive.Popup
            data-slot="select-searchable-popup"
            className="relative isolate z-50 max-h-80 w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 ease-out-soft data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-fast"
          >
            {/* Search Input Header */}
            <div className="flex items-center border-b border-border px-2.5 py-1.5 gap-2 bg-popover">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={searchPlaceholder}
                className="flex h-7 w-full rounded-md bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
              {search ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSearch("")
                    inputRef.current?.focus()
                  }}
                  className="text-muted-foreground hover:text-foreground shrink-0 rounded-xs p-0.5"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            {/* Options List */}
            <SelectPrimitive.List className="max-h-56 overflow-y-auto p-1 text-sm">
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {emptyText}
                </div>
              ) : (
                filteredOptions.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.hint && (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {opt.hint}
                      </span>
                    )}
                  </SelectItem>
                ))
              )}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
