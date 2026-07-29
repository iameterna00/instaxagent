"use client"

import { Sidebar } from "@/components/layout/sidebar"
import { MobileNav } from "@/components/layout/mobile-nav"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Loader2, Zap } from "lucide-react"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { username, profilePic, logout, isLoading } = useInstagramSession()

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            {/* Desktop Sidebar */}
            <div className="z-50 hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col">
                <Sidebar
                    className="h-full border-r border-border"
                    username={username || "User"}
                    profilePic={profilePic}
                    onLogout={logout}
                />
            </div>

            {/* Main Content Area */}
            <div className="flex flex-1 flex-col md:pl-64">
                {/* Mobile Header (Visible only on small screens) */}
                <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md md:hidden">
                    <span className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
                            <Zap className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                        <span className="text-[15px] font-semibold tracking-tight">InstaxAgent</span>
                    </span>
                    <MobileNav username={username || "User"} profilePic={profilePic} onLogout={logout} />
                </header>

                <main className="relative flex-1 overflow-auto">
                    {children}
                </main>
            </div>
        </div>
    )
}
