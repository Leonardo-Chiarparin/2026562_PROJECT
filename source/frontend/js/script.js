const host = window.location.hostname;

const ENDPOINTS = {
    WS: `ws://${host}:8000/ws`,
    API: `http://${host}:8000/api/commands`,
    SIMULATOR: `http://${host}:8080/api/sensors`,
    RULES: `http://${host}:8000/api/rules`
};

const SENSORS_REGISTRY = [
    { id: 'greenhouse_temperature_value', simId: 'greenhouse_temperature', label: 'Greenhouse Temp', shortLabel: 'TEMP.', unit: '°C', min: 0, max: 40 },
    { id: 'entrance_humidity_value', simId: 'entrance_humidity', label: 'Entrance Humidity', shortLabel: 'HUM.', unit: '%', min: 0, max: 100 },
    { id: 'co2_hall_value', simId: 'co2_hall', label: 'CO2 Hall Level', shortLabel: 'CO2', unit: 'ppm', min: 400, max: 1000 },
    { id: 'corridor_pressure_value', simId: 'corridor_pressure', label: 'Corridor Pressure', shortLabel: 'PRE.', unit: 'kPA', min: 90, max: 115 },
    { id: 'water_tank_level_level_pct', simId: 'water_tank_level', label: 'Water Tank Level', shortLabel: 'WATER %', unit: '%', min: 0, max: 100 },
    { id: 'water_tank_level_level_liters', simId: 'water_tank_level', label: 'Water Tank Vol', shortLabel: 'WATER L', unit: 'L', min: 0, max: 3000 },
    { id: 'hydroponic_ph_ph', simId: 'hydroponic_ph', label: 'Hydroponic pH', shortLabel: 'HYDRO', unit: 'pH', min: 4.0, max: 9.0 },
    { id: 'air_quality_pm25_pm25_ug_m3', simId: 'air_quality_pm25', label: 'PM 2.5 Level', shortLabel: 'PM 2.5', unit: 'µg', min: 0, max: 50 },
    { id: 'air_quality_pm25_pm1_ug_m3', simId: 'air_quality_pm25', label: 'PM 1.0 Level', shortLabel: 'PM 1.0', unit: 'µg', min: 0, max: 30 },
    { id: 'air_quality_pm25_pm10_ug_m3', simId: 'air_quality_pm25', label: 'PM 10 Level', shortLabel: 'PM 10', unit: 'µg', min: 0, max: 60 },
    { id: 'air_quality_voc_voc_ppb', simId: 'air_quality_voc', label: 'Volatile Org. Comp', shortLabel: 'VOC', unit: 'ppb', min: 0, max: 600 },
    { id: 'air_quality_voc_co2e_ppm', simId: 'air_quality_voc', label: 'CO2 Equivalent', shortLabel: 'CO2e', unit: 'ppm', min: 400, max: 1500 }
];

const ACTUATOR_IDS = ['cooling_fan', 'habitat_heater', 'hall_ventilation', 'entrance_humidifier'];

let systemState = { booted: false, sensorsReceived: new Set(), actuators: {}, criticalSensors: new Set() };
let bootStartTime;

function initMissionControl() {
    bootStartTime = Date.now();
    document.body.classList.add('no-scroll');
    renderGrid();
    renderEngineerViews();
    connect();
}

function renderGrid() {
    const grid = document.getElementById('sensor-grid');
    if (!grid) return;
    grid.innerHTML = SENSORS_REGISTRY.map(s => `
        <div class="sensor-card" id="card-${s.id}" onclick="toggleCardView('${s.id}')">
            <div class="view-primary">
                <span class="status-label status-ok" id="status-${s.id}">● NORMAL</span>
                <div class="sensor-value-group"><h2 id="val-${s.id}">--.-</h2><span class="unit">${s.unit}</span></div>
                <p class="sensor-label">${s.label}</p>
            </div>
            <div class="view-secondary">
                <span class="status-label" style="color:#aaa;">MONITORING RANGE</span>
                <div class="sensor-value-group"><h2 id="val-sec-${s.id}">--.-</h2><span class="unit">${s.unit}</span></div>
                <div class="mini-progress-container"><div class="mini-progress-bar" id="bar-${s.id}" style="width: 0%;"></div></div>
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <p class="sensor-label">MIN: ${s.min}</p><p class="sensor-label">MAX: ${s.max}</p>
                </div>
                <div class="refresh-section">
                    <span class="auto-refresh-label">● AUTO-REFRESH (5s)</span>
                    <button class="refresh-btn" onclick="forceRefresh('${s.id}', event)">↻ FETCH</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderEngineerViews() {
    const miniGrid = document.getElementById('mini-sensor-grid');
    if (miniGrid) {
        miniGrid.innerHTML = SENSORS_REGISTRY.map(s => `
            <div class="mini-card">
                <span class="mini-card-label">${s.shortLabel}</span>
                <span class="mini-card-val" id="mini-val-${s.id}">--.- <span style="font-size:9px;color:#555">${s.unit}</span></span>
            </div>
        `).join('');
    }

    const sensorSelect = document.getElementById('rule-sensor');
    if (sensorSelect) {
        sensorSelect.innerHTML = SENSORS_REGISTRY.map(s => `<option value="${s.id}">${s.id}</option>`).join('');
        sensorSelect.onchange = (e) => {
            const sel = SENSORS_REGISTRY.find(x => x.id === e.target.value);
            document.getElementById('rule-unit').innerText = sel ? sel.unit : '';
        };
        document.getElementById('rule-unit').innerText = SENSORS_REGISTRY[0].unit;
    }

    const actuatorSelect = document.getElementById('rule-actuator');
    if (actuatorSelect) {
        actuatorSelect.innerHTML = ACTUATOR_IDS.map(a => `<option value="${a}">${a}</option>`).join('');
    }
}

function connect() {
    const socket = new WebSocket(ENDPOINTS.WS);
    socket.onopen = () => {
        const statusEl = document.getElementById('conn-status');
        if (statusEl) { statusEl.innerText = "ONLINE"; statusEl.style.color = "#22c55e"; }
    };
    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === "FULL_STATE") {
                const items = Object.values(msg.data);
                items.forEach((entry, index) => {
                    setTimeout(() => { processEventData(entry); checkBootSequence(); }, index); 
                });
            } else if (msg.type === "LIVE_UPDATE") {
                processEventData(msg.data);
                checkBootSequence();
            }
        } catch(e) {}
    };
    socket.onclose = () => setTimeout(connect, 3000);
}

function processEventData(entry) {
    if (!entry || !entry.source || !entry.payload) return;
    const id = entry.source.identifier;
    const value = entry.payload.value;

    appendRawLog(entry);

    if (ACTUATOR_IDS.includes(id)) syncActuator(id, value);
    else { updateSensor(id, value); systemState.sensorsReceived.add(id); }
}

function appendRawLog(entry, isCommand = false) {
    const log = document.getElementById('raw-log-console');
    if (!log) return;
    
    const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    const blockType = isCommand ? "cmd" : "tel";
    const blockId = `${time}-${blockType}`;
    
    const firstChild = log.firstElementChild;
    if (firstChild && firstChild.dataset.blockId === blockId) {
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(entry, null, 2);
        firstChild.appendChild(pre);
        return;
    }

    const row = document.createElement('div');
    row.className = "raw-log-entry";
    row.dataset.blockId = blockId; 
    
    const prefix = isCommand 
        ? `<span style="color:#f59e0b; font-weight:bold;">> [${time}] Outbound Actuator Command:</span>` 
        : `<span style="color:#22c55e; font-weight:bold;">> [${time}] Normalized Telemetry:</span>`;
    
    row.innerHTML = `${prefix} <pre>${JSON.stringify(entry, null, 2)}</pre>`;
    
    log.prepend(row);
    if (log.children.length > 50) log.removeChild(log.lastChild);
}

function updateSensor(id, val) {
    const config = SENSORS_REGISTRY.find(s => s.id === id);
    if (!config) return;

    const valStr = typeof val === 'number' ? val.toFixed(1) : val;
    
    const elPrim = document.getElementById(`val-${id}`);
    const elSec = document.getElementById(`val-sec-${id}`);
    if (elPrim) elPrim.innerText = valStr;
    if (elSec) elSec.innerText = valStr;

    const miniVal = document.getElementById(`mini-val-${id}`);
    if (miniVal) miniVal.innerHTML = `${valStr} <span style="font-size:9px;color:#555">${config.unit}</span>`;

    const bar = document.getElementById(`bar-${id}`);
    if (bar && typeof val === 'number') {
        let pct = ((val - config.min) / (config.max - config.min)) * 100;
        pct = Math.max(0, Math.min(100, pct));
        bar.style.width = `${pct}%`;
        bar.style.background = (val < config.min || val > config.max) ? '#ef4444' : '#22c55e';
    }

    const card = document.getElementById(`card-${id}`);
    const statusEl = document.getElementById(`status-${id}`);
    
    let state = "NORMAL"; let cssClass = "status-ok"; let isCrit = false;

    if (val > config.max || val < config.min) {
        state = "CRITICAL"; cssClass = "status-crit"; isCrit = true;
        if (!systemState.criticalSensors.has(id)) {
            systemState.criticalSensors.add(id);
            addLog(`Critical Alarm: ${config.label} reads a value beyond safe thresholds.`, "#ef4444");
        }
    } else {
        if (systemState.criticalSensors.has(id)) {
            systemState.criticalSensors.delete(id);
            addLog(`Recovery: ${config.label} returned to nominal parameters.`, "#22c55e");
        }
    }

    if (statusEl) {
        statusEl.innerText = `● ${state}`;
        statusEl.className = `status-label ${cssClass}`;
    }
    if (card) {
        if (isCrit) card.classList.add('card-alert');
        else card.classList.remove('card-alert');
    }
    const banner = document.getElementById('critical-banner');
    if (banner) banner.style.display = document.querySelector('.card-alert') ? 'block' : 'none';
}

function syncActuator(id, rawState) {
    let newState = String(rawState).toUpperCase();
    if (newState === "TRUE" || newState === "ON" || newState === "1") newState = "ON";
    else newState = "OFF";

    const toggle = document.getElementById(`toggle-${id}`);
    if (toggle) {
        toggle.checked = (newState === "ON"); toggle.disabled = false; 
        if (toggle.nextElementSibling) toggle.nextElementSibling.style.opacity = "1"; 
    }
    const statusText = document.getElementById(`status-text-${id}`);
    if (statusText) {
        const color = (newState === "ON") ? "#22c55e" : "#555"; 
        statusText.innerHTML = `STATUS: <span style="color: ${color}">${newState}</span>`;
    }
    if (systemState.actuators[id] !== newState && systemState.booted) {
        systemState.actuators[id] = newState;
        addLog(`System Confirmed: ${id} is ${newState}`, "#f59e0b");
    } else {
        systemState.actuators[id] = newState;
    }
    document.body.style.cursor = 'default';
}

async function forceRefresh(id, event) {
    event.stopPropagation();
    const config = SENSORS_REGISTRY.find(s => s.id === id);
    if(!config || !config.simId) return;

    const btn = event.currentTarget; const originalText = btn.innerHTML;
    btn.innerHTML = "WAIT..."; btn.style.opacity = "0.7";

    try {
        const res = await fetch(`${ENDPOINTS.SIMULATOR}/${config.simId}`);
        if (!res.ok) throw new Error("Net Error");
        const data = await res.json();
        let val = 0;
        if (data.measurements) {
            const match = data.measurements.find(m => id.includes(m.name) || id.includes(m.metric));
            if (match) val = match.value; else val = data.measurements[0].value;
        } else {
            const exactKey = id.replace(config.simId + '_', ''); 
            if (data[exactKey] !== undefined) val = data[exactKey];
            else val = data.value || data.level || data.concentration || data.ph || 0;
        }
        updateSensor(id, val);
        addLog(`Manual Fetch: ${config.label} reads ${val.toFixed(1)} ${config.unit}`, "#f59e0b");
    } catch(e) {
        addLog(`Error: Manual fetch for ${config.label} failed.`, "#ef4444");
    } finally {
        btn.innerHTML = originalText; btn.style.opacity = "1";
    }
}

async function manualToggle(id, isChecked) {
    const toggle = document.getElementById(`toggle-${id}`);
    const currentState = systemState.actuators[id] === "ON";
    toggle.checked = currentState; toggle.disabled = true;
    if (toggle.nextElementSibling) toggle.nextElementSibling.style.opacity = "0.5";
    document.body.style.cursor = 'wait';

    const newState = isChecked ? "ON" : "OFF";
    addLog(`Manual CMD: Transmitting ${newState} to ${id}...`, "#3b82f6");

    const payload = { state: newState };
    
    appendRawLog({
        command_id: "cmd-" + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        target: { actuator_id: id, action: newState },
        issued_by: "manual_override",
        payload: payload
    }, true);
    
    try {
        await fetch(`${ENDPOINTS.API}/${id}`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ state: newState })
        });
    } catch (e) {
        addLog(`Link Failure: ${id} command lost.`, "#ef4444");
        toggle.disabled = false;
        if (toggle.nextElementSibling) toggle.nextElementSibling.style.opacity = "1";
        document.body.style.cursor = 'default';
    }
}

function checkBootSequence() {
    if (systemState.booted) return;
    const count = systemState.sensorsReceived.size; const total = SENSORS_REGISTRY.length;
    const bar = document.getElementById('boot-progress'); const log = document.getElementById('boot-log');

    if (bar) bar.style.width = `${(count / total) * 100}%`;
    if (log) log.innerHTML = `Loading Modules<span class="bouncing-dots"><span>.</span><span>.</span><span>.</span></span> (${count}/${total})`;

    if (count >= 5) {
        systemState.booted = true;
        const elapsed = Date.now() - bootStartTime;
        const remaining = Math.max(0, 2000 - elapsed);
        setTimeout(() => {
            const overlay = document.getElementById('boot-overlay');
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => { 
                    overlay.style.display = 'none'; document.body.classList.remove('no-scroll');
                    addLog("AresGuard Online. Mission Active.", "#22c55e");
                }, 800);
            }
        }, remaining);
    }
}

function toggleCardView(id) { 
    const card = document.getElementById(`card-${id}`);
    if (card) card.classList.toggle('active-view'); 
}

function addLog(msg, color) {
    const log = document.getElementById('log-console');
    if (!log) return;
    const row = document.createElement('div');
    row.innerHTML = `<span style="color:#555">[${new Date().toLocaleTimeString()}]</span> <span style="color:${color}">${msg}</span>`;
    log.prepend(row);
}

function setRole(role) {
    const specView = document.getElementById('specialist-view');
    const engView = document.getElementById('engineer-view');
    const title = document.getElementById('main-title');

    document.getElementById('btn-role-specialist').classList.remove('active');
    document.getElementById('btn-role-engineer').classList.remove('active');
    document.getElementById(`btn-role-${role}`).classList.add('active');

    if (role === 'specialist') {
        document.body.classList.remove('engineer-mode');
        specView.style.display = 'block';
        engView.style.display = 'none';
        title.innerText = "ARESGUARD: MISSION CONTROL";
    } else {
        document.body.classList.add('engineer-mode'); 
        specView.style.display = 'none';
        engView.style.display = 'block';
        title.innerText = "ARESGUARD: AUTOMATION ENGINE";
        fetchRules(); 
    }
}

async function fetchRules() {
    try {
        const res = await fetch(ENDPOINTS.RULES);
        if(!res.ok) throw new Error();
        const rules = await res.json();
        renderRules(rules);
    } catch (e) {
        document.getElementById('rules-tbody').innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444;">Could not fetch rules from database. Ensure Rule Engine Backend is running.</td></tr>`;
    }
}

function renderRules(rules) {
    const tbody = document.getElementById('rules-tbody');
    if (!tbody) return;
    if (rules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No automation rules found. System is in manual mode.</td></tr>`;
        return;
    }
    tbody.innerHTML = rules.map(r => `
        <tr>
            <td style="color:#f59e0b;">${r.rule_id}</td>
            <td>IF <strong>${r.sensor_id}</strong> ${r.operator} ${r.threshold}</td>
            <td>SET <strong>${r.actuator_id}</strong> to <span style="color:${r.action === 'ON' ? '#22c55e' : '#555'}; font-weight:bold;">${r.action}</span></td>
            <td>
                <button class="btn-del" onclick="deleteRule('${r.rule_id}')">\\ DELETE</button>
            </td>
        </tr>
    `).join('');
}

async function saveRule() {
    const sensor = document.getElementById('rule-sensor').value;
    const operator = document.getElementById('rule-operator').value;
    const threshold = parseFloat(document.getElementById('rule-value').value);
    const actuator = document.getElementById('rule-actuator').value;
    const action = document.getElementById('rule-action').value;
    
    if (isNaN(threshold)) { alert("Please enter a valid numeric threshold."); return; }
    
    const rule = { sensor_id: sensor, operator: operator, threshold: threshold, actuator_id: actuator, action: action };
    
    try {
        const res = await fetch(ENDPOINTS.RULES, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(rule)
        });
        if(!res.ok) throw new Error();
        fetchRules();
        addLog(`New Rule Applied for ${sensor}`, "#22c55e");
    } catch (e) {
        alert("Failed to save rule. Check backend connection.");
    }
}

async function deleteRule(id) {
    if(!confirm(`Delete rule ${id}?`)) return;
    try {
        await fetch(`${ENDPOINTS.RULES}/${id}`, { method: 'DELETE' });
        fetchRules();
        addLog(`Rule ${id} removed.`, "#ef4444");
    } catch (e) {
        console.error("Failed to delete rule", e);
    }
}

window.onload = initMissionControl;