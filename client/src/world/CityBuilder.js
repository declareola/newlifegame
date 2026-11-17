import * as THREE from 'three';
import { EkoBuilder } from './EkoBuilder.js';
import { mergeByMaterial, countMeshes } from './mergeUtils.js';
import { createTrees } from './Trees.js';
import { materials } from './materials.js';
import {
  districts,
  buildings,
  treePositions,
  palmTreePositions,
  lightPositions,
  getCollisionBoxes,
  WORLD_STATS,
} from './cityData.js';

const _dummy = new THREE.Object3D();

/** Look up a landmark by id. */
function findBuilding(id) {
  return buildings.find((b) => b.id === id) || null;
}

// ── Helper: create a canvas texture with text for building signs ──
function createSignTexture(text, bgColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Builds the entire city from cityData.js.
 * Returns a THREE.Group and exposes collision AABBs + sign meshes.
 * Uses InstancedMesh for trees and street lights to minimise draw calls.
 */
export class CityBuilder {
  /**
   * @param {object} [opts]
   * @param {AssetLibrary} [opts.assets] real CC0 models (trees, lamps, props).
   */
  constructor({ assets = null } = {}) {
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.collisionBoxes = [];
    this.signMeshes = [];
    this.stats = null;
    this.map = null;
  }

  build() {
    // The landmasses, lagoon, bridges, metro, turf, POIs and building shells
    // all come from the Eko Basin map (world/EkoBuilder.js). What is added here
    // is everything that sits *on* the map: trees, lamps, street props and the
    // district boundary lines.
    this.map = new EkoBuilder({ assets: this.assets }).build();
    this.group.add(this.map.group);
    this.buildingGroup = this.map.buildingGroup;

    this.collisionBoxes = getCollisionBoxes();
    this.signMeshes = buildings.filter((b) => b.signColour).map((b) => ({ building: b }));

    this._buildTrees();
    this._buildStreetProps();
    this._buildLights();
    this._buildDistrictBoundaries();

    this.stats = countMeshes(this.group);
    return this;
  }

  /** Landmasses, bridges, metro lines and POIs, for the map screen and HUD. */
  getMapInfo() {
    return this.map ? this.map.stats : WORLD_STATS;
  }

  /**
   * Lamp heads on the three bridge decks.
   *
   * render/NightLights.js lights the lamps nearest the player out of one pool; the
   * street lamps come from the map data and the bridge lamps come from the deck
   * geometry, which is why they are collected here rather than invented twice.
   */
  get bridgeLampPositions() {
    return this.map?.bridgeLampPositions || [];
  }

  /** The lagoon mesh and the label sprites, so the HUD can toggle them. */
  getWater() { return this.map ? this.map.water : null; }

  getLabels() { return this.map ? this.map.labels : []; }

  // ─── Trees ────────────────────────────────────────────────────
  // Delegated to world/Trees.js: tapered trunk, angled branches and a
  // multi-lobe canopy instead of the cone-on-a-stick this used to be.
  _buildTrees() {
    this.treeStats = createTrees(this.group, treePositions, palmTreePositions, materials, {
      assets: this.assets,
    });
  }

  // ─── Street lights (InstancedMesh) ─────────────────────────────
  _buildLights() {
    if (lightPositions.length === 0) return;

    // Real lamp posts when the street kit is installed. The emissive head stays
    // procedural either way: it is the thing that actually glows at night, and
    // the five-hundred-triangle lamp model does not need to.
    if (this._buildRealLamps()) return;

    const dummy = new THREE.Object3D();

    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 6, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, lightPositions.length);
    poleMesh.castShadow = true;

    const headGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const headMat = materials.glow(0xfff3c4);
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, lightPositions.length);

    for (let i = 0; i < lightPositions.length; i++) {
      const p = lightPositions[i];
      dummy.position.set(p.x, 3, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, 6.2, p.z);
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
    }
    poleMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    this.group.add(poleMesh);
    this.group.add(headMesh);
  }

  /**
   * Kenney street lights, instanced along the same positions the poles used.
   * @returns {boolean} false when the models are unavailable
   */
  _buildRealLamps() {
    const assets = this.assets;
    if (!assets || !assets.hasModel('street.lamp')) return false;

    const height = 6.4;                       // metres to the lamp head
    const parts = assets.instanceParts('street.lamp');
    const size = assets.modelSize('street.lamp');
    if (!parts || !size) return false;

    const scale = height / (size.y || 1);
    const count = lightPositions.length;
    const matrices = [];
    for (const p of lightPositions) {
      // Alternating yaw: opposite sides of the street, arm over the carriageway.
      const yaw = Math.round(p.x * 0.01 + p.z * 0.01) % 2 === 0 ? 0 : Math.PI;
      _dummy.position.set(p.x, 0, p.z);
      _dummy.rotation.set(0, yaw, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      matrices.push(_dummy.matrix.clone());
    }

    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'street-lamps';
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }

    // The glowing head, kept from the old pole so night lighting still reads.
    const headGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const headMat = materials.glow(0xfff3c4);
    const headMesh = new THREE.InstancedMesh(headGeo, headMat, count);
    headMesh.name = 'street-lamp-heads';
    for (let i = 0; i < count; i++) {
      const p = lightPositions[i];
      _dummy.position.set(p.x, height - 0.35, p.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      headMesh.setMatrixAt(i, _dummy.matrix);
    }
    headMesh.instanceMatrix.needsUpdate = true;
    this.group.add(headMesh);
    return true;
  }

  /**
   * Cones and barriers around the construction jobs — the sort of clutter that
   * makes a street look inhabited, taken from the Kenney street kit.
   */
  _buildStreetProps() {
    const assets = this.assets;
    if (!assets) return;
    const site = buildings.find((b) => b.id === 'kiosk-construction');
    if (!site) return;

    const place = (name, count, ring, scale = 1) => {
      const parts = assets.instanceParts(name);
      const size = assets.modelSize(name);
      if (!parts || !size) return;
      const s = (scale * (0.9 / (size.y || 1)));
      const meshes = parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `prop-${name}`;
        this.group.add(mesh);
        return mesh;
      });
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        _dummy.position.set(
          site.position.x + Math.cos(ang) * ring,
          0,
          site.position.z + Math.sin(ang) * ring,
        );
        _dummy.rotation.set(0, ang, 0);
        _dummy.scale.setScalar(s * (0.9 + (i % 3) * 0.08));
        _dummy.updateMatrix();
        for (const mesh of meshes) mesh.setMatrixAt(i, _dummy.matrix);
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    };

    place('street.cone', 8, 4.4, 1);
    place('street.barrier', 4, 5.4, 1.1);
  }

  // ─── District boundary lines (visual only) ─────────────────────
  _buildDistrictBoundaries() {
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
    });
    for (const d of districts) {
      const halfW = d.w / 2;
      const halfD = d.d / 2;
      const points = [
        new THREE.Vector3(d.x - halfW, 0.03, d.z - halfD),
        new THREE.Vector3(d.x + halfW, 0.03, d.z - halfD),
        new THREE.Vector3(d.x + halfW, 0.03, d.z + halfD),
        new THREE.Vector3(d.x - halfW, 0.03, d.z + halfD),
        new THREE.Vector3(d.x - halfW, 0.03, d.z - halfD),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, lineMat);
      this.group.add(line);
    }
  }

  // ─── Accessors ────────────────────────────────────────────────
  getCollisionBoxes() {
    return this.collisionBoxes;
  }

  getSignMeshes() {
    return this.signMeshes;
  }

  getStats() {
    return this.stats || countMeshes(this.buildingGroup);
  }
}
