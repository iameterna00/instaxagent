"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { Activity, ArrowRight, Users, MessageCircle, Zap, Loader2 } from "lucide-react"

interface DashboardStats {
    metrics: {
        totalAutomations: number
        activeTriggers: number
        audienceReached: number
        messagesSent: number
    }
    recentActivity: Array<{
        id: string
        content: string
        created_at: string
        recipient?: {
            recipient_username: string
        }
    }>
}

export default function DashboardPage() {
    const { username, userId, isLoading: isSessionLoading } = useInstagramSession()
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!userId) return

        const fetchStats = async () => {
            try {
                const res = await fetch(`/api/dashboard/stats?userId=${userId}`)
                const data = await res.json()
                if (data && !data.error) {
                    setStats(data)
                }
            } catch (err) {
                console.error("Failed to load dashboard stats", err)
            } finally {
                setLoading(false)
            }
        }

        fetchStats()
    }, [userId])

    if (isSessionLoading || loading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
            <PageHeader
                title={`Hey, ${username}`}
                description="Here's what your automations did while you were away."
            />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total automations"
                    value={stats?.metrics.totalAutomations ?? 0}
                    hint="Active"
                    icon={<Zap className="h-4 w-4" strokeWidth={1.8} />}
                />
                <StatCard
                    title="Messages sent"
                    value={stats?.metrics.messagesSent ?? 0}
                    hint="Lifetime"
                    icon={<MessageCircle className="h-4 w-4" strokeWidth={1.8} />}
                />
                <StatCard
                    title="Active triggers"
                    value={stats?.metrics.activeTriggers ?? 0}
                    hint="Running"
                    icon={<Activity className="h-4 w-4" strokeWidth={1.8} />}
                />
                <StatCard
                    title="Audience reached"
                    value={stats?.metrics.audienceReached ?? 0}
                    hint="Unique users"
                    icon={<Users className="h-4 w-4" strokeWidth={1.8} />}
                />
            </div>

            {/* Recent Activity */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="gap-0 overflow-hidden p-0 lg:col-span-2">
                    <div className="border-b border-border px-5 py-4">
                        <h2 className="text-sm font-medium text-foreground">Recent activity</h2>
                    </div>
                    <div className="divide-y divide-border">
                        {stats?.recentActivity && stats.recentActivity.length > 0 ? (
                            stats.recentActivity.map((msg) => (
                                <div key={msg.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                                        <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-medium text-foreground">
                                            Auto-reply to @{msg.recipient?.recipient_username || "user"}
                                        </p>
                                        <p className="truncate text-[13px] text-muted-foreground">{msg.content}</p>
                                    </div>
                                    <span className="numeric shrink-0 text-xs text-muted-foreground">
                                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                                No recent activity yet.
                            </div>
                        )}
                    </div>
                </Card>

                <Card className="gap-0 overflow-hidden p-0">
                    <div className="border-b border-border px-5 py-4">
                        <h2 className="text-sm font-medium text-foreground">Quick actions</h2>
                    </div>
                    <div className="space-y-2 p-4">
                        <QuickAction href="/dashboard/automations" icon={<Zap className="h-4 w-4" strokeWidth={1.8} />} label="New automation rule" />
                        <QuickAction href="/dashboard/inbox" icon={<MessageCircle className="h-4 w-4" strokeWidth={1.8} />} label="Open the inbox" />
                        <QuickAction href="/dashboard/analytics" icon={<Users className="h-4 w-4" strokeWidth={1.8} />} label="View audience" />
                    </div>
                </Card>
            </div>
        </div>
    )
}

function StatCard({ title, value, hint, icon }: { title: string, value: number, hint: string, icon: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/40">
            <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted-foreground">{title}</span>
                <span className="text-muted-foreground">{icon}</span>
            </div>
            <p className="numeric mt-4 text-3xl font-semibold text-foreground">{value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
    )
}

function QuickAction({ href, icon, label }: { href: string, icon: React.ReactNode, label: string }) {
    return (
        <Link
            href={href}
            className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
            <span className="text-muted-foreground">{icon}</span>
            {label}
            <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
        </Link>
    )
}
