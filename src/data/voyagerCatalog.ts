export type WiringBusType = 'power' | 'data' | 'rf';
export type WiringFilter = 'all' | WiringBusType;
export type EnvironmentMode = 'space' | 'cad';

export type SubsystemCategory =
  | 'Communications'
  | 'Structure & Avionics'
  | 'Power & Propulsion'
  | 'Remote Sensing'
  | 'Fields & Particles'
  | 'Cultural Payload';

export type OperationalStatus = 'Active' | 'Powered Down' | 'Structural';

export interface WiredConnection {
  bus: WiringBusType;
  portLabel: string;
  routeSummary: string;
}

export interface VoyagerSubsystemSpec {
  id: string;
  code: string;
  name: string;
  category: SubsystemCategory;
  isScienceInstrument: boolean;
  massKg: string;
  powerWatts: string;
  mountLocation: string;
  measurementRange: string;
  missionStatus: OperationalStatus;
  statusDetail: string;
  description: string;
  engineeringNotes: string;
  explodeOffset: [number, number, number];
  explodeRotation?: [number, number, number];
  anchorPoint: [number, number, number];
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  wiredBuses: WiredConnection[];
}

export interface CameraPreset {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export const WIRING_BUS_META: Record<
  WiringBusType,
  {
    label: string;
    shortLabel: string;
    voltageOrBand: string;
    colorHex: string;
    threeHex: number;
    description: string;
  }
> = {
  power: {
    label: 'Power Bus (30V DC)',
    shortLabel: 'Power',
    voltageOrBand: '30.0 V DC Regulated · 2.4 kHz AC',
    colorHex: '#F59E0B',
    threeHex: 0xf59e0b,
    description: 'Main MHW-RTG power conduit, Bay 2 shunt regulator, and 10-bay distribution ring.',
  },
  data: {
    label: 'Data Bus (CCS / FDS)',
    shortLabel: 'Data',
    voltageOrBand: '160 bps – 115.2 kbps Telemetry',
    colorHex: '#06B6D4',
    threeHex: 0x06b6d4,
    description: 'Flight Data Subsystem & Computer Command Subsystem braided instrumentation harness.',
  },
  rf: {
    label: 'RF Waveguide (S / X-Band)',
    shortLabel: 'RF',
    voltageOrBand: '2.295 GHz S-Band · 8.415 GHz X-Band',
    colorHex: '#F43F5E',
    threeHex: 0xf43f5e,
    description: 'Rigid S/X-band waveguides to the 3.7 m Cassegrain dish and PRA/PWS RF coax feeds.',
  },
};

export const VOYAGER_SUBSYSTEMS: VoyagerSubsystemSpec[] = [
  {
    id: 'hga',
    code: 'HGA',
    name: 'High-Gain Parabolic Antenna (3.7 m)',
    category: 'Communications',
    isScienceInstrument: false,
    massKg: '52.0 kg',
    powerWatts: '22.8 W (X-Band TWTA)',
    mountLocation: '+Z Spacecraft Axis (Top Deck)',
    measurementRange: 'S-Band 2.3 GHz / X-Band 8.4 GHz',
    missionStatus: 'Active',
    statusDetail: 'Continuous Deep Space Network link (>20.5 billion km)',
    description:
      'A 3.66 m aluminum-honeycomb fiberglass parabolic dish featuring a dual-frequency S/X-band Cassegrain sub-reflector supported by three low-loss struts and a central low-gain antenna mast.',
    engineeringNotes:
      'Maintains Earth lock within ±0.05° via Sun and Canopus optical trackers so the 0.5° X-band beam reaches 70 m Deep Space Network dishes.',
    explodeOffset: [0, 2.35, 0],
    anchorPoint: [0, 0.55, 0],
    cameraPosition: [4.8, 3.6, 4.8],
    cameraTarget: [0, 1.35, 0],
    wiredBuses: [
      { bus: 'rf', portLabel: 'WG-X1 / WG-S1', routeSummary: 'Bay 5 RFS Traveling-Wave Tube Amp → Dish Feed Horn' },
      { bus: 'data', portLabel: 'TEMP-HGA', routeSummary: 'Sub-reflector thermal sensor → Bay 8 FDS' },
    ],
  },
  {
    id: 'bus_shroud',
    code: 'MLI-BUS',
    name: 'Decagonal Thermal Shroud & Louvers',
    category: 'Structure & Avionics',
    isScienceInstrument: false,
    massKg: '38.4 kg',
    powerWatts: '0.0 W (Passive Bimetallic)',
    mountLocation: 'Main 10-Sided Bus Perimeter',
    measurementRange: 'Thermal Control (−10 °C to +45 °C)',
    missionStatus: 'Structural',
    statusDetail: 'Passive insulation & bimetallic radiator louvers',
    description:
      'Multi-layer aluminized Kapton/Mylar insulation blankets and bimetallic louver shutters wrapping the 1.78 m decagonal bus to retain electronics waste heat in deep interstellar space.',
    engineeringNotes:
      'Detach this outer shell to view all ten radial electronics bays, printed circuit boards, and internal MIL-SPEC harness routing.',
    explodeOffset: [0, -1.75, 0],
    anchorPoint: [0, 0, 0],
    cameraPosition: [3.2, 1.1, 3.6],
    cameraTarget: [0, -0.1, 0],
    wiredBuses: [
      { bus: 'power', portLabel: 'HTR-BUS-01', routeSummary: 'Bay 2 Power Distribution → Bus blanket strip heaters' },
      { bus: 'data', portLabel: 'THM-RING', routeSummary: '10-point perimeter thermistors → Bay 8 FDS' },
    ],
  },
  {
    id: 'avionics_bays',
    code: 'BAYS 1–10',
    name: '10-Bay Modular Avionics Deck',
    category: 'Structure & Avionics',
    isScienceInstrument: false,
    massKg: '164.5 kg',
    powerWatts: '94.0 W Combined Draw',
    mountLocation: 'Decagonal Bus Interior (Bays 1–10)',
    measurementRange: 'Dual Redundant 18-Bit Computers',
    missionStatus: 'Active',
    statusDetail: 'CCS, FDS, AACS, RFS, Modulation & Power Bays',
    description:
      'Ten removable wedge-shaped aluminum electronics modules housing the Computer Command Subsystem (Bay 1), Power Regulator (Bay 2), Attitude & Articulation Control (Bay 3), Radio Frequency Subsystem (Bay 5–6), Digital Tape Recorder (Bay 7), and Flight Data Subsystem (Bay 8).',
    engineeringNotes:
      'Each bay uses high-reliability conformal-coated PCBs with gold-plated wire-wrap backplanes and circular umbilical connectors tied directly into the internal harness ring.',
    explodeOffset: [0, -0.75, 0],
    anchorPoint: [0, 0, 0],
    cameraPosition: [2.8, 0.85, 2.9],
    cameraTarget: [0, -0.05, 0],
    wiredBuses: [
      { bus: 'power', portLabel: 'PWR-RING-30V', routeSummary: 'Bay 2 Shunt Regulator → All 10 Avionics Bays' },
      { bus: 'data', portLabel: 'CCS-FDS-BUS', routeSummary: 'Bay 1 CCS ↔ Bay 8 FDS ↔ Bay 7 DTR' },
      { bus: 'rf', portLabel: 'RFS-COAX-05', routeSummary: 'Bay 5/6 S & X-Band Exciters → Central Waveguide' },
    ],
  },
  {
    id: 'hydrazine_core',
    code: 'PROP',
    name: 'Hydrazine Core Tank & Thrusters',
    category: 'Power & Propulsion',
    isScienceInstrument: false,
    massKg: '104.0 kg (Propellant Loaded)',
    powerWatts: '8.5 W (Valve Heaters)',
    mountLocation: 'Central Decagonal Bus Cavity',
    measurementRange: '16 × 0.9 N Monopropellant Thrusters',
    missionStatus: 'Active',
    statusDetail: 'Backup roll/pitch/yaw thrusters active',
    description:
      'A 0.71 m titanium spherical tank suspended inside the hollow core of the decagonal bus, feeding anhydrous hydrazine through heated capillary lines to sixteen 0.9 N attitude control and trajectory correction thrusters.',
    engineeringNotes:
      'Central placement aligns propellant center-of-mass with the spacecraft spin/pointing axis to prevent attitude drift as fuel is consumed.',
    explodeOffset: [0, -2.55, 0],
    anchorPoint: [0, -0.1, 0],
    cameraPosition: [2.6, -0.9, 2.8],
    cameraTarget: [0, -0.3, 0],
    wiredBuses: [
      { bus: 'power', portLabel: 'PROP-VALVE', routeSummary: 'Bay 3 AACS → Thruster solenoid coils & line heaters' },
      { bus: 'data', portLabel: 'TANK-PRES', routeSummary: 'Pressure transducer → Bay 8 FDS telemetry' },
    ],
  },
  {
    id: 'golden_record',
    code: 'GOLD-REC',
    name: 'Voyager Golden Record & Cover',
    category: 'Cultural Payload',
    isScienceInstrument: false,
    massKg: '1.18 kg',
    powerWatts: '0.0 W (Passive Artifact)',
    mountLocation: 'Exterior of Bay 5 (Decagonal Bus)',
    measurementRange: '30 cm Gold-Plated Copper LP + Stylus',
    missionStatus: 'Structural',
    statusDetail: 'Sealed in anodized aluminum cover with U-238 sample',
    description:
      'A 12-inch gold-plated copper phonograph disc carrying 115 analog images, greetings in 55 languages, Earth soundscapes, and 90 minutes of music. Protected by an aluminum cover electroplated with an ultra-pure Uranium-238 epoch marker and engraved playback instructions.',
    engineeringNotes:
      'Cover engraving depicts the stylus playback speed in binary (using the 1420 MHz hydrogen spin-flip transition as time unit), video raster scan decoding, and a 14-pulsar Galactic map locating the Solar System.',
    explodeOffset: [0.0, 0.0, 1.55],
    anchorPoint: [0, 0, 0.918],
    cameraPosition: [0.35, 0.15, 2.55],
    cameraTarget: [0, 0, 0.92],
    wiredBuses: [],
  },
  {
    id: 'rtg_stack',
    code: 'MHW-RTG',
    name: 'Triple MHW-RTG Power Boom',
    category: 'Power & Propulsion',
    isScienceInstrument: false,
    massKg: '113.1 kg (3 × 37.7 kg)',
    powerWatts: '470 W Launch / ~225 W Current',
    mountLocation: '3.7 m Deployable Lower Boom (−X/−Y)',
    measurementRange: '24 × Pu-238 Oxide Spheres per RTG',
    missionStatus: 'Active',
    statusDetail: 'Decaying ~4 W/year; powering 4 active instruments',
    description:
      'Three tandem Multi-Hundred-Watt Radioisotope Thermoelectric Generators converting heat from plutonium-238 alpha decay across 312 silicon-germanium thermocouples into regulated 30 V DC spacecraft power.',
    engineeringNotes:
      'Mounted on a rigid boom angled away from the science scan platform to shield sensitive cosmic-ray and charged-particle detectors from neutron and gamma radiation.',
    explodeOffset: [-1.85, -1.05, 0.45],
    anchorPoint: [-0.88, -0.18, 0.12],
    cameraPosition: [-4.6, 0.9, 3.8],
    cameraTarget: [-2.1, -0.55, 0.25],
    wiredBuses: [
      { bus: 'power', portLabel: 'RTG-MAIN-A/B/C', routeSummary: '3× MHW-RTG → Armored boom cable → Bay 2 Shunt Regulator' },
      { bus: 'data', portLabel: 'RTG-TM-01', routeSummary: 'Hot-junction thermocouple sensors → Bay 8 FDS' },
    ],
  },
  {
    id: 'scan_platform_boom',
    code: 'SCAN-PLT',
    name: 'Science Scan Platform & 2-Axis Boom',
    category: 'Structure & Avionics',
    isScienceInstrument: false,
    massKg: '28.5 kg (Boom + Gimbal Actuators)',
    powerWatts: '4.2 W (Stepper Actuators)',
    mountLocation: '2.5 m Deployable Science Boom (+X)',
    measurementRange: '360° Azimuth · 210° Elevation',
    missionStatus: 'Powered Down',
    statusDetail: 'Platform parked after 1989 Neptune flyby',
    description:
      'A rigid open-truss fiberglass/aluminum boom terminating in a precision two-axis articulated gimbal platform that pointed Voyager 2’s optical and spectral instruments independently of spacecraft attitude.',
    engineeringNotes:
      'Carries the four remote-sensing payloads (ISS, IRIS, UVS, PPS) on its articulated yoke, while PLS, LECP, and CRS mount along the rigid boom neck.',
    explodeOffset: [1.55, -0.25, -0.35],
    anchorPoint: [0.88, -0.05, -0.1],
    cameraPosition: [5.4, 1.4, 3.1],
    cameraTarget: [2.75, -0.1, -0.15],
    wiredBuses: [
      { bus: 'power', portLabel: 'ACT-PWR-28V', routeSummary: 'Bay 2 Power → Gimbal stepper motors & survival heaters' },
      { bus: 'data', portLabel: 'AACS-ENC-04', routeSummary: 'Bay 3 AACS → Azimuth/Elevation optical encoders' },
    ],
  },
  {
    id: 'iss',
    code: 'ISS',
    name: 'Imaging Science Subsystem (NAC + WAC)',
    category: 'Remote Sensing',
    isScienceInstrument: true,
    massKg: '38.2 kg',
    powerWatts: '21.5 W',
    mountLocation: 'Science Scan Platform (Upper Deck)',
    measurementRange: '380 – 640 nm · 800×800 Slow-Scan Vidicon',
    missionStatus: 'Powered Down',
    statusDetail: 'Deactivated Oct 1989 post-Neptune; 33,000+ images captured',
    description:
      'Twin modified Mariner television cameras: a 1500 mm f/8.5 Narrow-Angle Cassegrain telephoto camera paired with a 200 mm f/3 Wide-Angle camera, each fitted with an 8-position optical filter wheel.',
    engineeringNotes:
      'Delivered the only close-up optical imagery of Uranus, Miranda, Neptune, and Triton’s nitrogen geysers in human history.',
    explodeOffset: [2.65, 0.95, 0.35],
    anchorPoint: [3.1, 0.18, 0.04],
    cameraPosition: [5.1, 1.35, 2.35],
    cameraTarget: [3.24, 0.18, 0.04],
    wiredBuses: [
      { bus: 'power', portLabel: 'ISS-PWR-11', routeSummary: 'Scan Platform Harness → Vidicon heaters & shutter coils' },
      { bus: 'data', portLabel: 'ISS-VID-115K', routeSummary: '8-bit digital video frames → Bay 8 FDS / Bay 7 DTR' },
    ],
  },
  {
    id: 'iris',
    code: 'IRIS',
    name: 'Infrared Interferometer Spectrometer',
    category: 'Remote Sensing',
    isScienceInstrument: true,
    massKg: '19.6 kg',
    powerWatts: '12.0 W',
    mountLocation: 'Science Scan Platform (Center Barrel)',
    measurementRange: '2.5 – 50 µm (200 – 4000 cm⁻¹)',
    missionStatus: 'Powered Down',
    statusDetail: 'Turned off Feb 2007 to conserve RTG power',
    description:
      'A 50 cm Cassegrain beryllium telescope feeding a Michelson interferometer and radiometer that measured atmospheric temperature profiles, helium-to-hydrogen ratios, and planetary energy balance.',
    engineeringNotes:
      'Maintained its optical cube at precisely 200 K via a gold-baffled radiative cooler to isolate faint thermal emission from Uranus and Neptune.',
    explodeOffset: [2.75, -0.15, 0.95],
    anchorPoint: [3.1, -0.16, 0.21],
    cameraPosition: [5.1, 0.55, 2.5],
    cameraTarget: [3.26, -0.16, 0.21],
    wiredBuses: [
      { bus: 'power', portLabel: 'IRIS-HTR-09', routeSummary: 'Bay 2 Bus → 200 K proportional optical heater' },
      { bus: 'data', portLabel: 'IRIS-SPEC', routeSummary: 'Interferogram ADC stream → Bay 8 FDS' },
    ],
  },
  {
    id: 'uvs',
    code: 'UVS',
    name: 'Ultraviolet Spectrometer',
    category: 'Remote Sensing',
    isScienceInstrument: true,
    massKg: '4.5 kg',
    powerWatts: '3.5 W',
    mountLocation: 'Science Scan Platform (Lower-Left)',
    measurementRange: '50 – 170 nm Extreme & Far UV',
    missionStatus: 'Powered Down',
    statusDetail: 'Disabled Nov 1998 to save power',
    description:
      'An objective-grating spectrometer with a 13-blade mechanical baffle collimator and 128-channel microchannel plate detector designed to measure upper-atmosphere hydrogen, helium, and auroral emissions.',
    engineeringNotes:
      'Performed stellar and solar occultations to profile the upper thermospheres of all four giant planets and Titan.',
    explodeOffset: [2.55, 0.8, -0.85],
    anchorPoint: [3.1, 0.15, -0.26],
    cameraPosition: [4.9, 1.15, -2.1],
    cameraTarget: [3.24, 0.15, -0.26],
    wiredBuses: [
      { bus: 'power', portLabel: 'UVS-HV-03', routeSummary: 'Bay 2 Bus → Microchannel plate HV supply' },
      { bus: 'data', portLabel: 'UVS-128CH', routeSummary: '128-channel spectral counts → Bay 8 FDS' },
    ],
  },
  {
    id: 'pps',
    code: 'PPS',
    name: 'Photopolarimeter Subsystem',
    category: 'Remote Sensing',
    isScienceInstrument: true,
    massKg: '4.4 kg',
    powerWatts: '2.4 W',
    mountLocation: 'Science Scan Platform (Lower-Right)',
    measurementRange: '235 – 750 nm (8 Filters + Polarizers)',
    missionStatus: 'Powered Down',
    statusDetail: 'Powered down April 1991',
    description:
      'A 20 cm Dahl-Kirkham Cassegrain telescope equipped with filter and polarization analyzer wheels to measure methane/ammonia haze scattering, surface texture, and high-resolution ring occultations.',
    engineeringNotes:
      'Resolved fine density waves and ringlets in Saturn’s and Uranus’s rings down to 100-meter radial precision during stellar occultations.',
    explodeOffset: [2.55, -0.95, -0.45],
    anchorPoint: [3.1, -0.24, -0.19],
    cameraPosition: [5.0, -0.65, 2.1],
    cameraTarget: [3.26, -0.24, -0.19],
    wiredBuses: [
      { bus: 'power', portLabel: 'PPS-28V', routeSummary: 'Scan Platform Harness → PMT & filter wheel motor' },
      { bus: 'data', portLabel: 'PPS-PHOT', routeSummary: 'High-speed photon count pulse stream → Bay 8 FDS' },
    ],
  },
  {
    id: 'pls',
    code: 'PLS',
    name: 'Plasma Science Experiment (Faraday Cups)',
    category: 'Fields & Particles',
    isScienceInstrument: true,
    massKg: '9.9 kg',
    powerWatts: '8.1 W',
    mountLocation: 'Science Boom Mid-Deck (+X)',
    measurementRange: '10 eV – 5950 eV Ions & Electrons',
    missionStatus: 'Powered Down',
    statusDetail: 'Turned off Sept 2024 after 47 years; confirmed heliopause crossing',
    description:
      'Four modulated-grid Faraday cup plasma detectors—three arranged in a triad facing the spacecraft–Earth/Sun direction and one lateral cup measuring perpendicular plasma velocity vectors.',
    engineeringNotes:
      'Provided the definitive November 2018 measurement showing solar wind plasma drop to zero as Voyager 2 entered interstellar space.',
    explodeOffset: [1.45, 0.95, 0.75],
    anchorPoint: [1.75, 0.14, 0.18],
    cameraPosition: [3.4, 1.3, 2.3],
    cameraTarget: [1.85, 0.15, 0.15],
    wiredBuses: [
      { bus: 'power', portLabel: 'PLS-MOD-HV', routeSummary: 'Bay 2 Bus → Modulated grid high-voltage sweep' },
      { bus: 'data', portLabel: 'PLS-CUP-4X', routeSummary: '4-cup electrometer currents → Bay 8 FDS' },
    ],
  },
  {
    id: 'lecp',
    code: 'LECP',
    name: 'Low-Energy Charged Particles',
    category: 'Fields & Particles',
    isScienceInstrument: true,
    massKg: '7.5 kg',
    powerWatts: '3.8 W',
    mountLocation: 'Science Boom Upper Mount (+X)',
    measurementRange: '10 keV – 11 MeV Electrons · 15 keV – 150 MeV Ions',
    missionStatus: 'Active',
    statusDetail: 'Operating in interstellar medium (stepper motor active)',
    description:
      'Two solid-state telescope subsystems (LEMPA and LEPT) mounted on a rotating 8-sector stepper turret that scans 360° every 192 seconds to sample particle pitch-angle distributions.',
    engineeringNotes:
      'One of Voyager 2’s four remaining operational scientific instruments still returning interstellar particle spectra daily.',
    explodeOffset: [1.35, 1.25, -0.75],
    anchorPoint: [1.55, 0.2, -0.22],
    cameraPosition: [3.2, 1.5, -2.0],
    cameraTarget: [1.6, 0.2, -0.22],
    wiredBuses: [
      { bus: 'power', portLabel: 'LECP-STEP', routeSummary: 'Bay 2 Bus → Turret stepper & detector bias' },
      { bus: 'data', portLabel: 'LECP-PHA', routeSummary: 'Pulse-height analyzer packets → Bay 8 FDS' },
    ],
  },
  {
    id: 'crs',
    code: 'CRS',
    name: 'Cosmic Ray Subsystem',
    category: 'Fields & Particles',
    isScienceInstrument: true,
    massKg: '7.5 kg',
    powerWatts: '5.4 W',
    mountLocation: 'Science Boom Lower Mount (+X)',
    measurementRange: '0.5 – 500 MeV/nucleon Galactic Cosmic Rays',
    missionStatus: 'Active',
    statusDetail: 'Active in interstellar medium (HET/LET/TET arrays)',
    description:
      'Seven independent solid-state silicon detector telescopes—two High-Energy Telescopes (HET), four Low-Energy Telescopes (LET), and one Electron Telescope (TET)—measuring elemental and isotopic cosmic-ray composition.',
    engineeringNotes:
      'Continuously tracks galactic cosmic-ray flux outside the heliosphere with zero magnetic shielding interference.',
    explodeOffset: [1.25, -1.15, 0.45],
    anchorPoint: [1.45, -0.22, 0.14],
    cameraPosition: [3.1, -0.95, 2.1],
    cameraTarget: [1.5, -0.22, 0.14],
    wiredBuses: [
      { bus: 'power', portLabel: 'CRS-BIAS', routeSummary: 'Bay 2 Bus → Silicon stack reverse-bias regulators' },
      { bus: 'data', portLabel: 'CRS-7TEL', routeSummary: 'Coincidence logic events → Bay 8 FDS' },
    ],
  },
  {
    id: 'mag_boom',
    code: 'MAG',
    name: 'Triaxial Fluxgate Magnetometer (13 m Boom)',
    category: 'Fields & Particles',
    isScienceInstrument: true,
    massKg: '5.6 kg (Sensors + Astromast)',
    powerWatts: '2.2 W',
    mountLocation: '13 m Collapsible Fiberglass Astromast (−Z / +Y)',
    measurementRange: '0.005 nT – 2,000,000 nT (Dual Range)',
    missionStatus: 'Active',
    statusDetail: 'Measuring interstellar magnetic field (~0.6 nT)',
    description:
      'An iconic 13-meter deployable fiberglass-epoxy triangular lattice boom placing two low-field triaxial fluxgate magnetometers far from spacecraft stray fields, complemented by two high-field sensors near the bus.',
    engineeringNotes:
      'Stowed inside a compact 0.6 m canister at launch and deployed via spring-loaded fiberglass longerons; dual-sensor gradient cancellation strips spacecraft magnetic noise.',
    explodeOffset: [-0.45, 0.55, -2.35],
    anchorPoint: [-0.15, 0.05, -0.9],
    cameraPosition: [-3.8, 2.2, -5.8],
    cameraTarget: [-0.3, 0.15, -3.2],
    wiredBuses: [
      { bus: 'power', portLabel: 'MAG-DRIVE', routeSummary: 'Bay 2 Bus → Fluxgate ring-core excitation coils' },
      { bus: 'data', portLabel: 'MAG-3AX', routeSummary: 'Twisted shielded pairs along 13 m boom → Bay 8 FDS' },
    ],
  },
  {
    id: 'pra_pws',
    code: 'PRA / PWS',
    name: 'Planetary Radio & Plasma Wave Whips (2 × 10 m)',
    category: 'Fields & Particles',
    isScienceInstrument: true,
    massKg: '9.1 kg Combined',
    powerWatts: '4.1 W Combined',
    mountLocation: 'Twin Orthogonal 10 m Whip Antennas (−X / −Z)',
    measurementRange: '10 Hz – 56 kHz (PWS) · 1.2 kHz – 40.5 MHz (PRA)',
    missionStatus: 'Active',
    statusDetail: 'PWS active measuring interstellar electron density; PRA off',
    description:
      'Two 10-meter tubular beryllium-copper monopole whip antennas deployed at 90° to one another, shared between the Planetary Radio Astronomy (PRA) receiver and the Plasma Wave Subsystem (PWS).',
    engineeringNotes:
      'PWS detects plasma oscillations excited by solar coronal mass ejections propagating through interstellar gas, directly yielding local interstellar electron density.',
    explodeOffset: [-1.45, -1.25, -1.45],
    anchorPoint: [-0.74, -0.2, -0.74],
    cameraPosition: [-5.2, -1.1, -4.8],
    cameraTarget: [-1.8, -0.9, -1.8],
    wiredBuses: [
      { bus: 'power', portLabel: 'PWS-PREAMP', routeSummary: 'Bay 2 Bus → Low-noise dipole preamplifier power' },
      { bus: 'data', portLabel: 'PWS-16CH', routeSummary: '16-channel spectrum analyzer → Bay 8 FDS' },
      { bus: 'rf', portLabel: 'PRA-COAX-AB', routeSummary: 'Twin 10 m whip monopoles → Bay 9 PRA/PWS RF coupler' },
    ],
  },
];

export const SUBSYSTEM_BY_ID: Record<string, VoyagerSubsystemSpec> = Object.fromEntries(
  VOYAGER_SUBSYSTEMS.map((s) => [s.id, s]),
);

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'overview',
    label: 'Overview',
    position: [5.1, 2.85, 6.1],
    target: [0.2, 0.22, -0.15],
  },
  {
    id: 'hga',
    label: 'HGA Dish',
    position: [4.4, 3.8, 4.4],
    target: [0, 1.3, 0],
  },
  {
    id: 'scan_platform',
    label: 'Scan Platform',
    position: [5.4, 1.4, 3.1],
    target: [2.75, -0.05, -0.1],
  },
  {
    id: 'bus_core',
    label: 'Bus & Wiring',
    position: [2.95, 1.1, 3.25],
    target: [0, -0.08, 0],
  },
  {
    id: 'rtg',
    label: 'MHW-RTGs',
    position: [-4.6, 0.9, 3.8],
    target: [-2.1, -0.55, 0.25],
  },
  {
    id: 'booms',
    label: 'MAG & Whips',
    position: [-5.4, 2.8, -7.2],
    target: [-0.7, -0.1, -2.8],
  },
  {
    id: 'golden_record',
    label: 'Golden Record',
    position: [0.32, 0.15, 2.45],
    target: [0, 0, 0.92],
  },
];
