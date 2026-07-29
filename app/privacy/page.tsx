export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
      <p className="mb-10 mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

      <section className="space-y-4 text-[15px] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        <p>
          This app (&quot;InstaxAgent&quot;) is owned and operated by <strong>InstaxAgent</strong>. The app uses the Instagram Graph API to help users manage
          their Instagram account, including posting reels, auto-replying to
          messages, and viewing analytics.
        </p>

        <h2 className="mt-8 text-lg font-medium text-foreground">Data We Collect</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Instagram profile information (username, name, profile picture)</li>
          <li>Instagram content (media, captions, comments)</li>
          <li>Messages and conversations (for auto-reply features)</li>
        </ul>

        <h2 className="mt-8 text-lg font-medium text-foreground">How We Use Data</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To post content to your Instagram account when you request it</li>
          <li>To send automated replies to messages and comments</li>
          <li>To display analytics about your account performance</li>
          <li>We do <strong>not</strong> sell your data to third parties</li>
        </ul>

        <h2 className="mt-8 text-lg font-medium text-foreground">Data Storage</h2>
        <p>
          Your Instagram access tokens and profile data are stored securely in
          our database (Supabase). You can disconnect your account at any time,
          which will remove the stored tokens.
        </p>

        <h2 className="mt-8 text-lg font-medium text-foreground">Contact</h2>
        <p>
          For any questions, please reach out via the app dashboard or email at haaydaay65@gmail.com.
        </p>
      </section>
    </div>
  )
}
