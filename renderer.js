let API_PASSWORD = "aaac9f1b3f62";
let API_URL = "http://109.228.37.5:21120/player/list";
let CHAT_API_URL = "http://109.228.37.5:21120/chat";
let CHAT_HISTORY_URL = "http://109.228.37.5:3456/chat";
let CORS_PROXY = "";
const IS_ELECTRON = navigator.userAgent.includes('Electron');

// Load saved config immediately so it overrides the defaults above
(function loadConfigFromStorageEarly() {
  try {
    const stored = localStorage.getItem('mtconfig');
    if (!stored) return;
    const config = JSON.parse(stored);
    if (config.api_base) {
      API_URL = config.api_base.replace(/\/$/, '') + '/player/list';
      CHAT_API_URL = config.api_base.replace(/\/$/, '') + '/chat';
    }
    if (config.chat_history_url) CHAT_HISTORY_URL = config.chat_history_url;
    if (config.api_password) API_PASSWORD = config.api_password;
    // Never apply CORS proxy in Electron — it handles CORS natively
    if (!IS_ELECTRON && config.cors_proxy !== undefined) CORS_PROXY = config.cors_proxy;
  } catch(e) {}
})();
const MAP = {
  width: 6000,
  height: 8000
};
const CALIBRATION = {
  scaleX: 0.00346213,
  scaleY: 0.00346367,  
  offsetX: 3516,
  offsetY: 1257
};
const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  maxZoom: 5,
  zoom: 1,
  scrollWheelZoom: true,
  wheelPxPerZoomLevel: 120,
  maxBounds: [[-200, -200], [MAP.height + 200, MAP.width + 200]],
  maxBoundsViscosity: 0.8,
  preferCanvas: true,  
  renderer: L.canvas({ tolerance: 5 }), 
  zoomAnimation: false,  
  markerZoomAnimation: false,  
  fadeAnimation: false  
});
const bounds = [[0, 0], [MAP.height, MAP.width]];
const imageLayer = L.imageOverlay('map_new.png', bounds, {
  opacity: 1,
  interactive: false,
  crossOrigin: false
}).addTo(map);
map.fitBounds(bounds);
// Use a dedicated SVG renderer for the boundary so it repaints continuously
// during panning (canvas renderer only repaints on pan-end, causing the
// "line appears after you stop" glitch).
const boundaryRect = L.rectangle(bounds, {
  color: '#00b1e0',
  weight: 3,
  fill: false,
  dashArray: '5, 5',
  interactive: false,
  renderer: L.svg({ padding: 5 })
}).addTo(map);
const coordDisplay = L.control({position: 'bottomleft'});
coordDisplay.onAdd = function(map) {
  this._div = L.DomUtil.create('div', 'coord-display');
  this._div.innerHTML = '<strong>Hover over map</strong>';
  return this._div;
};
coordDisplay.addTo(map);
let hoveredGameX = null;
let hoveredGameY = null;
map.on('mousemove', function(e) {
  const leafletY = e.latlng.lat;
  const leafletX = e.latlng.lng;
  const pixelY = MAP.height - leafletY;
  const pixelX = leafletX;
  const gameX = (pixelX - CALIBRATION.offsetX) / CALIBRATION.scaleX;
  const gameY = (pixelY - CALIBRATION.offsetY) / CALIBRATION.scaleY;
  hoveredGameX = gameX;
  hoveredGameY = gameY;
  coordDisplay._div.innerHTML = 
    '<strong>Game Coordinates:</strong><br>' +
    `X=${gameX.toFixed(2)}<br>` +
    `Y=${gameY.toFixed(2)}`;
});
map.on('mouseout', function() {
  coordDisplay._div.innerHTML = '<strong>Hover over map</strong>';
});
const defaultIcon = L.icon({
  iconUrl: 'assets/player-icon.png',
  iconSize: [30, 30],
  iconAnchor: [20, 15],
  popupAnchor: [0, -20]
});
/**
 * Default checkpoint marker — cyan dot + white gate line, rotated to match waypoint direction.
 */
function makeCheckpointDivIcon(gx, gy) {
  const angleDeg = (gx !== undefined && gy !== undefined)
    ? Math.atan2(gx, -gy) * 180 / Math.PI
    : 0;
  const html = `<svg viewBox="-30 -30 60 60" width="56" height="56"
    style="transform:rotate(${angleDeg.toFixed(1)}deg);overflow:visible;display:block">
    <line x1="-22" y1="0" x2="22" y2="0"
      stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
    <circle cx="0" cy="0" r="6.5" fill="#00ccff" stroke="white" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({ html, iconSize: [56,56], iconAnchor: [28,28], className: 'checkpoint-div-icon' });
}

/**
 * Highlighted (open in CP manager) variant — gold dot instead of cyan.
 */
function makeCheckpointHighlightIcon(gx, gy) {
  const angleDeg = (gx !== undefined && gy !== undefined)
    ? Math.atan2(gx, -gy) * 180 / Math.PI
    : 0;
  const html = `<svg viewBox="-30 -30 60 60" width="56" height="56"
    style="transform:rotate(${angleDeg.toFixed(1)}deg);overflow:visible;display:block">
    <line x1="-22" y1="0" x2="22" y2="0"
      stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
    <circle cx="0" cy="0" r="6.5" fill="#ffaa00" stroke="white" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({ html, iconSize: [56,56], iconAnchor: [28,28], className: 'checkpoint-div-icon' });
}

/**
 * Rotating variant — dot + gate + arrow, CSS-rotated so arrow points toward (gx,gy).
 * Uses atan2(gx, -gy): gx=screen-right, gy=screen-up (already negated from dLat),
 * so -gy aligns the SVG "up" axis with screen up correctly.
 */
function makeCheckpointRotatingIcon(gx, gy) {
  const angleDeg = Math.atan2(gx, -gy) * 180 / Math.PI;
  const html = `<svg viewBox="-30 -30 60 60" width="56" height="56"
    style="transform:rotate(${angleDeg.toFixed(1)}deg);overflow:visible;display:block">
    <line x1="-22" y1="0" x2="22" y2="0"
      stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>
    <line x1="0" y1="4" x2="0" y2="-22"
      stroke="#00e84c" stroke-width="2" stroke-linecap="round"/>
    <line x1="-5" y1="-17" x2="0" y2="-24" stroke="#00e84c" stroke-width="2" stroke-linecap="round"/>
    <line x1="5" y1="-17" x2="0" y2="-24" stroke="#00e84c" stroke-width="2" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="6.5" fill="#00ccff" stroke="white" stroke-width="1.5"/>
  </svg>`;
  return L.divIcon({ html, iconSize: [56,56], iconAnchor: [28,28], className: 'checkpoint-div-icon' });
}
const markers = {};
let raceTrackMarkers = [];

// ── Shared SVG renderer for all arrow/boundary vector layers ─────────────────
const svgRenderer = L.svg({ padding: 5 });

// ── Race state ────────────────────────────────────────────────────────────────
let currentRaceData = null;   // live copy of the loaded race (mutations go here)
let currentRaceName = null;   // name it was loaded from (null = imported/unsaved)
let _checkpointLabelSizesFn = null; // current zoom listener, for cleanup
let raceTrackArrows = [];     // parallel array to raceTrackMarkers: {line, head}|null

// ── Arrow appearance — all sizes are in screen pixels, auto-scaled per zoom ───
const ARROW_GATE_PX    = 8;   // gate half-width in screen pixels
const ARROW_SHAFT_F_PX = 10.5;   // shaft length forward from centre in screen pixels
const ARROW_SHAFT_B_PX = 10.5;   // shaft tail behind centre in screen pixels
const ARROW_HEAD_D_PX  = 4;   // arrowhead depth in screen pixels
const ARROW_HEAD_W_PX  = 4;   // arrowhead half-width in screen pixels
const ARROW_SCALE      = 2; // global scale multiplier (increase to make everything bigger)s

/** Convert screen-pixel sizes to map coordinate units at the current zoom. */
function arrowMapUnits() {
  const s = ARROW_SCALE / Math.pow(2, map.getZoom());
  return {
    gateHalf:   ARROW_GATE_PX    * s,
    shaftFront: ARROW_SHAFT_F_PX * s,
    shaftBack:  ARROW_SHAFT_B_PX * s,
    headDepth:  ARROW_HEAD_D_PX  * s,
    headHalf:   ARROW_HEAD_W_PX  * s,
  };
}
let rotEditActive     = false;
let rotEditIdx        = null;
let rotEditHoldTimer  = null;
let chatColors = JSON.parse(localStorage.getItem('chatColors')) || ['FFFFFF', 'FF0000', '00FF00', '0000FF'];
let selectedColor = chatColors[0];
let chatUsername = localStorage.getItem('chatUsername') || '';
let allPlayers = []; 
let isVisible = true; 
let pollInterval = null; 
function parseLocation(loc) {
  const m = loc.match(/X=([-\d.]+)\sY=([-\d.]+)\sZ=([-\d.]+)/);
  if (!m) return null;
  return {
    x: Number(m[1]),
    y: Number(m[2]),
    z: Number(m[3])
  };
}
function worldToMap(x, y) {
  const mapX = x * CALIBRATION.scaleX + CALIBRATION.offsetX;
  const mapY = y * CALIBRATION.scaleY + CALIBRATION.offsetY;
  return {
    mapX,
    mapY: MAP.height - mapY  
  };
}
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function updatePlayerList(playerArray) {
  const listContainer = document.getElementById('playerList');
  const countBadge = document.getElementById('playerCount');
  const searchInput = document.getElementById('playerSearch');
  if (!listContainer || !countBadge) return;
  allPlayers = playerArray;
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  let filteredPlayers = playerArray;
  if (searchTerm) {
    filteredPlayers = playerArray.filter(p => 
      p.name.toLowerCase().includes(searchTerm) || 
      p.unique_id.toLowerCase().includes(searchTerm)
    );
  }
  if (searchTerm && filteredPlayers.length !== playerArray.length) {
    countBadge.textContent = `${filteredPlayers.length}/${playerArray.length}`;
  } else {
    countBadge.textContent = playerArray.length;
  }
  filteredPlayers.sort((a, b) => a.name.localeCompare(b.name));
  listContainer.innerHTML = '';
  if (filteredPlayers.length === 0 && searchTerm) {
    listContainer.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">No players found</div>';
    return;
  }
  filteredPlayers.forEach(player => {
    const item = document.createElement('div');
    item.className = 'player-item';
    item.innerHTML = `
      <div class="player-name">${escapeHtml(player.name)}</div>
      <div class="player-id">ID: ${escapeHtml(player.unique_id)}</div>
    `;
    item.addEventListener('click', () => {
      if (trackedPlayerId === player.unique_id) { closeTracker(); return; }
      if (markers[player.unique_id]) {
        const marker = markers[player.unique_id];
        map.setView(marker.getLatLng(), 2);
        marker.openPopup();
      }
      openTracker(player.unique_id, player.name);
    });
    if (player.unique_id === trackedPlayerId) item.classList.add('tracked');
    listContainer.appendChild(item);
  });
}
// ── Smooth marker movement — velocity integration + drift correction ──────────
// Primary: position += velocity * dt  (no position snapping)
// Correction: a tiny fraction of position error is added each frame to prevent
//             drift accumulation without causing visible nudges
const markerSmooth = {};

const VEL_BLEND      = 4;     // velocity correction rate (1/sec) — lower = smoother turns
const DRIFT_CORRECT  = 1.5;   // position error bleed-off rate (1/sec) — keep low to avoid nudge
const VEL_CUTOFF     = 1e-6;
const TELEPORT_THRESHOLD = 500; // map units — jumps larger than this snap instantly

function setMarkerTarget(id, lat, lng) {
  const now = performance.now();
  let sm = markerSmooth[id];

  if (!sm) {
    markerSmooth[id] = {
      lat, lng,
      velLat: 0, velLng: 0,
      trueLat: lat, trueLng: lng,
      lastPollTime: now,
      rafId: null
    };
    markers[id] && markers[id].setLatLng([lat, lng]);
    startSmoothLoop(id);
    return;
  }

  const dt = Math.max((now - sm.lastPollTime) / 1000, 0.05);

  // Detect teleport — large jump snaps the marker instantly, no velocity carry-over
  const dLat = lat - sm.trueLat;
  const dLng = lng - sm.trueLng;
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);
  if (dist > TELEPORT_THRESHOLD) {
    sm.lat = lat;
    sm.lng = lng;
    sm.velLat = 0;
    sm.velLng = 0;
    sm.trueLat = lat;
    sm.trueLng = lng;
    sm.lastPollTime = now;
    markers[id] && markers[id].setLatLng([lat, lng]);
    if (!sm.rafId) startSmoothLoop(id);
    return;
  }

  // Measured velocity
  const measVelLat = dLat / dt;
  const measVelLng = dLng / dt;

  // Blend velocity toward measured
  const t = Math.min(1, VEL_BLEND * dt);
  sm.velLat += (measVelLat - sm.velLat) * t;
  sm.velLng += (measVelLng - sm.velLng) * t;

  // Store authoritative position for drift correction
  sm.trueLat = lat;
  sm.trueLng = lng;
  sm.lastPollTime = now;

  if (!sm.rafId) startSmoothLoop(id);
}

function startSmoothLoop(id) {
  const sm = markerSmooth[id];
  if (!sm) return;
  let last = performance.now();

  function step(now) {
    const marker = markers[id];
    if (!marker || !markerSmooth[id]) return;
    const sm = markerSmooth[id];

    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const speed = Math.sqrt(sm.velLat * sm.velLat + sm.velLng * sm.velLng);
    if (speed > VEL_CUTOFF) {
      // Integrate velocity
      sm.lat += sm.velLat * dt;
      sm.lng += sm.velLng * dt;

      // Add a tiny correction toward authoritative position to bleed off drift
      const errLat = sm.trueLat - sm.lat;
      const errLng = sm.trueLng - sm.lng;
      const c = DRIFT_CORRECT * dt;
      sm.lat += errLat * c;
      sm.lng += errLng * c;

      marker.setLatLng([sm.lat, sm.lng]);
    }

    sm.rafId = requestAnimationFrame(step);
  }

  sm.rafId = requestAnimationFrame(step);
}

function removeMarkerSmooth(id) {
  if (markerSmooth[id]) {
    if (markerSmooth[id].rafId) cancelAnimationFrame(markerSmooth[id].rafId);
    delete markerSmooth[id];
  }
}

// ── Location History Tracker ──────────────────────────────────────────────────
const LOC_HISTORY_MS   = 30 * 60 * 1000; // 30 minutes
const LOC_MIN_DIST     = 5;              // only record if moved > 5 world units
const locationHistory  = {};             // { unique_id: [{x, y, z, ts}] }
let   trackedPlayerId  = null;
let   trackedPolyline  = null;
let   trackedDots      = [];

function recordLocation(id, x, y, z) {
  const now = Date.now();
  if (!locationHistory[id]) locationHistory[id] = [];
  const hist = locationHistory[id];
  // Only store if moved meaningfully
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    const dx = x - last.x, dy = y - last.y;
    if (Math.sqrt(dx*dx + dy*dy) < LOC_MIN_DIST) return;
  }
  hist.push({ x, y, z, ts: now });
  // Prune old entries
  const cutoff = now - LOC_HISTORY_MS;
  while (hist.length > 0 && hist[0].ts < cutoff) hist.shift();
}

function pruneAllHistory() {
  const cutoff = Date.now() - LOC_HISTORY_MS;
  for (const id in locationHistory) {
    const h = locationHistory[id];
    while (h.length > 0 && h[0].ts < cutoff) h.shift();
  }
}

function formatAge(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

function openTracker(id, name) {
  trackedPlayerId = id;
  document.getElementById('locTrackerName').textContent = `📍 ${name}`;
  document.getElementById('locTrackerPanel').classList.add('open');
  renderTrackerPanel();
  drawTrackerPolyline();
}

function closeTracker() {
  trackedPlayerId = null;
  document.getElementById('locTrackerPanel').classList.remove('open');
  if (trackedPolyline) { map.removeLayer(trackedPolyline); trackedPolyline = null; }
  trackedDots.forEach(d => map.removeLayer(d)); trackedDots = [];
  document.querySelectorAll('.player-item.tracked').forEach(el => el.classList.remove('tracked'));
}

function renderTrackerPanel() {
  const body = document.getElementById('locTrackerBody');
  if (!body || !trackedPlayerId) return;
  pruneAllHistory();
  const hist = locationHistory[trackedPlayerId] || [];
  if (hist.length === 0) {
    body.innerHTML = '<div class="loc-tracker-empty">No location data yet.<br>Waiting for movement…</div>';
    return;
  }
  body.innerHTML = '';
  // Show newest first
  const reversed = [...hist].reverse();
  reversed.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = 'loc-entry';
    el.innerHTML = `
      <div class="loc-entry-dot"></div>
      <div class="loc-entry-info">
        <div class="loc-entry-coords">X: ${Math.round(entry.x)}&nbsp;&nbsp;Y: ${Math.round(entry.y)}&nbsp;&nbsp;Z: ${Math.round(entry.z)}</div>
        <div class="loc-entry-time">${formatAge(entry.ts)}</div>
      </div>
    `;
    // Click to pan map to that position
    el.addEventListener('click', () => {
      const { mapX, mapY } = worldToMap(entry.x, entry.y);
      map.setView([mapY, mapX], map.getZoom());
    });
    body.appendChild(el);
  });
}

function drawTrackerPolyline() {
  if (trackedPolyline) { map.removeLayer(trackedPolyline); trackedPolyline = null; }
  trackedDots.forEach(d => map.removeLayer(d)); trackedDots = [];
  if (!trackedPlayerId) return;
  const hist = locationHistory[trackedPlayerId] || [];
  if (hist.length === 0) return;

  const now = Date.now();

  // Draw fading breadcrumb dots — oldest faint, newest bright & larger
  hist.forEach((e, i) => {
    const ageFrac = Math.min((now - e.ts) / LOC_HISTORY_MS, 1); // 0=new, 1=30min old
    const opacity = 0.15 + (1 - ageFrac) * 0.75;                // 0.15 → 0.90
    const isLatest = i === hist.length - 1;
    const { mapX, mapY } = worldToMap(e.x, e.y);
    const dot = L.circleMarker([mapY, mapX], {
      radius:      isLatest ? 5 : 3,
      color:       isLatest ? '#ffaa00' : '#cc8800',
      fillColor:   isLatest ? '#ffaa00' : '#cc8800',
      fillOpacity: opacity,
      opacity:     opacity,
      weight:      1,
      interactive: false
    }).addTo(map);
    trackedDots.push(dot);
  });

  // Connecting dashed line
  if (hist.length >= 2) {
    const latlngs = hist.map(e => { const { mapX, mapY } = worldToMap(e.x, e.y); return [mapY, mapX]; });
    trackedPolyline = L.polyline(latlngs, {
      color: '#ffaa00',
      weight: 2,
      opacity: 0.5,
      dashArray: '4 6',
      interactive: false
    }).addTo(map);
  }
}

document.getElementById('locTrackerClose').addEventListener('click', closeTracker);

// Close tracker on map click, but not after a drag/pan
let _mapDragged = false;
map.on('dragstart', () => { _mapDragged = true; });
map.on('click', () => { if (!_mapDragged && trackedPlayerId) closeTracker(); _mapDragged = false; });
map.on('dragend', () => { setTimeout(() => { _mapDragged = false; }, 50); });

// ── Heatmap ───────────────────────────────────────────────────────────────────
const HEATMAP_STORAGE_KEY = 'mt_heatmap_alltime';
const HEATMAP_CELL        = 50;
const HEATMAP_RADIUS      = 35;
const HEATMAP_BLUR        = 25;
let   hmRadius            = HEATMAP_RADIUS;

// Session data: { 'cx,cy': count }
const hmSessionCells = {};

// All-time data loaded from localStorage: { 'cx,cy': count }
let hmAllTimeCells = {};
try {
  const raw = localStorage.getItem(HEATMAP_STORAGE_KEY);
  if (raw) hmAllTimeCells = JSON.parse(raw);
} catch(e) {}

let hmLayer = null;
let hmMode  = null; // 'session' | 'alltime' | null

function hmCellKey(x, y) {
  return `${Math.round(x / HEATMAP_CELL)},${Math.round(y / HEATMAP_CELL)}`;
}

function recordHeatPoint(x, y) {
  const k = hmCellKey(x, y);
  hmSessionCells[k] = (hmSessionCells[k] || 0) + 1;
  hmAllTimeCells[k] = (hmAllTimeCells[k] || 0) + 1;
  if (hmAllTimeCells[k] % 30 === 0) saveAllTimeHeatmap();
}

function saveAllTimeHeatmap() {
  try { localStorage.setItem(HEATMAP_STORAGE_KEY, JSON.stringify(hmAllTimeCells)); } catch(e) {}
}

function buildHeatPoints(cells) {
  const pts = [];
  const counts = Object.values(cells);
  if (counts.length === 0) return pts;
  const maxCount = Math.max(...counts);
  for (const [key, count] of Object.entries(cells)) {
    const [cx, cy] = key.split(',').map(Number);
    const wx = cx * HEATMAP_CELL;
    const wy = cy * HEATMAP_CELL;
    const { mapX, mapY } = worldToMap(wx, wy);
    const intensity = Math.sqrt(count / maxCount);
    pts.push([mapY, mapX, intensity]);
  }
  return pts;
}

function refreshHeatmap() {
  if (hmLayer) { map.removeLayer(hmLayer); hmLayer = null; }
  if (!hmMode) return;

  const cells = hmMode === 'session' ? hmSessionCells : hmAllTimeCells;
  const pts   = buildHeatPoints(cells);
  const total = Object.values(cells).reduce((a, b) => a + b, 0);

  document.getElementById('hmDataInfo').textContent =
    pts.length > 0 ? `${pts.length.toLocaleString()} zones · ${total.toLocaleString()} samples` : 'No data yet';

  if (pts.length === 0) return;

  const zoom         = map.getZoom();
  const scaledRadius = Math.max(6, hmRadius * Math.pow(2, zoom - 1));
  const scaledBlur   = Math.max(4, HEATMAP_BLUR * Math.pow(2, zoom - 1));

  hmLayer = L.heatLayer(pts, {
    radius:  scaledRadius,
    blur:    scaledBlur,
    max:     1.0,
    gradient: { 0.0: '#000033', 0.2: '#0000ff', 0.4: '#00ffff', 0.6: '#ffff00', 0.8: '#ff6600', 1.0: '#ff0000' }
  }).addTo(map);
}

// Redraw on zoom to prevent canvas drift with CRS.Simple
map.on('zoomend', () => { if (hmMode) refreshHeatmap(); });

function setHeatmapMode(mode) {
  hmMode = mode;
  document.getElementById('hmSessionBtn').classList.toggle('active', mode === 'session');
  document.getElementById('hmAllTimeBtn').classList.toggle('active', mode === 'alltime');
  refreshHeatmap();
}

document.getElementById('hmSessionBtn').addEventListener('click', () => setHeatmapMode('session'));
document.getElementById('hmAllTimeBtn').addEventListener('click', () => setHeatmapMode('alltime'));
document.getElementById('hmRadiusSlider').addEventListener('input', function() {
  hmRadius = parseInt(this.value);
  document.getElementById('hmRadiusVal').textContent = hmRadius;
  if (hmMode) refreshHeatmap();
});
document.getElementById('hmOffBtn').addEventListener('click', () => {
  setHeatmapMode(null);
  document.getElementById('hmDataInfo').textContent = 'No data yet';
});

document.getElementById('sidebarHeatmapBtn').addEventListener('click', () => {
  const panel = document.getElementById('heatmapPanel');
  const isOpen = panel.classList.contains('open');
  closeAllPanels();
  if (!isOpen) {
    panel.classList.add('open');
    document.getElementById('sidebarHeatmapBtn').classList.add('active');
  }
});

// Periodically refresh heatmap layer so intensity stays current
setInterval(() => { if (hmMode) refreshHeatmap(); }, 5000);
// Save all-time data before unload
window.addEventListener('beforeunload', saveAllTimeHeatmap);

// ── Player icon visibility toggle ─────────────────────────────────────────────
let playerIconsVisible = true;

document.getElementById('togglePlayerIconsBtn').addEventListener('click', function() {
  playerIconsVisible = !playerIconsVisible;
  this.classList.toggle('active', playerIconsVisible);
  for (const id in markers) {
    const el = markers[id].getElement();
    if (el) el.style.opacity = playerIconsVisible ? '' : '0';
  }
});

let pendingUpdate = false;
async function pollPlayers() {
  if (!isVisible || pendingUpdate) return;
  pendingUpdate = true;
  try {
    const res = await fetch(`${CORS_PROXY}${API_URL}?password=${API_PASSWORD}`);
    const json = await res.json();
    if (!json.succeeded) { pendingUpdate = false; return; }

    const players = json.data;
    const seen = new Set();
    const playerArray = [];

    for (const key in players) {
      const p = players[key];
      seen.add(p.unique_id);
      playerArray.push(p);
      const loc = parseLocation(p.location);
      if (!loc) continue;
      const { mapX, mapY } = worldToMap(loc.x, loc.y);

      // Record location history for all players
      recordLocation(p.unique_id, loc.x, loc.y, loc.z || 0);
      // Record heatmap data
      recordHeatPoint(loc.x, loc.y);

      if (!markers[p.unique_id]) {
        markers[p.unique_id] = L.marker([mapY, mapX], { icon: defaultIcon, riseOnHover: false })
          .addTo(map)
          .bindPopup(`<strong>${p.name}</strong>`, { closeButton: false, autoPan: false });
        // Click marker to open tracker
        markers[p.unique_id].on('click', () => {
          if (trackedPlayerId === p.unique_id) { closeTracker(); return; }
          openTracker(p.unique_id, p.name);
        });
        // Respect current icon visibility
        if (!playerIconsVisible) {
          const el = markers[p.unique_id].getElement();
          if (el) el.style.opacity = '0';
        }
      }
      setMarkerTarget(p.unique_id, mapY, mapX);
    }

    for (const id in markers) {
      if (!seen.has(id)) {
        removeMarkerSmooth(id);
        map.removeLayer(markers[id]);
        delete markers[id];
        if (trackedPlayerId === id) closeTracker();
      }
    }

    updatePlayerList(playerArray);

    // Refresh tracker panel and polyline if open
    if (trackedPlayerId) {
      renderTrackerPanel();
      drawTrackerPolyline();
    }

    pendingUpdate = false;
  } catch (err) {
    console.error("API error:", err);
    pendingUpdate = false;
  }
}
document.addEventListener('visibilitychange', () => {
  isVisible = !document.hidden;
  if (isVisible) {
    console.log('Window visible - resuming updates');
    pollPlayers();
  } else {
    console.log('Window hidden - keeping chat polling active');
  }
});
pollInterval = setInterval(pollPlayers, 1000);
pollPlayers();
let chatPollInterval = setInterval(pollIncomingChat, 2000);
pollIncomingChat();
function displayChatMessage(name, message, isOwn = false, isAnnouncement = false) {
  const container = document.getElementById('chatMessages');
  const messageEl = document.createElement('div');
  messageEl.className = 'chat-message';
  if (isAnnouncement) messageEl.classList.add('announcement');
  const time = new Date().toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true
  });
  function normalizeMsg(m) {
    if (m === undefined || m === null) return '';
    try {
      let s = String(m);
      s = s.replace(/\+/g, ' ');
      s = s.replace(/%2B/ig, '+');
      if (/%[0-9A-Fa-f]{2}/.test(s)) {
        s = decodeURIComponent(s);
      }
      s = s.replace(/\s+/g, ' ').trim();
      return s;
    } catch (e) {
      return String(m).replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  const safeMessage = normalizeMsg(message);
  messageEl.innerHTML = `<span class="player-name">${escapeHtml(name)}:</span> ${escapeHtml(safeMessage)} <span class="message-time">${time}</span>`;
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
  return messageEl;
}
async function sendChatMessage(message) {
  if (!message || !message.trim()) {
    if (pendingMapLinks.length === 0) return;
  }
  try {
    const combinedLink = pendingMapLinks.join(' & ');
    const fullMessage = combinedLink
      ? (message.trim() ? `${combinedLink} ${message.trim()}` : combinedLink)
      : message;
    clearMapLinkPills();
    const displayMsg = chatUsername ? `[${chatUsername}] ${fullMessage}` : fullMessage;
    trackSentMessage(fullMessage);
    const isAnnouncement = document.getElementById('announceCheckbox') && document.getElementById('announceCheckbox').checked;
    const displayName = isAnnouncement ? (chatUsername ? `Announcement [${chatUsername}]` : 'Announcement') : 'You';
    const friendlyDisplay = fullMessage.replace(/<mt_link[^>]*>\(Open Map\)<\/>/g, '📍 [map link]');
    displayChatMessage(displayName, friendlyDisplay, true, isAnnouncement);
    const typeParam = isAnnouncement ? 'announce' : 'message';
    const url = `${CHAT_API_URL}?password=${encodeURIComponent(API_PASSWORD)}&message=${encodeURIComponent(displayMsg)}&type=${encodeURIComponent(typeParam)}&color=${encodeURIComponent(selectedColor)}`;
    const res = await fetch(`${CORS_PROXY}${url}`, { method: 'POST' });
    if (!res.ok) {
      console.warn(`Chat API response: ${res.status}`);
      displayChatMessage('System', `Failed to send message (HTTP ${res.status})`);
    }
  } catch (err) {
    console.error('Chat send error:', err);
    displayChatMessage('System', 'Error sending message');
  }
}
const sendBtn = document.getElementById('sendBtn');
const chatInputEl = document.getElementById('chatInput');
if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    const input = chatInputEl;
    if (!input) return;
    sendChatMessage(input.value);
    input.value = '';
    input.focus();
  });
}
if (chatInputEl) {
  chatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendChatMessage(chatInputEl.value);
      chatInputEl.value = '';
    }
  });
}
let lastChatId = 0; 
const recentlySentMsgs = new Set();

// chat status helper (shows online/offline/error in header)
const chatStatusEl = document.getElementById('chatStatus');
function setChatStatus(text, color = '#fff') {
  if (chatStatusEl) {
    chatStatusEl.textContent = text;
    chatStatusEl.style.color = color;
  }
}

// initialize to unknown until first poll
setChatStatus('...');

// track last reported status so we don't spam the chat pane
let lastChatStatus = '';

function trackSentMessage(text) {
  recentlySentMsgs.add(text);
  setTimeout(() => recentlySentMsgs.delete(text), 10000);
}
async function pollIncomingChat() {
  try {
    const res = await fetch(`${CORS_PROXY}${CHAT_HISTORY_URL}?since=${lastChatId}`);
    if (!res.ok) {
      if (lastChatStatus !== 'error') {
        displayChatMessage('System', `Chat fetch failed (HTTP ${res.status})`);
      }
      lastChatStatus = 'error';
      setChatStatus('error', '#f90');
      return;
    }
    const json = await res.json();
    if (!Array.isArray(json.messages)) {
      if (lastChatStatus !== 'error') {
        displayChatMessage('System', 'Chat returned invalid data');
      }
      lastChatStatus = 'error';
      setChatStatus('error', '#f90');
      return;
    }
    // successful poll
    if (lastChatStatus !== 'online') {
      displayChatMessage('System', 'Chat connection restored');
    }
    lastChatStatus = 'online';
    setChatStatus('online', '#0f0');
    json.messages.forEach(msg => {
      if (msg.id > lastChatId) lastChatId = msg.id;
      if (recentlySentMsgs.has(msg.msg)) return;
      const cleanMessage = msg.msg
        .replace(/<mt_link[^>]*>\(Open Map\)<\/\>/g, '📍 [map link]')
        .replace(/<[^>]+>/g, '');
      displayChatMessage(msg.player, cleanMessage, false);
    });
  } catch (err) {
    if (lastChatStatus !== 'offline') {
      displayChatMessage('System', `Chat poll error: ${err.message}`);
    }
    lastChatStatus = 'offline';
    setChatStatus('offline', '#f00');
    console.warn('pollIncomingChat error', err);
  }
}
setInterval(pollIncomingChat, 2000);
pollIncomingChat();
function initializeColorPalette() {
  const selector = document.getElementById('colorSelector');
  selector.innerHTML = '';
  chatColors.forEach((color, idx) => {
    const quickPick = document.createElement('div');
    quickPick.className = 'color-quick-pick' + (color === selectedColor ? ' selected' : '');
    quickPick.style.backgroundColor = '#' + color;
    quickPick.title = '#' + color;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-color-btn';
    removeBtn.textContent = 'Ã—';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chatColors.length > 1) {
        chatColors.splice(idx, 1);
        localStorage.setItem('chatColors', JSON.stringify(chatColors));
        if (selectedColor === color) {
          selectedColor = chatColors[0];
        }
        initializeColorPalette();
      }
    });
    quickPick.appendChild(removeBtn);
    quickPick.addEventListener('click', () => {
      selectedColor = color;
      initializeColorPalette();
    });
    selector.appendChild(quickPick);
  });
}
function setupColorControls() {
  const input = document.getElementById('hexColorInput');
  const btn = document.getElementById('addColorBtn');
  function addColor() {
    let hex = input.value.trim().toUpperCase();
    if (!hex) {
      alert('Enter a hex color (e.g., FF5500)');
      return;
    }
    if (hex.startsWith('#')) {
      hex = hex.substring(1);
    }
    if (!/^[0-9A-F]{6}$/.test(hex)) {
      alert('Invalid hex code. Use 6 characters: RRGGBB');
      return;
    }
    if (!chatColors.includes(hex)) {
      chatColors.push(hex);
      localStorage.setItem('chatColors', JSON.stringify(chatColors));
      input.value = '';
      initializeColorPalette();
    } else {
      alert('Color already added');
    }
  }
  btn.addEventListener('click', addColor);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addColor();
  });
}
initializeColorPalette();
setupColorControls();
function setupUsernameControls() {
  const input = document.getElementById('usernameField');
  const clearBtn = document.getElementById('clearUsernameBtn');
  if (!input) return;
  input.value = chatUsername || '';
  function saveUsername() {
    const v = input.value.trim();
    chatUsername = v;
    if (v) localStorage.setItem('chatUsername', v);
    else localStorage.removeItem('chatUsername');
  }
  input.addEventListener('blur', saveUsername);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveUsername();
      input.blur();
    }
  });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    input.value = '';
    chatUsername = '';
    localStorage.removeItem('chatUsername');
    input.focus();
  });
}
setupUsernameControls();
const MAP_LINK_KEY = 'f';
let pendingMapLinks = []; 
function updatePill() {
  const pill = document.getElementById('mapLinkPill');
  const pillText = document.getElementById('pillText');
  const input = document.getElementById('chatInput');
  if (!pill) return;
  if (pendingMapLinks.length === 0) {
    pill.style.display = 'none';
    if (input) input.placeholder = 'Send a message...';
  } else {
    const label = pendingMapLinks.length === 1
      ? 'map link'
      : `map link ×${pendingMapLinks.length}`;
    if (pillText) pillText.textContent = label;
    pill.style.display = 'inline-flex';
    if (input) input.placeholder = 'Add a message...';
  }
}
function addMapLinkPill(linkStr, focusInput) {
  pendingMapLinks.push(linkStr);
  updatePill();
  if (focusInput) {
    const input = document.getElementById('chatInput');
    if (input) input.focus();
  }
}
function clearMapLinkPills() {
  pendingMapLinks = [];
  updatePill();
}
const pillRemove = document.getElementById('pillRemove');
if (pillRemove) {
  pillRemove.addEventListener('click', (e) => {
    if (e.shiftKey) {
      clearMapLinkPills();
    } else {
      pendingMapLinks.pop();
      updatePill();
    }
    if (chatInputEl) chatInputEl.focus();
  });
}
document.addEventListener('keydown', function(e) {
  const settingsModal = document.getElementById('settingsModal');
  if (e.key === 'Escape') {
    if (settingsModal) {
      if (settingsModal.classList.contains('active')) {
        settingsModal.classList.remove('active');
      } else {
        settingsModal.classList.add('active');
      }
    }
    return;
  }
  
  const tag = document.activeElement && document.activeElement.tagName.toLowerCase();
  const inInput = tag === 'input' || tag === 'textarea';
  if (inInput && e.key === 'Backspace' && pendingMapLinks.length > 0) {
    const input = document.getElementById('chatInput');
    if (input && input.value === '') {
      clearMapLinkPills();
      e.preventDefault();
      return;
    }
  }
  if (inInput) return;
  if (e.key.toLowerCase() !== MAP_LINK_KEY) return;
  if (hoveredGameX === null || hoveredGameY === null) return;
  e.preventDefault();
  const x = Math.round(hoveredGameX);
  const y = Math.round(hoveredGameY);
  const mapLink = `<mt_link target="WorldMapLocation" value="${x},${y},0,250000" closeChatBox="1">(Open Map)</>`;
  const focusInput = !e.shiftKey; 
  addMapLinkPill(mapLink, focusInput);
});
const searchInput = document.getElementById('playerSearch');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    updatePlayerList(allPlayers);
  });
}

const ENCRYPTION_KEY = 'mttrackingapp-v1';

function encryptConfig(config) {
  const jsonStr = JSON.stringify(config);
  return CryptoJS.AES.encrypt(jsonStr, ENCRYPTION_KEY).toString();
}

function decryptConfig(encryptedText) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
    const jsonStr = bytes.toString(CryptoJS.enc.Utf8);
    if (!jsonStr) throw new Error('Decryption failed');
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

function getCurrentConfig() {
  // Read from localStorage so it stays in sync with what's actually saved
  try {
    const stored = localStorage.getItem('mtconfig');
    if (stored) return JSON.parse(stored);
  } catch(e) {}
  return { api_base: '', chat_history_url: '', api_password: '' };
}

function loadConfigFromStorage() {
  const stored = localStorage.getItem('mtconfig');
  if (stored) {
    try {
      const config = JSON.parse(stored);
      if (config.api_base) {
        API_URL = config.api_base.replace(/\/$/, '') + '/player/list';
        CHAT_API_URL = config.api_base.replace(/\/$/, '') + '/chat';
      }
      if (config.chat_history_url) CHAT_HISTORY_URL = config.chat_history_url;
      if (config.api_password) API_PASSWORD = config.api_password;
      if (!IS_ELECTRON && config.cors_proxy !== undefined) CORS_PROXY = config.cors_proxy;
    } catch (e) {}
  }
}

function saveConfigToStorage(config) {
  localStorage.setItem('mtconfig', JSON.stringify(config));
}

loadConfigFromStorage();

const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');

function populateManualFields() {
  const config = getCurrentConfig();
  document.getElementById('apiBaseUrl').value = config.api_base || '';
  document.getElementById('chatHistoryUrl').value = config.chat_history_url || '';
  document.getElementById('apiPassword').value = config.api_password || '';
  document.getElementById('corsProxy').value = config.cors_proxy || '';
  document.getElementById('apiPassword').type = 'password';
  document.getElementById('togglePassword').textContent = 'Show';
  document.getElementById('toggleBaseUrl').textContent = 'Show';
  document.getElementById('toggleChatUrl').textContent = 'Show';
  document.getElementById('apiBaseUrl').type = 'password';
  document.getElementById('chatHistoryUrl').type = 'password';
}

settingsBtn.addEventListener('click', () => {
  // Clear manual fields so saved values are never exposed until the user
  // explicitly opens the Manual tab
  document.getElementById('apiBaseUrl').value = '';
  document.getElementById('chatHistoryUrl').value = '';
  document.getElementById('apiPassword').value = '';
  document.getElementById('apiPassword').type = 'password';
  document.getElementById('apiBaseUrl').type = 'password';
  document.getElementById('chatHistoryUrl').type = 'password';
  document.getElementById('togglePassword').textContent = 'Show';
  document.getElementById('toggleBaseUrl').textContent = 'Show';
  document.getElementById('toggleChatUrl').textContent = 'Show';
  settingsModal.classList.add('active');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove('active');
  }
});

const modalTabs = document.querySelectorAll('.modal-tab');
modalTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.getAttribute('data-tab');
    document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    // Populate fields when switching to manual tab
    if (tabName === 'manual') populateManualFields();
  });
});

function setupBlurToggle(inputId, buttonId, isPassword) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  if (!input || !button) return;
  button.addEventListener('click', (e) => {
    e.preventDefault();
    if (isPassword) {
      if (input.type === 'password') {
        input.type = 'text';
        button.textContent = 'Hide';
      } else {
        input.type = 'password';
        button.textContent = 'Show';
      }
    } else {
      if (input.classList.contains('blurred-input')) {
        input.classList.remove('blurred-input');
        button.textContent = 'Hide';
      } else {
        input.classList.add('blurred-input');
        button.textContent = 'Show';
      }
    }
  });
}

setupBlurToggle('apiPassword', 'togglePassword', true);
setupBlurToggle('apiBaseUrl', 'toggleBaseUrl', true);
setupBlurToggle('chatHistoryUrl', 'toggleChatUrl', true);


document.getElementById('saveConfigBtn').addEventListener('click', () => {
  const config = {
    api_base: document.getElementById('apiBaseUrl').value.trim(),
    chat_history_url: document.getElementById('chatHistoryUrl').value.trim(),
    api_password: document.getElementById('apiPassword').value,
    cors_proxy: document.getElementById('corsProxy').value.trim()
  };
  
  if (!config.api_base || !config.api_password) {
    alert('API Base URL and Password are required');
    return;
  }
  
  saveConfigToStorage(config);
  API_PASSWORD = config.api_password;
  API_URL = config.api_base.replace(/\/$/, '') + '/player/list';
  CHAT_API_URL = config.api_base.replace(/\/$/, '') + '/chat';
  if (config.chat_history_url) CHAT_HISTORY_URL = config.chat_history_url;
  CORS_PROXY = IS_ELECTRON ? '' : (config.cors_proxy || '');
  
  alert('Configuration saved!');
  settingsModal.classList.remove('active');
  location.reload();
});

document.getElementById('cancelConfigBtn').addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

document.getElementById('resetConfigBtn').addEventListener('click', () => {
  if (!confirm('Remove all saved API config?')) return;
  localStorage.removeItem('mtconfig');
  // Clear in-memory values so polling stops working immediately
  API_PASSWORD = '';
  API_URL = '';
  CHAT_API_URL = '';
  CHAT_HISTORY_URL = '';
  // Clear all player markers from the map
  Object.keys(markers).forEach(id => {
    map.removeLayer(markers[id]);
    delete markers[id];
  });
  allPlayers = [];
  updatePlayerList([]);
  document.getElementById('apiBaseUrl').value = '';
  document.getElementById('chatHistoryUrl').value = '';
  document.getElementById('apiPassword').value = '';
  const btn = document.getElementById('resetConfigBtn');
  btn.textContent = '✓ Cleared';
  setTimeout(() => { btn.textContent = 'Reset'; }, 1500);
});

document.getElementById('applyEncryptedBtn').addEventListener('click', () => {
  const encryptedText = document.getElementById('encryptedConfigInput').value.trim();
  if (!encryptedText) {
    alert('Please paste an encrypted config code');
    return;
  }
  
  const config = decryptConfig(encryptedText);
  if (!config) {
    alert('Invalid or corrupted encrypted config. Please check the code and try again.');
    return;
  }
  
  saveConfigToStorage(config);
  API_PASSWORD = config.api_password;
  API_URL = config.api_base.replace(/\/$/, '') + '/player/list';
  CHAT_API_URL = config.api_base.replace(/\/$/, '') + '/chat';
  if (config.chat_history_url) CHAT_HISTORY_URL = config.chat_history_url;
  if (!IS_ELECTRON && config.cors_proxy !== undefined) CORS_PROXY = config.cors_proxy;
  
  alert('Configuration applied!');
  settingsModal.classList.remove('active');
  location.reload();
});

document.getElementById('cancelEncryptedBtn').addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

document.getElementById('exportConfigBtn').addEventListener('click', () => {
  const config = getCurrentConfig();
  const encrypted = encryptConfig(config);
  const display = document.getElementById('exportedConfig');
  display.textContent = encrypted;
  display.style.display = 'block';
  
  const copyBtn = document.getElementById('exportConfigBtn');
  copyBtn.textContent = 'Copy Encrypted Config';
  copyBtn.onclick = (e) => {
    e.preventDefault();
    navigator.clipboard.writeText(encrypted).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Export Config As Encrypted';
        copyBtn.onclick = null;
      }, 2000);
    });
  };
});

// Race Track functionality

// Import button — reads clipboard, validates, loads
document.getElementById('raceImportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('raceImportBtn');

  function flashBtn(success) {
    btn.textContent = success ? '✔ Imported' : '✕ Invalid';
    btn.classList.add(success ? 'success' : 'fail');
    setTimeout(() => {
      btn.textContent = 'Import';
      btn.classList.remove('success', 'fail');
    }, 2000);
  }

  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    flashBtn(false);
    return;
  }

  const ok = loadRaceFromJSON(text.trim());
  flashBtn(ok);
  if (ok && document.getElementById('checkpoint-manager').classList.contains('open')) {
    setTimeout(renderCheckpointManager, 50);
  }
});

// Export button — copies current race JSON to clipboard
document.getElementById('raceExportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('raceExportBtn');
  const jsonText = document.getElementById('raceTrackInput').value.trim();

  if (!jsonText) {
    btn.textContent = '✕ No race loaded';
    btn.classList.add('fail');
    setTimeout(() => { btn.textContent = 'Export'; btn.classList.remove('fail'); }, 2000);
    return;
  }

  try {
    await navigator.clipboard.writeText(jsonText);
    btn.textContent = '✔ Copied!';
    btn.classList.add('success');
    setTimeout(() => { btn.textContent = 'Export'; btn.classList.remove('success'); }, 2000);
  } catch (e) {
    btn.textContent = '✕ Failed';
    btn.classList.add('fail');
    setTimeout(() => { btn.textContent = 'Export'; btn.classList.remove('fail'); }, 2000);
  }
});

// ── Race Menu ──────────────────────────────────────────────────────────────
const RACES_STORAGE_KEY = 'motortown_saved_races';

/*
 * Tree-based store shape:
 *   { races: {name:jsonStr}, tree: [TreeNode] }
 *
 * TreeNode:
 *   { t:'r', n:'raceName' }
 *   { t:'f', n:'folderName', open:bool, c:[TreeNode] }
 *
 * Migration from the old flat shape is handled in getStore().
 */

function getStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(RACES_STORAGE_KEY) || '{}');

    // ── Oldest format: just { name: jsonString } ─────────────────────────────
    if (!raw.races) {
      const entries = Object.entries(raw).filter(([,v]) => typeof v === 'string');
      const races = Object.fromEntries(entries);
      const tree  = entries.map(([k]) => ({ t:'r', n:k }));
      return { races, tree };
    }

    // ── Old format: races + rootRaces/folders/folderOpen ─────────────────────
    if (!raw.tree) {
      const tree = [];
      (raw.rootRaces || []).filter(n => raw.races[n]).forEach(n => tree.push({ t:'r', n }));
      const allFolderRaces = new Set(Object.values(raw.folders || {}).flat());
      Object.keys(raw.races).forEach(n => {
        if (!(raw.rootRaces||[]).includes(n) && !allFolderRaces.has(n)) tree.push({ t:'r', n });
      });
      Object.entries(raw.folders || {}).forEach(([fn, children]) => {
        tree.push({
          t:'f', n:fn,
          open: !!(raw.folderOpen||{})[fn],
          c: children.filter(n => raw.races[n]).map(n => ({ t:'r', n }))
        });
      });
      return { races: raw.races || {}, tree };
    }

    return { races: raw.races || {}, tree: raw.tree || [] };
  } catch(e) {
    return { races: {}, tree: [] };
  }
}

function setStore(s) {
  localStorage.setItem(RACES_STORAGE_KEY, JSON.stringify({ races: s.races, tree: s.tree }));
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function treeCountRaces(nodes) {
  let n = 0;
  nodes.forEach(nd => { if (nd.t==='r') n++; else n += treeCountRaces(nd.c||[]); });
  return n;
}

// Remove node at path; returns [removed, newNodes]
function treeRemoveAt(nodes, path) {
  if (path.length === 1) {
    const removed = nodes[path[0]];
    return [removed, nodes.filter((_,i) => i !== path[0])];
  }
  const fi = path[0];
  const folder = { ...nodes[fi], c: [...(nodes[fi].c||[])] };
  const [removed, newC] = treeRemoveAt(folder.c, path.slice(1));
  folder.c = newC;
  return [removed, nodes.map((nd,i) => i===fi ? folder : nd)];
}

// Insert node before index at path (path = [...parentIndices, insertBeforeIdx])
function treeInsertAt(nodes, path, node) {
  if (path.length === 1) {
    const idx = Math.min(path[0], nodes.length);
    return [...nodes.slice(0,idx), node, ...nodes.slice(idx)];
  }
  const fi = path[0];
  const folder = { ...nodes[fi], c: [...(nodes[fi].c||[])] };
  folder.c = treeInsertAt(folder.c, path.slice(1), node);
  return nodes.map((nd,i) => i===fi ? folder : nd);
}

// Append node as last child of folder at folderPath
function treeAppendToFolder(nodes, folderPath, node) {
  if (folderPath.length === 0) return [...nodes, node];
  const fi = folderPath[0];
  const folder = { ...nodes[fi], c: [...(nodes[fi].c||[])] };
  folder.c = folderPath.length===1
    ? [...folder.c, node]
    : treeAppendToFolder(folder.c, folderPath.slice(1), node);
  return nodes.map((nd,i) => i===fi ? folder : nd);
}

// Set open flag at folderPath
function treeSetOpen(nodes, folderPath, open) {
  const fi = folderPath[0];
  if (folderPath.length === 1) {
    return nodes.map((nd,i) => i===fi ? {...nd, open} : nd);
  }
  const folder = { ...nodes[fi], c: [...(nodes[fi].c||[])] };
  folder.c = treeSetOpen(folder.c, folderPath.slice(1), open);
  return nodes.map((nd,i) => i===fi ? folder : nd);
}

// Check whether targetPath is inside sourcePath
function pathIsDescendant(sourcePath, targetPath) {
  if (targetPath.length <= sourcePath.length) return false;
  return sourcePath.every((v,i) => targetPath[i] === v);
}

// ── Drag state ───────────────────────────────────────────────────────────────
let dragNode = null;        // the TreeNode being dragged
let dragPath = null;        // path[] it came from
let dragActive = false;

// ── Render ───────────────────────────────────────────────────────────────────
function renderSavedRacesList() {
  const list = document.getElementById('savedRacesList');
  const store = getStore();
  list.innerHTML = '';

  if (!Object.keys(store.races).length && !store.tree.length) {
    list.innerHTML = '<div class="no-races-msg">No saved races yet</div>';
    return;
  }

  // Safety: races that exist in store.races but not in tree → append at root
  const treeRaceNames = new Set();
  function collectNames(nodes) {
    nodes.forEach(nd => { if(nd.t==='r') treeRaceNames.add(nd.n); else collectNames(nd.c||[]); });
  }
  collectNames(store.tree);
  Object.keys(store.races).forEach(n => {
    if (!treeRaceNames.has(n)) store.tree = [...store.tree, { t:'r', n }];
  });

  renderFolderContents(list, store.tree, [], 0, store);
}

function makeDropZone(insertPath, intoFolderPath) {
  const dz = document.createElement('div');
  dz.className = 'race-dz';
  dz.dataset.path = JSON.stringify(intoFolderPath !== null ? intoFolderPath : insertPath);
  dz.dataset.mode = intoFolderPath !== null ? 'into' : 'before';

  dz.addEventListener('dragover', (e) => {
    if (!dragActive) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.race-dz.dz-over').forEach(el => el.classList.remove('dz-over'));
    dz.classList.add('dz-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('dz-over');
    if (!dragNode || !dragPath) return;
    const targetPath = JSON.parse(dz.dataset.path);
    const mode = dz.dataset.mode;
    performDrop(targetPath, mode);
  });
  return dz;
}

// ── Marker-based drop (avoids post-removal path adjustment entirely) ──────────

// A unique sentinel object placed in the tree to mark the drop destination.
const _DM = Object.freeze({ t: '__dm__' });

// Walk the tree replacing _DM with `node`.
function treeReplaceMarker(nodes, node) {
  return nodes.map(nd => {
    if (nd === _DM) return node;
    if (nd.c)        return { ...nd, c: treeReplaceMarker(nd.c, node) };
    return nd;
  });
}

/*
 * After inserting a node at `insertPath` (mode='before'), the drag node's
 * path may have shifted.  Only needs adjustment when the insertion and the
 * drag share the same parent up to insertPath's last level, and the insertion
 * index is ≤ the drag index at that level.
 */
function shiftPathForInsertion(insertPath, dp) {
  const adj = [...dp];
  const last = insertPath.length - 1;
  // Verify all ancestor levels match
  for (let i = 0; i < last; i++) {
    if (i >= dp.length || insertPath[i] !== dp[i]) return adj; // different branch
  }
  if (last >= dp.length) return adj; // dp is shallower than insert path
  if (insertPath[last] <= dp[last]) adj[last]++;
  return adj;
}

function performDrop(targetPath, mode) {
  if (!dragNode || !dragPath) return;
  // Guard: can't drop folder into itself or its descendants
  if (dragNode.t === 'f' && (
    JSON.stringify(dragPath) === JSON.stringify(targetPath) ||
    pathIsDescendant(dragPath, targetPath)
  )) return;

  const store = getStore();
  let tree = store.tree;

  // Step 1 — for 'into': open the target folder now, while targetPath is valid.
  if (mode === 'into') tree = treeSetOpen(tree, targetPath, true);

  // Step 2 — insert the marker at the destination.
  const markedTree = mode === 'into'
    ? treeAppendToFolder(tree, targetPath, _DM)   // appends _DM inside folder
    : treeInsertAt(tree, targetPath, _DM);         // inserts _DM before target

  // Step 3 — adjust dragPath to account for the marker insertion.
  // 'into' appends to the END of a folder so it never shifts existing paths.
  const adjDragPath = mode === 'before'
    ? shiftPathForInsertion(targetPath, dragPath)
    : [...dragPath];

  // Step 4 — remove the drag node from the marked tree.
  const [removedNode, treeWithoutDrag] = treeRemoveAt(markedTree, adjDragPath);

  // Step 5 — swap the marker for the removed node.
  store.tree = treeReplaceMarker(treeWithoutDrag, removedNode);
  setStore(store);
  renderSavedRacesList();
}

function makeRaceItem(name, nodePath, depth) {
  const item = document.createElement('div');
  item.className = 'saved-race-item' + (depth > 0 ? ' in-folder' : '');
  item.style.marginLeft = (depth * 12) + 'px';
  item.draggable = true;

  item.addEventListener('dragstart', (e) => {
    dragNode = { t:'r', n: name };
    dragPath = nodePath;
    dragActive = true;
    setTimeout(() => {
      item.classList.add('dragging');
      document.querySelectorAll('.race-dz').forEach(dz => dz.classList.add('dz-active'));
    }, 0);
    e.dataTransfer.effectAllowed = 'move';
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    dragNode = null; dragPath = null; dragActive = false;
    document.querySelectorAll('.race-dz').forEach(dz => dz.classList.remove('dz-active','dz-over'));
  });

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = 'Drag to reorder or move to folder';

  const label = document.createElement('span');
  label.className = 'saved-race-name';
  label.textContent = name;
  label.title = name;

  const isLoaded = name === currentRaceName;
  const loadBtn = document.createElement('button');
  loadBtn.className = 'race-item-load' + (isLoaded ? ' loaded' : '');
  loadBtn.textContent = isLoaded ? 'Unload' : 'Load';
  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (name === currentRaceName) {
      // Unload inline — don't close the panel
      finishRotEdit();
      raceTrackMarkers.forEach(marker => map.removeLayer(marker));
      raceTrackMarkers = [];
      removeAllArrows();
      map.off('zoom', _checkpointLabelSizesFn);
      _checkpointLabelSizesFn = null;
      currentRaceData = null;
      currentRaceName = null;
      document.getElementById('raceTrackInput').value = '';
      // Reset this button directly
      loadBtn.textContent = 'Load';
      loadBtn.classList.remove('loaded');
      updateRaceSidebarLoadedTag();
      renderCheckpointManager();
    } else {
      loadRaceByName(name);
    }
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'race-item-delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete race';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const store = getStore();
    delete store.races[name];
    const [, newTree] = treeRemoveAt(store.tree, nodePath);
    store.tree = newTree;
    setStore(store);
    renderSavedRacesList();
  });

  item.appendChild(handle);
  item.appendChild(label);
  item.appendChild(loadBtn);
  item.appendChild(delBtn);
  return item;
}

function makeFolderItem(node, nodePath, depth, store) {
  const wrapper = document.createElement('div');
  wrapper.className = 'race-folder-wrapper';

  // ── Header ──────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'race-folder-header';
  header.style.marginLeft = (depth * 12) + 'px';
  header.draggable = true;

  header.addEventListener('dragstart', (e) => {
    dragNode = node;
    dragPath = nodePath;
    dragActive = true;
    e.stopPropagation();
    setTimeout(() => {
      header.classList.add('dragging');
      document.querySelectorAll('.race-dz').forEach(dz => dz.classList.add('dz-active'));
    }, 0);
    e.dataTransfer.effectAllowed = 'move';
  });
  header.addEventListener('dragend', () => {
    header.classList.remove('dragging');
    dragNode = null; dragPath = null; dragActive = false;
    document.querySelectorAll('.race-dz').forEach(dz => dz.classList.remove('dz-active','dz-over'));
  });

  const arrow = document.createElement('span');
  arrow.className = 'race-folder-arrow' + (node.open ? ' open' : '');
  arrow.textContent = '▶';

  const dragHandleF = document.createElement('span');
  dragHandleF.className = 'drag-handle';
  dragHandleF.textContent = '⠿';
  dragHandleF.title = 'Drag to reorder or nest';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'race-folder-name';
  const raceCount = treeCountRaces(node.c||[]);
  nameSpan.textContent = `📁 ${node.n} (${raceCount})`;
  nameSpan.title = node.n;

  const delBtn = document.createElement('button');
  delBtn.className = 'race-folder-delete';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete folder (contents moved to parent)';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const store = getStore();
    const [removed, afterRemove] = treeRemoveAt(store.tree, nodePath);
    // Insert the children where the folder was
    let newTree = afterRemove;
    const insertBase = nodePath[nodePath.length - 1];
    const parentPath = nodePath.slice(0,-1);
    (removed.c || []).reverse().forEach((child, i) => {
      newTree = treeInsertAt(newTree, [...parentPath, insertBase], child);
    });
    store.tree = newTree;
    setStore(store);
    renderSavedRacesList();
  });

  header.appendChild(arrow);
  header.appendChild(dragHandleF);
  header.appendChild(nameSpan);
  header.appendChild(delBtn);

  // ── "Drop into this folder" zone on header ───────────────────────
  header.addEventListener('dragover', (e) => {
    if (!dragActive || !dragNode) return;
    // Don't allow a folder to be dropped into itself
    if (dragNode.t === 'f' && pathIsDescendant(dragPath, nodePath)) return;
    if (JSON.stringify(dragPath) === JSON.stringify(nodePath)) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.race-dz.dz-over').forEach(el => el.classList.remove('dz-over'));
    header.classList.add('dz-over');
  });
  header.addEventListener('dragleave', (e) => {
    if (!header.contains(e.relatedTarget)) header.classList.remove('dz-over');
  });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.remove('dz-over');
    if (!dragNode || JSON.stringify(dragPath) === JSON.stringify(nodePath)) return;
    performDrop(nodePath, 'into');
  });

  // ── Toggle open on click ─────────────────────────────────────────
  header.addEventListener('click', (e) => {
    if (e.target === delBtn || e.target === dragHandleF) return;
    const store = getStore();
    const newOpen = !node.open;
    store.tree = treeSetOpen(store.tree, nodePath, newOpen);
    setStore(store);
    node.open = newOpen; // mutate local copy so re-render is instant
    arrow.classList.toggle('open', newOpen);
    contents.classList.toggle('open', newOpen);
    // Render children now if opening and contents haven't been populated yet
    if (newOpen && contents.childElementCount === 0) {
      renderFolderContents(contents, node.c || [], nodePath, depth + 1, store);
    }
  });

  // ── Contents ─────────────────────────────────────────────────────
  const contents = document.createElement('div');
  contents.className = 'race-folder-contents' + (node.open ? ' open' : '');

  if (node.open) {
    renderFolderContents(contents, node.c || [], nodePath, depth + 1, store);
  }

  wrapper.appendChild(header);
  wrapper.appendChild(contents);
  return wrapper;
}

// Render folder children with correct child paths like nodePath + [childIdx]
function renderFolderContents(container, children, parentPath, depth, store) {
  // Drop zone before first child
  container.appendChild(makeDropZone([...parentPath, 0], null));

  children.forEach((child, idx) => {
    const childPath = [...parentPath, idx];
    if (child.t === 'r') {
      container.appendChild(makeRaceItem(child.n, childPath, depth));
    } else {
      container.appendChild(makeFolderItem(child, childPath, depth, store));
    }
    container.appendChild(makeDropZone([...parentPath, idx + 1], null));
  });

  if (children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-races-msg';
    empty.style.cssText = 'font-size:11px;margin-left:' + (depth*12) + 'px';
    empty.textContent = 'Empty folder';
    container.appendChild(empty);
  }
}

// ── Quaternion helpers ────────────────────────────────────────────────────────

/** Extract 2D game-space forward vector from a UE quaternion. */
function quat2DForward(q) {
  const x = q.x||0, y = q.y||0, z = q.z||0, w = (q.w !== undefined ? q.w : 1);
  return {
    gx: 1 - 2*(y*y + z*z),   // game X (forward in UE)
    gy: 2*(x*y + z*w)         // game Y (right in UE)
  };
}

/** Build a yaw-only UE quaternion (rotation around Z) from a 2D game-space direction. */
function heading2Quat(gx, gy) {
  const angle = Math.atan2(gy, gx);
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/**
 * Compute Leaflet LatLng arrays for a gate (perpendicular line) + small
 * center arrow.  clat/clng = checkpoint position, gx/gy = normalised
 * game-space forward direction.
 *
 * Returns:
 *   gate  – 2-point polyline perpendicular to forward, centred on checkpoint
 *   shaft – 2-point polyline from centre toward forward
 *   head  – 3-point triangle arrowhead at shaft tip
 */
function arrowGeometry(clat, clng, gx, gy) {
  const { gateHalf, shaftFront, shaftBack, headDepth, headHalf } = arrowMapUnits();
  const fLng = gx, fLat = -gy;
  const fLen = Math.sqrt(fLng*fLng + fLat*fLat) || 1;
  const nx = fLng/fLen, ny = fLat/fLen;
  const px = -ny, py = nx;

  const gateLat1 = clat + py * gateHalf,  gateLng1 = clng + px * gateHalf;
  const gateLat2 = clat - py * gateHalf,  gateLng2 = clng - px * gateHalf;

  const tailLat = clat - ny * shaftBack,  tailLng = clng - nx * shaftBack;
  const tipLat  = clat + ny * shaftFront, tipLng  = clng + nx * shaftFront;
  const baseLat = clat + ny * (shaftFront - headDepth);
  const baseLng = clng + nx * (shaftFront - headDepth);

  return {
    gate:      [[gateLat1, gateLng1], [gateLat2, gateLng2]],
    shaft:     [[tailLat, tailLng],   [tipLat,   tipLng]],
    headLeft:  [[tipLat, tipLng], [baseLat + px * headHalf, baseLng + py * headHalf]],
    headRight: [[tipLat, tipLng], [baseLat - px * headHalf, baseLng - py * headHalf]],
  };
}

function updateCheckpointArrow(arrow, clat, clng, gx, gy) {
  const { gate, shaft, headLeft, headRight } = arrowGeometry(clat, clng, gx, gy);
  arrow.gate.setLatLngs(gate);
  arrow.shaft.setLatLngs(shaft);
  arrow.headLeft.setLatLngs(headLeft);
  arrow.headRight.setLatLngs(headRight);
}

function removeAllArrows() {
  raceTrackArrows.forEach(a => {
    if (!a) return;
    if (a.gate)      map.removeLayer(a.gate);
    if (a.shaft)     map.removeLayer(a.shaft);
    if (a.headLeft)  map.removeLayer(a.headLeft);
    if (a.headRight) map.removeLayer(a.headRight);
  });
  raceTrackArrows = [];
}

// ── Global rotation-drag handlers (set up once) ───────────────────────────────
let rotEditOriginalRotation = null; // saved before drag starts, for "Revert" button

map.on('mousemove', function(e) {
  if (!rotEditActive || rotEditIdx === null || !currentRaceData) return;
  const waypoint = currentRaceData.waypoints[rotEditIdx];
  const marker   = raceTrackMarkers[rotEditIdx];
  if (!waypoint || !marker) return;

  const c    = marker.getLatLng();
  const dLng = e.latlng.lng - c.lng;
  const dLat = e.latlng.lat - c.lat;
  const len  = Math.sqrt(dLng*dLng + dLat*dLat) || 1;
  const gx = dLng/len, gy = -dLat/len;

  waypoint.rotation = heading2Quat(gx, gy);

  // Rotate the icon with arrow during drag
  marker.setIcon(makeCheckpointRotatingIcon(gx, gy));

  // Update tooltip to show current angle
  const tt = marker.getTooltip();
  if (tt && tt._container) {
    const lbl = tt._container.querySelector('div');
    if (lbl) lbl.textContent = Math.round(Math.atan2(gy, gx) * 180 / Math.PI) + '°';
  }

  // Live-sync the open CP manager row for this checkpoint
  syncCpManagerRow(rotEditIdx, gx, gy);
});

// (zoom during rotation edit needs no special handling — divIcon rotates via CSS)

function finishRotEdit() {
  clearTimeout(rotEditHoldTimer);
  rotEditHoldTimer = null;
  if (rotEditActive && rotEditIdx !== null) {
    const marker = raceTrackMarkers[rotEditIdx];
    if (marker) {
      const waypoint = currentRaceData && currentRaceData.waypoints[rotEditIdx];
      const { gx: fgx, gy: fgy } = waypoint ? quat2DForward(waypoint.rotation) : { gx: 1, gy: 0 };
      // If the CP manager row for this index is open, keep it gold
      const cpItem = document.querySelector(`#cpManagerBody .cp-item[data-idx="${rotEditIdx}"]`);
      const rowOpen = cpItem && cpItem.querySelector('.cp-item-editor.open');
      marker.setIcon(rowOpen
        ? makeCheckpointHighlightIcon(fgx, fgy)
        : makeCheckpointDivIcon(fgx, fgy));
      const tt = marker.getTooltip();
      if (tt && tt._container) {
        const lbl = tt._container.querySelector('div');
        if (lbl) lbl.textContent = String(rotEditIdx + 1);
      }
    }
    map.dragging.enable();
    map.getContainer().style.cursor = '';
    if (currentRaceData) {
      document.getElementById('raceTrackInput').value = formatRaceJSON(currentRaceData);
    }
  }
  rotEditActive = false;
  rotEditIdx    = null;
}

map.on('mouseup', finishRotEdit);
document.addEventListener('mouseup', finishRotEdit);

/**
 * Push a live gx/gy direction into the open CP manager row for `idx`.
 * Updates the yaw number input, slider, and shows the Revert button.
 */
function syncCpManagerRow(idx, gx, gy) {
  const item = document.querySelector(`#cpManagerBody .cp-item[data-idx="${idx}"]`);
  if (!item) return;
  const editor = item.querySelector('.cp-item-editor');
  if (!editor || !editor.classList.contains('open')) return;

  const deg = Math.round(Math.atan2(gy, gx) * 180 / Math.PI);
  const yawInput  = editor.querySelector('[data-field="yaw"]');
  const yawSlider = editor.querySelector('[data-field="yaw-slider"]');
  if (yawInput)  yawInput.value  = deg;
  if (yawSlider) yawSlider.value = Math.max(-180, Math.min(180, deg));

  // Show the Revert button while a drag is active
  const revertBtn = editor.querySelector('.cp-revert-btn');
  if (revertBtn) revertBtn.style.display = '';
}

// ── Replace-section helper ────────────────────────────────────────────────────
function updateReplaceSection() {
  // Update the load/unload button state for every visible race item
  document.querySelectorAll('#savedRacesList .saved-race-item').forEach(item => {
    const btn = item.querySelector('.race-item-load');
    if (!btn) return;
    const raceName = item.querySelector('.saved-race-name')?.textContent;
    if (!raceName) return;
    const loaded = raceName === currentRaceName;
    btn.textContent = loaded ? 'Unload' : 'Load';
    btn.classList.toggle('loaded', loaded);
  });
  if (typeof updateRaceSidebarLoadedTag === 'function') updateRaceSidebarLoadedTag();
}

// ── JSON display formatter (blank line after every line) ────────────────────
function formatRaceJSON(data) {
  return JSON.stringify(data, null, '\t').split('\n').join('\n\n');
}

// ── Load ────────────────────────────────────────────────────────────────────
function loadRaceFromJSON(jsonText) {
  try {
    const raceData = JSON.parse(jsonText);
    if (!raceData.routeName || !raceData.waypoints || !Array.isArray(raceData.waypoints)) {
      throw new Error('Invalid race track format.');
    }

    // Clear previous race visuals
    raceTrackMarkers.forEach(marker => map.removeLayer(marker));
    raceTrackMarkers = [];
    removeAllArrows();
    map.off('zoom', _checkpointLabelSizesFn);
  _checkpointLabelSizesFn = null;

    // Ensure every waypoint has a rotation quaternion (default: identity = face +X)
    raceData.waypoints.forEach(wp => {
      if (!wp.rotation) wp.rotation = { x: 0, y: 0, z: 0, w: 1 };
    });

    currentRaceData = raceData;

    raceData.waypoints.forEach((waypoint, index) => {
      const pos = worldToMap(waypoint.translation.x, waypoint.translation.y);
      const clat = pos.mapY, clng = pos.mapX;

      // No arrow at load time — slot starts null, created on-demand during rotation drag
      raceTrackArrows.push(null);

      // ── Checkpoint icon marker ────────────────────────────────────────────
      const { gx: igx, gy: igy } = quat2DForward(waypoint.rotation);
      const checkpointMarker = L.marker([clat, clng], {
        icon: makeCheckpointDivIcon(igx, igy),
        riseOnHover: false
      }).addTo(map);

      checkpointMarker.bindTooltip(
        `<div style="background:rgba(128,128,128,0.85)!important;color:white;border-radius:3px;padding:1px 3px;font-weight:bold;font-size:10px;text-align:center;white-space:nowrap;">${index + 1}</div>`,
        { permanent: true, direction: 'center', offset: [0, -10], className: 'checkpoint-label' }
      );

      setTimeout(() => {
        const tt = checkpointMarker.getTooltip();
        if (tt && tt._container) {
          tt._container.style.background  = 'transparent';
          tt._container.style.border      = 'none';
          tt._container.style.boxShadow   = 'none';
          tt._container.style.padding     = '0';
        }
      }, 0);

      // ── Rotation editing: click + hold on checkpoint ───────────────────────
      checkpointMarker.on('mousedown', function(e) {
        if (e.originalEvent.button !== 0) return;
        L.DomEvent.stop(e);
        const idx = index;
        clearTimeout(rotEditHoldTimer);
        rotEditHoldTimer = setTimeout(() => {
          rotEditActive = true;
          rotEditIdx    = idx;
          map.dragging.disable();
          map.getContainer().style.cursor = 'crosshair';

          // Save original rotation so Revert button can restore it
          rotEditOriginalRotation = { ...waypoint.rotation };

          // Show Revert button in the open CP manager row if present
          const cpItem = document.querySelector(`#cpManagerBody .cp-item[data-idx="${idx}"]`);
          if (cpItem) {
            const revertBtn = cpItem.querySelector('.cp-revert-btn');
            if (revertBtn) revertBtn.style.display = '';
          }

          // Show degrees in the tooltip while editing
          const tt = checkpointMarker.getTooltip();
          if (tt && tt._container) {
            const { gx, gy } = quat2DForward(waypoint.rotation);
            const angleDeg = Math.round(Math.atan2(gy, gx) * 180 / Math.PI);
            const lbl = tt._container.querySelector('div');
            if (lbl) lbl.textContent = angleDeg + '°';
          }
        }, 200);
      });

      checkpointMarker.on('mouseup', () => {
        clearTimeout(rotEditHoldTimer);
        rotEditHoldTimer = null;
      });

      raceTrackMarkers.push(checkpointMarker);
    });

    function updateCheckpointLabelSizes() {
      const zoomLevel = map.getZoom();
      const scaleFactor = Math.max(0.6, 1 - (2 - zoomLevel) * 0.1);
      const fontSize = Math.max(7, 10 * scaleFactor);
      raceTrackMarkers.forEach(marker => {
        const tooltip = marker.getTooltip();
        if (tooltip && tooltip._container) {
          const labelDiv = tooltip._container.querySelector('div');
          if (labelDiv) labelDiv.style.fontSize = fontSize + 'px';
        }
      });
    }

    updateCheckpointLabelSizes();
    if (_checkpointLabelSizesFn) map.off('zoom', _checkpointLabelSizesFn);
    _checkpointLabelSizesFn = updateCheckpointLabelSizes;
    map.on('zoom', _checkpointLabelSizesFn);

    document.getElementById('raceTrackInput').value = formatRaceJSON(JSON.parse(jsonText));
    return true;
  } catch (e) {
    console.error('Race load error:', e.message);
    return false;
  }
}

function loadRaceByName(name) {
  const store = getStore();
  if (!store.races[name]) return;
  loadRaceFromJSON(store.races[name]);
  currentRaceName = name;
  updateReplaceSection();
  if (document.getElementById('checkpoint-manager').classList.contains('open')) {
    setTimeout(renderCheckpointManager, 50);
  }
}

// ── Save ────────────────────────────────────────────────────────────────────
function getSavedRaces() { return getStore().races; } // kept for compat

function setSavedRaces(races) {
  const store = getStore();
  store.races = races;
  setStore(store);
}

// ── Toggle menu (legacy handler kept minimal — real toggle is in sidebar JS below) ──

// ── Save race button ─────────────────────────────────────────────────────────
let pendingSaveName = null;
let pendingSaveJson = null;

function doSaveRace(name, jsonText) {
  const store = getStore();
  store.races[name] = jsonText;
  // Only add to tree if not already present somewhere
  const treeNames = new Set();
  function collect(nodes) { nodes.forEach(nd => nd.t==='r' ? treeNames.add(nd.n) : collect(nd.c||[])); }
  collect(store.tree);
  if (!treeNames.has(name)) store.tree = [...store.tree, { t:'r', n: name }];
  setStore(store);
  renderSavedRacesList();
  const btn = document.getElementById('raceSaveBtn');
  btn.textContent = '✓';
  btn.style.background = '#00ff00';
  setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1500);
}

document.getElementById('raceSaveBtn').addEventListener('click', () => {
  const nameInput = document.getElementById('raceSaveName');
  // Use the live race data if available (captures any rotation edits)
  const jsonText = currentRaceData
    ? JSON.stringify(currentRaceData)
    : document.getElementById('raceTrackInput').value.trim();

  if (!jsonText) {
    const btn = document.getElementById('raceSaveBtn');
    btn.textContent = 'No race!';
    btn.style.background = '#ff4444';
    setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1800);
    return;
  }

  let name;
  try {
    const parsed = JSON.parse(jsonText);
    name = nameInput.value.trim() || parsed.routeName || 'Unnamed Race';
  } catch(e) {
    const btn = document.getElementById('raceSaveBtn');
    btn.textContent = 'Invalid!';
    btn.style.background = '#ff4444';
    setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1800);
    return;
  }

  // Skip confirmation if user opted out
  if (localStorage.getItem('skipSaveRaceConfirm') === '1') {
    doSaveRace(name, jsonText);
    nameInput.value = '';
    return;
  }

  // Show confirmation modal
  pendingSaveName = name;
  pendingSaveJson = jsonText;
  document.getElementById('confirmSaveNameDisplay').textContent = name;
  document.getElementById('neverShowSaveConfirm').checked = false;
  document.getElementById('saveConfirmModal').classList.add('active');
});

document.getElementById('confirmSaveYesBtn').addEventListener('click', () => {
  if (document.getElementById('neverShowSaveConfirm').checked) {
    localStorage.setItem('skipSaveRaceConfirm', '1');
  }
  document.getElementById('saveConfirmModal').classList.remove('active');
  if (pendingSaveName && pendingSaveJson) {
    doSaveRace(pendingSaveName, pendingSaveJson);
    document.getElementById('raceSaveName').value = '';
  }
  pendingSaveName = null;
  pendingSaveJson = null;
});

document.getElementById('confirmSaveNoBtn').addEventListener('click', () => {
  document.getElementById('saveConfirmModal').classList.remove('active');
  pendingSaveName = null;
  pendingSaveJson = null;
});

// ── Replace loaded race with current (rotation-edited) version ───────────────
document.getElementById('replaceRaceBtn').addEventListener('click', () => {
  if (!currentRaceName || !currentRaceData) return;
  const store = getStore();
  store.races[currentRaceName] = JSON.stringify(currentRaceData);
  setStore(store);
  renderSavedRacesList();
  const btn = document.getElementById('replaceRaceBtn');
  btn.textContent = '✓ Updated';
  btn.style.background = '#00b800';
  setTimeout(() => { btn.textContent = '↺ Update'; btn.style.background = ''; }, 1500);
});

// ── New folder ───────────────────────────────────────────────────────────────
document.getElementById('raceNewFolderBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const row = document.getElementById('newFolderRow');
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : 'flex';
  if (!visible) document.getElementById('folderNameInput').focus();
});

document.getElementById('folderCreateBtn').addEventListener('click', () => {
  const input = document.getElementById('folderNameInput');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const store = getStore();
  store.tree = [...store.tree, { t:'f', n: name, open: true, c: [] }];
  setStore(store);
  input.value = '';
  document.getElementById('newFolderRow').style.display = 'none';
  renderSavedRacesList();
});

document.getElementById('folderNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('folderCreateBtn').click();
  if (e.key === 'Escape') {
    document.getElementById('newFolderRow').style.display = 'none';
    document.getElementById('folderNameInput').value = '';
  }
});

// ── Unload ───────────────────────────────────────────────────────────────────
document.getElementById('raceUnloadBtn').addEventListener('click', () => {
  // Legacy stub — unload is now handled inline in each race item's load button
});

// ═══════════════════════════════════════════════════════════════════════════════
// LEFT ICON SIDEBAR — toggle logic
// ═══════════════════════════════════════════════════════════════════════════════

function closeAllPanels() {
  document.getElementById('playerListSidebar').classList.remove('open');
  document.getElementById('chatSidebar').classList.remove('open');
  document.getElementById('raceMenuPanel').classList.remove('open');
  document.getElementById('raceMenuBtn').classList.remove('open');
  document.getElementById('checkpoint-manager').classList.remove('open');
  document.getElementById('sidebarPlayersBtn').classList.remove('active');
  document.getElementById('sidebarRacesMgrBtn').classList.remove('active');
  document.body.classList.remove('players-panel-open', 'races-panel-open');
  // Also close heatmap panel
  document.getElementById('heatmapPanel').classList.remove('open');
  document.getElementById('sidebarHeatmapBtn').classList.remove('active');
  setHeatmapMode(null);
}

// Settings — opens the modal only
document.getElementById('sidebarSettingsBtn').addEventListener('click', () => {
  document.getElementById('settingsBtn').click();
});

// Players & Chat — left: player list, right: chat
document.getElementById('sidebarPlayersBtn').addEventListener('click', () => {
  const isOpen = document.getElementById('playerListSidebar').classList.contains('open');
  closeAllPanels();
  if (!isOpen) {
    document.getElementById('playerListSidebar').classList.add('open');
    document.getElementById('chatSidebar').classList.add('open');
    document.getElementById('sidebarPlayersBtn').classList.add('active');
    document.body.classList.add('players-panel-open');
  }
});

// Races & Checkpoints — left: checkpoint manager, right: races panel
document.getElementById('sidebarRacesMgrBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = document.getElementById('raceMenuPanel').classList.contains('open');
  closeAllPanels();
  if (!isOpen) {
    renderSavedRacesList();
    renderCheckpointManager();
    document.getElementById('raceMenuPanel').classList.add('open');
    document.getElementById('raceMenuBtn').classList.add('open');
    document.getElementById('checkpoint-manager').classList.add('open');
    document.getElementById('sidebarRacesMgrBtn').classList.add('active');
    document.body.classList.add('races-panel-open');
    updateRaceSidebarLoadedTag();
  }
});

// closeRaceMenu — legacy callers (unload, etc.) close both race panels
function closeRaceMenu() {
  document.getElementById('raceMenuPanel').classList.remove('open');
  document.getElementById('raceMenuBtn').classList.remove('open');
  document.getElementById('checkpoint-manager').classList.remove('open');
  document.getElementById('sidebarRacesMgrBtn').classList.remove('active');
  document.body.classList.remove('races-panel-open');
}

function updateRaceSidebarLoadedTag() {
  const tag = document.getElementById('raceSidebarLoadedTag');
  if (tag) tag.textContent = currentRaceName || '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKPOINT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

/** Convert a UE yaw quaternion to a simple degrees value. */
function quatToYawDeg(q) {
  const { gx, gy } = quat2DForward(q || { x:0, y:0, z:0, w:1 });
  return Math.round(Math.atan2(gy, gx) * 180 / Math.PI);
}

/** Convert yaw-degrees back to a UE quaternion (rotation around Z). */
function yawDegToQuat(deg) {
  const angle = deg * Math.PI / 180;
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

/** Render the full checkpoint manager list. */
function renderCheckpointManager() {
  const body  = document.getElementById('cpManagerBody');
  const badge = document.getElementById('cpCountBadge');
  if (!body || !badge) return;

  if (!currentRaceData || !currentRaceData.waypoints || currentRaceData.waypoints.length === 0) {
    body.innerHTML = '<div class="cp-no-race">No race loaded</div>';
    badge.textContent = '0';
    return;
  }

  const wps = currentRaceData.waypoints;
  badge.textContent = wps.length;
  body.innerHTML = '';

  wps.forEach((wp, idx) => {
    const t = wp.translation || { x: 0, y: 0, z: 0 };
    const yaw = quatToYawDeg(wp.rotation);

    const item = document.createElement('div');
    item.className = 'cp-item';
    item.dataset.idx = idx;

    const s = wp.scale3D || { x: 1, y: 14, z: 10 };

    // ── Header row (click to expand) ──────────────────────────────
    const header = document.createElement('div');
    header.className = 'cp-item-header';
    header.innerHTML = `
      <span class="cp-item-num">${idx + 1}</span>
      <span class="cp-item-coords">X:${Math.round(t.x)} Y:${Math.round(t.y)} Z:${Math.round(t.z)}</span>
      <span class="cp-item-arrow">▶</span>
    `;

    // ── Editor section ────────────────────────────────────────────
    const editor = document.createElement('div');
    editor.className = 'cp-item-editor';
    editor.innerHTML = `
      <div class="cp-editor-section">Translation (Game Coords)</div>
      <div class="cp-editor-row">
        <span class="cp-editor-label">X</span>
        <input class="cp-editor-input" data-field="tx" type="number" value="${t.x.toFixed(2)}" step="10" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="10" data-target="tx">▲</button><button class="cp-stepper-btn" data-step="-10" data-target="tx">▼</button></div>
      </div>
      <div class="cp-editor-row">
        <span class="cp-editor-label">Y</span>
        <input class="cp-editor-input" data-field="ty" type="number" value="${t.y.toFixed(2)}" step="10" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="10" data-target="ty">▲</button><button class="cp-stepper-btn" data-step="-10" data-target="ty">▼</button></div>
      </div>
      <div class="cp-editor-row">
        <span class="cp-editor-label">Z</span>
        <input class="cp-editor-input" data-field="tz" type="number" value="${t.z.toFixed(2)}" step="10" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="10" data-target="tz">▲</button><button class="cp-stepper-btn" data-step="-10" data-target="tz">▼</button></div>
      </div>
      <div class="cp-editor-section" style="margin-top:10px;">Rotation</div>
      <div class="cp-editor-row">
        <span class="cp-editor-label" title="Yaw in degrees">°</span>
        <input class="cp-editor-input" data-field="yaw" type="number" value="${yaw}" step="1" placeholder="Yaw" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="1" data-target="yaw">▲</button><button class="cp-stepper-btn" data-step="-1" data-target="yaw">▼</button></div>
      </div>
      <input class="cp-yaw-slider" data-field="yaw-slider" type="range" min="-180" max="180" value="${yaw}" step="1" />
      <div class="cp-editor-section" style="margin-top:10px;">Size</div>
      <div class="cp-editor-row">
        <span class="cp-editor-label" title="Width (scale3D.y)">W</span>
        <input class="cp-editor-input" data-field="scale-y-num" type="number" value="${s.y.toFixed(2)}" step="0.5" min="1" max="100" style="width:60px;" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="0.5" data-target="scale-y-num">▲</button><button class="cp-stepper-btn" data-step="-0.5" data-target="scale-y-num">▼</button></div>
        <input class="cp-size-slider" data-field="scale-y-slider" type="range" min="1" max="100" step="0.5" value="${s.y.toFixed(2)}" style="flex:1;margin-left:8px;" />
      </div>
      <div class="cp-editor-row">
        <span class="cp-editor-label" title="Height (scale3D.z)">H</span>
        <input class="cp-editor-input" data-field="scale-z-num" type="number" value="${s.z.toFixed(2)}" step="0.5" min="1" max="100" style="width:60px;" />
        <div class="cp-stepper"><button class="cp-stepper-btn" data-step="0.5" data-target="scale-z-num">▲</button><button class="cp-stepper-btn" data-step="-0.5" data-target="scale-z-num">▼</button></div>
        <input class="cp-size-slider" data-field="scale-z-slider" type="range" min="1" max="100" step="0.5" value="${s.z.toFixed(2)}" style="flex:1;margin-left:8px;" />
      </div>
      <div class="cp-btn-row">
        <button class="cp-revert-btn" style="display:none">↩ Revert</button>
        <button class="cp-apply-btn" data-idx="${idx}">Apply Changes</button>
      </div>
    `;

    // ── Snapshot taken when the editor opens, used by Revert ─────
    let originalState = null; // { translation: {...}, rotation: {...}, scale3D: {...} }

    // ── Helper: move marker live from current input values ────────
    function applyTranslationLive() {
      const nx = parseFloat(editor.querySelector('[data-field="tx"]').value);
      const ny = parseFloat(editor.querySelector('[data-field="ty"]').value);
      const nz = parseFloat(editor.querySelector('[data-field="tz"]').value);
      if ([nx, ny, nz].some(isNaN) || !currentRaceData || !currentRaceData.waypoints[idx]) return;
      currentRaceData.waypoints[idx].translation = { x: nx, y: ny, z: nz };
      const marker = raceTrackMarkers[idx];
      if (marker) {
        const pos = worldToMap(nx, ny);
        marker.setLatLng([pos.mapY, pos.mapX]);
      }
      revertBtn.style.display = '';
    }

    // ── Helper: apply yaw live to map marker ──────────────────────
    function applyYawLive(deg) {
      const q = yawDegToQuat(deg);
      if (!currentRaceData || !currentRaceData.waypoints[idx]) return;
      currentRaceData.waypoints[idx].rotation = q;
      const marker = raceTrackMarkers[idx];
      if (marker) {
        const { gx, gy } = quat2DForward(q);
        marker.setIcon(makeCheckpointHighlightIcon(gx, gy));
      }
      revertBtn.style.display = '';
    }

    // ── Helper: apply scale3D live ────────────────────────────────
    function applySizeLive() {
      const ny = parseFloat(editor.querySelector('[data-field="scale-y-num"]').value);
      const nz = parseFloat(editor.querySelector('[data-field="scale-z-num"]').value);
      if ([ny, nz].some(isNaN) || !currentRaceData || !currentRaceData.waypoints[idx]) return;
      currentRaceData.waypoints[idx].scale3D = {
        x: currentRaceData.waypoints[idx].scale3D?.x ?? 1,
        y: ny,
        z: nz
      };
      revertBtn.style.display = '';
    }

    // ── Revert button — restores to state when editor was opened ──
    const revertBtn = editor.querySelector('.cp-revert-btn');
    revertBtn.addEventListener('click', () => {
      if (!originalState || !currentRaceData || !currentRaceData.waypoints[idx]) return;
      const { translation: ot, rotation: oq, scale3D: os } = originalState;

      // Restore translation
      currentRaceData.waypoints[idx].translation = { ...ot };
      editor.querySelector('[data-field="tx"]').value = ot.x.toFixed(2);
      editor.querySelector('[data-field="ty"]').value = ot.y.toFixed(2);
      editor.querySelector('[data-field="tz"]').value = ot.z.toFixed(2);
      const marker = raceTrackMarkers[idx];
      if (marker) {
        const pos = worldToMap(ot.x, ot.y);
        marker.setLatLng([pos.mapY, pos.mapX]);
      }

      // Restore rotation
      currentRaceData.waypoints[idx].rotation = { ...oq };
      const { gx: rgx, gy: rgy } = quat2DForward(oq);
      const origDeg = Math.round(Math.atan2(rgy, rgx) * 180 / Math.PI);
      yawInput.value  = origDeg;
      yawSlider.value = Math.max(-180, Math.min(180, origDeg));
      if (marker) marker.setIcon(makeCheckpointHighlightIcon(rgx, rgy));

      // Restore scale3D
      currentRaceData.waypoints[idx].scale3D = { ...os };
      editor.querySelector('[data-field="scale-y-num"]').value   = os.y.toFixed(2);
      editor.querySelector('[data-field="scale-y-slider"]').value = os.y.toFixed(2);
      editor.querySelector('[data-field="scale-z-num"]').value   = os.z.toFixed(2);
      editor.querySelector('[data-field="scale-z-slider"]').value = os.z.toFixed(2);

      revertBtn.style.display = 'none';
      rotEditOriginalRotation = null;
    });

    // ── Coord inputs → live marker move ──────────────────────────
    ['tx','ty','tz'].forEach(field => {
      editor.querySelector(`[data-field="${field}"]`).addEventListener('input', applyTranslationLive);
    });

    // ── Sync: number input ↔ slider, live map update ──────────────
    const yawInput  = editor.querySelector('[data-field="yaw"]');
    const yawSlider = editor.querySelector('[data-field="yaw-slider"]');

    yawInput.addEventListener('input', () => {
      const deg = parseFloat(yawInput.value);
      if (isNaN(deg)) return;
      yawSlider.value = Math.max(-180, Math.min(180, deg));
      applyYawLive(deg);
    });

    yawSlider.addEventListener('input', () => {
      const deg = parseInt(yawSlider.value, 10);
      yawInput.value = deg;
      applyYawLive(deg);
    });

    // ── Size sliders ↔ number inputs, live data update ────────────
    const scaleYNum    = editor.querySelector('[data-field="scale-y-num"]');
    const scaleYSlider = editor.querySelector('[data-field="scale-y-slider"]');
    const scaleZNum    = editor.querySelector('[data-field="scale-z-num"]');
    const scaleZSlider = editor.querySelector('[data-field="scale-z-slider"]');

    scaleYNum.addEventListener('input', () => { scaleYSlider.value = scaleYNum.value; applySizeLive(); });
    scaleYSlider.addEventListener('input', () => { scaleYNum.value = scaleYSlider.value; applySizeLive(); });
    scaleZNum.addEventListener('input', () => { scaleZSlider.value = scaleZNum.value; applySizeLive(); });
    scaleZSlider.addEventListener('input', () => { scaleZNum.value = scaleZSlider.value; applySizeLive(); });

    // ── Custom stepper buttons ────────────────────────────────────
    editor.querySelectorAll('.cp-stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const step   = parseFloat(btn.dataset.step);
        const input  = editor.querySelector(`[data-field="${target}"]`);
        if (!input) return;
        const val = (parseFloat(input.value) || 0) + step;
        input.value = val;
        input.dispatchEvent(new Event('input'));
      });
    });

    // ── Mouse wheel on map marker when this CP is open ────────────
    let wheelHandler = null;
    function attachWheelHandler() {
      const marker = raceTrackMarkers[idx];
      if (!marker) return;
      wheelHandler = function(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        let deg = parseInt(yawInput.value, 10) || 0;
        deg = ((deg + delta + 180 + 360) % 360) - 180;
        yawInput.value = deg;
        yawSlider.value = deg;
        applyYawLive(deg);
      };
      marker.getElement() && marker.getElement().addEventListener('wheel', wheelHandler, { passive: false });
    }
    function detachWheelHandler() {
      const marker = raceTrackMarkers[idx];
      if (marker && marker.getElement() && wheelHandler) {
        marker.getElement().removeEventListener('wheel', wheelHandler);
      }
      wheelHandler = null;
    }

    // ── Toggle expand/collapse ────────────────────────────────────
    header.addEventListener('click', () => {
      const isOpen = editor.classList.contains('open');
      editor.classList.toggle('open', !isOpen);
      header.querySelector('.cp-item-arrow').classList.toggle('open', !isOpen);
      item.classList.toggle('editing', !isOpen);
      if (!isOpen) {
        // Snapshot the current state so Revert can restore it
        const wp = currentRaceData && currentRaceData.waypoints[idx];
        if (wp) {
          originalState = {
            translation: { ...wp.translation },
            rotation:    { ...wp.rotation },
            scale3D:     { ...(wp.scale3D || { x: 1, y: 14, z: 10 }) }
          };
          // Highlight this checkpoint gold on the map
          const { gx: hgx, gy: hgy } = quat2DForward(wp.rotation);
          const marker = raceTrackMarkers[idx];
          if (marker) marker.setIcon(makeCheckpointHighlightIcon(hgx, hgy));
        }
        const marker = raceTrackMarkers[idx];
        if (marker) map.panTo(marker.getLatLng());
        attachWheelHandler();
      } else {
        // Restore normal icon
        const wp = currentRaceData && currentRaceData.waypoints[idx];
        const marker = raceTrackMarkers[idx];
        if (marker && wp) {
          const { gx: ngx, gy: ngy } = quat2DForward(wp.rotation);
          marker.setIcon(makeCheckpointDivIcon(ngx, ngy));
        }
        originalState = null;
        revertBtn.style.display = 'none';
        detachWheelHandler();
      }
    });

    // ── Apply button ──────────────────────────────────────────────
    editor.querySelector('.cp-apply-btn').addEventListener('click', (e) => {
      const applyBtn = e.target;
      const wpIdx = parseInt(applyBtn.dataset.idx, 10);
      if (isNaN(wpIdx) || !currentRaceData) return;

      const waypoint = currentRaceData.waypoints[wpIdx];
      if (!waypoint) return;

      try {
        const newTx    = parseFloat(editor.querySelector('[data-field="tx"]').value);
        const newTy    = parseFloat(editor.querySelector('[data-field="ty"]').value);
        const newTz    = parseFloat(editor.querySelector('[data-field="tz"]').value);
        const newYaw   = parseFloat(editor.querySelector('[data-field="yaw"]').value);
        const newScaleY = parseFloat(editor.querySelector('[data-field="scale-y-num"]').value);
        const newScaleZ = parseFloat(editor.querySelector('[data-field="scale-z-num"]').value);

        if ([newTx, newTy, newTz, newYaw, newScaleY, newScaleZ].some(isNaN)) throw new Error('Invalid number');

        const newQ = yawDegToQuat(newYaw);
        waypoint.translation = { x: newTx, y: newTy, z: newTz };
        waypoint.rotation    = newQ;
        waypoint.scale3D     = { x: waypoint.scale3D?.x ?? 1, y: newScaleY, z: newScaleZ };

        const marker = raceTrackMarkers[wpIdx];
        if (marker) {
          const newPos = worldToMap(newTx, newTy);
          marker.setLatLng([newPos.mapY, newPos.mapX]);
          const { gx: agx, gy: agy } = quat2DForward(newQ);
          marker.setIcon(makeCheckpointDivIcon(agx, agy));
        }

        header.querySelector('.cp-item-coords').textContent =
          `X:${Math.round(newTx)} Y:${Math.round(newTy)} Z:${Math.round(newTz)}`;

        document.getElementById('raceTrackInput').value = formatRaceJSON(currentRaceData);
        updateReplaceSection();

        applyBtn.textContent = '✓ Applied';
        applyBtn.classList.add('success');
        setTimeout(() => { applyBtn.textContent = 'Apply Changes'; applyBtn.classList.remove('success'); }, 1500);
      } catch (err) {
        applyBtn.textContent = '✗ Error';
        applyBtn.classList.add('error');
        setTimeout(() => { applyBtn.textContent = 'Apply Changes'; applyBtn.classList.remove('error'); }, 1500);
      }
    });

    item.appendChild(header);
    item.appendChild(editor);
    body.appendChild(item);
  });
}

// Refresh checkpoint manager whenever a race is loaded
const _origLoadRaceFromJSON = loadRaceFromJSON;
// Patch: re-render CP manager after loading
function loadRaceFromJSONAndRefreshCP(jsonText) {
  const result = loadRaceFromJSON(jsonText);
  if (result && document.getElementById('checkpoint-manager').classList.contains('open')) {
    setTimeout(renderCheckpointManager, 50);
  }
  return result;
}
