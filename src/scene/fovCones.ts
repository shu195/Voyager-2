import * as THREE from 'three';

export interface FovAttachTargets {
  hga: THREE.Group;
  iss: THREE.Group;
  iris: THREE.Group;
  uvs: THREE.Group;
  pps: THREE.Group;
  pls: THREE.Group;
}

export interface FovConesController {
  setVisible: (visible: boolean, selectedPartId: string | null) => void;
  update: (delta: number, elapsed: number, isThermalActive: boolean) => void;
  dispose: () => void;
}

interface BeamEntry {
  partId: string;
  group: THREE.Group;
  shaderMaterials: THREE.ShaderMaterial[];
  lineMaterials: Array<{ mat: THREE.LineBasicMaterial; baseOpacity: number }>;
  waveRings?: Array<{ mesh: THREE.Mesh; phase: number; startY: number; spanY: number; r0: number; r1: number }>;
  currentOpacity: number;
}

const BEAM_VERTEX_SHADER = /* glsl */ `
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

const BEAM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uPulseSpeed;
  uniform float uRingFreq;
  uniform float uFresnelPower;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    // vUv.y = 0.0 at aperture origin, 1.0 at far tip of cone/frustum
    float axialFade = smoothstep(0.0, 0.08, vUv.y) * pow(max(0.0, 1.0 - vUv.y), 1.45);
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float fresnel = pow(1.0 - clamp(ndv, 0.0, 1.0), uFresnelPower);
    float coreFill = 0.24 + 0.76 * fresnel;

    // Subtle travelling wavefront/scan modulation along beam axis
    float wave = 0.86 + 0.14 * sin(vUv.y * uRingFreq - uTime * uPulseSpeed);

    float alpha = axialFade * coreFill * wave * uOpacity;
    if (alpha < 0.002) discard;

    // Slight bright core lift at grazing rim
    vec3 col = uColor * (0.95 + 0.45 * fresnel);
    gl_FragColor = vec4(col, alpha);
  }
`;

function createBeamShaderMaterial(
  colorHex: number,
  pulseSpeed: number,
  ringFreq: number,
  fresnelPower = 1.6,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: 0.0 },
      uTime: { value: 0.0 },
      uPulseSpeed: { value: pulseSpeed },
      uRingFreq: { value: ringFreq },
      uFresnelPower: { value: fresnelPower },
    },
    vertexShader: BEAM_VERTEX_SHADER,
    fragmentShader: BEAM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Builds an open conical shell aligned along +Y from y = 0 (radius r0) to y = length (radius r1),
 * with UV.y = 0 at aperture and UV.y = 1 at far end.
 */
function createOpenConeGeometry(
  r0: number,
  r1: number,
  length: number,
  radialSegments = 40,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r1, r0, length, radialSegments, 1, true);
  // CylinderGeometry spans [-length/2, +length/2] with UV.y = 1 at top (+length/2), 0 at bottom (-length/2)
  geo.translate(0, length * 0.5, 0);
  return geo;
}

/**
 * Builds a rectangular pyramidal optical FOV frustum projecting along +X from x = 0 (w0 × h0)
 * to x = length (w1 × h1), returning both the translucent side-wall BufferGeometry and edge LineSegments geometry.
 */
function createRectangularFrustumGeometries(
  w0: number,
  h0: number,
  w1: number,
  h1: number,
  length: number,
): { wallGeo: THREE.BufferGeometry; edgeGeo: THREE.BufferGeometry } {
  const hw0 = w0 * 0.5;
  const hh0 = h0 * 0.5;
  const hw1 = w1 * 0.5;
  const hh1 = h1 * 0.5;

  // 4 corners at aperture (x = 0) and 4 corners at far plane (x = length)
  const near: Array<[number, number, number]> = [
    [0, hh0, -hw0],
    [0, hh0, hw0],
    [0, -hh0, hw0],
    [0, -hh0, -hw0],
  ];
  const far: Array<[number, number, number]> = [
    [length, hh1, -hw1],
    [length, hh1, hw1],
    [length, -hh1, hw1],
    [length, -hh1, -hw1],
  ];

  const positions: number[] = [];
  const uvs: number[] = [];

  for (let side = 0; side < 4; side++) {
    const next = (side + 1) % 4;
    const n0 = near[side];
    const n1 = near[next];
    const f0 = far[side];
    const f1 = far[next];

    // Triangle 1: n0 -> f0 -> f1
    positions.push(...n0, ...f0, ...f1);
    uvs.push(0, 0, 0, 1, 1, 1);

    // Triangle 2: n0 -> f1 -> n1
    positions.push(...n0, ...f1, ...n1);
    uvs.push(0, 0, 1, 1, 1, 0);
  }

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  wallGeo.computeVertexNormals();

  // Wireframe edges: 4 corner rays + near aperture frame + mid range reticle + far frame
  const edgePts: number[] = [];
  const pushSeg = (a: [number, number, number], b: [number, number, number]) => {
    edgePts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };

  for (let i = 0; i < 4; i++) {
    const nxt = (i + 1) % 4;
    pushSeg(near[i], far[i]);
    pushSeg(near[i], near[nxt]);
    pushSeg(far[i], far[nxt]);

    // Mid-range reticle frame at 52% distance
    const mA: [number, number, number] = [
      length * 0.52,
      near[i][1] + (far[i][1] - near[i][1]) * 0.52,
      near[i][2] + (far[i][2] - near[i][2]) * 0.52,
    ];
    const mB: [number, number, number] = [
      length * 0.52,
      near[nxt][1] + (far[nxt][1] - near[nxt][1]) * 0.52,
      near[nxt][2] + (far[nxt][2] - near[nxt][2]) * 0.52,
    ];
    pushSeg(mA, mB);
  }

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));

  return { wallGeo, edgeGeo };
}

function makeNonPickableThermalHidden(obj: THREE.Object3D) {
  obj.userData.hideInThermal = true;
  obj.traverse((child) => {
    child.userData.hideInThermal = true;
    child.layers.set(0);
    child.castShadow = false;
    child.receiveShadow = false;
    child.raycast = () => {};
  });
}

export function createFovCones(targets: FovAttachTargets): FovConesController {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const entries: BeamEntry[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // =========================================================================
  // 1. HGA 3.7 m X-BAND HIGH-GAIN ANTENNA BEAM (+Y)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_hga_xband';
    group.visible = false;

    // Outer collimated X-band main lobe originating cleanly from parabolic dish rim (y = 1.24 -> 7.34)
    const outerMat = trackMat(createBeamShaderMaterial(0xf43f5e, 3.2, 22.0, 1.8));
    const outerCone = new THREE.Mesh(trackGeo(createOpenConeGeometry(1.78, 2.28, 6.1, 48)), outerMat);
    outerCone.position.y = 1.24;
    outerCone.renderOrder = 6;
    group.add(outerCone);

    // High-gain axial core beam from dichroic sub-reflector (y = 2.04 -> 7.6)
    const coreMat = trackMat(createBeamShaderMaterial(0xfda4af, 4.4, 28.0, 1.35));
    const coreCone = new THREE.Mesh(trackGeo(createOpenConeGeometry(0.32, 0.72, 5.5, 36)), coreMat);
    coreCone.position.y = 2.04;
    coreCone.renderOrder = 7;
    group.add(coreCone);

    // 4 travelling RF phase wavefront rings propagating upward along +Y
    const ringGeo = trackGeo(new THREE.TorusGeometry(1.0, 0.0085, 8, 56));
    const waveRings: NonNullable<BeamEntry['waveRings']> = [];
    for (let i = 0; i < 4; i++) {
      const ringMat = trackMat(
        new THREE.MeshBasicMaterial({
          color: 0xfb7185,
          transparent: true,
          opacity: 0.0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 7;
      group.add(ring);
      waveRings.push({
        mesh: ring,
        phase: i / 4,
        startY: 1.42,
        spanY: 5.4,
        r0: 1.8,
        r1: 2.24,
      });
    }

    // 6 crisp azimuth guide rays along outer main lobe
    const rayPts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      rayPts.push(
        Math.cos(a) * 1.78,
        1.24,
        Math.sin(a) * 1.78,
        Math.cos(a) * 2.28,
        7.34,
        Math.sin(a) * 2.28,
      );
    }
    const rayGeo = trackGeo(new THREE.BufferGeometry());
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(rayPts, 3));
    const rayMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0xf43f5e,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(new THREE.LineSegments(rayGeo, rayMat));

    makeNonPickableThermalHidden(group);
    targets.hga.add(group);
    entries.push({
      partId: 'hga',
      group,
      shaderMaterials: [outerMat, coreMat],
      lineMaterials: [{ mat: rayMat, baseOpacity: 0.28 }],
      waveRings,
      currentOpacity: 0,
    });
  }

  // =========================================================================
  // 2. ISS — NARROW-ANGLE (NAC) & WIDE-ANGLE (WAC) OPTICAL FOV FRUSTUMS (+X)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_iss_optics';
    group.visible = false;

    // Narrow-Angle Camera (NAC) rectangular optical frustum (cyan)
    const nacGeos = createRectangularFrustumGeometries(0.16, 0.16, 0.62, 0.62, 3.2);
    trackGeo(nacGeos.wallGeo);
    trackGeo(nacGeos.edgeGeo);
    const nacMat = trackMat(createBeamShaderMaterial(0x38bdf8, 2.1, 16.0, 1.45));
    const nacEdgeMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const nacGroup = new THREE.Group();
    nacGroup.position.set(0.44, 0.03, -0.06);
    const nacWall = new THREE.Mesh(nacGeos.wallGeo, nacMat);
    nacWall.renderOrder = 6;
    nacGroup.add(nacWall);
    nacGroup.add(new THREE.LineSegments(nacGeos.edgeGeo, nacEdgeMat));
    group.add(nacGroup);

    // Wide-Angle Camera (WAC) rectangular optical frustum (ice-teal)
    const wacGeos = createRectangularFrustumGeometries(0.1, 0.1, 1.18, 1.18, 2.35);
    trackGeo(wacGeos.wallGeo);
    trackGeo(wacGeos.edgeGeo);
    const wacMat = trackMat(createBeamShaderMaterial(0x22d3ee, 1.7, 14.0, 1.55));
    const wacEdgeMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0x67e8f9,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const wacGroup = new THREE.Group();
    wacGroup.position.set(0.34, 0.01, 0.14);
    const wacWall = new THREE.Mesh(wacGeos.wallGeo, wacMat);
    wacWall.renderOrder = 6;
    wacGroup.add(wacWall);
    wacGroup.add(new THREE.LineSegments(wacGeos.edgeGeo, wacEdgeMat));
    group.add(wacGroup);

    makeNonPickableThermalHidden(group);
    targets.iss.add(group);
    entries.push({
      partId: 'iss',
      group,
      shaderMaterials: [nacMat, wacMat],
      lineMaterials: [
        { mat: nacEdgeMat, baseOpacity: 0.56 },
        { mat: wacEdgeMat, baseOpacity: 0.42 },
      ],
      currentOpacity: 0,
    });
  }

  // =========================================================================
  // 3. IRIS — INFRARED INTERFEROMETER SPECTROMETER FOV CONE (+X)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_iris_ir';
    group.visible = false;

    const irisMat = trackMat(createBeamShaderMaterial(0xf59e0b, 1.9, 18.0, 1.5));
    const irisCone = new THREE.Mesh(trackGeo(createOpenConeGeometry(0.132, 0.42, 2.45, 36)), irisMat);
    irisCone.rotation.z = -Math.PI / 2;
    irisCone.position.set(0.365, 0, 0);
    irisCone.renderOrder = 6;
    group.add(irisCone);

    const ringPts: number[] = [];
    const ringSegs = 40;
    for (let i = 0; i < ringSegs; i++) {
      const a0 = (i / ringSegs) * Math.PI * 2;
      const a1 = ((i + 1) / ringSegs) * Math.PI * 2;
      ringPts.push(
        2.815,
        Math.cos(a0) * 0.42,
        Math.sin(a0) * 0.42,
        2.815,
        Math.cos(a1) * 0.42,
        Math.sin(a1) * 0.42,
      );
    }
    const ringGeo = trackGeo(new THREE.BufferGeometry());
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    const ringLineMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    group.add(new THREE.LineSegments(ringGeo, ringLineMat));

    makeNonPickableThermalHidden(group);
    targets.iris.add(group);
    entries.push({
      partId: 'iris',
      group,
      shaderMaterials: [irisMat],
      lineMaterials: [{ mat: ringLineMat, baseOpacity: 0.36 }],
      currentOpacity: 0,
    });
  }

  // =========================================================================
  // 4. UVS — ULTRAVIOLET SPECTROMETER SLIT FAN (+X)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_uvs_slit';
    group.visible = false;

    const uvsGeos = createRectangularFrustumGeometries(0.11, 0.08, 0.92, 0.24, 2.25);
    trackGeo(uvsGeos.wallGeo);
    trackGeo(uvsGeos.edgeGeo);
    const uvsMat = trackMat(createBeamShaderMaterial(0xa78bfa, 2.5, 20.0, 1.45));
    const uvsEdgeMat = trackMat(
      new THREE.LineBasicMaterial({
        color: 0xc4b5fd,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    const slitGroup = new THREE.Group();
    slitGroup.position.set(0.29, 0, 0);
    const slitWall = new THREE.Mesh(uvsGeos.wallGeo, uvsMat);
    slitWall.renderOrder = 6;
    slitGroup.add(slitWall);
    slitGroup.add(new THREE.LineSegments(uvsGeos.edgeGeo, uvsEdgeMat));
    group.add(slitGroup);

    makeNonPickableThermalHidden(group);
    targets.uvs.add(group);
    entries.push({
      partId: 'uvs',
      group,
      shaderMaterials: [uvsMat],
      lineMaterials: [{ mat: uvsEdgeMat, baseOpacity: 0.48 }],
      currentOpacity: 0,
    });
  }

  // =========================================================================
  // 5. PPS — PHOTOPOLARIMETER APERTURE CONE (+X)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_pps_optics';
    group.visible = false;

    const ppsMat = trackMat(createBeamShaderMaterial(0xfb923c, 2.2, 18.0, 1.55));
    const ppsCone = new THREE.Mesh(trackGeo(createOpenConeGeometry(0.068, 0.34, 2.15, 32)), ppsMat);
    ppsCone.rotation.z = -Math.PI / 2;
    ppsCone.position.set(0.31, 0, 0);
    ppsCone.renderOrder = 6;
    group.add(ppsCone);

    makeNonPickableThermalHidden(group);
    targets.pps.add(group);
    entries.push({
      partId: 'pps',
      group,
      shaderMaterials: [ppsMat],
      lineMaterials: [],
      currentOpacity: 0,
    });
  }

  // =========================================================================
  // 6. PLS — PLASMA SCIENCE FARADAY CUP ACCEPTANCE CONES (3 TRIAD + 1 LATERAL)
  // =========================================================================
  {
    const group = new THREE.Group();
    group.name = 'fov_pls_cups';
    group.visible = false;

    const plsMat = trackMat(createBeamShaderMaterial(0x10b981, 2.0, 16.0, 1.55));
    const cupConeGeo = trackGeo(createOpenConeGeometry(0.04, 0.32, 1.15, 28));

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const cupHolder = new THREE.Group();
      cupHolder.position.set(Math.cos(a) * 0.08, 0.048, Math.sin(a) * 0.08);
      cupHolder.rotation.z = Math.cos(a) * 0.24;
      cupHolder.rotation.x = -Math.sin(a) * 0.24;

      const cone = new THREE.Mesh(cupConeGeo, plsMat);
      cone.position.y = 0.098;
      cone.renderOrder = 6;
      cupHolder.add(cone);
      group.add(cupHolder);
    }

    const latHolder = new THREE.Group();
    latHolder.position.set(0, 0.015, 0.162);
    latHolder.rotation.x = Math.PI / 2;
    const latCone = new THREE.Mesh(cupConeGeo, plsMat);
    latCone.position.y = 0.098;
    latCone.renderOrder = 6;
    latHolder.add(latCone);
    group.add(latHolder);

    makeNonPickableThermalHidden(group);
    targets.pls.add(group);
    entries.push({
      partId: 'pls',
      group,
      shaderMaterials: [plsMat],
      lineMaterials: [],
      currentOpacity: 0,
    });
  }

  let globalVisible = false;
  let activeSelectedId: string | null = null;
  const beamPartIds = new Set(entries.map((e) => e.partId));

  const setVisible = (visible: boolean, selectedPartId: string | null) => {
    globalVisible = visible;
    activeSelectedId = selectedPartId;
  };

  const update = (delta: number, elapsed: number, isThermalActive: boolean) => {
    const hasBeamSelected = activeSelectedId !== null && beamPartIds.has(activeSelectedId);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let targetOpacity = 0.0;
      if (globalVisible && !isThermalActive) {
        if (hasBeamSelected) {
          targetOpacity = entry.partId === activeSelectedId ? 0.56 : 0.14;
        } else {
          targetOpacity = entry.partId === 'hga' ? 0.34 : 0.38;
        }
      }

      entry.currentOpacity = THREE.MathUtils.damp(entry.currentOpacity, targetOpacity, 7.0, delta);
      if (Math.abs(entry.currentOpacity - targetOpacity) < 0.002) {
        entry.currentOpacity = targetOpacity;
      }

      const shouldShow = !isThermalActive && entry.currentOpacity > 0.003;
      entry.group.visible = shouldShow;
      if (!shouldShow) continue;

      for (let s = 0; s < entry.shaderMaterials.length; s++) {
        const sm = entry.shaderMaterials[s];
        sm.uniforms.uOpacity.value = entry.currentOpacity;
        sm.uniforms.uTime.value = elapsed;
      }

      const normFactor = Math.min(1.4, entry.currentOpacity / 0.38);
      for (let l = 0; l < entry.lineMaterials.length; l++) {
        const lm = entry.lineMaterials[l];
        lm.mat.opacity = lm.baseOpacity * normFactor;
      }

      if (entry.waveRings) {
        for (let r = 0; r < entry.waveRings.length; r++) {
          const wr = entry.waveRings[r];
          const t = (elapsed * 0.28 + wr.phase) % 1.0;
          wr.mesh.position.y = wr.startY + t * wr.spanY;
          const radius = wr.r0 + (wr.r1 - wr.r0) * t;
          wr.mesh.scale.set(radius, radius, 1);
          const ringMat = wr.mesh.material as THREE.MeshBasicMaterial;
          const env = Math.sin(t * Math.PI);
          ringMat.opacity = env * entry.currentOpacity * 0.65;
        }
      }
    }
  };

  return {
    setVisible,
    update,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
