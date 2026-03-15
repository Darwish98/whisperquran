/**
 * TajweedIndicator.tsx
 *
 * Production-ready tajweed feedback badges.
 *
 * Design decisions:
 * - Tooltip rendered via React Portal into document.body — eliminates
 *   the hover gap / twitching caused by tooltip appearing above the trigger
 * - Tooltip stays open while hovering either trigger OR tooltip itself
 * - Uses mouse position for placement, not getBoundingClientRect scroll math
 * - Clean pill badge showing rule name inline, not just a dot
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type {
  WordTajweedStatus,
  TajweedViolation,
} from "@/hooks/useTajweedAnalysis";

// ── Rule metadata ──────────────────────────────────────────────────────────────

const RULE_META: Record<
  string,
  {
    label: string;
    arabic: string;
    color: string;
    guidance_correct: string;
    guidance_violation: string;
  }
> = {
  ghunna: {
    label: "Ghunna",
    arabic: "غنة",
    color: "#e74c3c",
    guidance_correct: "Good nasalisation — humming held correctly.",
    guidance_violation: "Hold a nasal hum for 2 counts through the nose.",
  },
  qalqalah: {
    label: "Qalqalah",
    arabic: "قلقلة",
    color: "#2ecc71",
    guidance_correct: "Good echo — bouncing release was clear.",
    guidance_violation:
      "Add a slight bouncing vibration when this letter has no vowel.",
  },
  madd: {
    label: "Madd",
    arabic: "مد",
    color: "#5dade2",
    guidance_correct: "Good prolongation — vowel held long enough.",
    guidance_violation:
      "Hold this vowel longer. The audio duration was too short.",
  },
  idgham: {
    label: "Idgham",
    arabic: "إدغام",
    color: "#1abc9c",
    guidance_correct: "Good merging — nun blended smoothly.",
    guidance_violation:
      "Merge the nun/tanwin into the next letter without separating.",
  },
  ikhfa: {
    label: "Ikhfa",
    arabic: "إخفاء",
    color: "#e67e22",
    guidance_correct: "Good concealment — light nasalisation applied.",
    guidance_violation:
      "Conceal the nun with a light nasal hum, don't pronounce it fully.",
  },
  iqlab: {
    label: "Iqlab",
    arabic: "إقلاب",
    color: "#a569bd",
    guidance_correct: "Good — noon correctly converted to meem sound.",
    guidance_violation:
      "Convert the noon to a meem sound (lips together) before ب.",
  },
  lam_shams: {
    label: "Lam Shams",
    arabic: "لام شمسية",
    color: "#d4a800",
    guidance_correct: "Good — lam correctly assimilated into the sun letter.",
    guidance_violation:
      "The lam is silent here — blend directly into the next letter.",
  },
  madd_2: {
    label: "Madd 2",
    arabic: "مد طبيعي",
    color: "#5dade2",
    guidance_correct: "Good — natural madd held for 2 counts.",
    guidance_violation: "Extend the vowel for 2 counts.",
  },
  madd_246: {
    label: "Madd ʿĀriḍ",
    arabic: "مد عارض",
    color: "#2e86c1",
    guidance_correct: "Good — paused correctly at 2, 4, or 6 counts.",
    guidance_violation:
      "At waqf, hold this vowel for at least 2 counts (4 or 6 is better).",
  },
  madd_munfasil: {
    label: "Madd Munfaṣil",
    arabic: "مد منفصل",
    color: "#1e8bc3",
    guidance_correct: "Good — separated madd held for 4–5 counts.",
    guidance_violation:
      "Hold this vowel for 4–5 counts before the hamza in the next word.",
  },
  madd_muttasil: {
    label: "Madd Muttaṣil",
    arabic: "مد متصل",
    color: "#1565c0",
    guidance_correct: "Good — connected madd held for 4–5 counts.",
    guidance_violation:
      "Hold this vowel for 4–5 counts — the hamza follows in the same word.",
  },
  madd_6: {
    label: "Madd Lāzim",
    arabic: "مد لازم",
    color: "#0a3d91",
    guidance_correct: "Good — obligatory madd held for 6 counts.",
    guidance_violation: "Must hold exactly 6 counts — this madd is obligatory.",
  },
};

// ── Portal tooltip ─────────────────────────────────────────────────────────────

interface TooltipProps {
  status: WordTajweedStatus;
  isDark: boolean;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function TajweedTooltip({
  status,
  isDark,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: TooltipProps) {
  const bg = isDark ? "hsl(160 18% 10%)" : "#ffffff";
  const border = isDark ? "hsl(160 12% 22%)" : "#e2e2e2";
  const textColor = isDark ? "hsl(44 20% 88%)" : "#1a1a1a";

  // Position: prefer above, fall back to below if not enough space
  const tooltipWidth = 260;
  const viewportWidth = window.innerWidth;
  const spaceAbove = anchorRect.top;
  const showBelow = spaceAbove < 160;

  let left = anchorRect.left + anchorRect.width / 2 - tooltipWidth / 2;
  left = Math.max(8, Math.min(left, viewportWidth - tooltipWidth - 8));

  const top = showBelow
    ? anchorRect.bottom + 8 + window.scrollY
    : anchorRect.top - 8 + window.scrollY;

  return createPortal(
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        top,
        left,
        width: tooltipWidth,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "12px 14px",
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)"
          : "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
        color: textColor,
        fontSize: 13,
        lineHeight: 1.5,
        direction: "ltr",
        textAlign: "left",
        zIndex: 9999,
        transform: showBelow ? "none" : "translateY(-100%)",
        pointerEvents: "auto",
      }}
    >
      {/* Arrow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          ...(showBelow
            ? {
                top: -6,
                borderBottom: `6px solid ${border}`,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
              }
            : {
                bottom: -6,
                borderTop: `6px solid ${border}`,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
              }),
          width: 0,
          height: 0,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          ...(showBelow
            ? {
                top: -5,
                borderBottom: `6px solid ${bg}`,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
              }
            : {
                bottom: -5,
                borderTop: `6px solid ${bg}`,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
              }),
          width: 0,
          height: 0,
        }}
      />

      {status.rules.map((rule, i) => {
        const meta = RULE_META[rule.rule] ?? RULE_META[rule.sub_type] ?? null;
        if (!meta) return null;
        const isViolation = !rule.correct;
        const isRuleUnverifiable = (rule as any).verifiable === false;
        const isRuleBorderline =
          !isViolation &&
          isRuleUnverifiable === false &&
          rule.confidence != null &&
          rule.confidence < 0.6;
        const stateColor = isViolation
          ? "#f39c12"
          : isRuleUnverifiable || isRuleBorderline
            ? "#7f8c8d"
            : "#2ecc71";

        return (
          <div
            key={i}
            style={{ marginBottom: i < status.rules.length - 1 ? 12 : 0 }}
          >
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: stateColor,
                  flexShrink: 0,
                  boxShadow: `0 0 6px ${stateColor}80`,
                }}
              />
              <span style={{ fontWeight: 600, color: meta.color }}>
                {meta.label}
              </span>
              <span
                style={{
                  fontFamily: "Amiri, serif",
                  fontSize: 15,
                  opacity: 0.7,
                }}
              >
                {meta.arabic}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 11,
                  fontWeight: 600,
                  color: stateColor,
                  background: `${stateColor}18`,
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                {isViolation
                  ? "IMPROVE"
                  : (rule as any).verifiable === false
                    ? "NOTE"
                    : rule.confidence != null && rule.confidence < 0.6
                      ? "BORDERLINE"
                      : "GOOD"}
              </span>
            </div>

            {/* Guidance */}
            <p style={{ opacity: 0.82, fontSize: 12, marginBottom: 6 }}>
              {isViolation ? meta.guidance_violation : meta.guidance_correct}
            </p>

            {/* Duration detail for madd */}
            {rule.rule != null &&
              rule.rule.startsWith("madd") &&
              rule.expected_duration != null && (
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.65,
                    marginBottom: 5,
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <span>
                    Expected: ≥{Math.round(rule.expected_duration * 1000)}ms
                  </span>
                  {rule.actual_duration != null && (
                    <span
                      style={{ color: isViolation ? "#f39c12" : "#2ecc71" }}
                    >
                      Actual: {Math.round(rule.actual_duration * 1000)}ms
                    </span>
                  )}
                </div>
              )}

            {/* Confidence bar */}
            {rule.confidence != null && (
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: isDark ? "hsl(160 10% 20%)" : "#ebebeb",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(rule.confidence * 100)}%`,
                    background: stateColor,
                    borderRadius: 2,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// ── Badge component ────────────────────────────────────────────────────────────

interface TajweedBadgeProps {
  status: WordTajweedStatus;
  isDark: boolean;
}

export function TajweedBadge({ status, isDark }: TajweedBadgeProps) {
  // ALL hooks must come before any early return (Rules of Hooks)
  const [visible, setVisible] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimer.current = setTimeout(() => setVisible(false), 80);
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // Early return AFTER all hooks
  if (status.rules.length === 0) return null;

  const hasViolation = status.has_violation;

  // 3-state badge:
  // AMBER  = has_violation (clearly too short)
  // GREEN  = verified good (verifiable=true, correct=true, confidence > 0.5)
  // GREY   = unverifiable (no timing data) or borderline (low confidence)
  const primaryRule = status.rules[0];
  const isUnverifiable = !primaryRule || !(primaryRule as any).verifiable;
  const isBorderline =
    !hasViolation &&
    primaryRule &&
    (primaryRule as any).verifiable &&
    primaryRule.confidence != null &&
    primaryRule.confidence < 0.6;
  const badgeColor = hasViolation
    ? isDark
      ? "#f39c12"
      : "#e67e22" // amber — needs practice
    : isUnverifiable || isBorderline
      ? isDark
        ? "#7f8c8d"
        : "#95a5a6" // grey — no verdict
      : isDark
        ? "#2ecc71"
        : "#27ae60"; // green — verified good

  // Build rule label for the badge
  const meta = primaryRule
    ? (RULE_META[primaryRule.rule] ?? RULE_META[primaryRule.sub_type])
    : null;
  const label = meta?.label ?? primaryRule?.rule ?? "";

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        verticalAlign: "middle",
        marginInlineStart: 3,
        cursor: "default",
        userSelect: "none",
      }}
    >
      {/* Colored pill */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          background: `${badgeColor}20`,
          border: `1px solid ${badgeColor}60`,
          borderRadius: 10,
          padding: "1px 5px",
          fontSize: 9,
          fontFamily: "IBM Plex Sans Arabic, sans-serif",
          fontWeight: 600,
          color: badgeColor,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          lineHeight: 1.4,
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            backgroundColor: badgeColor,
            flexShrink: 0,
          }}
        />
        {hasViolation
          ? `${label} ⚠`
          : isUnverifiable || isBorderline
            ? `${label} ·`
            : label}
      </span>

      {visible && anchorRect && (
        <TajweedTooltip
          status={status}
          isDark={isDark}
          anchorRect={anchorRect}
          onMouseEnter={show}
          onMouseLeave={hide}
        />
      )}
    </span>
  );
}

// ── Ayah score bar ─────────────────────────────────────────────────────────────

export function TajweedScoreBar({
  score,
  rulesChecked,
  violations,
  isDark,
}: {
  score: number | null;
  rulesChecked: number;
  violations: number;
  isDark: boolean;
}) {
  if (score === null || rulesChecked === 0) return null;

  const pct = Math.round(score * 100);
  const color = pct >= 85 ? "#2ecc71" : pct >= 65 ? "#f39c12" : "#e74c3c";
  const label =
    pct >= 85
      ? "Excellent"
      : pct >= 65
        ? "Good — review highlighted words"
        : "Needs work";

  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        background: isDark ? "hsl(160 18% 8%)" : "#f8f8f8",
        border: `1px solid ${isDark ? "hsl(160 10% 18%)" : "#e4e4e4"}`,
        fontSize: 12,
        fontFamily: "IBM Plex Sans Arabic, sans-serif",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          flexShrink: 0,
          border: `2px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          color,
          fontSize: 13,
        }}
      >
        {pct}
      </div>
      <div>
        <div
          style={{
            fontWeight: 600,
            color: isDark ? "hsl(44 20% 85%)" : "#111",
          }}
        >
          Tajweed Score
        </div>
        <div style={{ opacity: 0.6, fontSize: 11 }}>
          {label}
          {violations > 0 &&
            ` · ${violations} rule${violations > 1 ? "s" : ""} to review`}
        </div>
      </div>
      {/* Score bar */}
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          background: isDark ? "hsl(160 10% 20%)" : "#e0e0e0",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 2,
            width: `${pct}%`,
            background: color,
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}
