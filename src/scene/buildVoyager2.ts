import * as THREE from 'three';
import { SUBSYSTEM_BY_ID, VOYAGER_SUBSYSTEMS } from '../data/voyagerCatalog';
import { createFovCones } from './fovCones';
import { VoyagerMaterialLibrary } from './materials';
import { createThermalMaterialBank, ThermalZone } from './thermalShader';
import { createWiringNetwork, WiringNetworkController } from './wiringNetwork';

export interface KinematicsConfig {
  liveMotion: boolean;
  scanAutoSweep: boolean;
  scanAzimuthDeg: number;
  scanElevationDeg: number;
  rcsPulseNonce: number;
  showFovCones: boolean;
  selectedPartId: string | null;
}

export interface DetachableAssembly {
  id: string;
  group: THREE.Group;
  basePosition: THREE.Vector3;
  explodeOffset: THREE.Vector3;
  anchorPoint: THREE.Vector3;
  currentFactor: number;
  targetFactor: number;
  subParts?: Array<{
    obj: THREE.Object3D;
    basePos: THREE.Vector3;
    extraOffset: THREE.Vector3;
  }>;
}

export interface VoyagerModelHandle {
  root: THREE.Group;
  assemblies: Map<string, DetachableAssembly>;
  wiring: WiringNetworkController;
  clickableRoots: THREE.Object3D[];
  updateKinematics: (
    delta: number,
    elapsed: number,
    globalExplode: number,
    detachedIds: Set<string>,
    kinematics: KinematicsConfig,
  ) => boolean;
  setHighlighted: (hoveredId: string | null, selectedId: string | null) => void;
  setThermalMode: (enabled: boolean) => void;
  dispose: () => void;
}

const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecC = new THREE.Vector3();
const _scanPivot = new THREE.Vector3(2.81, -0.05, 0);
const _scanEuler = new THREE.Euler(0, 0, 0, 'YZX');
const _scanQuat = new THREE.Quaternion();
const _identityQuat = new THREE.Quaternion();
const _highlightColor = new THREE.Color(0x06b6d4);
const _hoverColor = new THREE.Color(0x38bdf8);
const SCAN_MOUNTED_IDS = new Set(['iss', 'iris', 'uvs', 'pps']);

const RCS_PLUME_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const RCS_PLUME_FRAGMENT = /* glsl */ `
  uniform float uIntensity;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // vUv.y = 0 at nozzle throat lip, 1 at far plume tip
    float axial = smoothstep(0.0, 0.14, vUv.y) * pow(max(0.0, 1.0 - vUv.y), 1.85);
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float softEdge = pow(clamp(ndv, 0.0, 1.0), 0.75);
    float shimmer = 0.88 + 0.12 * sin(vUv.y * 28.0 - uTime * 38.0);
    float alpha = axial * softEdge * shimmer * uIntensity;
    if (alpha < 0.004) discard;

    // Hot white-cyan catalyst core near lip cooling into translucent pale ice-blue gas
    vec3 coreCol = vec3(0.86, 0.96, 1.0);
    vec3 outerCol = vec3(0.42, 0.78, 1.0);
    vec3 col = mix(coreCol, outerCol, smoothstep(0.05, 0.65, vUv.y));
    gl_FragColor = vec4(col, alpha);
  }
`;

function createRcsPlumeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uIntensity: { value: 0.0 },
      uTime: { value: 0.0 },
    },
    vertexShader: RCS_PLUME_VERTEX,
    fragmentShader: RCS_PLUME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function tagAssembly(group: THREE.Group, partId: string) {
  group.name = `assembly_${partId}`;
  group.userData.partId = partId;
  group.traverse((child) => {
    if (child.userData.nonPickable) return;
    child.userData.partId = partId;
    if ((child as THREE.Mesh).isMesh) {
      child.layers.enable(1);
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function tagThermalZone(obj: THREE.Object3D, zone: ThermalZone, overwrite = false) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      if (overwrite || !child.userData.thermalZone) {
        child.userData.thermalZone = zone;
      }
    }
  });
}

function createStrut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  mat: THREE.Material,
  geos: THREE.BufferGeometry[],
  radialSegments = 14,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, radialSegments);
  geos.push(geo);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/**
 * Creates a precision CNC-chamfered aerospace enclosure with beveled specular edges
 * so metallic housings catch razor-sharp studio & solar rim highlights instead of raw 90° box corners.
 */
function createChamferedBox(
  width: number,
  height: number,
  depth: number,
  bevel: number,
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const b = Math.min(bevel, width * 0.22, height * 0.22, depth * 0.22);
  const iw = Math.max(0.002, width - b * 2);
  const ih = Math.max(0.002, height - b * 2);
  const id = Math.max(0.002, depth - b * 2);
  const r = b * 0.65;

  const shape = new THREE.Shape();
  const hw = iw / 2;
  const hh = ih / 2;
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: id,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.center();
  geos.push(geo);
  return geo;
}

/**
 * Generates a high-subdivision 3D vertex-displaced quilted/crinkled NASA Kapton MLI blanket
 * so the actual physical silhouette ripples with vacuum foil creases.
 */
function createSculptedBlanketPanel(
  width: number,
  height: number,
  depth: number,
  segW: number,
  segH: number,
  crinkleAmp: number,
  seed: number,
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(width, height, depth, segW, segH, 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const nx = x / (width * 0.5);
    const ny = y / (height * 0.5);
    const edgeMask = Math.max(0, 1 - Math.pow(nx, 4)) * Math.max(0, 1 - Math.pow(ny, 4));

    if (z > 0) {
      const pillow = edgeMask * 0.015;
      const f1 = Math.sin(x * 26 + seed * 3.1 + Math.cos(y * 19 + seed) * 1.4);
      const f2 = Math.cos(y * 34 - x * 21 + seed * 5.7);
      const f3 = Math.abs(Math.sin(x * 52 + y * 48 + seed * 1.9)) - 0.5;
      const crinkle = (f1 * 0.48 + f2 * 0.34 + f3 * 0.36) * crinkleAmp * (0.25 + 0.75 * edgeMask);
      pos.setZ(i, z + pillow + crinkle);
    }
  }

  geo.computeVertexNormals();
  geos.push(geo);
  return geo;
}

/**
 * Generates a high-subdivision crinkled decagonal annular thermal blanket skirt
 * whose outer perimeter conforms precisely to the 10-sided bus rim (no circular overhang).
 */
function createSculptedAnnularBlanket(
  innerR: number,
  outerApothem: number,
  radialSegs: number,
  thetaSegs: number,
  amp: number,
  seed: number,
  geos: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(innerR, outerApothem, thetaSegs, radialSegs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const step = Math.PI / 5;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const t = THREE.MathUtils.clamp((r - innerR) / (outerApothem - innerR), 0, 1);

    // Map outer ring boundary from circle to exact regular decagon (vertices at k * PI / 5)
    const sector = (((ang % step) + step) % step) - step * 0.5;
    const decagonOuterR = outerApothem / Math.cos(sector);
    const mappedR = THREE.MathUtils.lerp(innerR, decagonOuterR, t);
    pos.setXY(i, Math.cos(ang) * mappedR, Math.sin(ang) * mappedR);

    const mask = Math.sin(t * Math.PI);
    const crease =
      (Math.sin(ang * 5 + mappedR * 10 + seed) * 0.5 +
        Math.cos(ang * 10 - mappedR * 14 + seed * 2.3) * 0.35 +
        Math.sin(ang * 15 + mappedR * 18) * 0.15) *
      amp *
      mask;
    const pillow = mask * 0.008;
    pos.setZ(i, pillow + crease);
  }

  geo.computeVertexNormals();
  geos.push(geo);
  return geo;
}

/** Instanced hexagonal aerospace bolt/fastener helper */
function createInstancedHexBolts(
  transforms: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }>,
  radius: number,
  height: number,
  mat: THREE.Material,
  geos: THREE.BufferGeometry[],
): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6);
  geos.push(geo);
  const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const m4 = new THREE.Matrix4();

  for (let i = 0; i < transforms.length; i++) {
    const { pos, normal } = transforms[i];
    quat.setFromUnitVectors(up, normal.clone().normalize());
    m4.compose(pos, quat, scale);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildVoyager2(materials: VoyagerMaterialLibrary): VoyagerModelHandle {
  const root = new THREE.Group();
  root.name = 'Voyager2Root';

  const geometries: THREE.BufferGeometry[] = [];
  const localMaterials: THREE.Material[] = [];
  const assemblies = new Map<string, DetachableAssembly>();
  const clickableRoots: THREE.Object3D[] = [];
  const dtrReels: THREE.Group[] = [];
  const dtrRollers: THREE.Mesh[] = [];
  const rcsPlumes: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial; groupIdx: number }> = [];
  let scanHeadPivot: THREE.Group | null = null;
  let lecpTurretGroup: THREE.Group | null = null;

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  // =========================================================================
  // 0. CORE INTERNAL STRUCTURAL SKELETON (Machined 10-Bay Aluminum Frame)
  // =========================================================================
  const coreSkeleton = new THREE.Group();
  coreSkeleton.name = 'CoreBusSkeleton';

  for (const [radius, tube, y] of [
    [0.84, 0.022, 0.235],
    [0.84, 0.022, -0.235],
    [0.45, 0.018, 0.225],
    [0.45, 0.018, -0.225],
    [0.66, 0.012, 0.232],
    [0.66, 0.012, -0.232],
  ]) {
    const m = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(radius, tube, 16, 10)),
      materials.brushedTitanium,
    );
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    coreSkeleton.add(m);
  }

  const stanchionGeo = trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.47, 16));
  const spokeGeo = createChamferedBox(0.38, 0.026, 0.032, 0.005, geometries);
  // Radial bulkhead web spans r=0.55..0.81, keeping the r=0.47..0.54 inner wiring raceway clear
  const webPlateGeo = createChamferedBox(0.26, 0.43, 0.014, 0.003, geometries);
  const busBolts: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }> = [];

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);

    const post = new THREE.Mesh(stanchionGeo, materials.structuralAluminum);
    post.position.set(c * 0.84, 0, s * 0.84);
    coreSkeleton.add(post);

    const innerPost = new THREE.Mesh(stanchionGeo, materials.brushedTitanium);
    innerPost.position.set(c * 0.45, 0, s * 0.45);
    coreSkeleton.add(innerPost);

    const web = new THREE.Mesh(webPlateGeo, materials.darkAnodizedAlloy);
    web.position.set(c * 0.68, 0, s * 0.68);
    web.rotation.y = -a;
    coreSkeleton.add(web);

    for (const y of [0.232, -0.232]) {
      const spoke = new THREE.Mesh(spokeGeo, materials.structuralAluminum);
      spoke.position.set(c * 0.65, y, s * 0.65);
      spoke.rotation.y = -a;
      coreSkeleton.add(spoke);

      busBolts.push({
        pos: new THREE.Vector3(c * 0.84, y + (y > 0 ? 0.024 : -0.024), s * 0.84),
        normal: new THREE.Vector3(0, y > 0 ? 1 : -1, 0),
      });
    }
  }

  coreSkeleton.add(
    createInstancedHexBolts(busBolts, 0.011, 0.012, materials.connectorGold, geometries),
  );

  // Central RF / Wiring Core Hub Pedestal with stepped collar rings & coaxial patch ring
  const hubProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.23, 0.0),
    new THREE.Vector2(0.23, 0.06),
    new THREE.Vector2(0.185, 0.09),
    new THREE.Vector2(0.165, 0.46),
    new THREE.Vector2(0.205, 0.49),
    new THREE.Vector2(0.205, 0.56),
    new THREE.Vector2(0.12, 0.56),
  ];
  const hubCyl = new THREE.Mesh(
    trackGeo(new THREE.LatheGeometry(hubProfile, 40)),
    materials.darkAnodizedAlloy,
  );
  coreSkeleton.add(hubCyl);

  const hubCollar = new THREE.Mesh(
    trackGeo(new THREE.TorusGeometry(0.185, 0.014, 12, 36)),
    materials.connectorGold,
  );
  hubCollar.rotation.x = Math.PI / 2;
  hubCollar.position.y = 0.52;
  coreSkeleton.add(hubCollar);

  coreSkeleton.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  tagThermalZone(coreSkeleton, 'avionics_warm');

  root.add(coreSkeleton);

  // =========================================================================
  // INTERNAL COLOR-CODED WIRING HARNESSES & LIVE SIGNAL TRACE
  // =========================================================================
  const wiring = createWiringNetwork(materials);
  root.add(wiring.group);

  const registerAssembly = (
    id: string,
    group: THREE.Group,
    subParts?: DetachableAssembly['subParts'],
  ) => {
    const spec = SUBSYSTEM_BY_ID[id];
    tagAssembly(group, id);
    root.add(group);
    clickableRoots.push(group);
    assemblies.set(id, {
      id,
      group,
      basePosition: group.position.clone(),
      explodeOffset: new THREE.Vector3(...spec.explodeOffset),
      anchorPoint: new THREE.Vector3(...spec.anchorPoint),
      currentFactor: 0,
      targetFactor: 0,
      subParts,
    });
  };

  // =========================================================================
  // 1. HIGH-GAIN PARABOLIC ANTENNA (3.7 m DISH — 128-SEG + 18 RIBS + DUAL WAVEGUIDES + LGA)
  // =========================================================================
  {
    const hga = new THREE.Group();
    const dishRadius = 1.83;
    const focalDepth = 0.55;
    const dishBaseY = 0.72;

    const lathePts: THREE.Vector2[] = [];
    const steps = 46;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = 0.09 + t * (dishRadius - 0.09);
      const y = ((r * r) / (dishRadius * dishRadius)) * focalDepth;
      lathePts.push(new THREE.Vector2(r, y));
    }
    // Rolled stiffening rim lip
    lathePts.push(new THREE.Vector2(dishRadius + 0.024, focalDepth + 0.01));
    lathePts.push(new THREE.Vector2(dishRadius + 0.028, focalDepth - 0.018));
    lathePts.push(new THREE.Vector2(dishRadius - 0.01, focalDepth - 0.046));
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const r = 0.09 + t * (dishRadius - 0.09);
      const y = ((r * r) / (dishRadius * dishRadius)) * focalDepth - 0.036;
      lathePts.push(new THREE.Vector2(r, y));
    }

    const dishMesh = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(lathePts, 128)),
      materials.hgaDishWhite,
    );
    dishMesh.position.y = dishBaseY;
    hga.add(dishMesh);

    // Rolled outer brushed aluminum rim trim + inner splice collar
    const outerRim = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(dishRadius + 0.008, 0.018, 16, 128)),
      materials.structuralAluminum,
    );
    outerRim.rotation.x = Math.PI / 2;
    outerRim.position.y = dishBaseY + focalDepth - 0.005;
    hga.add(outerRim);

    const innerCollar = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.32, 0.012, 12, 64)),
      materials.brushedTitanium,
    );
    innerCollar.rotation.x = Math.PI / 2;
    innerCollar.position.y = dishBaseY + 0.024;
    hga.add(innerCollar);

    // 18 physical 3D underside parabolic stiffening ribs
    const ribShape = new THREE.Shape();
    ribShape.moveTo(0.3, ((0.3 * 0.3) / (dishRadius * dishRadius)) * focalDepth - 0.035);
    for (let s = 1; s <= 14; s++) {
      const r = 0.3 + (s / 14) * (dishRadius - 0.33);
      const y = ((r * r) / (dishRadius * dishRadius)) * focalDepth - 0.034;
      ribShape.lineTo(r, y);
    }
    for (let s = 14; s >= 0; s--) {
      const r = 0.3 + (s / 14) * (dishRadius - 0.33);
      const depth = 0.044 + (1 - s / 14) * 0.04;
      const y = ((r * r) / (dishRadius * dishRadius)) * focalDepth - 0.036 - depth;
      ribShape.lineTo(r, y);
    }
    ribShape.closePath();

    const ribGeo = trackGeo(
      new THREE.ExtrudeGeometry(ribShape, {
        depth: 0.016,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.003,
        bevelSegments: 2,
      }),
    );
    ribGeo.translate(0, 0, -0.008);

    for (let i = 0; i < 18; i++) {
      const rib = new THREE.Mesh(ribGeo, materials.structuralAluminum);
      rib.position.y = dishBaseY;
      rib.rotation.y = (i / 18) * Math.PI * 2;
      hga.add(rib);
    }

    // 3 Concentric underside stiffening rings + 36 perimeter rim tie bolts
    const dishBolts: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }> = [];
    for (const r of [0.56, 0.96, 1.44]) {
      const ry = dishBaseY + ((r * r) / (dishRadius * dishRadius)) * focalDepth - 0.07;
      const ring = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(r, 0.019, 14, 72)),
        materials.brushedTitanium,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = ry;
      hga.add(ring);
    }

    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      dishBolts.push({
        pos: new THREE.Vector3(
          Math.cos(a) * (dishRadius - 0.035),
          dishBaseY + focalDepth + 0.005,
          Math.sin(a) * (dishRadius - 0.035),
        ),
        normal: new THREE.Vector3(0, 1, 0),
      });
    }

    // 10 triangulated titanium bus-to-dish mounting struts with machined upper & lower clevises
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const aNext = ((i + 0.5) / 10) * Math.PI * 2;
      const topPt = new THREE.Vector3(Math.cos(a) * 0.96, 0.81, Math.sin(a) * 0.96);
      const botPt = new THREE.Vector3(Math.cos(a) * 0.84, 0.27, Math.sin(a) * 0.84);
      const botNext = new THREE.Vector3(Math.cos(aNext) * 0.84, 0.27, Math.sin(aNext) * 0.84);
      hga.add(createStrut(topPt, botPt, 0.0155, materials.brushedTitanium, geometries, 14));
      hga.add(createStrut(topPt, botNext, 0.0105, materials.structuralAluminum, geometries, 10));

      for (const pt of [botPt, topPt]) {
        const clevis = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(0.026, 0.031, 0.044, 16)),
          materials.darkAnodizedAlloy,
        );
        clevis.position.copy(pt);
        hga.add(clevis);
      }
    }

    // Precision Corrugated S/X-Band Feed Horn (Multi-Choke LatheGeometry)
    const hornPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.29, 0.0),
      new THREE.Vector2(0.29, 0.042),
      new THREE.Vector2(0.235, 0.064),
      new THREE.Vector2(0.222, 0.28),
      new THREE.Vector2(0.192, 0.32),
      new THREE.Vector2(0.192, 0.38),
      new THREE.Vector2(0.162, 0.4),
      new THREE.Vector2(0.162, 0.46),
      new THREE.Vector2(0.138, 0.48),
      new THREE.Vector2(0.138, 0.54),
      new THREE.Vector2(0.118, 0.56),
      new THREE.Vector2(0.118, 0.65),
      new THREE.Vector2(0.14, 0.68),
      new THREE.Vector2(0.14, 0.725),
      new THREE.Vector2(0.098, 0.725),
      new THREE.Vector2(0.084, 0.54),
    ];
    const feedHorn = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(hornPts, 52)),
      materials.brushedTitanium,
    );
    feedHorn.position.y = dishBaseY + 0.01;
    hga.add(feedHorn);

    // Dark recessed feed throat + dual gold choke rings
    const throatCap = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.088, 32)),
      materials.opticalBaffleBlack,
    );
    throatCap.rotation.x = -Math.PI / 2;
    throatCap.position.y = dishBaseY + 0.68;
    hga.add(throatCap);

    for (const cy of [0.56, 0.73]) {
      const chokeRing = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(cy > 0.6 ? 0.122 : 0.145, 0.011, 14, 48)),
        materials.connectorGold,
      );
      chokeRing.rotation.x = Math.PI / 2;
      chokeRing.position.y = dishBaseY + cy;
      hga.add(chokeRing);
    }

    for (let b = 0; b < 18; b++) {
      const ba = (b / 18) * Math.PI * 2;
      dishBolts.push({
        pos: new THREE.Vector3(Math.cos(ba) * 0.265, dishBaseY + 0.048, Math.sin(ba) * 0.265),
        normal: new THREE.Vector3(0, 1, 0),
      });
    }

    // Hyperbolic Dichroic Cassegrain Sub-Reflector + Choked Low-Gain Antenna (LGA) Mast
    const subY = 2.02;
    const subProfile = [
      new THREE.Vector2(0.0, -0.055),
      new THREE.Vector2(0.068, -0.025),
      new THREE.Vector2(0.325, 0.052),
      new THREE.Vector2(0.358, 0.092),
      new THREE.Vector2(0.348, 0.144),
      new THREE.Vector2(0.245, 0.225),
      new THREE.Vector2(0.205, 0.345),
      new THREE.Vector2(0.088, 0.4),
      new THREE.Vector2(0.058, 0.425),
      new THREE.Vector2(0.045, 0.64),
      new THREE.Vector2(0.068, 0.66),
      new THREE.Vector2(0.068, 0.7),
      new THREE.Vector2(0.048, 0.715),
      new THREE.Vector2(0.048, 0.77),
      new THREE.Vector2(0.064, 0.795),
      new THREE.Vector2(0.064, 0.85),
      new THREE.Vector2(0.02, 0.88),
      new THREE.Vector2(0.0, 0.88),
    ];
    const subHousing = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(subProfile, 64)),
      materials.hgaSubReflector,
    );
    subHousing.position.y = subY;
    hga.add(subHousing);

    // Dichroic gold splash rim + LGA RF choke collar + ceramic radome tip
    const subGoldRim = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.352, 0.013, 14, 52)),
      materials.connectorGold,
    );
    subGoldRim.rotation.x = Math.PI / 2;
    subGoldRim.position.y = subY + 0.1;
    hga.add(subGoldRim);

    const lgaCollar = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.068, 0.009, 10, 32)),
      materials.connectorGold,
    );
    lgaCollar.rotation.x = Math.PI / 2;
    lgaCollar.position.y = subY + 0.68;
    hga.add(lgaCollar);

    const lgaTip = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.036, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5)),
      materials.ceramicInsulator,
    );
    lgaTip.position.y = subY + 0.855;
    hga.add(lgaTip);

    // 3 Tripod Feed Struts with clamp collars, gusset feet & dual copper/braided RF waveguides
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const dishR = 1.2;
      const dishY = dishBaseY + ((dishR * dishR) / (dishRadius * dishRadius)) * focalDepth;
      const dishPt = new THREE.Vector3(Math.cos(a) * dishR, dishY, Math.sin(a) * dishR);
      const subPt = new THREE.Vector3(Math.cos(a) * 0.295, subY + 0.08, Math.sin(a) * 0.295);

      const strutMesh = createStrut(dishPt, subPt, 0.024, materials.hgaDishWhite, geometries, 18);
      hga.add(strutMesh);

      // Machined mounting gusset foot + upper yoke bracket
      const foot = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.052, 0.072, 0.066, 20)),
        materials.darkAnodizedAlloy,
      );
      foot.position.copy(dishPt).add(new THREE.Vector3(0, 0.022, 0));
      hga.add(foot);

      const upperBracket = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.038, 0.038, 0.064, 18)),
        materials.brushedTitanium,
      );
      upperBracket.position.copy(subPt);
      hga.add(upperBracket);

      // 4 machined titanium cable-clamp collars along each tripod leg
      for (const ct of [0.22, 0.44, 0.66, 0.86]) {
        const cp = dishPt.clone().lerp(subPt, ct);
        const clamp = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(0.031, 0.031, 0.026, 16)),
          materials.brushedTitanium,
        );
        clamp.position.copy(cp);
        clamp.quaternion.copy(strutMesh.quaternion);
        hga.add(clamp);
      }

      // Clamp rigid copper RF waveguide to Strut 0 & braided S-band coax to Strut 1
      if (i === 0 || i === 1) {
        const wgOff = new THREE.Vector3(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
        hga.add(
          createStrut(
            dishPt.clone().add(wgOff),
            subPt.clone().add(wgOff),
            i === 0 ? 0.01 : 0.0085,
            i === 0 ? materials.copperCoil : materials.stainlessBraided,
            geometries,
            12,
          ),
        );
      }

      for (let fb = 0; fb < 4; fb++) {
        const fa = (fb / 4) * Math.PI * 2;
        dishBolts.push({
          pos: dishPt
            .clone()
            .add(new THREE.Vector3(Math.cos(fa) * 0.044, 0.055, Math.sin(fa) * 0.044)),
          normal: new THREE.Vector3(0, 1, 0),
        });
      }
    }

    hga.add(createInstancedHexBolts(dishBolts, 0.008, 0.01, materials.brushedTitanium, geometries));
    tagThermalZone(hga, 'space_cold');
    registerAssembly('hga', hga);
  }

  // =========================================================================
  // 2. DECAGONAL THERMAL SHROUD + CANOPUS STAR TRACKER + SUN SENSORS + CAL TARGET
  // =========================================================================
  {
    const shroud = new THREE.Group();
    const vertexR = 0.915;
    const outerR = vertexR * Math.cos(Math.PI / 10);
    const panelH = 0.5;
    const panelW = 2 * vertexR * Math.sin(Math.PI / 10) - 0.032;

    const bladeGeo = createChamferedBox(panelW - 0.075, 0.024, 0.006, 0.0015, geometries);
    const frameVertGeo = createChamferedBox(0.034, panelH, 0.038, 0.005, geometries);
    const frameHorizGeo = createChamferedBox(panelW, 0.034, 0.038, 0.005, geometries);
    const backPlateGeo = trackGeo(new THREE.BoxGeometry(panelW - 0.04, panelH - 0.04, 0.012));
    const actuatorCylGeo = trackGeo(new THREE.CylinderGeometry(0.017, 0.017, panelH - 0.07, 14));
    const linkageRodGeo = trackGeo(new THREE.CylinderGeometry(0.005, 0.005, panelH - 0.08, 10));
    const cornerTrimGeo = createChamferedBox(0.034, panelH + 0.04, 0.034, 0.006, geometries);
    const shroudBolts: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }> = [];

    const bayStencilGeo = trackGeo(new THREE.PlaneGeometry(0.24, 0.025));

    for (let i = 0; i < 10; i++) {
      // Machined titanium vertical corner gusset post at every decagon vertex
      const va = (i / 10) * Math.PI * 2;
      const vc = Math.cos(va);
      const vs = Math.sin(va);
      const cornerPost = new THREE.Mesh(cornerTrimGeo, materials.brushedTitanium);
      cornerPost.position.set(vc * vertexR, 0, vs * vertexR);
      cornerPost.lookAt(vc * 3, 0, vs * 3);
      shroud.add(cornerPost);

      for (const by of [-0.21, -0.07, 0.07, 0.21]) {
        shroudBolts.push({
          pos: new THREE.Vector3(vc * (vertexR + 0.019), by, vs * (vertexR + 0.019)),
          normal: new THREE.Vector3(vc, 0, vs),
        });
      }

      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      const c = Math.cos(a);
      const s = Math.sin(a);

      const bayFace = new THREE.Group();
      bayFace.position.set(c * outerR, 0, s * outerR);
      bayFace.lookAt(c * 3.0, 0, s * 3.0);

      const hasLouvers = i % 2 === 0 && i !== 2;

      if (hasLouvers) {
        const back = new THREE.Mesh(backPlateGeo, materials.busLouverPanel);
        back.position.z = -0.01;
        back.userData.thermalZone = 'louver_radiator';
        bayFace.add(back);

        for (const fx of [-(panelW / 2 - 0.016), panelW / 2 - 0.016]) {
          const post = new THREE.Mesh(frameVertGeo, materials.structuralAluminum);
          post.position.set(fx, 0, 0.004);
          bayFace.add(post);
        }
        for (const fy of [-(panelH / 2 - 0.016), panelH / 2 - 0.016]) {
          const rail = new THREE.Mesh(frameHorizGeo, materials.structuralAluminum);
          rail.position.set(0, fy, 0.004);
          bayFace.add(rail);
        }

        // Bimetallic thermal actuator cylinder + twin linkage rods
        const actuator = new THREE.Mesh(actuatorCylGeo, materials.brushedTitanium);
        actuator.position.set(panelW / 2 - 0.04, 0, 0.016);
        bayFace.add(actuator);

        for (const lx of [-panelW * 0.24, panelW * 0.24]) {
          const rod = new THREE.Mesh(linkageRodGeo, materials.connectorGold);
          rod.position.set(lx, 0, 0.022);
          bayFace.add(rod);
        }

        // 12 precision chamfered 3D aluminum louver blades
        const bladeCount = 12;
        const innerH = panelH - 0.085;
        for (let b = 0; b < bladeCount; b++) {
          const by = -innerH / 2 + (b + 0.5) * (innerH / bladeCount);
          const blade = new THREE.Mesh(bladeGeo, materials.structuralAluminum);
          blade.position.set(0, by, 0.014);
          blade.rotation.x = 0.44;
          blade.userData.thermalZone = 'avionics_warm';
          bayFace.add(blade);
        }

        // NASA/JPL anodized bay identification stencil nameplate flush on upper louver rail
        const stencil = new THREE.Mesh(bayStencilGeo, materials.bayStencilMaterials[i]);
        stencil.position.set(0, panelH / 2 - 0.016, 0.0245);
        stencil.userData.hideInThermal = true;
        bayFace.add(stencil);
      } else {
        const isBlackThermal = i === 1 || i === 5 || i === 7;
        const blanketGeo = createSculptedBlanketPanel(
          panelW - 0.01,
          panelH - 0.01,
          0.024,
          18,
          16,
          0.013,
          i * 2.17,
          geometries,
        );
        const blanket = new THREE.Mesh(
          blanketGeo,
          isBlackThermal ? materials.kaptonBlackThermal : materials.kaptonGoldFoil,
        );
        bayFace.add(blanket);

        // Perimeter aluminum Kapton retention trim strips + corner tie-down tabs
        for (const fy of [-(panelH / 2 - 0.013), panelH / 2 - 0.013]) {
          const strip = new THREE.Mesh(
            createChamferedBox(panelW, 0.026, 0.032, 0.004, geometries),
            materials.brushedTitanium,
          );
          strip.position.set(0, fy, 0.006);
          bayFace.add(strip);
        }

        // NASA/JPL anodized bay identification stencil nameplate flush on upper retention strip
        const stencil = new THREE.Mesh(bayStencilGeo, materials.bayStencilMaterials[i]);
        stencil.position.set(0, panelH / 2 - 0.013, 0.0235);
        stencil.userData.hideInThermal = true;
        bayFace.add(stencil);

        // Access service hatch port on Bay 3 (offset cleanly below/left of Canopus) & Bay 9
        if (i === 3 || i === 9) {
          const hx = i === 3 ? -0.1 : 0;
          const hy = i === 3 ? -0.11 : -0.04;
          const hatch = new THREE.Mesh(
            createChamferedBox(0.14, 0.11, 0.024, 0.005, geometries),
            materials.darkAnodizedAlloy,
          );
          hatch.position.set(hx, hy, 0.02);
          bayFace.add(hatch);
          const hatchConn = new THREE.Mesh(
            trackGeo(new THREE.CylinderGeometry(0.022, 0.024, 0.028, 16)),
            materials.connectorGold,
          );
          hatchConn.rotation.x = Math.PI / 2;
          hatchConn.position.set(hx + 0.025, hy, 0.032);
          bayFace.add(hatchConn);
        }
      }

      shroud.add(bayFace);
    }

    shroud.add(
      createInstancedHexBolts(shroudBolts, 0.007, 0.009, materials.structuralAluminum, geometries),
    );

    // Sculpted Top & Bottom Exact-Decagonal Annular Thermal Blankets
    const topBlanket = new THREE.Mesh(
      createSculptedAnnularBlanket(0.45, outerR, 12, 60, 0.007, 1.3, geometries),
      materials.kaptonBlackThermal,
    );
    topBlanket.rotation.x = -Math.PI / 2;
    topBlanket.position.y = 0.268;
    shroud.add(topBlanket);

    const botBlanket = new THREE.Mesh(
      createSculptedAnnularBlanket(0.36, outerR, 12, 60, 0.008, 4.7, geometries),
      materials.kaptonGoldFoil,
    );
    botBlanket.rotation.x = Math.PI / 2;
    botBlanket.position.y = -0.268;
    shroud.add(botBlanket);

    for (const y of [0.266, -0.266]) {
      const trim = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(vertexR, 0.015, 14, 10)),
        materials.structuralAluminum,
      );
      trim.rotation.x = Math.PI / 2;
      trim.position.y = y;
      shroud.add(trim);
    }

    // Authentic Voyager 2 Canopus Star Tracker Optical Hood (mounted flush on Bay 3 upper exterior)
    const cstAngle = (3 / 10) * Math.PI * 2 + Math.PI / 10;
    const canopus = new THREE.Group();
    canopus.position.set(Math.cos(cstAngle) * 0.945, 0.12, Math.sin(cstAngle) * 0.945);
    canopus.lookAt(Math.cos(cstAngle) * 3.0, 0.12, Math.sin(cstAngle) * 3.0);

    const cstBody = new THREE.Mesh(
      createChamferedBox(0.13, 0.125, 0.14, 0.012, geometries),
      materials.darkAnodizedAlloy,
    );
    canopus.add(cstBody);

    const cstFlange = new THREE.Mesh(
      createChamferedBox(0.155, 0.145, 0.06, 0.005, geometries),
      materials.brushedTitanium,
    );
    cstFlange.position.z = -0.072;
    canopus.add(cstFlange);

    const cstHoodPts = [
      new THREE.Vector2(0.048, 0.0),
      new THREE.Vector2(0.048, 0.075),
      new THREE.Vector2(0.072, 0.2),
      new THREE.Vector2(0.064, 0.2),
      new THREE.Vector2(0.04, 0.075),
    ];
    const cstHood = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(cstHoodPts, 32)),
      materials.structuralAluminum,
    );
    cstHood.rotation.x = Math.PI / 2;
    cstHood.position.z = 0.055;
    canopus.add(cstHood);

    const cstLens = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.039, 24)),
      materials.opticalLensGlass,
    );
    cstLens.position.z = 0.135;
    canopus.add(cstLens);
    shroud.add(canopus);

    // Twin Digital Acquisition Sun Sensor Blocks cleanly seated on upper deck inside HGA strut ring
    for (const sa of [Math.PI / 4, (3 * Math.PI) / 4]) {
      const sunSensor = new THREE.Group();
      sunSensor.position.set(Math.cos(sa) * 0.74, 0.298, Math.sin(sa) * 0.74);
      sunSensor.rotation.y = -sa;
      const ssBase = new THREE.Mesh(
        createChamferedBox(0.09, 0.056, 0.09, 0.008, geometries),
        materials.brushedTitanium,
      );
      sunSensor.add(ssBase);
      const ssAperture = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.022, 0.028, 0.022, 16)),
        materials.connectorGold,
      );
      ssAperture.position.y = 0.034;
      sunSensor.add(ssAperture);
      shroud.add(sunSensor);
    }

    // Authentic Voyager 2 JPL Photometric Calibration Target Plaque bolted flush onto Bay 1 exterior
    const calAngle = (1 / 10) * Math.PI * 2 + Math.PI / 10;
    const calGroup = new THREE.Group();
    calGroup.position.set(Math.cos(calAngle) * 0.912, -0.02, Math.sin(calAngle) * 0.912);
    calGroup.lookAt(Math.cos(calAngle) * 3.0, -0.02, Math.sin(calAngle) * 3.0);
    const calFrame = new THREE.Mesh(
      createChamferedBox(0.22, 0.18, 0.022, 0.004, geometries),
      materials.structuralAluminum,
    );
    calGroup.add(calFrame);
    const calFace = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(0.195, 0.155)),
      materials.calTargetPlaque,
    );
    calFace.position.z = 0.012;
    calGroup.add(calFace);
    for (const [bx, by] of [
      [-0.08, -0.06],
      [0.08, -0.06],
      [-0.08, 0.06],
      [0.08, 0.06],
    ]) {
      const spacer = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.042, 10)),
        materials.brushedTitanium,
      );
      spacer.rotation.x = Math.PI / 2;
      spacer.position.set(bx, by, -0.024);
      calGroup.add(spacer);
    }
    shroud.add(calGroup);

    tagThermalZone(shroud, 'mli_insulation');
    registerAssembly('bus_shroud', shroud);
  }

  // =========================================================================
  // 3. 10-BAY MODULAR AVIONICS & ELECTRONICS DECK (STACKED PCBS + EJECTORS + SPOKED DTR)
  // =========================================================================
  {
    const avionics = new THREE.Group();
    const baySubParts: NonNullable<DetachableAssembly['subParts']> = [];

    const sideWallGeo = createChamferedBox(0.018, 0.42, 0.24, 0.004, geometries);
    const topWallGeo = createChamferedBox(0.35, 0.018, 0.24, 0.004, geometries);
    const pcbGeo = trackGeo(new THREE.BoxGeometry(0.31, 0.37, 0.012));
    const icGeo = createChamferedBox(0.068, 0.045, 0.024, 0.004, geometries);
    const heatsinkGeo = trackGeo(new THREE.BoxGeometry(0.012, 0.11, 0.022));
    const capGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.036, 14));
    const toroidGeo = trackGeo(new THREE.TorusGeometry(0.022, 0.0085, 12, 20));
    const milConnGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.027, 0.038, 16));
    const handleBarGeo = trackGeo(new THREE.CylinderGeometry(0.0055, 0.0055, 0.14, 10));
    const dtrFlangeGeo = trackGeo(new THREE.CylinderGeometry(0.084, 0.084, 0.007, 36));
    const dtrTapePackGeo = trackGeo(new THREE.CylinderGeometry(0.072, 0.072, 0.034, 32));
    const dtrHubGeo = trackGeo(new THREE.CylinderGeometry(0.026, 0.026, 0.054, 18));
    const rollerGeo = trackGeo(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 14));

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      const c = Math.cos(a);
      const s = Math.sin(a);

      const bayGroup = new THREE.Group();
      const basePos = new THREE.Vector3(c * 0.66, 0, s * 0.66);
      bayGroup.position.copy(basePos);
      bayGroup.lookAt(c * 3.0, 0, s * 3.0);

      for (const sx of [-0.165, 0.165]) {
        const wall = new THREE.Mesh(sideWallGeo, materials.structuralAluminum);
        wall.position.x = sx;
        bayGroup.add(wall);
      }
      for (const sy of [-0.2, 0.2]) {
        const cap = new THREE.Mesh(topWallGeo, materials.darkAnodizedAlloy);
        cap.position.y = sy;
        bayGroup.add(cap);
      }

      // 3 Stacked Aerospace PCB Daughterboards + gold backplane bus bar
      for (const pz of [-0.08, 0.0, 0.08]) {
        const pcb = new THREE.Mesh(pcbGeo, materials.avionicsPcb);
        pcb.position.z = pz;
        bayGroup.add(pcb);
      }

      const busBar = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(0.32, 0.018, 0.014)),
        materials.connectorGold,
      );
      busBar.position.set(0, -0.185, 0.095);
      bayGroup.add(busBar);

      // 3D Surface-Mounted Ceramic ICs, Gold Hermetic Cans, Heatsink Fins, Capacitors & Toroids
      const ic1 = new THREE.Mesh(icGeo, materials.darkAnodizedAlloy);
      ic1.position.set(-0.08, 0.095, 0.102);
      bayGroup.add(ic1);

      const ic2 = new THREE.Mesh(icGeo, materials.connectorGold);
      ic2.position.set(0.075, 0.08, 0.102);
      bayGroup.add(ic2);

      // Mini anodized heatsink fin stack on outer avionics board
      for (let hf = 0; hf < 4; hf++) {
        const fin = new THREE.Mesh(heatsinkGeo, materials.brushedTitanium);
        fin.position.set(-0.11 + hf * 0.019, -0.075, 0.102);
        bayGroup.add(fin);
      }

      const toroid = new THREE.Mesh(toroidGeo, materials.copperCoil);
      toroid.position.set(0.08, -0.085, 0.104);
      bayGroup.add(toroid);

      for (let k = 0; k < 3; k++) {
        const cap = new THREE.Mesh(capGeo, materials.structuralAluminum);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(-0.035 + k * 0.036, 0.005, 0.104);
        bayGroup.add(cap);
      }

      // Twin knurled circular MIL-DTL-38999 umbilical connectors
      for (const cx of [-0.072, 0.072]) {
        const conn = new THREE.Mesh(milConnGeo, materials.connectorGold);
        conn.rotation.x = Math.PI / 2;
        conn.position.set(cx, -0.15, 0.118);
        bayGroup.add(conn);
      }

      // Front aerospace U-shaped module pull handle
      const pullBar = new THREE.Mesh(handleBarGeo, materials.structuralAluminum);
      pullBar.rotation.z = Math.PI / 2;
      pullBar.position.set(0, 0.168, 0.132);
      bayGroup.add(pullBar);
      for (const px of [-0.068, 0.068]) {
        const standoff = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.026, 8)),
          materials.brushedTitanium,
        );
        standoff.rotation.x = Math.PI / 2;
        standoff.position.set(px, 0.168, 0.118);
        bayGroup.add(standoff);
      }

      // Bay 7: Iconic Voyager 2 Twin-Reel Digital Tape Recorder (DTR) with animated reels & guide rollers
      if (i === 6) {
        const spokeNotchGeo = trackGeo(new THREE.BoxGeometry(0.056, 0.011, 0.006));
        for (const ry of [-0.095, 0.095]) {
          const reelGroup = new THREE.Group();
          reelGroup.position.set(-0.015, ry, 0.128);

          const pack = new THREE.Mesh(dtrTapePackGeo, materials.darkAnodizedAlloy);
          pack.rotation.x = Math.PI / 2;
          reelGroup.add(pack);

          for (const fz of [-0.016, 0.018]) {
            const flange = new THREE.Mesh(dtrFlangeGeo, materials.copperCoil);
            flange.rotation.x = Math.PI / 2;
            flange.position.z = fz;
            reelGroup.add(flange);
          }

          // 3 radial machined index ribs on the outer flange so DTR reel rotation reads clearly
          for (let sp = 0; sp < 3; sp++) {
            const sa = (sp / 3) * Math.PI * 2;
            const rib = new THREE.Mesh(spokeNotchGeo, materials.darkAnodizedAlloy);
            rib.position.set(Math.cos(sa) * 0.044, Math.sin(sa) * 0.044, 0.022);
            rib.rotation.z = sa;
            reelGroup.add(rib);
          }

          const hub = new THREE.Mesh(dtrHubGeo, materials.brushedTitanium);
          hub.rotation.x = Math.PI / 2;
          hub.position.z = 0.002;
          reelGroup.add(hub);

          bayGroup.add(reelGroup);
          dtrReels.push(reelGroup);
        }

        // 3 Precision stainless tape guide rollers + read/write head
        for (const [rx, ry] of [
          [0.095, 0.065],
          [0.095, -0.065],
          [0.118, 0.0],
        ]) {
          const roller = new THREE.Mesh(rollerGeo, materials.structuralAluminum);
          roller.rotation.x = Math.PI / 2;
          roller.position.set(rx, ry, 0.13);
          bayGroup.add(roller);
          dtrRollers.push(roller);
        }

        const rwHead = new THREE.Mesh(
          createChamferedBox(0.048, 0.072, 0.04, 0.006, geometries),
          materials.brushedTitanium,
        );
        rwHead.position.set(0.092, 0, 0.128);
        bayGroup.add(rwHead);
      }

      avionics.add(bayGroup);
      baySubParts.push({
        obj: bayGroup,
        basePos,
        extraOffset: new THREE.Vector3(c * 0.78, 0, s * 0.78),
      });
    }

    tagThermalZone(avionics, 'avionics_warm');
    registerAssembly('avionics_bays', avionics, baySubParts);
  }

  // =========================================================================
  // 4. HYDRAZINE CORE SPHERICAL TANK, V-STRUT CRADLE & 16 MR-103 BELL THRUSTERS
  // =========================================================================
  {
    const prop = new THREE.Group();

    const tank = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.355, 64, 48)),
      materials.hydrazineTitanium,
    );
    tank.position.y = -0.06;
    prop.add(tank);

    // Machined equatorial girth weld flange + 24 instanced bolts
    const eqRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.362, 0.02, 16, 64)),
      materials.brushedTitanium,
    );
    eqRing.rotation.x = Math.PI / 2;
    eqRing.position.y = -0.06;
    prop.add(eqRing);

    const tankBolts: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }> = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      tankBolts.push({
        pos: new THREE.Vector3(Math.cos(a) * 0.378, -0.06, Math.sin(a) * 0.378),
        normal: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
      });
    }
    prop.add(createInstancedHexBolts(tankBolts, 0.007, 0.01, materials.connectorGold, geometries));

    // 6 Titanium V-strut mounting cradle rods anchoring tank to inner bus frame
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tPt = new THREE.Vector3(Math.cos(a) * 0.35, -0.06, Math.sin(a) * 0.35);
      const bPt = new THREE.Vector3(
        Math.cos(a + 0.25) * 0.45,
        i % 2 === 0 ? 0.22 : -0.22,
        Math.sin(a + 0.25) * 0.45,
      );
      prop.add(createStrut(tPt, bPt, 0.01, materials.brushedTitanium, geometries, 10));
    }

    // Sculpted crinkled lower thermal hemisphere blanket
    const lowerGeo = trackGeo(
      new THREE.SphereGeometry(0.365, 48, 24, 0, Math.PI * 2, Math.PI * 0.54, Math.PI * 0.46),
    );
    const lPos = lowerGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lPos.count; i++) {
      const x = lPos.getX(i);
      const y = lPos.getY(i);
      const z = lPos.getZ(i);
      const cr = 1 + Math.sin(x * 28 + z * 24) * Math.cos(y * 32) * 0.017;
      lPos.setXYZ(i, x * cr, y * cr, z * cr);
    }
    lowerGeo.computeVertexNormals();
    const lowerWrap = new THREE.Mesh(lowerGeo, materials.kaptonGoldFoil);
    lowerWrap.position.y = -0.06;
    prop.add(lowerWrap);

    // Pressurant manifold, regulator dome & twin fill/drain service valves
    const domeProfile = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.155, 0.0),
      new THREE.Vector2(0.145, 0.06),
      new THREE.Vector2(0.115, 0.09),
      new THREE.Vector2(0.115, 0.175),
      new THREE.Vector2(0.064, 0.215),
      new THREE.Vector2(0.0, 0.215),
    ];
    const dome = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(domeProfile, 36)),
      materials.darkAnodizedAlloy,
    );
    dome.rotation.x = Math.PI;
    dome.position.y = -0.37;
    prop.add(dome);

    for (const va of [0.6, 3.74]) {
      const valve = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.022, 0.026, 0.065, 16)),
        materials.connectorGold,
      );
      valve.position.set(Math.cos(va) * 0.14, -0.44, Math.sin(va) * 0.14);
      valve.rotation.z = Math.cos(va) * 0.6;
      prop.add(valve);
    }

    // 16 Precision Turned MR-103 Catalytic Hydrazine Bell Thrusters + Catalyst Heater Barrels
    const bellPts = [
      new THREE.Vector2(0.008, 0.0),
      new THREE.Vector2(0.015, 0.008),
      new THREE.Vector2(0.015, 0.024),
      new THREE.Vector2(0.009, 0.032),
      new THREE.Vector2(0.019, 0.052),
      new THREE.Vector2(0.028, 0.08),
      new THREE.Vector2(0.024, 0.08),
      new THREE.Vector2(0.015, 0.05),
    ];
    const nozzleGeo = trackGeo(new THREE.LatheGeometry(bellPts, 24));
    const podGeo = createChamferedBox(0.11, 0.08, 0.11, 0.012, geometries);
    const nutGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 6));
    const rcsPlumeGeo = trackGeo(new THREE.CylinderGeometry(0.088, 0.018, 0.34, 20, 1, true));
    rcsPlumeGeo.translate(0, 0.17, 0);

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const pod = new THREE.Mesh(podGeo, materials.structuralAluminum);
      pod.position.set(c * 0.62, -0.34, s * 0.62);
      pod.rotation.y = -a;
      prop.add(pod);

      // Curved stainless/copper hydrazine feed line + Swagelok compression nuts
      const lineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(c * 0.12, -0.44, s * 0.12),
        new THREE.Vector3(c * 0.36, -0.42, s * 0.36),
        new THREE.Vector3(c * 0.62, -0.34, s * 0.62),
      ]);
      const lineMesh = new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(lineCurve, 22, 0.0085, 10, false)),
        materials.copperCoil,
      );
      prop.add(lineMesh);

      const nut = new THREE.Mesh(nutGeo, materials.brushedTitanium);
      nut.position.set(c * 0.56, -0.36, s * 0.56);
      nut.rotation.z = Math.PI / 2;
      nut.rotation.y = -a;
      prop.add(nut);

      for (let n = 0; n < 4; n++) {
        const na = a + (n - 1.5) * 0.48;
        const nozzle = new THREE.Mesh(nozzleGeo, materials.thrusterBluedAlloy);
        nozzle.position.set(
          c * 0.62 + Math.cos(na) * 0.058,
          -0.37,
          s * 0.62 + Math.sin(na) * 0.058,
        );
        nozzle.rotation.z = n % 2 === 0 ? 0.55 : -0.55;
        nozzle.rotation.x = Math.PI;
        nozzle.userData.thermalZone = 'louver_radiator';

        // Attach subtle catalytic cold-gas exhaust plume to opposing attitude-control jets
        if (n === 0 || n === 3) {
          const plumeMat = createRcsPlumeMaterial();
          localMaterials.push(plumeMat);
          const plume = new THREE.Mesh(rcsPlumeGeo, plumeMat);
          plume.position.y = 0.076;
          plume.visible = false;
          plume.renderOrder = 8;
          plume.userData.hideInThermal = true;
          plume.userData.nonPickable = true;
          plume.layers.set(0);
          plume.castShadow = false;
          plume.receiveShadow = false;
          plume.raycast = () => {};
          nozzle.add(plume);
          // Opposing pod pairs share a firing groupIdx (0..3) for realistic couple torques
          const groupIdx = (i % 2) * 2 + (n === 0 ? 0 : 1);
          rcsPlumes.push({ mesh: plume, mat: plumeMat, groupIdx });
        }

        prop.add(nozzle);
      }
    }

    tagThermalZone(prop, 'hydrazine_heated');
    registerAssembly('hydrazine_core', prop);
  }

  // =========================================================================
  // 5. VOYAGER GOLDEN RECORD, RETAINING CLAMPS & STOWED STYLUS PICKUP
  // =========================================================================
  {
    const gr = new THREE.Group();
    gr.position.set(0, 0, 0.918);

    // Stepped stand-off mounting collar seating flush back to Bay 2 outer wall (z = 0.870)
    const bezelProfile = [
      new THREE.Vector2(0.0, -0.048),
      new THREE.Vector2(0.212, -0.048),
      new THREE.Vector2(0.212, 0.014),
      new THREE.Vector2(0.194, 0.026),
      new THREE.Vector2(0.172, 0.026),
      new THREE.Vector2(0.172, 0.004),
      new THREE.Vector2(0.0, 0.004),
    ];
    const bezel = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(bezelProfile, 64)),
      materials.structuralAluminum,
    );
    bezel.rotation.x = Math.PI / 2;
    gr.add(bezel);

    // 4 Authentic machined radial retaining clamp lugs + 8 instanced hex bolts
    const lugGeo = createChamferedBox(0.036, 0.022, 0.03, 0.004, geometries);
    const grBolts: Array<{ pos: THREE.Vector3; normal: THREE.Vector3 }> = [];
    for (let b = 0; b < 8; b++) {
      const ba = (b / 8) * Math.PI * 2 + Math.PI / 8;
      grBolts.push({
        pos: new THREE.Vector3(Math.cos(ba) * 0.197, Math.sin(ba) * 0.197, 0.02),
        normal: new THREE.Vector3(0, 0, 1),
      });
      if (b % 2 === 0) {
        const lug = new THREE.Mesh(lugGeo, materials.brushedTitanium);
        lug.position.set(Math.cos(ba) * 0.188, Math.sin(ba) * 0.188, 0.028);
        lug.rotation.z = ba;
        gr.add(lug);
      }
    }
    gr.add(createInstancedHexBolts(grBolts, 0.0085, 0.012, materials.connectorGold, geometries));

    // Inner Gold-Plated Copper Phonograph Disc + Stowed Miniature Stylus Cartridge Bracket
    const innerDisc = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.168, 0.168, 0.008, 64)),
      materials.goldenRecordDisc,
    );
    innerDisc.rotation.x = Math.PI / 2;
    innerDisc.position.z = 0.016;
    gr.add(innerDisc);

    // Stowed playback stylus & cartridge tucked inside rim (revealed when cover separates)
    const stylusCart = new THREE.Mesh(
      createChamferedBox(0.032, 0.018, 0.014, 0.003, geometries),
      materials.darkAnodizedAlloy,
    );
    stylusCart.position.set(0.11, -0.08, 0.026);
    stylusCart.rotation.z = 0.55;
    gr.add(stylusCart);

    // Outer Engraved Gold-Anodized Cover (beveled rim + deep etched diagram)
    const cover = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.175, 0.18, 0.016, 64)),
      materials.goldenRecordCover,
    );
    cover.rotation.x = Math.PI / 2;
    cover.rotation.y = Math.PI / 2;
    cover.position.z = 0.036;
    gr.add(cover);

    const coverBevelRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.176, 0.007, 12, 64)),
      materials.connectorGold,
    );
    coverBevelRing.position.z = 0.042;
    gr.add(coverBevelRing);

    const centerCap = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.014, 0.017, 0.024, 6)),
      materials.brushedTitanium,
    );
    centerCap.rotation.x = Math.PI / 2;
    centerCap.position.z = 0.04;
    gr.add(centerCap);

    tagThermalZone(gr, 'mli_insulation');
    registerAssembly('golden_record', gr, [
      {
        obj: cover,
        basePos: cover.position.clone(),
        extraOffset: new THREE.Vector3(0, 0, 0.3),
      },
      {
        obj: coverBevelRing,
        basePos: coverBevelRing.position.clone(),
        extraOffset: new THREE.Vector3(0, 0, 0.3),
      },
      {
        obj: centerCap,
        basePos: centerCap.position.clone(),
        extraOffset: new THREE.Vector3(0, 0, 0.3),
      },
    ]);
  }

  // =========================================================================
  // 6. TRIPLE MHW-RTG POWER BOOM (HEAT-TINTED COUPLERS + FLUTED FINS + POWER JUMPERS)
  // =========================================================================
  {
    const rtg = new THREE.Group();

    const rootPt = new THREE.Vector3(-0.88, -0.18, 0.12);
    const tipPt = new THREE.Vector3(-3.38, -0.84, 0.42);
    const boomDir = new THREE.Vector3().subVectors(tipPt, rootPt).normalize();
    const boomQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      boomDir,
    );

    // Hinged bus deployment lock knuckle seated flush outside the decagonal bus shroud
    const hingeBlock = new THREE.Mesh(
      createChamferedBox(0.18, 0.2, 0.22, 0.016, geometries),
      materials.darkAnodizedAlloy,
    );
    hingeBlock.position.copy(rootPt).addScaledVector(boomDir, 0.095);
    hingeBlock.quaternion.copy(boomQuat);
    rtg.add(hingeBlock);

    const perp1 = new THREE.Vector3(0, 1, 0).cross(boomDir).normalize().multiplyScalar(0.125);
    const perp2 = new THREE.Vector3().crossVectors(boomDir, perp1).normalize().multiplyScalar(0.125);
    const midPt = rootPt.clone().lerp(tipPt, 0.36);

    const triOffs = [
      perp1,
      perp1.clone().multiplyScalar(-0.5).add(perp2.clone().multiplyScalar(0.866)),
      perp1.clone().multiplyScalar(-0.5).add(perp2.clone().multiplyScalar(-0.866)),
    ];

    for (let i = 0; i < 3; i++) {
      const a0 = rootPt.clone().add(triOffs[i]);
      const a1 = midPt.clone().add(triOffs[i].clone().multiplyScalar(0.75));
      const b1 = midPt.clone().add(triOffs[(i + 1) % 3].clone().multiplyScalar(0.75));
      rtg.add(createStrut(a0, a1, 0.017, materials.brushedTitanium, geometries, 14));
      rtg.add(createStrut(a0, b1, 0.0095, materials.structuralAluminum, geometries, 10));

      const clevis = new THREE.Mesh(
        trackGeo(new THREE.SphereGeometry(0.025, 14, 12)),
        materials.darkAnodizedAlloy,
      );
      clevis.position.copy(a1);
      rtg.add(clevis);
    }

    // Stepped MHW-RTG SiGe Unicouple Casing LatheGeometry
    const rtgPts = [
      new THREE.Vector2(0.0, -0.3),
      new THREE.Vector2(0.148, -0.3),
      new THREE.Vector2(0.192, -0.268),
      new THREE.Vector2(0.212, -0.258),
      new THREE.Vector2(0.212, -0.23),
      new THREE.Vector2(0.196, -0.226),
      new THREE.Vector2(0.196, -0.022),
      new THREE.Vector2(0.21, -0.016),
      new THREE.Vector2(0.21, 0.016),
      new THREE.Vector2(0.196, 0.022),
      new THREE.Vector2(0.196, 0.226),
      new THREE.Vector2(0.212, 0.23),
      new THREE.Vector2(0.212, 0.258),
      new THREE.Vector2(0.192, 0.268),
      new THREE.Vector2(0.148, 0.3),
      new THREE.Vector2(0.0, 0.3),
    ];
    const rtgBodyGeo = trackGeo(new THREE.LatheGeometry(rtgPts, 48));

    // Tapered beveled radiator fin with stiffening edge
    const finShape = new THREE.Shape();
    finShape.moveTo(0, -0.242);
    finShape.lineTo(0.105, -0.212);
    finShape.lineTo(0.105, 0.212);
    finShape.lineTo(0, 0.242);
    finShape.closePath();
    const finGeo = trackGeo(
      new THREE.ExtrudeGeometry(finShape, {
        depth: 0.013,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.003,
        bevelSegments: 2,
      }),
    );
    finGeo.translate(0, 0, -0.0065);

    const clampGeo = trackGeo(new THREE.TorusGeometry(0.215, 0.014, 14, 48));
    const outerTieRingGeo = trackGeo(new THREE.TorusGeometry(0.292, 0.006, 10, 40));
    const jBoxGeo = createChamferedBox(0.075, 0.11, 0.052, 0.007, geometries);
    const standoffGeo = trackGeo(new THREE.CylinderGeometry(0.009, 0.011, 0.028, 12));
    const boltLocalGeo = trackGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.018, 6));

    const rtgCenters: THREE.Vector3[] = [];

    for (let k = 0; k < 3; k++) {
      const t = 0.44 + k * 0.268;
      const center = rootPt.clone().lerp(tipPt, t);
      rtgCenters.push(center);

      const unit = new THREE.Group();
      unit.position.copy(center);
      unit.quaternion.copy(boomQuat);

      unit.add(new THREE.Mesh(rtgBodyGeo, materials.rtgCarbonShell));

      // 8 radial beveled cooling fins phased by +22.5° so junction box & jumper clear every fin
      for (let f = 0; f < 8; f++) {
        const fa = (f / 8) * Math.PI * 2 + Math.PI / 8;
        const fin = new THREE.Mesh(finGeo, materials.rtgFinBlack);
        fin.position.set(Math.cos(fa) * 0.192, 0, Math.sin(fa) * 0.192);
        fin.rotation.y = -fa;
        fin.userData.thermalZone = 'rtg_fin';
        unit.add(fin);
      }

      const tieRing = new THREE.Mesh(outerTieRingGeo, materials.rtgHeatCollar);
      tieRing.rotation.x = Math.PI / 2;
      tieRing.userData.thermalZone = 'rtg_fin';
      unit.add(tieRing);

      // Heat-tinted bronze-titanium clamping collars + 16 bolts per collar
      for (const cy of [-0.244, 0.0, 0.244]) {
        const clamp = new THREE.Mesh(clampGeo, materials.rtgHeatCollar);
        clamp.rotation.x = Math.PI / 2;
        clamp.position.y = cy;
        unit.add(clamp);

        for (let b = 0; b < 16; b++) {
          const ba = (b / 16) * Math.PI * 2;
          const bolt = new THREE.Mesh(boltLocalGeo, materials.structuralAluminum);
          bolt.position.set(Math.cos(ba) * 0.222, cy, Math.sin(ba) * 0.222);
          bolt.rotation.z = Math.PI / 2;
          bolt.rotation.y = -ba;
          unit.add(bolt);
        }
      }

      // High-current 30V DC terminal junction box + dual glazed porcelain standoffs (between fins)
      const jBox = new THREE.Mesh(jBoxGeo, materials.brushedTitanium);
      jBox.position.set(0, -0.1, 0.222);
      jBox.userData.thermalZone = 'rtg_fin';
      unit.add(jBox);

      for (const sx of [-0.018, 0.018]) {
        const so = new THREE.Mesh(standoffGeo, materials.ceramicInsulator);
        so.rotation.x = Math.PI / 2;
        so.position.set(sx, -0.1, 0.252);
        so.userData.thermalZone = 'rtg_fin';
        unit.add(so);
      }

      tagThermalZone(unit, 'rtg_core');
      rtg.add(unit);
    }

    // Faceted Kapton-wrapped Radiation/Thermal Baffle Cone + Titanium Trim Ring
    const shieldPos = rootPt.clone().lerp(tipPt, 0.27);
    const shieldCone = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.23, 0.27, 36)),
      materials.kaptonGoldFoil,
    );
    shieldCone.position.copy(shieldPos);
    shieldCone.quaternion.copy(boomQuat);
    rtg.add(shieldCone);

    const shieldRimPos = shieldPos.clone().addScaledVector(boomDir, -0.13);
    const shieldRim = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.23, 0.011, 10, 36)),
      materials.brushedTitanium,
    );
    shieldRim.position.copy(shieldRimPos);
    shieldRim.quaternion.copy(boomQuat);
    shieldRim.rotateX(Math.PI / 2);
    rtg.add(shieldRim);

    // Pass-through clamp fairing on shield rim so copper jumper skirts around rim without clipping
    const rimPassPt = shieldRimPos.clone().add(new THREE.Vector3(0, 0, 0.252).applyQuaternion(boomQuat));
    const rimClamp = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 14)),
      materials.brushedTitanium,
    );
    rimClamp.position.copy(rimPassPt);
    rimClamp.quaternion.copy(boomQuat);
    rtg.add(rimClamp);

    // Daisy-chained braided copper RTG jumper aligned in local RTG frame clearing radiation baffle cone
    const jumperLocalOff = new THREE.Vector3(0, -0.1, 0.266).applyQuaternion(boomQuat);
    const rootJumperOff = new THREE.Vector3(0, 0.08, 0.145).applyQuaternion(boomQuat);
    const jumperPts = [
      rootPt.clone().add(rootJumperOff),
      rimPassPt,
      rtgCenters[0].clone().add(jumperLocalOff),
      rtgCenters[1].clone().add(jumperLocalOff),
      rtgCenters[2].clone().add(jumperLocalOff),
    ];
    const jumperCurve = new THREE.CatmullRomCurve3(jumperPts);
    rtg.add(
      new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(jumperCurve, 52, 0.011, 10, false)),
        materials.copperCoil,
      ),
    );

    tagThermalZone(rtg, 'rtg_boom');
    registerAssembly('rtg_stack', rtg);
  }

  // =========================================================================
  // 7. SCIENCE SCAN PLATFORM & 2-AXIS ARTICULATED BOOM (+X)
  // =========================================================================
  {
    const scanBoom = new THREE.Group();
    const sStart = new THREE.Vector3(0.86, 0.0, 0.0);
    const sEnd = new THREE.Vector3(2.81, -0.05, 0.0);

    const triOffsets = [
      new THREE.Vector3(0, 0.145, 0),
      new THREE.Vector3(0, -0.105, 0.135),
      new THREE.Vector3(0, -0.105, -0.135),
    ];

    for (const off of triOffsets) {
      scanBoom.add(
        createStrut(
          sStart.clone().add(off),
          sEnd.clone().add(off.clone().multiplyScalar(0.8)),
          0.0165,
          materials.structuralAluminum,
          geometries,
          14,
        ),
      );
    }

    const clevisNodeGeo = trackGeo(new THREE.SphereGeometry(0.023, 14, 12));
    const clampTrayGeo = createChamferedBox(0.032, 0.034, 0.055, 0.005, geometries);
    const bays = 8;
    for (let b = 0; b <= bays; b++) {
      const t0 = b / bays;
      for (let e = 0; e < 3; e++) {
        const oA = triOffsets[e];
        const oB = triOffsets[(e + 1) % 3];
        const p0 = sStart.clone().lerp(sEnd, t0).add(oA.clone().multiplyScalar(1 - t0 * 0.2));
        const pB = sStart.clone().lerp(sEnd, t0).add(oB.clone().multiplyScalar(1 - t0 * 0.2));

        const node = new THREE.Mesh(clevisNodeGeo, materials.darkAnodizedAlloy);
        node.position.copy(p0);
        scanBoom.add(node);

        scanBoom.add(createStrut(p0, pB, 0.0085, materials.brushedTitanium, geometries, 8));

        if (b < bays) {
          const t1 = (b + 1) / bays;
          const p1 = sStart.clone().lerp(sEnd, t1).add(oB.clone().multiplyScalar(1 - t1 * 0.2));
          scanBoom.add(createStrut(p0, p1, 0.008, materials.brushedTitanium, geometries, 8));
        }
      }

      // External braided cable tray clamps along lower truss rail
      if (b > 0 && b < bays) {
        const trayPt = sStart.clone().lerp(sEnd, t0).add(new THREE.Vector3(0, -0.105, 0.125));
        const tray = new THREE.Mesh(clampTrayGeo, materials.brushedTitanium);
        tray.position.copy(trayPt);
        scanBoom.add(tray);
      }
    }

    // Braided metallic umbilical conduit running along stationary science boom to gimbal base
    const boomConduitCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.88, -0.105, 0.14),
      new THREE.Vector3(1.85, -0.115, 0.13),
      new THREE.Vector3(2.68, -0.11, 0.11),
      new THREE.Vector3(2.81, -0.12, 0.075),
    ]);
    scanBoom.add(
      new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(boomConduitCurve, 32, 0.013, 12, false)),
        materials.stainlessBraided,
      ),
    );

    // Precision 2-Axis Harmonic-Drive Gimbal Actuator + Stepper Motor Can + Articulated Scan Head Pivot
    const gimbalPts = [
      new THREE.Vector2(0.0, -0.16),
      new THREE.Vector2(0.145, -0.16),
      new THREE.Vector2(0.155, -0.13),
      new THREE.Vector2(0.155, -0.04),
      new THREE.Vector2(0.135, -0.02),
      new THREE.Vector2(0.135, 0.055),
      new THREE.Vector2(0.152, 0.075),
      new THREE.Vector2(0.152, 0.14),
      new THREE.Vector2(0.108, 0.16),
      new THREE.Vector2(0.0, 0.16),
    ];
    const gimbal = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(gimbalPts, 40)),
      materials.darkAnodizedAlloy,
    );
    gimbal.position.set(2.81, -0.05, 0);
    scanBoom.add(gimbal);

    for (const gy of [-0.105, 0.082]) {
      const gimbalRing = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.156, 0.012, 14, 40)),
        materials.connectorGold,
      );
      gimbalRing.rotation.x = Math.PI / 2;
      gimbalRing.position.set(2.81, gy, 0);
      scanBoom.add(gimbalRing);
    }

    // Elevation drive stepper motor can & resolver encoder on side of gimbal
    const stepperCan = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.062, 0.062, 0.12, 24)),
      materials.brushedTitanium,
    );
    stepperCan.rotation.x = Math.PI / 2;
    stepperCan.position.set(2.81, -0.04, -0.2);
    scanBoom.add(stepperCan);

    // Articulated 2-Axis Scan Head Group pivoting cleanly around gimbal center (2.81, -0.05, 0)
    scanHeadPivot = new THREE.Group();
    scanHeadPivot.name = 'ScanHeadPivot';
    scanHeadPivot.position.copy(_scanPivot);
    scanBoom.add(scanHeadPivot);

    // Horizontal titanium yoke drive shaft bridging gimbal to scan platform plate cleanly
    const yokeSpindle = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.046, 0.046, 0.14, 24)),
      materials.brushedTitanium,
    );
    yokeSpindle.rotation.z = Math.PI / 2;
    yokeSpindle.position.set(0.15, 0.01, 0.01);
    scanHeadPivot.add(yokeSpindle);

    // Flexible umbilical service loop moving cleanly with the articulated scan head
    const headFlexCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, -0.07, 0.075),
      new THREE.Vector3(0.12, -0.11, 0.135),
      new THREE.Vector3(0.22, -0.01, 0.11),
    ]);
    scanHeadPivot.add(
      new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(headFlexCurve, 18, 0.0115, 10, false)),
        materials.stainlessBraided,
      ),
    );

    // Chamfered CNC-pocketed Scan Platform Yoke Plate (spans local X = 0.21..0.29) + Rear Kapton MLI Blanket
    const plate = new THREE.Mesh(
      createChamferedBox(0.08, 0.66, 0.72, 0.014, geometries),
      materials.structuralAluminum,
    );
    plate.position.set(0.25, 0.01, 0.02);
    scanHeadPivot.add(plate);

    const goldJacket = new THREE.Mesh(
      createSculptedBlanketPanel(0.64, 0.6, 0.032, 16, 16, 0.009, 7.2, geometries),
      materials.kaptonGoldFoil,
    );
    goldJacket.rotation.y = -Math.PI / 2;
    goldJacket.position.set(0.194, 0.01, 0.02);
    scanHeadPivot.add(goldJacket);

    tagThermalZone(scanBoom, 'space_cold');
    registerAssembly('scan_platform_boom', scanBoom);
  }

  // =========================================================================
  // 8. ISS — IMAGING SCIENCE SUBSYSTEM (CASSEGRAIN SPIDER + FILTER WHEELS + COATED LENSES)
  // =========================================================================
  {
    const iss = new THREE.Group();
    iss.position.set(3.24, 0.18, 0.04);

    // Narrow-Angle Camera (1500 mm Cassegrain stepped barrel + flared stray-light baffle hood)
    const nacPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.116, 0.0),
      new THREE.Vector2(0.116, 0.14),
      new THREE.Vector2(0.108, 0.16),
      new THREE.Vector2(0.108, 0.36),
      new THREE.Vector2(0.116, 0.38),
      new THREE.Vector2(0.138, 0.54),
      new THREE.Vector2(0.128, 0.54),
      new THREE.Vector2(0.1, 0.38),
      new THREE.Vector2(0.092, 0.35),
      new THREE.Vector2(0.0, 0.35),
    ];
    const nacTube = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(nacPts, 52)),
      materials.darkAnodizedAlloy,
    );
    nacTube.rotation.z = -Math.PI / 2;
    nacTube.position.set(-0.08, 0.03, -0.06);
    iss.add(nacTube);

    // Internal Martin-Black stray-light baffle backing + 3 spider vanes + secondary mirror
    const nacBaffleBack = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.091, 36)),
      materials.opticalBaffleBlack,
    );
    nacBaffleBack.rotation.y = Math.PI / 2;
    nacBaffleBack.position.set(0.28, 0.03, -0.06);
    iss.add(nacBaffleBack);

    const nacLens = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.093, 44)),
      materials.opticalLensGlass,
    );
    nacLens.rotation.y = Math.PI / 2;
    nacLens.position.set(0.315, 0.03, -0.06);
    iss.add(nacLens);

    const nacSec = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.03, 0.034, 0.04, 24)),
      materials.brushedTitanium,
    );
    nacSec.rotation.z = -Math.PI / 2;
    nacSec.position.set(0.335, 0.03, -0.06);
    iss.add(nacSec);

    for (let v = 0; v < 3; v++) {
      const va = (v / 3) * Math.PI * 2 + 0.5;
      iss.add(
        createStrut(
          new THREE.Vector3(0.335, 0.03 + Math.cos(va) * 0.03, -0.06 + Math.sin(va) * 0.03),
          new THREE.Vector3(0.34, 0.03 + Math.cos(va) * 0.106, -0.06 + Math.sin(va) * 0.106),
          0.004,
          materials.darkAnodizedAlloy,
          geometries,
          8,
        ),
      );
    }

    // Brushed titanium optical clamping bands + gold lens trim bezel
    for (const [bx, r] of [
      [0.02, 0.115],
      [0.2, 0.111],
      [0.32, 0.117],
    ]) {
      const band = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(r, 0.008, 12, 40)),
        materials.brushedTitanium,
      );
      band.rotation.y = Math.PI / 2;
      band.position.set(bx, 0.03, -0.06);
      iss.add(band);
    }

    // 8-Position Motorized Filter Wheel Bulge on NAC upper flank (clear of UVS)
    const nacFilterWheel = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.068, 0.068, 0.042, 28)),
      materials.structuralAluminum,
    );
    nacFilterWheel.rotation.z = -Math.PI / 2;
    nacFilterWheel.position.set(0.0, 0.11, -0.125);
    iss.add(nacFilterWheel);

    // Wide-Angle Camera (200 mm lens + chamfered electronics box)
    const wacBox = new THREE.Mesh(
      createChamferedBox(0.22, 0.16, 0.18, 0.014, geometries),
      materials.structuralAluminum,
    );
    wacBox.position.set(0.03, 0.01, 0.14);
    iss.add(wacBox);

    const wacPts = [
      new THREE.Vector2(0.066, 0.0),
      new THREE.Vector2(0.066, 0.08),
      new THREE.Vector2(0.06, 0.1),
      new THREE.Vector2(0.076, 0.21),
      new THREE.Vector2(0.068, 0.21),
      new THREE.Vector2(0.052, 0.12),
    ];
    const wacBarrel = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(wacPts, 40)),
      materials.darkAnodizedAlloy,
    );
    wacBarrel.rotation.z = -Math.PI / 2;
    wacBarrel.position.set(0.13, 0.01, 0.14);
    iss.add(wacBarrel);

    const wacBack = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.051, 28)),
      materials.opticalBaffleBlack,
    );
    wacBack.rotation.y = Math.PI / 2;
    wacBack.position.set(0.245, 0.01, 0.14);
    iss.add(wacBack);

    const wacLens = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.053, 36)),
      materials.opticalLensGlass,
    );
    wacLens.rotation.y = Math.PI / 2;
    wacLens.position.set(0.265, 0.01, 0.14);
    iss.add(wacLens);

    const wacTrim = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.072, 0.006, 10, 36)),
      materials.connectorGold,
    );
    wacTrim.rotation.y = Math.PI / 2;
    wacTrim.position.set(0.338, 0.01, 0.14);
    iss.add(wacTrim);

    // Sculpted Kapton rear vidicon thermal jacket seated flush against scan platform front face (X = 3.10)
    const backJacket = new THREE.Mesh(
      createSculptedBlanketPanel(0.36, 0.22, 0.055, 12, 10, 0.007, 8.1, geometries),
      materials.kaptonGoldFoil,
    );
    backJacket.rotation.y = Math.PI / 2;
    backJacket.position.set(-0.105, 0.02, 0.02);
    iss.add(backJacket);

    tagThermalZone(iss, 'space_cold');
    registerAssembly('iss', iss);
  }

  // =========================================================================
  // 9. IRIS — INFRARED INTERFEROMETER SPECTROMETER (RECESSED GOLD MIRROR + 4-VANE SPIDER)
  // =========================================================================
  {
    const iris = new THREE.Group();
    iris.position.set(3.26, -0.16, 0.21);

    const barrelPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.148, 0.0),
      new THREE.Vector2(0.148, 0.34),
      new THREE.Vector2(0.136, 0.355),
      new THREE.Vector2(0.13, 0.34),
      new THREE.Vector2(0.13, 0.06),
      new THREE.Vector2(0.0, 0.05),
    ];
    const barrel = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(barrelPts, 52)),
      materials.kaptonGoldFoil,
    );
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.set(0.02, 0, 0);
    iris.add(barrel);

    // Recessed gold Cassegrain primary mirror + central optical bore
    const primaryMirror = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.128, 44)),
      materials.goldMirror,
    );
    primaryMirror.rotation.y = Math.PI / 2;
    primaryMirror.position.set(0.09, 0, 0);
    iris.add(primaryMirror);

    const primaryBore = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.034, 24)),
      materials.opticalBaffleBlack,
    );
    primaryBore.rotation.y = Math.PI / 2;
    primaryBore.position.set(0.094, 0, 0);
    iris.add(primaryBore);

    // 2 Internal matte stray-light annular baffle rings
    for (const bx of [0.18, 0.27]) {
      const baffle = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.124, 0.008, 10, 40)),
        materials.opticalBaffleBlack,
      );
      baffle.rotation.y = Math.PI / 2;
      baffle.position.set(bx, 0, 0);
      iris.add(baffle);
    }

    // Gold aperture lip + 4 blackened spider vanes + conical secondary mirror baffle
    const rim = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.14, 0.014, 14, 52)),
      materials.connectorGold,
    );
    rim.rotation.y = Math.PI / 2;
    rim.position.set(0.365, 0, 0);
    iris.add(rim);

    const secMirror = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.04, 0.046, 0.042, 28)),
      materials.brushedTitanium,
    );
    secMirror.rotation.z = -Math.PI / 2;
    secMirror.position.set(0.325, 0, 0);
    iris.add(secMirror);

    for (let v = 0; v < 4; v++) {
      const va = (v / 4) * Math.PI * 2 + Math.PI / 4;
      iris.add(
        createStrut(
          new THREE.Vector3(0.325, Math.cos(va) * 0.04, Math.sin(va) * 0.04),
          new THREE.Vector3(0.335, Math.cos(va) * 0.136, Math.sin(va) * 0.136),
          0.0045,
          materials.darkAnodizedAlloy,
          geometries,
          8,
        ),
      );
    }

    // Chamfered Michelson interferometer cube seated flush forward of scan plate (X = 3.10)
    const cube = new THREE.Mesh(
      createChamferedBox(0.18, 0.24, 0.24, 0.015, geometries),
      materials.darkAnodizedAlloy,
    );
    cube.position.set(-0.06, 0, 0);
    iris.add(cube);

    const irisMountPad = new THREE.Mesh(
      createChamferedBox(0.016, 0.21, 0.21, 0.003, geometries),
      materials.brushedTitanium,
    );
    irisMountPad.position.set(-0.154, 0, 0);
    iris.add(irisMountPad);

    for (let f = -4; f <= 4; f++) {
      const fin = new THREE.Mesh(
        createChamferedBox(0.155, 0.009, 0.19, 0.002, geometries),
        materials.structuralAluminum,
      );
      fin.position.set(-0.06, f * 0.024, 0.135);
      iris.add(fin);
    }

    tagThermalZone(iris, 'space_cold');
    registerAssembly('iris', iris);
  }

  // =========================================================================
  // 10. UVS — ULTRAVIOLET SPECTROMETER (13 KNIFE-EDGE BAFFLES + SOLAR OCCULTATION PORT)
  // =========================================================================
  {
    const uvs = new THREE.Group();
    uvs.position.set(3.24, 0.15, -0.26);

    const housing = new THREE.Mesh(
      createChamferedBox(0.24, 0.13, 0.14, 0.013, geometries),
      materials.darkAnodizedAlloy,
    );
    housing.position.set(-0.01, 0, 0);
    uvs.add(housing);

    // Cylindrical concave grating spectrometer chamber (flush inside plate clearance)
    const chamber = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.064, 0.064, 0.15, 28)),
      materials.brushedTitanium,
    );
    chamber.position.set(-0.06, 0, 0);
    uvs.add(chamber);

    // Authentic 20°-angled Solar Occultation Port tube on top of UVS
    const occTube = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.02, 0.024, 0.13, 18)),
      materials.structuralAluminum,
    );
    occTube.position.set(0.05, 0.085, -0.02);
    occTube.rotation.z = -1.22;
    uvs.add(occTube);

    // Open-front machined collimator baffle hood
    const hoodTop = new THREE.Mesh(
      createChamferedBox(0.19, 0.014, 0.122, 0.003, geometries),
      materials.structuralAluminum,
    );
    hoodTop.position.set(0.195, 0.048, 0);
    uvs.add(hoodTop);

    const hoodBot = hoodTop.clone();
    hoodBot.position.y = -0.048;
    uvs.add(hoodBot);

    const slatGeo = trackGeo(new THREE.BoxGeometry(0.17, 0.084, 0.004));
    for (let s = -6; s <= 6; s++) {
      const slat = new THREE.Mesh(slatGeo, materials.opticalBaffleBlack);
      slat.position.set(0.195, 0, s * 0.009);
      uvs.add(slat);
    }

    tagThermalZone(uvs, 'space_cold');
    registerAssembly('uvs', uvs);
  }

  // =========================================================================
  // 11. PPS — PHOTOPOLARIMETER SUBSYSTEM (DAHL-KIRKHAM OPTICS + ANALYZER WHEEL)
  // =========================================================================
  {
    const pps = new THREE.Group();
    pps.position.set(3.26, -0.24, -0.19);

    const tubePts = [
      new THREE.Vector2(0.07, 0.0),
      new THREE.Vector2(0.07, 0.2),
      new THREE.Vector2(0.084, 0.31),
      new THREE.Vector2(0.074, 0.31),
      new THREE.Vector2(0.06, 0.2),
    ];
    const tube = new THREE.Mesh(
      trackGeo(new THREE.LatheGeometry(tubePts, 40)),
      materials.structuralAluminum,
    );
    tube.rotation.z = -Math.PI / 2;
    tube.position.set(0.01, 0, 0);
    pps.add(tube);

    const backBaffle = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.058, 28)),
      materials.opticalBaffleBlack,
    );
    backBaffle.rotation.y = Math.PI / 2;
    backBaffle.position.set(0.22, 0, 0);
    pps.add(backBaffle);

    const lens = new THREE.Mesh(
      trackGeo(new THREE.CircleGeometry(0.06, 36)),
      materials.opticalLensGlass,
    );
    lens.rotation.y = Math.PI / 2;
    lens.position.set(0.24, 0, 0);
    pps.add(lens);

    const wheelHousing = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.096, 0.096, 0.09, 36)),
      materials.darkAnodizedAlloy,
    );
    wheelHousing.rotation.z = -Math.PI / 2;
    wheelHousing.position.set(-0.03, 0, 0);
    pps.add(wheelHousing);

    const wheelRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.096, 0.0095, 12, 36)),
      materials.connectorGold,
    );
    wheelRing.rotation.y = Math.PI / 2;
    wheelRing.position.set(0.015, 0, 0);
    pps.add(wheelRing);

    const pmtBox = new THREE.Mesh(
      createChamferedBox(0.08, 0.11, 0.11, 0.01, geometries),
      materials.brushedTitanium,
    );
    pmtBox.position.set(-0.115, 0, 0);
    pps.add(pmtBox);

    tagThermalZone(pps, 'space_cold');
    registerAssembly('pps', pps);
  }

  // =========================================================================
  // 12. PLS — PLASMA SCIENCE EXPERIMENT (4 FARADAY CUPS + 3D CROSSED GOLD MODULATOR GRIDS)
  // =========================================================================
  {
    const pls = new THREE.Group();
    pls.position.set(1.82, 0.21, 0.2);

    const base = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.168, 0.182, 0.125, 36)),
      materials.kaptonGoldFoil,
    );
    pls.add(base);

    // Twin aluminum truss mounting clamp struts anchoring PLS cleanly to science boom rails
    for (const sx of [-0.08, 0.08]) {
      pls.add(
        createStrut(
          new THREE.Vector3(sx, -0.055, -0.06),
          new THREE.Vector3(sx, -0.108, -0.195),
          0.01,
          materials.brushedTitanium,
          geometries,
          10,
        ),
      );
      pls.add(
        createStrut(
          new THREE.Vector3(sx, -0.055, 0.02),
          new THREE.Vector3(sx, -0.325, -0.075),
          0.009,
          materials.structuralAluminum,
          geometries,
          10,
        ),
      );
    }

    const flange = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.172, 0.013, 12, 36)),
      materials.brushedTitanium,
    );
    flange.rotation.x = Math.PI / 2;
    flange.position.y = 0.058;
    pls.add(flange);

    const cupPts = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.058, 0.0),
      new THREE.Vector2(0.054, 0.086),
      new THREE.Vector2(0.045, 0.1),
      new THREE.Vector2(0.039, 0.1),
      new THREE.Vector2(0.039, 0.038),
      new THREE.Vector2(0.0, 0.038),
    ];
    const cupGeo = trackGeo(new THREE.LatheGeometry(cupPts, 32));
    const gridRingGeo = trackGeo(new THREE.TorusGeometry(0.04, 0.005, 10, 28));
    const innerGridGeo = trackGeo(new THREE.TorusGeometry(0.023, 0.0035, 8, 22));
    const wireBarGeo = trackGeo(new THREE.CylinderGeometry(0.002, 0.002, 0.076, 6));

    const buildFaradayCup = (): THREE.Group => {
      const cupGroup = new THREE.Group();
      cupGroup.add(new THREE.Mesh(cupGeo, materials.brushedTitanium));

      const cupInterior = new THREE.Mesh(
        trackGeo(new THREE.CircleGeometry(0.038, 24)),
        materials.opticalBaffleBlack,
      );
      cupInterior.rotation.x = -Math.PI / 2;
      cupInterior.position.y = 0.042;
      cupGroup.add(cupInterior);

      const outerG = new THREE.Mesh(gridRingGeo, materials.connectorGold);
      outerG.rotation.x = Math.PI / 2;
      outerG.position.y = 0.097;
      cupGroup.add(outerG);

      const innerG = new THREE.Mesh(innerGridGeo, materials.connectorGold);
      innerG.rotation.x = Math.PI / 2;
      innerG.position.y = 0.086;
      cupGroup.add(innerG);

      // Authentic crossed gold-tungsten fine modulator grid wires
      for (let w = 0; w < 3; w++) {
        const wire = new THREE.Mesh(wireBarGeo, materials.connectorGold);
        wire.rotation.z = Math.PI / 2;
        wire.rotation.y = (w / 3) * Math.PI;
        wire.position.y = 0.092;
        cupGroup.add(wire);
      }
      return cupGroup;
    };

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const cupGroup = buildFaradayCup();
      cupGroup.position.set(Math.cos(a) * 0.08, 0.048, Math.sin(a) * 0.08);
      cupGroup.rotation.z = Math.cos(a) * 0.24;
      cupGroup.rotation.x = -Math.sin(a) * 0.24;
      pls.add(cupGroup);
    }

    const latGroup = buildFaradayCup();
    latGroup.position.set(0, 0.015, 0.162);
    latGroup.rotation.x = Math.PI / 2;
    pls.add(latGroup);

    tagThermalZone(pls, 'space_cold');
    registerAssembly('pls', pls);
  }

  // =========================================================================
  // 13. LECP — LOW-ENERGY CHARGED PARTICLES (TOOTHED STEPPER + DUAL GOLD COLLIMATORS)
  // =========================================================================
  {
    const lecp = new THREE.Group();
    lecp.position.set(1.56, 0.22, -0.22);

    const pedPts = [
      new THREE.Vector2(0.0, -0.06),
      new THREE.Vector2(0.128, -0.06),
      new THREE.Vector2(0.118, 0.02),
      new THREE.Vector2(0.134, 0.032),
      new THREE.Vector2(0.134, 0.058),
      new THREE.Vector2(0.104, 0.068),
      new THREE.Vector2(0.0, 0.068),
    ];
    lecp.add(
      new THREE.Mesh(trackGeo(new THREE.LatheGeometry(pedPts, 36)), materials.darkAnodizedAlloy),
    );

    // Machined titanium diagonal mounting yoke anchoring LECP pedestal to science boom rails
    for (const sx of [-0.075, 0.075]) {
      lecp.add(
        createStrut(
          new THREE.Vector3(sx, -0.055, 0.04),
          new THREE.Vector3(sx, -0.105, 0.215),
          0.01,
          materials.brushedTitanium,
          geometries,
          10,
        ),
      );
      lecp.add(
        createStrut(
          new THREE.Vector3(sx, -0.055, -0.02),
          new THREE.Vector3(sx, -0.335, 0.095),
          0.009,
          materials.structuralAluminum,
          geometries,
          10,
        ),
      );
    }

    const gearRing = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.126, 0.012, 12, 36)),
      materials.connectorGold,
    );
    gearRing.rotation.x = Math.PI / 2;
    gearRing.position.y = 0.046;
    lecp.add(gearRing);

    // 8-Sector Rotating Stepper Turret Group pivoting smoothly above stationary pedestal & gearRing
    lecpTurretGroup = new THREE.Group();
    lecpTurretGroup.name = 'LecpStepperTurret';
    lecp.add(lecpTurretGroup);

    const turret = new THREE.Mesh(
      createChamferedBox(0.225, 0.145, 0.195, 0.015, geometries),
      materials.structuralAluminum,
    );
    turret.position.y = 0.138;
    lecpTurretGroup.add(turret);

    const telePts = [
      new THREE.Vector2(0.054, 0.0),
      new THREE.Vector2(0.05, 0.08),
      new THREE.Vector2(0.042, 0.145),
      new THREE.Vector2(0.034, 0.145),
      new THREE.Vector2(0.034, 0.06),
    ];
    const teleGeo = trackGeo(new THREE.LatheGeometry(telePts, 32));
    for (const tz of [-0.048, 0.048]) {
      const tele = new THREE.Mesh(teleGeo, materials.connectorGold);
      tele.rotation.z = -Math.PI / 2;
      tele.position.set(0.1, 0.148, tz);
      lecpTurretGroup.add(tele);

      const bore = new THREE.Mesh(
        trackGeo(new THREE.CircleGeometry(0.033, 20)),
        materials.opticalBaffleBlack,
      );
      bore.rotation.y = Math.PI / 2;
      bore.position.set(0.23, 0.148, tz);
      lecpTurretGroup.add(bore);
    }

    // Chamfered aluminized calibration sunshield + dual support struts
    const shield = new THREE.Mesh(
      createChamferedBox(0.024, 0.2, 0.25, 0.004, geometries),
      materials.kaptonSilverFoil,
    );
    shield.position.set(-0.15, 0.148, 0);
    lecpTurretGroup.add(shield);

    for (const sz of [-0.08, 0.08]) {
      lecpTurretGroup.add(
        createStrut(
          new THREE.Vector3(-0.08, 0.14, sz),
          new THREE.Vector3(-0.14, 0.14, sz),
          0.008,
          materials.brushedTitanium,
          geometries,
          8,
        ),
      );
    }

    tagThermalZone(lecp, 'instrument_active');
    registerAssembly('lecp', lecp);
  }

  // =========================================================================
  // 14. CRS — COSMIC RAY SUBSYSTEM (7 STEPPED SILICON-STACK TELESCOPES + GOLD BEZELS)
  // =========================================================================
  {
    const crs = new THREE.Group();
    crs.position.set(1.46, -0.205, 0.135);

    const chassis = new THREE.Mesh(
      createChamferedBox(0.29, 0.165, 0.26, 0.016, geometries),
      materials.darkAnodizedAlloy,
    );
    crs.add(chassis);

    const topFrame = new THREE.Mesh(
      createChamferedBox(0.31, 0.024, 0.28, 0.005, geometries),
      materials.structuralAluminum,
    );
    topFrame.position.y = 0.084;
    crs.add(topFrame);

    // Twin titanium truss rail clamp brackets gripping the lower science boom rail
    for (const cx of [-0.11, 0.11]) {
      const clamp = new THREE.Mesh(
        createChamferedBox(0.032, 0.032, 0.052, 0.004, geometries),
        materials.brushedTitanium,
      );
      clamp.position.set(cx, 0.095, -0.008);
      crs.add(clamp);
    }

    const hetPts = [
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.038, 0.11),
      new THREE.Vector2(0.044, 0.12),
      new THREE.Vector2(0.044, 0.155),
      new THREE.Vector2(0.032, 0.17),
      new THREE.Vector2(0.025, 0.17),
      new THREE.Vector2(0.025, 0.08),
    ];
    const letPts = [
      new THREE.Vector2(0.025, 0.0),
      new THREE.Vector2(0.025, 0.1),
      new THREE.Vector2(0.03, 0.112),
      new THREE.Vector2(0.024, 0.14),
      new THREE.Vector2(0.017, 0.14),
      new THREE.Vector2(0.017, 0.06),
    ];
    const hetGeo = trackGeo(new THREE.LatheGeometry(hetPts, 28));
    const letGeo = trackGeo(new THREE.LatheGeometry(letPts, 24));
    const hetGoldRing = trackGeo(new THREE.TorusGeometry(0.03, 0.005, 8, 24));
    const letGoldRing = trackGeo(new THREE.TorusGeometry(0.021, 0.004, 8, 20));

    for (let i = 0; i < 7; i++) {
      const isHet = i < 2;
      const tGroup = new THREE.Group();
      const col = (i % 4) - 1.5;
      const row = Math.floor(i / 4) - 0.5;
      tGroup.position.set(col * 0.06, -0.06, row * 0.098);
      tGroup.rotation.x = Math.PI;
      tGroup.rotation.z = col * 0.18;

      tGroup.add(
        new THREE.Mesh(
          isHet ? hetGeo : letGeo,
          isHet ? materials.brushedTitanium : materials.structuralAluminum,
        ),
      );
      const bezelRing = new THREE.Mesh(
        isHet ? hetGoldRing : letGoldRing,
        materials.connectorGold,
      );
      bezelRing.rotation.x = Math.PI / 2;
      bezelRing.position.y = isHet ? 0.168 : 0.138;
      tGroup.add(bezelRing);

      crs.add(tGroup);
    }

    tagThermalZone(crs, 'instrument_active');
    registerAssembly('crs', crs);
  }

  // =========================================================================
  // 15. MAG — 13 m COLLAPSIBLE ASTROMAST BOOM + HELICAL CABLE + HELMHOLTZ COILS
  // =========================================================================
  {
    const mag = new THREE.Group();

    // Deployment canister with stepped collars & latch lugs
    const canister = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.148, 0.158, 0.36, 36)),
      materials.kaptonGoldFoil,
    );
    canister.rotation.x = Math.PI / 2;
    canister.position.set(-0.14, 0.06, -1.04);
    mag.add(canister);

    for (const cz of [-0.87, -1.04, -1.21]) {
      const collar = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.156, 0.013, 12, 36)),
        materials.brushedTitanium,
      );
      collar.position.set(-0.14, 0.06, cz);
      mag.add(collar);
    }

    const mStart = new THREE.Vector3(-0.14, 0.06, -1.21);
    const mEnd = new THREE.Vector3(-0.28, 0.16, -8.4);
    const rad = 0.092;
    const verts = [
      new THREE.Vector3(0, rad, 0),
      new THREE.Vector3(rad * 0.866, -rad * 0.5, 0),
      new THREE.Vector3(-rad * 0.866, -rad * 0.5, 0),
    ];

    for (const v of verts) {
      mag.add(
        createStrut(
          mStart.clone().add(v),
          mEnd.clone().add(v),
          0.0085,
          materials.fiberglassBoom,
          geometries,
          10,
        ),
      );
    }

    const segments = 32;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const cPt = mStart.clone().lerp(mEnd, t);
      for (let e = 0; e < 3; e++) {
        const a = cPt.clone().add(verts[e]);
        const b = cPt.clone().add(verts[(e + 1) % 3]);
        mag.add(createStrut(a, b, 0.0048, materials.fiberglassBoom, geometries, 6));

        if (i < segments) {
          const nextPt = mStart.clone().lerp(mEnd, (i + 1) / segments);
          const bNext = nextPt.clone().add(verts[(e + 1) % 3]);
          mag.add(createStrut(a, bNext, 0.0028, materials.structuralAluminum, geometries, 6));
        }
      }
    }

    // Authentic helical braided twisted-pair signal harness spiraling down interior of MAG boom
    const helixPts: THREE.Vector3[] = [];
    for (let h = 0; h <= 64; h++) {
      const t = h / 64;
      const cPt = mStart.clone().lerp(mEnd, t);
      const ang = t * Math.PI * 16;
      helixPts.push(cPt.add(new THREE.Vector3(Math.cos(ang) * 0.036, Math.sin(ang) * 0.036, 0)));
    }
    mag.add(
      new THREE.Mesh(
        trackGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 96, 0.006, 6, false)),
        materials.stainlessBraided,
      ),
    );

    // High-Field Bus Sensor + truss clamp bracket
    const hfAnchor = mStart.clone().lerp(mEnd, 0.06);
    const highField = new THREE.Mesh(
      createChamferedBox(0.12, 0.12, 0.15, 0.012, geometries),
      materials.darkAnodizedAlloy,
    );
    highField.position.copy(hfAnchor).add(new THREE.Vector3(0.135, 0, 0));
    mag.add(highField);
    mag.add(
      createStrut(
        hfAnchor.clone().add(new THREE.Vector3(0.065, 0, 0)),
        hfAnchor.clone().add(new THREE.Vector3(0.135, 0, 0)),
        0.012,
        materials.brushedTitanium,
        geometries,
        10,
      ),
    );

    // Inboard Low-Field Fluxgate Sensor Canister + Helmholtz copper calibration rings
    const inboardPos = mStart.clone().lerp(mEnd, 0.55);
    const inboard = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.074, 0.074, 0.25, 32)),
      materials.kaptonGoldFoil,
    );
    inboard.rotation.x = Math.PI / 2;
    inboard.position.copy(inboardPos);
    mag.add(inboard);

    for (const iz of [-0.08, 0.08]) {
      const coil = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.079, 0.009, 10, 28)),
        materials.copperCoil,
      );
      coil.position.copy(inboardPos).add(new THREE.Vector3(0, 0, iz));
      mag.add(coil);
    }

    // Outboard Tip Triaxial Fluxgate Sensor Canister + gold/copper coil rings
    const outboard = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.084, 0.078, 0.29, 36)),
      materials.kaptonGoldFoil,
    );
    outboard.rotation.x = Math.PI / 2;
    outboard.position.copy(mEnd);
    mag.add(outboard);

    for (const tz of [-0.115, 0.0, 0.115]) {
      const tipRing = new THREE.Mesh(
        trackGeo(new THREE.TorusGeometry(0.088, 0.011, 12, 32)),
        tz === 0 ? materials.copperCoil : materials.connectorGold,
      );
      tipRing.position.copy(mEnd).add(new THREE.Vector3(0, 0, tz));
      mag.add(tipRing);
    }

    highField.userData.thermalZone = 'instrument_active';
    inboard.userData.thermalZone = 'instrument_active';
    outboard.userData.thermalZone = 'instrument_active';
    canister.userData.thermalZone = 'mli_insulation';
    tagThermalZone(mag, 'space_cold');
    registerAssembly('mag_boom', mag);
  }

  // =========================================================================
  // 16. PRA / PWS — TWIN ORTHOGONAL 10 m WHIP ANTENNAS + FERRULE COLLARS
  // =========================================================================
  {
    const whips = new THREE.Group();
    const basePt = new THREE.Vector3(-0.74, -0.2, -0.74);

    // Titanium mounting stanchion bridging exterior coupler cleanly back to bus corner
    whips.add(
      createStrut(
        new THREE.Vector3(-0.62, -0.2, -0.62),
        basePt,
        0.026,
        materials.brushedTitanium,
        geometries,
        14,
      ),
    );

    const coupler = new THREE.Mesh(
      createChamferedBox(0.21, 0.18, 0.21, 0.015, geometries),
      materials.darkAnodizedAlloy,
    );
    coupler.position.copy(basePt);
    coupler.rotation.y = Math.PI / 4;
    whips.add(coupler);

    const couplerLid = new THREE.Mesh(
      createChamferedBox(0.225, 0.022, 0.225, 0.005, geometries),
      materials.structuralAluminum,
    );
    couplerLid.position.copy(basePt).add(new THREE.Vector3(0, 0.088, 0));
    couplerLid.rotation.y = Math.PI / 4;
    whips.add(couplerLid);

    // Dual SMA coaxial RF feed-through connector stubs
    for (const sx of [-0.048, 0.048]) {
      const sma = new THREE.Mesh(
        trackGeo(new THREE.CylinderGeometry(0.013, 0.015, 0.038, 14)),
        materials.connectorGold,
      );
      sma.position.copy(basePt).add(new THREE.Vector3(sx, 0.11, 0.04));
      whips.add(sma);
    }

    // Glazed ribbed high-voltage alumina porcelain feed-through insulators
    const insPts = [
      new THREE.Vector2(0.038, 0.0),
      new THREE.Vector2(0.038, 0.042),
      new THREE.Vector2(0.026, 0.062),
      new THREE.Vector2(0.037, 0.088),
      new THREE.Vector2(0.024, 0.114),
      new THREE.Vector2(0.035, 0.14),
      new THREE.Vector2(0.021, 0.17),
      new THREE.Vector2(0.027, 0.225),
      new THREE.Vector2(0.018, 0.245),
    ];
    const insGeo = trackGeo(new THREE.LatheGeometry(insPts, 32));
    const upVec = new THREE.Vector3(0, 1, 0);

    const whipDirs = [
      new THREE.Vector3(-0.82, -0.22, -0.52).normalize(),
      new THREE.Vector3(-0.22, -0.78, -0.58).normalize(),
    ];

    for (const dir of whipDirs) {
      const ins = new THREE.Mesh(insGeo, materials.ceramicInsulator);
      ins.position.copy(basePt);
      ins.quaternion.setFromUnitVectors(upVec, dir);
      whips.add(ins);

      // 4-stage telescoping beryllium-copper tubular whip with machined titanium ferrule collars
      const stages: Array<[number, number, number]> = [
        [0.245, 1.4, 0.017],
        [1.4, 2.8, 0.014],
        [2.8, 4.2, 0.011],
        [4.2, 5.65, 0.008],
      ];
      for (const [d0, d1, rad] of stages) {
        whips.add(
          createStrut(
            basePt.clone().addScaledVector(dir, d0),
            basePt.clone().addScaledVector(dir, d1),
            rad,
            materials.berylliumWhip,
            geometries,
            16,
          ),
        );
        // Telescoping joint ferrule collar
        const ferrule = new THREE.Mesh(
          trackGeo(new THREE.CylinderGeometry(rad * 1.32, rad * 1.32, 0.045, 14)),
          materials.brushedTitanium,
        );
        ferrule.position.copy(basePt.clone().addScaledVector(dir, d0));
        ferrule.quaternion.setFromUnitVectors(upVec, dir);
        whips.add(ferrule);
      }
    }

    coupler.userData.thermalZone = 'instrument_active';
    couplerLid.userData.thermalZone = 'instrument_active';
    tagThermalZone(whips, 'space_cold');
    registerAssembly('pra_pws', whips);
  }

  // =========================================================================
  // DYNAMIC ALIGNMENT LEADER LINES (ANCHOR -> DETACHED COMPONENT ORIGIN)
  // =========================================================================
  const leaderCount = VOYAGER_SUBSYSTEMS.length;
  const leaderPositions = new Float32Array(leaderCount * 2 * 3);
  const leaderGeo = trackGeo(new THREE.BufferGeometry());
  leaderGeo.setAttribute('position', new THREE.BufferAttribute(leaderPositions, 3));

  const leaderMat = new THREE.LineDashedMaterial({
    color: 0x64748b,
    dashSize: 0.08,
    gapSize: 0.06,
    transparent: true,
    opacity: 0.72,
  });
  localMaterials.push(leaderMat);

  const leaderLines = new THREE.LineSegments(leaderGeo, leaderMat);
  leaderLines.frustumCulled = false;
  root.add(leaderLines);

  // =========================================================================
  // SCIENTIFIC INSTRUMENT FOV FRUSTUMS & HGA X-BAND RF BEAM CONES
  // =========================================================================
  const fovCones = createFovCones({
    hga: assemblies.get('hga')!.group,
    iss: assemblies.get('iss')!.group,
    iris: assemblies.get('iris')!.group,
    uvs: assemblies.get('uvs')!.group,
    pps: assemblies.get('pps')!.group,
    pls: assemblies.get('pls')!.group,
  });

  // =========================================================================
  // NON-DESTRUCTIVE HIGHLIGHTING FOR HOVER / SELECTION
  // =========================================================================
  const assemblyOwnMaterials = new Map<string, THREE.MeshStandardMaterial[]>();
  const ensureOwnMaterials = (partId: string): THREE.MeshStandardMaterial[] => {
    const cached = assemblyOwnMaterials.get(partId);
    if (cached) return cached;

    const asm = assemblies.get(partId);
    if (!asm) return [];
    const clonedMap = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const list: THREE.MeshStandardMaterial[] = [];

    asm.group.traverse((child) => {
      if (child.userData.nonPickable || child.userData.hideInThermal) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const orig = mesh.material;
      if (!(orig as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;

      let clone = clonedMap.get(orig);
      if (!clone) {
        clone = orig.clone() as THREE.MeshStandardMaterial;
        clone.userData.baseEmissive = clone.emissive.clone();
        clone.userData.baseEmissiveIntensity = clone.emissiveIntensity;
        clonedMap.set(orig, clone);
        list.push(clone);
        localMaterials.push(clone);
      }
      mesh.material = clone;
    });

    assemblyOwnMaterials.set(partId, list);
    return list;
  };

  let prevHovered: string | null = null;
  let prevSelected: string | null = null;

  // =========================================================================
  // FLIR THERMAL INFRARED INSPECTION MODE (NON-DESTRUCTIVE MATERIAL SWAPPING)
  // =========================================================================
  const thermalBank = createThermalMaterialBank();
  const thermalSavedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const thermalHiddenObjects: THREE.Object3D[] = [];
  let isThermalActive = false;

  const setHighlighted = (hoveredId: string | null, selectedId: string | null) => {
    if (isThermalActive) {
      prevHovered = hoveredId;
      prevSelected = selectedId;
      return;
    }

    const affected = new Set<string>();
    if (prevHovered) affected.add(prevHovered);
    if (prevSelected) affected.add(prevSelected);
    if (hoveredId) affected.add(hoveredId);
    if (selectedId) affected.add(selectedId);

    affected.forEach((id) => {
      const mats = ensureOwnMaterials(id);
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;

      for (const m of mats) {
        const baseE = m.userData.baseEmissive as THREE.Color;
        const baseI = m.userData.baseEmissiveIntensity as number;
        if (isSelected) {
          m.emissive.copy(_highlightColor);
          m.emissiveIntensity = 0.24;
        } else if (isHovered) {
          m.emissive.copy(_hoverColor);
          m.emissiveIntensity = 0.13;
        } else {
          m.emissive.copy(baseE);
          m.emissiveIntensity = baseI;
        }
      }
    });

    prevHovered = hoveredId;
    prevSelected = selectedId;
  };

  const setThermalMode = (enabled: boolean) => {
    if (enabled === isThermalActive) return;

    if (enabled) {
      isThermalActive = true;
      wiring.group.visible = false;
      thermalSavedMaterials.clear();
      thermalHiddenObjects.length = 0;

      const applyThermalToTree = (obj: THREE.Object3D) => {
        if (obj === wiring.group || obj === leaderLines) return;
        if (obj.userData.hideInThermal) {
          if (obj.visible) {
            obj.visible = false;
            thermalHiddenObjects.push(obj);
          }
          return;
        }
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const zone = (mesh.userData.thermalZone as ThermalZone | undefined) ?? 'space_cold';
          thermalSavedMaterials.set(mesh, mesh.material);
          mesh.material = thermalBank.zones[zone];
        }
        for (let i = 0; i < obj.children.length; i++) {
          applyThermalToTree(obj.children[i]);
        }
      };

      applyThermalToTree(root);
    } else {
      isThermalActive = false;
      wiring.group.visible = true;
      thermalSavedMaterials.forEach((mat, mesh) => {
        mesh.material = mat;
      });
      thermalSavedMaterials.clear();
      for (let i = 0; i < thermalHiddenObjects.length; i++) {
        thermalHiddenObjects[i].visible = true;
      }
      thermalHiddenObjects.length = 0;

      // Re-sync highlight state on restored optical materials
      const targetHover = prevHovered;
      const targetSelect = prevSelected;
      prevHovered = null;
      prevSelected = null;
      setHighlighted(targetHover, targetSelect);
    }
  };

  // =========================================================================
  // KINEMATICS UPDATE LOOP (ZERO GC, EXPONENTIAL DAMPING, ARTICULATED OPS)
  // =========================================================================
  let motionTime = 0;
  let currentScanAz = 0;
  let currentScanEl = 0;
  let currentLecpYaw = 0;
  let lastRcsPulseNonce = 0;
  let manualRcsTimer = 0;
  const scanBoomAsm = assemblies.get('scan_platform_boom');

  const updateKinematics = (
    delta: number,
    elapsed: number,
    globalExplode: number,
    detachedIds: Set<string>,
    kinematics: KinematicsConfig,
  ): boolean => {
    let stillMoving = false;
    const posAttr = leaderGeo.attributes.position as THREE.BufferAttribute;
    let lineIdx = 0;

    if (kinematics.liveMotion) {
      motionTime += delta;
    }

    // 1. Update explosion / individual detach factors first so scan platform factor is current
    for (const asm of assemblies.values()) {
      const isIndividuallyDetached = detachedIds.has(asm.id);
      asm.targetFactor = isIndividuallyDetached ? 1.0 : globalExplode;

      const prev = asm.currentFactor;
      asm.currentFactor = THREE.MathUtils.damp(asm.currentFactor, asm.targetFactor, 7.5, delta);
      if (Math.abs(asm.currentFactor - asm.targetFactor) > 0.0008) {
        stillMoving = true;
      } else {
        asm.currentFactor = asm.targetFactor;
      }

      if (Math.abs(prev - asm.currentFactor) > 0.0001) {
        stillMoving = true;
      }
    }

    // 2. 2-Axis Science Scan Platform Azimuth & Elevation articulation (smoothly neutralizes when exploded)
    let targetAz = currentScanAz;
    let targetEl = currentScanEl;
    if (kinematics.scanAutoSweep) {
      if (kinematics.liveMotion) {
        // Gentle planetary flyby mosaic sweep well inside collision-free boom envelope
        targetAz = Math.sin(motionTime * 0.36) * 0.66; // ±38°
        targetEl = Math.sin(motionTime * 0.24 + 0.7) * 0.4; // ±23°
      }
    } else {
      targetAz = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(kinematics.scanAzimuthDeg, -65, 65));
      targetEl = THREE.MathUtils.degToRad(
        THREE.MathUtils.clamp(kinematics.scanElevationDeg, -45, 45),
      );
    }

    currentScanAz = THREE.MathUtils.damp(currentScanAz, targetAz, 5.5, delta);
    currentScanEl = THREE.MathUtils.damp(currentScanEl, targetEl, 5.5, delta);

    const boomSeatedWeight = scanBoomAsm ? 1 - scanBoomAsm.currentFactor : 1;
    if (scanHeadPivot) {
      _scanEuler.set(0, currentScanAz * boomSeatedWeight, currentScanEl * boomSeatedWeight, 'YZX');
      scanHeadPivot.quaternion.setFromEuler(_scanEuler);
    }

    // 3. Apply transforms to all 16 assemblies (rigidly coupling ISS/IRIS/UVS/PPS to scan head when seated)
    for (const asm of assemblies.values()) {
      if (SCAN_MOUNTED_IDS.has(asm.id)) {
        const mountWeight = Math.min(1 - asm.currentFactor, boomSeatedWeight);
        if (mountWeight > 0.001) {
          _scanEuler.set(0, currentScanAz * mountWeight, currentScanEl * mountWeight, 'YZX');
          _scanQuat.setFromEuler(_scanEuler);
          _vecC.copy(asm.basePosition).sub(_scanPivot).applyQuaternion(_scanQuat).add(_scanPivot);
          _vecA.copy(_vecC).addScaledVector(asm.explodeOffset, asm.currentFactor);
          asm.group.position.copy(_vecA);
          asm.group.quaternion.copy(_scanQuat);
        } else {
          _vecA.copy(asm.basePosition).addScaledVector(asm.explodeOffset, asm.currentFactor);
          asm.group.position.copy(_vecA);
          asm.group.quaternion.copy(_identityQuat);
        }
      } else {
        _vecA.copy(asm.basePosition).addScaledVector(asm.explodeOffset, asm.currentFactor);
        asm.group.position.copy(_vecA);
      }

      if (asm.subParts) {
        for (const sp of asm.subParts) {
          sp.obj.position
            .copy(sp.basePos)
            .addScaledVector(sp.extraOffset, asm.currentFactor);
        }
      }

      if (asm.currentFactor > 0.015) {
        _vecB.copy(asm.anchorPoint).addScaledVector(asm.explodeOffset, asm.currentFactor);
        posAttr.setXYZ(lineIdx * 2, asm.anchorPoint.x, asm.anchorPoint.y, asm.anchorPoint.z);
        posAttr.setXYZ(lineIdx * 2 + 1, _vecB.x, _vecB.y, _vecB.z);
      } else {
        posAttr.setXYZ(lineIdx * 2, 0, 0, 0);
        posAttr.setXYZ(lineIdx * 2 + 1, 0, 0, 0);
      }
      lineIdx++;
    }

    // 4. LECP Authentic 8-Sector Rotating Stepper Turret (45° discrete steps every 2.4 s)
    if (lecpTurretGroup) {
      const targetLecpYaw = Math.floor(motionTime / 2.4) * (Math.PI / 4);
      currentLecpYaw = THREE.MathUtils.damp(currentLecpYaw, targetLecpYaw, 8.5, delta);
      lecpTurretGroup.rotation.y = currentLecpYaw;
    }

    // 5. Bay 7 Digital Tape Recorder (DTR) Twin Magnetic Tape Reels & Guide Rollers
    if (kinematics.liveMotion) {
      for (let i = 0; i < dtrReels.length; i++) {
        dtrReels[i].rotation.z += delta * (i === 0 ? 0.92 : 1.04);
      }
      for (let i = 0; i < dtrRollers.length; i++) {
        dtrRollers[i].rotation.y -= delta * 3.8;
      }
    }

    // 6. MR-103 Catalytic Hydrazine Attitude-Control Thruster Micro-Puffs
    if (kinematics.rcsPulseNonce !== lastRcsPulseNonce) {
      lastRcsPulseNonce = kinematics.rcsPulseNonce;
      manualRcsTimer = 0.56;
    }
    if (manualRcsTimer > 0) {
      manualRcsTimer = Math.max(0, manualRcsTimer - delta);
    }

    const cycleLen = 4.4;
    const cyclePhase = motionTime % cycleLen;
    const autoGroupIdx = Math.floor(motionTime / cycleLen) % 4;
    const autoPulseEnv =
      kinematics.liveMotion && cyclePhase < 0.34
        ? Math.sin((cyclePhase / 0.34) * Math.PI) * 0.72
        : 0;
    const manualPulseEnv =
      manualRcsTimer > 0 ? Math.sin((manualRcsTimer / 0.56) * Math.PI) * 0.98 : 0;

    for (let i = 0; i < rcsPlumes.length; i++) {
      const p = rcsPlumes[i];
      let strength = 0;
      if (!isThermalActive) {
        if (manualPulseEnv > 0.01) {
          strength = manualPulseEnv;
        } else if (autoPulseEnv > 0.01 && p.groupIdx === autoGroupIdx) {
          strength = autoPulseEnv;
        }
      }

      if (strength > 0.01) {
        p.mesh.visible = true;
        p.mesh.scale.set(0.85 + strength * 0.25, 0.55 + strength * 0.65, 0.85 + strength * 0.25);
        p.mat.uniforms.uIntensity.value = strength;
        p.mat.uniforms.uTime.value = elapsed;
      } else {
        p.mesh.visible = false;
      }
    }

    // 7. Scientific Instrument FOV Frustums & HGA X-Band RF Beam Cones
    fovCones.setVisible(kinematics.showFovCones, kinematics.selectedPartId);
    fovCones.update(delta, elapsed, isThermalActive);

    posAttr.needsUpdate = true;
    leaderLines.computeLineDistances();
    wiring.update(elapsed);
    if (isThermalActive) {
      thermalBank.update(elapsed);
    }
    return stillMoving;
  };

  return {
    root,
    assemblies,
    wiring,
    clickableRoots,
    updateKinematics,
    setHighlighted,
    setThermalMode,
    dispose: () => {
      fovCones.dispose();
      wiring.dispose();
      thermalBank.dispose();
      geometries.forEach((g) => g.dispose());
      localMaterials.forEach((m) => m.dispose());
    },
  };
}
