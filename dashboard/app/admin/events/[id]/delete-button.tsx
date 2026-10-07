"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { deleteItinerary } from "../actions"

/** Delete an itinerary (and its days, items, attendees) after a confirm. */
export function DeleteItineraryButton({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Delete
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this itinerary?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” and all its days, items and attendees will be removed. The CRM event and meetings are not
              affected. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault()
                startTransition(async () => {
                  const r = await deleteItinerary(id)
                  if (!r.ok) {
                    toast.error("Could not delete", { description: r.error })
                    return
                  }
                  toast.success("Itinerary deleted")
                  setOpen(false)
                  router.push("/admin/events")
                })
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
