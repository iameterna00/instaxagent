"use client"

import { Loader2 } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { ContentStudio } from "@/components/dashboard/ContentStudio"
import { PageHeader } from "@/components/layout/page-header"

export default function StudioPage() {
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
        <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
            <PageHeader
                title="Content Studio"
                description="Plan, draft, and schedule content straight from your dashboard."
            />

            <ContentStudio userId={userId} />
        </div>
    )
}
