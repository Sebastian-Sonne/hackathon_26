export type ErrorPriority = "critical" | "major" | "minor" | "unknown"
export type IncidentStatus = "new" | "acknowledged" | "in_progress" | "resolved"
export type RobotStatusName = "working" | "evaluating" | "rerouting" | "stopped"

export type RobotStatus = {
  status: RobotStatusName
  workstationId?: string | null
  activeWorkstationId?: string | null
  message: string
  pausedWorkstations?: string[]
}

export type DetectionError = {
  id: string
  category: string
  priority: ErrorPriority
  description: string
  videoUrl?: string
  createdAt?: string
  workstationId?: string
  sensorData?: Record<string, unknown>
  status: IncidentStatus
  resolutionNote?: string
  acknowledgedAt?: string
  resolvedAt?: string
}

type BackendError = {
  id?: unknown
  error_id?: unknown
  category?: unknown
  type?: unknown
  priority?: unknown
  severity?: unknown
  description?: unknown
  message?: unknown
  videoUrl?: unknown
  video_url?: unknown
  createdAt?: unknown
  created_at?: unknown
  workstationId?: unknown
  workstation_id?: unknown
  sensorData?: unknown
  sensor_data?: unknown
  status?: unknown
  resolutionNote?: unknown
  resolution_note?: unknown
  acknowledgedAt?: unknown
  acknowledged_at?: unknown
  resolvedAt?: unknown
  resolved_at?: unknown
}

const apiUrl = import.meta.env.VITE_API_URL ?? ""
const errorsEndpoint = import.meta.env.VITE_ERRORS_ENDPOINT ?? "/api/errors"
const websocketPath = import.meta.env.VITE_ERRORS_WS_PATH ?? "/ws/errors"

function getApiUrl(path: string) {
  return new URL(path, apiUrl || window.location.origin).toString()
}

function getWebSocketUrl(path: string) {
  const url = new URL(path, apiUrl || window.location.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback
}

function asPriority(value: unknown): ErrorPriority {
  const priority = typeof value === "string" ? value.toLowerCase() : ""
  return priority === "critical" || priority === "major" || priority === "minor"
    ? priority
    : "unknown"
}

function asIncidentStatus(value: unknown): IncidentStatus {
  return value === "acknowledged" || value === "in_progress" || value === "resolved"
    ? value
    : "new"
}

export function normalizeError(value: unknown): DetectionError | null {
  if (!value || typeof value !== "object") return null
  const item = value as BackendError
  const id = item.id ?? item.error_id
  if (id === undefined || id === null) return null

  return {
    id: String(id),
    category: asString(item.category ?? item.type, "uncategorized"),
    priority: asPriority(item.priority ?? item.severity),
    description: asString(item.description ?? item.message, "No description provided"),
    videoUrl: typeof (item.videoUrl ?? item.video_url) === "string"
      ? (item.videoUrl ?? item.video_url) as string
      : undefined,
    createdAt: typeof (item.createdAt ?? item.created_at) === "string"
      ? (item.createdAt ?? item.created_at) as string
      : undefined,
    workstationId: typeof (item.workstationId ?? item.workstation_id) === "string"
      ? String(item.workstationId ?? item.workstation_id)
      : undefined,
    sensorData: typeof (item.sensorData ?? item.sensor_data) === "object"
      ? (item.sensorData ?? item.sensor_data) as Record<string, unknown>
      : undefined,
    status: asIncidentStatus(item.status),
    resolutionNote: typeof (item.resolutionNote ?? item.resolution_note) === "string"
      ? String(item.resolutionNote ?? item.resolution_note)
      : undefined,
    acknowledgedAt: typeof (item.acknowledgedAt ?? item.acknowledged_at) === "string"
      ? String(item.acknowledgedAt ?? item.acknowledged_at)
      : undefined,
    resolvedAt: typeof (item.resolvedAt ?? item.resolved_at) === "string"
      ? String(item.resolvedAt ?? item.resolved_at)
      : undefined,
  }
}

function getErrorList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object") {
    const data = payload as { errors?: unknown; data?: unknown }
    if (Array.isArray(data.errors)) return data.errors
    if (Array.isArray(data.data)) return data.data
  }
  return []
}

export async function fetchErrors(signal: AbortSignal) {
  console.info("[api] fetching historical errors...")
  const response = await fetch(getApiUrl(errorsEndpoint), { signal })
  
  if (!response.ok) {
    console.error(`[api] fetch failed with status ${response.status}`)
    throw new Error(`Could not load errors (${response.status})`)
  }
  
  const payload: unknown = await response.json()
  console.info(`[api] loaded ${getErrorList(payload).length} historical errors`)
  
  return getErrorList(payload)
    .map(normalizeError)
    .filter((error): error is DetectionError => error !== null)
}

export async function resetErrors() {
  const response = await fetch(getApiUrl("/api/errors"), { method: "DELETE" })
  if (!response.ok) throw new Error(`Could not reset errors (${response.status})`)
}

export async function resetError(errorId: string) {
  const response = await fetch(getApiUrl(`/api/errors/${encodeURIComponent(errorId)}`), { method: "DELETE" })
  if (!response.ok) throw new Error(`Could not reset error (${response.status})`)
}

export async function updateError(
  errorId: string,
  status: IncidentStatus,
  resolutionNote?: string,
) {
  const response = await fetch(getApiUrl(`/api/errors/${encodeURIComponent(errorId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, resolutionNote: resolutionNote || null }),
  })
  if (!response.ok) throw new Error(`Could not update incident (${response.status})`)
  const payload: unknown = await response.json()
  const updated = payload && typeof payload === "object" && "error" in payload
    ? (payload as { error: unknown }).error
    : payload
  const normalized = normalizeError(updated)
  if (!normalized) throw new Error("Backend returned an invalid incident")
  return normalized
}

export function createErrorSocket(
  onError: (error: DetectionError) => void,
  onStatusChange: (status: WebSocket["readyState"]) => void,
  onFailure: () => void,
  onReset?: () => void,
  onRobotStatus?: (status: RobotStatus) => void,
  onErrorReset?: (errorId: string) => void,
) {
  const url = getWebSocketUrl(websocketPath)
  console.info("[ws] connecting to", url)
  const socket = new WebSocket(url)
  
  socket.onopen = () => {
    console.info("[ws] connection established")
    onStatusChange(socket.readyState)
  }
  
  socket.onclose = () => {
    console.warn("[ws] connection closed")
    onStatusChange(socket.readyState)
    onFailure()
  }
  
  socket.onerror = (err) => {
    console.error("[ws] connection error", err)
    onFailure()
  }
  
  socket.onmessage = (event) => {
    console.info("[ws] payload received:", event.data)
    try {
      const parsed: unknown = JSON.parse(event.data)
      if (parsed && typeof parsed === "object" && "type" in parsed
        && (parsed as { type?: string }).type === "errors.reset") {
        onReset?.()
        return
      }
      if (parsed && typeof parsed === "object" && "type" in parsed
        && (parsed as { type?: string }).type === "robot.status"
        && "status" in parsed) {
        onRobotStatus?.((parsed as { status: RobotStatus }).status)
        return
      }
      if (parsed && typeof parsed === "object" && "type" in parsed
        && (parsed as { type?: string }).type === "error.reset"
        && "errorId" in parsed) {
        onErrorReset?.(String((parsed as { errorId: unknown }).errorId))
        return
      }
      if (parsed && typeof parsed === "object" && "type" in parsed
        && (parsed as { type?: string }).type === "error.updated"
        && "error" in parsed) {
        const updated = normalizeError((parsed as { error: unknown }).error)
        if (updated) onError(updated)
        return
      }
      const payload = parsed && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error: unknown }).error
        : parsed
      const error = normalizeError(payload)
      if (error) onError(error)
    } catch {
      console.error("[ws] failed to parse incoming message")
      onFailure()
    }
  }
  
  onStatusChange(socket.readyState)
  return socket
}
