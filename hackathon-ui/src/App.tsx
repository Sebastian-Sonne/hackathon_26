import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, MapPin, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  resetError,
  resetErrors,
  updateError,
  type DetectionError,
  type ErrorPriority,
  type IncidentStatus,
  type RobotStatus,
} from "@/lib/errors"

type ConnectionStatus = "connecting" | "connected" | "disconnected"

const priorityVariants: Record<ErrorPriority, "destructive" | "default" | "secondary"> = {
  critical: "destructive",
  major: "default",
  minor: "secondary",
  unknown: "secondary",
}

const statusLabels: Record<IncidentStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
}

function formatDate(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function mergeErrors(current: DetectionError[], incoming: DetectionError[]) {
  const byId = new Map(current.map((error) => [error.id, error]))
  incoming.forEach((error) => byId.set(error.id, error))
  return [...byId.values()]
}

const mockErrors: DetectionError[] = [
  {
    id: "ERR-042",
    category: "component misalignment",
    priority: "critical",
    description: "The robot detected a component outside the permitted placement tolerance.",
    createdAt: "2026-10-23T17:42:00.000Z",
    workstationId: "WS-07",
    status: "new",
    sensorData: {
      deviation: "4.8 mm",
      tolerance: "± 1.5 mm",
      component: "Control board",
    },
  },
  {
    id: "ERR-039",
    category: "surface inspection",
    priority: "minor",
    description: "Surface inspection found a visible scratch on the outer housing.",
    createdAt: "2026-10-23T16:18:00.000Z",
    workstationId: "WS-03",
    status: "acknowledged",
    resolutionNote: "Waiting for quality inspection.",
  },
]

export default function App() {
  const [errors, setErrors] = useState<DetectionError[]>(mockErrors)
  const [selected, setSelected] = useState<DetectionError | null>(mockErrors[0])
  const loading = false
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const connectionStatus: ConnectionStatus = "connected"
  const robotStatus: RobotStatus = {
    status: "working",
    activeWorkstationId: "WS-01",
    message: "Robot is working normally",
  }
  const [resolutionNote, setResolutionNote] = useState(mockErrors[0].resolutionNote ?? "")
  const [videoLoaded, setVideoLoaded] = useState(false)

  const sortedErrors = useMemo(
    () => [...errors].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [errors],
  )

  const clearErrors = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await resetErrors()
      setErrors([])
      setSelected(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset errors")
    } finally {
      setBusy(false)
    }
  }

  const clearSelectedError = async () => {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    try {
      await resetError(selected.id)
      setErrors((current) => current.filter((error) => error.id !== selected.id))
      setSelected(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset error")
    } finally {
      setBusy(false)
    }
  }

  const changeSelectedStatus = async (status: IncidentStatus) => {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    try {
      const updated = await updateError(selected.id, status, resolutionNote)
      setErrors((current) => mergeErrors(current, [updated]))
      setSelected(updated)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update incident")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Production alerts</h1>
            
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={clearErrors} disabled={busy || errors.length === 0}>
              <RotateCcw /> Reset errors
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={`size-2 rounded-full ${connectionStatus === "connected" ? "bg-emerald-500" : connectionStatus === "connecting" ? "bg-amber-500" : "bg-red-500"}`} />
              demo data
            </div>
          </div>
        </header>

        <section className="mb-5 flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Robot status</p>
            <p className="mt-1 text-lg font-semibold capitalize">{robotStatus.status === "evaluating" ? "Checking minor issue" : robotStatus.status}</p>
            <p className="text-sm text-muted-foreground">{robotStatus.message}</p>
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-muted-foreground">Currently operating</p>
            <p className="font-semibold">{robotStatus.activeWorkstationId ? robotStatus.activeWorkstationId : "—"}</p>
            {robotStatus.status === "rerouting" && robotStatus.workstationId && <p className="text-xs text-destructive">{robotStatus.workstationId} paused</p>}
          </div>
        </section>

        {message && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{message}</div>}
        <IncidentTable
          title="All incidents"
          description="Production alerts across the line"
          errors={sortedErrors}
          loading={loading}
          emptyMessage="No incidents. The production line is clear."
          onSelect={(error) => { setSelected(error); setVideoLoaded(false); setResolutionNote(error.resolutionNote ?? "") }}
        />
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setResolutionNote("") } }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b bg-muted/20 px-6 py-5 pr-14">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Incident details</p>
                <SheetTitle className="text-2xl font-bold tracking-tight">{selected?.workstationId ?? "Error"}</SheetTitle>
                <SheetDescription className="mt-1 capitalize">{selected?.category} fault</SheetDescription>
              </div>
              <Badge variant={selected?.priority === "critical" ? "destructive" : "default"} className="mt-1 gap-1.5 px-2.5 py-1 capitalize">
                <AlertTriangle className="size-3.5" />
                {selected?.priority}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" /> Workstation {selected?.workstationId}</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" /> {formatDate(selected?.createdAt)}</span>
            </div>
          </SheetHeader>
          <div className="space-y-7 px-6 py-6">
            {selected && <div className="overflow-hidden rounded-xl border bg-muted shadow-sm">
              <div className="relative aspect-video">
              <video
                src="/mock_video.mp4"
                autoPlay
                loop
                muted
                playsInline
                poster="/mock.jpg"
                onLoadStart={() => setVideoLoaded(false)}
                onLoadedData={() => setVideoLoaded(true)}
                aria-label="Looping production workstation video at WS-07"
                className="size-full object-cover"
              />
              {!videoLoaded && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/35 text-xs font-medium text-white" role="status" aria-live="polite">
                <LoaderCircle className="size-7 animate-spin" />
                Loading vision capture...
              </div>}
              </div>
              <div className="flex items-center gap-2 border-t bg-card px-4 py-2.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-destructive" />
                Video log · Error {selected.id}
              </div>
            </div>}
            <section className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Classification</h3>
              <p className="rounded-lg border bg-muted/30 p-4 leading-6">{selected?.description}</p>
            </section>
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Incident status</h3>
                <Badge variant="outline">{selected ? statusLabels[selected.status] : ""}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["acknowledged", "in_progress", "resolved"] as IncidentStatus[]).map((status) => (
                  <Button key={status} variant={selected?.status === status ? "default" : "outline"} className="h-10 px-2 text-xs" onClick={() => changeSelectedStatus(status)} disabled={busy || selected?.status === status}>
                    {statusLabels[status]}
                  </Button>
                ))}
              </div>
            </section>
            {selected?.sensorData && <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Sensor snapshot</h3>
              <pre className="overflow-x-auto rounded-lg border bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify(selected.sensorData, null, 2)}</pre>
            </section>}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Resolution note</h3>
              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                placeholder="Describe what was checked or repaired..."
                className="min-h-28 w-full resize-y rounded-lg border bg-background p-3 text-sm leading-6 outline-none ring-offset-background placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </section>
            <div className="flex items-center justify-between gap-4 border-t pt-5">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5" /> Demo incident controls</p>
              <Button variant="destructive" size="sm" onClick={clearSelectedError} disabled={busy}>
                <RotateCcw /> Delete incident
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  )
}

function IncidentTable({
  title,
  description,
  errors,
  loading,
  emptyMessage,
  onSelect,
}: {
  title: string
  description: string
  errors: DetectionError[]
  loading: boolean
  emptyMessage: string
  onSelect: (error: DetectionError) => void
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border bg-card shadow-sm last:mb-0">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{title} <span className="ml-1 text-muted-foreground">({errors.length})</span></h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Table className="w-full min-w-0 table-fixed">
        <TableHeader><TableRow>
          <TableHead className="w-[18%] whitespace-normal">id</TableHead>
          <TableHead className="w-[17%] whitespace-normal">workstation</TableHead>
          <TableHead className="w-[25%] whitespace-normal">category</TableHead>
          <TableHead className="w-[14%] whitespace-normal">priority</TableHead>
          <TableHead className="w-[16%] whitespace-normal">status</TableHead>
          <TableHead className="hidden w-[10%] whitespace-normal md:table-cell">detected</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading incidents...</TableCell></TableRow>}
          {!loading && errors.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}
          {errors.map((error) => (
            <TableRow key={error.id} className="cursor-pointer hover:bg-muted/60" onClick={() => onSelect(error)}>
              <TableCell className="max-w-0 whitespace-normal break-words font-medium">#{error.id}</TableCell>
              <TableCell className="whitespace-normal break-words">{error.workstationId ?? "—"}</TableCell>
              <TableCell className="max-w-0 whitespace-normal break-words capitalize" title={error.category}>{error.category}</TableCell>
              <TableCell className="whitespace-normal"><Badge variant={priorityVariants[error.priority]} className="max-w-full whitespace-normal break-words text-center capitalize">{error.priority}</Badge></TableCell>
              <TableCell className="whitespace-normal"><Badge variant={error.status === "resolved" ? "secondary" : "outline"} className="max-w-full whitespace-normal break-words text-center">{statusLabels[error.status]}</Badge></TableCell>
              <TableCell className="hidden whitespace-normal text-xs text-muted-foreground md:table-cell">{formatDate(error.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
