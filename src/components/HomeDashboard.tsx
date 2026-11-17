import React, { useEffect, useState } from 'react';
import {
  GameMode,
  Specialty,
  SavedCaseRecord,
  TurnoMedicoConfig,
  TurnoProfile,
  TurnoTimerMode,
} from '../types/clinical';
import { ALL_CURATED_CASES } from '../data/allCases';
import {
  Stethoscope,
  Sparkles,
  GraduationCap,
  Shield,
  Flame,
  Check,
  History,
  BookOpen,
  Award,
  FlaskConical,
  MessageSquare,
  ChevronRight,
  Shuffle,
  Zap,
  Users,
  Timer,
  X,
  FolderOpen,
} from 'lucide-react';

interface HomeDashboardProps {
  onStartSimulation: (mode: GameMode, specialty: Specialty, caseId?: string) => Promise<void>;
  onStartTurnoMedico: (config: TurnoMedicoConfig) => void;
  onOpenPresetsModal: () => void;
  onOpenHistoryModal: () => void;
  onOpenGuideModal: () => void;
  isLoading: boolean;
  history: SavedCaseRecord[];
  totalCasesCount?: number;
  initialMode?: GameMode;
  initialSpecialty?: Specialty;
  onPreferencesChange?: (mode: GameMode, specialty: Specialty) => void;
}

type ModalModeKey = GameMode | 'turno_medico';

const MODES: Array<{
  id: GameMode;
  title: string;
  short: string;
  desc: string;
  details: string[];
  icon: any;
  accentClass: string;
}> = [
  {
    id: 'principiante',
    title: 'Modo Principiante',
    short: 'Principiante',
    desc: 'Cuadros clásicos frecuentes y semiología directa.',
    details: [
      'Presentaciones clínicas típicas con menor carga de distractores.',
      'Incluye preguntas rápidas guiadas y exploración completa por sistemas.',
      'Rúbrica académica de 100 pts con énfasis en diagnóstico y manejo seguro.',
    ],
    icon: GraduationCap,
    accentClass: 'text-emerald-300',
  },
  {
    id: 'medico_general',
    title: 'Médico General',
    short: 'Médico General',
    desc: 'Consulta externa y guardia con cuadros clínicos habituales.',
    details: [
      'Balance realista entre casos ambulatorios frecuentes y patología aguda.',
      'Evaluación de anamnesis dirigida, paraclínicos justificados y receta completa.',
      'Ideal para práctica cotidiana de consulta de primer nivel.',
    ],
    icon: Stethoscope,
    accentClass: 'text-sky-300',
  },
  {
    id: 'residente',
    title: 'Modo Residente',
    short: 'Residente',
    desc: 'Comorbilidades múltiples y cuadros clínicos complejos.',
    details: [
      'Pacientes con antecedentes múltiples, interacciones y presentaciones atípicas.',
      'Mayor exigencia en razonamiento diagnóstico y manejo farmacológico.',
      'Incluye aplicación STAT en vivo si el paciente se inestabiliza.',
    ],
    icon: Shield,
    accentClass: 'text-indigo-300',
  },
  {
    id: 'urgencias',
    title: 'Urgencias (Sala de Choque)',
    short: 'Urgencias',
    desc: 'Ventana de oro de 8 min, estabilización STAT y riesgo vital.',
    details: [
      'Reloj crítico de 8 minutos con deterioro fisiológico continuo si no estabilizas.',
      'Módulo STAT en tiempo real (fármacos IV, oxígeno, fluidos y antídotos).',
      'Evalúa conducta de urgencia inmediata y prevención de iatrogenia fatal.',
    ],
    icon: Flame,
    accentClass: 'text-rose-300',
  },
  {
    id: 'examen',
    title: 'Examen Clínico (ECOE)',
    short: 'Modo Examen',
    desc: 'Estación ciega de 12 min sin ayudas ni resaltado visual.',
    details: [
      'Sin preguntas sugeridas ni desbloqueo masivo de maniobras o estudios.',
      'Incluye plantear diagnósticos diferenciales, criterios de referencia y plan de alta.',
      'Envío automático al concluir la estación clínica de 12 minutos.',
    ],
    icon: Check,
    accentClass: 'text-cyan-300',
  },
];

const SPECIALTIES: Array<{ id: Specialty; name: string }> = [
  { id: 'aleatorio', name: 'Aleatorio (Sorpresa)' },
  { id: 'infectologia', name: 'Infectología' },
  { id: 'cardiologia', name: 'Cardiología' },
  { id: 'cirugia_general', name: 'Cirugía General' },
  { id: 'endocrinologia', name: 'Endocrinología' },
  { id: 'neurologia', name: 'Neurología' },
  { id: 'neumologia', name: 'Neumología' },
  { id: 'medicina_interna', name: 'Medicina Interna' },
  { id: 'urgencias', name: 'Urgencias' },
  { id: 'pediatria', name: 'Pediatría' },
  { id: 'gastroenterologia', name: 'Gastroenterología' },
  { id: 'nefrologia', name: 'Nefrología' },
  { id: 'ginecologia', name: 'Ginecología' },
  { id: 'traumatologia', name: 'Traumatología' },
  { id: 'dermatologia', name: 'Dermatología' },
  { id: 'psiquiatria', name: 'Psiquiatría' },
  { id: 'oftalmologia', name: 'Oftalmología' },
  { id: 'otorrinolaringologia', name: 'Otorrinolaringología' },
  { id: 'urologia', name: 'Urología' },
  { id: 'hematologia', name: 'Hematología' },
  { id: 'reumatologia', name: 'Reumatología' },
  { id: 'toxicologia', name: 'Toxicología Clínica' },
];

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  onStartSimulation,
  onStartTurnoMedico,
  onOpenPresetsModal,
  onOpenHistoryModal,
  onOpenGuideModal,
  isLoading,
  history,
  totalCasesCount,
  initialMode = 'medico_general',
  initialSpecialty = 'aleatorio',
  onPreferencesChange,
}) => {
  const [activeModalMode, setActiveModalMode] = useState<ModalModeKey | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameMode>(initialMode);
  const [selectedSpecialty, setSelectedSpecialty] = useState<Specialty>(initialSpecialty);

  const [turnoCount, setTurnoCount] = useState<3 | 5 | 7>(5);
  const [turnoProfile, setTurnoProfile] = useState<TurnoProfile>('mixto');
  const [turnoTimer, setTurnoTimer] = useState<TurnoTimerMode>('untimed');
  const [turnoSpecialty, setTurnoSpecialty] = useState<Specialty>('aleatorio');

  useEffect(() => {
    setSelectedMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setSelectedSpecialty(initialSpecialty);
  }, [initialSpecialty]);

  useEffect(() => {
    if (!activeModalMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModalMode(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeModalMode]);

  const libraryCount = totalCasesCount ?? ALL_CURATED_CASES.length;
  const avgScore =
    history.length > 0
      ? Math.round(history.reduce((acc, cur) => acc + cur.score, 0) / history.length)
      : null;

  const activeConsultMode =
    activeModalMode && activeModalMode !== 'turno_medico'
      ? MODES.find((m) => m.id === activeModalMode) || null
      : null;

  const selectedSpecTitle =
    SPECIALTIES.find((s) => s.id === selectedSpecialty)?.name || selectedSpecialty;

  const handleOpenConsultModeModal = (mode: GameMode) => {
    setSelectedMode(mode);
    onPreferencesChange?.(mode, selectedSpecialty);
    setActiveModalMode(mode);
  };

  return (
    <main className="flex-1 max-w-6xl w-full min-w-0 mx-auto px-3 sm:px-4 py-6 sm:py-9 space-y-6">
      {/* Compact Hero Header */}
      <section className="rounded-2xl border border-blue-800/70 bg-gradient-to-br from-[#0A1D47] via-[#06122E] to-black p-5 sm:p-8 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-blue-300">
              <Stethoscope className="w-4 h-4 text-blue-400 shrink-0" />
              <span>Simulador Clínico Interactivo · {libraryCount} Casos Offline</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Entrena tu Razonamiento Clínico
            </h1>
            <p className="text-xs sm:text-sm text-blue-100/85 leading-relaxed">
              Elige un modo de juego para abrir su configuración completa, reglas clínicas y especialidades, o inicia un caso aleatorio al instante.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2.5 shrink-0 lg:w-80">
            <button
              type="button"
              onClick={() => onStartSimulation('medico_general', 'aleatorio')}
              disabled={isLoading}
              className="col-span-2 px-4 py-3 bg-white hover:bg-blue-100 disabled:opacity-50 text-[#030A1C] font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <Shuffle className="w-4 h-4 text-blue-700 shrink-0" />
              <span>Caso Rápido Aleatorio</span>
            </button>

            <button
              type="button"
              onClick={onOpenPresetsModal}
              className="px-3 py-2.5 bg-[#07132B] hover:bg-[#0D2149] border border-blue-800/70 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">{libraryCount} Casos</span>
            </button>

            <button
              type="button"
              onClick={onOpenHistoryModal}
              className="px-3 py-2.5 bg-[#07132B] hover:bg-[#0D2149] border border-blue-800/70 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">
                Historial ({history.length}){avgScore !== null ? ` · ${avgScore}` : ''}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Modos de Juego (Lightweight Mode Launcher Buttons) */}
      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Modos de Juego
            </h2>
            <p className="text-xs text-blue-200/80">
              Pulsa cualquier modalidad para abrir sus opciones, especialidades y comenzar.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenGuideModal}
            className="px-3 py-1.5 rounded-lg bg-[#07132B] hover:bg-[#0D2149] border border-blue-900/70 text-xs font-medium text-blue-200 hover:text-white flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Guías MINSA / OMS</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* Express Shift Mode Button */}
          <button
            type="button"
            onClick={() => setActiveModalMode('turno_medico')}
            className="group text-left rounded-2xl border border-amber-500/50 hover:border-amber-400 bg-gradient-to-br from-[#0F2147] via-[#07132B] to-[#040B1B] p-5 transition-all cursor-pointer shadow-md flex flex-col justify-between gap-4"
          >
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  Guardia Multi-Paciente
                </span>
              </div>

              <div>
                <h3 className="text-base font-extrabold text-white group-hover:text-amber-200 transition-colors">
                  Modo Turno Médico
                </h3>
                <p className="text-xs text-blue-100/80 mt-1 leading-relaxed">
                  Cola express de 3, 5 o 7 pacientes en una sola pantalla con diagnóstico rápido y estabilización STAT opcional.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-blue-900/60 flex items-center justify-between text-xs font-bold text-amber-300">
              <span>Configurar turno</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* 5 Individual Consultation Mode Buttons */}
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => handleOpenConsultModeModal(mode.id)}
                className="group text-left rounded-2xl border border-blue-900/75 hover:border-blue-400 bg-[#07132B] hover:bg-[#0A1A3A] p-5 transition-all cursor-pointer shadow-md flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="w-10 h-10 rounded-xl bg-[#040B1B] border border-blue-800/80 flex items-center justify-center shrink-0">
                      <Icon className={`w-5 h-5 ${mode.accentClass}`} />
                    </div>
                    <span className="text-[11px] font-semibold text-blue-300/80">
                      Consulta Individual
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-sky-200 transition-colors">
                      {mode.title}
                    </h3>
                    <p className="text-xs text-blue-200/80 mt-1 leading-relaxed">
                      {mode.desc}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-blue-900/60 flex items-center justify-between text-xs font-semibold text-sky-300">
                  <span>Abrir modo</span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Quiet Offline Disclaimer Footer */}
      <footer className="rounded-xl border border-blue-900/50 bg-[#040B1B]/80 px-4 py-3 text-[11px] text-blue-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span>
          <strong className="text-sky-300">Motor Clínico 100 % Offline:</strong> Funciona sin internet y guarda tu progreso localmente.
        </span>
        <span className="text-blue-300/75">
          Uso exclusivamente educativo; no sustituye el juicio clínico ni los protocolos vigentes.
        </span>
      </footer>

      {/* Modal: Turno Médico Completo */}
      {activeModalMode === 'turno_medico' && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4"
          onClick={() => setActiveModalMode(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Configurar Modo Turno Médico"
        >
          <div
            className="w-full max-w-3xl max-h-[92dvh] flex flex-col bg-[#07132B] border border-amber-500/60 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-[#040B1B] border-b border-blue-900/70 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-white truncate">
                    Modo Turno Médico · Guardia Express
                  </h3>
                  <p className="text-xs text-blue-200/80 truncate">
                    Atención rápida multi-paciente enfocada en triage, evaluación y diagnóstico
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalMode(null)}
                className="w-8 h-8 rounded-lg bg-[#0D2149] hover:bg-blue-700 text-blue-100 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="bg-[#040B1B] border border-blue-900/60 rounded-xl p-4 space-y-1.5 text-blue-100/90 leading-relaxed">
                <div className="font-bold text-amber-300 uppercase tracking-wider text-[11px]">
                  Cómo funciona este modo
                </div>
                <p>
                  Atiende varios pacientes en una sola pantalla rápida: interrogatorio de 1 clic, examen físico inmediato, paraclínicos, estabilización STAT opcional y diagnóstico principal directo — sin llenar diferenciales, recetas ambulatorias ni criterios de alta. Al finalizar revisas el balance clínico y clase magistral de cada cama.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Pacientes en sala */}
                <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-3.5 space-y-2.5">
                  <div className="font-bold text-blue-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pacientes en Sala</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {([3, 5, 7] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setTurnoCount(cnt)}
                        className={`py-2 rounded-lg border font-bold cursor-pointer transition-colors ${
                          turnoCount === cnt
                            ? 'bg-amber-500 text-[#030A1C] border-amber-400'
                            : 'bg-[#07132B] border-blue-900 text-blue-100 hover:border-blue-600'
                        }`}
                      >
                        {cnt} pac.
                      </button>
                    ))}
                  </div>
                </div>

                {/* Perfil de guardia */}
                <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-3.5 space-y-2.5">
                  <div className="font-bold text-blue-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Perfil del Turno</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'mixto', label: 'Mixto' },
                        { id: 'consulta_rapida', label: 'Consulta' },
                        { id: 'urgencias', label: 'Urgencias' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setTurnoProfile(p.id)}
                        className={`py-2 px-1 rounded-lg border font-bold cursor-pointer transition-colors ${
                          turnoProfile === p.id
                            ? 'bg-blue-600 text-white border-blue-400'
                            : 'bg-[#07132B] border-blue-900 text-blue-100 hover:border-blue-600'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reloj */}
                <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-3.5 space-y-2.5">
                  <div className="font-bold text-blue-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-amber-400" />
                    <span>Modalidad de Reloj</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'untimed', label: 'Libre' },
                        { id: 'per_patient_180', label: '3m/pac' },
                        { id: 'global_720', label: '12m total' },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTurnoTimer(t.id)}
                        className={`py-2 px-1 rounded-lg border font-bold cursor-pointer transition-colors ${
                          turnoTimer === t.id
                            ? 'bg-blue-600 text-white border-blue-400'
                            : 'bg-[#07132B] border-blue-900 text-blue-100 hover:border-blue-600'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Especialidad */}
                <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-3.5 space-y-2.5">
                  <label className="font-bold text-blue-300 uppercase tracking-wider text-[11px] block">
                    Área / Especialidad
                  </label>
                  <select
                    value={turnoSpecialty}
                    onChange={(e) => setTurnoSpecialty(e.target.value as Specialty)}
                    className="w-full bg-[#07132B] border border-blue-800/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                  >
                    {SPECIALTIES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 bg-[#040B1B] border-t border-blue-900/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <span className="text-xs text-blue-200/80">
                <strong className="text-white">{turnoCount} camas</strong> ·{' '}
                {turnoProfile === 'mixto'
                  ? 'Guardia Mixta'
                  : turnoProfile === 'consulta_rapida'
                  ? 'Consulta Rápida'
                  : 'Urgencias'}{' '}
                · {SPECIALTIES.find((s) => s.id === turnoSpecialty)?.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveModalMode(null);
                  onStartTurnoMedico({
                    patientCount: turnoCount,
                    profile: turnoProfile,
                    timerMode: turnoTimer,
                    specialty: turnoSpecialty,
                  });
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#030A1C] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-colors"
              >
                <Zap className="w-4 h-4 shrink-0" />
                <span>Iniciar Turno ({turnoCount} Pacientes)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Modo de Consulta Individual Completo */}
      {activeConsultMode && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4"
          onClick={() => setActiveModalMode(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Configurar ${activeConsultMode.title}`}
        >
          <div
            className="w-full max-w-4xl max-h-[92dvh] flex flex-col bg-[#07132B] border border-blue-700/80 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-[#040B1B] border-b border-blue-900/70 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#0D2149] border border-blue-700/70 flex items-center justify-center shrink-0">
                  <activeConsultMode.icon className={`w-5 h-5 ${activeConsultMode.accentClass}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-white truncate">
                    {activeConsultMode.title}
                  </h3>
                  <p className="text-xs text-blue-200/80 truncate">{activeConsultMode.desc}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalMode(null)}
                className="w-8 h-8 rounded-lg bg-[#0D2149] hover:bg-blue-700 text-blue-100 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* Reglas y Flujo del Modo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="bg-[#040B1B] border border-blue-900/60 rounded-xl p-4 space-y-2">
                  <div className="font-bold text-sky-300 uppercase tracking-wider text-[11px]">
                    Características del Modo
                  </div>
                  <ul className="space-y-1.5 text-blue-100/90 leading-relaxed">
                    {activeConsultMode.details.map((line, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-sky-400 font-bold">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-[#040B1B] border border-blue-900/60 rounded-xl p-4 space-y-2">
                  <div className="font-bold text-blue-300 uppercase tracking-wider text-[11px]">
                    Flujo de la Consulta
                  </div>
                  <div className="space-y-1.5 text-blue-100/85">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>1. Anamnesis libre y exploración física por sistemas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FlaskConical className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>2. Laboratorio, gabinete e imagen sin pistas del diagnóstico</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Award className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>3. Diagnóstico, plan STAT/ambulatorio y auditoría de 100 pts</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Selector de Especialidad */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-blue-300">
                    Selecciona Área o Especialidad Médica
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModalMode(null);
                      onOpenPresetsModal();
                    }}
                    className="text-xs font-semibold text-sky-300 hover:text-white cursor-pointer"
                  >
                    Ver los {libraryCount} casos de la biblioteca →
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {SPECIALTIES.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => {
                        setSelectedSpecialty(spec.id);
                        onPreferencesChange?.(selectedMode, spec.id);
                      }}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-all cursor-pointer truncate ${
                        selectedSpecialty === spec.id
                          ? 'bg-white text-[#030A1C] font-bold border-white shadow-sm'
                          : 'bg-[#040B1B] border-blue-900/70 text-blue-100 hover:border-blue-600'
                      }`}
                    >
                      {spec.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 bg-[#040B1B] border-t border-blue-900/70 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-blue-200/90 text-center sm:text-left">
                <span className="text-blue-300 font-semibold">Selección:</span>{' '}
                <span className="text-white font-semibold">{activeConsultMode.short}</span> ·{' '}
                <span className="text-sky-300 font-semibold">{selectedSpecTitle}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveModalMode(null);
                  void onStartSimulation(selectedMode, selectedSpecialty);
                }}
                disabled={isLoading}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
              >
                <Sparkles className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Preparando Paciente...' : 'Entrar a Consulta Médica'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
