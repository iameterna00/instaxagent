"use client"

import { Activity } from "lucide-react"
import { PageHeader } from "@/components/layout/page-header"

export default function AnalyticsPage() {
    return (
        <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
            <PageHeader
                title="Analytics"
                description="Engagement, conversions, and automation performance."
            />

            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-20 text-center">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
                    <Activity className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h2 className="text-base font-medium text-foreground">Deep analytics are on the way</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    We&apos;re building a full analytics suite so you can track engagement, conversions,
                    and how each automation actually performs.
                </p>
                <span className="mt-6 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                    Coming soon
                </span>
            </div>
        </div>
    )
}
