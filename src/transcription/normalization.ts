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

const IRREGULAR_LEMMAS: Record<string, string> = {
  running: "run",
  ran: "run",
  models: "model",
  browsers: "browser",
  children: "child",
  men: "man",
  women: "woman",
  better: "good",
  best: "good",
  worse: "bad",
  worst: "bad",
  going: "go",
  went: "go",
  doing: "do",
  did: "do",
  having: "have",
  had: "have",
  making: "make",
  made: "make",
  taking: "take",
  took: "take",
  coming: "come",
  came: "come",
  seeing: "see",
  saw: "see",
  getting: "get",
  got: "get",
  knowing: "know",
  knew: "know",
  thinking: "think",
  thought: "think",
  saying: "say",
  said: "say",
  telling: "tell",
  told: "tell",
  leaving: "leave",
  left: "leave",
  feeling: "feel",
  felt: "feel",
  becoming: "become",
  became: "become",
  beginning: "begin",
  began: "begin",
  keeping: "keep",
  kept: "keep",
  holding: "hold",
  held: "hold",
  writing: "write",
  wrote: "write",
  reading: "read",
  speaking: "speak",
  spoke: "speak",
  hearing: "hear",
  heard: "hear",
  finding: "find",
  found: "find",
  giving: "give",
  gave: "give",
  using: "use",
  used: "use",
};

function stripPunctuation(token: string): string {
  return token.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/gi, "");
}

function lemmatize(token: string): string {
  if (IRREGULAR_LEMMAS[token]) {
    return IRREGULAR_LEMMAS[token]!;
  }

  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("ves") && token.length > 4) {
    return `${token.slice(0, -3)}f`;
  }

  if (
    token.endsWith("sses") ||
    token.endsWith("xes") ||
    token.endsWith("zes") ||
    token.endsWith("ches") ||
    token.endsWith("shes")
  ) {
    return token.slice(0, -2);
  }

  if (token.endsWith("ing") && token.length > 5) {
    const stem = token.slice(0, -3);
    if (stem.length >= 3 && stem.at(-1) === stem.at(-2)) {
      return stem.slice(0, -1);
    }
    return stem;
  }

  if (token.endsWith("ed") && token.length > 4) {
    // Silent-e past forms: related → relate (not relat), created → create.
    if (
      token.endsWith("ated") ||
      token.endsWith("ited") ||
      token.endsWith("uted") ||
      token.endsWith("oted") ||
      token.endsWith("ived") ||
      token.endsWith("ized") ||
      token.endsWith("ised") ||
      token.endsWith("aced") ||
      token.endsWith("iced") ||
      token.endsWith("uced") ||
      token.endsWith("osed") ||
      token.endsWith("ased") ||
      token.endsWith("amed") ||
      token.endsWith("imed") ||
      token.endsWith("umed")
    ) {
      return token.slice(0, -1);
    }
    const stem = token.slice(0, -2);
    if (stem.length >= 3 && stem.at(-1) === stem.at(-2)) {
      return stem.slice(0, -1);
    }
    return stem;
  }

  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
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

  const lemma = lemmatize(stripped);

  if (lemma.length === 1 && !ONE_CHAR_ALLOWLIST.has(lemma)) {
    return null;
  }

  if (!lemma || /^\d+$/.test(lemma)) {
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
      if (multiNorm && TECH_CANONICAL[multi.replace(/\s+/g, " ").toLowerCase()]) {
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
