// client/src/render/DebugPanel.js
// Live visual-tuning panel (F2).
//
// This exists because of an honest limitation: the machine this game was built
// on has no GPU and no browser, so nobody writing the shading code can actually
// see the result. Rather than guessing at "looks better", every realism effect
// is exposed as a switch and a slider here, so the person who *can* see the
// screen decides — and can immediately see what each pass contributes by
// turning it off and on.
//
// lil-gui is loaded with a dynamic import, so it lands in its own chunk and is
// never downloaded unless the panel is actually opened.

let guiPromise = null;

async function loadGUI() {
  if (!guiPromise) guiPromise = import('lil-gui').then((m) => m.GUI);
  return guiPromise;
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {object} o.postfx
 * @param {object} o.skyEnv
 * @param {object} o.shadowRig
 * @param {object} o.dayNight
 * @param {THREE.DirectionalLight} o.sunLight
 * @param {function} [o.onQualityChange]
 * @param {function} [o.onToast]
 * @returns {Promise<{ toggle: function, destroy: function } | null>}
 */
export async function createDebugPanel({
  renderer, scene, postfx, skyEnv, shadowRig, dayNight, sunLight,
  traffic = null,
  onQualityChange, onToast,
}) {
  let GUI;
  try {
    GUI = await loadGUI();
  } catch (err) {
    console.warn('Debug panel unavailable:', err);
    return null;
  }

  const state = {
    // Environment
    skyVisible: true,
    imageBasedLighting: true,
    turbidity: skyEnv.params.turbidity,
    rayleigh: skyEnv.params.rayleigh,
    // Atmosphere
    fogEnabled: true,
    fogDensity: dayNight.scene.fog ? dayNight.scene.fog.density : 0.0045,
    // Shadows
    shadows: true,
    shadowBound: shadowRig.config.bound,
    shadowMapSize: shadowRig.config.mapSize,
    // Occlusion
    ambientOcclusion: postfx.quality === 'high',
    aoRadius: 1.1,
    aoIntensity: postfx.gtaoPass ? postfx.gtaoPass.blendIntensity : 0.9,
    // Image
    exposure: renderer.toneMappingExposure,
    bloom: postfx.bloomPass ? postfx.bloomPass.strength : 0.36,
    quality: postfx.quality,
    // Stats (read-only)
    calls: 0,
    triangles: 0,
    fps: 0,
  };

  const gui = new GUI({ title: 'NewLife · visuals (F2)' });

  const env = gui.addFolder('Environment');
  env.add(state, 'skyVisible').name('Sky (baked cubemap)').onChange((v) => skyEnv.setSkyVisible(v));
  env.add(state, 'imageBasedLighting').name('Sky IBL').onChange((v) => skyEnv.setEnvironmentEnabled(v));
  env.add(state, 'turbidity', 1, 20, 0.1).name('Turbidity (haze)')
    .onChange((v) => skyEnv.setParams({ turbidity: v }));
  env.add(state, 'rayleigh', 0, 4, 0.05).name('Rayleigh (sunset red)')
    .onChange((v) => skyEnv.setParams({ rayleigh: v }));

  const atmo = gui.addFolder('Atmosphere');
  atmo.add(state, 'fogEnabled').name('Fog').onChange((v) => {
    if (!dayNight.scene.fog) return;
    // Keep the object, just neutralise its density when disabled.
    dayNight.fogDensityOverride = v ? null : 0;
  });
  atmo.add(state, 'fogDensity', 0, 0.03, 0.0005).name('Fog density')
    .onChange((v) => { dayNight.fogDensityOverride = v; });

  if (traffic) {
    // Read-only counts, so the panel can prove traffic exists without a hunt.
    const t = traffic.getStats();
    state.parkedCars = t.parked;
    state.movingCars = t.moving;
    state.carDrawCalls = traffic.group.children.length;
    const cars = gui.addFolder('Traffic');
    cars.add(state, 'parkedCars').name('Parked cars').disable();
    cars.add(state, 'movingCars').name('Driving cars').disable();
    cars.add(state, 'carDrawCalls').name('Draw objects').disable();
  }

  const shadow = gui.addFolder('Shadows');
  shadow.add(state, 'shadows').name('Shadows').onChange((v) => shadowRig.setEnabled(v));
  shadow.add(state, 'shadowBound', 25, 130, 5).name('Half-extent (m)')
    .onChange((v) => shadowRig.configure({ bound: v }))
    .onFinishChange(() => refreshShadowInfo());
  shadow.add(state, 'shadowMapSize', [1024, 2048, 4096]).name('Map size')
    .onChange((v) => { shadowRig.configure({ mapSize: Number(v) }); refreshShadowInfo(); });

  const ao = gui.addFolder('Ambient occlusion');
  ao.add(state, 'ambientOcclusion').name('GTAO').onChange((v) => postfx.setAOEnabled(v));
  ao.add(state, 'aoRadius', 0.2, 3, 0.05).name('Radius (m)')
    .onChange((v) => postfx.gtaoPass?.updateGtaoMaterial({ radius: v }));
  ao.add(state, 'aoIntensity', 0, 2, 0.05).name('Intensity')
    .onChange((v) => { if (postfx.gtaoPass) postfx.gtaoPass.blendIntensity = v; });

  const image = gui.addFolder('Image');
  image.add(state, 'exposure', 0.4, 2.2, 0.01).name('Exposure')
    .onChange((v) => { renderer.toneMappingExposure = v; });
  image.add(state, 'bloom', 0, 1.5, 0.01).name('Bloom strength')
    .onChange((v) => { if (postfx.bloomPass) postfx.bloomPass.strength = v; });
  image.add(state, 'quality', ['high', 'medium', 'low']).name('Quality tier')
    .onChange((v) => {
      postfx.setQuality(v);
      if (onQualityChange) onQualityChange(v);
      // Re-sync the AO switch with whatever the tier just did.
      state.ambientOcclusion = postfx.gtaoPass?.enabled ?? false;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    });

  const stats = gui.addFolder('Stats (read-only)');
  stats.add(state, 'calls').name('Draw calls').listen().disable();
  stats.add(state, 'triangles').name('Triangles').listen().disable();
  stats.add(state, 'fps').name('FPS').listen().disable();

  const shadowInfo = {
    texel: `${(shadowRig.texelSize * 100).toFixed(1)} cm / texel`,
    envRebuilds: () => skyEnv.renderCount,
  };
  const shadowFolder = gui.addFolder('Shadow quality');
  shadowFolder.add(shadowInfo, 'texel').name('Texel size').listen().disable();
  shadowFolder.add(shadowInfo, 'envRebuilds').name('IBL rebuilds').listen().disable();

  function refreshShadowInfo() {
    shadowInfo.texel = `${(shadowRig.texelSize * 100).toFixed(1)} cm / texel`;
  }

  // Diagnostics the user can copy back for a bug report.
  const actions = {
    copyDiagnostics() {
      const snapshot = {
        quality: postfx.quality,
        renderer: { ...renderer.info.render },
        shadowTexelCm: Number((shadowRig.texelSize * 100).toFixed(2)),
        shadowBound: shadowRig.config.bound,
        shadowMapSize: shadowRig.config.mapSize,
        fogDensity: dayNight.scene.fog?.density,
        sunElevationDeg: Number((dayNight.elevation * 180 / Math.PI).toFixed(1)),
        daylight: Number(dayNight.daylight.toFixed(3)),
        exposure: renderer.toneMappingExposure,
        iblRebuilds: skyEnv.renderCount,
      };
      const text = JSON.stringify(snapshot, null, 2);
      navigator.clipboard?.writeText(text).catch(() => {});
      console.log('[NewLife diagnostics]', snapshot);
      if (onToast) onToast('Diagnostics copied to the clipboard', 'info');
    },
    reset() {
      location.reload();
    },
  };
  gui.add(actions, 'copyDiagnostics').name('Copy diagnostics');
  gui.add(actions, 'reset').name('Reset (reload)');

  gui.close();

  // Push live numbers into the panel without allocating per frame. Only does
  // work while the panel is actually on screen.
  let statTimer = 0;
  let visible = false;
  function update(dt) {
    if (!visible) return;
    statTimer += dt;
    if (statTimer < 0.5) return;
    statTimer = 0;
    const info = renderer.info.render;
    state.calls = info.calls;
    state.triangles = info.triangles;
    state.fps = Math.round(1 / Math.max(dt, 1e-3));
    state.fogDensity = dayNight.scene.fog?.density ?? state.fogDensity;
    refreshShadowInfo();
  }

  return {
    gui,
    state,
    update,
    toggle() {
      visible = !visible;
      if (visible) gui.show(); else gui.hide();
      return visible;
    },
    get isVisible() { return visible; },
    destroy() { gui.destroy(); },
  };
}
