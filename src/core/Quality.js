// Graphics presets + hardware based recommendation.
// Presets only change *how* the world is drawn / how dense it is, never the world itself.

export const PRESETS = {
  LOW: {
    label: 'LOW', pixelRatio: 0.75, antialias: false,
    shadows: false, shadowMapSize: 512,
    viewDistance: 380, detailRadius: 1, farRadius: 2,
    npcCount: 16, trafficCount: 10,
    textureSize: 1024, anisotropy: 1,
    bloom: false, nightLights: 0, treeShadows: false, rainDrops: 600, props: 0.5,
  },
  MEDIUM: {
    label: 'MEDIUM', pixelRatio: 1, antialias: true,
    shadows: true, shadowMapSize: 1024,
    viewDistance: 560, detailRadius: 1, farRadius: 3,
    npcCount: 30, trafficCount: 20,
    textureSize: 1024, anisotropy: 4,
    bloom: false, nightLights: 2, treeShadows: false, rainDrops: 1200, props: 0.8,
  },
  HIGH: {
    label: 'HIGH', pixelRatio: 1.5, antialias: true,
    shadows: true, shadowMapSize: 2048,
    viewDistance: 800, detailRadius: 2, farRadius: 5,
    npcCount: 46, trafficCount: 30,
    textureSize: 2048, anisotropy: 8,
    bloom: true, nightLights: 4, treeShadows: true, rainDrops: 2500, props: 1,
  },
  ULTRA: {
    label: 'ULTRA', pixelRatio: 2, antialias: true,
    shadows: true, shadowMapSize: 4096,
    viewDistance: 1100, detailRadius: 2, farRadius: 7,
    npcCount: 64, trafficCount: 40,
    textureSize: 2048, anisotropy: 16,
    bloom: true, nightLights: 6, treeShadows: true, rainDrops: 4000, props: 1,
  },
};

export const PRESET_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

/** Inspect the GPU / CPU / memory and return a recommended preset name + reasons. */
export function detectHardware() {
  const info = { gpu: 'unknown', cores: navigator.hardwareConcurrency || 4, memory: navigator.deviceMemory || 4 };
  let score = 0;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      info.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (e) { /* ignore */ }

  const g = String(info.gpu).toLowerCase();
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if (/swiftshader|llvmpipe|software|basic render/.test(g)) score -= 3;
  if (/rtx|radeon rx|rx [5-9]\d{3}|arc a|apple m[1-9] (pro|max|ultra)/.test(g)) score += 3;
  else if (/gtx|apple m[1-9]|radeon pro|quadro/.test(g)) score += 2;
  else if (/iris xe|radeon(tm)? graphics|adreno \(tm\) 7|mali-g7/.test(g)) score += 1;
  else if (/intel|uhd|hd graphics|mali|adreno/.test(g)) score += 0;
  if (info.cores >= 8) score += 1;
  if (info.cores <= 2) score -= 1;
  if (info.memory >= 8) score += 1;
  if (info.memory <= 2) score -= 1;
  if (mobile) score -= 2;
  if (!info.webgl2) score -= 1;

  let preset = 'MEDIUM';
  if (score <= -2) preset = 'LOW';
  else if (score >= 4) preset = 'ULTRA';
  else if (score >= 2) preset = 'HIGH';
  return { preset, score, info, mobile };
}

/** Settings persisted between sessions (separate from the game save). */
const KEY = 'leomathav_settings_v1';

export function loadSettings() {
  const hw = detectHardware();
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* ignore */ }
  return {
    preset: stored.preset || hw.preset,
    recommended: hw.preset,
    hardware: hw.info,
    dynamicResolution: stored.dynamicResolution ?? true,
    showFps: stored.showFps ?? false,
    englishSubs: stored.englishSubs ?? true,
    tamilVoice: stored.tamilVoice ?? true,
    volume: stored.volume ?? 0.7,
    sensitivity: stored.sensitivity ?? 1,
  };
}

export function saveSettings(s) {
  const { hardware, recommended, ...rest } = s;
  try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ }
}
