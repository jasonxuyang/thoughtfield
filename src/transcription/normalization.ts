import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its;
/** Reused for isOOV checks (API is on Document). */
const oovProbe = nlp.readDoc("x");

const FILLERS = new Set([
  "um",
  "uh",
  "erm",
  "hmm",
  "like",
  "you know",
  "basically",
  "actually",
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "when",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "to",
  "from",
  "up",
  "down",
  "in",
  "out",
  "on",
  "off",
  "over",
  "under",
  "again",
  "further",
  "once",
  "here",
  "there",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "can",
  "will",
  "just",
  "don",
  "should",
  "now",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "ours",
  "ourselves",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "of",
  "as",
  "until",
  "while",
  "because",
]);

/** Negation words must be kept. */
const NEGATION_ALLOWLIST = new Set(["not", "no", "never", "without"]);

const ONE_CHAR_ALLOWLIST = new Set(["i", "a"]);

const TECH_CANONICAL: Record<string, string> = {
  "web gpu": "webgpu",
  webgpu: "webgpu",
  "web-gpu": "webgpu",
  javascript: "javascript",
  typescript: "typescript",
  wasm: "wasm",
  webassembly: "wasm",
  onnx: "onnx",
  whisper: "whisper",
  pixijs: "pixijs",
  "pixi js": "pixijs",
};

const lemmaCache = new Map<string, string>();

function stripPunctuation(token: string): string {
  return token.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/gi, "");
}

/**
 * Attribute for the token matching `want` (or the last word-like token).
 * Skips frame words like "to" in `to hiding`.
 */
function tokenAttr(
  text: string,
  want: string,
  which: "normal" | "lemma",
): string | null {
  const doc = nlp.readDoc(text);
  const tokens = doc.tokens();
  const values = tokens.out(its.value) as string[];
  // wink model addon typings disagree with TokenItsFunction — runtime is fine.
  const attrFn = which === "normal" ? its.normal : its.lemma;
  const attrs = tokens.out(attrFn as typeof its.value) as string[];
  const wantLower = want.toLowerCase();
  let fallback: string | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value || /^[^a-z0-9]+$/i.test(value)) {
      continue;
    }
    const attrValue = attrs[i] ?? null;
    if (value.toLowerCase() === wantLower) {
      return attrValue;
    }
    fallback = attrValue;
  }
  return fallback;
}

/**
 * Colloquial g-drop (hidin / talkin) → -ing when the bare form is OOV but
 * the -ing form is in-vocabulary (avoids cabin → cab).
 */
function expandColloquialIng(token: string): string {
  if (!/^[a-z]{3,}in$/.test(token)) {
    return token;
  }
  if (!oovProbe.isOOV(token)) {
    return token;
  }
  const expanded = `${token}g`;
  if (oovProbe.isOOV(expanded)) {
    return token;
  }
  return expanded;
}

/**
 * Lemmatize with wink. Verbal frame helps isolated -ing forms that would
 * otherwise tag as nouns (hiding → hide).
 */
function lemmatize(token: string): string {
  const cached = lemmaCache.get(token);
  if (cached !== undefined) {
    return cached;
  }

  const form = expandColloquialIng(token);
  // wink normal maps some colloquialisms (goin → going) before lemma.
  const normal = tokenAttr(form, form, "normal") ?? form;
  const needsVerbHint =
    normal.endsWith("ing") ||
    normal.endsWith("ed") ||
    normal !== form;

  const lemma = needsVerbHint
    ? (tokenAttr(`to ${normal}`, normal, "lemma") ?? normal)
    : (tokenAttr(normal, normal, "lemma") ?? normal);

  lemmaCache.set(token, lemma);
  return lemma;
}

export function normalizeToken(raw: string): string | null {
  const lowered = raw.toLowerCase().trim();
  if (!lowered) {
    return null;
  }

  if (FILLERS.has(lowered)) {
    return null;
  }

  const techKey = lowered.replace(/\s+/g, " ");
  if (TECH_CANONICAL[techKey]) {
    return TECH_CANONICAL[techKey]!;
  }

  const stripped = stripPunctuation(lowered);
  if (!stripped) {
    return null;
  }

  if (FILLERS.has(stripped)) {
    return null;
  }

  if (TECH_CANONICAL[stripped]) {
    return TECH_CANONICAL[stripped]!;
  }

  if (NEGATION_ALLOWLIST.has(stripped)) {
    return stripped;
  }

  if (STOP_WORDS.has(stripped)) {
    return null;
  }

  if (/^\d+$/.test(stripped)) {
    return null;
  }

  const lemma = lemmatize(stripped).toLowerCase();

  if (lemma.length === 1 && !ONE_CHAR_ALLOWLIST.has(lemma)) {
    return null;
  }

  if (!lemma || /^\d+$/.test(lemma)) {
    return null;
  }

  // Lemma can land on a stop word (e.g. doing → do).
  if (STOP_WORDS.has(lemma) && !NEGATION_ALLOWLIST.has(lemma)) {
    return null;
  }

  return lemma;
}

export function tokenizeTranscript(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeTranscriptWords(
  text: string,
): Array<{ raw: string; normalized: string }> {
  const tokens = tokenizeTranscript(text);
  const results: Array<{ raw: string; normalized: string }> = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i]!;
    const next = tokens[i + 1];

    if (next) {
      const multi = `${raw.toLowerCase()} ${next.toLowerCase()}`;
      const multiNorm = normalizeToken(multi);
      if (
        multiNorm &&
        TECH_CANONICAL[multi.replace(/\s+/g, " ").toLowerCase()]
      ) {
        results.push({ raw: `${raw} ${next}`, normalized: multiNorm });
        i += 1;
        continue;
      }
    }

    const normalized = normalizeToken(raw);
    if (normalized) {
      results.push({ raw, normalized });
    }
  }

  return results;
}
