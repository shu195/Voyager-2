import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  CAMERA_PRESETS,
  EnvironmentMode,
  SUBSYSTEM_BY_ID,
  WiringFilter,
} from '../data/voyagerCatalog';
import { buildVoyager2, KinematicsConfig, VoyagerModelHandle } from '../scene/buildVoyager2';
import { createVoyagerMaterials, VoyagerMaterialLibrary } from '../scene/materials';
import { createProceduralTextures, ProceduralTextureSet } from '../scene/textures';

export interface CameraFocusCommand {
  id: number;
  position: [number, number, number];
  target: [number, number, number];
}

export interface HoverPayload {
  partId: string | null;
  x: number;
  y: number;
}

interface VoyagerViewportProps {
  globalExplode: number;
  detachedIds: Set<string>;
  selectedPartId: string | null;
  wiringFilter: WiringFilter;
  signalTraceEnabled: boolean;
  environmentMode: EnvironmentMode;
  cadLightIntensity: number;
  thermalMode: boolean;
  liveMotion: boolean;
  scanAutoSweep: boolean;
  scanAzimuthDeg: number;
  scanElevationDeg: number;
  rcsPulseNonce: number;
  showFovCones: boolean;
  cameraCommand: CameraFocusCommand | null;
  onSelectPart: (partId: string | null) => void;
  onToggleDetachPart: (partId: string) => void;
  onHoverChange: (hover: HoverPayload) => void;
}

const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _pointerNdc = new THREE.Vector2();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/** Deterministic PRNG for razor-sharp 3D starfield */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesizes true floating-point (IEEE 754 HalfFloat RGBA16F) equirectangular
 * High-Dynamic-Range (HDR) environment textures and prefilters them via PMREMGenerator.
 * Continuous Gaussian/softbox spherical radiance lobes give crisp liquid-metal specular
 * falloff across curved titanium, gold Kapton, and optical surfaces with universal WebGL2 support.
 */
interface HdrLightLobe {
  dir: [number, number, number];
  color: [number, number, number];
  intensity: number;
  sharpness: number;
  softboxAspect?: number;
}

function generateHdrEquirectangularTexture(
  width: number,
  height: number,
  zenithColor: [number, number, number],
  horizonColor: [number, number, number],
  nadirColor: [number, number, number],
  lobes: HdrLightLobe[],
): THREE.DataTexture {
  const data = new Uint16Array(width * height * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;

  const normLobes = lobes.map((l) => {
    const v = new THREE.Vector3(...l.dir).normalize();
    return { ...l, nx: v.x, ny: v.y, nz: v.z };
  });

  for (let y = 0; y < height; y++) {
    // DataTexture has flipY=false: y=0 is v=0 (nadir -Y), y=height-1 is v=1 (zenith +Y)
    // Exact inverse of Three.js PMREMGenerator equirectUv: v = asin(dir.y)/PI + 0.5
    const v = (y + 0.5) / height;
    const elev = (v - 0.5) * Math.PI;
    const dy = Math.sin(elev);
    const cosElev = Math.cos(elev);

    // Smooth sky-to-horizon-to-floor HDR base radiance gradient
    let baseR: number;
    let baseG: number;
    let baseB: number;
    if (dy >= 0) {
      const t = Math.pow(dy, 0.75);
      baseR = horizonColor[0] * (1 - t) + zenithColor[0] * t;
      baseG = horizonColor[1] * (1 - t) + zenithColor[1] * t;
      baseB = horizonColor[2] * (1 - t) + zenithColor[2] * t;
    } else {
      const t = Math.pow(-dy, 0.7);
      baseR = horizonColor[0] * (1 - t) + nadirColor[0] * t;
      baseG = horizonColor[1] * (1 - t) + nadirColor[1] * t;
      baseB = horizonColor[2] * (1 - t) + nadirColor[2] * t;
    }

    for (let x = 0; x < width; x++) {
      // Exact inverse of Three.js equirectUv: u = atan(dir.z, dir.x)/(2*PI) + 0.5
      const u = (x + 0.5) / width;
      const theta = (u - 0.5) * Math.PI * 2;
      const dx = cosElev * Math.cos(theta);
      const dz = cosElev * Math.sin(theta);

      let r = baseR;
      let g = baseG;
      let b = baseB;

      for (let i = 0; i < normLobes.length; i++) {
        const lobe = normLobes[i];
        const dot = dx * lobe.nx + dy * lobe.ny + dz * lobe.nz;
        if (dot > 0) {
          let weight = Math.pow(dot, lobe.sharpness);
          if (lobe.softboxAspect && lobe.softboxAspect > 1) {
            const horizBand = Math.exp(-Math.pow((dy - lobe.ny) * lobe.softboxAspect, 2));
            weight = Math.max(weight, Math.pow(dot, lobe.sharpness * 0.35) * horizBand * 0.7);
          }
          const contrib = weight * lobe.intensity;
          r += lobe.color[0] * contrib;
          g += lobe.color[1] * contrib;
          b += lobe.color[2] * contrib;
        }
      }

      const idx = (y * width + x) * 4;
      data[idx] = toHalf(r);
      data[idx + 1] = toHalf(g);
      data[idx + 2] = toHalf(b);
      data[idx + 3] = toHalf(1.0);
    }
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function buildCalibratedHdrEnvironments(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // Deep Space HDRI: true obsidian vacuum with razor-sharp 5600K solar specular core
  // and crisp interstellar sapphire rim strip for high-contrast metallic reflections
  const spaceHdrRaw = generateHdrEquirectangularTexture(
    512,
    256,
    [0.002, 0.004, 0.01],
    [0.001, 0.002, 0.005],
    [0.0005, 0.001, 0.002],
    [
      // Focused solar key specular highlight (controlled so grazing faces never blow out)
      { dir: [11.5, 8.2, 9.5], color: [1.0, 0.94, 0.84], intensity: 3.6, sharpness: 64 },
      // Tight solar corona shoulder for subtle brushed-metal & Kapton sheen
      { dir: [11.5, 8.2, 9.5], color: [1.0, 0.91, 0.78], intensity: 0.75, sharpness: 16 },
      // Subtle interstellar sapphire rim strip
      { dir: [-7.0, 9.0, -11.5], color: [0.48, 0.74, 1.0], intensity: 1.35, sharpness: 18, softboxAspect: 3.2 },
      // Whisper-subtle cool space edge on shadow flank
      { dir: [-12.0, -2.5, 5.0], color: [0.28, 0.48, 0.82], intensity: 0.18, sharpness: 10 },
      // Minimal warm dish-scatter bounce from below
      { dir: [4.5, -8.0, 7.5], color: [1.0, 0.86, 0.68], intensity: 0.12, sharpness: 12 },
    ],
  );
  const spaceEnv = pmrem.fromEquirectangular(spaceHdrRaw);
  spaceHdrRaw.dispose();

  // Studio CAD Cleanroom HDRI: JPL high-bay inspection lighting with overhead softbox banks,
  // warm 5000K key diffuser, cool 7500K rim cyclorama, and low-reflectance cleanroom floor
  const cadHdrRaw = generateHdrEquirectangularTexture(
    512,
    256,
    [0.24, 0.29, 0.38],
    [0.14, 0.19, 0.27],
    [0.04, 0.055, 0.08],
    [
      // Overhead cleanroom softbox bank
      { dir: [0.0, 14.0, 2.0], color: [0.98, 0.99, 1.0], intensity: 3.4, sharpness: 12, softboxAspect: 2.4 },
      // Primary warm studio key softbox
      { dir: [10.0, 9.5, 8.5], color: [1.0, 0.95, 0.88], intensity: 4.1, sharpness: 18, softboxAspect: 2.0 },
      // High-contrast steel-blue rim reflector strip
      { dir: [-9.0, 7.0, -10.5], color: [0.62, 0.8, 1.0], intensity: 2.55, sharpness: 16, softboxAspect: 3.4 },
      // Secondary front-left fill cyclorama
      { dir: [-11.0, 3.5, 10.0], color: [0.78, 0.88, 1.0], intensity: 1.15, sharpness: 7 },
      // Subtle rear-right edge kicker to outline dark anodized housings
      { dir: [9.0, 4.0, -12.0], color: [0.92, 0.96, 1.0], intensity: 1.25, sharpness: 14 },
    ],
  );
  const cadEnv = pmrem.fromEquirectangular(cadHdrRaw);
  cadHdrRaw.dispose();

  pmrem.dispose();
  return {
    spaceTexture: spaceEnv.texture,
    cadTexture: cadEnv.texture,
    dispose: () => {
      spaceEnv.dispose();
      cadEnv.dispose();
    },
  };
}

/**
 * Builds a crisp pinpoint 3D starfield (THREE.Points) with realistic spectral tints,
 * fine Milky Way band density, and zero skybox stretching.
 */
function buildPinpointStarfield(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const rand = mulberry32(19770820);

  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = 64;
  spriteCanvas.height = 64;
  const ctx = spriteCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.24, 'rgba(255,255,255,0.88)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const starTex = new THREE.CanvasTexture(spriteCanvas);
  starTex.colorSpace = THREE.SRGBColorSpace;

  const palette = [
    new THREE.Color('#b4d2ff'), // O/B blue-white
    new THREE.Color('#e4eeff'), // A white-blue
    new THREE.Color('#ffffff'), // F pure white
    new THREE.Color('#fff1d4'), // G solar cream
    new THREE.Color('#ffcb92'), // K/M warm amber
  ];

  const layers = [
    { count: 3200, size: 1.4, minR: 98, maxR: 145, opacity: 0.72, beltChance: 0.44 },
    { count: 520, size: 2.35, minR: 88, maxR: 132, opacity: 0.9, beltChance: 0.34 },
    { count: 85, size: 3.1, minR: 82, maxR: 118, opacity: 0.96, beltChance: 0.25 },
  ];

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.PointsMaterial[] = [];

  for (const layer of layers) {
    const positions = new Float32Array(layer.count * 3);
    const colors = new Float32Array(layer.count * 3);

    for (let i = 0; i < layer.count; i++) {
      const u = rand();
      const v = rand();
      const theta = u * Math.PI * 2;
      let phi = Math.acos(2 * v - 1);
      if (rand() < layer.beltChance) {
        phi = Math.PI / 2 + (rand() - 0.5) * 0.38;
      }

      const r = layer.minR + rand() * (layer.maxR - layer.minR);
      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = r * Math.cos(phi);
      const sz = r * Math.sin(phi) * Math.sin(theta);

      const tilt = 0.38;
      const ty = sy * Math.cos(tilt) - sz * Math.sin(tilt);
      const tz = sy * Math.sin(tilt) + sz * Math.cos(tilt);

      positions[i * 3] = sx;
      positions[i * 3 + 1] = ty;
      positions[i * 3 + 2] = tz;

      const baseCol = palette[Math.floor(rand() * palette.length)];
      const brightness = 0.38 + Math.pow(rand(), 1.75) * 0.62;
      colors[i * 3] = baseCol.r * brightness;
      colors[i * 3 + 1] = baseCol.g * brightness;
      colors[i * 3 + 2] = baseCol.b * brightness;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(geo);

    const mat = new THREE.PointsMaterial({
      size: layer.size,
      sizeAttenuation: false,
      map: starTex,
      vertexColors: true,
      transparent: true,
      opacity: layer.opacity,
      depthWrite: false,
      fog: false,
    });
    mats.push(mat);

    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
  }

  // Subtle Milky Way Galactic Dust Band aligned with the tilted 0.38 rad star belt
  const dustCanvas = document.createElement('canvas');
  dustCanvas.width = 128;
  dustCanvas.height = 128;
  const dCtx = dustCanvas.getContext('2d')!;
  const dGrad = dCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  dGrad.addColorStop(0, 'rgba(255,255,255,1)');
  dGrad.addColorStop(0.28, 'rgba(255,255,255,0.52)');
  dGrad.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  dGrad.addColorStop(1, 'rgba(255,255,255,0)');
  dCtx.fillStyle = dGrad;
  dCtx.fillRect(0, 0, 128, 128);
  const dustTex = new THREE.CanvasTexture(dustCanvas);
  dustTex.colorSpace = THREE.SRGBColorSpace;

  const dustPaletteOuter = [
    new THREE.Color('#2c447c'),
    new THREE.Color('#3b518c'),
    new THREE.Color('#473f78'),
  ];
  const dustPaletteCore = [
    new THREE.Color('#5a6f9c'),
    new THREE.Color('#7a708a'),
    new THREE.Color('#8e7a68'),
  ];

  const dustBands = [
    { count: 340, size: 38, spread: 0.3, minR: 150, maxR: 174, opacity: 0.072, pal: dustPaletteOuter },
    { count: 260, size: 22, spread: 0.15, minR: 146, maxR: 164, opacity: 0.082, pal: dustPaletteCore },
  ];

  for (const band of dustBands) {
    const positions = new Float32Array(band.count * 3);
    const colors = new Float32Array(band.count * 3);

    for (let i = 0; i < band.count; i++) {
      const theta = rand() * Math.PI * 2;
      // Box-Muller-like peaked latitude distribution along galactic equator
      const gauss = (rand() + rand() + rand() - 1.5) * 0.66;
      const phi = Math.PI / 2 + gauss * band.spread;
      const r = band.minR + rand() * (band.maxR - band.minR);

      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = r * Math.cos(phi);
      const sz = r * Math.sin(phi) * Math.sin(theta);

      const tilt = 0.38;
      const ty = sy * Math.cos(tilt) - sz * Math.sin(tilt);
      const tz = sy * Math.sin(tilt) + sz * Math.cos(tilt);

      positions[i * 3] = sx;
      positions[i * 3 + 1] = ty;
      positions[i * 3 + 2] = tz;

      // Subtle brighter galactic core condensation around theta ~ 2.4 rad
      const coreBoost = 0.65 + 0.55 * Math.max(0, Math.cos(theta - 2.4));
      const baseCol = band.pal[Math.floor(rand() * band.pal.length)];
      const density = (0.45 + rand() * 0.55) * coreBoost;
      colors[i * 3] = baseCol.r * density;
      colors[i * 3 + 1] = baseCol.g * density;
      colors[i * 3 + 2] = baseCol.b * density;
    }

    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(dGeo);

    const dMat = new THREE.PointsMaterial({
      size: band.size,
      sizeAttenuation: true,
      map: dustTex,
      vertexColors: true,
      transparent: true,
      opacity: band.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    mats.push(dMat);

    const dPts = new THREE.Points(dGeo, dMat);
    dPts.frustumCulled = false;
    group.add(dPts);
  }

  // Distant Pinpoint Sun aligned with the exact solar keyLight vector (11.5, 8.2, 9.5)
  const sunCanvas = document.createElement('canvas');
  sunCanvas.width = 256;
  sunCanvas.height = 256;
  const sCtx = sunCanvas.getContext('2d')!;
  const cx = 128;
  const cy = 128;

  // Soft solar corona halo
  const corona = sCtx.createRadialGradient(cx, cy, 0, cx, cy, 118);
  corona.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  corona.addColorStop(0.055, 'rgba(255, 250, 232, 0.96)');
  corona.addColorStop(0.13, 'rgba(255, 234, 192, 0.45)');
  corona.addColorStop(0.32, 'rgba(255, 206, 152, 0.11)');
  corona.addColorStop(0.65, 'rgba(180, 205, 255, 0.025)');
  corona.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = corona;
  sCtx.fillRect(0, 0, 256, 256);

  // Restrained 4-point optical diffraction spikes (horizontal + vertical)
  const drawSpike = (angle: number, halfLen: number, width: number, alpha: number) => {
    sCtx.save();
    sCtx.translate(cx, cy);
    sCtx.rotate(angle);
    const sg = sCtx.createLinearGradient(-halfLen, 0, halfLen, 0);
    sg.addColorStop(0, 'rgba(255, 240, 210, 0)');
    sg.addColorStop(0.42, `rgba(255, 244, 222, ${alpha * 0.4})`);
    sg.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`);
    sg.addColorStop(0.58, `rgba(255, 244, 222, ${alpha * 0.4})`);
    sg.addColorStop(1, 'rgba(255, 240, 210, 0)');
    sCtx.fillStyle = sg;
    sCtx.fillRect(-halfLen, -width * 0.5, halfLen * 2, width);
    sCtx.restore();
  };
  drawSpike(0, 112, 2.2, 0.62);
  drawSpike(Math.PI / 2, 112, 2.2, 0.62);
  drawSpike(Math.PI / 4, 52, 1.4, 0.24);
  drawSpike(-Math.PI / 4, 52, 1.4, 0.24);

  const sunTex = new THREE.CanvasTexture(sunCanvas);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  const sunMat = new THREE.SpriteMaterial({
    map: sunTex,
    color: 0xfff8ea,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const sunSprite = new THREE.Sprite(sunMat);
  sunSprite.position.set(11.5, 8.2, 9.5).normalize().multiplyScalar(132);
  sunSprite.scale.set(11.5, 11.5, 1);
  sunSprite.frustumCulled = false;
  group.add(sunSprite);

  return {
    group,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      starTex.dispose();
      dustTex.dispose();
      sunTex.dispose();
      sunMat.dispose();
    },
  };
}

function buildCadCleanroomFloor(contactShadowTex: THREE.CanvasTexture): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();

  // Radial alpha mask so cleanroom floor dissolves smoothly into the studio horizon (no hard disc edge)
  const fadeCanvas = document.createElement('canvas');
  fadeCanvas.width = 256;
  fadeCanvas.height = 256;
  const fCtx = fadeCanvas.getContext('2d')!;
  const fGrad = fCtx.createRadialGradient(128, 128, 22, 128, 128, 126);
  fGrad.addColorStop(0, 'rgba(255,255,255,1)');
  fGrad.addColorStop(0.45, 'rgba(255,255,255,0.72)');
  fGrad.addColorStop(0.78, 'rgba(255,255,255,0.18)');
  fGrad.addColorStop(1, 'rgba(255,255,255,0)');
  fCtx.fillStyle = fGrad;
  fCtx.fillRect(0, 0, 256, 256);
  const floorAlphaTex = new THREE.CanvasTexture(fadeCanvas);

  const floorGeo = new THREE.CircleGeometry(28, 72);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0c111b,
    roughness: 0.78,
    metalness: 0.22,
    alphaMap: floorAlphaTex,
    transparent: true,
    depthWrite: false,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = -2.22;
  floorMesh.receiveShadow = true;
  group.add(floorMesh);

  const shadowGeo = new THREE.PlaneGeometry(9.2, 9.2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.66,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -2.19;
  group.add(shadowMesh);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0x26354d,
    transparent: true,
    opacity: 0.65,
  });
  const accentMat = new THREE.LineBasicMaterial({
    color: 0x06b6d4,
    transparent: true,
    opacity: 0.38,
  });

  for (const r of [1.0, 2.0, 4.0, 6.0]) {
    const pts: THREE.Vector3[] = [];
    const segs = 96;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, -2.16, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, r === 2.0 ? accentMat : lineMat));
  }

  const crossPts = [
    new THREE.Vector3(-6.4, -2.16, 0),
    new THREE.Vector3(6.4, -2.16, 0),
    new THREE.Vector3(0, -2.16, -6.4),
    new THREE.Vector3(0, -2.16, 6.4),
  ];
  const crossGeo = new THREE.BufferGeometry().setFromPoints(crossPts);
  group.add(new THREE.LineSegments(crossGeo, lineMat));

  return {
    group,
    dispose: () => {
      floorAlphaTex.dispose();
      group.traverse((obj) => {
        const m = obj as THREE.Mesh | THREE.Line;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mt) => mt.dispose());
          else m.material.dispose();
        }
      });
    },
  };
}

export function VoyagerViewport({
  globalExplode,
  detachedIds,
  selectedPartId,
  wiringFilter,
  signalTraceEnabled,
  environmentMode,
  cadLightIntensity,
  thermalMode,
  liveMotion,
  scanAutoSweep,
  scanAzimuthDeg,
  scanElevationDeg,
  rcsPulseNonce,
  showFovCones,
  cameraCommand,
  onSelectPart,
  onToggleDetachPart,
  onHoverChange,
}: VoyagerViewportProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  const kinematicsRef = useRef<KinematicsConfig>({
    liveMotion,
    scanAutoSweep,
    scanAzimuthDeg,
    scanElevationDeg,
    rcsPulseNonce,
    showFovCones,
    selectedPartId,
  });
  kinematicsRef.current.liveMotion = liveMotion;
  kinematicsRef.current.scanAutoSweep = scanAutoSweep;
  kinematicsRef.current.scanAzimuthDeg = scanAzimuthDeg;
  kinematicsRef.current.scanElevationDeg = scanElevationDeg;
  kinematicsRef.current.rcsPulseNonce = rcsPulseNonce;
  kinematicsRef.current.showFovCones = showFovCones;
  kinematicsRef.current.selectedPartId = selectedPartId;

  const stateRef = useRef({
    globalExplode,
    detachedIds,
    selectedPartId,
    wiringFilter,
    signalTraceEnabled,
    environmentMode,
    cadLightIntensity,
    thermalMode,
  });

  stateRef.current = {
    globalExplode,
    detachedIds,
    selectedPartId,
    wiringFilter,
    signalTraceEnabled,
    environmentMode,
    cadLightIntensity,
    thermalMode,
  };

  const callbacksRef = useRef({
    onSelectPart,
    onToggleDetachPart,
    onHoverChange,
  });
  callbacksRef.current = {
    onSelectPart,
    onToggleDetachPart,
    onHoverChange,
  };

  const glideRef = useRef<{
    active: boolean;
    position: [number, number, number];
    target: [number, number, number];
  }>({
    active: false,
    position: CAMERA_PRESETS[0].position,
    target: CAMERA_PRESETS[0].target,
  });

  const sceneHandlesRef = useRef<{
    model: VoyagerModelHandle | null;
    applyEnvironment:
      | ((mode: EnvironmentMode, cadIntensity: number, isThermal: boolean) => void)
      | null;
    hoveredId: string | null;
  }>({
    model: null,
    applyEnvironment: null,
    hoveredId: null,
  });

  useEffect(() => {
    if (!cameraCommand) return;
    glideRef.current = {
      active: true,
      position: cameraCommand.position,
      target: cameraCommand.target,
    };
  }, [cameraCommand]);

  useEffect(() => {
    const model = sceneHandlesRef.current.model;
    if (!model) return;
    model.wiring.setFilter(wiringFilter);
    model.wiring.setSignalTraceEnabled(signalTraceEnabled);
  }, [wiringFilter, signalTraceEnabled]);

  useEffect(() => {
    const model = sceneHandlesRef.current.model;
    if (!model) return;
    model.setHighlighted(sceneHandlesRef.current.hoveredId, selectedPartId);
  }, [selectedPartId]);

  useEffect(() => {
    const model = sceneHandlesRef.current.model;
    if (model) {
      model.setThermalMode(thermalMode);
    }
    sceneHandlesRef.current.applyEnvironment?.(
      environmentMode,
      cadLightIntensity,
      thermalMode,
    );
  }, [environmentMode, cadLightIntensity, thermalMode]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL rendering is unavailable in this browser context.');
      return;
    }

    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(initW, initH);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Dual Floating-Point HDR Equirectangular Reflection Maps (Deep Space + Studio CAD)
    const envMaps = buildCalibratedHdrEnvironments(renderer);
    scene.environment = envMaps.spaceTexture;

    const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.06, 260);
    camera.position.set(...CAMERA_PRESETS[0].position);

    // GPU-only Selective Specular Bloom Post-Processing (matches V1 cinema glow)
    let composer: EffectComposer | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      composer.setSize(initW, initH);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(initW, initH),
          0.07, // restrained optical bloom strength
          0.18, // tight halo radius
          1.85, // high threshold so grazing metallic reflections never blow out
        ),
      );
      composer.addPass(new OutputPass());
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS[0].target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.055;
    controls.minDistance = 1.15;
    controls.maxDistance = 26;
    controls.enablePan = true;
    controls.update();

    const handleControlsStart = () => {
      glideRef.current.active = false;
    };
    controls.addEventListener('start', handleControlsStart);

    // =========================================================================
    // CINEMA-GRADE DUAL LIGHTING RIG (TIGHT 4K SHADOWS + DISH BOUNCE + RIM)
    // =========================================================================
    const keyLight = new THREE.DirectionalLight(0xfff4e2, 2.75);
    keyLight.position.set(11.5, 8.2, 9.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(isSoftwareGl ? 1024 : 4096, isSoftwareGl ? 1024 : 4096);
    keyLight.shadow.camera.near = 2.5;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.camera.left = -4.8;
    keyLight.shadow.camera.right = 4.8;
    keyLight.shadow.camera.top = 4.8;
    keyLight.shadow.camera.bottom = -4.8;
    keyLight.shadow.bias = -0.00025;
    keyLight.shadow.normalBias = 0.012;
    keyLight.shadow.radius = 2.2;
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight(0x88b4e8, 0x161c28, 0.28);
    scene.add(hemiLight);

    // Subtle warm bounce simulating solar scatter off the 3.7 m white HGA dish onto bus & instruments
    const bounceLight = new THREE.DirectionalLight(0xffe7c4, 0.42);
    bounceLight.position.set(4.5, -5.0, 7.5);
    scene.add(bounceLight);

    // Cool interstellar fill & sharp silhouette rim separating dark alloys from deep space
    const fillLight = new THREE.DirectionalLight(0x6e9ad4, 0.38);
    fillLight.position.set(-10, -2.5, -5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xa8ccf8, 1.25);
    rimLight.position.set(-7.0, 9.0, -11.5);
    scene.add(rimLight);

    let studioSoftboxKey: THREE.RectAreaLight | null = null;
    let studioSoftboxFill: THREE.RectAreaLight | null = null;
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      studioSoftboxKey = new THREE.RectAreaLight(0xfff6ea, 1.45, 7.5, 4.2);
      studioSoftboxKey.position.set(5.5, 6.4, 6.2);
      studioSoftboxKey.lookAt(0, 0.25, 0);
      scene.add(studioSoftboxKey);

      studioSoftboxFill = new THREE.RectAreaLight(0x90b8f0, 0.95, 8.5, 3.8);
      studioSoftboxFill.position.set(-6.8, 3.6, -5.2);
      studioSoftboxFill.lookAt(0, 0.2, 0);
      scene.add(studioSoftboxFill);
    }

    // =========================================================================
    // PROCEDURAL TEXTURES, MATERIALS, VOYAGER 2 MODEL & PINPOINT STARFIELD
    // =========================================================================
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures: ProceduralTextureSet = createProceduralTextures(maxAniso);
    const materials: VoyagerMaterialLibrary = createVoyagerMaterials(textures, isSoftwareGl);
    const model: VoyagerModelHandle = buildVoyager2(materials);
    scene.add(model.root);

    const starfield = buildPinpointStarfield();
    scene.add(starfield.group);

    const cadFloor = buildCadCleanroomFloor(textures.contactShadow);
    scene.add(cadFloor.group);

    const spaceBgColor = new THREE.Color(0x020409);
    const thermalBgColor = new THREE.Color(0x020309);
    const cadBgColor = new THREE.Color(0x0b1019);
    const cadFog = new THREE.FogExp2(0x0b1019, 0.024);

    const applyEnvironment = (
      mode: EnvironmentMode,
      cadIntensity: number,
      isThermal: boolean,
    ) => {
      if (isThermal) {
        scene.background = thermalBgColor;
        scene.fog = null;
        renderer.toneMappingExposure = 1.0;
        starfield.group.visible = false;
        cadFloor.group.visible = false;
        if (studioSoftboxKey) studioSoftboxKey.visible = false;
        if (studioSoftboxFill) studioSoftboxFill.visible = false;
        return;
      }

      if (mode === 'space') {
        scene.background = spaceBgColor;
        scene.fog = null;
        scene.environment = envMaps.spaceTexture;
        scene.environmentIntensity = 0.42;
        renderer.toneMappingExposure = 0.94;
        starfield.group.visible = true;
        cadFloor.group.visible = false;

        keyLight.color.setHex(0xfff4e2);
        keyLight.intensity = 2.35;
        keyLight.position.set(11.5, 8.2, 9.5);
        hemiLight.intensity = 0.08;
        bounceLight.intensity = 0.06;
        fillLight.intensity = 0.08;
        rimLight.color.setHex(0x5bb2ff);
        rimLight.position.set(-11.0, -3.2, -9.5);
        rimLight.intensity = 1.15;
        if (studioSoftboxKey) studioSoftboxKey.visible = false;
        if (studioSoftboxFill) studioSoftboxFill.visible = false;
      } else {
        const s = THREE.MathUtils.clamp(cadIntensity, 0.25, 2.2);
        scene.background = cadBgColor;
        scene.fog = cadFog;
        scene.environment = envMaps.cadTexture;
        scene.environmentIntensity = 0.92 * s;
        renderer.toneMappingExposure = 0.92 + 0.16 * s;
        starfield.group.visible = false;
        cadFloor.group.visible = true;

        keyLight.color.setHex(0xfffaf2);
        keyLight.intensity = 2.05 * s;
        keyLight.position.set(9.5, 11, 8.5);
        hemiLight.intensity = 0.52 * s;
        bounceLight.intensity = 0.3 * s;
        fillLight.intensity = 0.6 * s;
        rimLight.intensity = 1.05 * s;
        if (studioSoftboxKey) {
          studioSoftboxKey.visible = true;
          studioSoftboxKey.intensity = 1.4 * s;
        }
        if (studioSoftboxFill) {
          studioSoftboxFill.visible = true;
          studioSoftboxFill.intensity = 0.92 * s;
        }
      }
    };

    applyEnvironment(
      stateRef.current.environmentMode,
      stateRef.current.cadLightIntensity,
      stateRef.current.thermalMode,
    );
    model.setThermalMode(stateRef.current.thermalMode);
    model.wiring.setFilter(stateRef.current.wiringFilter);
    model.wiring.setSignalTraceEnabled(stateRef.current.signalTraceEnabled);
    model.setHighlighted(null, stateRef.current.selectedPartId);

    sceneHandlesRef.current.model = model;
    sceneHandlesRef.current.applyEnvironment = applyEnvironment;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // =========================================================================
    // LAYER-RESTRICTED RAYCASTING (HOVER / CLICK / DOUBLE-CLICK)
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);

    let lastHoverTime = 0;
    let pointerDownPos = { x: 0, y: 0 };

    const pickPartAt = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_pointerNdc, camera);
      const hits = raycaster.intersectObjects(model.clickableRoots, true);
      if (hits.length === 0) return null;
      const pid = hits[0].object.userData.partId as string | undefined;
      return pid && SUBSYSTEM_BY_ID[pid] ? pid : null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;

      const hitId = pickPartAt(e.clientX, e.clientY);
      if (hitId !== sceneHandlesRef.current.hoveredId) {
        sceneHandlesRef.current.hoveredId = hitId;
        model.setHighlighted(hitId, stateRef.current.selectedPartId);
        renderer.domElement.style.cursor = hitId ? 'pointer' : 'grab';
      }
      callbacksRef.current.onHoverChange({
        partId: hitId,
        x: e.clientX,
        y: e.clientY,
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onClick = (e: MouseEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (dx * dx + dy * dy > 36) return;

      const hitId = pickPartAt(e.clientX, e.clientY);
      callbacksRef.current.onSelectPart(hitId);
    };

    const onDblClick = (e: MouseEvent) => {
      const hitId = pickPartAt(e.clientX, e.clientY);
      if (hitId) {
        callbacksRef.current.onToggleDetachPart(hitId);
        callbacksRef.current.onSelectPart(hitId);
      }
    };

    const onPointerLeave = () => {
      if (sceneHandlesRef.current.hoveredId !== null) {
        sceneHandlesRef.current.hoveredId = null;
        model.setHighlighted(null, stateRef.current.selectedPartId);
      }
      callbacksRef.current.onHoverChange({ partId: null, x: 0, y: 0 });
    };

    const domEl = renderer.domElement;
    domEl.style.cursor = 'grab';
    domEl.addEventListener('pointermove', onPointerMove);
    domEl.addEventListener('pointerdown', onPointerDown);
    domEl.addEventListener('click', onClick);
    domEl.addEventListener('dblclick', onDblClick);
    domEl.addEventListener('pointerleave', onPointerLeave);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('WebGL context lost. Attempting automatic restoration...');
    };
    const onContextRestored = () => {
      setWebglError(null);
    };
    domEl.addEventListener('webglcontextlost', onContextLost);
    domEl.addEventListener('webglcontextrestored', onContextRestored);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // =========================================================================
    // HARDWARE-ADAPTIVE RENDER LOOP
    // =========================================================================
    let disposed = false;
    let frameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      elapsed += delta;

      if (glideRef.current.active) {
        _camTargetPos.set(...glideRef.current.position);
        _camTargetLook.set(...glideRef.current.target);

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 5.5, delta);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, _camTargetLook.x, 5.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _camTargetLook.y, 5.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _camTargetLook.z, 5.5, delta);

        if (
          camera.position.distanceToSquared(_camTargetPos) < 0.0008 &&
          controls.target.distanceToSquared(_camTargetLook) < 0.0008
        ) {
          camera.position.copy(_camTargetPos);
          controls.target.copy(_camTargetLook);
          glideRef.current.active = false;
        }
      }

      controls.update();

      model.updateKinematics(
        delta,
        elapsed,
        stateRef.current.globalExplode,
        stateRef.current.detachedIds,
        kinematicsRef.current,
      );

      if (composer && !isSoftwareGl && !stateRef.current.thermalMode) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('start', handleControlsStart);
      domEl.removeEventListener('pointermove', onPointerMove);
      domEl.removeEventListener('pointerdown', onPointerDown);
      domEl.removeEventListener('click', onClick);
      domEl.removeEventListener('dblclick', onDblClick);
      domEl.removeEventListener('pointerleave', onPointerLeave);
      domEl.removeEventListener('webglcontextlost', onContextLost);
      domEl.removeEventListener('webglcontextrestored', onContextRestored);

      if (composer) {
        composer.dispose();
      }
      controls.dispose();
      model.dispose();
      materials.dispose();
      textures.dispose();
      starfield.dispose();
      envMaps.dispose();
      cadFloor.dispose();

      renderer.dispose();
      if (domEl.parentElement === container) {
        container.removeChild(domEl);
      }
      sceneHandlesRef.current.model = null;
      sceneHandlesRef.current.applyEnvironment = null;
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mountRef} className="w-full h-full" />
      {environmentMode === 'space' && !thermalMode && (
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 58%, rgba(2, 4, 10, 0.54) 100%)',
          }}
        />
      )}
      {webglError && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#060911] p-8">
          <div className="max-w-md border border-[#223047] bg-[#0B101B] p-6 text-slate-200">
            <h2 className="text-lg font-semibold text-slate-100">3D Viewport Unavailable</h2>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">{webglError}</p>
            <p className="mt-3 text-xs font-mono text-slate-500">
              Voyager 2 Technical Dossier remains accessible via the bottom controls.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
