import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, RotateCcw, Shuffle, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  createErrorSocket,
  fetchErrors,
  resetErrors,
  triggerMockError,
  type DetectionError,
  type RobotStatus,
} from "@/lib/errors"

type StationState = "ready" | "error" | "paused" | "maintenance"
type ConnectionStatus = "connecting" | "connected" | "disconnected"

type Station = {
  id: number
  name: string
  state: StationState
  goodClip: string
  badClip: string
}

const stationNames = [
  "Prefilter",
  "Bottomsheet",
  "Lightlocalizer",
  "Driveunit",
  "Tubeinterface",
  "Modulecarrier",
  "Workstation 7",
  "Workstation 8",
]

const slugify = (name: string) => name.toLowerCase().replace(" ", "-")

const initialStations: Station[] = stationNames.map((name, index) => ({
  id: index + 1,
  name,
  state: "ready",
  // Add matching files at these paths when the clips are available.
  goodClip: `/videos/${slugify(name)}/good.mp4`,
  badClip: `/videos/${slugify(name)}/bad.mp4`,
}))

const stationState = {
  ready: { label: "Ready", color: "text-emerald-600", dot: "bg-emerald-500", icon: CheckCircle2 },
  error: { label: "Error", color: "text-red-600", dot: "bg-red-500", icon: AlertTriangle },
  paused: { label: "Paused", color: "text-red-600", dot: "bg-red-500", icon: AlertTriangle },
  maintenance: { label: "Maintenance", color: "text-amber-600", dot: "bg-amber-500", icon: Wrench },
}

function stationIdForError(error: DetectionError, stations: Station[]) {
  if (error.stationId && stations.some((station) => station.id === error.stationId)) return error.stationId
  if (error.stationName) {
    const workstationMatch = error.stationName.match(/WS-(\d+)/i)
    if (workstationMatch) return Number(workstationMatch[1])
    const match = stations.find((station) => station.name.toLowerCase() === error.stationName?.toLowerCase())
    if (match) return match.id
  }
  return stations[Math.floor(Math.random() * stations.length)].id
}

export default function App() {
  const [robotStatus, setRobotStatus] = useState<RobotStatus>({
    status: "working",
    activeWorkstationId: "WS-01",
    message: "Robot is working normally",
    pausedWorkstations: [],
  })
  const [stations, setStations] = useState(initialStations)
  const [lastError, setLastError] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting")
  const [requestError, setRequestError] = useState<string | null>(null)

  const resetLocal = useCallback(() => {
    setStations(initialStations)
    setLastError(null)
    setRobotStatus({ status: "working", activeWorkstationId: "WS-01", message: "Robot is working normally", pausedWorkstations: [] })
    setRequestError(null)
  }, [])

  const reset = async () => {
    try {
      setRequestError(null)
      await resetErrors()
      resetLocal()
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not reset the production line")
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const applyError = (error: DetectionError) => {
      const id = stationIdForError(error, initialStations)
      if (error.status === "resolved") {
        setStations((current) => current.map((station) => station.id === id
          ? { ...station, state: "ready" }
          : station))
        return
      }
      setLastError(id)
      setStations((current) => current.map((station) => station.id === id
        ? { ...station, state: "error" }
        : station))
    }

    fetchErrors(controller.signal).then((errors) => {
      if (!disposed) errors.forEach(applyError)
    }).catch((error: unknown) => {
      if (!disposed && (error as Error).name !== "AbortError") {
        setRequestError(error instanceof Error ? error.message : "Could not load error history")
      }
    })

    const connect = () => {
      if (disposed) return
      setConnectionStatus("connecting")
      socket = createErrorSocket(applyError, (status) => {
        if (!disposed) setConnectionStatus(status)
      },       resetLocal, (status) => {
        setRobotStatus(status)
        setStations((current) => current.map((station) => {
          const workstationId = `WS-${String(station.id).padStart(2, "0")}`
          return {
            ...station,
            state: status.pausedWorkstations?.includes(workstationId)
              ? "paused"
              : status.status === "evaluating" && workstationId === status.workstationId
                ? "error"
                : "ready",
          }
        }))
        if (status.status === "working") {
          setLastError(null)
        }
      })
      socket.onclose = () => {
        if (disposed) return
        setConnectionStatus("disconnected")
        reconnectTimer = setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      disposed = true
      controller.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [resetLocal])

  const triggerRandomError = async () => {
    try {
      setRequestError(null)
      const activeId = Number(robotStatus.activeWorkstationId?.replace("WS-", ""))
      const station = initialStations.find((candidate) => candidate.id === activeId)
        ?? initialStations[0]
      await triggerMockError(station)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not trigger mock error")
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f5f7] px-5 py-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center justify-between">
          
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Robot Simulation</h1>
            <div className="flex flex-row justify-center items-center">
            <div className="text-xs text-slate-500">Backend: <span className={connectionStatus === "connected" ? "text-emerald-600" : "text-red-600"}>{connectionStatus}</span></div>
        
          <Button variant="outline" size="sm" onClick={() => { void reset() }}><RotateCcw className="size-3.5" /> Reset line</Button>

            </div>
        </header>

        <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold">Workstations</h2>
            </div>
            
       <p className="max-w-xs text-right text-xs text-slate-500">{robotStatus.message}</p>
            
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stations.map((station) => <StationCard key={station.id} station={station} active={`WS-${String(station.id).padStart(2, "0")}` === robotStatus.activeWorkstationId} />)}
          </div>
        </section>

        {requestError && <p className="mb-3 text-sm text-red-600">{requestError}</p>}
        {lastError !== null && <p className="mb-3 text-xs text-slate-500">Last affected station: WS-{String(lastError).padStart(2, "0")}</p>}
          <Button size="lg" className="mt-2 bg-[#ec6602] px-6 text-white hover:bg-[#d95d02]" onClick={triggerRandomError} disabled={robotStatus.status !== "working"}>
            <Shuffle className="size-4" /> Trigger random error
          </Button>
          
      </div>
    </main>
  )
}

function StationCard({ station, active }: { station: Station; active: boolean }) {
  const meta = stationState[station.state]
  return (
    <div className={`rounded-lg border p-3 transition-all ${active ? "border-[#ec6602] bg-orange-50 ring-2 ring-[#ec6602]/20" : "border-slate-200 bg-slate-50"}`}>
      <div className="mb-3 flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">WS-{String(station.id).padStart(2, "0")}</span>
        
      </div>
      <h3 className="min-h-10 text-sm font-bold capitalize">{station.name}</h3>
      <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-3">
        {/* <span className={`size-2 rounded-full ${meta.dot}`} /> */}
        <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
      </div>
    </div>
  )
}
