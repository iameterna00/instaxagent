"use client"

import { Loader2 } from "lucide-react"
import { useInstagramSession } from "@/hooks/use-instagram-session"
import { ContentStudio } from "@/components/dashboard/ContentStudio"

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
        // The studio carries its own header — it sits on the same row as the
        // plan badge and Copy all — and the two-column layout needs the width.
        <div className="mx-auto max-w-7xl p-6 md:p-8">
            <ContentStudio userId={userId} />
        </div>
    )
}
