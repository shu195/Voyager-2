import { useState } from 'react';
import {
  Crosshair,
  Link2,
  Unlink2,
  X,
  Cable,
  ArrowRight,
} from 'lucide-react';
import {
  OperationalStatus,
  SUBSYSTEM_BY_ID,
  VOYAGER_SUBSYSTEMS,
  WIRING_BUS_META,
  WiringBusType,
  WiringFilter,
} from '../data/voyagerCatalog';

interface TechnicalDossierProps {
  isOpen: boolean;
  selectedPartId: string | null;
  globalExplode: number;
  detachedIds: Set<string>;
  wiringFilter: WiringFilter;
  onClose: () => void;
  onSelectPart: (partId: string) => void;
  onToggleDetachPart: (partId: string) => void;
  onFocusPart: (partId: string) => void;
  onWiringFilterChange: (filter: WiringFilter) => void;
}

type DirectoryFilter = 'all' | 'science' | 'structure';

function StatusIndicator({ status }: { status: OperationalStatus }) {
  if (status === 'Active') {
    return (
      <span className="font-mono text-xs text-emerald-400">
        ● Active
      </span>
    );
  }
  if (status === 'Powered Down') {
    return (
      <span className="font-mono text-xs text-amber-400">
        ○ Powered Down
      </span>
    );
  }
  return (
    <span className="font-mono text-xs text-slate-400">
      ▪ Structural
    </span>
  );
}

export function TechnicalDossier({
  isOpen,
  selectedPartId,
  globalExplode,
  detachedIds,
  wiringFilter,
  onClose,
  onSelectPart,
  onToggleDetachPart,
  onFocusPart,
  onWiringFilterChange,
}: TechnicalDossierProps) {
  const [activeTab, setActiveTab] = useState<'inspect' | 'directory'>('inspect');
  const [dirFilter, setDirFilter] = useState<DirectoryFilter>('all');

  if (!isOpen) return null;

  const selectedSpec = selectedPartId
    ? SUBSYSTEM_BY_ID[selectedPartId]
    : VOYAGER_SUBSYSTEMS[0];

  const isSelectedDetached =
    detachedIds.has(selectedSpec.id) || globalExplode > 0.5;

  const filteredList = VOYAGER_SUBSYSTEMS.filter((item) => {
    if (dirFilter === 'science') return item.isScienceInstrument;
    if (dirFilter === 'structure') return !item.isScienceInstrument;
    return true;
  });

  const handleBusClick = (bus: WiringBusType) => {
    onWiringFilterChange(wiringFilter === bus ? 'all' : bus);
  };

  return (
    <aside
      aria-label="Voyager 2 Technical Dossier"
      className="fixed top-4 right-4 bottom-24 sm:bottom-28 z-30 w-[372px] max-w-[calc(100vw-32px)] flex flex-col bg-[#0B101B]/96 border border-[#223047] rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A2538]">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Technical Dossier
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            NASA/JPL Flight Configuration · 10 Instruments
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-[#162033] rounded-md transition-colors cursor-pointer"
          aria-label="Close technical dossier"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 p-2 border-b border-[#1A2538] bg-[#080C15]">
        <button
          type="button"
          onClick={() => setActiveTab('inspect')}
          className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'inspect'
              ? 'bg-[#182438] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Selected Assembly
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('directory')}
          className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-[#182438] text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All Subsystems (16)
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto dossier-scroll p-4">
        {activeTab === 'inspect' ? (
          <div className="space-y-5">
            {/* Title & Unboxed Metadata */}
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span className="font-mono text-cyan-400 font-medium">
                  {selectedSpec.code}
                </span>
                <StatusIndicator status={selectedSpec.missionStatus} />
              </div>

              <h3 className="text-base font-semibold text-slate-100 mt-1.5 leading-snug">
                {selectedSpec.name}
              </h3>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 mt-1">
                <span>{selectedSpec.category}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {selectedSpec.isScienceInstrument
                    ? 'Science Payload'
                    : 'Spacecraft Bus'}
                </span>
              </div>
            </div>

            {/* Direct Detach / Attach & Camera Focus Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleDetachPart(selectedSpec.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  detachedIds.has(selectedSpec.id)
                    ? 'bg-cyan-600/20 text-cyan-200 border-cyan-500/50 hover:bg-cyan-600/30'
                    : 'bg-[#141E30] text-slate-100 border-[#283854] hover:bg-[#1B2840]'
                }`}
              >
                {detachedIds.has(selectedSpec.id) ? (
                  <>
                    <Link2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Reattach Part</span>
                  </>
                ) : (
                  <>
                    <Unlink2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Detach Part</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onFocusPart(selectedSpec.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#141E30] hover:bg-[#1B2840] border border-[#283854] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                <span>Focus</span>
              </button>
            </div>

            {/* Technical Metrics Table */}
            <div className="grid grid-cols-2 gap-3 py-3 border-y border-[#1A2538]">
              <div>
                <div className="text-[11px] text-slate-400">Mass</div>
                <div className="font-mono tabular-nums text-xs font-medium text-slate-100 mt-0.5">
                  {selectedSpec.massKg}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Power Budget</div>
                <div className="font-mono tabular-nums text-xs font-medium text-slate-100 mt-0.5">
                  {selectedSpec.powerWatts}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-slate-400">
                  Measurement / Operating Band
                </div>
                <div className="font-mono tabular-nums text-xs font-medium text-slate-100 mt-0.5">
                  {selectedSpec.measurementRange}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-slate-400">Mount Location</div>
                <div className="text-xs text-slate-200 mt-0.5">
                  {selectedSpec.mountLocation}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-slate-400">Flight Status</div>
                <div className="text-xs text-slate-200 mt-0.5">
                  {selectedSpec.statusDetail}
                </div>
              </div>
            </div>

            {/* Scientific & Engineering Overview */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-200">
                Engineering Overview
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                {selectedSpec.description}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                {selectedSpec.engineeringNotes}
              </p>
            </div>

            {/* Internal Wiring Harness Connections */}
            <div className="pt-3 border-t border-[#1A2538] space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Cable className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Internal Wiring Harnesses</span>
                </h4>
                <span className="text-[11px] text-slate-500">
                  {isSelectedDetached ? 'Exposed' : 'Click bus to isolate'}
                </span>
              </div>

              {selectedSpec.wiredBuses.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Passive mechanical assembly with no active electrical or RF harness connections.
                </p>
              ) : (
                <div className="space-y-2">
                  {selectedSpec.wiredBuses.map((conn, idx) => {
                    const meta = WIRING_BUS_META[conn.bus];
                    const isHighlighted = wiringFilter === conn.bus;
                    return (
                      <button
                        key={`${conn.portLabel}-${idx}`}
                        type="button"
                        onClick={() => handleBusClick(conn.bus)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors cursor-pointer ${
                          isHighlighted
                            ? 'bg-[#152236] border-cyan-500/40'
                            : 'bg-[#0E1524] border-[#1D2A40] hover:border-[#2E4160]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                            <span
                              className="w-2 h-2 rounded-xs shrink-0"
                              style={{ backgroundColor: meta.colorHex }}
                              aria-hidden="true"
                            />
                            <span>{meta.label}</span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {conn.portLabel}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {conn.routeSummary}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* All 16 Subsystems & 10 Instruments Directory */
          <div className="space-y-3">
            {/* Directory Filter */}
            <div className="flex items-center gap-1 p-0.5 bg-[#070B13] border border-[#1E2A40] rounded-lg">
              {(
                [
                  { id: 'all', label: 'All (16)' },
                  { id: 'science', label: 'Science (10)' },
                  { id: 'structure', label: 'Bus & Power (6)' },
                ] as Array<{ id: DirectoryFilter; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDirFilter(tab.id)}
                  className={`flex-1 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    dirFilter === tab.id
                      ? 'bg-[#182438] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="divide-y divide-[#182234]">
              {filteredList.map((item) => {
                const isSelected = item.id === selectedPartId;
                const isDetached = detachedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`py-2.5 flex items-center justify-between gap-2 ${
                      isSelected ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectPart(item.id);
                        onFocusPart(item.id);
                        setActiveTab('inspect');
                      }}
                      className="flex-1 min-w-0 text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-cyan-400 shrink-0">
                          {item.code}
                        </span>
                        <span className="text-xs font-medium truncate group-hover:text-white">
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                        <span className="truncate">{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums shrink-0">
                          {item.massKg.split(' ')[0]} kg
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleDetachPart(item.id)}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                          isDetached
                            ? 'bg-cyan-600/20 text-cyan-200 border-cyan-500/40'
                            : 'bg-[#121B2B] text-slate-300 border-[#24324B] hover:text-white'
                        }`}
                      >
                        {isDetached ? 'Attach' : 'Detach'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPart(item.id);
                          onFocusPart(item.id);
                          setActiveTab('inspect');
                        }}
                        className="p-1 text-slate-400 hover:text-white cursor-pointer"
                        aria-label={`Inspect ${item.name}`}
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
