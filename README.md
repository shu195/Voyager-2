# Voyager 2 — Scientific 3D Visualizer

An interactive procedural WebGL 3D scientific visualization and structural disassembly model of NASA's **Voyager 2** interstellar probe, built with React, TypeScript, and Three.js—with zero external 3D mesh files.

## Features

- **16 Detachable Subsystems (`src/scene/buildVoyager2.ts`)**: High-detail procedural assembly with live mechanical kinematics and structural disassembly.
- **Internal Wiring Network (`src/scene/wiringNetwork.ts`)**: Color-coded Power, Data, and RF internal wiring traces routed between bus bays and instruments.
- **FLIR Thermal IR Inspection (`src/scene/thermalShader.ts`)**: Custom GLSL thermal infrared shader mode for inspecting spacecraft heat signatures.
- **Instrument FOV & X-Band RF Beam Cones (`src/scene/fovCones.ts`)**: Real-time field-of-view geometry for optical/particle instruments and the High-Gain Antenna RF beam.
- **Procedural PBR Pipeline (`src/scene/materials.ts` & `textures.ts`)**: High-resolution runtime-generated surface textures and HDR lighting.
- **Technical Dossier (`src/components/TechnicalDossier.tsx`)**: Detailed subsystem catalog and engineering specifications.

## Tech Stack

- **Framework**: React 19, TypeScript, Vite 8
- **3D / Graphics**: Three.js (`three`), custom GLSL shaders, procedural geometry & textures
- **Styling & Motion**: Tailwind CSS v4, Motion (`motion`), Lucide Icons

## Project Structure

```text
src/
├── App.tsx                             # Application state & layout
├── data/
│   └── voyagerCatalog.ts               # 16-subsystem technical catalog & specifications
├── scene/
│   ├── buildVoyager2.ts                # Procedural Voyager 2 3D assembly & kinematics
│   ├── materials.ts                    # PBR material library
│   ├── textures.ts                     # High-resolution procedural canvas textures
│   ├── wiringNetwork.ts                # Internal Power / Data / RF harness traces
│   ├── fovCones.ts                     # Instrument FOV & X-band RF beam cones
│   └── thermalShader.ts                # Custom FLIR thermal IR shader
└── components/
    ├── VoyagerViewport.tsx             # Three.js renderer, camera rig & HDR lighting
    ├── ControlDock.tsx                 # Disassembly, mode & inspection controls
    └── TechnicalDossier.tsx            # Subsystem technical dossier drawer
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended, `bun.lock` included) or Node.js 20+

### Installation & Local Development

```bash
git clone https://github.com/shu195/Voyager-2.git
cd Voyager-2
bun install
bun run dev
```

*(Or with npm: `npm install --legacy-peer-deps && npm run dev`)*

The development server runs at `http://localhost:3000`.

### Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start Vite dev server on port 3000 |
| `bun run build` | Build production bundle to `dist/` |
| `bun run preview` | Preview production build locally |
| `bun run lint` | Run TypeScript type-checking (`tsc --noEmit`) |

## Author

**Shubham Barmase** ([@shu195](https://github.com/shu195))

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.
