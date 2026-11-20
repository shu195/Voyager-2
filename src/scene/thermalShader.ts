import * as THREE from 'three';

export type ThermalZone =
  | 'rtg_core'
  | 'rtg_fin'
  | 'rtg_boom'
  | 'louver_radiator'
  | 'avionics_warm'
  | 'hydrazine_heated'
  | 'instrument_active'
  | 'mli_insulation'
  | 'space_cold';

export interface ThermalMaterialBank {
  zones: Record<ThermalZone, THREE.ShaderMaterial>;
  update: (elapsed: number) => void;
  dispose: () => void;
}

/**
 * Maps Voyager 2 physical operating temperatures (-215°C to +225°C) onto
 * a calibrated FLIR Ironbow false-color infrared palette with subtle emissivity
 * edge definition so every rib, louver blade, cooling fin, and bolt stays legible.
 */
const THERMAL_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mvPos = viewMatrix * worldPos;
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const THERMAL_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTempMin;
  uniform float uTempMax;
  uniform float uSpatialMode; // 0 = uniform, 1 = RTG axial/radial gradient, 2 = bus radial warmth
  uniform float uTime;
  uniform vec3 uRtgRoot;
  uniform vec3 uRtgTip;

  varying vec3 vNormalView;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;

  // Authentic FLIR Ironbow LUT: 0.0 (-215°C) -> 1.0 (+225°C)
  vec3 ironbow(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.02, 0.03, 0.14); // -215°C deep cosmic indigo
    vec3 c1 = vec3(0.11, 0.06, 0.36); // -140°C cold violet-blue
    vec3 c2 = vec3(0.42, 0.08, 0.56); // -60°C  thermal violet
    vec3 c3 = vec3(0.78, 0.16, 0.42); // +15°C  warm magenta
    vec3 c4 = vec3(0.96, 0.42, 0.10); // +95°C  hot orange
    vec3 c5 = vec3(1.00, 0.80, 0.18); // +170°C glowing amber-yellow
    vec3 c6 = vec3(1.00, 0.99, 0.90); // +225°C incandescent Pu-238 white

    if (t < 0.18) return mix(c0, c1, t / 0.18);
    if (t < 0.36) return mix(c1, c2, (t - 0.18) / 0.18);
    if (t < 0.54) return mix(c2, c3, (t - 0.36) / 0.18);
    if (t < 0.72) return mix(c3, c4, (t - 0.54) / 0.18);
    if (t < 0.88) return mix(c4, c5, (t - 0.72) / 0.16);
    return mix(c5, c6, (t - 0.88) / 0.12);
  }

  void main() {
    vec3 N = normalize(vNormalView);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(vViewPos);
    float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

    float normT = uTempMin;

    if (uSpatialMode > 0.5 && uSpatialMode < 1.5) {
      // RTG Boom axial heat conduction & radial fin dissipation gradient
      vec3 axis = uRtgTip - uRtgRoot;
      float axisLenSq = dot(axis, axis);
      float proj = clamp(dot(vWorldPos - uRtgRoot, axis) / max(axisLenSq, 0.0001), 0.0, 1.0);
      vec3 closest = uRtgRoot + axis * proj;
      float radialDist = length(vWorldPos - closest);
      float finCool = clamp((radialDist - 0.18) * 1.45, 0.0, 0.24);
      float shimmer = sin(proj * 26.0 - uTime * 2.2) * 0.012;
      normT = mix(uTempMin, uTempMax, smoothstep(0.08, 0.45, proj)) - finCool + shimmer;
    } else if (uSpatialMode > 1.5) {
      // Bus interior warmth radiates outward from core toward cold rim
      float r = length(vWorldPos.xz);
      float coreBias = 1.0 - smoothstep(0.32, 0.96, r);
      normT = mix(uTempMin, uTempMax, coreBias);
    } else {
      // Subtle surface orientation modulation mimicking solar-side vs deep-space-side temperature delta
      float sunBias = clamp(dot(normalize(vWorldPos + vec3(0.001)), normalize(vec3(11.5, 8.2, 9.5))) * 0.5 + 0.5, 0.0, 1.0);
      normT = mix(uTempMin, uTempMax, sunBias);
    }

    // Subtle emissivity & micro-ridge contrast so 3D geometry stays razor-sharp
    float surfaceShade = 0.72 + 0.28 * pow(ndotv, 0.62);
    vec3 col = ironbow(normT) * surfaceShade;

    // Delicate sensor-edge definition on cryogenic surfaces (-200°C HGA / optics / booms)
    float fresnel = pow(1.0 - ndotv, 2.2);
    float coldRim = (1.0 - smoothstep(0.08, 0.36, normT)) * fresnel * 0.28;
    col += vec3(0.16, 0.22, 0.56) * coldRim;

    // Subtle hot contour boost near RTG peak temperature
    float hotHalo = smoothstep(0.84, 1.0, normT) * (1.0 - ndotv) * 0.22;
    col += vec3(1.0, 0.72, 0.32) * hotHalo;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createThermalMaterialBank(): ThermalMaterialBank {
  const sharedRtgRoot = new THREE.Vector3(-0.88, -0.18, 0.12);
  const sharedRtgTip = new THREE.Vector3(-3.38, -0.84, 0.42);

  const makeMat = (
    tempMin: number,
    tempMax: number,
    spatialMode: number,
    doubleSide = false,
  ) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uTempMin: { value: tempMin },
        uTempMax: { value: tempMax },
        uSpatialMode: { value: spatialMode },
        uTime: { value: 0 },
        uRtgRoot: { value: sharedRtgRoot },
        uRtgTip: { value: sharedRtgTip },
      },
      vertexShader: THERMAL_VERTEX_SHADER,
      fragmentShader: THERMAL_FRAGMENT_SHADER,
      side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });

  // Normalized temperature scale: 0.0 = -215°C, 0.5 = +5°C, 1.0 = +225°C
  const zones: Record<ThermalZone, THREE.ShaderMaterial> = {
    rtg_core: makeMat(0.78, 0.99, 1, false),          // +130°C to +222°C Pu-238 unicouple shell
    rtg_fin: makeMat(0.68, 0.88, 1, false),           // +85°C to +175°C radiator fins
    rtg_boom: makeMat(0.24, 0.72, 1, true),           // -110°C root -> +100°C near baffle cone
    louver_radiator: makeMat(0.55, 0.68, 0, false),   // +25°C to +80°C open bus radiator cavity
    avionics_warm: makeMat(0.46, 0.62, 2, false),     // -10°C to +55°C active electronics bays
    hydrazine_heated: makeMat(0.48, 0.59, 0, false),  // -2°C to +42°C heated tank & valves
    instrument_active: makeMat(0.32, 0.46, 0, false), // -75°C to -12°C active sensors (LECP/CRS/MAG/PWS)
    mli_insulation: makeMat(0.16, 0.34, 2, true),     // -145°C to -65°C Kapton MLI outer skin
    space_cold: makeMat(0.03, 0.16, 0, true),         // -202°C to -145°C HGA dish, scan platform, booms
  };

  const allMats = Object.values(zones);

  return {
    zones,
    update: (elapsed: number) => {
      for (let i = 0; i < allMats.length; i++) {
        allMats[i].uniforms.uTime.value = elapsed;
      }
    },
    dispose: () => {
      allMats.forEach((m) => m.dispose());
    },
  };
}
