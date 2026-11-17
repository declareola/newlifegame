// client/src/ui/MapSystem.js
// Persistent minimap + full-screen world map.
//
// Both views are drawn from the same data and the same world→screen transform,
// so the small map and the big map can never disagree. Everything is world
// coordinates: a marker at (x, z) in cityData draws at exactly that point, and
// the navigation system routes to that same point.
//
// Features
//   · persistent, high-contrast player arrow that shows facing
//   · fixed-north or rotating (heading-up) modes
//   · zoom with the wheel / pinch buttons, pan on the full map
//   · roads, districts, buildings and every POI kind
//   · active route drawn as a polyline with a destination pin
//   · district + location label, and distance to the destination
//   · clicking the minimap opens the full map; clicking a marker selects it

import { districts, roadLines, buildings, WORLD_BOUNDS } from '../world/cityData.js';
import { POI_KINDS } from '../world/poi.js';
import { icon } from './icons.js';

// The map screen is sized from Eko Basin's own extent, not a 200 m square that
// no longer exists: at 200 the whole city drew four times too large and every
// marker sat outside the frame.
const WORLD_W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
const WORLD_D = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
/** One scale for both axes, so nothing is stretched. */
const WORLD = Math.max(WORLD_W, WORLD_D);

export class MapSystem {
  /**
   * @param {object} o
   * @param {function} o.getPlayer        - () => { x, z, rot }
   * @param {Array}    o.pois             - POI list from world/poi.js
   * @param {function} o.onSelectPOI      - (poi) => void — user chose a destination
   * @param {function} o.onClearRoute     - () => void
   * @param {function} o.onToggleNav      - () => void (optional)
   */
  constructor({ getPlayer, pois = [], onSelectPOI, onClearRoute, onToggleNav } = {}) {
    this.getPlayer = getPlayer || (() => ({ x: 0, z: 0, rot: 0 }));
    this.pois = pois;
    this.onSelectPOI = onSelectPOI || (() => {});
    this.onClearRoute = onClearRoute || (() => {});
    this.onToggleNav = onToggleNav || (() => {});

    this.mode = 'north';        // 'north' | 'heading'
    this.zoom = 1;              // minimap zoom (1 = whole city)
    this.selected = null;       // POI currently chosen
    this.route = null;          // [{x,z}] world space
    this.destination = null;    // { name, x, z, kind }
    this.districtName = '';
    this.pulse = 0;

    this.miniSize = 190;
    this._buildMiniMap();
    this._buildFullMap();
    this._bindKeys();

    this._loop();
  }

  setPOIs(pois) {
    this.pois = pois || [];
    if (this.fullOpen) this._renderFull();
  }

  setRoute(route, destination) {
    this.route = route;
    this.destination = destination;
    if (this.fullOpen) this._renderFull();
  }

  clearRoute() {
    this.route = null;
    this.destination = null;
    this.selected = null;
    if (this.fullOpen) this._renderFull();
  }

  // ── Minimap DOM ───────────────────────────────────────────

  _buildMiniMap() {
    const wrap = document.createElement('div');
    wrap.className = 'minimap-wrap hidden';

    wrap.innerHTML = `
      <canvas class="minimap-canvas"></canvas>
      <div class="minimap-ring" aria-hidden="true"></div>
      <div class="minimap-overlay">
        <div class="minimap-district">—</div>
        <div class="minimap-dest hidden">
          <span class="minimap-dest-name"></span>
          <span class="minimap-dest-dist"></span>
        </div>
      </div>
      <div class="minimap-tools">
        <button class="minimap-tool" data-tool="zoom-in" title="Zoom in">+</button>
        <button class="minimap-tool" data-tool="zoom-out" title="Zoom out">−</button>
        <button class="minimap-tool" data-tool="mode" title="Rotate map">${icon('camera', 13)}</button>
        <button class="minimap-tool" data-tool="open" title="Open map (M)">${icon('door', 13)}</button>
      </div>
      <div class="minimap-north" title="North">N</div>
    `;
    document.body.appendChild(wrap);
    this.wrap = wrap;

    this.canvas = wrap.querySelector('.minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.districtEl = wrap.querySelector('.minimap-district');
    this.destEl = wrap.querySelector('.minimap-dest');
    this.destNameEl = wrap.querySelector('.minimap-dest-name');
    this.destDistEl = wrap.querySelector('.minimap-dest-dist');

    this._resizeCanvas(this.canvas, this.miniSize);

    wrap.querySelector('[data-tool="zoom-in"]').addEventListener('click', (e) => {
      e.stopPropagation(); this.zoom = Math.min(3, this.zoom * 1.35);
    });
    wrap.querySelector('[data-tool="zoom-out"]').addEventListener('click', (e) => {
      e.stopPropagation(); this.zoom = Math.max(0.6, this.zoom / 1.35);
    });
    wrap.querySelector('[data-tool="mode"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.mode = this.mode === 'north' ? 'heading' : 'north';
    });
    wrap.querySelector('[data-tool="open"]').addEventListener('click', (e) => {
      e.stopPropagation(); this.openFull();
    });

    this.canvas.addEventListener('click', () => this.openFull());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.6, Math.min(3, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: false });
  }

  _resizeCanvas(canvas, size) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── Full map DOM ──────────────────────────────────────────

  _buildFullMap() {
    const el = document.createElement('div');
    el.className = 'fullmap hidden';
    el.innerHTML = `
      <div class="fullmap-panel">
        <header class="fullmap-head">
          <h2>${icon('door', 18)} Lagos City Map</h2>
          <div class="fullmap-actions">
            <button class="fullmap-btn" data-act="mode">${icon('camera', 14)} Rotate</button>
            <button class="fullmap-btn" data-act="clear">${icon('close', 14)} Clear route</button>
            <button class="fullmap-btn fullmap-close" data-act="close">${icon('close', 16)}</button>
          </div>
        </header>
        <div class="fullmap-body">
          <canvas class="fullmap-canvas"></canvas>
          <aside class="fullmap-side">
            <div class="fullmap-section">
              <h3>Destination</h3>
              <div class="fullmap-dest-info">No destination selected</div>
            </div>
            <div class="fullmap-section fullmap-list-wrap">
              <h3>Places</h3>
              <div class="fullmap-list"></div>
            </div>
            <div class="fullmap-section">
              <h3>Legend</h3>
              <div class="fullmap-legend"></div>
            </div>
          </aside>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    this.fullEl = el;
    this.fullCanvas = el.querySelector('.fullmap-canvas');
    this.fullCtx = this.fullCanvas.getContext('2d');
    this.fullListEl = el.querySelector('.fullmap-list');
    this.fullDestEl = el.querySelector('.fullmap-dest-info');

    el.querySelector('[data-act="close"]').addEventListener('click', () => this.closeFull());
    el.querySelector('[data-act="mode"]').addEventListener('click', () => {
      this.mode = this.mode === 'north' ? 'heading' : 'north';
      this._renderFull();
    });
    el.querySelector('[data-act="clear"]').addEventListener('click', () => {
      this.clearRoute();
      this.onClearRoute();
      this._renderFull();
    });

    // Legend from the POI kind registry — every icon explained
    const legend = el.querySelector('.fullmap-legend');
    legend.innerHTML = Object.entries(POI_KINDS).map(([, k]) => `
      <div class="legend-row">
        <span class="legend-dot" style="background:${k.colour}"></span>
        <span>${k.label}</span>
      </div>
    `).join('') + `
      <div class="legend-row"><span class="legend-arrow">▲</span><span>You (facing)</span></div>
      <div class="legend-row"><span class="legend-route"></span><span>Active route</span></div>
    `;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyM') {
        e.preventDefault();
        if (this.fullOpen) this.closeFull();
        else this.openFull();
      }
    });
  }

  // ── Full map open/close ───────────────────────────────────

  openFull() {
    this.fullOpen = true;
    this.fullEl.classList.remove('hidden');
    this._renderFull();
  }

  closeFull() {
    this.fullOpen = false;
    this.fullEl.classList.add('hidden');
  }

  toggleFull() {
    if (this.fullOpen) this.closeFull();
    else this.openFull();
  }

  _renderFull() {
    const side = this.fullEl.querySelector('.fullmap-body');
    const size = Math.min(side.clientWidth - 300, side.clientHeight) || 560;
    this._resizeCanvas(this.fullCanvas, Math.max(320, Math.floor(size)));

    const list = this.pois.slice().sort((a, b) => {
      const p = this.getPlayer();
      return Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z);
    });

    this.fullListEl.innerHTML = list.map((p, i) => {
      const kind = POI_KINDS[p.kind] || POI_KINDS.enterable;
      const p0 = this.getPlayer();
      const dist = Math.round(Math.hypot(p.x - p0.x, p.z - p0.z));
      return `
        <button class="poi-row" data-poi="${i}">
          <span class="poi-dot" style="background:${kind.colour}"></span>
          <span class="poi-name">${p.name}</span>
          <span class="poi-dist">${dist} m</span>
        </button>
      `;
    }).join('');

    this.fullListEl.querySelectorAll('[data-poi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const poi = list[Number(btn.dataset.poi)];
        if (poi) this._choose(poi);
      });
    });

    if (this.destination) {
      const p = this.getPlayer();
      const dist = Math.round(Math.hypot(this.destination.x - p.x, this.destination.z - p.z));
      this.fullDestEl.innerHTML = `<strong>${this.destination.name}</strong><br>${dist} m away · route active`;
    } else {
      this.fullDestEl.textContent = 'No destination selected. Pick a place from the list or click the map.';
    }

    this._renderFullCanvas();
  }

  _choose(poi) {
    this.selected = poi;
    this.onSelectPOI(poi);
    this._renderFull();
  }

  // ── Rendering ─────────────────────────────────────────────

  _loop() {
    const tick = () => {
      this.pulse = (performance.now() % 2000) / 2000;
      this._renderMini();
      if (this.fullOpen) this._renderFullCanvas();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** World → canvas transform for a given canvas size and mode. */
  _transform(size, player) {
    const scale = (size / WORLD) * this.zoom;
    const rotate = this.mode === 'heading' ? -player.rot : 0;
    const cx = size / 2;
    const cy = size / 2;
    return { scale, rotate, cx, cy, player };
  }

  _worldToScreen(x, z, t) {
    // Translate so the player is centred when zoomed in, then rotate
    const px = (x - t.player.x) * t.scale;
    const pz = (z - t.player.z) * t.scale;
    const cos = Math.cos(t.rotate);
    const sin = Math.sin(t.rotate);
    // Screen y grows downward; world +z is "south" on the map
    return {
      x: t.cx + px * cos - pz * sin,
      y: t.cy + px * sin + pz * cos,
    };
  }

  _screenToWorld(sx, sy, t) {
    const dx = (sx - t.cx) / t.scale;
    const dy = (sy - t.cy) / t.scale;
    const cos = Math.cos(-t.rotate);
    const sin = Math.sin(-t.rotate);
    return {
      x: t.player.x + dx * cos - dy * sin,
      z: t.player.z + dx * sin + dy * cos,
    };
  }

  _drawBase(ctx, size, t, detail) {
    ctx.clearRect(0, 0, size, size);

    // Ground
    ctx.fillStyle = '#12161d';
    ctx.fillRect(0, 0, size, size);

    // Districts
    for (const d of districts) {
      const a = this._worldToScreen(d.x - d.w / 2, d.z - d.d / 2, t);
      const b = this._worldToScreen(d.x + d.w / 2, d.z + d.d / 2, t);
      ctx.fillStyle = `#${d.colour.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.globalAlpha = 1;

      if (detail) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '600 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const c = this._worldToScreen(d.x, d.z, t);
        ctx.fillText(d.name, c.x, c.y);
      }
    }

    // Roads — main roads plus the generated side streets
    const streetLines = (this.streetSegments || []);
    ctx.strokeStyle = '#2f3a47';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, 6 * (size / WORLD) * this.zoom * 0.6);
    for (const r of roadLines) {
      const a = this._worldToScreen(r.from.x, r.from.z, t);
      const b = this._worldToScreen(r.to.x, r.to.z, t);
      ctx.strokeStyle = r.avenue ? '#3d4b5c' : '#2f3a47';
      ctx.lineWidth = Math.max(1.2, (r.avenue ? 8 : 4.5) * (size / WORLD) * this.zoom * 0.6);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.5, 4 * (size / WORLD) * this.zoom * 0.6);
    for (const s of streetLines) {
      const a = s.axis === 'x'
        ? this._worldToScreen(s.from, s.at, t)
        : this._worldToScreen(s.at, s.from, t);
      const b = s.axis === 'x'
        ? this._worldToScreen(s.to, s.at, t)
        : this._worldToScreen(s.at, s.to, t);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Buildings — only when there is room to show them
    if (detail) {
      for (const b of buildings) {
        if (b.size.h < 0.5) continue;
        const a = this._worldToScreen(b.position.x - b.size.w / 2, b.position.z - b.size.d / 2, t);
        const c = this._worldToScreen(b.position.x + b.size.w / 2, b.position.z + b.size.d / 2, t);
        ctx.fillStyle = b.signColour ? 'rgba(140,170,200,0.55)' : 'rgba(90,105,125,0.38)';
        ctx.fillRect(a.x, a.y, Math.max(c.x - a.x, 1), Math.max(c.y - a.y, 1));
      }
    }
  }

  _drawRoute(ctx, size, t) {
    if (!this.route || this.route.length < 2) return;

    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -this.pulse * 24;
    ctx.beginPath();
    this.route.forEach((p, i) => {
      const q = this._worldToScreen(p.x, p.z, t);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    const end = this.route[this.route.length - 1];
    const e = this._worldToScreen(end.x, end.z, t);
    // Destination pin
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(e.x, e.y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(e.x - 4, e.y - 3);
    ctx.lineTo(e.x + 4, e.y - 3);
    ctx.lineTo(e.x, e.y + 4);
    ctx.closePath();
    ctx.fill();
  }

  _drawPOIs(ctx, size, t, all) {
    for (const p of this.pois) {
      const kind = POI_KINDS[p.kind] || POI_KINDS.enterable;
      const q = this._worldToScreen(p.x, p.z, t);
      if (q.x < -12 || q.y < -12 || q.x > size + 12 || q.y > size + 12) continue;

      if (!all && p.kind === 'enterable') continue; // keep the minimap readable

      const r = p === this.selected ? 5 : 3.4;
      ctx.fillStyle = kind.colour;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (p === this.selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  _drawPlayer(ctx, size, t) {
    const p = this.getPlayer();
    const c = { x: size / 2, y: size / 2 };

    // Heading in screen space: rotate the facing by the map rotation
    const heading = this.mode === 'heading' ? 0 : p.rot;
    const rot = -heading + Math.PI;

    ctx.save();
    ctx.translate(c.x, c.y);

    // Pulse halo so the marker is findable at a glance
    ctx.beginPath();
    ctx.arc(0, 0, 9 + this.pulse * 5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(111,227,255,${0.22 - this.pulse * 0.18})`;
    ctx.fill();

    ctx.rotate(rot);
    // Arrow: points along +z (screen down) before rotation
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = '#6fe3ff';
    ctx.fill();
    ctx.strokeStyle = '#04121a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  _renderMini() {
    if (!this.wrap || this.wrap.classList.contains('hidden')) return;
    const size = this.miniSize;
    const player = this.getPlayer();
    const t = this._transform(size, player);

    this._drawBase(this.fullCtx && false ? this.fullCtx : this.ctx, size, t, false);
    this._drawRoute(this.ctx, size, t);
    this._drawPOIs(this.ctx, size, t, false);
    this._drawPlayer(this.ctx, size, t);

    // District label
    const district = this._districtAt(player.x, player.z);
    if (district !== this.districtName) {
      this.districtName = district;
      this.districtEl.textContent = district;
    }

    // Destination readout
    if (this.destination) {
      const dist = Math.hypot(this.destination.x - player.x, this.destination.z - player.z);
      this.destEl.classList.remove('hidden');
      this.destNameEl.textContent = this.destination.name;
      this.destDistEl.textContent = `${Math.round(dist)} m`;
    } else {
      this.destEl.classList.add('hidden');
    }

    // North indicator
    const northEl = this.wrap.querySelector('.minimap-north');
    if (northEl) {
      northEl.style.transform = `rotate(${this.mode === 'heading' ? player.rot : 0}rad)`;
    }
  }

  _renderFullCanvas() {
    const size = this.fullCanvas.clientWidth || 560;
    const player = this.getPlayer();
    const t = this._transform(size, player);
    this._drawBase(this.fullCtx, size, t, true);
    this._drawRoute(this.fullCtx, size, t);
    this._drawPOIs(this.fullCtx, size, t, true);
    this._drawPlayer(this.fullCtx, size, t);
  }

  _districtAt(x, z) {
    for (const d of districts) {
      if (
        x >= d.x - d.w / 2 && x <= d.x + d.w / 2 &&
        z >= d.z - d.d / 2 && z <= d.z + d.d / 2
      ) return d.name;
    }
    return Math.abs(x) < 10 || Math.abs(z) < 10 ? 'City Centre' : 'Lagos';
  }

  setStreetSegments(segments) {
    this.streetSegments = segments;
  }

  setLocationLabel(text) {
    this.locationLabel = text;
  }

  show() { this.wrap.classList.remove('hidden'); }
  hide() {
    this.wrap.classList.add('hidden');
    if (this.fullOpen) this.closeFull();
  }
}
