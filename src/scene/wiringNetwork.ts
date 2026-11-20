import * as THREE from 'three';
import { WIRING_BUS_META, WiringBusType, WiringFilter } from '../data/voyagerCatalog';
import { VoyagerMaterialLibrary } from './materials';

interface SplineRun {
  bus: WiringBusType;
  curve: THREE.CatmullRomCurve3;
  length: number;
  speed: number;
  pulseCount: number;
  mesh: THREE.Mesh;
}

export interface WiringNetworkController {
  group: THREE.Group;
  setFilter: (filter: WiringFilter) => void;
  setSignalTraceEnabled: (enabled: boolean) => void;
  update: (elapsedTime: number) => void;
  dispose: () => void;
}

const _pos = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

function makeRingPoints(radius: number, y: number, segments = 20): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return pts;
}

export function createWiringNetwork(materials: VoyagerMaterialLibrary): WiringNetworkController {
  const group = new THREE.Group();
  group.name = 'InternalWiringNetwork';

  const runs: SplineRun[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const localMaterials: THREE.Material[] = [];

  // Dedicated bus materials cloned so filtering adjusts opacity/emissive cleanly
  const busMats: Record<WiringBusType, THREE.MeshStandardMaterial> = {
    power: materials.powerHarness.clone(),
    data: materials.dataHarness.clone(),
    rf: materials.rfHarness.clone(),
  };
  Object.values(busMats).forEach((m) => {
    m.transparent = false;
    m.opacity = 1.0;
    m.depthWrite = true;
    localMaterials.push(m);
  });

  const addRun = (
    bus: WiringBusType,
    points: [number, number, number][],
    radius: number,
    speed: number,
    pulseCount: number,
    closed = false,
  ) => {
    const vecs = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.25);
    const tubularSegments = Math.max(24, Math.min(84, points.length * 10));
    const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, 8, closed);
    geometries.push(geo);

    const mesh = new THREE.Mesh(geo, busMats[bus]);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);

    runs.push({
      bus,
      curve,
      length: curve.getLength(),
      speed,
      pulseCount,
      mesh,
    });
  };

  // =========================================================================
  // 1. POWER BUS (30V DC RTG BUS — AMBER #F59E0B)
  // =========================================================================
  // Main armored RTG feeder from 3 MHW-RTGs up RTG boom into Bay 2 Regulator
  addRun(
    'power',
    [
      [-3.1, -0.78, 0.36],
      [-2.25, -0.58, 0.27],
      [-1.45, -0.35, 0.18],
      [-0.82, -0.14, 0.12],
      [-0.56, 0.02, 0.1],
    ],
    0.024,
    0.42,
    5,
  );

  // Internal Decagonal 30V DC Power Distribution Ring (clear inside r=0.46–0.54 raceway)
  const powerRingPts = makeRingPoints(0.5, 0.11, 20).map(
    (v) => [v.x, v.y, v.z] as [number, number, number],
  );
  addRun('power', powerRingPts, 0.018, 0.28, 6, true);

  // Radial power spurs into all 10 electronics bays + circular connector collars
  const connectorGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.036, 12);
  geometries.push(connectorGeo);
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + Math.PI / 10;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    addRun(
      'power',
      [
        [c * 0.5, 0.11, s * 0.5],
        [c * 0.56, 0.07, s * 0.56],
        [c * 0.62, 0.03, s * 0.62],
      ],
      0.01,
      0.55,
      1,
    );

    const conn = new THREE.Mesh(connectorGeo, materials.connectorGold);
    conn.position.set(c * 0.55, 0.06, s * 0.55);
    conn.rotation.z = Math.PI / 2;
    conn.rotation.y = -ang;
    group.add(conn);
  }

  // Power conduit to Central Hydrazine Tank Valve Heaters
  addRun(
    'power',
    [
      [-0.56, 0.08, 0.0],
      [-0.36, -0.02, 0.0],
      [-0.2, -0.18, 0.05],
      [0.0, -0.32, 0.08],
    ],
    0.013,
    0.48,
    2,
  );

  // Power conduit along Science Boom to Scan Platform, PLS, LECP, CRS
  addRun(
    'power',
    [
      [0.56, 0.08, -0.05],
      [0.98, 0.04, -0.06],
      [1.65, 0.02, -0.04],
      [2.35, -0.02, -0.04],
      [2.92, -0.04, -0.02],
    ],
    0.017,
    0.38,
    4,
  );

  // =========================================================================
  // 2. DATA & TELEMETRY BUS (CCS / FDS — LASER CYAN #06B6D4)
  // =========================================================================
  // Internal Decagonal FDS/CCS Braided Data Backplane Ring (clear inside r=0.46–0.54 raceway)
  const dataRingPts = makeRingPoints(0.5, -0.11, 20).map(
    (v) => [v.x, v.y, v.z] as [number, number, number],
  );
  addRun('data', dataRingPts, 0.016, 0.34, 6, true);

  // Radial data drops to electronics bays
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + Math.PI / 10;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    addRun(
      'data',
      [
        [c * 0.5, -0.11, s * 0.5],
        [c * 0.56, -0.07, s * 0.56],
        [c * 0.62, -0.04, s * 0.62],
      ],
      0.009,
      0.62,
      1,
    );
  }

  // High-speed Science Data Trunk routed cleanly along upper boom truss -> around gimbal -> Scan Platform
  addRun(
    'data',
    [
      [3.04, 0.06, 0.14],
      [2.86, 0.02, 0.16],
      [2.45, 0.04, 0.08],
      [1.72, 0.06, 0.06],
      [1.0, 0.02, 0.06],
      [0.52, -0.08, 0.06],
    ],
    0.015,
    0.45,
    4,
  );

  // Fields & Particles Data Branch (PLS / CRS) hugging boom mounting struts -> Science Trunk
  addRun(
    'data',
    [
      [1.82, 0.15, 0.16],
      [1.74, 0.06, 0.06],
      [1.56, 0.02, 0.08],
      [1.46, -0.12, 0.13],
    ],
    0.01,
    0.52,
    2,
  );

  // Magnetometer Shielded Twisted-Pair Telemetry along 13 m Astromast -> Bay 8 FDS
  addRun(
    'data',
    [
      [-0.28, 0.14, -7.2],
      [-0.24, 0.12, -4.4],
      [-0.18, 0.09, -2.0],
      [-0.14, 0.02, -0.92],
      [-0.1, -0.08, -0.52],
    ],
    0.013,
    0.32,
    6,
  );

  // PRA / PWS Telemetry to FDS (clean interior bus entry to exterior coupler)
  addRun(
    'data',
    [
      [-0.74, -0.2, -0.74],
      [-0.54, -0.15, -0.54],
      [-0.36, -0.11, -0.36],
    ],
    0.011,
    0.46,
    2,
  );

  // =========================================================================
  // 3. RF WAVEGUIDE & COAX (S-BAND 2.3 GHz / X-BAND 8.4 GHz — CRIMSON #F43F5E)
  // =========================================================================
  // Primary X-Band Rigid Waveguide: Bay 5 RFS -> Central Hub Base -> Up Internal Hub Bore -> Feed Horn Throat
  addRun(
    'rf',
    [
      [0.24, -0.02, 0.48],
      [0.14, 0.02, 0.24],
      [0.04, 0.05, 0.04],
      [0.03, 0.56, 0.03],
      [0.02, 0.85, 0.02],
      [0.015, 1.18, 0.015],
    ],
    0.019,
    0.58,
    5,
  );

  // Secondary S-Band Waveguide: Bay 6 Exciter -> Central Hub Base -> Up Internal Hub Bore -> Strut 0 -> Sub-Reflector
  addRun(
    'rf',
    [
      [-0.22, -0.02, 0.48],
      [-0.12, 0.02, 0.24],
      [-0.035, 0.05, 0.04],
      [-0.03, 0.58, 0.03],
      [0.45, 0.74, 0.26],
      [1.0, 0.96, 0.575],
      [0.61, 1.53, 0.352],
      [0.225, 2.08, 0.13],
    ],
    0.013,
    0.52,
    5,
  );

  // PRA / PWS RF Coax Feed aligned cleanly from Bay 9 -> Exterior Coupler -> Whip 1 Base
  addRun(
    'rf',
    [
      [-2.05, -0.55, -1.57],
      [-1.38, -0.37, -1.14],
      [-0.74, -0.2, -0.74],
      [-0.5, -0.08, -0.5],
      [-0.32, 0.0, -0.44],
    ],
    0.012,
    0.48,
    4,
  );

  // =========================================================================
  // INSTANCED SIGNAL TRACE PULSES (GLOWING DIRECTIONAL PACKETS ALONG SPLINES)
  // =========================================================================
  const totalPulses = runs.reduce((acc, r) => acc + r.pulseCount, 0);
  const pulseGeo = new THREE.CapsuleGeometry(0.024, 0.085, 6, 10);
  geometries.push(pulseGeo);

  const pulseMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  localMaterials.push(pulseMat);

  const pulseMesh = new THREE.InstancedMesh(pulseGeo, pulseMat, totalPulses);
  pulseMesh.frustumCulled = false;
  pulseMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(totalPulses * 3),
    3,
  );

  let idx = 0;
  for (const run of runs) {
    _color.setHex(WIRING_BUS_META[run.bus].threeHex);
    // Boost brightness slightly for crisp readability against dark obsidian
    _color.lerp(new THREE.Color(0xffffff), 0.35);
    for (let k = 0; k < run.pulseCount; k++) {
      pulseMesh.setColorAt(idx, _color);
      idx++;
    }
  }
  if (pulseMesh.instanceColor) {
    pulseMesh.instanceColor.needsUpdate = true;
  }
  group.add(pulseMesh);

  let activeFilter: WiringFilter = 'all';
  let signalEnabled = true;

  const setFilter = (filter: WiringFilter) => {
    activeFilter = filter;
    (['power', 'data', 'rf'] as WiringBusType[]).forEach((bus) => {
      const mat = busMats[bus];
      const highlighted = filter === 'all' || filter === bus;
      mat.transparent = !highlighted;
      mat.opacity = highlighted ? 1.0 : 0.14;
      mat.emissiveIntensity = highlighted ? (filter === bus ? 0.85 : 0.38) : 0.04;
      mat.depthWrite = highlighted;
      mat.needsUpdate = true;
    });
  };

  const setSignalTraceEnabled = (enabled: boolean) => {
    signalEnabled = enabled;
    pulseMesh.visible = enabled;
  };

  const update = (elapsedTime: number) => {
    if (!signalEnabled) return;

    let instanceIdx = 0;
    for (const run of runs) {
      const visible = activeFilter === 'all' || activeFilter === run.bus;
      for (let k = 0; k < run.pulseCount; k++) {
        if (!visible) {
          _scale.set(0, 0, 0);
          _mat4.compose(_pos.set(0, 0, 0), _quat.identity(), _scale);
          pulseMesh.setMatrixAt(instanceIdx, _mat4);
        } else {
          const t = (elapsedTime * run.speed + k / run.pulseCount) % 1;
          run.curve.getPointAt(t, _pos);
          run.curve.getTangentAt(t, _tan).normalize();
          _quat.setFromUnitVectors(_up, _tan);
          const s = activeFilter === run.bus ? 1.25 : 0.95;
          _scale.set(s, s, s);
          _mat4.compose(_pos, _quat, _scale);
          pulseMesh.setMatrixAt(instanceIdx, _mat4);
        }
        instanceIdx++;
      }
    }
    pulseMesh.instanceMatrix.needsUpdate = true;
  };

  // Initialize first frame matrix positions
  update(0);

  return {
    group,
    setFilter,
    setSignalTraceEnabled,
    update,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      localMaterials.forEach((m) => m.dispose());
    },
  };
}
