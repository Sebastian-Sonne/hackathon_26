import json
import asyncio
import random
import socket
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "factory.db"
VIDEO_DIR = BASE_DIR / "videos"
VIDEO_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Factory error middleend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def connection() -> sqlite3.Connection:
    database = sqlite3.connect(DATABASE_PATH)
    database.row_factory = sqlite3.Row
    return database


def init_db() -> None:
    with connection() as database:
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                priority TEXT NOT NULL,
                description TEXT NOT NULL,
                video_url TEXT,
                workstation_id TEXT,
                sensor_data TEXT,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                resolution_note TEXT,
                acknowledged_at TEXT,
                resolved_at TEXT
            )
            """
        )
        columns = {row["name"] for row in database.execute("PRAGMA table_info(errors)")}
        if "workstation_id" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN workstation_id TEXT")
        if "sensor_data" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN sensor_data TEXT")
        if "status" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN status TEXT NOT NULL DEFAULT 'new'")
        if "resolution_note" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN resolution_note TEXT")
        if "acknowledged_at" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN acknowledged_at TEXT")
        if "resolved_at" not in columns:
            database.execute("ALTER TABLE errors ADD COLUMN resolved_at TEXT")


init_db()


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.connections:
            self.connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        stale: list[WebSocket] = []
        for websocket in self.connections:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)


manager = ConnectionManager()
state_lock = asyncio.Lock()
transition_task: asyncio.Task | None = None
transition_generation = 0
paused_workstations: set[str] = set()
robot_status = {
    "status": "working",
    "workstationId": None,
    "activeWorkstationId": "WS-01",
    "message": "Robot is working normally",
    "pausedWorkstations": [],
}


def classify_error(sensor_data: dict, filename: str | None) -> dict:
    """Mock vision/sensor classification until the production model is connected."""
    faults = [
        {"category": "mechanical", "priority": "major", "description": "Gripper jammed during pickup"},
        {"category": "process", "priority": "minor", "description": "Dropped screw on assembly table"},
        {"category": "sensor", "priority": "critical", "description": "Vacuum loss detected on suction cup"},
    ]
    return random.choice(faults)


def parse_sensor_data(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {"raw": value}
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def serialize_error(row: sqlite3.Row, request: Request | None = None) -> dict:
    sensor_data = {}
    if row["sensor_data"]:
        try:
            sensor_data = json.loads(row["sensor_data"])
        except json.JSONDecodeError:
            sensor_data = {"raw": row["sensor_data"]}
    return {
        "id": row["id"],
        "category": row["category"],
        "priority": row["priority"],
        "description": row["description"],
        "videoUrl": row["video_url"].replace("/videos/", "/api/videos/") if row["video_url"] else None,
        "workstationId": row["workstation_id"],
        "sensorData": sensor_data,
        "createdAt": row["created_at"],
        "status": row["status"] or "new",
        "resolutionNote": row["resolution_note"],
        "acknowledgedAt": row["acknowledged_at"],
        "resolvedAt": row["resolved_at"],
    }


def blocking_workstations() -> set[str]:
    with connection() as database:
        rows = database.execute(
            """
            SELECT DISTINCT workstation_id
            FROM errors
            WHERE workstation_id IS NOT NULL
              AND priority IN ('critical', 'major')
              AND status != 'resolved'
            """
        ).fetchall()
    return {row["workstation_id"] for row in rows}


async def publish_robot_status(
    status: str,
    workstation_id: str | None,
    message: str,
    active_workstation_id: str | None = None,
) -> None:
    robot_status.update({
        "status": status,
        "workstationId": workstation_id,
        "activeWorkstationId": (
            active_workstation_id
            if active_workstation_id is not None
            else robot_status["activeWorkstationId"]
        ),
        "message": message,
        "pausedWorkstations": sorted(paused_workstations),
    })
    await manager.broadcast({"type": "robot.status", "status": robot_status.copy()})


def alternate_workstation(workstation_id: str) -> str:
    current = int(workstation_id.removeprefix("WS-"))
    candidates = [f"WS-{((current - 1 + offset) % 8) + 1:02d}" for offset in range(1, 9)]
    return next((candidate for candidate in candidates if candidate not in paused_workstations), "")


async def complete_minor_check(workstation_id: str, generation: int) -> None:
    await asyncio.sleep(2)
    if generation != transition_generation:
        return
    await publish_robot_status(
        "working",
        workstation_id,
        f"Minor issue checked; continuing on {workstation_id}",
        workstation_id,
    )


async def reroute_major_error(workstation_id: str, alternate: str, generation: int) -> None:
    await publish_robot_status(
        "rerouting",
        workstation_id,
        f"{workstation_id} paused; moving to {alternate}",
        alternate,
    )
    await asyncio.sleep(2)
    if generation != transition_generation:
        return
    await publish_robot_status(
        "working",
        workstation_id,
        f"Working on {alternate}; {workstation_id} remains paused",
        alternate,
    )


async def create_error(
    request: Request,
    workstation_id: str,
    sensor_data: dict,
    video: UploadFile | None = None,
) -> dict:
    result = classify_error(sensor_data, video.filename if video else None)
    video_url = None
    if video and video.filename:
        video_bytes = await video.read()
        is_mp4 = len(video_bytes) >= 8 and video_bytes[4:8] == b"ftyp"
        if not is_mp4:
            video_bytes = b""
    else:
        video_bytes = b""
    if video_bytes:
        filename = f"{uuid4().hex}_{Path(video.filename).name}"
        target = VIDEO_DIR / filename
        target.write_bytes(video_bytes)
        video_url = f"{str(request.base_url).rstrip('/')}/api/videos/{filename}"

    created_at = datetime.now(timezone.utc).isoformat()
    with connection() as database:
        cursor = database.execute(
            """
            INSERT INTO errors
              (category, priority, description, video_url, workstation_id, sensor_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["category"],
                result["priority"],
                result["description"],
                video_url,
                workstation_id,
                json.dumps(sensor_data),
                created_at,
            ),
        )
        error_id = cursor.lastrowid
        row = database.execute("SELECT * FROM errors WHERE id = ?", (error_id,)).fetchone()
    payload = serialize_error(row, request)
    await manager.broadcast({"type": "error.created", "error": payload})
    global transition_task, transition_generation
    async with state_lock:
        transition_generation += 1
        if transition_task and not transition_task.done():
            transition_task.cancel()
        if result["priority"] == "minor":
            await publish_robot_status(
                "evaluating",
                workstation_id,
                f"Checking minor issue on {workstation_id}; robot continues working",
                workstation_id,
            )
            transition_task = asyncio.create_task(
                complete_minor_check(workstation_id, transition_generation)
            )
        else:
            paused_workstations.add(workstation_id)
            alternate = alternate_workstation(workstation_id)
            if not alternate:
                await publish_robot_status(
                    "stopped",
                    workstation_id,
                    "All workstations are paused; production stopped",
                    "",
                )
            else:
                await publish_robot_status(
                    "rerouting",
                    workstation_id,
                    f"{workstation_id} paused due to {result['priority']} error",
                    alternate,
                )
                transition_task = asyncio.create_task(
                    reroute_major_error(workstation_id, alternate, transition_generation)
                )
    return payload


@app.get("/api/errors")
async def get_errors() -> dict:
    with connection() as database:
        rows = database.execute("SELECT * FROM errors ORDER BY id DESC").fetchall()
    return {"errors": [serialize_error(row) for row in rows]}


@app.patch("/api/errors/{error_id}")
async def update_error(error_id: int, request: Request) -> dict:
    payload = await request.json()
    status = payload.get("status")
    note = payload.get("resolutionNote")
    if status not in {"new", "acknowledged", "in_progress", "resolved"}:
        raise HTTPException(status_code=400, detail="Invalid incident status")
    if note is not None and not isinstance(note, str):
        raise HTTPException(status_code=400, detail="Resolution note must be text")

    now = datetime.now(timezone.utc).isoformat()
    with connection() as database:
        row = database.execute("SELECT * FROM errors WHERE id = ?", (error_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Error not found")
        acknowledged_at = row["acknowledged_at"]
        resolved_at = row["resolved_at"]
        if status in {"acknowledged", "in_progress", "resolved"} and not acknowledged_at:
            acknowledged_at = now
        if status == "resolved":
            resolved_at = now
        database.execute(
            """
            UPDATE errors
            SET status = ?, resolution_note = ?, acknowledged_at = ?, resolved_at = ?
            WHERE id = ?
            """,
            (status, note, acknowledged_at, resolved_at, error_id),
        )
        updated = database.execute("SELECT * FROM errors WHERE id = ?", (error_id,)).fetchone()

    paused_workstations.clear()
    paused_workstations.update(blocking_workstations())
    await manager.broadcast({"type": "error.updated", "error": serialize_error(updated)})
    await publish_robot_status(
        "working",
        None,
        "Robot is working normally" if not paused_workstations else "Robot is operating around paused workstations",
        robot_status["activeWorkstationId"],
    )
    return {"error": serialize_error(updated)}


@app.get("/api/videos/{filename}")
async def get_video(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    video_path = VIDEO_DIR / safe_name
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(video_path, media_type="video/mp4")


@app.post("/api/errors")
async def receive_error(
    request: Request,
    workstation_id: str = Form(...),
    sensor_data: str = Form("{}"),
    video: UploadFile | None = File(None),
) -> dict:
    return await create_error(request, workstation_id, parse_sensor_data(sensor_data), video)


@app.post("/api/upload-error")
async def upload_error(
    request: Request,
    workstation_id: str = Form("WS-01"),
    sensor_data: str = Form("{}"),
    video: UploadFile | None = File(None),
) -> dict:
    return await create_error(request, workstation_id, parse_sensor_data(sensor_data), video)


@app.post("/api/trigger-mock")
async def trigger_mock(request: Request) -> dict:
    workstation_id = f"WS-{random.randint(1, 8):02d}"
    sensor_data = {
        "temperature": round(random.uniform(35, 80), 1),
        "vibration": round(random.uniform(0.1, 2.5), 2),
        "pressure": round(random.uniform(1.0, 4.0), 2),
    }
    return await create_error(request, workstation_id, sensor_data)


@app.delete("/api/errors")
@app.post("/api/errors/reset")
async def reset_errors() -> dict:
    global transition_task, transition_generation
    with connection() as database:
        database.execute("DELETE FROM errors")
    async with state_lock:
        transition_generation += 1
        if transition_task and not transition_task.done():
            transition_task.cancel()
        paused_workstations.clear()
    await manager.broadcast({"type": "errors.reset"})
    await publish_robot_status("working", None, "Robot is working normally", "WS-01")
    return {"success": True}


@app.delete("/api/errors/{error_id}")
async def reset_error(error_id: int) -> dict:
    global transition_task, transition_generation
    with connection() as database:
        row = database.execute("SELECT workstation_id FROM errors WHERE id = ?", (error_id,)).fetchone()
        deleted = database.execute("DELETE FROM errors WHERE id = ?", (error_id,)).rowcount
    if not deleted:
        return {"success": False, "message": "Error not found"}
    async with state_lock:
        transition_generation += 1
        if transition_task and not transition_task.done():
            transition_task.cancel()
        if row and row["workstation_id"]:
            paused_workstations.discard(row["workstation_id"])
    await manager.broadcast({"type": "error.reset", "errorId": str(error_id)})
    await publish_robot_status("working", None, "Robot is working normally", robot_status["activeWorkstationId"])
    return {"success": True}


@app.get("/api/status")
async def get_status() -> dict:
    return {"status": robot_status.copy()}


@app.websocket("/ws/errors")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    await websocket.send_json({"type": "robot.status", "status": robot_status.copy()})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.on_event("startup")
async def startup_event() -> None:
    local_ip = get_local_ip()
    print(f"Factory middleend running at http://127.0.0.1:8000 (network: http://{local_ip}:8000)")


def get_local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
