import { useEffect, useMemo, useState } from "react"
import { RotateCcw, Video } from "lucide-react"
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
  createErrorSocket,
  fetchErrors,
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

export default function App() {
  const [errors, setErrors] = useState<DetectionError[]>([])
  const [selected, setSelected] = useState<DetectionError | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting")
  const [robotStatus, setRobotStatus] = useState<RobotStatus>({
    status: "working",
    activeWorkstationId: "WS-01",
    message: "Robot is working normally",
  })
  const [resolutionNote, setResolutionNote] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    fetchErrors(controller.signal)
      .then((loaded) => { if (!disposed) setErrors(loaded) })
      .catch((error: unknown) => {
        if (!disposed && (error as Error).name !== "AbortError") {
          setMessage(error instanceof Error ? error.message : "Could not load errors")
        }
      })
      .finally(() => { if (!disposed) setLoading(false) })

    const connect = () => {
      if (disposed) return
      setConnectionStatus("connecting")
      socket = createErrorSocket(
        (error) => {
          setErrors((current) => mergeErrors(current, [error]))
          setSelected((current) => current?.id === error.id ? error : current)
        },
        (status) => setConnectionStatus(status === WebSocket.OPEN ? "connected" : "disconnected"),
        () => setMessage("Live connection failed"),
        () => { setErrors([]); setSelected(null) },
        setRobotStatus,
        (errorId) => {
          setErrors((current) => current.filter((error) => error.id !== errorId))
          setSelected((current) => current?.id === errorId ? null : current)
        },
      )
      socket.onclose = () => {
        if (!disposed) {
          setConnectionStatus("disconnected")
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }
    connect()
    return () => {
      disposed = true
      controller.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [])

  const sortedErrors = useMemo(
    () => [...errors].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [errors],
  )
  const newErrors = sortedErrors.filter((error) => error.status === "new")
  const historyErrors = sortedErrors.filter((error) => error.status !== "new")

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
              {connectionStatus === "connected" ? "live" : connectionStatus}
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
          title="New incidents"
          description="Requires operator attention"
          errors={newErrors}
          loading={loading}
          emptyMessage="No new incidents. The production line is clear."
          onSelect={(error) => { setSelected(error); setResolutionNote(error.resolutionNote ?? "") }}
        />
        <IncidentTable
          title="Incident history"
          description="Acknowledged, in-progress, and resolved incidents"
          errors={historyErrors}
          loading={loading}
          emptyMessage="No acknowledged or resolved incidents yet."
          onSelect={(error) => { setSelected(error); setResolutionNote(error.resolutionNote ?? "") }}
        />
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setResolutionNote("") } }}>
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{selected?.workstationId ?? "Error"} details</SheetTitle>
            <SheetDescription className="capitalize">{selected?.category} fault · {selected?.priority} priority</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {selected?.videoUrl ? <video src={selected.videoUrl} controls className="aspect-video w-full rounded-lg bg-black object-contain" /> : <div className="flex aspect-video items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"><Video className="mr-2 size-4" /> No video available</div>}
            <div><h3 className="font-semibold">AI classification</h3><p className="mt-1 text-muted-foreground">{selected?.description}</p></div>
            <div>
              <h3 className="font-semibold">Incident status</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["acknowledged", "in_progress", "resolved"] as IncidentStatus[]).map((status) => (
                  <Button key={status} variant={selected?.status === status ? "default" : "outline"} size="sm" onClick={() => changeSelectedStatus(status)} disabled={busy || selected?.status === status}>
                    {statusLabels[status]}
                  </Button>
                ))}
              </div>
            </div>
            {selected?.sensorData && <div><h3 className="font-semibold">Sensor snapshot</h3><pre className="mt-2 rounded-lg bg-muted p-3 text-xs">{JSON.stringify(selected.sensorData, null, 2)}</pre></div>}
            <div>
              <h3 className="font-semibold">Resolution note</h3>
              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                placeholder="Describe what was checked or repaired..."
                className="mt-2 min-h-24 w-full rounded-lg border bg-background p-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button variant="destructive" onClick={clearSelectedError} disabled={busy}>
              <RotateCcw /> Delete test incident
            </Button>
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
      <Table>
        <TableHeader><TableRow>
          <TableHead>id</TableHead><TableHead>workstation</TableHead><TableHead>category</TableHead>
          <TableHead>priority</TableHead><TableHead>status</TableHead><TableHead>description</TableHead><TableHead>detected</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading incidents...</TableCell></TableRow>}
          {!loading && errors.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}
          {errors.map((error) => (
            <TableRow key={error.id} className="cursor-pointer hover:bg-muted/60" onClick={() => onSelect(error)}>
              <TableCell className="font-medium">#{error.id}</TableCell>
              <TableCell>{error.workstationId ?? "—"}</TableCell>
              <TableCell className="capitalize">{error.category}</TableCell>
              <TableCell><Badge variant={priorityVariants[error.priority]} className="capitalize">{error.priority}</Badge></TableCell>
              <TableCell><Badge variant={error.status === "resolved" ? "secondary" : "outline"}>{statusLabels[error.status]}</Badge></TableCell>
              <TableCell>{error.description}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(error.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
