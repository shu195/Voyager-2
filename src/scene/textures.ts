import * as THREE from 'three';

export interface ProceduralTextureSet {
  kaptonColor: THREE.CanvasTexture;
  kaptonNormal: THREE.DataTexture;
  kaptonRough: THREE.CanvasTexture;
  blackThermalColor: THREE.CanvasTexture;
  blackThermalNormal: THREE.DataTexture;
  blackThermalRough: THREE.CanvasTexture;
  hgaColor: THREE.CanvasTexture;
  hgaNormal: THREE.DataTexture;
  hgaRough: THREE.CanvasTexture;
  brushedMetalNormal: THREE.DataTexture;
  brushedMetalRough: THREE.CanvasTexture;
  braidedConduitColor: THREE.CanvasTexture;
  braidedConduitNormal: THREE.DataTexture;
  goldenRecordCoverColor: THREE.CanvasTexture;
  goldenRecordCoverNormal: THREE.DataTexture;
  goldenRecordDiscColor: THREE.CanvasTexture;
  goldenRecordDiscNormal: THREE.DataTexture;
  busLouversColor: THREE.CanvasTexture;
  busLouversNormal: THREE.DataTexture;
  pcbColor: THREE.CanvasTexture;
  pcbNormal: THREE.DataTexture;
  pcbRough: THREE.CanvasTexture;
  rtgSkinColor: THREE.CanvasTexture;
  rtgSkinNormal: THREE.DataTexture;
  rtgSkinRough: THREE.CanvasTexture;
  calTargetColor: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  thrusterBluedColor: THREE.CanvasTexture;
  creviceAo: THREE.CanvasTexture;
  bayStencilTextures: THREE.CanvasTexture[];
  dispose: () => void;
}

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

function finalizeCanvasTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 16);
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a grayscale height canvas into a true Sobel tangent-space Normal Map
 * for razor-sharp metallic specular glints and crisp surface micro-relief.
 */
function heightCanvasToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.DataTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const ctx = heightCanvas.getContext('2d', { willReadFrequently: true })!;
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = dY * strength;
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      out[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = Math.min(maxAnisotropy, 16);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = true;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

/** High-resolution crumpled Gold Kapton MLI Blanket with sharp facets & Kapton tape seams */
function createKaptonTextures(maxAnisotropy: number) {
  const size = 1024;
  const rand = mulberry32(19770820);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d', { willReadFrequently: true })!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  cCtx.fillStyle = '#d99e28';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#383838';
  rCtx.fillRect(0, 0, size, size);

  // Multi-octave angular crumpled foil facets
  const layers = [
    { count: 160, radius: 148, alphaC: 0.28, alphaH: 0.42 },
    { count: 520, radius: 64, alphaC: 0.26, alphaH: 0.38 },
    { count: 1500, radius: 26, alphaC: 0.22, alphaH: 0.34 },
    { count: 2800, radius: 11, alphaC: 0.16, alphaH: 0.24 },
  ];

  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const cx = rand() * size;
      const cy = rand() * size;
      const sides = 3 + Math.floor(rand() * 3);
      const r = layer.radius * (0.45 + rand() * 0.85);
      const rot = rand() * Math.PI * 2;
      const lum = rand();

      const pts: [number, number][] = [];
      for (let s = 0; s < sides; s++) {
        const ang = rot + (s / sides) * Math.PI * 2 + (rand() - 0.5) * 0.42;
        const rad = r * (0.58 + rand() * 0.5);
        pts.push([Math.cos(ang) * rad, Math.sin(ang) * rad]);
      }

      const drawFacet = (ctx: CanvasRenderingContext2D, ox: number, oy: number) => {
        ctx.beginPath();
        for (let s = 0; s < pts.length; s++) {
          const px = cx + ox + pts[s][0];
          const py = cy + oy + pts[s][1];
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      };

      const goldTone =
        lum > 0.66
          ? `rgba(255, 224, 118, ${layer.alphaC})`
          : lum > 0.34
            ? `rgba(208, 142, 24, ${layer.alphaC})`
            : `rgba(116, 68, 10, ${layer.alphaC})`;
      const hVal = Math.floor(18 + lum * 224);
      const rVal = Math.floor(26 + (1 - lum) * 72);

      const offsets: [number, number][] = [[0, 0]];
      if (cx < r) offsets.push([size, 0]);
      if (cx > size - r) offsets.push([-size, 0]);
      if (cy < r) offsets.push([0, size]);
      if (cy > size - r) offsets.push([0, -size]);

      for (const [ox, oy] of offsets) {
        cCtx.fillStyle = goldTone;
        drawFacet(cCtx, ox, oy);
        hCtx.fillStyle = `rgba(${hVal},${hVal},${hVal},${layer.alphaH})`;
        drawFacet(hCtx, ox, oy);
        rCtx.fillStyle = `rgba(${rVal},${rVal},${rVal},0.34)`;
        drawFacet(rCtx, ox, oy);
      }
    }
  }

  // Crisp metallic crinkle fold lines
  for (let i = 0; i < 820; i++) {
    const x1 = rand() * size;
    const y1 = rand() * size;
    const len = 18 + rand() * 96;
    const ang = rand() * Math.PI * 2;
    const x2 = x1 + Math.cos(ang) * len;
    const y2 = y1 + Math.sin(ang) * len;
    const ridge = rand() > 0.5;

    hCtx.strokeStyle = ridge ? 'rgba(255,255,255,0.72)' : 'rgba(10,10,10,0.72)';
    hCtx.lineWidth = 1.1 + rand() * 1.4;
    hCtx.beginPath();
    hCtx.moveTo(x1, y1);
    hCtx.lineTo(x2, y2);
    hCtx.stroke();

    cCtx.strokeStyle = ridge ? 'rgba(255,238,162,0.4)' : 'rgba(84,46,6,0.42)';
    cCtx.lineWidth = 1.1;
    cCtx.beginPath();
    cCtx.moveTo(x1, y1);
    cCtx.lineTo(x2, y2);
    cCtx.stroke();
  }

  // Authentic amber Kapton adhesive tape seams & metallic stitching eyelets
  for (let g = 256; g < size; g += 256) {
    cCtx.fillStyle = 'rgba(154, 88, 12, 0.36)';
    cCtx.fillRect(g - 9, 0, 18, size);
    rCtx.fillStyle = 'rgba(22, 22, 22, 0.7)';
    rCtx.fillRect(g - 9, 0, 18, size);
    hCtx.strokeStyle = 'rgba(30,30,30,0.7)';
    hCtx.lineWidth = 2;
    hCtx.beginPath();
    hCtx.moveTo(g - 9, 0);
    hCtx.lineTo(g - 9, size);
    hCtx.moveTo(g + 9, 0);
    hCtx.lineTo(g + 9, size);
    hCtx.stroke();

    for (let sy = 32; sy < size; sy += 64) {
      cCtx.fillStyle = 'rgba(220, 225, 232, 0.55)';
      cCtx.beginPath();
      cCtx.arc(g, sy, 3.2, 0, Math.PI * 2);
      cCtx.fill();
      hCtx.fillStyle = '#e8e8e8';
      hCtx.beginPath();
      hCtx.arc(g, sy, 3.6, 0, Math.PI * 2);
      hCtx.fill();
    }
  }

  // Conductive matte Carbon-Black Kapton thermal blanket (used on Voyager 2 top deck & select bays)
  const blkColor = document.createElement('canvas');
  blkColor.width = size;
  blkColor.height = size;
  const bcCtx = blkColor.getContext('2d')!;
  bcCtx.fillStyle = '#12161f';
  bcCtx.fillRect(0, 0, size, size);
  bcCtx.globalAlpha = 0.09;
  bcCtx.drawImage(heightCanvas, 0, 0);
  bcCtx.globalAlpha = 1;

  // Fine carbon-impregnated Dacron ripstop grid
  bcCtx.strokeStyle = 'rgba(48, 58, 74, 0.22)';
  bcCtx.lineWidth = 1;
  for (let p = 0; p < size; p += 24) {
    bcCtx.beginPath();
    bcCtx.moveTo(p, 0);
    bcCtx.lineTo(p, size);
    bcCtx.moveTo(0, p);
    bcCtx.lineTo(size, p);
    bcCtx.stroke();
  }

  const blkRough = document.createElement('canvas');
  blkRough.width = size;
  blkRough.height = size;
  const brCtx = blkRough.getContext('2d')!;
  brCtx.fillStyle = '#a4a4a4';
  brCtx.fillRect(0, 0, size, size);
  brCtx.globalAlpha = 0.24;
  brCtx.drawImage(roughCanvas, 0, 0);
  brCtx.globalAlpha = 1;

  return {
    kaptonColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy, 2, 2),
    kaptonNormal: heightCanvasToNormalTexture(heightCanvas, 4.4, maxAnisotropy, 2, 2),
    kaptonRough: finalizeCanvasTexture(roughCanvas, false, maxAnisotropy, 2, 2),
    blackThermalColor: finalizeCanvasTexture(blkColor, true, maxAnisotropy, 1.5, 1.5),
    blackThermalNormal: heightCanvasToNormalTexture(heightCanvas, 1.65, maxAnisotropy, 1.5, 1.5),
    blackThermalRough: finalizeCanvasTexture(blkRough, false, maxAnisotropy, 1.5, 1.5),
  };
}

/** High-Gain Antenna 3.7 m White Composite Dish (Honeycomb + 18 Tonal Gore Panels + Fasteners) */
function createHgaTextures(maxAnisotropy: number) {
  const size = 1024;
  const rand = mulberry32(3660);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const grad = cCtx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#d6dce4');
  grad.addColorStop(0.18, '#e8ecf2');
  grad.addColorStop(0.84, '#f0f3f7');
  grad.addColorStop(0.95, '#dce2ea');
  grad.addColorStop(1, '#c8d0da');
  cCtx.fillStyle = grad;
  cCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#888888';
  rCtx.fillRect(0, 0, size, size);

  // Subtle alternating panel-to-panel tonal and roughness variation across the 18 pie gores
  const panels = 18;
  for (let i = 0; i < panels; i++) {
    const x0 = (i / panels) * size;
    const pw = size / panels;
    const tint = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(30,42,58,0.035)';
    cCtx.fillStyle = tint;
    cCtx.fillRect(x0, 0, pw, size);
    const rv = i % 2 === 0 ? 124 : 146;
    rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.22)`;
    rCtx.fillRect(x0, 0, pw, size);
  }

  // Subtle thermal white paint micro-mottle & cleanroom finish variation
  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = 224 + Math.floor(rand() * 28);
    cCtx.fillStyle = `rgba(${v},${v},${v + 3},0.14)`;
    cCtx.fillRect(x, y, 6, 6);
    const rv = 108 + Math.floor(rand() * 58);
    rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.24)`;
    rCtx.fillRect(x, y, 7, 7);
  }

  // Fine aluminum honeycomb core print-through grid
  hCtx.strokeStyle = 'rgba(104, 104, 104, 0.34)';
  hCtx.lineWidth = 1;
  for (let x = 0; x < size; x += 12) {
    hCtx.beginPath();
    hCtx.moveTo(x, 0);
    hCtx.lineTo(x, size);
    hCtx.stroke();
  }
  for (let y = 0; y < size; y += 12) {
    hCtx.beginPath();
    hCtx.moveTo(0, y);
    hCtx.lineTo(size, y);
    hCtx.stroke();
  }

  // 18 radial structural pie-gore seams + recessed countersunk rivets + edge AO
  for (let i = 0; i < panels; i++) {
    const x = (i / panels) * size;
    // Soft seam AO
    cCtx.strokeStyle = 'rgba(72, 84, 100, 0.16)';
    cCtx.lineWidth = 6;
    cCtx.beginPath();
    cCtx.moveTo(x, 0);
    cCtx.lineTo(x, size);
    cCtx.stroke();

    // Sharp seam line
    cCtx.strokeStyle = 'rgba(64, 74, 88, 0.52)';
    cCtx.lineWidth = 1.8;
    cCtx.beginPath();
    cCtx.moveTo(x, 0);
    cCtx.lineTo(x, size);
    cCtx.stroke();

    hCtx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
    hCtx.lineWidth = 2.4;
    hCtx.beginPath();
    hCtx.moveTo(x, 0);
    hCtx.lineTo(x, size);
    hCtx.stroke();

    // Flush countersunk rivets along both edges of each gore
    for (let y = 28; y < size - 20; y += 30) {
      for (const dx of [-5.5, 5.5]) {
        cCtx.fillStyle = 'rgba(84, 96, 112, 0.54)';
        cCtx.beginPath();
        cCtx.arc(x + dx, y, 1.7, 0, Math.PI * 2);
        cCtx.fill();

        hCtx.fillStyle = '#242424';
        hCtx.beginPath();
        hCtx.arc(x + dx, y, 2.2, 0, Math.PI * 2);
        hCtx.fill();
      }
    }
  }

  // Concentric structural splice rings + metallic edge band
  for (const rv of [0.22, 0.48, 0.74, 0.94]) {
    const y = rv * size;
    cCtx.strokeStyle = 'rgba(78, 92, 108, 0.52)';
    cCtx.lineWidth = rv > 0.9 ? 6 : 2.4;
    cCtx.beginPath();
    cCtx.moveTo(0, y);
    cCtx.lineTo(size, y);
    cCtx.stroke();

    hCtx.strokeStyle = 'rgba(218, 218, 218, 0.88)';
    hCtx.lineWidth = rv > 0.9 ? 8 : 3.4;
    hCtx.beginPath();
    hCtx.moveTo(0, y);
    hCtx.lineTo(size, y);
    hCtx.stroke();
  }

  // 3 JPL Tripod Strut Optical Alignment Fiducial Targets
  for (let t = 0; t < 3; t++) {
    const x = (t / 3 + 0.0833) * size;
    const y = 0.62 * size;
    cCtx.strokeStyle = '#1e293b';
    cCtx.lineWidth = 2.4;
    cCtx.beginPath();
    cCtx.arc(x, y, 15, 0, Math.PI * 2);
    cCtx.stroke();
    cCtx.beginPath();
    cCtx.moveTo(x - 20, y);
    cCtx.lineTo(x + 20, y);
    cCtx.moveTo(x, y - 20);
    cCtx.lineTo(x, y + 20);
    cCtx.stroke();
    cCtx.fillStyle = '#d97706';
    cCtx.beginPath();
    cCtx.arc(x, y, 5, 0, Math.PI * 2);
    cCtx.fill();
  }

  return {
    hgaColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy),
    hgaNormal: heightCanvasToNormalTexture(heightCanvas, 2.8, maxAnisotropy),
    hgaRough: finalizeCanvasTexture(roughCanvas, false, maxAnisotropy),
  };
}

/** Procedural Directional Brushed Aerospace Aluminum / Titanium Grain (no shader anisotropy needed) */
function createBrushedMetalTextures(maxAnisotropy: number) {
  const size = 512;
  const rand = mulberry32(9912);

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#565656';
  rCtx.fillRect(0, 0, size, size);

  // Fine CNC milled & lathe-turned brush grain streaks
  for (let i = 0; i < 3200; i++) {
    const y = rand() * size;
    const x = rand() * size;
    const len = 32 + rand() * 210;
    const v = 78 + Math.floor(rand() * 104);
    hCtx.strokeStyle = `rgba(${v},${v},${v},0.38)`;
    hCtx.lineWidth = 0.7 + rand() * 1.1;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + len, y);
    hCtx.stroke();

    const rv = 42 + Math.floor(rand() * 82);
    rCtx.strokeStyle = `rgba(${rv},${rv},${rv},0.34)`;
    rCtx.lineWidth = 1.2;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + len, y);
    rCtx.stroke();
  }

  return {
    brushedMetalNormal: heightCanvasToNormalTexture(heightCanvas, 1.55, maxAnisotropy, 2, 2),
    brushedMetalRough: finalizeCanvasTexture(roughCanvas, false, maxAnisotropy, 2, 2),
  };
}

/** Diamond-Weave Stainless Steel Braided RF/Cryo Conduit Texture */
function createBraidedConduitTextures(maxAnisotropy: number) {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  cCtx.fillStyle = '#6f7986';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#505050';
  hCtx.fillRect(0, 0, size, size);

  const step = 16;
  for (let i = -size; i < size * 2; i += step) {
    cCtx.strokeStyle = '#c4cdd8';
    cCtx.lineWidth = 5;
    cCtx.beginPath();
    cCtx.moveTo(i, 0);
    cCtx.lineTo(i + size, size);
    cCtx.stroke();

    hCtx.strokeStyle = '#d8d8d8';
    hCtx.lineWidth = 5;
    hCtx.beginPath();
    hCtx.moveTo(i, 0);
    hCtx.lineTo(i + size, size);
    hCtx.stroke();

    cCtx.strokeStyle = '#9aa5b4';
    cCtx.lineWidth = 4.5;
    cCtx.beginPath();
    cCtx.moveTo(i, size);
    cCtx.lineTo(i + size, 0);
    cCtx.stroke();

    hCtx.strokeStyle = '#b4b4b4';
    hCtx.lineWidth = 4.5;
    hCtx.beginPath();
    hCtx.moveTo(i, size);
    hCtx.lineTo(i + size, 0);
    hCtx.stroke();
  }

  return {
    braidedConduitColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy, 6, 2),
    braidedConduitNormal: heightCanvasToNormalTexture(heightCanvas, 2.4, maxAnisotropy, 6, 2),
  };
}

/** Authentic Voyager Golden Record Cover Diagram + Inner Phonograph Grooves with Deep Normal Maps */
function createGoldenRecordTextures(maxAnisotropy: number) {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  const bg = ctx.createRadialGradient(cx * 0.82, cy * 0.78, 40, cx, cy, size * 0.52);
  bg.addColorStop(0, '#fae08c');
  bg.addColorStop(0.55, '#dcb042');
  bg.addColorStop(1, '#ab7d1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#949494';
  hCtx.fillRect(0, 0, size, size);

  // Fine concentric brushed spun-gold lathe lines
  for (let r = 14; r < 504; r += 2) {
    ctx.strokeStyle = r % 4 === 0 ? 'rgba(255, 246, 200, 0.18)' : 'rgba(130, 88, 18, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    hCtx.strokeStyle = r % 4 === 0 ? 'rgba(158,158,158,0.42)' : 'rgba(126,126,126,0.42)';
    hCtx.lineWidth = 1;
    hCtx.beginPath();
    hCtx.arc(cx, cy, r, 0, Math.PI * 2);
    hCtx.stroke();
  }

  const etch = (drawFn: (g: CanvasRenderingContext2D) => void, width = 3.2) => {
    ctx.save();
    ctx.strokeStyle = '#382404';
    ctx.fillStyle = '#382404';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    drawFn(ctx);
    ctx.restore();

    hCtx.save();
    hCtx.strokeStyle = '#101010';
    hCtx.fillStyle = '#101010';
    hCtx.lineWidth = width + 1.2;
    hCtx.lineCap = 'round';
    drawFn(hCtx);
    hCtx.restore();
  };

  etch((g) => {
    g.beginPath();
    g.arc(cx, cy, 488, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 466, 0, Math.PI * 2);
    g.stroke();
  }, 3.6);

  // 1. Top-Left: Phonograph Record & Cartridge Schematic + Binary Speed
  const recX = 325;
  const recY = 305;
  etch((g) => {
    g.beginPath();
    g.arc(recX, recY, 138, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(recX, recY, 118, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(recX, recY, 46, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(recX, recY, 10, 0, Math.PI * 2);
    g.fill();

    g.beginPath();
    g.moveTo(recX + 125, recY - 85);
    g.lineTo(recX + 95, recY + 12);
    g.lineTo(recX + 82, recY + 6);
    g.lineTo(recX + 112, recY - 91);
    g.closePath();
    g.stroke();

    const bits = '10011000101100100001011001';
    for (let i = 0; i < bits.length; i++) {
      const ang = -Math.PI * 0.85 + i * 0.14;
      const r1 = 152;
      const r2 = bits[i] === '1' ? 166 : 158;
      g.beginPath();
      if (bits[i] === '1') {
        g.moveTo(recX + Math.cos(ang) * r1, recY + Math.sin(ang) * r1);
        g.lineTo(recX + Math.cos(ang) * r2, recY + Math.sin(ang) * r2);
      } else {
        g.arc(recX, recY, 158, ang - 0.03, ang + 0.03);
      }
      g.stroke();
    }

    g.beginPath();
    g.moveTo(recX - 115, recY + 178);
    g.lineTo(recX + 115, recY + 178);
    g.moveTo(recX - 115, recY + 186);
    g.lineTo(recX + 115, recY + 186);
    g.moveTo(recX + 70, recY + 152);
    g.lineTo(recX + 95, recY + 152);
    g.lineTo(recX + 82, recY + 175);
    g.closePath();
    g.stroke();
  }, 3.4);

  // 2. Top-Right: Video Waveform & Raster Scan Diagram
  const vidX = 690;
  const vidY = 235;
  etch((g) => {
    g.beginPath();
    g.moveTo(vidX - 135, vidY - 40);
    for (let t = 0; t <= 44; t++) {
      const px = vidX - 135 + t * 6;
      const py = vidY - 40 + Math.sin(t * 0.72) * 14 * Math.cos(t * 0.23);
      g.lineTo(px, py);
    }
    g.stroke();

    g.beginPath();
    g.moveTo(vidX - 135, vidY + 12);
    for (let t = 0; t <= 44; t++) {
      const px = vidX - 135 + t * 6;
      const py = vidY + 12 + Math.cos(t * 0.65) * 12;
      g.lineTo(px, py);
    }
    g.stroke();

    g.strokeRect(vidX - 125, vidY + 65, 110, 125);
    for (let s = 1; s <= 6; s++) {
      const sx = vidX - 125 + s * 16;
      g.beginPath();
      g.moveTo(sx, vidY + 65);
      g.lineTo(sx, vidY + 190);
      g.stroke();
    }

    g.strokeRect(vidX + 10, vidY + 65, 118, 125);
    g.beginPath();
    g.arc(vidX + 69, vidY + 127, 46, 0, Math.PI * 2);
    g.stroke();
  }, 3.0);

  // 3. Bottom-Left: 14-Pulsar Galactic Map
  const pulX = 355;
  const pulY = 695;
  const pulsarAngles = [
    0.12, 0.42, 0.88, 1.32, 1.78, 2.25, 2.68, 3.05, 3.55, 4.02, 4.48, 4.95, 5.42, 5.88,
  ];
  const pulsarLengths = [165, 128, 148, 96, 175, 132, 114, 158, 142, 108, 168, 122, 144, 185];
  etch((g) => {
    for (let i = 0; i < pulsarAngles.length; i++) {
      const a = pulsarAngles[i];
      const len = pulsarLengths[i];
      const ex = pulX + Math.cos(a) * len;
      const ey = pulY + Math.sin(a) * len;
      g.beginPath();
      g.moveTo(pulX, pulY);
      g.lineTo(ex, ey);
      g.stroke();

      const px = -Math.sin(a) * 6;
      const py = Math.cos(a) * 6;
      g.beginPath();
      g.moveTo(ex - px, ey - py);
      g.lineTo(ex + px, ey + py);
      g.stroke();

      for (let d = 0; d < 6; d++) {
        const t = 0.35 + d * 0.095;
        const dx = pulX + Math.cos(a) * len * t;
        const dy = pulY + Math.sin(a) * len * t;
        if ((i + d) % 2 === 0) {
          g.beginPath();
          g.moveTo(dx - px * 0.7, dy - py * 0.7);
          g.lineTo(dx + px * 0.7, dy + py * 0.7);
          g.stroke();
        }
      }
    }
    g.beginPath();
    g.arc(pulX, pulY, 6, 0, Math.PI * 2);
    g.fill();
  }, 2.8);

  // 4. Bottom-Right: Hydrogen Hyperfine Spin-Flip Diagram
  const hyX = 710;
  const hyY = 720;
  etch((g) => {
    g.beginPath();
    g.arc(hyX - 78, hyY, 44, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(hyX - 78, hyY, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(hyX - 78, hyY - 44, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(hyX - 78, hyY - 72);
    g.lineTo(hyX - 78, hyY - 52);
    g.moveTo(hyX - 78, hyY - 22);
    g.lineTo(hyX - 78, hyY + 22);
    g.stroke();

    g.beginPath();
    g.moveTo(hyX - 24, hyY);
    g.lineTo(hyX + 24, hyY);
    g.stroke();

    g.beginPath();
    g.arc(hyX + 78, hyY, 44, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(hyX + 78, hyY, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(hyX + 78, hyY + 44, 5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(hyX + 78, hyY + 52);
    g.lineTo(hyX + 78, hyY + 72);
    g.moveTo(hyX + 78, hyY - 22);
    g.lineTo(hyX + 78, hyY + 22);
    g.stroke();

    g.beginPath();
    g.moveTo(hyX, hyY + 62);
    g.lineTo(hyX, hyY + 86);
    g.stroke();
  }, 3.4);

  // Inner Golden Record Phonograph Disc with Concentric Microgrooves
  const discCanvas = document.createElement('canvas');
  discCanvas.width = 512;
  discCanvas.height = 512;
  const dCtx = discCanvas.getContext('2d')!;

  const discHeight = document.createElement('canvas');
  discHeight.width = 512;
  discHeight.height = 512;
  const dhCtx = discHeight.getContext('2d')!;

  const dGrad = dCtx.createRadialGradient(220, 220, 20, 256, 256, 256);
  dGrad.addColorStop(0, '#fae08c');
  dGrad.addColorStop(0.32, '#c89328');
  dGrad.addColorStop(0.7, '#e6b84c');
  dGrad.addColorStop(1, '#9f6e18');
  dCtx.fillStyle = dGrad;
  dCtx.fillRect(0, 0, 512, 512);
  dhCtx.fillStyle = '#808080';
  dhCtx.fillRect(0, 0, 512, 512);

  for (let r = 82; r < 245; r += 2) {
    dCtx.strokeStyle = r % 4 === 0 ? 'rgba(72, 46, 8, 0.42)' : 'rgba(255, 240, 175, 0.24)';
    dCtx.lineWidth = 1;
    dCtx.beginPath();
    dCtx.arc(256, 256, r, 0, Math.PI * 2);
    dCtx.stroke();

    dhCtx.strokeStyle = r % 4 === 0 ? '#2c2c2c' : '#d4d4d4';
    dhCtx.lineWidth = 1;
    dhCtx.beginPath();
    dhCtx.arc(256, 256, r, 0, Math.PI * 2);
    dhCtx.stroke();
  }
  dCtx.fillStyle = '#c58f24';
  dCtx.beginPath();
  dCtx.arc(256, 256, 76, 0, Math.PI * 2);
  dCtx.fill();

  return {
    goldenRecordCoverColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy),
    goldenRecordCoverNormal: heightCanvasToNormalTexture(heightCanvas, 4.0, maxAnisotropy),
    goldenRecordDiscColor: finalizeCanvasTexture(discCanvas, true, maxAnisotropy),
    goldenRecordDiscNormal: heightCanvasToNormalTexture(discHeight, 3.2, maxAnisotropy),
  };
}

/** Machined Bus Bay Backing Plate & Thermal Radiator Channels */
function createBusLouverTextures(maxAnisotropy: number) {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  cCtx.fillStyle = '#121720';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#484848';
  hCtx.fillRect(0, 0, size, size);

  for (let y = 24; y < size - 24; y += 16) {
    cCtx.fillStyle = '#090d14';
    cCtx.fillRect(24, y, size - 48, 8);
    hCtx.fillStyle = '#202020';
    hCtx.fillRect(24, y, size - 48, 8);
  }

  cCtx.strokeStyle = '#92a0b2';
  cCtx.lineWidth = 14;
  cCtx.strokeRect(7, 7, size - 14, size - 14);
  hCtx.strokeStyle = '#ececec';
  hCtx.lineWidth = 14;
  hCtx.strokeRect(7, 7, size - 14, size - 14);

  return {
    busLouversColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy),
    busLouversNormal: heightCanvasToNormalTexture(heightCanvas, 3.2, maxAnisotropy),
  };
}

/** High-Density Aerospace Internal Avionics PCB Texture + Normal & Roughness */
function createPcbTextures(maxAnisotropy: number) {
  const size = 1024;
  const rand = mulberry32(770820);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  cCtx.fillStyle = '#0d372a';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#525252';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#828282';
  rCtx.fillRect(0, 0, size, size);

  cCtx.strokeStyle = 'rgba(26, 88, 68, 0.25)';
  cCtx.lineWidth = 1;
  for (let i = 0; i < size; i += 10) {
    cCtx.beginPath();
    cCtx.moveTo(i, 0);
    cCtx.lineTo(i, size);
    cCtx.moveTo(0, i);
    cCtx.lineTo(size, i);
    cCtx.stroke();
  }

  for (let i = 0; i < 180; i++) {
    const x1 = Math.floor(rand() * 32) * 32;
    const y1 = Math.floor(rand() * 32) * 32;
    const horiz = rand() > 0.5;
    const len = (2 + Math.floor(rand() * 11)) * 32;
    const x2 = horiz ? Math.min(size - 20, x1 + len) : x1;
    const y2 = horiz ? y1 : Math.min(size - 20, y1 + len);

    const isGold = rand() > 0.32;
    cCtx.strokeStyle = isGold ? '#dcb34b' : '#2a9474';
    cCtx.lineWidth = 2.4 + rand() * 2;
    cCtx.beginPath();
    cCtx.moveTo(x1, y1);
    cCtx.lineTo(x2, y2);
    cCtx.stroke();

    hCtx.strokeStyle = '#c4c4c4';
    hCtx.lineWidth = 3;
    hCtx.beginPath();
    hCtx.moveTo(x1, y1);
    hCtx.lineTo(x2, y2);
    hCtx.stroke();

    if (isGold) {
      rCtx.strokeStyle = '#363636';
      rCtx.lineWidth = 3;
      rCtx.beginPath();
      rCtx.moveTo(x1, y1);
      rCtx.lineTo(x2, y2);
      rCtx.stroke();
    }

    cCtx.fillStyle = '#efd074';
    cCtx.beginPath();
    cCtx.arc(x1, y1, 4.5, 0, Math.PI * 2);
    cCtx.arc(x2, y2, 4.5, 0, Math.PI * 2);
    cCtx.fill();
  }

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 5; col++) {
      if (rand() < 0.2) continue;
      const x = 58 + col * 186 + (rand() - 0.5) * 14;
      const y = 58 + row * 148 + (rand() - 0.5) * 12;
      const w = 80 + rand() * 42;
      const h = 44 + rand() * 28;

      const isGoldCan = rand() > 0.58;
      cCtx.fillStyle = isGoldCan ? '#d4aa3e' : '#161c26';
      cCtx.fillRect(x, y, w, h);
      cCtx.strokeStyle = '#e0ba54';
      cCtx.lineWidth = 2;
      cCtx.strokeRect(x, y, w, h);

      hCtx.fillStyle = '#f4f4f4';
      hCtx.fillRect(x, y, w, h);
      rCtx.fillStyle = isGoldCan ? '#303030' : '#6c6c6c';
      rCtx.fillRect(x, y, w, h);

      cCtx.fillStyle = '#edd278';
      for (let lx = x + 6; lx < x + w - 6; lx += 9) {
        cCtx.fillRect(lx, y - 9, 4, 9);
        cCtx.fillRect(lx, y + h, 4, 9);
      }
    }
  }

  cCtx.fillStyle = '#082018';
  cCtx.fillRect(0, size - 58, size, 58);
  for (let x = 20; x < size - 20; x += 20) {
    cCtx.fillStyle = '#e8c156';
    cCtx.fillRect(x, size - 50, 12, 44);
    hCtx.fillStyle = '#e4e4e4';
    hCtx.fillRect(x, size - 50, 12, 44);
    rCtx.fillStyle = '#282828';
    rCtx.fillRect(x, size - 50, 12, 44);
  }

  return {
    pcbColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy),
    pcbNormal: heightCanvasToNormalTexture(heightCanvas, 3.4, maxAnisotropy),
    pcbRough: finalizeCanvasTexture(roughCanvas, false, maxAnisotropy),
  };
}

/** MHW-RTG High-Emissivity Ribbed Beryllium-Graphite Shell */
function createRtgTextures(maxAnisotropy: number) {
  const size = 512;
  const rand = mulberry32(238);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  cCtx.fillStyle = '#1d222b';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#686868';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#b8b8b8';
  rCtx.fillRect(0, 0, size, size);

  // Machined circumferential thermoelectric unicouple radiator ribs
  for (let y = 0; y < size; y += 16) {
    cCtx.fillStyle = '#2c3340';
    cCtx.fillRect(0, y, size, 7);
    cCtx.fillStyle = '#0d1016';
    cCtx.fillRect(0, y + 7, size, 3.5);

    hCtx.fillStyle = '#dedede';
    hCtx.fillRect(0, y, size, 7);
    hCtx.fillStyle = '#1c1c1c';
    hCtx.fillRect(0, y + 7, size, 3.5);
  }

  for (let i = 0; i < 6000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const v = 22 + Math.floor(rand() * 32);
    cCtx.fillStyle = `rgba(${v},${v + 2},${v + 6},0.35)`;
    cCtx.fillRect(x, y, 2, 2);

    const rv = 155 + Math.floor(rand() * 68);
    rCtx.fillStyle = `rgba(${rv},${rv},${rv},0.28)`;
    rCtx.fillRect(x, y, 3, 3);
  }

  // Heat-tinted brushed titanium retaining bands
  cCtx.fillStyle = '#9aa3b0';
  cCtx.fillRect(0, 20, size, 14);
  cCtx.fillRect(0, size - 34, size, 14);
  rCtx.fillStyle = '#444444';
  rCtx.fillRect(0, 20, size, 14);
  rCtx.fillRect(0, size - 34, size, 14);

  return {
    rtgSkinColor: finalizeCanvasTexture(colorCanvas, true, maxAnisotropy),
    rtgSkinNormal: heightCanvasToNormalTexture(heightCanvas, 3.8, maxAnisotropy),
    rtgSkinRough: finalizeCanvasTexture(roughCanvas, false, maxAnisotropy),
  };
}

/** Authentic Voyager 2 JPL Photometric Radiance Calibration Target Plaque */
function createCalTargetTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#eef2f6';
  ctx.fillRect(0, 0, size, size);

  // Machined outer border
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, size - 10, size - 10);

  // Reflectance greyscale step bars (authentic Voyager ISS calibration target)
  const greys = ['#f8fafc', '#cbd5e1', '#94a3b8', '#475569', '#1e293b'];
  for (let i = 0; i < greys.length; i++) {
    ctx.fillStyle = greys[i];
    ctx.fillRect(24 + i * 42, 28, 38, 66);
  }

  // Optical resolution crosshair & concentric rings
  const cx = 128;
  const cy = 166;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.5;
  for (const r of [14, 30, 46]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - 60, cy);
  ctx.lineTo(cx + 60, cy);
  ctx.moveTo(cx, cy - 56);
  ctx.lineTo(cx, cy + 56);
  ctx.stroke();

  // Corner mounting rivet marks
  ctx.fillStyle = '#475569';
  for (const [rx, ry] of [
    [22, 234],
    [234, 234],
    [22, 22],
    [234, 22],
  ]) {
    ctx.beginPath();
    ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return finalizeCanvasTexture(canvas, true, maxAnisotropy);
}

/** Soft Radial Contact Shadow Sprite for CAD Inspection Floor */
function createContactShadowTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const sSize = 512;
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = sSize;
  shadowCanvas.height = sSize;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sg = sCtx.createRadialGradient(256, 256, 12, 256, 256, 250);
  sg.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
  sg.addColorStop(0.4, 'rgba(0, 0, 0, 0.38)');
  sg.addColorStop(0.75, 'rgba(0, 0, 0, 0.08)');
  sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = sg;
  sCtx.fillRect(0, 0, sSize, sSize);
  return finalizeCanvasTexture(shadowCanvas, true, maxAnisotropy);
}

/** Tempered heat-oxidation bluing gradient for MR-103 Columbium/Inconel hydrazine thruster bells */
function createThrusterBluedTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // LatheGeometry maps v=0 at mounting base -> v=1 at flared exhaust lip
  const grad = ctx.createLinearGradient(0, 512, 0, 0);
  grad.addColorStop(0.0, '#9ba4b2');  // machined mounting collar
  grad.addColorStop(0.24, '#b89a6a'); // heat-affected straw gold
  grad.addColorStop(0.46, '#7b6288'); // tempered bronze-violet throat
  grad.addColorStop(0.68, '#41557a'); // cobalt oxidation bluing
  grad.addColorStop(0.88, '#282d38'); // dark heat-soaked bell skirt
  grad.addColorStop(1.0, '#181a20');  // carbon-tinted nozzle lip
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);

  // Subtle circumferential lathe turning marks
  for (let y = 0; y < 512; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, y, 256, 1.5);
  }

  return finalizeCanvasTexture(canvas, true, maxAnisotropy);
}

/** Reusable perimeter crevice Ambient Occlusion vignette map (channel 0 compatible) */
function createCreviceAoTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Soft edge crevice darkening along all 4 perimeter borders
  const border = 36;
  const topG = ctx.createLinearGradient(0, 0, 0, border);
  topG.addColorStop(0, 'rgba(35,35,35,0.72)');
  topG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, size, border);

  const botG = ctx.createLinearGradient(0, size, 0, size - border);
  botG.addColorStop(0, 'rgba(35,35,35,0.72)');
  botG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = botG;
  ctx.fillRect(0, size - border, size, border);

  const leftG = ctx.createLinearGradient(0, 0, border, 0);
  leftG.addColorStop(0, 'rgba(35,35,35,0.68)');
  leftG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = leftG;
  ctx.fillRect(0, 0, border, size);

  const rightG = ctx.createLinearGradient(size, 0, size - border, 0);
  rightG.addColorStop(0, 'rgba(35,35,35,0.68)');
  rightG.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rightG;
  ctx.fillRect(size - border, 0, border, size);

  const tex = finalizeCanvasTexture(canvas, false, maxAnisotropy);
  tex.channel = 0;
  return tex;
}

/** Crisp NASA/JPL aerospace flight stencil header nameplates for Bus Bays 1–10 */
function createBayStencilTextures(maxAnisotropy: number): THREE.CanvasTexture[] {
  const labels = [
    ['BAY 01', 'CCS · MJS-77'],
    ['BAY 02', 'PWR · 30VDC'],
    ['BAY 03', 'GOLDEN REC'],
    ['BAY 04', 'AACS · CST'],
    ['BAY 05', 'MOD · TLM'],
    ['BAY 06', 'RFS · X-BAND'],
    ['BAY 07', 'DTR · TAPE'],
    ['BAY 08', 'FDS · SCI'],
    ['BAY 09', 'PRA · PWS'],
    ['BAY 10', 'JPL · VGR-2'],
  ];

  return labels.map(([bayCode, subCode]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 64);

    // Subtle dark brushed anodized nameplate backing strip
    ctx.fillStyle = 'rgba(15, 20, 30, 0.88)';
    ctx.fillRect(6, 6, 500, 52);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(7, 7, 498, 50);

    // Left optical alignment fiducial crosshair
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(34, 32, 10, 0, Math.PI * 2);
    ctx.moveTo(20, 32);
    ctx.lineTo(48, 32);
    ctx.moveTo(34, 18);
    ctx.lineTo(34, 46);
    ctx.stroke();

    // NASA/JPL stencil typography
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(bayCode, 64, 33);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 20px "JetBrains Mono", monospace';
    ctx.fillText(subCode, 198, 33);

    // Right amber thermal warning tick bar
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(468, 16, 22, 32);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(476, 16, 6, 32);

    return finalizeCanvasTexture(canvas, true, maxAnisotropy);
  });
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const kapton = createKaptonTextures(maxAnisotropy);
  const hga = createHgaTextures(maxAnisotropy);
  const metal = createBrushedMetalTextures(maxAnisotropy);
  const braided = createBraidedConduitTextures(maxAnisotropy);
  const record = createGoldenRecordTextures(maxAnisotropy);
  const louvers = createBusLouverTextures(maxAnisotropy);
  const pcb = createPcbTextures(maxAnisotropy);
  const rtg = createRtgTextures(maxAnisotropy);
  const calTargetColor = createCalTargetTexture(maxAnisotropy);
  const contactShadow = createContactShadowTexture(maxAnisotropy);
  const thrusterBluedColor = createThrusterBluedTexture(maxAnisotropy);
  const creviceAo = createCreviceAoTexture(maxAnisotropy);
  const bayStencilTextures = createBayStencilTextures(maxAnisotropy);

  const all: THREE.Texture[] = [
    kapton.kaptonColor,
    kapton.kaptonNormal,
    kapton.kaptonRough,
    kapton.blackThermalColor,
    kapton.blackThermalNormal,
    kapton.blackThermalRough,
    hga.hgaColor,
    hga.hgaNormal,
    hga.hgaRough,
    metal.brushedMetalNormal,
    metal.brushedMetalRough,
    braided.braidedConduitColor,
    braided.braidedConduitNormal,
    record.goldenRecordCoverColor,
    record.goldenRecordCoverNormal,
    record.goldenRecordDiscColor,
    record.goldenRecordDiscNormal,
    louvers.busLouversColor,
    louvers.busLouversNormal,
    pcb.pcbColor,
    pcb.pcbNormal,
    pcb.pcbRough,
    rtg.rtgSkinColor,
    rtg.rtgSkinNormal,
    rtg.rtgSkinRough,
    calTargetColor,
    contactShadow,
    thrusterBluedColor,
    creviceAo,
    ...bayStencilTextures,
  ];

  return {
    ...kapton,
    ...hga,
    ...metal,
    ...braided,
    ...record,
    ...louvers,
    ...pcb,
    ...rtg,
    calTargetColor,
    contactShadow,
    thrusterBluedColor,
    creviceAo,
    bayStencilTextures,
    dispose: () => {
      all.forEach((t) => t.dispose());
    },
  };
}
