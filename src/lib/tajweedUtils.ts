/**
 * tajweedUtils.ts
 *
 * Classifies Quran words by their primary tajweed rule and returns a colour.
 * Uses the standard Tajweed Quran colour scheme (Dar Al-Ma'rifah / King Fahd print).
 *
 * Colour assignments:
 *  Red        – Ghunna (nasalisation): nun/mim with shadda, ikhfa, idgham with ghunna
 *  Green      – Qalqalah: ق ط ب ج د
 *  Blue       – Madd (prolongation): alef/waw/ya after long vowel
 *  Orange     – Ikhfa Shafawi / Idgham Shafawi (mim sakin rules)
 *  Teal/Cyan  – Idgham bila ghunna (lam/ra after nun sakin/tanwin)
 *  Purple     – Qalb (iqlab): nun sakin/tanwin before ba
 *  None       – Regular letters (inherits recitation state colour)
 */

export type TajweedRule =
  | 'ghunna'         // red     – nasalisation
  | 'qalqalah'       // green   – echoing bounce
  | 'madd'           // blue    – prolongation
  | 'ikhfa_shafawi'  // orange  – mim rules
  | 'idgham_bila'    // teal    – merging without nasalisation
  | 'iqlab'          // purple  – nun→mim before ba
  | null;            // no specific rule

export interface TajweedInfo {
  rule: TajweedRule;
  color: string;       // Tailwind text colour class
  label: string;       // English name
  arabic: string;      // Arabic name
  description: string; // Brief explanation
}

export const TAJWEED_RULES: Record<NonNullable<TajweedRule>, TajweedInfo> = {
  ghunna: {
    rule: 'ghunna',
    color: 'tajweed-ghunna',
    label: 'Ghunna',
    arabic: 'غنة',
    description: 'Nasalisation — a humming sound held for 2 counts through the nose. Occurs on ن or م with a shaddah, or in Ikhfa and Idgham with ghunna.',
  },
  qalqalah: {
    rule: 'qalqalah',
    color: 'tajweed-qalqalah',
    label: 'Qalqalah',
    arabic: 'قلقلة',
    description: 'Echoing bounce — a slight vibration/echo when these letters are saakin (without vowel): ق ط ب ج د. Stronger at a waqf (pause).',
  },
  madd: {
    rule: 'madd',
    color: 'tajweed-madd',
    label: 'Madd',
    arabic: 'مد',
    description: 'Prolongation — extending the vowel sound. Natural madd is 2 counts; connected/obligatory madd can be 4–6 counts depending on context.',
  },
  ikhfa_shafawi: {
    rule: 'ikhfa_shafawi',
    color: 'tajweed-ikhfa',
    label: 'Ikhfa Shafawi',
    arabic: 'إخفاء شفوي',
    description: 'Labial concealment — when مْ (mim sakin) is followed by ب, the mim is hidden with ghunna for 2 counts, lips slightly parted.',
  },
  idgham_bila: {
    rule: 'idgham_bila',
    color: 'tajweed-idgham',
    label: 'Idgham Bila Ghunna',
    arabic: 'إدغام بلا غنة',
    description: 'Merging without nasalisation — when nun sakin or tanwin is followed by ل or ر, it merges completely with no nasal sound.',
  },
  iqlab: {
    rule: 'iqlab',
    color: 'tajweed-iqlab',
    label: 'Iqlab',
    arabic: 'إقلاب',
    description: 'Conversion — when nun sakin or tanwin is followed by ب, the nun changes to a mim sound with ghunna for 2 counts.',
  },
};

// ── Tajweed detection ─────────────────────────────────────────────────────────

// Unicode ranges used in detection
const NUN = '\u0646';       // ن
const MIM = '\u0645';       // م
const SHADDA = '\u0651';    // ّ  (shaddah)
const SUKUN = '\u0652';     // ْ  (sukun)
const TANWIN_FATH = '\u064B'; // ً
const TANWIN_KASR = '\u064D'; // ٍ
const TANWIN_DAMM = '\u064C'; // ٌ
const BA = '\u0628';        // ب
const LAM = '\u0644';       // ل
const RA = '\u0631';        // ر
const ALEF = '\u0627';      // ا
const WAW = '\u0648';       // و
const YA = '\u064A';        // ي

const QALQALAH_LETTERS = new Set(['\u0642', '\u0637', '\u0628', '\u062C', '\u062F']); // ق ط ب ج د

// Long vowel indicators (alef, waw, ya after a vowelled letter) → madd
const MADD_LETTERS = new Set([ALEF, WAW, YA]);

// Tanwin chars
const TANWIN = new Set([TANWIN_FATH, TANWIN_KASR, TANWIN_DAMM]);

/**
 * Determine the primary tajweed rule for a word, given the next word for context.
 * Returns null if no special rule applies.
 */
export function getTajweedRule(word: string, nextWord?: string): TajweedRule {
  const chars = [...word]; // proper Unicode char iteration

  // ── 1. Ghunna: ن or م with shaddah ──────────────────────────────────────
  for (let i = 0; i < chars.length - 1; i++) {
    if ((chars[i] === NUN || chars[i] === MIM) && chars[i + 1] === SHADDA) {
      return 'ghunna';
    }
  }

  // ── 2. Iqlab: tanwin or nun sakin before ب (check next word too) ─────────
  const lastChar = chars[chars.length - 1];
  const secondLast = chars[chars.length - 2];
  const hasTanwin = TANWIN.has(lastChar);
  const hasNunSakin = secondLast === NUN && lastChar === SUKUN;

  if (hasTanwin || hasNunSakin) {
    const nextFirst = nextWord ? [...nextWord][0] : '';
    if (nextFirst === BA) return 'iqlab';
  }

  // ── 3. Ikhfa Shafawi: مْ before ب ────────────────────────────────────────
  if (hasNunSakin && secondLast === MIM) {
    const nextFirst = nextWord ? [...nextWord][0] : '';
    if (nextFirst === BA) return 'ikhfa_shafawi';
  }

  // ── 4. Idgham bila ghunna: tanwin/nun sakin before ل or ر ────────────────
  if (hasTanwin || hasNunSakin) {
    const nextFirst = nextWord ? [...nextWord][0] : '';
    if (nextFirst === LAM || nextFirst === RA) return 'idgham_bila';
  }

  // ── 5. Qalqalah: qalqalah letter with sukun ──────────────────────────────
  for (let i = 0; i < chars.length - 1; i++) {
    if (QALQALAH_LETTERS.has(chars[i]) && chars[i + 1] === SUKUN) {
      return 'qalqalah';
    }
  }
  // At end of word (waqf position): last base letter is qalqalah
  for (let i = chars.length - 1; i >= 0; i--) {
    if (QALQALAH_LETTERS.has(chars[i])) { return 'qalqalah'; break; }
    if (chars[i] > '\u0600') break; // stop at non-diacritic
  }

  // ── 6. Madd: word contains a madd letter ─────────────────────────────────
  for (const ch of chars) {
    if (MADD_LETTERS.has(ch)) return 'madd';
  }

  return null;
}

/**
 * Get full TajweedInfo for a word (or null if no rule).
 */
export function getWordTajweedInfo(word: string, nextWord?: string): TajweedInfo | null {
  const rule = getTajweedRule(word, nextWord);
  if (!rule) return null;
  return TAJWEED_RULES[rule];
}
