import json
import threading
import os
import requests
import pika
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# --- CONFIGURATION ---
BROKER_HOST = os.getenv("BROKER_HOST", "aresguard_broker")
BROKER_USER = os.getenv("RABBITMQ_DEFAULT_USER", "ares")
BROKER_PASS = os.getenv("RABBITMQ_DEFAULT_PASS", "mars2036")
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://mars_simulator:8080/api/actuators")
QUEUE_NAME = "sensor_events"

app = FastAPI(title="AresGuard API Gateway")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- IN-MEMORY STATE (Spec 4.1) ---
current_state = {} 

# --- WEBSOCKET MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send current snapshot on connection
        await websocket.send_json({"type": "FULL_STATE", "data": current_state})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections[:]:
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# --- RABBITMQ CONSUMER ---
def start_consumer():
    credentials = pika.PlainCredentials(BROKER_USER, BROKER_PASS)
    while True:
        try:
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(host=BROKER_HOST, credentials=credentials)
            )
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE_NAME, durable=True)

            print("[API Gateway] RabbitMQ Consumer Connected.")

            def callback(ch, method, properties, body):
                try:
                    event = json.loads(body)
                    sensor_id = event['source']['identifier']
                    
                    # 1. Update In-Memory Cache
                    current_state[sensor_id] = event
                    
                    # 2. Note: Broadcasting from a sync thread to async clients 
                    # is handled by the WebSocket loop in this specific implementation.
                except Exception as e:
                    print(f"[API Gateway] Callback Error: {e}")

            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=callback, auto_ack=True)
            channel.start_consuming()
        except Exception as e:
            print(f"[API Gateway] Connection Error: {e}. Retrying...")
            time.sleep(5)

# --- API ENDPOINTS ---

@app.on_event("startup")
async def startup_event():
    # Run consumer in background thread
    threading.Thread(target=start_consumer, daemon=True).start()

@app.get("/")
def read_root():
    return {"status": "AresGuard Gateway Online", "version": "1.0.0"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # PUSH LOGIC: Send updates every second to all connected clients
            await asyncio.sleep(1) 
            await websocket.send_json({"type": "UPDATE", "data": current_state})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/commands/{actuator_id}")
def send_command(actuator_id: str, command: dict):
    """Allows manual override of actuators via the dashboard."""
    try:
        res = requests.post(f"{SIMULATOR_URL}/{actuator_id}", json=command)
        return {"status": "success", "simulator_code": res.status_code}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/state")
def get_state():
    """Returns the latest cached state of all sensors."""
    return current_state