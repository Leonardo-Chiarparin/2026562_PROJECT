/**
 * ARESGUARD MISSION CONTROL - CORE SCRIPT
 * Synchronized with Normalized Ingestion Service.
 */

const WS_URL = "ws://localhost:8000/ws";
const API_URL = "http://localhost:8000/api/commands";

// Official Registry: IDs must match what the Ingestion Service sends
const SENSORS = [
    { id: 'greenhouse_temp', label: 'Greenhouse Temp', unit: 'C' },
    { id: 'entrance_hum', label: 'Entrance Humidity', unit: '%' },
    { id: 'co2_level', label: 'CO2 Hall Level', unit: 'ppm' },
    { id: 'corridor_press', label: 'Corridor Pressure', unit: 'hPa' },
    { id: 'water_tank', label: 'Water Tank Level', unit: '%' },
    { id: 'air_quality', label: 'Air Quality PM2.5', unit: 'µg' },
    { id: 'hydroponic_ph', label: 'Hydroponic pH', unit: 'pH' },
    { id: 'air_quality_voc', label: 'Air Quality VOC', unit: 'ppb' }
];

let actuatorCache = {};

function boot() {
    const grid = document.getElementById('sensor-grid');
    if (!grid) return;

    grid.innerHTML = SENSORS.map(s => `
        <div class="sensor-card" id="card-${s.id}">
            <span class="status-label status-ok" id="status-text-${s.id}">● Status: Normal</span>
            <div class="sensor-value-group">
                <h2 id="val-${s.id}">--.-</h2>
                <span class="unit">${s.unit}</span>
            </div>
            <p class="sensor-label">${s.label}</p>
        </div>
    `).join('');
    
    addLog("Dashboard Ready. Establishing Link...", "#3b82f6");
    connect();
}

function connect() {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        addLog("LINK ESTABLISHED: Telemetry streaming.", "#22c55e");
        document.getElementById('conn-status').innerText = "CONNECTED";
    };

    socket.onmessage = (event) => {
        const response = JSON.parse(event.data);
        const telemetry = response.data; // Dictionary of sensor objects

        Object.keys(telemetry).forEach(key => {
            const data = telemetry[key];
            
            // Extract value from payload (standard) or direct value (fallback)
            let val = null;
            if (data.payload && data.payload.value !== undefined) val = data.payload.value;
            else if (data.value !== undefined) val = data.value;

            if (val !== null) {
                // FLEXIBLE MAPPING: Matches 'temp' to 'greenhouse_temp', etc.
                const sensor = SENSORS.find(s => 
                    key === s.id || 
                    s.id.includes(key) || 
                    key.includes(s.id.split('_')[0])
                );

                if (sensor) {
                    const el = document.getElementById(`val-${sensor.id}`);
                    if (el) {
                        el.innerText = val.toFixed(1);
                        updateVisualAlerts(sensor.id, val);
                    }
                }
            }
        });
    };

    socket.onclose = () => {
        document.getElementById('conn-status').innerText = "RECONNECTING";
        setTimeout(connect, 3000);
    };
}

function updateVisualAlerts(id, val) {
    const card = document.getElementById(`card-${id}`);
    const isCrit = (id.includes('temp') && val > 25) || (id.includes('co2') && val > 1000);

    if (card) {
        if (isCrit) {
            card.classList.add('card-alert');
            document.getElementById(`status-text-${id}`).className = "status-label status-crit";
            document.getElementById(`status-text-${id}`).innerText = "● Status: CRITICAL";
        } else {
            card.classList.remove('card-alert');
            document.getElementById(`status-text-${id}`).className = "status-label status-ok";
            document.getElementById(`status-text-${id}`).innerText = "● Status: Normal";
        }
    }
}

async function toggleActuator(id, isChecked) {
    const state = isChecked ? "ON" : "OFF";
    if (actuatorCache[id] === state) return;

    try {
        const res = await fetch(`${API_URL}/${id}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ state: state })
        });
        if (res.ok) {
            actuatorCache[id] = state;
            addLog(`CMD ACK: ${id} -> ${state}`, "#3b82f6");
        }
    } catch (e) {
        addLog("NET ERROR: Gateway unresponsive", "#ef4444");
    }
}

function addLog(msg, color) {
    const log = document.getElementById('log-console');
    if (!log) return;
    const entry = document.createElement('div');
    entry.style.color = color;
    entry.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span> > ${msg}`;
    log.prepend(entry);
}

window.onload = boot;