"use client"

import { Loader2 } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { DeepAnalysis } from "@/components/dashboard/DeepAnalysis"
import { PageHeader } from "@/components/layout/page-header"

export default function AnalyticsPage() {
    const { userId, isLoading } = useInstagramSession()

    if (isLoading) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!userId) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
                Please log in
            </div>
        )
    }

    return (
        <div className="space-y-6 p-6 md:p-8">
            <PageHeader
                title="Analytics"
                description="What worked, what didn't, and what to post next."
            />

            <DeepAnalysis userId={userId} />
        </div>
    )
}
