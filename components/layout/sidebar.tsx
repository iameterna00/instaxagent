"use client"

import type React from "react"
import { cn } from "@/lib/utils"
import {
  Zap, LayoutDashboard, LogOut, Settings, BarChart3,
  MessageSquare, Snowflake, Send, Wand2,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ThemeToggle } from "@/components/layout/theme-toggle"

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/automations", icon: Zap, label: "Automations" },
  { href: "/dashboard/studio", icon: Wand2, label: "Content Studio" },
  { href: "/dashboard/inbox", icon: MessageSquare, label: "Inbox" },
  { href: "/dashboard/ice-breakers", icon: Snowflake, label: "Ice breakers" },
  { href: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
]

const SECONDARY = [
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
]

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  username?: string
  profilePic?: string | null
  className?: string
  onLogout?: () => void
  onNavigate?: () => void
}

const navItemClass = (active: boolean) =>
  cn(
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
    active
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  )

export function Sidebar({ className, username = "creator", profilePic, onLogout, onNavigate, ...props }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className={cn("flex flex-col bg-sidebar", className)} {...props}>
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
          <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">InstaxAgent</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} onClick={onNavigate} className={navItemClass(active)}>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2 : 1.8} />
              <span>{label}</span>
            </Link>
          )
        })}

        <div className="my-3 h-px bg-border" />

        {SECONDARY.map(({ href, icon: Icon, label }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} onClick={onNavigate} className={navItemClass(active)}>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          )
        })}

        <a
          href="https://github.com/iameterna00/instaxagent/issues"
          target="_blank"
          rel="noopener noreferrer"
          className={navItemClass(false)}
        >
          <Send className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>Get help</span>
        </a>
      </nav>

      {/* Account */}
      <div className="space-y-2 border-t border-border p-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] text-muted-foreground">Appearance</span>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
            {profilePic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profilePic} alt={username} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[11px] font-medium text-foreground">{username.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">@{username}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </p>
          </div>
          <button
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
