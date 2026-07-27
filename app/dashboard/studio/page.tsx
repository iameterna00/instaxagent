"use client"

import { useInstagramSession } from "@/hooks/use-instagram-session"
import { ContentStudio } from "@/components/dashboard/ContentStudio"

export default function StudioPage() {
    const { userId, isLoading } = useInstagramSession()

    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-black">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
        )
    }

    if (!userId) {
        return <div className="h-screen flex items-center justify-center bg-black text-neutral-500">Please log in</div>
    }

    return (
        <div className="min-h-screen bg-black">
            <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">
                <div>
                    <p className="font-mono-ui text-[10px] uppercase tracking-[0.3em] text-neutral-600 mb-2">
                        Strategy
                    </p>
                    <h1 className="font-serif-display text-4xl md:text-5xl text-white leading-none">Content Studio</h1>
                </div>

                <ContentStudio userId={userId} />
            </div>
        </div>
    )
}
