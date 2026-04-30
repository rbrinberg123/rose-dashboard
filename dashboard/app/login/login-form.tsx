"use client"

import * as React from "react"
import { useActionState } from "react"
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sendMagicLink, type LoginState } from "./actions"

const initial: LoginState = { status: "idle" }

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(sendMagicLink, initial)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          placeholder="you@roseandco.com"
          aria-invalid={state.status === "error" || undefined}
          disabled={isPending || state.status === "sent"}
        />
      </div>

      {state.status === "error" ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state.status === "sent" ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Check your email</div>
            <p className="text-xs text-muted-foreground">
              We sent a sign-in link to <span className="font-medium">{state.email}</span>.
              The link is good for 60 minutes.
            </p>
          </div>
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending || state.status === "sent"}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sending…
          </>
        ) : state.status === "sent" ? (
          "Link sent"
        ) : (
          "Send magic link"
        )}
      </Button>
    </form>
  )
}
