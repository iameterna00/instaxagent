"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const

/**
 * Three-way segmented control. Renders a placeholder until mounted, since the
 * resolved theme isn't known on the server.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon, label }) => {
        const active = mounted && theme === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            title={label}
            aria-label={`${label} theme`}
            aria-pressed={active}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-[6px] transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        )
      })}
    </div>
  )
}
