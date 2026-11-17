import React, { useEffect, useState } from 'react';
import { Expand, UserRound, Baby, X } from 'lucide-react';
import { ClinicalCase, VitalSigns } from '../types/clinical';
import { getPatientIllustration, PathologyIntensity } from '../utils/patientIllustration';

interface PatientVisualCardProps {
  caseData: ClinicalCase;
  liveVitals?: VitalSigns;
  isDeceased?: boolean;
  variant?: 'banner' | 'vignette' | 'thumbnail';
  className?: string;
}

function getIntensityBorderClass(intensity: PathologyIntensity): string {
  switch (intensity) {
    case 'deceased':
      return 'border-rose-500/80';
    case 'critical':
      return 'border-rose-500/65 hover:border-rose-400';
    case 'moderate':
      return 'border-amber-500/60 hover:border-amber-400';
    case 'mild':
    default:
      return 'border-blue-700/70 hover:border-sky-400';
  }
}

function getIntensityTextClass(intensity: PathologyIntensity): string {
  switch (intensity) {
    case 'deceased':
    case 'critical':
      return 'text-rose-300';
    case 'moderate':
      return 'text-amber-300';
    case 'mild':
    default:
      return 'text-sky-300';
  }
}

export const PatientVisualCard: React.FC<PatientVisualCardProps> = ({
  caseData,
  liveVitals,
  isDeceased = false,
  variant = 'vignette',
  className = '',
}) => {
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const illustration = getPatientIllustration(caseData, liveVitals, isDeceased);
  const isPediatric = caseData.patientInfo.age < 13;
  const borderClass = getIntensityBorderClass(illustration.intensity);
  const accentTextClass = getIntensityTextClass(illustration.intensity);

  useEffect(() => {
    setImageError(false);
  }, [illustration.src, caseData.id]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen]);

  const renderFallback = (iconSizeClass: string) => (
    <div className="w-full h-full bg-gradient-to-br from-[#0B1C3E] to-[#040B1B] flex flex-col items-center justify-center text-blue-300/80 gap-1">
      {isPediatric ? (
        <Baby className={iconSizeClass} />
      ) : (
        <UserRound className={iconSizeClass} />
      )}
    </div>
  );

  if (variant === 'thumbnail') {
    return (
      <div
        className={`relative aspect-[4/3] overflow-hidden rounded-lg bg-[#040B1B] border ${borderClass} shrink-0 ${className}`}
      >
        {!imageError ? (
          <img
            src={illustration.src}
            alt={illustration.altText}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className={`w-full h-full object-cover object-center ${
              isDeceased ? 'grayscale brightness-75' : ''
            }`}
          />
        ) : (
          renderFallback('w-4 h-4')
        )}
      </div>
    );
  }

  const lightboxModal = lightboxOpen ? (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setLightboxOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={`Escena clínica de ${caseData.patientInfo.name}`}
    >
      <div
        className={`w-full max-w-2xl bg-[#07132B] border ${borderClass} rounded-2xl overflow-hidden shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 bg-[#040B1B] border-b border-blue-900/70 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">
              {caseData.patientInfo.name} · {caseData.patientInfo.age} años ({caseData.patientInfo.sex})
            </h3>
            <p className="text-xs text-blue-200/80 truncate">
              <span className={`font-semibold ${accentTextClass}`}>{illustration.intensityLabel}</span>
              <span aria-hidden="true"> · </span>
              <span>{illustration.painSiteLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="w-8 h-8 rounded-lg bg-[#0D2149] hover:bg-blue-700 text-blue-100 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            aria-label="Cerrar vista ampliada"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full bg-[#040B1B]">
          {!imageError ? (
            <img
              src={illustration.src}
              alt={illustration.altText}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className={`w-full h-full object-cover object-center ${
                isDeceased ? 'grayscale brightness-75' : ''
              }`}
            />
          ) : (
            renderFallback('w-12 h-12')
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#030917]/95 via-[#030917]/65 to-transparent flex flex-col justify-end p-4 gap-0.5">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${accentTextClass}`}>
              {illustration.sceneTitle}
            </span>
            <p className="text-xs text-blue-100 leading-snug">
              <strong className="text-white font-semibold">Motivo de consulta:</strong>{' '}
              {caseData.patientInfo.consultReason}
            </p>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (variant === 'banner') {
    return (
      <>
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          title={`${illustration.sceneTitle} · ${illustration.painSiteLabel} (clic para ampliar)`}
          className={`group relative aspect-[4/3] w-28 sm:w-36 rounded-xl overflow-hidden bg-[#040B1B] border ${borderClass} transition-colors shrink-0 cursor-pointer shadow-md focus:outline-none focus:ring-2 focus:ring-sky-400 ${className}`}
        >
          {!imageError ? (
            <img
              src={illustration.src}
              alt={illustration.altText}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className={`w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-105 ${
                isDeceased ? 'grayscale brightness-75' : ''
              }`}
            />
          ) : (
            renderFallback('w-7 h-7')
          )}
          <div className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-[#020617]/95 via-[#020617]/55 to-transparent flex items-end justify-between px-2 pb-1">
            <span className={`text-[9px] font-semibold truncate pr-1 ${accentTextClass}`}>
              {illustration.painSiteLabel}
            </span>
            <Expand className="w-3 h-3 text-sky-300 opacity-80 group-hover:opacity-100 shrink-0" />
          </div>
        </button>
        {lightboxModal}
      </>
    );
  }

  // 'vignette' variant: Prognosis-style clinical scene card for Express Turno & consultation reception
  return (
    <>
      <div
        className={`relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-[#040B1B] border ${borderClass} shadow-md ${className}`}
      >
        {!imageError ? (
          <img
            src={illustration.src}
            alt={illustration.altText}
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className={`w-full h-full object-cover object-center ${
              isDeceased ? 'grayscale brightness-75' : ''
            }`}
          />
        ) : (
          renderFallback('w-10 h-10')
        )}

        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          title="Ampliar imagen del paciente"
          aria-label="Ampliar imagen del paciente"
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg bg-[#030917]/80 hover:bg-blue-600 border border-blue-700/70 text-blue-100 flex items-center justify-center cursor-pointer transition-colors"
        >
          <Expand className="w-3.5 h-3.5" />
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-22 bg-gradient-to-t from-[#030917]/95 via-[#030917]/65 to-transparent flex flex-col justify-end px-3.5 pb-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider truncate">
            <span className={accentTextClass}>{illustration.intensityLabel}</span>
            <span className="text-blue-400" aria-hidden="true">·</span>
            <span className="text-blue-200/90 truncate">{illustration.painSiteLabel}</span>
          </div>
          <span className="text-xs font-medium text-white truncate">
            {illustration.visualCue}
          </span>
        </div>
      </div>
      {lightboxModal}
    </>
  );
};
