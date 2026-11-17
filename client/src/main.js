import * as THREE from 'three';
import './styles.css';
import { Avatar } from './player/Avatar.js';
import { PlayerController } from './player/PlayerController.js';
import { CityBuilder } from './world/CityBuilder.js';
import {
  onRoadway, SPAWN as EKO_SPAWN, WORLD_BOUNDS, islandAt, BRIDGES, toWorld,
  lightPositions,
} from './world/cityData.js';
import {
  bridgeSurfaceAt, deckWidth, BRIDGE_PATHS, DECK_THICKNESS,
} from './world/bridgeProfile.js';
import { NavGrid } from './world/navGraph.js';
import { buildPOIs } from './world/poi.js';
import { MapSystem } from './ui/MapSystem.js';
import { NavigationSystem } from './nav/NavigationSystem.js';
import { setInteractionPoints } from './world/interactionPoints.js';
import { AuthScreen } from './auth/AuthScreen.js';
import {
  getToken, getMe, clearToken, setToken, saveAppearance, getWanted, SOCKET_ORIGIN,
} from './auth/api.js';
import { io } from 'socket.io-client';
import { HUD } from './hud/HUD.js';
import { Toast } from './hud/Toast.js';
import { JobBoard } from './jobs/JobBoard.js';
import { ActivityPanel } from './activities/ActivityPanel.js';
import { PropertyPanel } from './properties/PropertyPanel.js';
import { VenuePanel } from './ui/VenuePanel.js';
import { UtilitiesPanel } from './ui/UtilitiesPanel.js';
import { WantedPanel } from './ui/WantedPanel.js';
import { RemotePlayers } from './multiplayer/RemotePlayers.js';
import { Chat } from './multiplayer/Chat.js';
import { InteractionSystem } from './interactions/InteractionSystem.js';
import { DayNight } from './world/DayNight.js';
import { NightLights } from './render/NightLights.js';
import { Leaderboard } from './hud/Leaderboard.js';
import { TouchControls } from './hud/TouchControls.js';
import { SessionMenu } from './auth/SessionMenu.js';
import { InteriorSystem } from './world/InteriorSystem.js';
import { materials } from './world/materials.js';
import { PostFX, detectQuality } from './render/PostFX.js';
import { SkyEnvironment } from './render/SkyEnvironment.js';
import { ShadowRig } from './render/ShadowRig.js';
import { Weather } from './render/Weather.js';
import { createDebugPanel } from './render/DebugPanel.js';
import { ActionBar } from './ui/ActionBar.js';
import { DialogueUI } from './ui/DialogueUI.js';
import { ControlsGuide } from './ui/ControlsGuide.js';
import { PauseMenu } from './ui/PauseMenu.js';
import { CameraHud } from './ui/CameraHud.js';
import { Tutorial } from './ui/Tutorial.js';
import { CharacterPanel } from './ui/CharacterPanel.js';
import { VehiclesPanel } from './ui/VehiclesPanel.js';
import { InventoryPanel } from './inventory/InventoryPanel.js';
import { MissionJournal } from './missions/MissionJournal.js';
import { ObjectiveTracker } from './missions/ObjectiveTracker.js';
import { DriveHUD } from './ui/DriveHUD.js';
import { NPCSystem } from './world/NPCSystem.js';
import { VehicleSystem } from './world/VehicleSystem.js';
import { TrafficSystem } from './world/TrafficSystem.js';
import { npcService, markDistrictVisit } from './auth/api.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { AssetLibrary } from './assets/AssetLibrary.js';
import { useFurnitureAssets } from './world/furniture.js';
import {
  installSurfaceTextures, installRealSky, installStreetAssets, treeModels, retile,
} from './assets/installAssets.js';
import { bindUISounds } from './audio/uiSound.js';

// ===================== Renderer =====================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Filmic tone mapping keeps the bright Lagos sun from blowing out the facade
// detail, and gives the whole frame a photographic roll-off.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.style.display = 'block';
document.body.appendChild(renderer.domElement);

/** Loading-screen helpers. Declared early because the asset load uses them. */
function setLoadingText(text) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = text;
}
function setLoadingProgress(fraction) {
  const el = document.getElementById('progress-fill');
  if (el) el.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

// ===================== Real assets =====================
// CC0 models and photographs (see client/fetch-assets.sh). Loaded before the
// city is generated so the ground, roads and walls are built from the real
// textures rather than patched afterwards. Every failure is a fallback: with no
// network, this resolves in ~20 s and the game is exactly what it was before.
const assets = new AssetLibrary();
setLoadingText('Loading cars, trees and sky…');
await assets.load((done, total) => setLoadingProgress(done / total));
const installedTextures = installSurfaceTextures(assets);

// ===================== Scene & Camera =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  // A 0.1 m near plane with a 1000 m far plane wastes most of a 24-bit depth
  // buffer: at 200 m one depth step was ~5 cm, which is not enough to separate a
  // road from the pavement it lies on. 0.25 doubles that precision and nothing
  // in the city is closer than a quarter of a metre to the camera.
  0.25,
  1000
);
camera.position.set(0, 6, 10);
camera.lookAt(0, 1.5, 0);

// ===================== Post-processing =====================
// SSAO + bloom + SMAA, with a device-appropriate quality tier.
const postfx = new PostFX(renderer, scene, camera, detectQuality());

// ===================== Lights =====================
// A hemisphere fill, not a flat ambient. Outdoor light arrives from two very
// different places: a blue sky overhead and a warm bounce off the ground. An
// AmbientLight can only average them into one grey, which is exactly what makes
// a scene look like a render instead of a street. DayNight overwrites .color and
// .intensity from the sky palette every frame; groundColor stays warm.
const ambientLight = new THREE.HemisphereLight(0xbfd8f0, 0x6b5a44, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.1);
directionalLight.position.set(60, 90, 40);
scene.add(directionalLight);
// The shadow target must be in the scene graph for its matrix to update.
scene.add(directionalLight.target);

// Tight, player-following shadow frustum. A 60 m half-extent on a 2048² map is
// ~5.9 cm per texel — roughly 2.2× sharper than the old fixed 130 m box — and
// because it follows the player, detail stays where the player is looking.
const shadowRig = new ShadowRig(directionalLight, { mapSize: 2048, bound: 60 });

// ===================== Sky + image-based lighting =====================
// The sky shader is both the visible backdrop and the light probe: its output is
// baked into a PMREM environment map whenever the sun has moved enough. Every
// PBR surface therefore reflects the actual sky for the current time of day,
// instead of the indoor studio probe used before.
const skyEnv = new SkyEnvironment({ renderer, scene });

// The sky photographs are installed *after* the library has fully settled.
// `assets.load()` is allowed to give up at a timeout so a slow CDN cannot hold
// the loading screen hostage — but that also means the HDRIs may still be
// parsing when we get here. Installing them once, too early, is why every
// session ran on the procedural shader and the sky never looked like the sky.
let installedSkies = installRealSky(skyEnv, assets);
// Set when the photographs land late; the frame loop re-picks the band for the
// hour that is running *then*, not the hour we happened to be in at boot.
let pendingSkyRefresh = false;
assets.whenIdle().then(() => {
  const again = installRealSky(skyEnv, assets);
  if (again.length > installedSkies.length) {
    installedSkies = again;
    // Re-pick the band for the current hour, now that there is something to pick.
    activeSkyBand = null;
    pendingSkyRefresh = true;
  }
});

/**
 * Pick the sky photograph that matches the time of day.
 *
 * One HDRI cannot be honest at 2 a.m. — a bright daytime photograph at night
 * would light the whole city like noon. So the three photographs are mapped to
 * three bands of the day, and the procedural sky stays available underneath for
 * when none of them loaded.
 * @param {number} hour 0–24
 */
let activeSkyBand = null;
function updateSkyForHour(hour) {
  if (!installedSkies.length) return;
  let band;
  if (hour >= 5.6 && hour < 17.4) band = 'sky_day';
  else if (hour >= 17.4 && hour < 19.4) band = 'sky_dusk';
  else if (hour >= 19.4 || hour < 5.0) band = 'sky_night';
  else band = 'sky_dusk';                 // the hour before sunrise
  if (!installedSkies.includes(band)) band = installedSkies[0];
  if (band === activeSkyBand) return;
  activeSkyBand = band;
  // The night photograph is the backdrop only: its moon would light the street
  // like a second sun. Day and dusk HDRIs do both jobs.
  skyEnv.useEquirect(band, { asEnvironment: band !== 'sky_night' });
}

// ===================== Day / night cycle (Step 11) =====================
const dayNight = new DayNight(scene, directionalLight, ambientLight, {
  // The sky owns scene.background (a baked cube map), so DayNight must not
  // paint a flat colour over it.
  manageBackground: false,
  onSunChange: (state) => {
    skyEnv.setSun(state.direction);
  },
});

// ===================== Weather =====================
// Rain is a world state, not a decal: DayNight greys the palette from it, the
// audio engine switches to its rain bed, traffic slows and the HUD shows it.
const weather = new Weather(scene, { volume: 90 });

// ===================== Ground =====================
// A flat green base under everything, at -0.6 m: below the lagoon surface
// (-1.1 m is still under it, so it never shows) and, crucially, *not* coplanar
// with the island tops at y = 0.
//
// It used to sit at exactly y = 0, the same plane as every island top. Two
// coplanar surfaces across the whole map fight for the depth buffer, and the
// winner changes as the camera moves — a fine speckled shimmer over all open
// ground that reads as the game flickering. Depth precision at 200 m with a
// 0.1 m near plane is roughly 5 cm, so a 2 cm offset would not have been enough
// either; the surfaces are now 0.6 m apart.
const groundGeo = new THREE.PlaneGeometry(600, 600);
const groundMat = materials.grassLarge();
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -0.6;
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ===================== Player Avatar =====================
const avatar = new Avatar({
  skinColor: 0xf1c27d,
  outfitColor: 0x2196f3,
});
scene.add(avatar);

// ===================== Player Controller =====================
const controller = new PlayerController(avatar, camera, renderer.domElement);

// ── Camera look settings, remembered between sessions ──
const LOOK_SETTINGS_KEY = 'newlife.camera.look';
try {
  const saved = JSON.parse(localStorage.getItem(LOOK_SETTINGS_KEY) || 'null');
  if (saved && typeof saved === 'object') controller.setLookSettings(saved);
} catch { /* a corrupt entry must never stop the game booting */ }

function saveLookSettings() {
  try {
    localStorage.setItem(LOOK_SETTINGS_KEY, JSON.stringify(controller.look));
  } catch { /* private mode: not fatal */ }
}

const cameraHud = new CameraHud({
  controller,
  onToast: (msg, type) => toast.show(msg, type),
});
function updateCameraHud() { cameraHud.update(); }

// Furniture inside every interior: real models when they are on disk, the
// procedural set otherwise. Installed before any interior is generated.
useFurnitureAssets(assets);

// ===================== City =====================
const city = new CityBuilder({ assets });
city.build();
scene.add(city.group);

// Real light after dark: a pool of warm point lights re-seated on the lamps
// nearest the player, so the pavement is actually lit rather than just painted
// with a glowing bulb. See render/NightLights.js.
// Island avenues and the bridge spans share one pool, so a crossing is lit.
const nightLights = new NightLights(scene, {
  positions: [...lightPositions, ...(city.bridgeLampPositions || [])],
});
controller.setCollisionBoxes(city.getCollisionBoxes());
// The lagoon is a wall the collision boxes cannot describe: without this the
// player walks straight off the quay and across the water to the next island.
controller.setTerrainCheck((x, z) => !!islandAt(x, z) || bridgeSurfaceAt(x, z) !== null);
// The three bridges are ramps, not planks: the deck rises to its crown, so the
// controller asks the profile for the height underfoot instead of assuming 0.
controller.setGroundHeight((x, z) => bridgeSurfaceAt(x, z));
controller.setBounds(WORLD_BOUNDS);

// Photographic surfaces get their texture coordinates from world position, at a
// real physical scale — a road tile is 5.5 m on a side street and on an avenue
// alike. Run once the geometry exists.
const retileStats = retile(city.group);

// ===================== Navigation grid =====================
// Built from the exact collision AABBs the player walks against, so a route can
// never cross a wall. Also used to validate door placement and NPC patrols.
// Spawn on the corner pavement at the city centre, not at (0,0): the middle of
// the map is inside a block building now that blocks are filled.
/**
 * Where a fresh character wakes up.
 *
 * On Eko Basin that is the doorstep of the Third Bridge Canteen, on the Outer
 * Borough — the place the blueprint opens the story in (chapter 1), and where
 * Mama Eko works. The position comes from the map generator (world/ekoWorld.js),
 * so moving the Canteen moves the spawn with it instead of leaving a new player
 * standing in a wall.
 */
export const SPAWN = EKO_SPAWN;

const nav = new NavGrid({
  boxes: city.getCollisionBoxes(),
  radius: 0.45,
  bounds: WORLD_BOUNDS,
  // The three bridges are the only way between the islands on foot.
  walkways: BRIDGES.map((b) => ({
    a: toWorld(b.a[0], b.a[1]),
    b: toWorld(b.b[0], b.b[1]),
    // The driveable deck width from the profile, not the blueprint's map-graphic
    // figure: the walkway has to fit the bridge that is actually drawn.
    width: deckWidth(b) + 1.2,
  })),
});
nav.computeReachable(SPAWN);

// ===================== Interiors =====================
// Walk up to a door marker and press E to go inside. The interior gets its own
// scene + light rig; the renderer is simply pointed at whichever scene is live.
let activeScene = scene;

const interiors = new InteriorSystem({
  nav,
  avatar,
  controller,
  cityScene: scene,
  onSceneChange: (next) => {
    activeScene = next || scene;
    postfx.setScene(activeScene);
    // Rain belongs to the outdoors: the streets get wet, the bank does not.
    if (next && weather.group.parent !== next) next.add(weather.group);
    else if (!next && weather.group.parent !== scene) scene.add(weather.group);
  },
  onToast: (msg, type) => toast.show(msg, type),
});
interiors.setCityCollisionBoxes(city.getCollisionBoxes());
scene.add(interiors.getMarkerGroup());

// Camera (V): third person → first person → top-down → third person.
// Works indoors too — first person inside a building is the best way to look
// around a shop.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  controller.cycleViewMode();
  updateCameraHud();
  toast.show(`Camera: ${controller.viewLabel}`, 'info');
});

// Graphics quality cycle (Q): high -> medium -> low -> high
const QUALITY_ORDER = ['high', 'medium', 'low'];
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyQ') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(postfx.quality) + 1) % QUALITY_ORDER.length];
  postfx.setQuality(next);
  toast.show(`Graphics: ${next}`, 'info');
});

// Mute on Shift+M (M alone is the world map), so sound is always one key away.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || !e.shiftKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  const muted = audio.toggleMute();
  toast.show(muted ? '🔇 Sound off' : '🔊 Sound on', 'info');
});

// Weather is real, so the debug panel can move it: Shift+R forces rain on/off.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyR' || !e.shiftKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  weather.toggle();
  toast.show(weather.raining ? '🌧 Rain moving in' : '🌤 Rain clearing', 'info');
});

// ===================== Map + navigation =====================
// One POI registry feeds the minimap, the world map and the routing system, so
// a marker and the route to it can never disagree.
const pois = buildPOIs({ nav });

const map = new MapSystem({
  getPlayer: () => ({
    x: avatar.position.x,
    z: avatar.position.z,
    rot: controller.facing,
  }),
  pois,
  onSelectPOI: (poi) => navigation.navigateTo(poi),
  onClearRoute: () => navigation.clear(),
});
map.setStreetSegments(nav.streets.segments);

const navigation = new NavigationSystem({
  nav,
  map,
  getPlayer: () => ({ x: avatar.position.x, z: avatar.position.z }),
  onToast: (msg, type) => toast.show(msg, type),
  onArrive: (dest) => {
    // Arriving at a door POI is a natural moment to walk in
    if (dest.poi?.interiorId && !interiors.isInside) {
      interiors.enter(dest.poi.interiorId);
    }
  },
});
navigation.setPlayerRotProvider(() => controller.facing);

// ===================== Multiplayer (Step 9) =====================
// Other players stand on the same deck you do — bridge ramps included.
const remotePlayers = new RemotePlayers(scene, { groundAt: bridgeSurfaceAt });

let gameSocket = null;

const chat = new Chat({
  onSend: (text) => {
    if (gameSocket && gameSocket.connected) {
      socketEmit('chat:message', text);
    }
  },
  onFocusChange: () => {},
});

// ===================== Leaderboard (Step 11) =====================
const leaderboard = new Leaderboard({
  onError: (msg) => toast.show(`🏆 ${msg}`, 'warning'),
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyL' || !authState.token) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  leaderboard.toggle();
});

// ===================== World interactions (Step 10) =====================
const interactions = new InteractionSystem({
  getPlayerPosition: () => ({ x: avatar.position.x, z: avatar.position.z }),
  onToast: (message, type) => toast.show(message, type),
  onNeedsChanged: () => {
    // The server pushes fresh needs on the next tick; nothing to do here yet.
  },
});

// ===================== HUD & Toast =====================
const hud = new HUD();
const toast = new Toast();

// ===================== Audio =====================
// Browsers only allow an AudioContext after a gesture, so the engine is
// constructed now (it needs no context for that) and resumed on the first
// click or keypress. Every play() call before then is silently dropped.
const audio = new AudioEngine();

function unlockAudio() {
  audio.resume();
  if (audio.ctx) {
    removeEventListener('pointerdown', unlockAudio, true);
    removeEventListener('keydown', unlockAudio, true);
    removeEventListener('touchstart', unlockAudio, true);
    audio.setAmbience('street');
  }
}
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);
addEventListener('touchstart', unlockAudio, true);
bindUISounds(audio);

// Toasts speak: money sounds like money, an error sounds like an error.
const _toastShow = toast.show.bind(toast);
toast.show = (msg, type = 'info') => {
  audio.play(type === 'error' ? 'error' : type === 'success' ? 'success' : 'click', { gain: 0.7 });
  return _toastShow(msg, type);
};

// Show the in-game day/night clock instead of wall-clock time
hud.onUsernameClick(() => {
  if (authState.token) sessionMenu.open();
});

hud.setClockProvider(() => ({
  label: dayNight.clockLabel,
  night: dayNight.isNight,
}));

// ===================== Job Board =====================
const jobBoard = new JobBoard({
  onJobChange: (job) => {
    if (job) {
      toast.show(`💼 Started working: ${job.name}`, 'info');
    } else {
      toast.show('💼 Quit job', 'info');
    }
  },
});

// Toggle job board with 'K' — J belongs to the mission journal
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyK' || !authState.token) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  propertyPanel.hide();
  activityPanel.hide();
  jobBoard.toggle();
});

// ===================== Activity Panel =====================
const activityPanel = new ActivityPanel({
  onActivityChange: (activity) => {
    if (activity) {
      toast.show(`🎯 Started: ${activity.name}`, 'info');
    } else {
      toast.show('🎯 Activity cancelled', 'info');
    }
  },
});

// Toggle activity panel with 'G' — A is strafe-left
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG' || !authState.token) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  jobBoard.hide();
  propertyPanel.hide();
  activityPanel.toggle();
});

// ===================== Property Panel =====================
const propertyPanel = new PropertyPanel({
  onHomeChange: (home) => {
    // The Home button reflects the server's answer the moment it arrives.
    actionBar.setHomeState(home);
    if (home) {
      toast.show(`${home.icon} Moved into ${home.name}`, 'info');
    } else {
      toast.show('🏠 No longer living anywhere', 'warning');
    }
  },
  onError: (msg) => {
    toast.show(`🏠 ${msg}`, 'warning');
  },
  // Listing and unlisting are visible events: say so, so the player knows the
  // market changed and their title is live.
  onListed: ({ property, mode, price }) => {
    if (!property) {
      toast.show('🏠 Listing taken off the market', 'info');
      return;
    }
    if (mode === 'sale') {
      toast.show(`🏠 ${property.name} is up for sale at ₦${price.toLocaleString('en-NG')}`, 'success');
    } else {
      toast.show(`🏠 ${property.name} is available to let at ₦${price.toLocaleString('en-NG')}/period`, 'success');
    }
  },
});

// 'H' is the Go Home shortcut — see goHome() below. The property market lives on
// the action bar ('4').

// ===================== Touch controls (Step 11) =====================
const touchControls = new TouchControls({
  controller,
  onChat: () => chat.open(),
});

// ===================== Session menu =====================
const sessionMenu = new SessionMenu({
  onLoggedOut: () => {
    clearToken();
    location.reload();
  },
  onNewToken: (newToken) => {
    // Swap the stored token and reconnect with it.
    setToken(newToken);
    authState.token = newToken;
    jobBoard.setToken(newToken);
    activityPanel.setToken(newToken);
    propertyPanel.setToken(newToken);
    interactions.setToken(newToken);
    leaderboard.setToken(newToken);
    sessionMenu.setToken(newToken);
    if (gameSocket) {
      gameSocket.auth = { token: newToken };
      gameSocket.disconnect().connect();
    }
  },
  onToast: (message, type) => toast.show(message, type),
});

// Escape is owned by the pause menu (created below). The session menu — account
// settings, password change, sign-out — opens from the pause menu and from a
// click on your own name in the HUD.


// ===================== Auth =====================
const authState = { token: null, user: null };

/**
 * Turn the server's user row into a look the Avatar understands.
 * Accounts made before the character creator have only two colours stored, so
 * hair and build are derived from the username instead — stable, and still
 * different from the next player.
 */
function lookFromUser(user) {
  let h = 2166136261;
  const name = user.username || '';
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const legacyHair = ['short', 'afro', 'braids', 'bald', 'fade'][h % 5];
  return {
    skin: user.skin_color ?? 0xf1c27d,
    top: user.outfit_color ?? 0x2196f3,
    bottom: user.bottom_color ?? 0x2c3e50,
    hair: user.hair_style || legacyHair,
    hairColour: user.hair_color ?? [0x120c09, 0x241a12, 0x3b2a1c, 0x1b1b22][(h >> 4) % 4],
    body: user.body_type || 'average',
    outfit: user.outfit_id || 'casual',
  };
}

function applyUserToAvatar(user) {
  avatar.setLook(lookFromUser(user));
  // Spawn back where this player last logged off (Step 11) — but if that spot is
  // inside a wall (the city layout changed under a saved position), put them on
  // the nearest walkable ground instead of inside a building.
  let spawnX = SPAWN.x;
  let spawnZ = SPAWN.z;
  // (0, 0) is the column default for a brand-new account, not a place a player
  // has been. Trusting it put every new character in the middle of the central
  // crossroads, which is why the first screenshot of the game was a look at the
  // tarmac between two blank walls.
  const hasSavedPosition = Number.isFinite(user.pos_x) && Number.isFinite(user.pos_z)
    && !(Math.abs(user.pos_x) < 1 && Math.abs(user.pos_z) < 1);
  if (hasSavedPosition) {
    spawnX = user.pos_x;
    spawnZ = user.pos_z;
  }
  if (!nav.isWalkable(spawnX, spawnZ)) {
    const safe = nav.nearestWalkable(spawnX, spawnZ) || SPAWN;
    spawnX = safe.x;
    spawnZ = safe.z;
  }
  avatar.position.set(spawnX, 0, spawnZ);
  // Face up the avenue, with the camera behind — the same mechanism entering a
  // building uses, so the controller cannot overwrite it on the next frame.
  if (controller.setFacing) controller.setFacing(Number.isFinite(user.rot_y) ? user.rot_y : SPAWN.rotY, { cameraYaw: 0 });
}

function connectGameSocket(token) {
  // Same-origin by default (the game's own server); the server's origin when the
  // client is hosted separately — see API_ORIGIN in auth/api.js.
  const socket = io(SOCKET_ORIGIN ?? undefined, {
    auth: { token },
    withCredentials: true,
  });
  gameSocket = socket;
  jobBoard.setToken(token);
  activityPanel.setToken(token);
  propertyPanel.setToken(token);
  interactions.setToken(token);
  leaderboard.setToken(token);
  sessionMenu.setToken(token);
  let previousState = null;

  socket.on('connect', () => {
    console.log('Connected to game server');
  });

  socket.on('player:update', (state) => {
    // Show toasts for threshold crossings
    if (previousState) {
      if (state.hunger < 10 && previousState.hunger >= 10) {
        toast.show('⚠️ You\'re starving! Movement speed reduced.', 'warning');
      }
      if (state.energy < 10 && previousState.energy >= 10) {
        toast.show('⚠️ You\'re exhausted! Movement speed reduced.', 'warning');
      }
      if (state.passedOut && !previousState.passedOut) {
        toast.show('😵 You passed out! Controls locked for 10 seconds.', 'critical');
      }
      if (!state.passedOut && previousState.passedOut) {
        toast.show('👋 You woke up!', 'info');
      }
    }

    // Housing toasts (Step 8)
    if (previousState && state.home !== previousState.home) {
      if (!state.home) {
        toast.show('🏚️ You are homeless — sleeping gives no bonus', 'warning');
      }
    }

    previousState = state;
    lastPlayerState = state;
    hud.update(state);
    activityPanel.setActivity(state.activity, state.activityEndsAt);
    activityPanel.setNeeds({
      hunger: state.hunger, energy: state.energy, hygiene: state.hygiene,
      bladder: state.bladder, fun: state.fun, social: state.social,
    });
    controller.setSpeedMultiplier(state.speedMultiplier);
    controller.setControlsLocked(state.controlsLocked);
  });

  // Rent / eviction events pushed by the game loop
  socket.on('home:event', (event) => {
    if (event.type === 'rent-paid') {
      const how = event.source === 'bank'
        ? `₦${Number(event.bankUsed).toLocaleString('en-NG')} from bank`
        : 'from cash';
      toast.show(
        `🏠 Rent paid — ₦${Number(event.amount).toLocaleString('en-NG')} (${how}) for ${event.propertyName}`,
        'info'
      );
    } else if (event.type === 'evicted') {
      toast.show(
        `🚪 Evicted from ${event.propertyName} — you could not pay ₦${Number(event.amount).toLocaleString('en-NG')} rent`,
        'critical'
      );
    }
  });

  // ── Multiplayer (Step 9) ──────────────────────────────────
  socket.on('world:init', (data) => {
    refreshWorldData();
    document.body.classList.add('in-game');
    remotePlayers.clear();
    remotePlayers.applySnapshot(data.players || [], socket.id);
    if (Array.isArray(data.chat)) {
      for (const msg of data.chat) chat.addMessage(msg, { history: true });
    }
    hud.setOnlineCount((data.players?.length || 0) + 1);
  });

  socket.on('world:players', (data) => {
    remotePlayers.applySnapshot(data.players || [], socket.id);
    hud.setOnlineCount(data.count || 1);
  });

  socket.on('world:player-joined', (p) => {
    if (p && p.username) toast.show(`👋 ${p.username} joined the city`, 'info');
  });

  socket.on('world:player-left', ({ id }) => {
    if (id) remotePlayers.remove(id);
  });

  socket.on('chat:message', (msg) => {
    chat.addMessage(msg);
  });

  socket.on('chat:error', ({ message }) => {
    toast.show(`💬 ${message}`, 'warning');
  });

  // Someone signed in to this account elsewhere — this session is now dead.
  socket.on('session:replaced', ({ message }) => {
    clearToken();
    toast.show(
      `⚠️ ${message || 'Signed in elsewhere.'} Reloading…`,
      'critical'
    );
    setTimeout(() => location.reload(), 2500);
  });

  socket.on('disconnect', () => {
    document.body.classList.remove('in-game');
    remotePlayers.clear();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err.message);
    if (err.message === 'Invalid token' || err.message === 'No token provided') {
      toast.show('Session expired. Please log in again.', 'critical');
      clearToken();
    }
  });

  return socket;
}

// ===================== Go Home =====================
// "Add a button that takes the character to home."
//
// It is a real action, not a decoration:
//   · the destination comes from the server's housing state, not from a guess;
//   · the player is placed at the door of the property they actually live in
//     and walks in through the same entry path as any other door;
//   · a player who owns nothing gets a button that says so and is visibly
//     disabled, rather than a button that quietly does nothing.
//
// The interior is the residential build for that listing (see propertyInteriors
// in world/interiorData.js), so "home" is a place with a bed and a kitchen, not
// a coordinate.

/** The interior id for a housing listing. */
function homeInteriorId(propertyId) {
  return `in-prop-${propertyId}`;
}

/** Is the player standing in this interior right now? */
function isAtHome(propertyId) {
  return interiors.isInside && interiors.activeId === homeInteriorId(propertyId);
}

/**
 * Take the character home.
 * @param {object} [opts]
 * @param {boolean} [opts.silent] suppress the toasts (tests, harness)
 * @returns {Promise<{ok:boolean, why?:string, name?:string}>}
 */
async function goHome({ silent = false } = {}) {
  const say = (msg, kind = 'info') => { if (!silent) toast.show(msg, kind); };

  if (!authState.token || !authState.user) {
    say('Sign in to go home', 'warning');
    return { ok: false, why: 'not-signed-in' };
  }

  propertyPanel.setToken(authState.token);
  const home = await propertyPanel.fetchHome();
  actionBar.setHomeState(home);

  if (!home) {
    say('🏚️ You have nowhere to live yet — open Property to rent or buy a home', 'warning');
    return { ok: false, why: 'no-home' };
  }

  const interiorId = homeInteriorId(home.id);
  if (!interiors.defs.has(interiorId)) {
    say(`🏠 ${home.name} has no interior — that is a bug, not a home`, 'warning');
    return { ok: false, why: 'no-interior' };
  }

  if (isAtHome(home.id)) {
    say(`🏠 You are already home at ${home.name}`, 'info');
    return { ok: true, already: true, name: home.name };
  }

  // Already inside somewhere else? Step outside first, so the door logic and the
  // return position stay consistent.
  if (interiors.isInside) interiors.leave();

  const door = interiors.doors.find((d) => d.interiorId === interiorId);
  if (door) {
    avatar.position.set(door.x, 0, door.z);
    avatar.rotation.y = door.rotY || 0;
    interiors.nearbyDoor = door;
    controller.setFacing?.(door.rotY || 0);
  }

  const entered = interiors.enter(interiorId);
  if (!entered) {
    say(`🏠 Could not get into ${home.name}`, 'warning');
    return { ok: false, why: 'enter-failed', name: home.name };
  }

  say(`🏠 Home sweet home — ${home.name}`, 'info');
  return { ok: true, name: home.name, interiorId };
}

// The housing listing doors are locked unless the player lives there.
interiors.setPropertyCheck((propertyId) => propertyPanel.isHome(propertyId));
interiors.onLocked = (door) => {
  const name = door.name || 'this house';
  toast.show(`🔒 ${name} belongs to someone else. Rent or buy it from Property.`, 'warning');
};

// The button's disabled state follows PropertyPanel.onHomeChange, which fires on
// every successful housing response — no polling, no guessing.

// ===================== Action bar (UI) =====================
// One thumb-reachable row for every panel, plus camera and graphics toggles.
const actionBar = new ActionBar({
  onAction: (id) => {
    switch (id) {
      case 'home': goHome(); break;
      case 'jobs': jobBoard.toggle(); break;
      case 'missions': missions.toggle(); break;
      case 'places': map.openFull(); break;
      case 'activities': activityPanel.toggle(); break;
      case 'property': propertyPanel.toggle(); break;
      case 'garage': vehiclesPanel.toggle(); break;
      case 'bag': inventoryPanel.toggle(); break;
      case 'character': characterPanel.toggle(); break;
      case 'leaderboard': leaderboard.toggle(); break;
      case 'menu': pauseMenu.open(); break;
      case 'camera': {
        if (interiors.isInside) {
          toast.show('Camera is fixed indoors', 'warning');
          break;
        }
        const mode = controller.cycleCameraMode();
        toast.show(mode === 'iso' ? 'Isometric camera' : 'Follow camera', 'info');
        break;
      }
      case 'quality': {
        const order = ['high', 'medium', 'low'];
        const next = order[(order.indexOf(postfx.quality) + 1) % order.length];
        postfx.setQuality(next);
        toast.show(`Graphics: ${next}`, 'info');
        break;
      }
      default: break;
    }
  },
  getPlaces: () => interiors.listDoors(),
  getPlayerPosition: () => ({ x: avatar.position.x, z: avatar.position.z }),
});

// Start out honest: if the panel has not loaded yet, the player's home is
// unknown and the button says "no home yet" until the server says otherwise.
actionBar.setHomeState(propertyPanel.home);
if (authState.token) {
  propertyPanel.setToken(authState.token);
  propertyPanel.fetchHome().then((home) => actionBar.setHomeState(home)).catch(() => {});
}

// ===================== Open world: NPCs, vehicles, panels =====================
// Everything below shares one player position, one toast queue and one set of
// server tokens, so a dialogue, a panel and the HUD can never disagree.

const dialogueUI = new DialogueUI();

const driveHUD = new DriveHUD();
const objectiveTracker = new ObjectiveTracker();

let vehiclePromptShown = false;

// Street traffic: parked cars along every kerb plus cars actually driving the
// grid, obeying the junction signals.
const traffic = new TrafficSystem();
const streetAssets = installStreetAssets(assets, { traffic, scene });
scene.add(traffic.group);

const vehicles = new VehicleSystem({
  scene,
  avatar,
  controller,
  collisionBoxes: city.getCollisionBoxes(),
  getPosition: () => ({
    x: interiors.isInside ? avatar.position.x : avatar.position.x,
    z: avatar.position.z,
    rot: controller.facing,
  }),
  onToast: (msg, type) => toast.show(msg, type),
  onSpeed: (kph, vehicle) => driveHUD.show(kph, vehicle),
  onFuel: (litres, tank) => driveHUD.setFuel(litres, tank),
  onPrompt: (vehicle) => {
    if (!vehicle) {
      if (vehiclePromptShown) {
        document.querySelector('.vehicle-prompt')?.classList.add('hidden');
        vehiclePromptShown = false;
      }
      return;
    }
    let el = document.querySelector('.vehicle-prompt');
    if (!el) {
      el = document.createElement('div');
      el.className = 'npc-prompt vehicle-prompt hidden';
      el.innerHTML = '<span class="npc-key">F</span><span class="npc-text"></span>';
      el.addEventListener('click', () => vehicles.enter());
      document.body.appendChild(el);
    }
    el.querySelector('.npc-text').textContent =
      `Drive the ${vehicle.def?.name || 'vehicle'} (${Math.round(vehicle.fuel)} L)`;
    el.classList.remove('hidden');
    vehiclePromptShown = true;
  },
});

// Driving must collide with the street traffic too, not just with buildings.
vehicles.getDynamicObstacles = () => traffic.getObstacles();

const inventoryPanel = new InventoryPanel({
  onToast: (msg, type) => toast.show(msg, type),
  onNeeds: () => {},
});

const missions = new MissionJournal({
  onToast: (msg, type) => toast.show(msg, type),
  onTracker: (list) => objectiveTracker.update(list),
  onNavigate: (poi) => navigation.navigateTo(poi),
});

const characterPanel = new CharacterPanel({
  onToast: (msg, type) => toast.show(msg, type),
  getNeeds: () => lastPlayerState,
  getLook: () => ({ ...avatar.look }),
  // Change the character while wearing it: the preview IS the player's avatar,
  // so there is nothing to reconcile when the panel closes.
  applyLook: (patch) => {
    avatar.setLook(patch);
    return { ...avatar.look };
  },
  saveLook: async (look) => {
    if (!authState.token) return { error: 'Not signed in' };
    const res = await saveAppearance(authState.token, {
      skin_color: look.skin,
      outfit_color: look.top,
      bottom_color: look.bottom,
      hair_style: look.hair,
      hair_color: look.hairColour,
      body_type: look.body,
      outfit_id: look.outfit,
    });
    if (res.user) {
      authState.user = res.user;
      applyUserToAvatar(res.user);
    }
    return res;
  },
});

// ===================== Inside buildings: stations =====================
// Furniture you can stand at and use. This is what turns the interiors from
// rooms you look at into places you do things in: sleep at home, cook at the
// hob, shop at the till, check in at the airport, board the flight.
// The meter cupboard behind the home's meter station.
const utilitiesPanel = new UtilitiesPanel({
  getToken: () => authState.token,
  onToast: (msg, type) => toast.show(msg, type),
});

// The faction matrix. Heat has to be visible and payable-off, or being wanted is
// just a number in a table.
const wantedPanel = new WantedPanel({
  getToken: () => authState.token,
  onToast: (msg, type) => toast.show(msg, type),
  onChanged: (wanted) => hud.setWanted(wanted),
});

// The badge is the way in: the heat in the top bar opens the whole matrix.
hud.wantedEl?.addEventListener('click', () => wantedPanel.toggle());

/**
 * Pull the wanted matrix from the server and paint it.
 *
 * Polled rather than pushed: the socket broadcast carries positions and needs,
 * not the wanted record, and heat changes slowly enough (decay is measured in
 * minutes) that a ten-second poll is honest and cheap. A failure leaves the
 * last known badge alone rather than lying that the player is clean.
 */
async function refreshWanted() {
  if (!authState.token) return;
  try {
    const data = await getWanted(authState.token);
    hud.setWanted(data.wanted);
    if (wantedPanel.open) {
      wantedPanel.data = data;
      wantedPanel.render();
    }
    // 3★ and above: the fronts will not serve you. Say so once, in the
    // server's words, so a refused purchase is never a mystery.
    if (data.serviceRefused && !refreshWanted._warned) {
      refreshWanted._warned = true;
      toast.show(data.refusalReason, 'error');
    } else if (!data.serviceRefused) {
      refreshWanted._warned = false;
    }
  } catch {
    // Offline or logged out — leave the badge as it was.
  }
}

const venuePanel = new VenuePanel({
  getToken: () => authState.token,
  onToast: (msg, type) => toast.show(msg, type),
  // The server broadcasts the authoritative activity state a moment later;
  // listening to it is the only thing that should move the HUD timer.
  onActivityStarted: () => {},
  onEnterInterior: (interiorId) => interiors.enterFromInside(interiorId),
  onOpenAppearance: () => {
    characterPanel.show();
    toast.show('👕 Wardrobe — change what you are wearing, then save', 'info');
  },
  onOpenInventory: () => inventoryPanel.toggle(),
  onOpenUtilities: () => utilitiesPanel.show(),
  // A shoplift changes the matrix; paint it from the crime's own answer, which
  // is the server's post-crime state.
  onWantedChanged: (wanted) => {
    if (wanted) hud.setWanted(wanted);
    refreshWanted();
  },
  onNeedsChanged: () => {
    // The socket broadcasts needs a moment later; re-paint from the last known
    // state so the shop's cash figure is right immediately.
    if (lastPlayerState) hud.update(lastPlayerState);
  },
});

// E at a station opens the panel for it.
interiors.onStation = (station) => {
  venuePanel.show(station, interiors.activeId);
};

/** Close the venue panel if the player walks away from the station. */
function updateVenuePanel() {
  if (!venuePanel.open) return;
  if (!interiors.isInside || !interiors.nearbyStation
    || interiors.nearbyStation.id !== venuePanel.station?.id) {
    venuePanel.hide();
  }
}

const vehiclesPanel = new VehiclesPanel({
  vehicles,
  onToast: (msg, type) => toast.show(msg, type),
  onWalkTo: (poi) => navigation.navigateTo({ name: 'Your vehicle', x: poi.x, z: poi.z, kind: 'vehicle' }),
});

const controlsGuide = new ControlsGuide({});

// The NPC system gets the same callbacks the rest of the game uses.
const npcs = new NPCSystem({
  scene,
  nav,
  getPlayer: () => ({ x: avatar.position.x, z: avatar.position.z }),
  dialogueUI,
  onToast: (msg, type) => toast.show(msg, type),
  actions: {
    openJobs: () => jobBoard.toggle(),
    openMap: () => map.openFull(),
    navigateTo: (poi) => navigation.navigateTo(poi),
    service: async (serviceId) => {
      if (!authState.token) return false;
      const res = await npcService(authState.token, serviceId);
      if (res.error) {
        toast.show(res.error, 'warning');
        return false;
      }
      toast.show(res.text, 'success');
      return true;
    },
  },
});

const pauseMenu = new PauseMenu({
  onResume: () => controller.setPaused(false),
  onControls: () => controlsGuide.show(),
  onTutorial: () => tutorial.show({ username: authState.user?.username || 'player', force: true }),
  onLogout: () => sessionMenu.open(),
  onToast: (msg, type) => toast.show(msg, type),
  getQuality: () => postfx.quality,
  setQuality: (q) => {
    postfx.setQuality(q);
    toast.show(`Graphics: ${q}`, 'info');
  },
  cycleCamera: () => {
    controller.cycleViewMode();
    updateCameraHud();
    return controller.viewLabel;
  },
  // Sound settings, owned by the audio engine.
  getAudio: () => ({ ...audio.settings }),
  setAudio: (bus, value) => audio.setVolume(bus, value),
  toggleMute: () => audio.toggleMute(),
  // Live renderer figures for the status tab — measured, never estimated.
  getStatus: () => ({
    fps: lastFps,
    drawCalls: renderer.info?.render?.calls,
    players: remotePlayers.count + 1,
    view: controller.viewLabel,
    quality: postfx.quality,
  }),
  // Look settings, edited from the pause menu.
  getCameraLabel: () => controller.viewLabel,
  getLook: () => ({ ...controller.look }),
  setLook: (next) => {
    controller.setLookSettings(next);
    saveLookSettings();
  },
});

// Track the newest player state for panels that show live needs.
let lastPlayerState = null;
let districtCheckAccumulator = 0;
let visitedDistricts = new Set();

/** Push the player's district to the server (once per new district). */
async function checkDistrict() {
  if (!authState.token || interiors.isInside) return;
  const ids = [
    { id: 'mushin', x: -55, z: 55 },
    { id: 'yaba', x: 55, z: 55 },
    { id: 'victoria', x: -55, z: -55 },
    { id: 'lekki', x: 55, z: -55 },
  ];
  const { x, z } = avatar.position;
  const inside = ids.find((d) => Math.abs(x - d.x) < 25 && Math.abs(z - d.z) < 25);
  if (!inside || visitedDistricts.has(inside.id)) return;
  visitedDistricts.add(inside.id);
  const res = await markDistrictVisit(authState.token);
  if (res.ok && res.district) {
    toast.show(`📍 Entered ${res.district}`, 'info');
  }
}

/** One place to refresh everything that reads server state. */
async function refreshWorldData() {
  missions.refresh();
  vehicles.load();
}

// E is a shared key: doors first, then interaction points, then people.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || e.repeat || !authState.token) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (dialogueUI.isOpen || vehicles.driving) return;
  if (interiors.isInside || interiors.nearbyDoor) return;   // InteriorSystem handles E
  if (interactions.panelOpen || interactions.nearbyPoint) return; // so does InteractionSystem
  if (npcs.nearby) npcs.talkToNearby();
});


/** Point every world panel and system at the live token, then load its data. */
function wireWorld(token) {
  inventoryPanel.setToken(token);
  missions.setToken(token);
  characterPanel.setToken(token);
  vehiclesPanel.setToken(token);
  pauseMenu.setToken(token);
  vehicles.setToken(token);
  refreshWorldData();

  // Wanted matrix: read it once on entry so the badge is right immediately, then
  // keep it fresh. Ten seconds is well under the six-minute decay step, so the
  // badge never lags behind a real change.
  refreshWanted();
  if (!wireWorld._wantedTimer) {
    wireWorld._wantedTimer = setInterval(refreshWanted, 10_000);
  }
}

/** One-time first-login guide, then a nudge towards the first mission. */
function onWorldReady(user) {
  const shown = controlsGuide.showOnce(user?.username);
  if (!shown) {
    toast.show('Press M for the map, J for missions, F for a vehicle', 'info');
  }
}

async function tryRestoreSession() {
  const token = getToken();
  if (!token) return false;
  const result = await getMe(token);
  if (result.error || !result.user) {
    clearToken();
    return false;
  }
  authState.token = token;
  authState.user = result.user;
  applyUserToAvatar(result.user);
  hud.update(result.user);
  hud.show();
  chat.show();
  actionBar.show();
  map.show();
  wireWorld(token);
  connectGameSocket(token);
  onWorldReady(result.user);
  showTutorialIfNew(result.user);
  return true;
}

// First-run guide. Shown once per account, and reopenable from the pause menu.
const tutorial = new Tutorial({
  onControls: () => controlsGuide.show(),
  onFinish: () => toast.show('Tip: press F1 any time for the full controls', 'info'),
});

function showTutorialIfNew(user) {
  tutorial.show({ username: user?.username || 'player' });
}

// Initialise auth after the scene is set up
(async () => {
  const restored = await tryRestoreSession();
  if (!restored) {
    const authScreen = new AuthScreen((token, user, look) => {
      authState.token = token;
      authState.user = user;
      // Placement and camera first — applyUserToAvatar also puts the character
      // on their spawn and points them up the street. It used to be skipped
      // whenever the creator supplied a look, which is every sign-up, so a new
      // player spawned at the world origin facing nowhere.
      applyUserToAvatar(user);
      // The creator's choices win over anything derived: this is the character
      // the player just built, and the server already stored it.
      if (look) avatar.setLook(look);
      hud.update(user);
      hud.show();
      chat.show();
      actionBar.show();
      map.show();
      wireWorld(token);
      connectGameSocket(token);
      onWorldReady(user);
      showTutorialIfNew(user);
    });
    authScreen.show();
  }
})();

// ===================== Visual tuning panel (F2) =====================
// Lazily created: lil-gui is a separate chunk, so players who never press F2
// never download it. This is the tool that makes visual decisions reviewable
// by someone who can actually see the render.
let debugPanel = null;
let debugPanelLoading = false;

async function toggleDebugPanel() {
  if (debugPanel) {
    debugPanel.toggle();
    return;
  }
  if (debugPanelLoading) return;
  debugPanelLoading = true;
  debugPanel = await createDebugPanel({
    renderer,
    scene,
    postfx,
    skyEnv,
    shadowRig,
    traffic,
    dayNight,
    sunLight: directionalLight,
    onQualityChange: (q) => toast.show(`Graphics: ${q}`, 'info'),
    onToast: (msg, type) => toast.show(msg, type),
  });
  debugPanelLoading = false;
  if (debugPanel) debugPanel.toggle();
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F2') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  toggleDebugPanel();
});

// ===================== Resize handler =====================
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ===================== Loading screen =====================
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const loadingText = document.getElementById('loading-text');

let progress = 0;
let loadingDone = false;

const progressTimer = setInterval(() => {
  if (loadingDone) return;
  progress = Math.min(progress + Math.random() * 18, 90);
  progressFill.style.width = `${Math.floor(progress)}%`;
  loadingText.textContent = 'Loading...';
}, 120);

function finishLoading() {
  if (loadingDone) return;
  loadingDone = true;
  clearInterval(progressTimer);
  progressFill.style.width = '100%';
  loadingText.textContent = 'Ready!';
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
  }, 350);
}

// ===================== FPS counter =====================
const fpsDisplay = document.getElementById('fps-counter');
let frameCount = 0;
let lastFpsUpdate = performance.now();
let lastFps = 60;
let lastWeatherKey = '';
const warnedNeeds = new Set();
const NEED_FIX = {
  hunger: 'food stall or restaurant',
  energy: 'bed — go home',
  hygiene: 'shower',
  bladder: 'toilet',
  fun: 'activity',
  social: 'person to talk to',
};

// ===================== Clock =====================
const clock = new THREE.Clock();

// ===================== Position reporting (Step 9) =====================
let missionRefreshTimer = 0;
let positionAccumulator = 0;
const POSITION_INTERVAL = 0.1; // seconds between position packets

/**
 * Emit to the game socket without throwing if it is mid-close.
 *
 * socket.io throws "WebSocket is already in CLOSING or CLOSED state" if you
 * emit during teardown, and a 60-per-second position loop is exactly the kind of
 * thing that hits that window when a tab is closed or the server restarts.
 */
function socketEmit(event, payload) {
  if (!gameSocket) return false;
  const state = gameSocket.connected ? 'open' : (gameSocket.io?.engine?.readyState || 'closed');
  if (!gameSocket.connected && state !== 'opening') return false;
  try {
    gameSocket.emit(event, payload);
    return true;
  } catch {
    return false;
  }
}

function sendPosition(deltaTime) {
  if (!gameSocket || !gameSocket.connected) return;

  positionAccumulator += deltaTime;
  if (positionAccumulator < POSITION_INTERVAL) return;
  positionAccumulator = 0;

  const p = interiors.getReportPosition();
  socketEmit('player:move', {
    x: p.x,
    z: p.z,
    rot: p.rot,
    moving: p.moving,
    // Naming the vehicle lets the server apply the (higher) vehicle speed cap.
    // It verifies ownership itself, so this is a claim, not a permission.
    vehicle: vehicles.driving ? vehicles.driving.id : undefined,
    // Which building we are inside, so the server can refuse a purchase from
    // outside the shop that sells it (see server/config/venueConfig.js).
    venue: interiors.isInside ? interiors.activeId : null,
  });
}

// ===================== Render loop =====================
let elapsed = 0;

/**
 * What ground is under the player, for footstep sound and for rain splashes.
 * Indoors it is the room's own floor; outside it is whatever the block is paved
 * with — asphalt in the roadway, pavement on the kerb, grass in the courtyards.
 */
function surfaceUnderfoot() {
  if (interiors.isInside) {
    const floor = interiors.active?.def?.floor;
    return floor === 'wood' ? 'wood' : 'tile';
  }
  const p = avatar.position;
  // The street plan knows exactly where the roadway is.
  try {
    if (onRoadway(p.x, p.z, 0)) return 'asphalt';
    if (onRoadway(p.x, p.z, 3.2)) return 'pavement';
  } catch { /* street plan unavailable: fall through */ }
  return 'grass';
}

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = clock.getDelta();
  elapsed += deltaTime;

  // FPS calculation (updates display every 500 ms)
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    lastFps = fps;
    fpsDisplay.textContent = `FPS: ${fps}`;
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update player movement, animation & camera
  controller.update(deltaTime);

  // Smoothly interpolate other players toward their last known positions
  remotePlayers.update(deltaTime);

  // Walk-up prompts for banks, shops and ATMs — city furniture, so they only
  // exist outside. Indoors, the street POIs are all still "nearby" because the
  // player reports the door's city position, which is how an ATM prompt ended
  // up on an airport apron.
  if (interiors.isInside) {
    if (interactions.nearbyPoint || interactions.panelOpen) interactions.clear?.();
  } else {
    interactions.update();
  }

  // People and vehicles. Weather reaches the crowd before they move.
  npcs.setWeather({ raining: weather.raining, intensity: weather.intensity });
  npcs.update(deltaTime);
  // The crowd is city furniture too: inside a building or out on the apron the
  // street NPCs are not there, and neither are their prompts.
  npcs.setActive?.(!interiors.isInside);
  traffic.update(deltaTime, elapsed, avatar.position);
  vehicles.update(deltaTime);
  controller.setDynamicObstacles([
    ...npcs.getObstacles(),
    ...vehicles.getObstacles(),
    ...traffic.getObstacles(),
  ]);

  // District discovery, sampled twice a second
  districtCheckAccumulator += deltaTime;
  if (districtCheckAccumulator > 0.5) {
    districtCheckAccumulator = 0;
    checkDistrict();
  }

  // Keep the mission tracker honest — the server re-derives every state
  missionRefreshTimer += deltaTime;
  if (missionRefreshTimer > 15) {
    missionRefreshTimer = 0;
    if (authState.token) missions.refresh();
  }

  // Advance the sky, then let the lighting follow it.
  // DayNight sets direction/colours/fog; SkyEnvironment rebuilds the IBL probe
  // only when the sun has actually moved; ShadowRig re-centres the shadow box
  // on the player and snaps it to the texel grid.
  // Weather first: it is an input to the lighting and to the soundscape.
  weather.update(deltaTime, { focus: avatar.position, indoors: interiors.isInside });
  dayNight.setWeather(weather.overlay);
  dayNight.update(deltaTime);
  skyEnv.update(dayNight.elevation);
  nightLights.update(deltaTime, { player: avatar.position, daylight: dayNight.daylight });
  // Bloom is the night effect: a high threshold by day so the sky stays a sky,
  // a low one after dark so every lit window and lamp head haloes.
  postfx.setNight(nightLights.nightFactor);
  updateSkyForHour(dayNight.phase * 24);
  if (pendingSkyRefresh) {
    pendingSkyRefresh = false;
    activeSkyBand = null;
    updateSkyForHour(dayNight.phase * 24);
  }
  shadowRig.update(avatar.position, dayNight.sunDir);

  // Report our position to the server ~10 times a second
  sendPosition(deltaTime);

  // Door proximity prompts + station prompts + enter/leave handling
  interiors.update(deltaTime);
  updateVenuePanel();

  // Route guidance + arrival detection (outdoors only — indoors the map shows
  // the building you are standing in)
  if (!interiors.isInside) navigation.update(deltaTime);

  // A need that has just become critical gets exactly one warning, and only
  // gets warned again after it has recovered.
  for (const need of hud.criticalNeeds()) {
    if (!warnedNeeds.has(need)) {
      warnedNeeds.add(need);
      audio.play('need-warning');
      toast.show(`⚠ ${need} is critical — find a ${NEED_FIX[need] || 'fix'}`, 'warning');
    }
  }
  for (const need of [...warnedNeeds]) {
    if (!hud.criticalNeeds().includes(need)) warnedNeeds.delete(need);
  }

  // The camera badge reads real controller state, so it can never lie.
  cameraHud.update();

  // Weather chip: icon + state, refreshed only when it changes.
  const weatherKey = `${weather.raining}:${Math.round(weather.intensity * 4)}:${dayNight.isNight}`;
  if (weatherKey !== lastWeatherKey) {
    lastWeatherKey = weatherKey;
    hud.setWeather({ raining: weather.raining, intensity: weather.intensity }, dayNight.isNight);
  }

  // Sound follows the player: footsteps match the surface and the speed, the
  // ambience bed matches the place, and the hour decides night from day.
  audio.update(deltaTime, {
    moving: controller.isMoving,
    speed: controller.speed || 0,
    grounded: controller.grounded,
    surface: surfaceUnderfoot(),
    hour: dayNight.phase * 24,
    inside: interiors.isInside,
    raining: weather.raining,
    place: interiors.place,
  });

  // Live tuning panel, if it has been opened
  if (debugPanel) debugPanel.update(deltaTime);

  // Render whichever scene is live, through the post pipeline
  if (postfx.scene !== activeScene) postfx.setScene(activeScene);
  postfx.render();

  // Hide loading screen after first rendered frame
  finishLoading();
}

animate();

// ===================== Debug / harness hook =====================
// A single object the screenshot harness (and anyone with the console open) can
// use to look at the live game: where the player is, what the renderer is doing,
// and enough handles to drive it. It is read-mostly on purpose — nothing here is
// a gameplay shortcut, it is a window.
globalThis.__nl = {
  get avatar() { return avatar; },
  get controller() { return controller; },
  get interiors() { return interiors; },
  get dayNight() { return dayNight; },
  get weather() { return weather; },
  get audio() { return audio; },
  get postfx() { return postfx; },
  get renderer() { return renderer; },
  get scene() { return activeScene; },
  get camera() { return camera; },
  get hud() { return hud; },
  get city() { return city; },
  get venuePanel() { return venuePanel; },
  get utilitiesPanel() { return utilitiesPanel; },
  get wantedPanel() { return wantedPanel; },
  /** Re-read the wanted matrix now (tests, and after a crime). */
  refreshWanted() { return refreshWanted(); },
  /** Stations in the room the player is standing in. */
  stations() {
    return (interiors.stations || []).map((st) => ({
      id: st.id, label: st.label, icon: st.icon, x: st.x, z: st.z, radius: st.radius,
      actions: st.actions.map((a) => ({ kind: a.kind, id: a.id, label: a.label, venue: a.venue })),
    }));
  },
  /** Open a station by id (used by the tests and the screenshot harness). */
  useStation(stationId, actionIndex = 0) {
    const st = (interiors.stations || []).find((x) => x.id === stationId);
    if (!st) return { ok: false, why: `no station "${stationId}"` };
    venuePanel.show(st, interiors.activeId);
    if (actionIndex >= 0) venuePanel._run(String(actionIndex));
    return { ok: true, station: st.id, actions: st.actions.length };
  },
  get assets() { return assets; },
  get vehicles() { return vehicles; },
  get traffic() { return traffic; },
  /** The night light pool: how many lamps are lit, and how dark it is. */
  get nightLights() { return nightLights; },
  /**
   * The bridge profiles, the deck thickness and the cars currently crossing —
   * a read-only window for the screenshot harness and for anyone who wants to
   * check that traffic really is climbing the ramps.
   */
  get bridgeDebug() {
    return {
      paths: BRIDGE_PATHS,
      thickness: DECK_THICKNESS,
      surfaceAt: bridgeSurfaceAt,
      cars: () => (traffic.bridgeCars || []).map((c) => ({
        kind: c.kind, u: Number(c.u.toFixed(3)),
        x: Number(c.x.toFixed(2)), y: Number(c.y.toFixed(2)), z: Number(c.z.toFixed(2)),
      })),
    };
  },
  /** What the asset pipeline managed to load, and what it installed. */
  assetReport() {
    return {
      ...assets.summary,
      installedTextures,
      installedSkies,
      street: streetAssets,
      retile: retileStats,
      models: [...assets.models.keys()],
      trafficModels: traffic.modelMeshes ? [...traffic.modelMeshes.keys()] : [],
      sky: skyEnv.skyName,
      treesReal: !!city.treeStats?.real,
    };
  },
  /** A one-line summary of what the renderer and the world are doing. */
  report() {
    return {
      fps: lastFps,
      drawCalls: renderer.info?.render?.calls ?? null,
      triangles: renderer.info?.render?.triangles ?? null,
      geometries: renderer.info?.memory?.geometries ?? null,
      phase: Number(dayNight.phase?.toFixed(4)),
      hour: Number((dayNight.phase * 24).toFixed(2)),
      night: dayNight.isNight,
      elevation: Number(dayNight.elevation?.toFixed(3)),
      raining: weather.raining,
      rain: Number(weather.intensity.toFixed(2)),
      inside: interiors.isInside,
      place: interiors.place,
      view: controller.viewLabel,
      position: {
        x: Number(avatar.position.x.toFixed(2)),
        y: Number(avatar.position.y.toFixed(2)),
        z: Number(avatar.position.z.toFixed(2)),
      },
      quality: postfx.quality,
      audio: audio.ctx ? 'running' : 'suspended',
    };
  },
  /** Force the clock to a given hour (0–24) for a screenshot. */
  setHour(h) {
    const phase = ((Number(h) || 0) % 24) / 24;
    dayNight._currentPhase = () => phase;
    dayNight.update(0.016);
    return phase;
  },
  /**
   * Walk the real path into a venue: stand at its door, then interact.
   * The harness uses this instead of teleporting into the middle of a room, so
   * a screenshot also proves the door exists and the interior builds.
   * @param {string} id - interior id ('in-market') or type ('market')
   */
  enterInterior(id) {
    const def = [...interiors.defs.values()].find((d) => d.id === id || d.type === id);
    if (!def) return { ok: false, why: `no interior "${id}"` };
    const door = interiors.doors?.find?.((d) => d.interiorId === def.id);
    if (door) {
      avatar.position.set(door.x, 0, door.z);
      avatar.rotation.y = door.rotY || 0;
      interiors.nearbyDoor = door;
    }
    const entered = interiors.enter(def.id);
    return { ok: entered, id: def.id, name: def.name, type: def.type, door: door ? { x: door.x, z: door.z } : null };
  },

  /** Re-read the housing state from the server (what the Property panel does). */
  refreshProperties: () => propertyPanel._load(),

  /** The player's current home, as the server last reported it. */
  propertyHome: () => propertyPanel.home,

  /** Go Home — the same action the button and 'H' fire. */
  goHome: (opts) => goHome(opts),

  /** Leave the current interior, back to the street. */
  exitInterior() { return interiors.leave(); },

  /** Every interior the game knows about. */
  interiorsList() {
    return [...interiors.defs.values()].map((d) => ({ id: d.id, name: d.name, type: d.type, building: d.buildingId }));
  },

  /** Put the player somewhere, clearing the physics state. */
  teleport(x, z, rotY = avatar.rotation.y) {
    avatar.position.set(x, 0, z);
    avatar.rotation.y = rotY;
    // The controller reads the avatar's position directly, so nothing needs
    // syncing; clear the velocity so the teleport does not carry momentum.
    if ('velocity' in controller) controller.velocity.set?.(0, 0, 0);
    return { x, z };
  },
};
