import time
import json
import os
import uuid
import datetime
import requests
import pika

# --- CONFIGURATION ---
# Hostnames match 'container_name' in docker-compose
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://mars_simulator:8080/api/sensors")
BROKER_HOST = os.getenv("BROKER_HOST", "aresguard_broker")
BROKER_USER = os.getenv("RABBITMQ_DEFAULT_USER", "ares")
BROKER_PASS = os.getenv("RABBITMQ_DEFAULT_PASS", "mars2036")
QUEUE_NAME = "sensor_events"
POLLING_INTERVAL = 5  # Seconds

def get_rabbitmq_connection():
    """Handles RabbitMQ connection with a retry loop."""
    credentials = pika.PlainCredentials(BROKER_USER, BROKER_PASS)
    parameters = pika.ConnectionParameters(host=BROKER_HOST, credentials=credentials)
    
    while True:
        try:
            connection = pika.BlockingConnection(parameters)
            print(f"[INGESTION] Connected to RabbitMQ at {BROKER_HOST}")
            return connection
        except pika.exceptions.AMQPConnectionError:
            print("[INGESTION] RabbitMQ not ready yet. Retrying in 5s...")
            time.sleep(5)

def fetch_sensor_data():
    """Fetches raw data from the simulator."""
    try:
        response = requests.get(SIMULATOR_URL, timeout=3)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"[INGESTION] Simulator error: {response.status_code}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"[INGESTION] Cannot contact simulator ({e}).")
        return None

def normalize_event(sensor_id, raw_data):
    """Converts raw data into the Unified Event Schema."""
    # Example raw data: {"value": 24.5, "unit": "C"} or just 24.5
    value = raw_data.get("value") if isinstance(raw_data, dict) else raw_data
    unit = raw_data.get("unit", "") if isinstance(raw_data, dict) else ""
    
    return {
        "event_id": str(uuid.uuid4()),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": {
            "identifier": sensor_id,
            "protocol": "rest_polling"
        },
        "payload": {
            "value": value,
            "unit": unit,
            "category": "telemetry"
        }
    }

def main():
    print("[INGESTION] Starting service...")
    
    # 1. Connect to Broker
    connection = get_rabbitmq_connection()
    channel = connection.channel()
    
    # Declare the queue to ensure it exists
    channel.queue_declare(queue=QUEUE_NAME, durable=True)

    # 2. Infinite Loop
    try:
        while True:
            # A. Polling
            raw_data = fetch_sensor_data()
            
            if raw_data:
                print(f"[INGESTION] Data received: {len(raw_data)} sensors.")
                
                # B. Normalization and Publish for each sensor
                for sensor_id, sensor_value in raw_data.items():
                    event = normalize_event(sensor_id, sensor_value)
                    body = json.dumps(event)
                    
                    # C. Publish
                    channel.basic_publish(
                        exchange='',
                        routing_key=QUEUE_NAME,
                        body=body,
                        properties=pika.BasicProperties(
                            delivery_mode=2,  # Makes the message persistent
                        )
                    )
                print(f"[INGESTION] Published events to queue '{QUEUE_NAME}'")
            
            # Wait before next poll
            time.sleep(POLLING_INTERVAL)

    except KeyboardInterrupt:
        print("[INGESTION] Manual stop.")
        connection.close()
    except Exception as e:
        print(f"[INGESTION] Critical error: {e}")
        connection.close()

if __name__ == "__main__":
    main()