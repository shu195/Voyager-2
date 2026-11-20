import {
  ChevronDown,
  ChevronUp,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Flame,
  BookOpen,
  Maximize2,
  Radar,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import {
  CAMERA_PRESETS,
  EnvironmentMode,
  WIRING_BUS_META,
  WiringFilter,
} from '../data/voyagerCatalog';

interface ControlDockProps {
  globalExplode: number;
  detachedCount: number;
  wiringFilter: WiringFilter;
  signalTraceEnabled: boolean;
  environmentMode: EnvironmentMode;
  cadLightIntensity: number;
  thermalMode: boolean;
  showFovCones: boolean;
  kinematicsOpen: boolean;
  liveMotion: boolean;
  scanAutoSweep: boolean;
  scanAzimuthDeg: number;
  scanElevationDeg: number;
  activePresetId: string | null;
  hudCollapsed: boolean;
  dossierOpen: boolean;
  onExplodeChange: (value: number) => void;
  onDetachAll: () => void;
  onReassembleAll: () => void;
  onWiringFilterChange: (filter: WiringFilter) => void;
  onToggleSignalTrace: () => void;
  onEnvironmentChange: (mode: EnvironmentMode) => void;
  onCadLightIntensityChange: (value: number) => void;
  onToggleThermalMode: () => void;
  onToggleFovCones: () => void;
  onToggleKinematicsOpen: () => void;
  onToggleLiveMotion: () => void;
  onScanAutoSweepChange: (auto: boolean) => void;
  onScanAzimuthChange: (deg: number) => void;
  onScanElevationChange: (deg: number) => void;
  onFireRcsPulse: () => void;
  onSelectCameraPreset: (presetId: string) => void;
  onToggleHud: () => void;
  onToggleDossier: () => void;
}

const WIRING_OPTIONS: Array<{ id: WiringFilter; label: string; dotColor?: string }> = [
  { id: 'all', label: 'All Buses' },
  { id: 'power', label: 'Power', dotColor: WIRING_BUS_META.power.colorHex },
  { id: 'data', label: 'Data', dotColor: WIRING_BUS_META.data.colorHex },
  { id: 'rf', label: 'RF', dotColor: WIRING_BUS_META.rf.colorHex },
];

export function ControlDock({
  globalExplode,
  detachedCount,
  wiringFilter,
  signalTraceEnabled,
  environmentMode,
  cadLightIntensity,
  thermalMode,
  showFovCones,
  kinematicsOpen,
  liveMotion,
  scanAutoSweep,
  scanAzimuthDeg,
  scanElevationDeg,
  activePresetId,
  hudCollapsed,
  dossierOpen,
  onExplodeChange,
  onDetachAll,
  onReassembleAll,
  onWiringFilterChange,
  onToggleSignalTrace,
  onEnvironmentChange,
  onCadLightIntensityChange,
  onToggleThermalMode,
  onToggleFovCones,
  onToggleKinematicsOpen,
  onToggleLiveMotion,
  onScanAutoSweepChange,
  onScanAzimuthChange,
  onScanElevationChange,
  onFireRcsPulse,
  onSelectCameraPreset,
  onToggleHud,
  onToggleDossier,
}: ControlDockProps) {
  const explodePct = Math.round(globalExplode * 100);
  const cadIntensityPct = Math.round(cadLightIntensity * 100);
  const isAssembled = globalExplode < 0.01 && detachedCount === 0;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-20 w-[min(1224px,96vw)] transition-transform duration-300 ease-out pointer-events-none"
      style={{
        transform: hudCollapsed
          ? 'translate(-50%, calc(100% + 22px))'
          : 'translate(-50%, 0)',
      }}
    >
      {/* Collapse / Expand tab attached to top edge of dock */}
      <div className="flex justify-center mb-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={onToggleHud}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-neutral-700 hover:text-neutral-950 bg-[#F4F5F7]/95 hover:bg-white border border-neutral-300 rounded-md shadow-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          aria-expanded={!hudCollapsed}
        >
          {hudCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-neutral-800" />
              <span>Show Controls</span>
              <span className="font-mono text-[11px] text-neutral-400 ml-0.5">H</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
              <span>Hide Controls</span>
              <span className="font-mono text-[11px] text-neutral-400 ml-0.5">H</span>
            </>
          )}
        </button>
      </div>

      {/* Main Unified Solid Dock — Precision Grey & White Theme (Zero backdrop-filter over WebGL) */}
      <div className="pointer-events-auto bg-[#F4F5F7]/95 border border-neutral-300/90 rounded-xl px-3.5 py-2.5 shadow-[0_14px_38px_rgba(0,0,0,0.45)] text-neutral-800">
        {/* Row 1: Disassembly Slider, Wiring Bus Filter, Signal Trace, Environment, Thermal IR, Dossier */}
        <div className="flex flex-wrap 2xl:flex-nowrap items-center justify-between gap-x-2 gap-y-2 pb-2 border-b border-neutral-300/80">
          {/* Global Exploded-View Slider + Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center gap-1 text-xs font-medium text-neutral-700 whitespace-nowrap shrink-0">
              <Layers className="w-3.5 h-3.5 text-neutral-600" />
              <span>Explode</span>
            </div>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={explodePct}
              onChange={(e) => onExplodeChange(Number(e.target.value) / 100)}
              aria-label="Global exploded view separation"
              className="voyager-slider w-[72px] xl:w-[92px] shrink-0"
            />

            <span className="font-mono tabular-nums text-xs font-medium text-neutral-800 w-8 text-right shrink-0">
              {explodePct}%
            </span>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onDetachAll}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-neutral-800 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Explode all 16 subsystems (E)"
              >
                <Maximize2 className="w-3 h-3 text-neutral-600" />
                <span>Detach All</span>
              </button>
              <button
                type="button"
                onClick={onReassembleAll}
                disabled={isAssembled}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  isAssembled
                    ? 'text-neutral-400 bg-neutral-200/70 border-neutral-200 cursor-not-allowed'
                    : 'text-neutral-800 bg-white hover:bg-neutral-100 border-neutral-300 cursor-pointer'
                }`}
                title="Reassemble spacecraft (R)"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Wiring Harness Bus Selector + Signal Trace */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="flex items-center gap-0.5 p-0.5 bg-[#E5E7EB] border border-neutral-300 rounded-lg"
              role="group"
              aria-label="Wiring bus filter"
            >
              {WIRING_OPTIONS.map((opt) => {
                const active = wiringFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onWiringFilterChange(opt.id)}
                    className={`flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-white text-neutral-950 shadow-xs'
                        : 'text-neutral-600 hover:text-neutral-950'
                    }`}
                  >
                    {opt.dotColor && (
                      <span
                        className="w-2 h-2 rounded-xs shrink-0"
                        style={{ backgroundColor: opt.dotColor }}
                        aria-hidden="true"
                      />
                    )}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onToggleSignalTrace}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                signalTraceEnabled
                  ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950'
              }`}
              title="Toggle live electrical/RF signal trace pulses (Space)"
            >
              {signalTraceEnabled ? (
                <Pause className="w-3 h-3 text-neutral-200" />
              ) : (
                <Play className="w-3 h-3 text-neutral-600" />
              )}
              <span>Signal Trace</span>
            </button>
          </div>

          {/* Environment Toggle, Thermal IR & Technical Dossier Trigger */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="flex items-center gap-0.5 p-0.5 bg-[#E5E7EB] border border-neutral-300 rounded-lg"
              role="group"
              aria-label="Lighting environment"
            >
              <button
                type="button"
                onClick={() => {
                  if (thermalMode) onToggleThermalMode();
                  onEnvironmentChange('space');
                }}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !thermalMode && environmentMode === 'space'
                    ? 'bg-white text-neutral-950 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <Sparkles className="w-3 h-3 text-neutral-600" />
                <span>Deep Space</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (thermalMode) onToggleThermalMode();
                  onEnvironmentChange('cad');
                }}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !thermalMode && environmentMode === 'cad'
                    ? 'bg-white text-neutral-950 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                <Sun className="w-3 h-3 text-neutral-600" />
                <span>Studio CAD</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onToggleThermalMode}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                thermalMode
                  ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                  : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950'
              }`}
              title="Toggle FLIR Ironbow thermal infrared mode (T)"
              aria-pressed={thermalMode}
            >
              <Flame
                className={`w-3.5 h-3.5 ${thermalMode ? 'text-white' : 'text-neutral-600'}`}
              />
              <span>Thermal IR</span>
            </button>

            <button
              type="button"
              onClick={onToggleDossier}
              className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                dossierOpen
                  ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                  : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Dossier</span>
            </button>
          </div>
        </div>

        {/* Studio CAD HDR Lighting Intensity Fine-Tuning Bar */}
        {!thermalMode && environmentMode === 'cad' && (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-neutral-300/80">
            <div className="flex items-center gap-3 flex-1 min-w-[260px]">
              <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 whitespace-nowrap shrink-0">
                <Sun className="w-3.5 h-3.5 text-neutral-600" />
                <span>Studio CAD HDR Intensity</span>
              </div>

              <input
                type="range"
                min={30}
                max={200}
                step={5}
                value={cadIntensityPct}
                onChange={(e) => onCadLightIntensityChange(Number(e.target.value) / 100)}
                aria-label="Studio CAD HDR lighting intensity"
                className="voyager-slider w-full max-w-[220px]"
              />

              <span className="font-mono tabular-nums text-xs font-medium text-neutral-900 w-10 text-right shrink-0">
                {cadIntensityPct}%
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {[
                { label: 'Low-Key', value: 0.6 },
                { label: 'Balanced', value: 1.0 },
                { label: 'High-Key', value: 1.5 },
              ].map((preset) => {
                const isSelected = Math.abs(cadLightIntensity - preset.value) < 0.03;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onCadLightIntensityChange(preset.value)}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-900 text-white border border-neutral-900'
                        : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/70 border border-transparent'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Collapsible Live Mechanical Kinematics & Scan Platform Gimbal Sub-Bar */}
        {kinematicsOpen && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 border-b border-neutral-300/80">
            {/* Live Mechanical Ops (LECP 8-Sector Stepper, Bay 7 DTR Reels, Auto RCS) */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onToggleLiveMotion}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  liveMotion
                    ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                    : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950'
                }`}
                title="Play or pause mechanical kinematics (M)"
              >
                {liveMotion ? (
                  <Pause className="w-3 h-3 text-neutral-200" />
                ) : (
                  <Play className="w-3 h-3 text-neutral-600" />
                )}
                <span>Live Ops</span>
              </button>

              <div
                className="flex items-center gap-0.5 p-0.5 bg-[#E5E7EB] border border-neutral-300 rounded-lg"
                role="group"
                aria-label="Scan platform pointing mode"
              >
                <button
                  type="button"
                  onClick={() => onScanAutoSweepChange(true)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    scanAutoSweep
                      ? 'bg-white text-neutral-950 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-950'
                  }`}
                >
                  Auto Sweep
                </button>
                <button
                  type="button"
                  onClick={() => onScanAutoSweepChange(false)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    !scanAutoSweep
                      ? 'bg-white text-neutral-950 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-950'
                  }`}
                >
                  Manual Aim
                </button>
              </div>
            </div>

            {/* 2-Axis Scan Platform Azimuth & Elevation Gimbal Sliders */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-medium text-neutral-600 whitespace-nowrap">
                  Scan Az
                </span>
                <input
                  type="range"
                  min={-65}
                  max={65}
                  step={1}
                  value={Math.round(scanAzimuthDeg)}
                  onChange={(e) => {
                    if (scanAutoSweep) onScanAutoSweepChange(false);
                    onScanAzimuthChange(Number(e.target.value));
                  }}
                  aria-label="Scan platform azimuth angle"
                  className="voyager-slider w-[96px] shrink-0"
                />
                <span className="font-mono tabular-nums text-[11px] font-medium text-neutral-800 w-9 text-right shrink-0">
                  {scanAutoSweep ? 'AUTO' : `${Math.round(scanAzimuthDeg)}°`}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-medium text-neutral-600 whitespace-nowrap">
                  Scan El
                </span>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={1}
                  value={Math.round(scanElevationDeg)}
                  onChange={(e) => {
                    if (scanAutoSweep) onScanAutoSweepChange(false);
                    onScanElevationChange(Number(e.target.value));
                  }}
                  aria-label="Scan platform elevation angle"
                  className="voyager-slider w-[96px] shrink-0"
                />
                <span className="font-mono tabular-nums text-[11px] font-medium text-neutral-800 w-9 text-right shrink-0">
                  {scanAutoSweep ? 'AUTO' : `${Math.round(scanElevationDeg)}°`}
                </span>
              </div>
            </div>

            {/* Manual MR-103 Hydrazine Attitude Thruster Pulse */}
            <button
              type="button"
              onClick={onFireRcsPulse}
              disabled={thermalMode}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                thermalMode
                  ? 'text-neutral-400 bg-neutral-200/70 border-neutral-200 cursor-not-allowed'
                  : 'text-neutral-900 bg-white hover:bg-neutral-100 border-neutral-300 cursor-pointer'
              }`}
              title="Fire MR-103 catalytic hydrazine attitude-control thruster pulse"
            >
              <Zap className="w-3 h-3 text-neutral-700" />
              <span>Fire RCS</span>
            </button>
          </div>
        )}

        {/* Row 2: Camera Focus Presets + Scientific FOV/Beams & Kinematics Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-neutral-500 mr-1 whitespace-nowrap shrink-0">
              Camera Focus
            </span>
            {CAMERA_PRESETS.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectCameraPreset(preset.id)}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-neutral-900 text-white border border-neutral-900'
                      : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-200/75 border border-transparent'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <button
              type="button"
              onClick={onToggleFovCones}
              disabled={thermalMode}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                thermalMode
                  ? 'text-neutral-400 bg-neutral-200/70 border-neutral-200 cursor-not-allowed'
                  : showFovCones
                    ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800 cursor-pointer'
                    : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950 cursor-pointer'
              }`}
              title="Toggle instrument optical FOV frustums & HGA X-band RF beam (B)"
              aria-pressed={showFovCones && !thermalMode}
            >
              <Radar
                className={`w-3.5 h-3.5 ${
                  showFovCones && !thermalMode ? 'text-white' : 'text-neutral-600'
                }`}
              />
              <span>FOV / Beams</span>
            </button>

            <button
              type="button"
              onClick={onToggleKinematicsOpen}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                kinematicsOpen
                  ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800'
                  : 'bg-white text-neutral-800 border-neutral-300 hover:bg-neutral-100 hover:text-neutral-950'
              }`}
              title="Toggle mechanical kinematics & scan platform gimbal controls (K)"
              aria-expanded={kinematicsOpen}
            >
              <SlidersHorizontal
                className={`w-3.5 h-3.5 ${kinematicsOpen ? 'text-white' : 'text-neutral-600'}`}
              />
              <span>Kinematics</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
