import time
import json
import os
import uuid
import datetime
import requests
import pika

# --- CONFIGURATION ---
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://mars_simulator:8080/api/sensors")
BROKER_HOST = os.getenv("BROKER_HOST", "aresguard_broker")
BROKER_USER = os.getenv("RABBITMQ_DEFAULT_USER", "ares")
BROKER_PASS = os.getenv("RABBITMQ_DEFAULT_PASS", "mars2036")
QUEUE_NAME = "sensor_events"
POLLING_INTERVAL = 5

def get_rabbitmq_connection():
    """Handles RabbitMQ connection with a retry loop for service resilience."""
    credentials = pika.PlainCredentials(BROKER_USER, BROKER_PASS)
    parameters = pika.ConnectionParameters(host=BROKER_HOST, credentials=credentials)
    while True:
        try:
            connection = pika.BlockingConnection(parameters)
            print(f"[INGESTION] Connected to RabbitMQ at {BROKER_HOST}")
            return connection
        except pika.exceptions.AMQPConnectionError:
            print("[INGESTION] RabbitMQ not ready. Retrying in 5s...")
            time.sleep(5)

def build_event_schema(sensor_id, value, unit):
    """Constructs the normalized JSON event schema for the AresGuard ecosystem."""
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
        },
        "metadata": {
            "version": "1.0",
            "tags": ["polling", "normalized"]
        }
    }

def process_raw_data(sensor_id, raw_data):
    """
    Normalizes raw data. Unpacks 'measurements' arrays for complex sensors (e.g., VOC).
    Ensures 'air_quality_voc' mapping for frontend compatibility.
    """
    events = []
    
    # CASE 1: Complex/Chemistry sensors with nested measurements
    if 'measurements' in raw_data and isinstance(raw_data['measurements'], list):
        for measurement in raw_data['measurements']:
            val = measurement.get('value')
            un = measurement.get('unit', '')
            metric_type = measurement.get('metric', '')
            
            # NORMALIZATION LOGIC:
            # If sensor is VOC and metric is voc_ppb, we use 'air_quality_voc' 
            # as the primary ID to match the Mission Control Dashboard requirement.
            if sensor_id == "air_quality_voc" and metric_type == "voc_ppb":
                target_id = "air_quality_voc"
            elif metric_type:
                target_id = f"{sensor_id}_{metric_type}"
            else:
                target_id = sensor_id
                
            events.append(build_event_schema(target_id, val, un))
            
    # CASE 2: Standard scalar sensors
    else:
        # Check for multiple possible value keys from various simulator versions
        val = (raw_data.get('value') or 
               raw_data.get('level') or 
               raw_data.get('concentration') or 
               raw_data.get('ph'))
        
        if val is None: 
            val = 0.0
            
        un = raw_data.get('unit', '')
        events.append(build_event_schema(sensor_id, val, un))
        
    return events

def fetch_sensor_list():
    """Retrieves the list of active sensor IDs from the simulator."""
    try:
        response = requests.get(SIMULATOR_URL, timeout=3)
        return response.json().get("sensors", []) if response.status_code == 200 else None
    except requests.RequestException as e:
        print(f"[INGESTION] Fetch list error: {e}")
        return None

def fetch_sensor_data(sensor_id):
    """Retrieves raw data for a specific sensor ID."""
    try:
        response = requests.get(f"{SIMULATOR_URL}/{sensor_id}", timeout=2)
        return response.json() if response.status_code == 200 else None
    except requests.RequestException as e:
        print(f"[INGESTION] Fetch data error for {sensor_id}: {e}")
        return None

def main():
    """Main execution loop: Poll -> Normalize -> Publish."""
    connection = get_rabbitmq_connection()
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)

    try:
        while True:
            sensors_list = fetch_sensor_list()
            if sensors_list:
                for sensor_id in sensors_list:
                    raw_data = fetch_sensor_data(sensor_id)
                    if raw_data:
                        normalized_events = process_raw_data(sensor_id, raw_data)
                        for event in normalized_events:
                            channel.basic_publish(
                                exchange='',
                                routing_key=QUEUE_NAME,
                                body=json.dumps(event),
                                properties=pika.BasicProperties(delivery_mode=2)
                            )
                            # Log for real-time monitoring
                            print(f"[INGESTION] Dispatched: {event['source']['identifier']} -> {event['payload']['value']}")
            
            time.sleep(POLLING_INTERVAL)
            
    except KeyboardInterrupt:
        print("[INGESTION] Shutdown requested.")
        connection.close()
    except Exception as e:
        print(f"[INGESTION] Critical error: {e}")
        if not connection.is_closed:
            connection.close()

if __name__ == "__main__":
    main()