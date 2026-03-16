export type LocalbananaPromptLibraryEntry = {
  title: string;
  url: string;
  keywords: string[];
  subject: string;
  style: string;
  composition: string;
  environment: string;
  lighting: string;
  negative: string;
  search_text: string;
};

export type LocalbananaPromptBlock = {
  text: string;
  title: string;
  url: string;
  keywords: string[];
};

export type LocalbananaPromptBlockLibrary = Record<
  'subject' | 'style' | 'composition' | 'environment' | 'lighting' | 'negative',
  LocalbananaPromptBlock[]
>;

export type LocalbananaPromptLibrarySearchResult = {
  topMatches: Array<{
    title: string;
    url: string;
    score: number;
    keywords: string[];
  }>;
  blockMatches: {
    subject: LocalbananaPromptBlock[];
    style: LocalbananaPromptBlock[];
    composition: LocalbananaPromptBlock[];
    environment: LocalbananaPromptBlock[];
    lighting: LocalbananaPromptBlock[];
    negative: LocalbananaPromptBlock[];
  };
  styleHints: string[];
  compositionHints: string[];
  environmentHints: string[];
  lightingHints: string[];
  negativeHints: string[];
};

type SearchInput = {
  subject: string;
  style: string;
  composition: string;
  environment: string;
  emphasis: string;
  negatives: string;
  outputIntent: string;
};

type SemanticVector = Map<string, number>;

let libraryPromise: Promise<LocalbananaPromptLibraryEntry[]> | null = null;
let blockLibraryPromise: Promise<LocalbananaPromptBlockLibrary> | null = null;
const vectorCache = new Map<string, SemanticVector>();

function normalize(text: string) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function buildVector(text: string): SemanticVector {
  const normalized = normalize(text);
  const cached = vectorCache.get(normalized);
  if (cached) return cached;

  const vector: SemanticVector = new Map();
  const push = (token: string, weight = 1) => {
    if (!token) return;
    vector.set(token, (vector.get(token) ?? 0) + weight);
  };

  const compact = normalized.replace(/\s+/g, ' ');
  const noSpace = compact.replace(/\s/g, '');
  for (const token of tokenize(compact)) push(`w:${token}`, 2);
  for (let i = 0; i < noSpace.length - 2; i += 1) {
    push(`c:${noSpace.slice(i, i + 3)}`, 1);
  }

  vectorCache.set(normalized, vector);
  return vector;
}

function cosineSimilarity(a: SemanticVector, b: SemanticVector) {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of a.values()) aNorm += value * value;
  for (const value of b.values()) bNorm += value * value;
  for (const [key, value] of a.entries()) {
    const other = b.get(key);
    if (other) dot += value * other;
  }

  if (!aNorm || !bNorm) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function scoreTokens(queryTokens: string[], target: string, weight: number) {
  if (!queryTokens.length || !target) return 0;
  const haystack = normalize(target);
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += weight;
  }
  return score;
}

function dedupeTexts(values: string[], limit = 3) {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    picked.push(value.trim());
    if (picked.length >= limit) break;
  }
  return picked;
}

function rankBlocks(query: string, blocks: LocalbananaPromptBlock[], limit = 2) {
  const queryVector = buildVector(query);
  const queryTokens = tokenize(query);
  return blocks
    .map((block) => {
      const text = `${block.text} ${block.keywords.join(' ')} ${block.title}`;
      const lexical = scoreTokens(queryTokens, text, 3);
      const semantic = cosineSimilarity(queryVector, buildVector(text)) * 100;
      return { block, score: lexical + semantic };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.block);
}

export async function loadLocalbananaPromptLibrary() {
  if (!libraryPromise) {
    libraryPromise = fetch('/data/localbanana_prompt_index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load prompt library: ${res.status}`);
        return res.json() as Promise<LocalbananaPromptLibraryEntry[]>;
      })
      .catch((error) => {
        libraryPromise = null;
        throw error;
      });
  }
  return libraryPromise;
}

export async function loadLocalbananaPromptBlocks() {
  if (!blockLibraryPromise) {
    blockLibraryPromise = fetch('/data/localbanana_prompt_blocks.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load prompt blocks: ${res.status}`);
        return res.json() as Promise<LocalbananaPromptBlockLibrary>;
      })
      .catch((error) => {
        blockLibraryPromise = null;
        throw error;
      });
  }
  return blockLibraryPromise;
}

export async function searchLocalbananaPromptLibrary(input: SearchInput): Promise<LocalbananaPromptLibrarySearchResult> {
  const [library, blocks] = await Promise.all([loadLocalbananaPromptLibrary(), loadLocalbananaPromptBlocks()]);
  const subjectTokens = tokenize(input.subject);
  const styleTokens = tokenize(input.style);
  const compositionTokens = tokenize(input.composition);
  const environmentTokens = tokenize(input.environment);
  const emphasisTokens = tokenize(input.emphasis);
  const negativeTokens = tokenize(input.negatives);
  const outputTokens = tokenize(input.outputIntent);
  const queryText = [
    input.subject,
    input.style,
    input.composition,
    input.environment,
    input.emphasis,
    input.negatives,
    input.outputIntent,
  ]
    .filter(Boolean)
    .join(' | ');
  const queryVector = buildVector(queryText);
  const allTokens = Array.from(new Set([
    ...subjectTokens,
    ...styleTokens,
    ...compositionTokens,
    ...environmentTokens,
    ...emphasisTokens,
    ...negativeTokens,
    ...outputTokens,
  ]));

  const ranked = library
    .map((entry) => {
      const entryText = [
        entry.title,
        entry.keywords.join(' '),
        entry.subject,
        entry.style,
        entry.composition,
        entry.environment,
        entry.lighting,
        entry.negative,
        entry.search_text,
      ]
        .filter(Boolean)
        .join(' | ');

      let lexical = 0;
      lexical += scoreTokens(subjectTokens, `${entry.title} ${entry.subject}`, 7);
      lexical += scoreTokens(subjectTokens, entry.keywords.join(' '), 5);
      lexical += scoreTokens(styleTokens, `${entry.style} ${entry.lighting}`, 5);
      lexical += scoreTokens(compositionTokens, entry.composition, 5);
      lexical += scoreTokens(environmentTokens, `${entry.environment} ${entry.lighting}`, 5);
      lexical += scoreTokens(emphasisTokens, entry.search_text, 2);
      lexical += scoreTokens(outputTokens, `${entry.title} ${entry.search_text}`, 2);
      lexical += scoreTokens(negativeTokens, entry.negative, 4);
      lexical += scoreTokens(allTokens, entry.search_text, 1);

      const semantic = cosineSimilarity(queryVector, buildVector(entryText)) * 100;
      const score = lexical + semantic;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const topMatches = ranked.slice(0, 3).map(({ entry, score }) => ({
    title: entry.title,
    url: entry.url,
    score,
    keywords: entry.keywords.slice(0, 8),
  }));

  const subjectQuery = [input.subject, input.emphasis, input.outputIntent].filter(Boolean).join(' | ');
  const styleQuery = [input.subject, input.style, input.outputIntent].filter(Boolean).join(' | ');
  const compositionQuery = [input.subject, input.composition, input.outputIntent].filter(Boolean).join(' | ');
  const environmentQuery = [input.subject, input.environment, input.outputIntent].filter(Boolean).join(' | ');
  const lightingQuery = [input.subject, input.style, input.environment, input.outputIntent].filter(Boolean).join(' | ');
  const negativeQuery = [input.subject, input.negatives, input.outputIntent].filter(Boolean).join(' | ');

  const blockMatches = {
    subject: rankBlocks(subjectQuery, blocks.subject),
    style: rankBlocks(styleQuery, blocks.style),
    composition: rankBlocks(compositionQuery, blocks.composition),
    environment: rankBlocks(environmentQuery, blocks.environment),
    lighting: rankBlocks(lightingQuery, blocks.lighting),
    negative: rankBlocks(negativeQuery, blocks.negative),
  };

  return {
    topMatches,
    blockMatches,
    styleHints: dedupeTexts(blockMatches.style.map((item) => item.text)),
    compositionHints: dedupeTexts(blockMatches.composition.map((item) => item.text)),
    environmentHints: dedupeTexts([...blockMatches.environment, ...blockMatches.lighting].map((item) => item.text)),
    lightingHints: dedupeTexts(blockMatches.lighting.map((item) => item.text)),
    negativeHints: dedupeTexts(blockMatches.negative.map((item) => item.text)),
  };
}
