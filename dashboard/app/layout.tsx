import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Sidebar } from "@/components/nav"
import { Toaster } from "@/components/ui/sonner"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Rose & Co. Dashboard",
    template: "%s · Rose & Co. Dashboard",
  },
  description: "Internal management dashboard for Rose & Company",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch the signed-in user once at the layout boundary so the sidebar
  // can render their email + sign-out without each page repeating the
  // call. getUser() contacts Supabase Auth to verify the JWT, so this is
  // also our authenticity check (proxy.ts handles unauthenticated
  // redirects; the layout just reads the result).
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? null

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Sidebar userEmail={userEmail} />
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
