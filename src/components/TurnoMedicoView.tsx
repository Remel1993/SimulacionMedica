import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ClinicalCase,
  ClinicalEvolutionState,
  ChatMessage,
  MedicationItem,
  StatInterventionRecord,
  TurnoMedicoConfig,
  TurnoPatientResult,
  UserEvaluationInput,
  VitalSigns,
} from '../types/clinical';
import { applyStatIntervention, STAT_QUICK_PRESETS, StatPreset } from '../utils/statStabilization';
import { generateContextualPatientReply } from '../engine/patientEngine';
import { evaluateClinicalEvolutionStep } from '../engine/clinicalEvolution';
import { buildLivePhysicalExams, buildLiveStudies } from '../engine/liveClinicalSync';
import { evaluateClinicalCaseLocally, evaluateClinicalOutcomeLocally } from '../engine/evaluationEngine';
import { deriveDisclosedBackground } from '../utils/backgroundDisclosure';
import { StudyTracingViewer, detectTracingKind } from './StudyTracingViewer';
import { ClinicalAuditTab } from './ClinicalAuditTab';
import { PatientVisualCard } from './PatientVisualCard';
import {
  Zap,
  Users,
  Timer,
  LogOut,
  HeartPulse,
  Thermometer,
  Wind,
  Activity,
  Brain,
  MessageSquare,
  Stethoscope,
  FlaskConical,
  Send,
  Search,
  CheckCircle2,
  AlertTriangle,
  Skull,
  HeartHandshake,
  Award,
  BookOpen,
  ArrowRight,
  RotateCcw,
  Home,
  X,
  Syringe,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

interface TurnoMedicoViewProps {
  config: TurnoMedicoConfig;
  cases: ClinicalCase[];
  onExitTurno: () => void;
  onStartNewTurno: (config: TurnoMedicoConfig) => void;
  onPatientResolved: (result: TurnoPatientResult) => void;
}

interface PatientDraftState {
  caseId: string;
  messages: ChatMessage[];
  liveVitalSigns: VitalSigns;
  statInterventions: StatInterventionRecord[];
  evolutionState?: ClinicalEvolutionState;
  unlockedExamIds: string[];
  unlockedStudyIds: string[];
  primaryDiagnosis: string;
  medications: MedicationItem[];
  elapsedSeconds: number;
  lastEvolutionSecond: number;
  result?: TurnoPatientResult;
  immediateDeathAlert?: {
    drug: string;
    dose: string;
    route: string;
    reason: string;
  } | null;
}

const QUICK_INTERROGATION_PROMPTS = [
  {
    id: 'q-inicio',
    label: 'Inicio, evolución y dolor',
    prompt: '¿Cuándo y cómo comenzaron sus síntomas principales, cómo han evolucionado y qué los mejora o empeora?',
  },
  {
    id: 'q-asociados',
    label: 'Síntomas asociados y alarma',
    prompt: '¿Ha tenido fiebre, dificultad para respirar, mareos, vómitos, sangrado u otros síntomas acompañantes?',
  },
  {
    id: 'q-antecedentes',
    label: 'Enfermedades y cirugías',
    prompt: '¿Padece alguna enfermedad crónica, ha estado hospitalizado antes o le han hecho cirugías previas?',
  },
  {
    id: 'q-meds-alergias',
    label: 'Alergias y medicación actual',
    prompt: '¿Es alérgico a algún medicamento y qué medicinas toma habitualmente o ha tomado para sentirse mejor?',
  },
  {
    id: 'q-habitos-fam',
    label: 'Hábitos, familia y exposición',
    prompt: '¿Fuma, toma alcohol, tiene antecedentes importantes en su familia o algún contacto enfermo o viaje reciente?',
  },
];

function createInitialDraft(caseData: ClinicalCase): PatientDraftState {
  const isPediatric = caseData.patientInfo.age < 12;
  const greetingText = isPediatric
    ? `Doctor, traje rápido a ${caseData.patientInfo.name.replace(/\s*\([^)]*\)/, '')}. Motivo: ${caseData.patientInfo.consultReason}`
    : `Doctor, vengo por ${caseData.patientInfo.consultReason.toLowerCase()}. Empecé hace ${caseData.patientInfo.evolutionTime.toLowerCase()}.`;

  const initialEvo = evaluateClinicalEvolutionStep({
    caseData,
    baselineVitals: caseData.vitalSigns,
    currentVitals: caseData.vitalSigns,
    elapsedSeconds: 0,
    statInterventions: [],
    unlockedExamCount: 0,
    unlockedStudyCount: 0,
    lastEvaluatedSecond: 0,
  });

  return {
    caseId: caseData.id,
    messages: [
      {
        id: `turno-init-${caseData.id}`,
        sender: 'patient',
        text: greetingText,
        timestamp: 'Ingreso',
      },
    ],
    liveVitalSigns: caseData.vitalSigns,
    statInterventions: [],
    evolutionState: initialEvo.evolutionState,
    unlockedExamIds: [],
    unlockedStudyIds: [],
    primaryDiagnosis: '',
    medications: [],
    elapsedSeconds: 0,
    lastEvolutionSecond: 0,
  };
}

function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getTriageShortBadge(triage: string): { label: string; className: string } {
  if (triage.includes('Nivel I')) {
    return { label: 'N-I Crítico', className: 'bg-rose-950/90 border-rose-500 text-rose-200' };
  }
  if (triage.includes('Nivel II')) {
    return { label: 'N-II Emergencia', className: 'bg-amber-950/80 border-amber-500 text-amber-200' };
  }
  if (triage.includes('Nivel III')) {
    return { label: 'N-III Urgencia', className: 'bg-sky-950/80 border-sky-500/80 text-sky-200' };
  }
  return { label: 'N-IV/V Consulta', className: 'bg-emerald-950/70 border-emerald-600/70 text-emerald-200' };
}

export const TurnoMedicoView: React.FC<TurnoMedicoViewProps> = ({
  config,
  cases,
  onExitTurno,
  onStartNewTurno,
  onPatientResolved,
}) => {
  const [drafts, setDrafts] = useState<Record<string, PatientDraftState>>(() => {
    const map: Record<string, PatientDraftState> = {};
    for (const c of cases) {
      map[c.id] = createInitialDraft(c);
    }
    return map;
  });

  const [activeCaseIndex, setActiveCaseIndex] = useState<number>(0);
  const [flashResultCaseId, setFlashResultCaseId] = useState<string | null>(null);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState<boolean>(false);
  const [auditModalCaseId, setAuditModalCaseId] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState<boolean>(false);

  // Timers
  const [shiftElapsedSeconds, setShiftElapsedSeconds] = useState<number>(0);
  const shiftAutoEndedRef = useRef<boolean>(false);

  // Custom Question & Filter States (cleared on patient change)
  const [customQuestion, setCustomQuestion] = useState('');
  const [examSystemFilter, setExamSystemFilter] = useState<string>('Todos');
  const [studyCategoryFilter, setStudyCategoryFilter] = useState<'Todos' | 'Laboratorio' | 'Imagen' | 'Gabinete y Trazados'>('Todos');
  const [studySearch, setStudySearch] = useState('');
  const [statCategoryFilter, setStatCategoryFilter] = useState<string>('Todos');
  const [customStatDrug, setCustomStatDrug] = useState('');
  const [customStatDose, setCustomStatDose] = useState('');
  const [customStatRoute] = useState('Intravenosa (IV)');

  const activeCase = cases[activeCaseIndex] || cases[0];
  const activeDraft = activeCase ? drafts[activeCase.id] : undefined;

  // Reset per-patient ephemeral UI inputs when changing patient
  useEffect(() => {
    setCustomQuestion('');
    setExamSystemFilter('Todos');
    setStudyCategoryFilter('Todos');
    setStudySearch('');
    setCustomStatDrug('');
    setCustomStatDose('');
  }, [activeCase?.id]);

  // Resolved list
  const resolvedResults = useMemo(() => {
    return cases
      .map((c) => drafts[c.id]?.result)
      .filter((r): r is TurnoPatientResult => Boolean(r));
  }, [cases, drafts]);

  const allResolved = cases.length > 0 && resolvedResults.length === cases.length;

  // Update helper
  const updateDraft = (caseId: string, updater: (prev: PatientDraftState) => PatientDraftState) => {
    setDrafts((prev) => {
      const current = prev[caseId];
      if (!current) return prev;
      return { ...prev, [caseId]: updater(current) };
    });
  };

  // Finalize patient evaluation cleanly (Diagnosis-only Express Mode)
  const resolvePatient = (caseItem: ClinicalCase, draftSnapshot: PatientDraftState) => {
    if (draftSnapshot.result) return;

    const doctorQuestions = draftSnapshot.messages.filter((m) => m.sender === 'doctor').map((m) => m.text);

    const submission: UserEvaluationInput = {
      primaryDiagnosis: draftSnapshot.primaryDiagnosis,
      differentialDiagnoses: [],
      clinicalJustification: '',
      additionalStudiesNeeded: '',
      pharmacologicalPlan: draftSnapshot.medications,
      generalMeasures: '',
      hospitalizationDecision: '',
      referralCriteria: '',
      followUpPlan: '',
      unlockedExams: draftSnapshot.unlockedExamIds,
      unlockedStudies: draftSnapshot.unlockedStudyIds,
      questionCount: doctorQuestions.length,
      doctorQuestions,
      timeSpentSeconds: draftSnapshot.elapsedSeconds,
      statInterventions: draftSnapshot.statInterventions,
      baselineVitalSigns: caseItem.vitalSigns,
      finalVitalSigns: draftSnapshot.liveVitalSigns,
      expressDiagnosticOnly: true,
    };

    const evaluation = evaluateClinicalCaseLocally(submission, caseItem);
    const outcome = evaluateClinicalOutcomeLocally(evaluation, caseItem);

    const turnoResult: TurnoPatientResult = {
      caseData: caseItem,
      evaluation,
      outcomeStatus: outcome.status,
      outcomeHeadline: outcome.headline,
      timeSpentSeconds: draftSnapshot.elapsedSeconds,
      diagCorrect: evaluation.breakdown.primaryDiagnosis >= 17,
    };

    updateDraft(caseItem.id, (prev) => ({
      ...prev,
      immediateDeathAlert: null,
      result: turnoResult,
    }));

    onPatientResolved(turnoResult);
    setFlashResultCaseId(caseItem.id);
  };

  // Ref to latest resolve function for timer auto-submit
  const latestResolveRef = useRef<(c: ClinicalCase, d: PatientDraftState) => void>(() => {});
  latestResolveRef.current = (c, d) => resolvePatient(c, d);

  const latestAutoEndShiftRef = useRef<() => void>(() => {});
  latestAutoEndShiftRef.current = () => {
    for (const c of cases) {
      const d = drafts[c.id];
      if (d && !d.result) {
        resolvePatient(c, d);
      }
    }
    setFlashResultCaseId(null);
    setShiftSummaryOpen(true);
  };

  // Shift & Active Patient Timer
  useEffect(() => {
    if (shiftSummaryOpen || allResolved || !activeCase || !activeDraft) return;
    const isFlashViewing = Boolean(flashResultCaseId);
    if (isFlashViewing) return;

    const timer = window.setInterval(() => {
      setShiftElapsedSeconds((prev) => prev + 1);
      if (!activeDraft.result) {
        updateDraft(activeCase.id, (prev) => ({
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 1,
        }));
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [shiftSummaryOpen, allResolved, flashResultCaseId, activeCase?.id, activeDraft?.result]);

  // Clinical evolution every 30s in active patient
  useEffect(() => {
    if (!activeCase || !activeDraft || activeDraft.result || shiftSummaryOpen || flashResultCaseId) return;
    if (activeDraft.elapsedSeconds - activeDraft.lastEvolutionSecond < 30) return;

    const step = evaluateClinicalEvolutionStep({
      caseData: activeCase,
      baselineVitals: activeCase.vitalSigns,
      currentVitals: activeDraft.liveVitalSigns,
      elapsedSeconds: activeDraft.elapsedSeconds,
      statInterventions: activeDraft.statInterventions,
      unlockedExamCount: activeDraft.unlockedExamIds.length,
      unlockedStudyCount: activeDraft.unlockedStudyIds.length,
      lastEvaluatedSecond: activeDraft.lastEvolutionSecond,
    });

    updateDraft(activeCase.id, (prev) => ({
      ...prev,
      lastEvolutionSecond: step.evolutionState.lastEvaluatedSecond,
      evolutionState: step.evolutionState,
      liveVitalSigns: step.changed ? step.updatedVitals : prev.liveVitalSigns,
    }));
  }, [activeDraft?.elapsedSeconds, activeCase?.id]);

  // Auto-submit on per_patient_180 or global_720 expiration
  useEffect(() => {
    if (shiftSummaryOpen || allResolved) return;
    if (config.timerMode === 'per_patient_180' && activeCase && activeDraft && !activeDraft.result) {
      if (activeDraft.elapsedSeconds >= 180) {
        latestResolveRef.current(activeCase, activeDraft);
      }
    } else if (config.timerMode === 'global_720' && !shiftAutoEndedRef.current) {
      if (shiftElapsedSeconds >= 720) {
        shiftAutoEndedRef.current = true;
        latestAutoEndShiftRef.current();
      }
    }
  }, [activeDraft?.elapsedSeconds, shiftElapsedSeconds, config.timerMode, shiftSummaryOpen, allResolved]);

  const handleAskQuestion = (questionText: string) => {
    if (!activeCase || !activeDraft || activeDraft.result) return;
    const isDeceased =
      activeDraft.statInterventions.some((s) => s.isImmediateDeath) ||
      activeDraft.liveVitalSigns.heartRate === 0;
    if (isDeceased || activeDraft.liveVitalSigns.glasgow <= 9) return;

    const clean = questionText.trim();
    if (!clean) return;

    const docMsg: ChatMessage = {
      id: `t-doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'doctor',
      text: clean,
      timestamp: formatTimer(activeDraft.elapsedSeconds),
    };

    const nextHistory = [...activeDraft.messages, docMsg];
    const replyText = generateContextualPatientReply({
      history: activeDraft.messages,
      userMessage: clean,
      patientPersona: activeCase.internalPersonaPrompt,
      patientInfo: activeCase.patientInfo,
      vitalSigns: activeCase.vitalSigns,
      liveVitalSigns: activeDraft.liveVitalSigns,
      isDeceased,
      appliedStatInterventions: activeDraft.statInterventions.map((s) => ({
        label: s.label,
        drug: s.drug,
        dose: s.dose,
        route: s.route,
        effectSeverity: s.effectSeverity,
        patientFeelingNote: s.patientFeelingNote,
        deltasSummary: s.deltas.map((d) => `${d.metric} ${d.before}->${d.after}`).join(', '),
      })),
      background: activeCase.background,
      clinicalClues: activeCase.solution.keyClinicalClues,
      characteristicSymptoms: activeCase.solution.characteristicSignsSymptoms,
      specialty: activeCase.specialty,
      caseId: activeCase.id,
    });

    const patMsg: ChatMessage = {
      id: `t-pat-${Date.now() + 1}-${Math.random().toString(36).slice(2, 6)}`,
      sender: 'patient',
      text: replyText,
      timestamp: formatTimer(activeDraft.elapsedSeconds),
    };

    updateDraft(activeCase.id, (prev) => ({
      ...prev,
      messages: [...prev.messages, docMsg, patMsg],
    }));
  };

  const handleApplyStat = (presetOrCustom: {
    presetId?: string;
    label: string;
    drug: string;
    dose: string;
    route: string;
    frequency?: string;
    duration?: string;
  }) => {
    if (!activeCase || !activeDraft || activeDraft.result) return;
    const isDeceased =
      activeDraft.statInterventions.some((s) => s.isImmediateDeath) ||
      activeDraft.liveVitalSigns.heartRate === 0;
    if (isDeceased) return;

    const outcome = applyStatIntervention(
      activeDraft.liveVitalSigns,
      activeCase.vitalSigns,
      activeCase,
      presetOrCustom,
      activeDraft.statInterventions,
      activeDraft.elapsedSeconds
    );

    const nextStats = [...activeDraft.statInterventions, outcome.record];
    const evoAfterStat = evaluateClinicalEvolutionStep({
      caseData: activeCase,
      baselineVitals: activeCase.vitalSigns,
      currentVitals: outcome.updatedVitals,
      elapsedSeconds: activeDraft.elapsedSeconds,
      statInterventions: nextStats,
      unlockedExamCount: activeDraft.unlockedExamIds.length,
      unlockedStudyCount: activeDraft.unlockedStudyIds.length,
      lastEvaluatedSecond: activeDraft.elapsedSeconds,
    });

    updateDraft(activeCase.id, (prev) => {
      const normalizedNew = `${outcome.medicationItem.drug.toLowerCase()}::${outcome.medicationItem.dose.toLowerCase()}::${outcome.medicationItem.route.toLowerCase()}`;
      const exists = prev.medications.some(
        (m) => `${m.drug.toLowerCase()}::${m.dose.toLowerCase()}::${m.route.toLowerCase()}` === normalizedNew
      );
      const nextMeds = exists
        ? prev.medications
        : [...prev.medications, { ...outcome.medicationItem, phase: 'stat_urgencias' as const }];

      const sysMsg: ChatMessage = {
        id: `t-sys-${Date.now()}`,
        sender: 'system',
        text: `STAT aplicado: ${outcome.record.drug} ${outcome.record.dose} (${outcome.record.route}).`,
        timestamp: formatTimer(prev.elapsedSeconds),
      };

      const reactionMsg: ChatMessage = {
        id: `t-pat-stat-${Date.now() + 1}`,
        sender: 'patient',
        text: outcome.record.patientFeelingNote,
        timestamp: formatTimer(prev.elapsedSeconds),
      };

      return {
        ...prev,
        liveVitalSigns: outcome.updatedVitals,
        statInterventions: nextStats,
        evolutionState: evoAfterStat.evolutionState,
        lastEvolutionSecond: prev.elapsedSeconds,
        medications: nextMeds,
        messages: [...prev.messages, sysMsg, reactionMsg],
        immediateDeathAlert: outcome.isImmediateDeath
          ? {
              drug: outcome.record.drug,
              dose: outcome.record.dose,
              route: outcome.record.route,
              reason: outcome.immediateDeathReason || outcome.record.physiologicalEffectSummary,
            }
          : prev.immediateDeathAlert,
      };
    });
  };

  const handleGoToNextPendingPatient = () => {
    setFlashResultCaseId(null);
    const nextUnresolvedIdx = cases.findIndex((c) => !drafts[c.id]?.result);
    if (nextUnresolvedIdx >= 0) {
      setActiveCaseIndex(nextUnresolvedIdx);
    } else {
      setShiftSummaryOpen(true);
    }
  };

  // Live synced exams & studies for active patient
  const liveExams = useMemo(() => {
    if (!activeCase || !activeDraft) return [];
    return buildLivePhysicalExams(
      activeCase,
      activeDraft.liveVitalSigns,
      activeDraft.statInterventions,
      activeDraft.evolutionState
    );
  }, [activeCase, activeDraft?.liveVitalSigns, activeDraft?.statInterventions, activeDraft?.evolutionState]);

  const liveStudies = useMemo(() => {
    if (!activeCase || !activeDraft) return [];
    return buildLiveStudies(
      activeCase,
      activeDraft.liveVitalSigns,
      activeDraft.statInterventions,
      activeDraft.evolutionState
    );
  }, [activeCase, activeDraft?.liveVitalSigns, activeDraft?.statInterventions, activeDraft?.evolutionState]);

  const filteredExams = useMemo(() => {
    if (examSystemFilter === 'Todos') return liveExams;
    return liveExams.filter((pe) => pe.system === examSystemFilter);
  }, [liveExams, examSystemFilter]);

  const filteredStudies = useMemo(() => {
    const q = studySearch.trim().toLowerCase();
    return liveStudies
      .filter((s) => studyCategoryFilter === 'Todos' || s.category === studyCategoryFilter)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || s.subcategory.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [liveStudies, studyCategoryFilter, studySearch]);

  const filteredStatPresets = useMemo(() => {
    if (statCategoryFilter === 'Todos') return STAT_QUICK_PRESETS;
    return STAT_QUICK_PRESETS.filter((p) => p.category === statCategoryFilter);
  }, [statCategoryFilter]);

  const flashResult = flashResultCaseId ? drafts[flashResultCaseId]?.result : undefined;
  const auditTarget = auditModalCaseId ? drafts[auditModalCaseId]?.result : undefined;

  // Balance Final metrics
  const shiftMetrics = useMemo(() => {
    const total = resolvedResults.length;
    if (total === 0) {
      return { total: 0, saved: 0, stabilized: 0, morbidityOrDeath: 0, diagOk: 0, avgScore: 0 };
    }
    const saved = resolvedResults.filter((r) => r.outcomeStatus === 'saved').length;
    const stabilized = resolvedResults.filter((r) => r.outcomeStatus === 'stabilized_morbidity').length;
    const morbidityOrDeath = resolvedResults.filter(
      (r) => r.outcomeStatus === 'critical_morbidity' || r.outcomeStatus === 'deceased'
    ).length;
    const diagOk = resolvedResults.filter((r) => r.diagCorrect).length;
    const avgScore = Math.round(resolvedResults.reduce((acc, r) => acc + r.evaluation.totalScore, 0) / total);
    return { total, saved, stabilized, morbidityOrDeath, diagOk, avgScore };
  }, [resolvedResults]);

  if (!activeCase || !activeDraft) return null;

  const isDeceased =
    activeDraft.statInterventions.some((s) => s.isImmediateDeath) ||
    activeDraft.liveVitalSigns.heartRate === 0 ||
    (activeDraft.liveVitalSigns.bloodPressure || '').startsWith('0/');

  const disclosedBg = deriveDisclosedBackground(activeDraft.messages, Boolean(activeDraft.result));
  const perPatientRemaining = Math.max(0, 180 - activeDraft.elapsedSeconds);
  const globalRemaining = Math.max(0, 720 - shiftElapsedSeconds);

  return (
    <div className="flex-1 max-w-7xl w-full min-w-0 mx-auto px-3 sm:px-4 py-4 space-y-4">
      {/* Turno Header Bar */}
      <div className="bg-[#07132B] border border-blue-800/70 rounded-2xl p-3.5 sm:p-4 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                  Modo Turno Médico · Guardia Express
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-950 border border-blue-700 text-sky-300 rounded">
                  {config.profile === 'mixto'
                    ? 'Guardia Mixta'
                    : config.profile === 'consulta_rapida'
                    ? 'Consulta Rápida'
                    : 'Urgencias / Choque'}
                </span>
              </div>
              <p className="text-[11px] text-blue-200/80">
                Pacientes atendidos: <strong className="text-white">{resolvedResults.length} / {cases.length}</strong> · Prioriza por triage o atiende en cola rápida sin cambiar de pantallas.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Timer */}
            {config.timerMode === 'per_patient_180' ? (
              <div
                className={`px-3 py-1.5 rounded-lg border font-mono text-xs flex items-center gap-1.5 ${
                  perPatientRemaining <= 30
                    ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                    : 'bg-[#040B1B] border-amber-600/70 text-amber-200'
                }`}
              >
                <Timer className="w-3.5 h-3.5 shrink-0" />
                <span className="font-sans text-[11px]">Paciente:</span>
                <strong className="text-white">{formatTimer(perPatientRemaining)}</strong>
              </div>
            ) : config.timerMode === 'global_720' ? (
              <div
                className={`px-3 py-1.5 rounded-lg border font-mono text-xs flex items-center gap-1.5 ${
                  globalRemaining <= 90
                    ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                    : 'bg-[#040B1B] border-sky-600/70 text-sky-200'
                }`}
              >
                <Timer className="w-3.5 h-3.5 shrink-0" />
                <span className="font-sans text-[11px]">Turno Total:</span>
                <strong className="text-white">{formatTimer(globalRemaining)}</strong>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg border bg-[#040B1B] border-blue-800/70 text-blue-200 font-mono text-xs flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="font-sans text-[11px]">Turno:</span>
                <strong className="text-white">{formatTimer(shiftElapsedSeconds)}</strong>
              </div>
            )}

            {resolvedResults.length > 0 && (
              <button
                type="button"
                onClick={() => setShiftSummaryOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Award className="w-3.5 h-3.5 shrink-0" />
                <span>Balance ({resolvedResults.length})</span>
              </button>
            )}

            {!confirmExit ? (
              <button
                type="button"
                onClick={() => setConfirmExit(true)}
                className="px-3 py-1.5 rounded-lg bg-[#040B1B] hover:bg-rose-950/70 border border-blue-800/80 hover:border-rose-500/70 text-blue-200 hover:text-rose-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Salir</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-rose-950/80 border border-rose-500/80 rounded-lg px-2.5 py-1">
                <span className="text-[11px] text-rose-100 font-semibold">¿Terminar turno?</span>
                <button
                  type="button"
                  onClick={onExitTurno}
                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer"
                >
                  Sí, salir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmExit(false)}
                  className="px-2 py-0.5 rounded bg-[#040B1B] text-blue-200 text-[11px] font-semibold cursor-pointer"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Waiting Room / Triage Queue Strip */}
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1 no-scrollbar">
          {cases.map((c, idx) => {
            const draft = drafts[c.id];
            const isActive = idx === activeCaseIndex && !shiftSummaryOpen;
            const isDone = Boolean(draft?.result);
            const triage = getTriageShortBadge(c.patientInfo.triageLevel);

            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setShiftSummaryOpen(false);
                  setFlashResultCaseId(null);
                  setActiveCaseIndex(idx);
                }}
                className={`min-w-[205px] max-w-[240px] shrink-0 rounded-xl border p-2.5 text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isActive
                    ? 'bg-blue-600/25 border-blue-400 ring-1 ring-blue-400/50 shadow-md'
                    : isDone
                    ? 'bg-[#04121F] border-emerald-700/60 opacity-90 hover:opacity-100'
                    : 'bg-[#040B1B] border-blue-900/70 hover:border-blue-600'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] font-mono font-bold text-blue-300">
                    CAMA #{idx + 1}
                  </span>
                  {isDone ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-500/70 text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {draft.result?.evaluation.totalScore}/100
                    </span>
                  ) : (
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${triage.className}`}>
                      {triage.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 min-w-0">
                  <PatientVisualCard
                    caseData={c}
                    liveVitals={draft?.liveVitalSigns}
                    isDeceased={
                      Boolean(draft?.immediateDeathAlert) ||
                      draft?.liveVitalSigns?.heartRate === 0 ||
                      (draft?.liveVitalSigns?.bloodPressure || '').startsWith('0/')
                    }
                    variant="thumbnail"
                    className="w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">
                      {c.patientInfo.name} · {c.patientInfo.age}a
                    </div>
                    <div className="text-[11px] text-blue-200/80 line-clamp-1">
                      {c.patientInfo.consultReason}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content: Either Balance Final, Flash Result Card, or 3-Column Express Workstation */}
      {shiftSummaryOpen || allResolved && !flashResultCaseId ? (
        <section className="bg-[#07132B] border border-blue-800/70 rounded-2xl p-5 sm:p-7 space-y-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-blue-900/60 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase tracking-wider">
                <Award className="w-4 h-4 shrink-0" />
                <span>Balance Clínico del Turno Médico</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white">
                {allResolved ? 'Guardia Completada' : 'Resumen Parcial del Turno'}
              </h2>
              <p className="text-xs text-blue-200/80">
                Tiempo total en guardia: <strong className="text-white font-mono">{formatTimer(shiftElapsedSeconds)}</strong> · Revisa la morbimortalidad, diagnóstico, fase STAT y tratamiento definitivo de cada paciente.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!allResolved && (
                <button
                  type="button"
                  onClick={() => setShiftSummaryOpen(false)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer"
                >
                  Continuar Atendiendo Pendientes
                </button>
              )}
              <button
                type="button"
                onClick={() => onStartNewTurno(config)}
                className="px-4 py-2 rounded-xl bg-white hover:bg-blue-100 text-[#030A1C] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Nuevo Turno Igual</span>
              </button>
              <button
                type="button"
                onClick={onExitTurno}
                className="px-4 py-2 rounded-xl bg-[#040B1B] hover:bg-[#0D2149] border border-blue-700 text-blue-100 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Panel Principal</span>
              </button>
            </div>
          </div>

          {/* Cohort KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-blue-300 font-bold">Desenlace Favorable</div>
              <div className="text-2xl font-extrabold text-emerald-300 mt-1 font-mono">
                {shiftMetrics.saved} / {shiftMetrics.total}
              </div>
              <div className="text-[11px] text-blue-200/75 mt-0.5">Pacientes resueltos sin secuelas</div>
            </div>
            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-blue-300 font-bold">Precisión Diagnóstica</div>
              <div className="text-2xl font-extrabold text-sky-300 mt-1 font-mono">
                {shiftMetrics.diagOk} / {shiftMetrics.total}
              </div>
              <div className="text-[11px] text-blue-200/75 mt-0.5">Diagnósticos principales acertados</div>
            </div>
            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-blue-300 font-bold">Puntaje Promedio</div>
              <div className="text-2xl font-extrabold text-white mt-1 font-mono">
                {shiftMetrics.avgScore} pts
              </div>
              <div className="text-[11px] text-blue-200/75 mt-0.5">Rúbrica clínica integral /100</div>
            </div>
            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-blue-300 font-bold">Eventos Críticos / Mortalidad</div>
              <div className={`text-2xl font-extrabold mt-1 font-mono ${shiftMetrics.morbidityOrDeath > 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
                {shiftMetrics.morbidityOrDeath}
              </div>
              <div className="text-[11px] text-blue-200/75 mt-0.5">Morbimortalidad severa evitada o ocurrida</div>
            </div>
          </div>

          {/* Patient Roster Audit List */}
          <div className="space-y-3">
            {cases.map((c, idx) => {
              const res = drafts[c.id]?.result;
              if (!res) {
                return (
                  <div
                    key={c.id}
                    className="bg-[#040B1B] border border-blue-900/50 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <span className="text-xs font-bold text-blue-300">Cama #{idx + 1} · {c.patientInfo.name}</span>
                      <p className="text-xs text-blue-200/70 mt-0.5">Aún sin finalizar ({c.patientInfo.consultReason})</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShiftSummaryOpen(false);
                        setActiveCaseIndex(idx);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer"
                    >
                      Atender Ahora
                    </button>
                  </div>
                );
              }

              const statusBadge =
                res.outcomeStatus === 'saved'
                  ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300'
                  : res.outcomeStatus === 'stabilized_morbidity'
                  ? 'bg-amber-950/80 border-amber-500/70 text-amber-300'
                  : 'bg-rose-950/80 border-rose-500/80 text-rose-200';

              const statAudit = res.evaluation.statAudit;

              return (
                <div
                  key={c.id}
                  className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono font-bold text-blue-300">Cama #{idx + 1}</span>
                        <span className="text-sm font-bold text-white">{c.patientInfo.name} ({c.patientInfo.age}a)</span>
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${statusBadge}`}>
                          {res.outcomeHeadline}
                        </span>
                      </div>
                      <div className="text-xs text-blue-100/90">
                        <strong className="text-sky-300">Dx Real:</strong> {c.solution.correctDiagnosis} ·{' '}
                        <strong className="text-blue-300">Tu Dx:</strong>{' '}
                        {res.evaluation.userSummary?.primaryDiagnosis || 'No especificado'}
                      </div>
                      {statAudit?.requiresUrgentStat && (
                        <div className="text-[11px] text-amber-200/90">
                          <strong className="text-amber-300">STAT/Urgencias:</strong> {statAudit.statGuidanceComment}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-lg font-extrabold font-mono text-white">
                          {res.evaluation.totalScore}/100
                        </div>
                        <div className="text-[10px] text-blue-300 font-mono">
                          {formatTimer(res.timeSpentSeconds)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAuditModalCaseId(c.id)}
                        className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Auditoría y Clase</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : flashResult ? (
        /* Flash Inter-Patient Outcome Card */
        <section className="bg-[#07132B] border-2 border-blue-500/70 rounded-2xl p-5 sm:p-8 max-w-4xl mx-auto space-y-5 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-900/60 pb-4">
            <div className="flex items-center gap-3">
              <PatientVisualCard
                caseData={flashResult.caseData}
                isDeceased={flashResult.outcomeStatus === 'deceased'}
                variant="thumbnail"
                className="w-16"
              />
              <div
                className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${
                  flashResult.outcomeStatus === 'saved'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    : flashResult.outcomeStatus === 'stabilized_morbidity'
                    ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                    : 'bg-rose-950/80 border-rose-500 text-rose-300'
                }`}
              >
                {flashResult.outcomeStatus === 'saved' ? (
                  <HeartHandshake className="w-5 h-5" />
                ) : flashResult.outcomeStatus === 'deceased' ? (
                  <Skull className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300">
                  Desenlace Rápido · {flashResult.caseData.patientInfo.name}
                </div>
                <h2 className="text-lg sm:text-xl font-extrabold text-white">
                  {flashResult.outcomeHeadline}
                </h2>
              </div>
            </div>

            <div className="text-right">
              <div className="text-3xl font-black font-mono text-white">
                {flashResult.evaluation.totalScore}
                <span className="text-sm text-blue-300 font-semibold"> /100</span>
              </div>
              <div className="text-[11px] text-blue-200/80">
                Tiempo: {formatTimer(flashResult.timeSpentSeconds)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4 space-y-1.5">
              <div className="font-bold uppercase tracking-wider text-sky-300">Diagnóstico</div>
              <p className="text-white font-semibold">
                Real: {flashResult.caseData.solution.correctDiagnosis}
              </p>
              <p className="text-blue-200/80">
                Tu impresión: {flashResult.evaluation.userSummary?.primaryDiagnosis || 'Sin diagnóstico registrado'}
              </p>
              <p className="text-blue-100/80 pt-1">
                {flashResult.evaluation.feedback.diagnosisAccuracyComment}
              </p>
            </div>

            <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl p-4 space-y-1.5">
              <div className="font-bold uppercase tracking-wider text-amber-300">
                Manejo de Referencia para Estudio
              </div>
              {flashResult.evaluation.statAudit?.requiresUrgentStat && (
                <p className="text-amber-100">
                  <strong>Fase STAT / Urgencias:</strong>{' '}
                  {flashResult.evaluation.statAudit.recommendedStatProtocol
                    ?.slice(0, 3)
                    .map((p) => `${p.drug} ${p.dose} (${p.route})`)
                    .join(' · ')}
                </p>
              )}
              <p className="text-blue-100/90">
                <strong>Esquema Definitivo:</strong>{' '}
                {flashResult.caseData.solution.optimalTreatment.pharmacological
                  .slice(0, 3)
                  .map((p) => `${p.drug} ${p.dose} (${p.duration})`)
                  .join(' · ')}{' '}
                · <strong>Destino:</strong> {flashResult.caseData.solution.optimalTreatment.hospitalizationDecision}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAuditModalCaseId(flashResult.caseData.id)}
              className="px-4 py-2.5 rounded-xl bg-[#040B1B] hover:bg-[#0D2149] border border-blue-700 text-blue-100 text-xs font-bold flex items-center gap-2 cursor-pointer"
            >
              <BookOpen className="w-4 h-4 text-sky-400" />
              <span>Ver Auditoría Completa y Clase Magistral</span>
            </button>

            <button
              type="button"
              onClick={handleGoToNextPendingPatient}
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-blue-100 text-[#030A1C] text-xs sm:text-sm font-extrabold flex items-center gap-2 shadow-lg cursor-pointer"
            >
              <span>
                {cases.some((c) => !drafts[c.id]?.result)
                  ? 'Siguiente Paciente en Sala'
                  : 'Ver Balance Final del Turno'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      ) : (
        /* 3-Column Express Workstation */
        <div className="space-y-3.5">
          {/* Compact Live Vital Signs Telemetry Strip */}
          <div className="bg-[#040B1B] border border-blue-900/70 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-400" />
                <span>
                  {activeDraft.caseId === activeCase.id && `${activeCase.patientInfo.name}, ${activeCase.patientInfo.age}a (${activeCase.patientInfo.sex})`}
                </span>
              </div>
              <span className="font-mono text-sky-300 flex items-center gap-1">
                <HeartPulse className="w-3.5 h-3.5 text-rose-400" />
                PA {activeDraft.liveVitalSigns.bloodPressure}
              </span>
              <span className="font-mono text-emerald-300 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" />
                FC {activeDraft.liveVitalSigns.heartRate} lpm
              </span>
              <span className="font-mono text-blue-200 flex items-center gap-1">
                <Wind className="w-3.5 h-3.5" />
                FR {activeDraft.liveVitalSigns.respiratoryRate} · SpO₂ {activeDraft.liveVitalSigns.oxygenSaturation}%
              </span>
              <span className="font-mono text-amber-200 flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5" />
                T° {activeDraft.liveVitalSigns.temperature}°C
              </span>
              <span className="font-mono text-purple-200 flex items-center gap-1">
                <Brain className="w-3.5 h-3.5" />
                GCS {activeDraft.liveVitalSigns.glasgow}/15
              </span>
              {activeDraft.liveVitalSigns.bloodGlucose !== undefined && (
                <span className="font-mono text-amber-300">
                  Glu {activeDraft.liveVitalSigns.bloodGlucose} mg/dL
                </span>
              )}
            </div>

            {activeDraft.evolutionState?.trajectory && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  activeDraft.evolutionState.trajectory === 'mejorando'
                    ? 'bg-emerald-950 border-emerald-600 text-emerald-300'
                    : activeDraft.evolutionState.trajectory === 'critico' ||
                      activeDraft.evolutionState.trajectory === 'deterioro'
                    ? 'bg-rose-950 border-rose-500 text-rose-200'
                    : 'bg-blue-950 border-blue-700 text-blue-200'
                }`}
              >
                Estado: {activeDraft.evolutionState.trajectory}
              </span>
            )}
          </div>

          {/* Immediate Death Banner if iatrogenic fatality occurred */}
          {(activeDraft.immediateDeathAlert || isDeceased) && (
            <div className="bg-rose-950/90 border-2 border-rose-500 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-100">
              <div className="flex items-center gap-2">
                <Skull className="w-5 h-5 text-rose-300 shrink-0" />
                <span>
                  <strong className="text-white uppercase">Fallecimiento Inmediato por Iatrogenia STAT:</strong>{' '}
                  {activeDraft.immediateDeathAlert?.reason || 'Paro cardiorrespiratorio irreversible en monitoreo.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => resolvePatient(activeCase, activeDraft)}
                className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-rose-100 text-rose-950 font-bold cursor-pointer"
              >
                Registrar Desenlace y Continuar
              </button>
            </div>
          )}

          {/* Already resolved notice when revisiting a completed bed */}
          {activeDraft.result && (
            <div className="bg-emerald-950/70 border border-emerald-500/70 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-emerald-100">
                <strong>Paciente ya resuelto:</strong> Obtuviste{' '}
                <strong className="text-white font-mono">{activeDraft.result.evaluation.totalScore}/100</strong> ({activeDraft.result.outcomeHeadline}).
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditModalCaseId(activeCase.id)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
                >
                  Ver Auditoría y Clase
                </button>
                <button
                  type="button"
                  onClick={handleGoToNextPendingPatient}
                  className="px-3 py-1.5 rounded-lg bg-white text-[#030A1C] font-bold cursor-pointer"
                >
                  Ir a Pendientes
                </button>
              </div>
            </div>
          )}

          {/* 3 Columns Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* COL 1: Interrogatorio Rápido + Examen Físico (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              {/* Motivo e Historia Breve */}
              <div className="bg-[#07132B] border border-blue-900/60 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-blue-400" />
                    <span>1. Historia Express</span>
                  </span>
                  <span className="text-[10px] font-mono text-blue-300">
                    {activeDraft.messages.filter((m) => m.sender === 'doctor').length} preguntas
                  </span>
                </div>

                {/* Prognosis-Style Patient Scene Vignette */}
                <PatientVisualCard
                  caseData={activeCase}
                  liveVitals={activeDraft.liveVitalSigns}
                  isDeceased={isDeceased}
                  variant="vignette"
                />

                <div className="bg-[#040B1B] border border-blue-900/60 rounded-lg p-2.5 text-xs text-blue-100 space-y-1">
                  <div>
                    <strong className="text-sky-300">Motivo:</strong> {activeCase.patientInfo.consultReason}
                  </div>
                  <div className="text-[11px] text-blue-200/80">
                    <strong>Evolución:</strong> {activeCase.patientInfo.evolutionTime} · <strong>Ocupación:</strong> {activeCase.patientInfo.occupation}
                  </div>
                </div>

                {/* 5 One-Click Interrogatorio Buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_INTERROGATION_PROMPTS.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      disabled={Boolean(activeDraft.result) || isDeceased}
                      onClick={() => handleAskQuestion(q.prompt)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#0D2149] hover:bg-blue-700 disabled:opacity-45 border border-blue-700/60 text-[11px] font-semibold text-blue-100 cursor-pointer transition-colors"
                    >
                      + {q.label}
                    </button>
                  ))}
                </div>

                {/* Compact Dialogue Feed */}
                <div className="bg-[#030917] border border-blue-950 rounded-lg p-2.5 max-h-52 overflow-y-auto space-y-2">
                  {activeDraft.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`text-xs rounded-lg px-2.5 py-1.5 ${
                        m.sender === 'doctor'
                          ? 'bg-blue-900/50 border border-blue-700/50 text-sky-100 ml-4'
                          : m.sender === 'system'
                          ? 'bg-amber-950/50 border border-amber-700/50 text-amber-200 text-[11px]'
                          : 'bg-[#071633] border border-blue-900/60 text-white mr-2'
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300 block">
                        {m.sender === 'doctor' ? 'Médico' : m.sender === 'system' ? 'Monitor STAT' : 'Paciente'} · {m.timestamp}
                      </span>
                      <span className="leading-snug">{m.text}</span>
                    </div>
                  ))}
                </div>

                {/* Disclosed Antecedentes Chips */}
                {(disclosedBg.pathological || disclosedBg.allergies || disclosedBg.currentMedications) && (
                  <div className="bg-[#040B1B] border border-blue-900/60 rounded-lg p-2 text-[11px] text-blue-100/90 space-y-1">
                    {disclosedBg.pathological && (
                      <div><strong className="text-sky-300">Patológicos:</strong> {activeCase.background.pathological.join(' · ')}</div>
                    )}
                    {disclosedBg.currentMedications && (
                      <div><strong className="text-sky-300">Fármacos:</strong> {activeCase.background.currentMedications.join(' · ')}</div>
                    )}
                    {disclosedBg.allergies && (
                      <div><strong className="text-amber-300">Alergias:</strong> {activeCase.background.allergies.join(' · ')}</div>
                    )}
                  </div>
                )}

                {/* Custom Question Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customQuestion.trim()) return;
                    handleAskQuestion(customQuestion);
                    setCustomQuestion('');
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    type="text"
                    value={customQuestion}
                    disabled={Boolean(activeDraft.result) || isDeceased}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    placeholder="Pregunta puntual al paciente..."
                    className="flex-1 bg-[#040B1B] border border-blue-800/70 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-blue-400/50 focus:outline-none focus:border-blue-400"
                  />
                  <button
                    type="submit"
                    disabled={!customQuestion.trim() || Boolean(activeDraft.result) || isDeceased}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-45 text-white cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>

              {/* Exploración Física 1-Clic */}
              <div className="bg-[#07132B] border border-blue-900/60 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <Stethoscope className="w-4 h-4 text-blue-400" />
                    <span>2. Examen Físico (1 clic)</span>
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(activeDraft.result)}
                    onClick={() =>
                      updateDraft(activeCase.id, (prev) => ({
                        ...prev,
                        unlockedExamIds: liveExams.map((e) => e.id),
                      }))
                    }
                    className="px-2 py-1 rounded bg-[#0D2149] hover:bg-blue-700 text-[10px] font-bold text-sky-300 cursor-pointer"
                  >
                    Explorar Todo ({activeDraft.unlockedExamIds.length}/{liveExams.length})
                  </button>
                </div>

                {/* System Filter */}
                <select
                  value={examSystemFilter}
                  onChange={(e) => setExamSystemFilter(e.target.value)}
                  className="w-full bg-[#040B1B] border border-blue-800/70 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-400"
                >
                  <option value="Todos">Todos los sistemas ({liveExams.length})</option>
                  {['General', 'Cabeza y Cuello', 'Tórax y Pulmones', 'Cardiovascular', 'Abdomen', 'Neurológico', 'Osteomuscular y Piel'].map((sys) => (
                    <option key={sys} value={sys}>
                      {sys}
                    </option>
                  ))}
                </select>

                {/* Neutral clickable maneuver buttons + inline findings */}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                  {filteredExams.map((pe) => {
                    const isUnlocked = activeDraft.unlockedExamIds.includes(pe.id);
                    return (
                      <div
                        key={pe.id}
                        className={`rounded-lg border p-2.5 text-xs transition-colors ${
                          isUnlocked
                            ? pe.isAbnormal
                              ? 'bg-amber-950/35 border-amber-600/60'
                              : 'bg-[#040B1B] border-blue-800/70'
                            : 'bg-[#040B1B] border-blue-900/60 hover:border-blue-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase text-blue-300 block">
                              {pe.system}
                            </span>
                            <span className="font-semibold text-white block truncate">{pe.name}</span>
                          </div>
                          {!isUnlocked && (
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft(activeCase.id, (prev) => ({
                                  ...prev,
                                  unlockedExamIds: prev.unlockedExamIds.includes(pe.id)
                                    ? prev.unlockedExamIds
                                    : [...prev.unlockedExamIds, pe.id],
                                }))
                              }
                              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                            >
                              Examinar
                            </button>
                          )}
                        </div>
                        {isUnlocked && (
                          <p className="text-[11px] text-blue-100/90 mt-1.5 leading-snug border-t border-blue-900/50 pt-1.5">
                            {pe.finding}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* COL 2: Estabilización STAT en Vivo + Paraclínicos Rápidos (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              {/* STAT Express Stabilization */}
              <div className="bg-[#07132B] border border-amber-700/50 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <Syringe className="w-4 h-4 text-amber-400" />
                    <span>3. Estabilización STAT en Vivo</span>
                  </span>
                  <span className="text-[10px] font-mono text-amber-200">
                    Aplicadas: {activeDraft.statInterventions.length}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {['Todos', 'Vía Aérea / O₂', 'Hemodinamia / Líquidos', 'Cardio / Crisis', 'Metabólico / Síntomas'].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setStatCategoryFilter(cat)}
                      className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer ${
                        statCategoryFilter === cat
                          ? 'bg-amber-600 text-white'
                          : 'bg-[#040B1B] text-blue-200 border border-blue-900/70'
                      }`}
                    >
                      {cat === 'Vía Aérea / O₂'
                        ? 'O₂/Resp'
                        : cat === 'Hemodinamia / Líquidos'
                        ? 'Líquidos/Shock'
                        : cat === 'Cardio / Crisis'
                        ? 'Cardio/HTA'
                        : cat === 'Metabólico / Síntomas'
                        ? 'Metab/Sint'
                        : 'Todos'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {filteredStatPresets.map((preset: StatPreset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={Boolean(activeDraft.result) || isDeceased}
                      onClick={() =>
                        handleApplyStat({
                          presetId: preset.id,
                          label: preset.label,
                          drug: preset.drug,
                          dose: preset.dose,
                          route: preset.route,
                          frequency: preset.frequency,
                          duration: preset.duration,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#040B1B] hover:bg-amber-950/60 disabled:opacity-45 border border-blue-900/70 hover:border-amber-500/70 text-left cursor-pointer transition-colors"
                    >
                      <div className="text-[11px] font-bold text-white truncate">{preset.label}</div>
                      <div className="text-[10px] text-amber-300/85 truncate">{preset.dose} · {preset.route.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>

                {/* Custom STAT quick input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customStatDrug.trim()) return;
                    handleApplyStat({
                      label: customStatDrug.trim(),
                      drug: customStatDrug.trim(),
                      dose: customStatDose.trim() || 'Dosis STAT estándar',
                      route: customStatRoute,
                      frequency: 'Dosis única STAT',
                      duration: 'Fase aguda',
                    });
                    setCustomStatDrug('');
                    setCustomStatDose('');
                  }}
                  className="grid grid-cols-12 gap-1.5 pt-1"
                >
                  <input
                    type="text"
                    value={customStatDrug}
                    onChange={(e) => setCustomStatDrug(e.target.value)}
                    disabled={Boolean(activeDraft.result) || isDeceased}
                    placeholder="Otro STAT (ej. Atropina, NAC)"
                    className="col-span-6 bg-[#040B1B] border border-blue-800/70 rounded-lg px-2 py-1 text-[11px] text-white placeholder-blue-400/50 focus:outline-none focus:border-amber-400"
                  />
                  <input
                    type="text"
                    value={customStatDose}
                    onChange={(e) => setCustomStatDose(e.target.value)}
                    disabled={Boolean(activeDraft.result) || isDeceased}
                    placeholder="Dosis"
                    className="col-span-3 bg-[#040B1B] border border-blue-800/70 rounded-lg px-2 py-1 text-[11px] text-white placeholder-blue-400/50 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="submit"
                    disabled={!customStatDrug.trim() || Boolean(activeDraft.result) || isDeceased}
                    className="col-span-3 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-45 text-white text-[11px] font-bold cursor-pointer"
                  >
                    Aplicar
                  </button>
                </form>

                {activeDraft.statInterventions.length > 0 && (
                  <div className="space-y-1 max-h-24 overflow-y-auto pt-1 border-t border-blue-900/50">
                    {activeDraft.statInterventions.map((st) => (
                      <div key={st.id} className="text-[11px] bg-[#040B1B] rounded px-2 py-1 border border-blue-900/60 flex items-center justify-between gap-2">
                        <span className="font-semibold text-white truncate">{st.drug} ({st.dose})</span>
                        <span
                          className={`text-[10px] font-bold shrink-0 ${
                            st.effectSeverity === 'mejoria'
                              ? 'text-emerald-300'
                              : st.effectSeverity === 'reaccion_adversa'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                          }`}
                        >
                          {st.effectSeverity === 'mejoria'
                            ? 'Mejoría'
                            : st.effectSeverity === 'reaccion_adversa'
                            ? 'Riesgo'
                            : 'Aplicado'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Paraclínicos Rápidos */}
              <div className="bg-[#07132B] border border-blue-900/60 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1.5">
                    <FlaskConical className="w-4 h-4 text-blue-400" />
                    <span>4. Paraclínicos Rápidos</span>
                  </span>
                  <span className="text-[10px] font-mono text-blue-300">
                    Solicitados: {activeDraft.unlockedStudyIds.length}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(['Todos', 'Laboratorio', 'Imagen', 'Gabinete y Trazados'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setStudyCategoryFilter(cat)}
                      className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer ${
                        studyCategoryFilter === cat
                          ? 'bg-blue-600 text-white'
                          : 'bg-[#040B1B] text-blue-200 border border-blue-900/70'
                      }`}
                    >
                      {cat === 'Gabinete y Trazados' ? 'ECG/Gabinete' : cat}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-blue-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={studySearch}
                    onChange={(e) => setStudySearch(e.target.value)}
                    placeholder="Buscar estudio (BH, ECG, TAC, gaso...)"
                    className="w-full bg-[#040B1B] border border-blue-800/70 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white placeholder-blue-400/50 focus:outline-none focus:border-blue-400"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                  {filteredStudies.map((std) => {
                    const isUnlocked = activeDraft.unlockedStudyIds.includes(std.id);
                    const hasTracing = isUnlocked && Boolean(detectTracingKind(std));

                    return (
                      <div
                        key={std.id}
                        className={`rounded-lg border p-2.5 text-xs ${
                          isUnlocked
                            ? std.isAbnormal
                              ? 'bg-amber-950/35 border-amber-600/60'
                              : 'bg-[#040B1B] border-blue-800/70'
                            : 'bg-[#040B1B] border-blue-900/60 hover:border-blue-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold uppercase text-sky-300 block">
                              {std.subcategory}
                            </span>
                            <span className="font-semibold text-white block leading-snug">{std.name}</span>
                          </div>
                          {!isUnlocked && (
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft(activeCase.id, (prev) => ({
                                  ...prev,
                                  unlockedStudyIds: prev.unlockedStudyIds.includes(std.id)
                                    ? prev.unlockedStudyIds
                                    : [...prev.unlockedStudyIds, std.id],
                                }))
                              }
                              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                            >
                              Solicitar
                            </button>
                          )}
                        </div>
                        {isUnlocked && (
                          <div className="mt-1.5 pt-1.5 border-t border-blue-900/50 space-y-1 text-[11px]">
                            <p className="text-blue-100 leading-snug">{std.result}</p>
                            {std.referenceRange && (
                              <p className="text-[10px] text-blue-300/75 font-mono">Ref: {std.referenceRange}</p>
                            )}
                            {hasTracing && (
                              <div className="pt-1">
                                <StudyTracingViewer study={std} vitalSigns={activeDraft.liveVitalSigns} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* COL 3: Diagnóstico Express Directo (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!activeDraft.primaryDiagnosis.trim() || activeDraft.result) return;
                  resolvePatient(activeCase, activeDraft);
                }}
                className="bg-[#07132B] border border-blue-700/70 rounded-xl p-4 space-y-3.5 shadow-lg"
              >
                <div className="text-xs font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                  <Brain className="w-4 h-4 text-sky-400" />
                  <span>5. Diagnóstico Express *</span>
                </div>

                <p className="text-xs text-blue-200/85 leading-relaxed">
                  Escribe únicamente tu diagnóstico clínico principal y confirma para pasar al siguiente paciente. No necesitas llenar diferenciales, recetas ni criterios de ingreso/alta.
                </p>

                <div>
                  <label className="text-[11px] font-semibold text-blue-200 block mb-1.5">
                    Impresión Diagnóstica Principal *
                  </label>
                  <input
                    type="text"
                    value={activeDraft.primaryDiagnosis}
                    disabled={Boolean(activeDraft.result)}
                    onChange={(e) =>
                      updateDraft(activeCase.id, (prev) => ({
                        ...prev,
                        primaryDiagnosis: e.target.value,
                      }))
                    }
                    placeholder="Ej. Apendicitis aguda / Dengue con signos de alarma..."
                    className="w-full bg-[#040B1B] border border-blue-700/80 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-blue-400/50 focus:outline-none focus:border-sky-400"
                  />
                </div>

                {!activeDraft.result && (
                  <button
                    type="submit"
                    disabled={!activeDraft.primaryDiagnosis.trim()}
                    className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed text-[#030A1C] font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition-all"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Confirmar Diagnóstico y Continuar</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                <div className="bg-[#040B1B] border border-blue-900/60 rounded-lg p-3 text-[11px] text-blue-200/80 space-y-1">
                  <div className="font-bold text-blue-300">Al confirmar verás automáticamente:</div>
                  <p>• Exactitud diagnóstica y tiempo empleado</p>
                  <p>• Protocolo STAT + Tratamiento definitivo con días</p>
                  <p>• Auditoría completa y Clase Magistral para estudio</p>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Full Clinical Audit & Masterclass Modal for any patient in the Turno */}
      {auditTarget && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto p-3 sm:p-6">
          <div className="max-w-6xl mx-auto bg-[#020617] border border-blue-800/80 rounded-2xl shadow-2xl overflow-hidden">
            <div className="sticky top-0 z-20 bg-[#07132B] border-b border-blue-900/70 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold text-sky-300">
                  Auditoría Clínica y Clase Magistral · Turno Médico
                </div>
                <div className="text-sm font-bold text-white">
                  {auditTarget.caseData.patientInfo.name} · {auditTarget.caseData.solution.correctDiagnosis}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAuditModalCaseId(null)}
                className="px-3 py-1.5 rounded-lg bg-[#040B1B] hover:bg-blue-900 border border-blue-700 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Cerrar Auditoría</span>
              </button>
            </div>
            <div className="p-4 sm:p-6">
              <ClinicalAuditTab
                caseData={auditTarget.caseData}
                evaluation={auditTarget.evaluation}
                onNextCase={() => {
                  setAuditModalCaseId(null);
                  if (flashResultCaseId) {
                    handleGoToNextPendingPatient();
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
