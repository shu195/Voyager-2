import { useCallback, useEffect, useState } from 'react';
import { ControlDock } from './components/ControlDock';
import { TechnicalDossier } from './components/TechnicalDossier';
import {
  CameraFocusCommand,
  HoverPayload,
  VoyagerViewport,
} from './components/VoyagerViewport';
import {
  CAMERA_PRESETS,
  EnvironmentMode,
  SUBSYSTEM_BY_ID,
  WiringFilter,
} from './data/voyagerCatalog';

export default function App() {
  const isCinematic =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('cinematic') === '1';
  const [globalExplode, setGlobalExplode] = useState<number>(0);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set());
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [wiringFilter, setWiringFilter] = useState<WiringFilter>('all');
  const [signalTraceEnabled, setSignalTraceEnabled] = useState<boolean>(true);
  const [environmentMode, setEnvironmentMode] = useState<EnvironmentMode>('space');
  const [cadLightIntensity, setCadLightIntensity] = useState<number>(1.0);
  const [thermalMode, setThermalMode] = useState<boolean>(false);
  const [showFovCones, setShowFovCones] = useState<boolean>(false);
  const [kinematicsOpen, setKinematicsOpen] = useState<boolean>(false);
  const [liveMotion, setLiveMotion] = useState<boolean>(true);
  const [scanAutoSweep, setScanAutoSweep] = useState<boolean>(true);
  const [scanAzimuthDeg, setScanAzimuthDeg] = useState<number>(18);
  const [scanElevationDeg, setScanElevationDeg] = useState<number>(10);
  const [rcsPulseNonce, setRcsPulseNonce] = useState<number>(0);
  const [activePresetId, setActivePresetId] = useState<string | null>('overview');
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);
  const [dossierOpen, setDossierOpen] = useState<boolean>(false);
  const [hoverInfo, setHoverInfo] = useState<HoverPayload>({
    partId: null,
    x: 0,
    y: 0,
  });
  const [cameraCommand, setCameraCommand] = useState<CameraFocusCommand | null>(
    null,
  );

  const issueCameraFocus = useCallback(
    (position: [number, number, number], target: [number, number, number]) => {
      setCameraCommand({
        id: Date.now() + Math.random(),
        position,
        target,
      });
    },
    [],
  );

  const handleSelectCameraPreset = useCallback(
    (presetId: string) => {
      const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setActivePresetId(presetId);
      issueCameraFocus(preset.position, preset.target);
    },
    [issueCameraFocus],
  );

  const handleFocusPart = useCallback(
    (partId: string) => {
      const spec = SUBSYSTEM_BY_ID[partId];
      if (!spec) return;
      setActivePresetId(null);
      issueCameraFocus(spec.cameraPosition, spec.cameraTarget);
    },
    [issueCameraFocus],
  );

  const handleSelectPart = useCallback((partId: string | null) => {
    setSelectedPartId(partId);
    if (partId) {
      setDossierOpen(true);
    }
  }, []);

  const handleToggleDetachPart = useCallback((partId: string) => {
    setDetachedIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  }, []);

  const handleExplodeChange = useCallback((value: number) => {
    setGlobalExplode(value);
    if (value === 0) {
      setDetachedIds(new Set());
    }
  }, []);

  const handleDetachAll = useCallback(() => {
    setGlobalExplode(1);
    setDetachedIds(new Set());
  }, []);

  const handleReassembleAll = useCallback(() => {
    setGlobalExplode(0);
    setDetachedIds(new Set());
  }, []);

  // Keyboard shortcuts for engineering inspection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        setHudCollapsed((v) => !v);
      } else if (e.key === 'r' || e.key === 'R') {
        handleReassembleAll();
      } else if (e.key === 'e' || e.key === 'E') {
        setGlobalExplode((prev) => (prev > 0.5 ? 0 : 1));
        setDetachedIds(new Set());
      } else if (e.key === 't' || e.key === 'T') {
        setThermalMode((v) => !v);
      } else if (e.key === 'b' || e.key === 'B') {
        setShowFovCones((v) => !v);
      } else if (e.key === 'k' || e.key === 'K') {
        setKinematicsOpen((v) => !v);
      } else if (e.key === 'm' || e.key === 'M') {
        setLiveMotion((v) => !v);
      } else if (e.key === ' ') {
        e.preventDefault();
        setSignalTraceEnabled((v) => !v);
      } else if (e.key === 'Escape') {
        setDossierOpen(false);
        setSelectedPartId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleReassembleAll]);

  const hoveredSpec = hoverInfo.partId ? SUBSYSTEM_BY_ID[hoverInfo.partId] : null;
  const isHoveredDetached = hoveredSpec
    ? detachedIds.has(hoveredSpec.id) || globalExplode > 0.5
    : false;

  const assemblyStateLabel =
    globalExplode > 0.95
      ? 'Full Disassembly'
      : globalExplode > 0.02
        ? `Exploded ${Math.round(globalExplode * 100)}%`
        : detachedIds.size > 0
          ? `${detachedIds.size} Detached`
          : 'Flight Configuration';

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#060911]">
      {/* Unobstructed Full-Viewport 3D WebGL Stage */}
      <VoyagerViewport
        globalExplode={globalExplode}
        detachedIds={detachedIds}
        selectedPartId={selectedPartId}
        wiringFilter={wiringFilter}
        signalTraceEnabled={signalTraceEnabled}
        environmentMode={environmentMode}
        cadLightIntensity={cadLightIntensity}
        thermalMode={thermalMode}
        liveMotion={liveMotion}
        scanAutoSweep={scanAutoSweep}
        scanAzimuthDeg={scanAzimuthDeg}
        scanElevationDeg={scanElevationDeg}
        rcsPulseNonce={rcsPulseNonce}
        showFovCones={showFovCones}
        cameraCommand={cameraCommand}
        onSelectPart={handleSelectPart}
        onToggleDetachPart={handleToggleDetachPart}
        onHoverChange={setHoverInfo}
      />

      {!isCinematic && (
        <>
          {/* Minimal Top-Left Identity Lockup (Clean unboxed typography, zero pill clutter) */}
          <header className="fixed top-5 left-6 z-20 pointer-events-none select-none">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-100 leading-none">
          Voyager 2
        </h1>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
          <span>Mariner Jupiter-Saturn 1977</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-slate-300">
            {assemblyStateLabel}
          </span>
          {thermalMode && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-amber-400">FLIR Ironbow IR</span>
            </>
          )}
          {!thermalMode && showFovCones && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-rose-300">FOV &amp; RF Beams</span>
            </>
          )}
        </div>
      </header>

      {/* Compact Non-Occluding FLIR Thermal Scale Legend */}
      {thermalMode && !dossierOpen && (
        <aside
          aria-label="FLIR Ironbow thermal temperature scale"
          className="fixed top-5 right-6 z-20 w-[236px] bg-[#0B101B]/95 border border-[#223047] rounded-lg px-3.5 py-2.5 shadow-xl pointer-events-none select-none"
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300 mb-1.5">
            <span>Thermal Radiance</span>
            <span className="font-mono text-amber-400">LWIR 8–14 μm</span>
          </div>
          <div
            className="h-2.5 w-full rounded-sm border border-[#1E2A40]"
            style={{
              background:
                'linear-gradient(90deg, #050824 0%, #1c0f5c 18%, #6b148f 36%, #c7296b 54%, #f56b1a 72%, #ffcc2e 88%, #fffce6 100%)',
            }}
          />
          <div className="flex items-center justify-between font-mono tabular-nums text-[10px] text-slate-400 mt-1">
            <span>−215 °C</span>
            <span>+5 °C</span>
            <span className="text-amber-300">+225 °C</span>
          </div>
          <div className="mt-2 pt-1.5 border-t border-[#1A2538] space-y-1 text-[10px] font-mono tabular-nums text-slate-400">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">MHW-RTG Pu-238</span>
              <span className="text-amber-300">+220 °C</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Bus Louvers / Tank</span>
              <span className="text-rose-300">+28 °C</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-300">HGA / Scan Optics</span>
              <span className="text-indigo-300">−200 °C</span>
            </div>
          </div>
        </aside>
      )}

      {/* Lightweight Cursor Hover Callout */}
      {hoveredSpec && (
        <div
          className="fixed z-30 pointer-events-none px-3 py-2 bg-[#0B101B]/95 border border-[#263650] rounded-lg shadow-xl max-w-[260px]"
          style={{
            left: Math.min(hoverInfo.x + 16, window.innerWidth - 280),
            top: Math.max(hoverInfo.y - 12, 16),
          }}
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono font-medium text-cyan-400">
              {hoveredSpec.code}
            </span>
            <span className="font-medium text-slate-100 truncate">
              {hoveredSpec.name}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Click to inspect · Double-click to{' '}
            {isHoveredDetached ? 'reattach' : 'detach'}
          </div>
        </div>
      )}

      {/* On-Demand Slide-Over Technical Dossier Drawer */}
      <TechnicalDossier
        isOpen={dossierOpen}
        selectedPartId={selectedPartId}
        globalExplode={globalExplode}
        detachedIds={detachedIds}
        wiringFilter={wiringFilter}
        onClose={() => setDossierOpen(false)}
        onSelectPart={(id) => setSelectedPartId(id)}
        onToggleDetachPart={handleToggleDetachPart}
        onFocusPart={handleFocusPart}
        onWiringFilterChange={setWiringFilter}
      />

      {/* Unified Collapsible Bottom Control Dock */}
      <ControlDock
        globalExplode={globalExplode}
        detachedCount={detachedIds.size}
        wiringFilter={wiringFilter}
        signalTraceEnabled={signalTraceEnabled}
        environmentMode={environmentMode}
        cadLightIntensity={cadLightIntensity}
        thermalMode={thermalMode}
        showFovCones={showFovCones}
        kinematicsOpen={kinematicsOpen}
        liveMotion={liveMotion}
        scanAutoSweep={scanAutoSweep}
        scanAzimuthDeg={scanAzimuthDeg}
        scanElevationDeg={scanElevationDeg}
        activePresetId={activePresetId}
        hudCollapsed={hudCollapsed}
        dossierOpen={dossierOpen}
        onExplodeChange={handleExplodeChange}
        onDetachAll={handleDetachAll}
        onReassembleAll={handleReassembleAll}
        onWiringFilterChange={setWiringFilter}
        onToggleSignalTrace={() => setSignalTraceEnabled((v) => !v)}
        onEnvironmentChange={setEnvironmentMode}
        onCadLightIntensityChange={setCadLightIntensity}
        onToggleThermalMode={() => setThermalMode((v) => !v)}
        onToggleFovCones={() => setShowFovCones((v) => !v)}
        onToggleKinematicsOpen={() => setKinematicsOpen((v) => !v)}
        onToggleLiveMotion={() => setLiveMotion((v) => !v)}
        onScanAutoSweepChange={setScanAutoSweep}
        onScanAzimuthChange={setScanAzimuthDeg}
        onScanElevationChange={setScanElevationDeg}
        onFireRcsPulse={() => setRcsPulseNonce((n) => n + 1)}
        onSelectCameraPreset={handleSelectCameraPreset}
        onToggleHud={() => setHudCollapsed((v) => !v)}
        onToggleDossier={() => setDossierOpen((v) => !v)}
      />
        </>
      )}
    </main>
  );
}
