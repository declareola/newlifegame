import { districts, buildings, roadLines, WORLD_BOUNDS } from './cityData.js';

/**
 * 2D mini-map rendered on a canvas overlay.
 * Shows district boundaries, buildings, roads, and the player dot.
 * Reads directly from cityData.js — no 3D dependencies.
 */
export class MiniMap {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 140;
    this.canvas.height = 140;
    this.canvas.className = 'mini-map';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Eko Basin is 797 m × 396 m, not a 200 m square: the minimap follows the
    // map's own extent, with an independent scale per axis so the lagoon reads
    // at its real proportions.
    this.bounds = WORLD_BOUNDS;
    this.worldW = this.bounds.maxX - this.bounds.minX;
    this.worldD = this.bounds.maxZ - this.bounds.minZ;
    this.scaleX = this.canvas.width / this.worldW;
    this.scaleY = this.canvas.height / this.worldD;
    this.scale = Math.min(this.scaleX, this.scaleY);

    // Pre-compute district rectangles (in screen pixels)
    this.districtRects = districts.map(d => ({
      name: d.name,
      colour: '#' + d.colour.toString(16).padStart(6, '0'),
      x: this._toScreenX(d.x - d.w / 2),
      y: this._toScreenY(d.z - d.d / 2),
      w: d.w * this.scaleX,
      h: d.d * this.scaleY,
    }));

    // Pre-compute building rectangles
    this.buildingRects = buildings.map(b => ({
      colour: '#' + b.colour.toString(16).padStart(6, '0'),
      isKey: !!b.signColour,
      x: this._toScreenX(b.position.x - b.size.w / 2),
      y: this._toScreenY(b.position.z - b.size.d / 2),
      w: Math.max(b.size.w * this.scaleX, 1.2),
      h: Math.max(b.size.d * this.scaleY, 1.2),
    }));

    // Pre-compute road lines from the Eko Basin road strips.
    this.roadLines = roadLines.map(r => ({
      x1: this._toScreenX(r.from.x),
      y1: this._toScreenY(r.from.z),
      x2: this._toScreenX(r.to.x),
      y2: this._toScreenY(r.to.z),
      avenue: r.avenue,
    }));
  }

  _toScreenX(wx) {
    return (wx - this.bounds.minX) * this.scaleX;
  }

  _toScreenY(wz) {
    return (wz - this.bounds.minZ) * this.scaleY;
  }

  /**
   * Draw the mini-map. Call every frame.
   * @param {number} playerX - player world X
   * @param {number} playerZ - player world Z
   */
  update(playerX, playerZ) {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, cw, ch);

    // Districts
    for (const d of this.districtRects) {
      ctx.fillStyle = d.colour;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.name, d.x + d.w / 2, d.y + d.h / 2 + 3);
    }

    // Roads
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 3;
    for (const r of this.roadLines) {
      ctx.beginPath();
      ctx.moveTo(r.x1, r.y1);
      ctx.lineTo(r.x2, r.y2);
      ctx.stroke();
    }

    // Buildings
    for (const b of this.buildingRects) {
      ctx.fillStyle = b.colour;
      if (b.isKey) {
        ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
      } else {
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    }

    // Player dot (green, white outline)
    const px = this._toScreenX(playerX);
    const py = this._toScreenY(playerZ);
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, cw, ch);
  }
}
