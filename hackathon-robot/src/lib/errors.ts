export type ErrorPriority = "critical" | "major" | "minor" | "unknown"
export type IncidentStatus = "new" | "acknowledged" | "in_progress" | "resolved"
export type RobotStatusName = "working" | "evaluating" | "rerouting" | "stopped"

export type RobotStatus = {
  status: RobotStatusName
  workstationId?: string
  activeWorkstationId?: string
  message: string
  pausedWorkstations?: string[]
}

export type DetectionError = {
  id: string
  category: string
  priority: ErrorPriority
  description: string
  createdAt?: string
  videoUrl?: string
  stationId?: number
  stationName?: string
  sensorData?: Record<string, unknown>
  status: IncidentStatus
}

type RawDetectionError = {
  id?: string | number
  category?: string
  priority?: string
  description?: string
  created_at?: string
  createdAt?: string
  video_url?: string
  videoUrl?: string
  station_id?: number | string
  stationId?: number | string
  station_name?: string
  stationName?: string
  workstation?: string
  workstation_id?: string
  sensor_data?: Record<string, unknown>
  status?: string
}

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8000"
export const errorsWebSocketUrl =
  import.meta.env.VITE_ERRORS_WS_URL || "ws://localhost:8000/ws/errors"

export function normalizeDetectionError(value: unknown): DetectionError | null {
  if (!value || typeof value !== "object") return null
  const raw = value as RawDetectionError
  if (raw.id === undefined) return null

  const priority = raw.priority?.toLowerCase()
  return {
    id: String(raw.id),
    category: raw.category || "unknown",
    priority: priority === "critical" || priority === "major" || priority === "minor"
      ? priority
      : "unknown",
    description: raw.description || "Backend reported an error",
    createdAt: raw.created_at || raw.createdAt,
    videoUrl: raw.video_url || raw.videoUrl,
    stationId: toStationId(raw.station_id ?? raw.stationId),
    stationName: raw.station_name || raw.stationName || raw.workstation || raw.workstation_id,
    sensorData: raw.sensor_data,
    status: raw.status === "resolved" || raw.status === "acknowledged" || raw.status === "in_progress"
      ? raw.status
      : "new",
  }
}

function toStationId(value: number | string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

export async function triggerMockError(station: { id: number; badClip: string }) {
  const form = new FormData()
  form.append("workstation_id", `WS-${String(station.id).padStart(2, "0")}`)
  form.append("sensor_data", JSON.stringify({
    temperature: Number((35 + Math.random() * 45).toFixed(1)),
    vibration: Number((0.1 + Math.random() * 2.4).toFixed(2)),
    pressure: Number((1 + Math.random() * 3).toFixed(2)),
  }))
  try {
    const clip = await fetch(station.badClip)
    const contentType = clip.headers.get("content-type") ?? ""
    const blob = await clip.blob()
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
    const isMp4 = header.length >= 8
      && header[4] === 0x66
      && header[5] === 0x74
      && header[6] === 0x79
      && header[7] === 0x70
    if (clip.ok && !contentType.includes("text/html") && isMp4) {
      form.append("video", blob, "bad-clip.mp4")
    }
  } catch {
    // Clips are optional during local setup; the backend still receives the event.
  }
  const response = await fetch(`${apiUrl}/api/errors`, { method: "POST", body: form })
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`)
}

export async function fetchErrors(signal?: AbortSignal) {
  const response = await fetch(`${apiUrl}/api/errors`, { signal })
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`)
  const payload: unknown = await response.json()
  const values = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null && "errors" in payload
      ? (payload as { errors: unknown }).errors
      : []
  return Array.isArray(values)
    ? values.map(normalizeDetectionError).filter((error): error is DetectionError => error !== null)
    : []
}

export async function resetErrors() {
  const response = await fetch(`${apiUrl}/api/errors`, { method: "DELETE" })
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`)
}

export function createErrorSocket(
  onError: (error: DetectionError) => void,
  onStatus: (status: "connected" | "disconnected") => void,
  onReset?: () => void,
  onRobotStatus?: (status: RobotStatus) => void,
) {
  const socket = new WebSocket(errorsWebSocketUrl)
  socket.onopen = () => onStatus("connected")
  socket.onclose = () => onStatus("disconnected")
  socket.onerror = () => onStatus("disconnected")
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { error?: unknown; type?: string; status?: RobotStatus }
      if (payload.type === "errors.reset") {
        onReset?.()
        return
      }
      if (payload.type === "robot.status" && payload.status
        && typeof payload.status === "object") {
        onRobotStatus?.(payload.status as RobotStatus)
        return
      }
      const error = normalizeDetectionError(payload.error ?? payload)
      if (error) onError(error)
    } catch {
      console.error("Received invalid error event from FastAPI WebSocket")
    }
  }
  return socket
}
