"use client"

import { Loader2 } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { DeepAnalysis } from "@/components/dashboard/DeepAnalysis"

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

    // The design carries its own header (title, subtitle, Export / Re-run), so
    // PageHeader would duplicate it.
    return (
        <div className="px-[34px] pb-[70px] pt-[30px]">
            <DeepAnalysis userId={userId} />
        </div>
    )
}
