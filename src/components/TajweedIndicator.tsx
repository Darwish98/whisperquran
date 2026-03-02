/**
 * TajweedIndicator.tsx
 *
 * Visual indicators for tajweed acoustic verification results.
 * Shows badges on words after analysis:
 *   ✅ Green dot  — tajweed correct
 *   🟡 Amber dot  — tajweed violation
 * Tap → tooltip with rule name, Arabic, guidance.
 */

import { useState } from 'react';
import type { WordTajweedStatus, TajweedViolation } from '@/hooks/useTajweedAnalysis';

const RULE_INFO: Record<string, {
  label: string; arabic: string; color: string;
  guidance_correct: string; guidance_violation: string;
}> = {
  ghunna: {
    label: 'Ghunna', arabic: 'غنة', color: '#c0392b',
    guidance_correct: 'Good nasalisation! Humming sound held correctly.',
    guidance_violation: 'Hold a humming nasal sound for 2 counts on this letter.',
  },
  qalqalah: {
    label: 'Qalqalah', arabic: 'قلقلة', color: '#27ae60',
    guidance_correct: 'Good echo! Bouncing release was clear.',
    guidance_violation: 'This letter needs a slight vibrating bounce when it has no vowel.',
  },
  madd: {
    label: 'Madd', arabic: 'مد', color: '#2471a3',
    guidance_correct: 'Good prolongation! Vowel held for the right duration.',
    guidance_violation: 'Hold this vowel sound longer.',
  },
  idgham: {
    label: 'Idgham', arabic: 'إدغام', color: '#148f77',
    guidance_correct: 'Good merging! The nun blended smoothly into the next letter.',
    guidance_violation: 'Merge the nun/tanwin into the next letter — don\'t pronounce the nun separately.',
  },
  ikhfa: {
    label: 'Ikhfa', arabic: 'إخفاء', color: '#d35400',
    guidance_correct: 'Good concealment! The nun was hidden with light nasalisation.',
    guidance_violation: 'Conceal the nun — don\'t fully pronounce it, add a light nasal hum instead.',
  },
  iqlab: {
    label: 'Iqlab', arabic: 'إقلاب', color: '#7d3c98',
    guidance_correct: 'Good conversion! The nun became a mim sound before the ba.',
    guidance_violation: 'Convert the nun to a mim sound (lips together) before the ب.',
  },
};

// ── Badge ─────────────────────────────────────────────────────────────────────

interface TajweedBadgeProps {
  status: WordTajweedStatus;
  isDark: boolean;
}

export function TajweedBadge({ status, isDark }: TajweedBadgeProps) {
  const [show, setShow] = useState(false);
  if (status.rules.length === 0) return null;

  const hasViol = status.has_violation;
  const color = hasViol
    ? (isDark ? '#f39c12' : '#e67e22')
    : (isDark ? '#2ecc71' : '#27ae60');

  return (
    <span className="relative inline-block" style={{ verticalAlign: 'super' }}>
      <span
        onClick={(e) => { e.stopPropagation(); setShow(!show); }}
        className="inline-block cursor-pointer transition-transform hover:scale-125"
        style={{
          width: '8px', height: '8px', borderRadius: '50%',
          backgroundColor: color, marginInlineStart: '2px',
          boxShadow: `0 0 4px ${color}50`,
        }}
        title={status.rules.map(r => RULE_INFO[r.rule]?.label || r.rule).join(', ')}
      />
      {show && <TajweedTooltip status={status} isDark={isDark} onClose={() => setShow(false)} />}
    </span>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function TajweedTooltip({ status, isDark, onClose }: { status: WordTajweedStatus; isDark: boolean; onClose: () => void }) {
  const bg = isDark ? 'hsl(160 18% 12%)' : '#fff';
  const border = isDark ? 'hsl(160 10% 25%)' : '#e0e0e0';
  const text = isDark ? 'hsl(44 20% 85%)' : '#333';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute z-50 rounded-lg shadow-xl border p-3"
        style={{ background: bg, borderColor: border, color: text, width: '250px',
          bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px',
          fontSize: '13px', lineHeight: '1.5', direction: 'ltr', textAlign: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        {status.rules.map((rule, i) => {
          const info = RULE_INFO[rule.rule];
          if (!info) return null;
          const sc = rule.correct ? (isDark ? '#2ecc71' : '#27ae60') : (isDark ? '#f39c12' : '#e67e22');
          return (
            <div key={i} className="mb-2 last:mb-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: sc }} />
                <span className="font-semibold" style={{ color: info.color }}>{info.label}</span>
                <span style={{ opacity: 0.6 }}>({info.arabic})</span>
              </div>
              <p style={{ opacity: 0.85, fontSize: '12px' }}>
                {rule.correct ? info.guidance_correct : info.guidance_violation}
              </p>
              {rule.rule === 'madd' && rule.expected_duration != null && (
                <p style={{ opacity: 0.6, fontSize: '11px', marginTop: '2px' }}>
                  Expected: {(rule.expected_duration * 1000).toFixed(0)}ms
                  {rule.actual_duration != null && <> · Actual: {(rule.actual_duration * 1000).toFixed(0)}ms</>}
                </p>
              )}
              <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: isDark ? 'hsl(160 10% 20%)' : '#eee' }}>
                <div className="h-full rounded-full" style={{ width: `${rule.confidence * 100}%`, backgroundColor: sc }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Score Display ─────────────────────────────────────────────────────────────

export function TajweedScore({ score, rulesChecked, violations, isDark }: {
  score: number | null; rulesChecked: number; violations: number; isDark: boolean;
}) {
  if (score === null || rulesChecked === 0) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? '#27ae60' : pct >= 60 ? '#f39c12' : '#e74c3c';

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border"
      style={{ background: isDark ? 'hsl(160 18% 8%)' : '#fafafa', borderColor: isDark ? 'hsl(160 10% 20%)' : '#e8e8e8', fontSize: '13px' }}>
      <div className="flex items-center justify-center rounded-full font-bold"
        style={{ width: '36px', height: '36px', border: `2px solid ${color}`, color, fontSize: '14px' }}>
        {pct}
      </div>
      <div style={{ lineHeight: '1.4' }}>
        <div className="font-medium">Tajweed Score</div>
        <div style={{ opacity: 0.6, fontSize: '11px' }}>
          {rulesChecked} rules checked{violations > 0 && ` · ${violations} to improve`}
        </div>
      </div>
    </div>
  );
}
