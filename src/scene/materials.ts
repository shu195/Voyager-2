import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';

export interface VoyagerMaterialLibrary {
  hgaDishWhite: THREE.MeshPhysicalMaterial;
  hgaSubReflector: THREE.MeshPhysicalMaterial;
  kaptonGoldFoil: THREE.MeshPhysicalMaterial;
  kaptonBlackThermal: THREE.MeshPhysicalMaterial;
  kaptonSilverFoil: THREE.MeshPhysicalMaterial;
  brushedTitanium: THREE.MeshPhysicalMaterial;
  structuralAluminum: THREE.MeshPhysicalMaterial;
  darkAnodizedAlloy: THREE.MeshPhysicalMaterial;
  busLouverPanel: THREE.MeshStandardMaterial;
  avionicsPcb: THREE.MeshStandardMaterial;
  copperCoil: THREE.MeshPhysicalMaterial;
  stainlessBraided: THREE.MeshStandardMaterial;
  goldenRecordCover: THREE.MeshPhysicalMaterial;
  goldenRecordDisc: THREE.MeshPhysicalMaterial;
  goldMirror: THREE.MeshPhysicalMaterial;
  rtgCarbonShell: THREE.MeshStandardMaterial;
  rtgFinBlack: THREE.MeshStandardMaterial;
  rtgHeatCollar: THREE.MeshPhysicalMaterial;
  hydrazineTitanium: THREE.MeshPhysicalMaterial;
  opticalLensGlass: THREE.MeshPhysicalMaterial;
  opticalBaffleBlack: THREE.MeshStandardMaterial;
  ceramicInsulator: THREE.MeshPhysicalMaterial;
  calTargetPlaque: THREE.MeshStandardMaterial;
  fiberglassBoom: THREE.MeshStandardMaterial;
  berylliumWhip: THREE.MeshPhysicalMaterial;
  powerHarness: THREE.MeshStandardMaterial;
  dataHarness: THREE.MeshStandardMaterial;
  rfHarness: THREE.MeshStandardMaterial;
  connectorGold: THREE.MeshPhysicalMaterial;
  thrusterBluedAlloy: THREE.MeshPhysicalMaterial;
  bayStencilMaterials: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

export function createVoyagerMaterials(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): VoyagerMaterialLibrary {
  // 3.7 m HGA thermal white composite enamel (S13G/LO)
  const hgaDishWhite = new THREE.MeshPhysicalMaterial({
    color: 0xe6ebf0,
    map: textures.hgaColor,
    normalMap: textures.hgaNormal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: textures.hgaRough,
    roughness: 0.58,
    metalness: 0.06,
    clearcoat: 0.16,
    clearcoatRoughness: 0.44,
    side: THREE.DoubleSide,
  });

  // Dichroic / machined aluminum Cassegrain sub-reflector housing
  const hgaSubReflector = new THREE.MeshPhysicalMaterial({
    color: 0xd0d7e0,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.34,
    metalness: 0.78,
    clearcoat: 0.18,
    clearcoatRoughness: 0.3,
    side: THREE.DoubleSide,
  });

  // Authentic 24k amber-gold crinkled NASA Kapton MLI blanket
  const kaptonGoldFoil = new THREE.MeshPhysicalMaterial({
    color: 0xe6a82e,
    map: textures.kaptonColor,
    normalMap: textures.kaptonNormal,
    normalScale: new THREE.Vector2(1.65, 1.65),
    roughnessMap: textures.kaptonRough,
    roughness: 0.25,
    metalness: 0.94,
    clearcoat: 0.34,
    clearcoatRoughness: 0.24,
    iridescence: 0.16,
    iridescenceIOR: 1.4,
    side: THREE.DoubleSide,
  });

  // Conductive matte carbon-black Kapton thermal blanket
  const kaptonBlackThermal = new THREE.MeshPhysicalMaterial({
    color: 0x181d27,
    map: textures.blackThermalColor,
    normalMap: textures.blackThermalNormal,
    normalScale: new THREE.Vector2(0.62, 0.62),
    roughnessMap: textures.blackThermalRough,
    roughness: 0.72,
    metalness: 0.18,
    clearcoat: 0.05,
    clearcoatRoughness: 0.65,
    side: THREE.DoubleSide,
  });

  // Aluminized Mylar / silver Kapton calibration & thermal shield
  const kaptonSilverFoil = new THREE.MeshPhysicalMaterial({
    color: 0xc2ccd8,
    normalMap: textures.kaptonNormal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: textures.kaptonRough,
    roughness: 0.34,
    metalness: 0.9,
    clearcoat: 0.16,
    side: THREE.DoubleSide,
  });

  // Warm gunmetal Ti-6Al-4V brushed titanium (distinct from brighter aluminum)
  const brushedTitanium = new THREE.MeshPhysicalMaterial({
    color: 0x8a919e,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.28,
    metalness: 0.91,
    clearcoat: 0.12,
    clearcoatRoughness: 0.35,
  });

  // Bright satin-milled 6061-T6 structural aluminum
  const structuralAluminum = new THREE.MeshPhysicalMaterial({
    color: 0xc8d1dc,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.3,
    metalness: 0.87,
    clearcoat: 0.1,
    clearcoatRoughness: 0.38,
  });

  // Hard-coat black anodized machined instrument alloy
  const darkAnodizedAlloy = new THREE.MeshPhysicalMaterial({
    color: 0x1c222e,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.42,
    metalness: 0.64,
    clearcoat: 0.2,
    clearcoatRoughness: 0.36,
  });

  // Bus thermal radiator bay recessed backing plate with deep perimeter crevice AO
  const busLouverPanel = new THREE.MeshStandardMaterial({
    color: 0xd0d8e4,
    map: textures.busLouversColor,
    normalMap: textures.busLouversNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    aoMap: textures.creviceAo,
    aoMapIntensity: 0.72,
    roughness: 0.44,
    metalness: 0.66,
  });

  // High-density emerald & gold aerospace PCB daughterboards with rack crevice AO
  const avionicsPcb = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.pcbColor,
    normalMap: textures.pcbNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: textures.pcbRough,
    aoMap: textures.creviceAo,
    aoMapIntensity: 0.58,
    roughness: 0.44,
    metalness: 0.38,
  });

  // Burnished copper RF waveguides, propellant lines & Helmholtz coils
  const copperCoil = new THREE.MeshPhysicalMaterial({
    color: 0xe07e3e,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.24,
    metalness: 0.94,
    clearcoat: 0.18,
    clearcoatRoughness: 0.25,
  });

  // Diamond-weave braided stainless steel cable shielding & flexible conduits
  const stainlessBraided = new THREE.MeshStandardMaterial({
    color: 0xd0d8e2,
    map: textures.braidedConduitColor,
    normalMap: textures.braidedConduitNormal,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughness: 0.36,
    metalness: 0.88,
  });

  // Voyager Golden Record engraved gold-anodized cover
  const goldenRecordCover = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: textures.goldenRecordCoverColor,
    normalMap: textures.goldenRecordCoverNormal,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.2,
    metalness: 0.95,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
  });

  // Inner gold-plated copper phonograph disc with concentric grooves
  const goldenRecordDisc = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: textures.goldenRecordDiscColor,
    normalMap: textures.goldenRecordDiscNormal,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughness: 0.16,
    metalness: 0.96,
  });

  // Precision vapor-deposited gold IR mirror (IRIS Cassegrain primary)
  const goldMirror = new THREE.MeshPhysicalMaterial({
    color: 0xf0c24c,
    roughness: 0.14,
    metalness: 0.97,
    clearcoat: 0.38,
    clearcoatRoughness: 0.12,
  });

  // High-emissivity SiC / beryllium-graphite MHW-RTG radiator housing with collar-seam AO
  const rtgCarbonShell = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.rtgSkinColor,
    normalMap: textures.rtgSkinNormal,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: textures.rtgSkinRough,
    aoMap: textures.creviceAo,
    aoMapIntensity: 0.48,
    roughness: 0.72,
    metalness: 0.28,
  });

  // Matte black high-emissivity RTG cooling fins
  const rtgFinBlack = new THREE.MeshStandardMaterial({
    color: 0x191d26,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.72,
    metalness: 0.34,
  });

  // Heat-tinted bronze-titanium RTG inter-stage couplers & clamp rings
  const rtgHeatCollar = new THREE.MeshPhysicalMaterial({
    color: 0x9c8b78,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.32,
    metalness: 0.9,
    clearcoat: 0.14,
  });

  // Polished titanium spherical hydrazine tank
  const hydrazineTitanium = new THREE.MeshPhysicalMaterial({
    color: 0xcbd3df,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughnessMap: textures.brushedMetalRough,
    roughness: 0.2,
    metalness: 0.93,
    clearcoat: 0.24,
    clearcoatRoughness: 0.18,
  });

  // Multi-coated anti-reflective sapphire/fluorite optical objective glass
  // Uses high-IOR clearcoat + thin-film iridescence over deep sapphire glass (zero double-pass transmission halos)
  const opticalLensGlass = new THREE.MeshPhysicalMaterial({
    color: 0x081d3a,
    roughness: 0.06,
    metalness: 0.16,
    ior: 1.68,
    reflectivity: 0.95,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    iridescence: isSoftwareGl ? 0.45 : 1.0,
    iridescenceIOR: 1.42,
    iridescenceThicknessMinimum: 210,
    iridescenceThicknessMaximum: 460,
    envMapIntensity: 1.55,
  });

  // Ultra-matte stray-light optical baffle interior (Martin Black)
  const opticalBaffleBlack = new THREE.MeshStandardMaterial({
    color: 0x0a0d12,
    roughness: 0.94,
    metalness: 0.06,
  });

  // Glazed high-voltage alumina porcelain antenna insulators
  const ceramicInsulator = new THREE.MeshPhysicalMaterial({
    color: 0xedf1f6,
    roughness: 0.16,
    metalness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
  });

  // JPL photometric reflectance calibration target plaque
  const calTargetPlaque = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.calTargetColor,
    roughness: 0.68,
    metalness: 0.08,
  });

  // Non-magnetic epoxy-fiberglass MAG deployable astromast
  const fiberglassBoom = new THREE.MeshStandardMaterial({
    color: 0xd9d1c0,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.58,
    metalness: 0.18,
  });

  // Telescoping beryllium-copper PRA/PWS whip antennas
  const berylliumWhip = new THREE.MeshPhysicalMaterial({
    color: 0xd6ab6a,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.25,
    metalness: 0.92,
  });

  // Color-coded internal engineering harnesses
  const powerHarness = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.36,
    roughness: 0.34,
    metalness: 0.34,
  });

  const dataHarness = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.4,
    roughness: 0.32,
    metalness: 0.3,
  });

  const rfHarness = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 0.38,
    roughness: 0.28,
    metalness: 0.68,
  });

  const connectorGold = new THREE.MeshPhysicalMaterial({
    color: 0xf2c248,
    roughness: 0.18,
    metalness: 0.96,
    clearcoat: 0.26,
  });

  // Heat-oxidized cobalt/straw blued Columbium-Inconel MR-103 hydrazine thruster bells
  const thrusterBluedAlloy = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: textures.thrusterBluedColor,
    normalMap: textures.brushedMetalNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughness: 0.26,
    metalness: 0.93,
    clearcoat: 0.28,
    clearcoatRoughness: 0.22,
    iridescence: isSoftwareGl ? 0.35 : 0.72,
    iridescenceIOR: 1.5,
    iridescenceThicknessMinimum: 180,
    iridescenceThicknessMaximum: 420,
    side: THREE.DoubleSide,
  });

  // NASA/JPL anodized flight stencil nameplates for Bus Bays 1–10 (zero Z-fighting via polygonOffset)
  const bayStencilMaterials = textures.bayStencilTextures.map(
    (tex) =>
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex,
        transparent: true,
        roughness: 0.48,
        metalness: 0.32,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
  );

  const allMaterials: THREE.Material[] = [
    hgaDishWhite,
    hgaSubReflector,
    kaptonGoldFoil,
    kaptonBlackThermal,
    kaptonSilverFoil,
    brushedTitanium,
    structuralAluminum,
    darkAnodizedAlloy,
    busLouverPanel,
    avionicsPcb,
    copperCoil,
    stainlessBraided,
    goldenRecordCover,
    goldenRecordDisc,
    goldMirror,
    rtgCarbonShell,
    rtgFinBlack,
    rtgHeatCollar,
    hydrazineTitanium,
    opticalLensGlass,
    opticalBaffleBlack,
    ceramicInsulator,
    calTargetPlaque,
    fiberglassBoom,
    berylliumWhip,
    powerHarness,
    dataHarness,
    rfHarness,
    connectorGold,
    thrusterBluedAlloy,
    ...bayStencilMaterials,
  ];

  return {
    hgaDishWhite,
    hgaSubReflector,
    kaptonGoldFoil,
    kaptonBlackThermal,
    kaptonSilverFoil,
    brushedTitanium,
    structuralAluminum,
    darkAnodizedAlloy,
    busLouverPanel,
    avionicsPcb,
    copperCoil,
    stainlessBraided,
    goldenRecordCover,
    goldenRecordDisc,
    goldMirror,
    rtgCarbonShell,
    rtgFinBlack,
    rtgHeatCollar,
    hydrazineTitanium,
    opticalLensGlass,
    opticalBaffleBlack,
    ceramicInsulator,
    calTargetPlaque,
    fiberglassBoom,
    berylliumWhip,
    powerHarness,
    dataHarness,
    rfHarness,
    connectorGold,
    thrusterBluedAlloy,
    bayStencilMaterials,
    dispose: () => {
      allMaterials.forEach((m) => m.dispose());
    },
  };
}
