import pika
import json
import psycopg2
import requests
import os
import time

# --- CONFIGURATION ---
DB_CONFIG = os.getenv("DATABASE_URL", "host=aresguard_db dbname=aresguard user=ares password=mars2036")
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://mars_simulator:8080/api/actuators")
BROKER_HOST = os.getenv("BROKER_HOST", "aresguard_broker")
RABBIT_USER = os.getenv("RABBITMQ_DEFAULT_USER", "ares")
RABBIT_PASS = os.getenv("RABBITMQ_DEFAULT_PASS", "mars2036")
QUEUE_NAME = "sensor_events"

def check_condition(sensor_value, operator, threshold):
    """
    Evaluates the rule condition based on the operator.
    Supports: >, <, >=, <=, =
    """
    if operator == '>': return sensor_value > threshold
    if operator == '<': return sensor_value < threshold
    if operator == '>=': return sensor_value >= threshold
    if operator == '<=': return sensor_value <= threshold
    if operator == '=': return sensor_value == threshold
    return False

def evaluate_rules(event):
    """
    Fetches dynamic rules from the database and triggers actuators if conditions are met.
    """
    sensor_id = event['source']['identifier']
    current_value = event['payload']['value']
    
    try:
        conn = psycopg2.connect(DB_CONFIG)
        cur = conn.cursor()
        # Fetch dynamic rules for this specific sensor from the 'rules' table
        cur.execute("SELECT operator, threshold, actuator_id, action_value FROM rules WHERE sensor_id = %s", (sensor_id,))
        rules = cur.fetchall()
        
        for op, threshold, actuator, action in rules:
            if check_condition(current_value, op, threshold):
                print(f"[RuleEngine] MATCH: {sensor_id} ({current_value}) {op} {threshold}. Sending {action} to {actuator}")
                requests.post(f"{SIMULATOR_URL}/{actuator}", json={"state": action})
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[RuleEngine] Rule Evaluation Error: {e}")

def save_to_db(event):
    """
    Persists normalized sensor data into PostgreSQL for historical tracking.
    """
    try:
        conn = psycopg2.connect(DB_CONFIG)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO public.sensor_data (sensor_id, value, unit, timestamp) VALUES (%s, %s, %s, %s)",
            (event['source']['identifier'], event['payload']['value'], event['payload']['unit'], event['timestamp'])
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[RuleEngine] Database Persistence Error: {e}")

def callback(ch, method, properties, body):
    """Standard RabbitMQ callback processing."""
    try:
        event = json.loads(body)
        save_to_db(event)
        evaluate_rules(event)
    except Exception as e:
        print(f"[RuleEngine] Callback Error: {e}")

def main():
    credentials = pika.PlainCredentials(RABBIT_USER, RABBIT_PASS)
    while True:
        try:
            print(f"[RuleEngine] Connecting to broker at {BROKER_HOST}...")
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(host=BROKER_HOST, credentials=credentials)
            )
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE_NAME, durable=True)
            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=callback, auto_ack=True)
            print("[RuleEngine] System Online. Waiting for normalized events...")
            channel.start_consuming()
        except Exception as e:
            print(f"[RuleEngine] Connection failed: {e}. Retrying in 5s...")
            time.sleep(5)

if __name__ == "__main__":
    main()