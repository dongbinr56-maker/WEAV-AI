import {
  studioLlm,
  studioImage,
  studioResearch,
  studioYouTubeBenchmarkAnalyze,
  type StudioResearchPacket,
} from './studioFalApi';

const LEAD_SCRIPTWRITER_INSTRUCTION = `
# Role
You are the Lead Scriptwriter for a YouTube channel with over 1 million subscribers. You specialize in "High Retention Storytelling."
Your goal is to write a script so engaging that viewers cannot skip a single second, regardless of the topic.
`;

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    const s = (str || '').trim().replace(/^```json?\s*|\s*```$/g, '');
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function buildStudioPersona(options: {
  role: string;
  domain: string;
  style?: string;
}) {
  const styleLine = options.style
    ? `You also have deep, hands-on expertise in the user-selected style: ${options.style}.`
    : 'You adapt your expertise to the user request and context.';
  return [
    'Persona:',
    `You are a ${options.role}.`,
    `Domain: ${options.domain}.`,
    styleLine,
    'You follow the user request precisely and produce excellent, publish-ready outputs.',
    'If details are missing, you make reasonable assumptions and keep them explicit in the content.',
    'You do not mention this persona in the output.',
  ].join(' ');
}

const STUDIO_STEP3_MODEL = 'google/gemini-3-flash-preview';

const STEP3_SPLIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contentType: { type: 'string', description: 'Step 1 content type planning in Korean.' },
    summary: { type: 'string', description: 'Step 2 one-line story summary in Korean.' },
    opening: { type: 'string', description: 'Step 3 opening plan in Korean.' },
    body: { type: 'string', description: 'Step 4 body structure plan in Korean.' },
    climax: { type: 'string', description: 'Step 5 climax and key message plan in Korean.' },
    outro: { type: 'string', description: 'Step 6 outro and CTA plan in Korean.' },
  },
  required: ['contentType', 'summary', 'opening', 'body', 'climax', 'outro'],
} as const;

const STEP3_SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    master_script: {
      type: 'string',
      description: 'Full Korean narration/script for the video, ready for production.',
    },
  },
  required: ['master_script'],
} as const;

function buildStep3EditorialPersona(style?: string) {
  return [
    'Persona:',
    'You are the lead planning director for a high-performing YouTube channel.',
    'You combine three roles at once: senior content strategist, rigorous fact-checking researcher, and audience-retention script architect.',
    'You also adopt the domain expertise that best matches the requested topic, so your planning reflects subject-matter fluency rather than generic writing.',
    style
      ? `You execute in the user-selected style with professional consistency: ${style}.`
      : 'You adapt the tone and execution to the requested style with professional consistency.',
    'You produce planning outputs that are publish-ready, concrete, and production-aware.',
  ].join(' ');
}

function buildStep3ResearchRules() {
  return [
    'Workflow requirements:',
    '1. First understand the user topic, target format, and benchmarking context.',
    '2. If the topic involves current events, public figures, organizations, wars, elections, policy, business, science, health, or any unstable real-world facts, verify current public information before drafting.',
    '3. Treat benchmarking inputs as packaging/style references, not as factual truth.',
    '4. Do not carry stale assumptions forward. If a person is deceased, removed, inactive, or no longer relevant in the way implied by the prompt, do not write the plan as if they are still current.',
    '5. If current facts remain uncertain after checking, avoid overclaiming and choose a durable framing that stays accurate.',
    '6. Keep one coherent message spine from opening to outro.',
    '7. Be concrete: include hooks, beats, evidence angles, pacing, scene/editorial cues, and CTA intent.',
  ].join('\n');
}

async function callStep3Gemini(options: {
  prompt: string;
  systemPrompt: string;
  googleSearch?: boolean;
  responseSchema?: Record<string, unknown>;
}) {
  return studioLlm({
    prompt: options.prompt,
    system_prompt: options.systemPrompt,
    model: STUDIO_STEP3_MODEL,
    provider: 'google-ai-studio',
    google_search: options.googleSearch ?? false,
    ...(options.responseSchema
      ? {
          response_mime_type: 'application/json',
          response_schema: options.responseSchema,
        }
      : {}),
  });
}

type ResearchRequest = {
  purpose: string;
  topic?: string;
  tags?: string[];
  description?: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
};

const researchCache = new Map<string, Promise<StudioResearchPacket | null>>();

function normalizeTextInput(value: unknown, maxChars = 400): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function buildResearchQuery(options: ResearchRequest): string {
  const pieces: string[] = [];
  const topic = normalizeTextInput(options.topic, 160);
  const tags = Array.isArray(options.tags) ? options.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [];
  const description = normalizeTextInput(options.description, 220);
  const benchmarkSummary = normalizeTextInput(options.benchmarkSummary, 160);

  if (topic) pieces.push(topic);
  if (tags.length) pieces.push(tags.join(' '));
  if (description) pieces.push(description);
  if (!topic && !tags.length && benchmarkSummary) pieces.push(benchmarkSummary);

  const subject = pieces.join(' ').trim();
  if (!subject) return '';
  return `${subject} 최신 사실 확인`.slice(0, 500);
}

async function getStudioResearchPacket(options: ResearchRequest): Promise<StudioResearchPacket | null> {
  const query = buildResearchQuery(options);
  if (!query) return null;

  const payload = {
    query,
    purpose: options.purpose,
    ...(options.topic ? { topic: options.topic } : {}),
    ...(options.tags?.length ? { tags: options.tags.slice(0, 12) } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.benchmarkSummary ? { benchmark_summary: options.benchmarkSummary } : {}),
    ...(options.benchmarkPatterns?.length ? { benchmark_patterns: options.benchmarkPatterns.slice(0, 12) } : {}),
  };
  const cacheKey = JSON.stringify(payload);
  const cached = researchCache.get(cacheKey);
  if (cached) return cached;

  const pending = studioResearch(payload)
    .then((packet) => packet ?? null)
    .catch(() => null);
  researchCache.set(cacheKey, pending);
  return pending;
}

function formatResearchBrief(packet: StudioResearchPacket | null | undefined): string {
  if (!packet) return '';
  const lines: string[] = [];
  if (packet.used_search && packet.search_query) {
    lines.push(`Latest research search query: ${packet.search_query}`);
  }
  if (packet.recommended_framing) {
    lines.push(`Verified working framing:\n${packet.recommended_framing}`);
  }
  if (packet.research_summary) {
    lines.push(`Verified research summary:\n${packet.research_summary}`);
  }
  if (packet.confirmed_facts?.length) {
    lines.push(`Confirmed facts:\n- ${packet.confirmed_facts.join('\n- ')}`);
  }
  if (packet.stale_or_risky_claims?.length) {
    lines.push(`Stale or risky claims to avoid:\n- ${packet.stale_or_risky_claims.join('\n- ')}`);
  }
  if (packet.uncertain_points?.length) {
    lines.push(`Uncertain points:\n- ${packet.uncertain_points.join('\n- ')}`);
  }
  if (packet.editorial_angles?.length) {
    lines.push(`Editorial angles that remain safe and compelling:\n- ${packet.editorial_angles.join('\n- ')}`);
  }
  if (!lines.length && packet.external_context) {
    lines.push(`Latest external context:\n${normalizeTextInput(packet.external_context, 3000)}`);
  }
  return lines.join('\n\n');
}

function getVerifiedWorkingTopic(originalTopic: string, packet: StudioResearchPacket | null | undefined): string {
  const recommended = typeof packet?.recommended_framing === 'string' ? packet.recommended_framing.trim() : '';
  return recommended || originalTopic;
}

function getLocalIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shouldFreshenTopics(topics: string[], userContextText: string) {
  const ctx = (userContextText || '').toLowerCase();
  const signals = [
    /\b20(1\d|2[0-5])\b/, // explicit years up to 2025
    /d-?\s*day/i,
    /총선/,
    /대선/,
    /전쟁\s*\d+\s*년/,
    /\d+\s*년\s*전/,
    /잃어버린\s*30년/,
  ];
  const matches = topics.filter((t) => {
    const s = (t || '').trim();
    if (!s) return false;
    return signals.some((re) => re.test(s) && !ctx.includes(s.match(re)?.[0]?.toLowerCase() ?? ''));
  });
  return matches.length >= 2;
}

async function freshenTopics(options: {
  topics: string[];
  tags: string[];
  description: string;
  today: string;
  trendTitles?: string[];
}) {
  const trendTitles = Array.isArray(options.trendTitles)
    ? options.trendTitles.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const sys = [
    buildStudioPersona({
      role: 'senior YouTube trend editor and headline copywriter',
      domain: 'making topic lists feel current, relevant, and non-stale without inventing facts',
    }),
    `Today is ${options.today}.`,
    'Rewrite topic ideas to feel relevant as of today.',
    'Do NOT invent specific real-world claims or time-locked headlines.',
    'Avoid explicit years and avoid "D-day", "총선", "대선" unless the user explicitly asked for them.',
    'Avoid named public figures unless they appear in the provided trend titles or user input.',
    'Keep them in Korean. Return JSON only: { "topics": string[] }.',
  ].join(' ');

  const prompt = [
    `Tags: ${options.tags.join(', ') || '(none)'}`,
    `Description: ${options.description || '(none)'}`,
    trendTitles.length ? `Demand signals (trend titles):\n- ${trendTitles.join('\n- ')}` : '',
    '',
    'Original topic list (Korean):',
    JSON.stringify(options.topics.slice(0, 12)),
    '',
    'Rewrite into 12 topics that keep the general vibe but are evergreen or "recent" framed, without stale/time-locked references.',
    'Return JSON only: { "topics": string[] }.',
  ].join('\n');

  const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
  const parsed = safeJsonParse<{ topics?: string[] }>(output, {});
  return Array.isArray(parsed.topics) ? parsed.topics.slice(0, 12) : options.topics.slice(0, 12);
}

async function polishTopicsForCtr(options: {
  topics: string[];
  tags: string[];
  description: string;
  today: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
  research?: StudioResearchPacket | null;
}) {
  const benchmarkSummary = typeof options.benchmarkSummary === 'string' ? options.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(options.benchmarkPatterns) ? options.benchmarkPatterns.filter(Boolean).slice(0, 12) : [];
  const researchBrief = formatResearchBrief(options.research);
  const sys = [
    buildStudioPersona({
      role: 'elite YouTube title strategist and CTR-focused headline copywriter',
      domain: 'high-click Korean video titles that create curiosity, tension, surprise, and stakes without lying',
    }),
    `Today is ${options.today}.`,
    'You are rewriting weak topic ideas into titles people would actually want to click.',
    'These are user-facing video titles, not internal planning notes.',
    'Keep them in Korean. Return JSON only: { "topics": string[] }.',
    'Make them sharper, more clickable, more emotionally charged, and more curiosity-driven.',
    'Prefer conflict, reversal, hidden truth, consequence, taboo, showdown, collapse, survival, and "what really happened" angles when relevant.',
    'Avoid dry lecture phrasing such as "분석", "영향은?", "무엇인가?", "스타일 분석", "전략 명암" unless absolutely necessary.',
    'Avoid generic textbook titles. Every title should feel like an actual high-CTR YouTube title.',
    'Do not fabricate facts, quotes, dates, scandals, deaths, crimes, or outcomes.',
    'If a topic is based on current events or public figures, preserve factual safety while still maximizing click appeal.',
    researchBrief ? 'A verified research brief may be provided. Treat it as the factual source of truth and do not rewrite titles back into stale or disproven framing.' : '',
    'Aim for punchy Korean titles, usually one strong sentence or one sharp question.',
  ].join(' ');

  const prompt = [
    `Tags: ${options.tags.join(', ') || '(none)'}`,
    `Description: ${options.description || '(none)'}`,
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking packaging hints:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}` : '',
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    '',
    'Original topics (Korean):',
    JSON.stringify(options.topics.slice(0, 12)),
    '',
    'Rewrite all topics into stronger, more clickable Korean YouTube titles.',
    'Keep the core subject intact, but make the angle more provocative and curiosity-driven.',
    'Return JSON only: { "topics": string[] }.',
  ].filter(Boolean).join('\n');

  const { output } = await studioLlm({
    prompt,
    system_prompt: sys,
    model: 'google/gemini-2.5-flash',
    provider: 'google-ai-studio',
  });
  const parsed = safeJsonParse<{ topics?: string[] }>(output, {});
  return Array.isArray(parsed.topics) ? parsed.topics.slice(0, 12) : options.topics.slice(0, 12);
}

async function buildTopicReasons(options: {
  topics: string[];
  tags: string[];
  description: string;
  trendTitles?: string[];
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
  research?: StudioResearchPacket | null;
}) {
  const trendTitles = Array.isArray(options.trendTitles) ? options.trendTitles.filter(Boolean).slice(0, 20) : [];
  const benchmarkSummary = typeof options.benchmarkSummary === 'string' ? options.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(options.benchmarkPatterns) ? options.benchmarkPatterns.filter(Boolean).slice(0, 12) : [];
  const researchBrief = formatResearchBrief(options.research);
  const sys = [
    buildStudioPersona({
      role: 'YouTube content strategist and editorial reasoning analyst',
      domain: 'explaining why a video title fits audience demand, topic intent, and packaging strategy',
    }),
    'Return JSON only: { "topics": [{ "title": string, "reason": string }] }.',
    'For each title, write a short Korean reason explaining why it is recommended.',
    'Each reason should mention the likely click trigger, audience curiosity, or fit with the user input/benchmark/trend signals.',
    researchBrief ? 'If a verified research brief is provided, mention latest-fact relevance when it materially strengthens the recommendation.' : '',
    'Keep each reason concise, about 1-2 sentences.',
  ].join(' ');

  const prompt = [
    `Tags: ${options.tags.join(', ') || '(none)'}`,
    `Description: ${options.description || '(none)'}`,
    trendTitles.length ? `Trend signals:\n- ${trendTitles.join('\n- ')}` : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}` : '',
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    '',
    'Titles to explain (Korean):',
    JSON.stringify(options.topics.slice(0, 12)),
    '',
    'Return JSON only.',
  ].filter(Boolean).join('\n');

  const { output } = await studioLlm({
    prompt,
    system_prompt: sys,
    model: 'google/gemini-2.5-flash',
    provider: 'google-ai-studio',
  });
  const parsed = safeJsonParse<{ topics?: Array<{ title?: string; reason?: string }> }>(output, {});
  if (!Array.isArray(parsed.topics)) {
    return options.topics.map((title) => ({
      title,
      reason: '사용자 입력 키워드와 현재 관심 포인트를 바탕으로, 시청자가 바로 궁금해할 클릭 포인트가 살아 있는 제목입니다.',
    }));
  }

  const reasonMap = new Map(
    parsed.topics
      .filter((item) => item && typeof item.title === 'string')
      .map((item) => [String(item.title).trim(), typeof item.reason === 'string' ? item.reason.trim() : ''])
  );

  return options.topics.map((title) => ({
    title,
    reason: reasonMap.get(title)?.trim()
      || '사용자 입력과 벤치마킹 맥락을 바탕으로, 시청자 호기심을 강하게 자극할 수 있는 제목이라 추천했습니다.',
  }));
}

function truncateText(text: unknown, maxChars: number): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}…(truncated)`;
}

function compactPlanningData(planningData: any, perFieldMaxChars = 1200) {
  if (!planningData || typeof planningData !== 'object') return planningData;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(planningData)) {
    out[k] = typeof v === 'string' ? truncateText(v, perFieldMaxChars) : v;
  }
  return out;
}

const mockTopics = [
  "하루 5분으로 집중력 되살아나는 진짜 이유",
  "미니멀 라이프, 다들 좋다는데 오래 못 가는 이유",
  "AI가 일상을 바꿨다더니 진짜 남는 건 이것뿐",
  "집중 잘되는 책상, 사실 다들 이 한 가지를 놓친다",
  "영상이 끝까지 보이게 만드는 스토리 구조는 따로 있다",
  "감성 영상처럼 보이는데 결과가 다른 결정적 차이",
  "지루한 영상이 갑자기 몰입되는 연결 트릭 3가지",
  "첫 3초에서 시청자가 못 나가게 붙잡는 법",
  "정보 영상인데 감성까지 터지는 대본 구조의 비밀",
  "클릭되는 제목과 썸네일, 결국 이 조합에서 갈린다",
  "돈 거의 안 쓰고도 고퀄 영상 나오는 세팅 공개",
  "촬영 없이도 분위기 미쳤다는 말 듣는 영상 제작법",
  "혼자 운영하는 채널이 의외로 더 빨리 크는 이유",
  "구독 버튼 누르게 만드는 CTA, 다들 너무 약하게 쓴다",
  "시청 유지율이 터지는 영상은 편집 리듬부터 다르다"
];

const createMockImage = (label: string, aspectRatio: "9:16" | "16:9") => {
  const [w, h] = aspectRatio === "9:16" ? [540, 960] : [960, 540];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#0a0e1a"/>
          <stop offset="100%" stop-color="#1b2433"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="24" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="Manrope, Arial" font-size="28" fill="rgba(248,250,252,0.8)" letter-spacing="2">
        ${label}
      </text>
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const analyzeTopic = async (input: string, mode: 'tag' | 'description') => {
  const sys = [
    buildStudioPersona({
      role: 'senior YouTube Shorts niche analyst and trend researcher',
      domain: 'YouTube Shorts strategy, audience fit, and trend signals',
    }),
    'Reply with JSON only: { "niche": string[], "trending": string[], "confidence": number }.',
  ].join(' ');
  const prompt = `Analyze this ${mode} input for YouTube Shorts. Input: "${input}". Return the JSON object.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<{ niche?: string[]; trending?: string[]; confidence?: number }>(output, {});
    return {
      niche: Array.isArray(parsed.niche) ? parsed.niche : [`${input} 기반의 간결한 메시지`, '짧은 길이, 높은 몰입감', '명확한 CTA와 리듬감'],
      trending: Array.isArray(parsed.trending) ? parsed.trending : ['Short-form 스토리텔링', '데스크테리어/무드', 'AI 활용 제작'],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (mode === 'tag' ? 82 : 88),
    };
  } catch (e) {
    return {
      niche: [`${input} 기반의 간결한 메시지`, '짧은 길이, 높은 몰입감', '명확한 CTA와 리듬감'],
      trending: ['Short-form 스토리텔링', '데스크테리어/무드', 'AI 활용 제작'],
      confidence: mode === 'tag' ? 82 : 88,
    };
  }
};

export const generateTopics = async (context: {
  tags: string[];
  description: string;
  urlData?: { summary?: string; patterns?: string[] } | null;
  trendData?: { titles?: string[] } | null;
}) => {
  const base = context.tags.length ? context.tags[0] : '콘텐츠';
  const today = getLocalIsoDate();
  const research = await getStudioResearchPacket({
    purpose: 'step2 topic generation',
    tags: context.tags,
    description: context.description,
    benchmarkSummary: context.urlData?.summary,
    benchmarkPatterns: context.urlData?.patterns,
  });
  const researchBrief = formatResearchBrief(research);
  const trendTitles = Array.isArray(context.trendData?.titles)
    ? context.trendData?.titles.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  const sys = [
    buildStudioPersona({
      role: 'senior YouTube Shorts creative strategist and ideation lead',
      domain: 'Short-form topic ideation, hooks, and high-CTR packaging',
    }),
    'Reply with JSON only: { "topics": string[] }.',
    'Up to 12 items. All topic strings must be in Korean.',
    `Today is ${today}. Your suggestions must feel relevant as of today.`,
    'These must feel like actual clickable YouTube video titles, not internal brainstorm notes.',
    'Do not propose obviously outdated issues or time-locked headlines.',
    'Do NOT invent specific real-world claims.',
    researchBrief ? 'A verified latest-facts research brief may be provided. Treat it as the source of truth for entities, deaths, office status, wars, and current developments.' : '',
    'Before proposing topics, verify named people, organizations, wars, elections, deaths, offices, and status changes against current public information.',
    'If a named figure is deceased, removed from office, dissolved, or otherwise no longer current, do not suggest "recent updates" or "latest status" angles as if they are still active.',
    'Prioritize high-CTR packaging: tension, stakes, surprise, reversal, hidden truth, fallout, showdown, urgency, and curiosity gaps.',
    'Avoid bland academic wording. Do not default to dry titles like "분석", "영향은?", "무엇인가?" unless the angle is still sharply clickable.',
    'Each title should make a viewer feel "I need to know what happened / why this matters / what the hidden truth is."',
    'Avoid specific dates and years unless they appear in the provided trend titles, benchmarking context, or user input.',
    'Avoid named public figures unless they appear in the provided trend titles, benchmarking context, or user input.',
    'If benchmarking context is provided, you may use its content summary to understand the source topic and viewer angle, but use the listed patterns only for structure/tone. Do not reuse its specific names, organizations, dates, elections, or wars unless explicitly present in the user input.',
    trendTitles.length
      ? 'If trend titles are provided, treat them as real demand signals and you may reuse their proper nouns, but do not fabricate additional details.'
      : '',
  ].join(' ');
  const urlPart = context.urlData && (context.urlData.summary || (context.urlData.patterns?.length ?? 0) > 0)
    ? `\n\n참고할 벤치마킹:\n내용/전개 요약: ${context.urlData.summary || '(없음)'}\n패턴: ${Array.isArray(context.urlData.patterns) ? context.urlData.patterns.join(', ') : '(없음)'}\n위 내용 요약과 패턴/스타일을 함께 반영한 주제를 제안하세요.`
    : '';
  const trendPart = trendTitles.length
    ? `\n\nYouTube demand signals (recent popular titles, KR):\n- ${trendTitles.join('\n- ')}\n이 리스트는 "현재 수요가 높은 소재/키워드" 참고용입니다. 이 범위를 벗어난 실명/연도/선거/전쟁 같은 시간 고정 소재는 새로 만들어내지 마세요.`
    : '';
  const prompt = [
    `Tags: ${context.tags.join(', ') || '(none)'}.`,
    `Description: ${context.description || '(none)'}.`,
    urlPart ? `${urlPart}\n\n(Important) Use benchmarking for style only, not subject-matter copying.` : '',
    trendPart ? `${trendPart}\n\n(Important) Prefer topics that match the demand signals and category intent.` : '',
    researchBrief ? `\nVerified latest-facts research brief:\n${researchBrief}\n\n(Important) If the user framing or benchmark framing conflicts with the verified brief, follow the verified brief.` : '',
    '',
    'Propose 12 topic strings in Korean.',
    '- Write them like real YouTube titles with click appeal.',
    '- Strongly prefer curiosity, confrontation, consequence, secret, reversal, or "what really happened" framing when relevant.',
    '- Prefer evergreen angles or "recent" framing without asserting specific claims.',
    '- Avoid stale/time-locked references (e.g., 2022/2023/총선/대선/D-day) unless present in demand signals or user input.',
    'Return JSON only: { "topics": string[] }.',
  ].filter(Boolean).join('\n');
  try {
    const { output } = await studioLlm({
      prompt,
      system_prompt: sys,
      model: 'google/gemini-2.5-flash',
      provider: 'google-ai-studio',
      google_search: true,
    });
    const parsed = safeJsonParse<{ topics?: string[] }>(output, {});
    let topics = Array.isArray(parsed.topics) ? parsed.topics.slice(0, 12) : mockTopics.map(t => `${base} · ${t}`).slice(0, 12);
    const userCtxText = `${context.tags.join(' ')} ${context.description || ''} ${trendTitles.join(' ')}`;
    if (shouldFreshenTopics(topics, userCtxText)) {
      try {
        topics = await freshenTopics({ topics, tags: context.tags, description: context.description, today, trendTitles });
      } catch {
        /* keep original */
      }
    }
    try {
      topics = await polishTopicsForCtr({
        topics,
        tags: context.tags,
        description: context.description,
        today,
        benchmarkSummary: context.urlData?.summary,
        benchmarkPatterns: context.urlData?.patterns,
        research,
      });
    } catch {
      /* keep original */
    }
    try {
      const topicsWithReasons = await buildTopicReasons({
        topics,
        tags: context.tags,
        description: context.description,
        trendTitles,
        benchmarkSummary: context.urlData?.summary,
        benchmarkPatterns: context.urlData?.patterns,
        research,
      });
      return { topics: topicsWithReasons };
    } catch {
      return {
        topics: topics.map((title) => ({
          title,
          reason: '사용자 입력과 시장 맥락을 바탕으로 클릭 유인을 만들 수 있는 주제라 추천했습니다.',
        })),
      };
    }
  } catch (e) {
    return {
      topics: mockTopics.map(t => `${base} · ${t}`).slice(0, 12).map((title) => ({
        title,
        reason: '기본 CTR 패턴을 기준으로, 시청자 호기심과 클릭 가능성을 높이도록 추천한 주제입니다.',
      })),
    };
  }
};

export const analyzeUrlPattern = async (url: string) => {
  const res = await studioYouTubeBenchmarkAnalyze(url);
  return {
    summary: typeof res.summary === 'string' ? res.summary : '메타데이터 기반 분석 결과를 가져오지 못했습니다.',
    patterns: Array.isArray(res.patterns) ? res.patterns : [],
    content: (res.content && typeof res.content === 'object' && !Array.isArray(res.content))
      ? {
          summary: typeof res.content.summary === 'string' ? res.content.summary : '',
          keyPoints: Array.isArray(res.content.keyPoints) ? res.content.keyPoints.filter(Boolean) : [],
        }
      : { summary: '', keyPoints: [] },
    delivery: (res.delivery && typeof res.delivery === 'object' && !Array.isArray(res.delivery))
      ? {
          summary: typeof res.delivery.summary === 'string' ? res.delivery.summary : '',
          patterns: Array.isArray(res.delivery.patterns) ? res.delivery.patterns.filter(Boolean) : [],
        }
      : { summary: '', patterns: [] },
    meta: res.meta || {},
  };
};

export const generatePlanningStep = async (stepName: string, context: any) => {
  const research = await getStudioResearchPacket({
    purpose: `step3 planning draft for ${stepName}`,
    topic: context.topic,
    description: context.referenceScript,
    benchmarkSummary: context.benchmarkSummary,
    benchmarkPatterns: context.benchmarkPatterns,
  });
  const researchBrief = formatResearchBrief(research);
  const verifiedTopic = getVerifiedWorkingTopic(context.topic, research);
  const sys = [
    buildStep3EditorialPersona(context.style || 'N/A'),
    buildStep3ResearchRules(),
    'Task:',
    'Write a rich, detailed planning draft in Korean for the requested step.',
    'Output only the planning text (Korean), no JSON, no "result:" label, no code blocks.',
    'Be concrete and actionable: include specifics (facts to cover, beats, pacing, hooks, CTA ideas, editing/graphic cues) rather than vague advice.',
    'Strictly match the user-selected style and tone.',
    'Adapt the depth and pacing to the target length.',
    researchBrief ? 'A verified latest-facts research brief may be provided. Treat it as the source of truth and do not slip back into stale framing from the original user input.' : '',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Before you answer, silently verify the draft follows the style rules. If not, revise it until it does.',
  ].join(' ');
  const existing = compactPlanningData(context.planningData || {});
  const masterPlanText = typeof context.masterPlanText === 'string' ? context.masterPlanText.trim() : '';
  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const prompt = [
    `Step: ${stepName}`,
    `Original user topic: ${context.topic}`,
    `Verified working topic: ${verifiedTopic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    buildTargetDurationPrompt(context.targetDuration, context.length),
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    masterPlanText ? `Master plan context (Korean, may be truncated):\n${truncateText(masterPlanText, 4000)}\nUse it to keep this step consistent with the overall plan.` : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}\nReflect the summary/patterns where relevant, without copying verbatim.`
      : '',
    `Existing plan (JSON, may be truncated): ${truncateText(existing, 6000)}`,
    '',
    'Write the planning draft in Korean.',
    'Use a clear structure with short sections and bullet points.',
  ].filter(Boolean).join('\n');
  try {
    const { output } = await callStep3Gemini({
      prompt,
      systemPrompt: sys,
      googleSearch: true,
    });
    const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
    if (text.length > 10) return { result: text };
    const parsed = safeJsonParse<{ result?: string }>(output, {});
    const fromJson = typeof parsed.result === 'string' ? parsed.result : '';
    return { result: fromJson.length > 10 ? fromJson : `[${stepName}] 주제: ${context.topic}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `[${stepName}] 주제: ${context.topic}\n\n⚠️ API 오류: ${msg}\n(백엔드 .env에 GEMINI_API_KEY 또는 GOOGLE_API_KEY 설정 여부와 서버 로그를 확인해 주세요. 직접 입력도 가능합니다.)` };
  }
};

export const rewritePlanningStep = async (stepName: string, context: any) => {
  const research = await getStudioResearchPacket({
    purpose: `step3 rewrite for ${stepName}`,
    topic: context.topic,
    description: context.instruction,
    benchmarkSummary: context.benchmarkSummary,
    benchmarkPatterns: context.benchmarkPatterns,
  });
  const researchBrief = formatResearchBrief(research);
  const verifiedTopic = getVerifiedWorkingTopic(context.topic, research);
  const sys = [
    buildStep3EditorialPersona(context.style || 'N/A'),
    buildStep3ResearchRules(),
    'Task:',
    'Rewrite the given planning draft in Korean.',
    'Output only the rewritten planning text (Korean), no JSON, no "result:" label, no code blocks.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Preserve the strongest verified facts and remove stale, weak, or contradictory claims.',
    researchBrief ? 'A verified latest-facts research brief may be provided. Follow it over the original draft whenever they conflict.' : '',
    'Before you answer, silently verify the rewrite follows the style rules. If not, revise it until it does.',
  ].filter(Boolean).join(' ');

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const masterPlanText = typeof context.masterPlanText === 'string' ? context.masterPlanText.trim() : '';
  const mode = typeof context.mode === 'string' ? context.mode : 'refine';
  const userInstruction = typeof context.instruction === 'string' ? context.instruction : '';
  const currentText = typeof context.currentText === 'string' ? context.currentText : '';

  const prompt = [
    `Step: ${stepName}`,
    `Original user topic: ${context.topic}`,
    `Verified working topic: ${verifiedTopic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    buildTargetDurationPrompt(context.targetDuration, context.length),
    mode ? `Rewrite mode: ${mode}` : '',
    userInstruction ? `User request: ${userInstruction}` : '',
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    masterPlanText ? `Master plan context (Korean, may be truncated):\n${truncateText(masterPlanText, 4000)}\nKeep the rewrite consistent with the master plan.` : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}\nReflect the summary/patterns where relevant, without copying verbatim.`
      : '',
    '',
    'Current draft (Korean):',
    currentText,
    '',
    'Rewrite in Korean with a clear structure (short sections + bullet points where helpful).',
  ].filter(Boolean).join('\n');

  const { output } = await callStep3Gemini({
    prompt,
    systemPrompt: sys,
    googleSearch: true,
  });
  const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
  return { result: text || currentText };
};

export const generateMasterPlan = async (context: {
  topic: string;
  style: string;
  styleRules?: string;
  length?: string;
  targetDuration?: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
  existingMasterPlan?: string;
  planningData?: any;
}) => {
  const research = await getStudioResearchPacket({
    purpose: 'step3 master plan generation',
    topic: context.topic,
    benchmarkSummary: context.benchmarkSummary,
    benchmarkPatterns: context.benchmarkPatterns,
  });
  const researchBrief = formatResearchBrief(research);
  const verifiedTopic = getVerifiedWorkingTopic(context.topic, research);
  const sys = [
    buildStep3EditorialPersona(context.style || 'N/A'),
    buildStep3ResearchRules(),
    'Task:',
    'Write a single, cohesive master plan in Korean that includes all 6 planning sections (1~6) end-to-end.',
    'Output only the planning text (Korean), no JSON, no "result:" label, no code blocks.',
    'Use explicit section headers exactly like: "1) 콘텐츠 타입", "2) 전체 이야기 한 줄 요약", "3) 오프닝 기획", "4) 본문 구성 설계", "5) 클라이맥스/핵심 메시지", "6) 아웃트로 설계".',
    'Be concrete and actionable: include beats, hooks, pacing, examples, B-roll/graphics notes, and CTA ideas.',
    'Strictly match the user-selected style and tone.',
    researchBrief ? 'A verified latest-facts research brief may be provided. Treat it as the factual baseline for all 6 sections.' : '',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Before you answer, silently verify the plan follows the style rules and that all 6 sections are consistent with the same topic and message spine.',
  ].filter(Boolean).join(' ');

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const existingPlan = typeof context.existingMasterPlan === 'string' ? context.existingMasterPlan.trim() : '';
  const existingParts = compactPlanningData(context.planningData || {});

  const prompt = [
    `Original user topic: ${context.topic}`,
    `Verified working topic: ${verifiedTopic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    buildTargetDurationPrompt(context.targetDuration, context.length),
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}\nReflect the summary/patterns where relevant, without copying verbatim.`
      : '',
    existingPlan ? `Existing master plan (Korean):\n${existingPlan}` : '',
    `Existing partial plan (JSON, may be truncated): ${truncateText(existingParts, 4000)}`,
    '',
    'Write the master plan in Korean with the exact 1)~6) headers.',
  ].filter(Boolean).join('\n');

  const { output } = await callStep3Gemini({
    prompt,
    systemPrompt: sys,
    googleSearch: true,
  });
  const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
  return { result: text || existingPlan };
};

function extractStepSectionsFromMasterPlan(masterPlanText: string) {
  const text = typeof masterPlanText === 'string' ? masterPlanText.trim() : '';
  if (!text) return null;

  const sectionPatterns = [
    { key: 'contentType', label: '1\\)\\s*콘텐츠\\s*타입' },
    { key: 'summary', label: '2\\)\\s*전체\\s*이야기\\s*한\\s*줄\\s*요약' },
    { key: 'opening', label: '3\\)\\s*오프닝\\s*기획' },
    { key: 'body', label: '4\\)\\s*본문\\s*구성\\s*설계' },
    { key: 'climax', label: '5\\)\\s*클라이맥스\\s*/\\s*핵심\\s*메시지' },
    { key: 'outro', label: '6\\)\\s*아웃트로\\s*설계' },
  ] as const;

  const normalized = text.replace(/\r\n/g, '\n');
  const headers = sectionPatterns
    .map((section) => {
      const regex = new RegExp(`(^|\\n)${section.label}\\s*`, 'm');
      const match = regex.exec(normalized);
      if (!match) return null;
      return {
        key: section.key,
        start: match.index + match[1].length,
      };
    })
    .filter((item): item is { key: typeof sectionPatterns[number]['key']; start: number } => Boolean(item))
    .sort((a, b) => a.start - b.start);

  if (headers.length < 6) return null;

  const extracted: Record<string, string> = {
    contentType: '',
    summary: '',
    opening: '',
    body: '',
    climax: '',
    outro: '',
  };

  headers.forEach((header, index) => {
    const end = index < headers.length - 1 ? headers[index + 1].start : normalized.length;
    const sectionText = normalized.slice(header.start, end).trim();
    const cleaned = sectionText
      .replace(new RegExp(`^${sectionPatterns.find((item) => item.key === header.key)?.label}\\s*`, 'm'), '')
      .trim();
    extracted[header.key] = cleaned;
  });

  const hasAll = Object.values(extracted).every((value) => value.trim().length > 0);
  return hasAll ? extracted : null;
}

export const splitMasterPlanToSteps = async (context: {
  topic: string;
  style: string;
  styleRules?: string;
  masterPlanText: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
}) => {
  const extracted = extractStepSectionsFromMasterPlan(context.masterPlanText);
  if (extracted) {
    return extracted;
  }

  const sys = [
    buildStep3EditorialPersona(context.style || 'N/A'),
    'Task:',
    'Extract the 6 planning sections from the given master plan.',
    'Return a valid JSON object only.',
    'All values must be Korean strings that preserve the original planning meaning.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Ensure the extracted sections remain consistent with the topic and match the style rules.',
  ].filter(Boolean).join('\n');

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const prompt = [
    `Topic: ${context.topic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}` : '',
    '',
    'Master plan (Korean):',
    context.masterPlanText,
    '',
    'Return the extracted JSON only.',
  ].filter(Boolean).join('\n');

  const { output } = await callStep3Gemini({
    prompt,
    systemPrompt: sys,
    responseSchema: STEP3_SPLIT_SCHEMA as unknown as Record<string, unknown>,
  });
  const parsed = safeJsonParse<{
    contentType?: string;
    summary?: string;
    opening?: string;
    body?: string;
    climax?: string;
    outro?: string;
  }>(output, {});
  return {
    contentType: parsed.contentType || '',
    summary: parsed.summary || '',
    opening: parsed.opening || '',
    body: parsed.body || '',
    climax: parsed.climax || '',
    outro: parsed.outro || ''
  };
};

/** 목표 재생 시간(문자열)을 초 단위로 변환. 30s→30, 1m→60, 3m→180, 5m→300 */
export function targetDurationToSeconds(td: string | undefined): number {
  if (!td || typeof td !== 'string') return 0;
  const s = td.trim().toLowerCase();
  if (!s) return 0;
  const compact = s.replace(/\s+/g, '');

  const clock = compact.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    return Math.max(0, (parseInt(clock[1], 10) || 0) * 60 + (parseInt(clock[2], 10) || 0));
  }

  if (/^\d+s$/.test(compact)) return Math.max(0, parseInt(compact, 10) || 0);
  if (/^\d+m$/.test(compact)) return Math.max(0, (parseInt(compact, 10) || 0) * 60);

  let total = 0;
  const minMatch = compact.match(/(\d+)(?:m|min|mins|minute|minutes|분)/);
  const secMatch = compact.match(/(\d+)(?:s|sec|secs|second|seconds|초)/);
  if (minMatch) total += (parseInt(minMatch[1], 10) || 0) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10) || 0;
  if (total > 0) return total;

  if (/^\d+$/.test(compact)) return Math.max(0, parseInt(compact, 10) || 0);
  return 0;
}

/** 목표 시간(초)에 맞는 대략적인 한글 글자 수 가이드 (TTS 기준 분당 약 280자) */
function targetDurationToCharHint(sec: number): string {
  if (sec <= 0) return '';
  const chars = Math.floor((sec / 60) * 280);
  return `권장: 전체 대본은 약 ${chars}자 내외 (한국어 TTS 기준 약 ${sec}초).`;
}

function estimateNarrationSeconds(text: string): number {
  const plain = (text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\*\*[^*]+\*\*/g, ' ')
    .replace(/(?:화면|음악)\s*:\s*[^\n]*/g, ' ')
    .replace(/\([^)]*(?:화면|음악)[^)]*\)/g, ' ')
    .replace(/\s+/g, '');
  if (!plain) return 0;
  return Math.max(1, Math.round((plain.length / 280) * 60));
}

function getTargetDurationBounds(targetDuration?: string) {
  const targetSec = targetDurationToSeconds(targetDuration);
  if (targetSec <= 0) return { targetSec: 0, minSec: 0, maxSec: 0, guide: '' };
  const tolerance = Math.max(20, Math.round(targetSec * 0.12));
  const minSec = Math.max(15, targetSec - tolerance);
  const maxSec = targetSec + tolerance;
  return {
    targetSec,
    minSec,
    maxSec,
    guide: `Exact target duration: ${targetDuration} (~${targetSec}s). Estimated narration length must land between ${minSec}s and ${maxSec}s. If unsure, favor slightly longer rather than shorter.`,
  };
}

function buildTargetDurationPrompt(targetDuration?: string, length?: string) {
  const bounds = getTargetDurationBounds(targetDuration);
  if (!bounds.targetSec) return length ? `Target length profile: ${length}` : '';
  return [
    length ? `Target length profile: ${length}` : '',
    bounds.guide,
    targetDurationToCharHint(bounds.targetSec),
  ].filter(Boolean).join(' ');
}

async function refineMasterScriptToTargetDuration(options: {
  script: string;
  topic: string;
  verifiedTopic: string;
  style: string;
  styleRules?: string;
  planning: any;
  researchBrief: string;
  benchmarkSummary: string;
  benchmarkPatterns: string[];
  targetDuration?: string;
}) {
  const bounds = getTargetDurationBounds(options.targetDuration);
  if (!bounds.targetSec) return options.script;

  let currentScript = (options.script || '').trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const estimatedSec = estimateNarrationSeconds(currentScript);
    if (estimatedSec >= bounds.minSec && estimatedSec <= bounds.maxSec) return currentScript;

    const direction = estimatedSec < bounds.minSec ? 'expand' : 'compress';
    const sys = [
      buildStep3EditorialPersona(options.style || 'N/A'),
      LEAD_SCRIPTWRITER_INSTRUCTION.trim(),
      buildStep3ResearchRules(),
      'Task:',
      direction === 'expand'
        ? 'Expand the Korean master script so the narration reaches the requested duration range while preserving the same story spine and factual baseline.'
        : 'Compress the Korean master script so the narration reaches the requested duration range while preserving the same story spine and factual baseline.',
      'Reply with JSON only: { "master_script": string }.',
      options.styleRules ? `Style rules:\n${options.styleRules}` : '',
      options.researchBrief ? 'Use the verified research brief as the factual source of truth.' : '',
    ].filter(Boolean).join('\n');

    const prompt = [
      `Original user topic: ${options.topic}.`,
      `Verified working topic: ${options.verifiedTopic}.`,
      `Style (user-selected): ${options.style}.`,
      bounds.guide,
      `Current estimated narration length: ~${estimatedSec}s.`,
      direction === 'expand'
        ? 'The current draft is too short. Add detail, connective explanation, examples, evidence framing, and scene-setting narration.'
        : 'The current draft is too long. Remove repetition, compress transitions, and keep only the strongest lines.',
      options.researchBrief ? `Verified research brief:\n${options.researchBrief}` : '',
      options.benchmarkSummary || options.benchmarkPatterns.length
        ? `Benchmarking summary: ${options.benchmarkSummary || '(none)'}. Benchmarking patterns: ${options.benchmarkPatterns.length ? options.benchmarkPatterns.join(' | ') : '(none)'}.`
        : '',
      `Planning (JSON): ${JSON.stringify(options.planning)}.`,
      'Current master script (Korean):',
      currentScript,
      '',
      'Return JSON only.',
    ].filter(Boolean).join('\n');

    try {
      const { output } = await callStep3Gemini({
        prompt,
        systemPrompt: sys,
        googleSearch: true,
        responseSchema: STEP3_SCRIPT_SCHEMA as unknown as Record<string, unknown>,
      });
      const parsed = safeJsonParse<{ master_script?: string }>(output, {});
      const revised = typeof parsed.master_script === 'string' ? parsed.master_script.trim() : '';
      if (!revised) break;
      currentScript = revised;
    } catch {
      break;
    }
  }
  return currentScript;
}

export const synthesizeMasterScript = async (context: {
  topic: string;
  planningData: any;
  style: string;
  styleRules?: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
}) => {
  const research = await getStudioResearchPacket({
    purpose: 'step3 master script generation',
    topic: context.topic,
    benchmarkSummary: context.benchmarkSummary,
    benchmarkPatterns: context.benchmarkPatterns,
  });
  const researchBrief = formatResearchBrief(research);
  const verifiedTopic = getVerifiedWorkingTopic(context.topic, research);
  const sys = [
    buildStep3EditorialPersona(context.style || 'N/A'),
    LEAD_SCRIPTWRITER_INSTRUCTION.trim(),
    buildStep3ResearchRules(),
    'Reply with JSON only: { "master_script": string }.',
    'master_script must be the full script text in Korean.',
    'Do not output any keys other than master_script.',
    'The script must stay aligned with the verified current facts and the planning spine.',
    researchBrief ? 'A verified latest-facts research brief may be provided. Follow it over any stale wording in the original topic or planning draft.' : '',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
  ].join('\n');
  const planning = context.planningData || {};
  const durationBounds = getTargetDurationBounds(planning.targetDuration);
  const durationGuide = durationBounds.targetSec > 0
    ? `${durationBounds.guide} ${targetDurationToCharHint(durationBounds.targetSec)}`
    : '';

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const prompt = [
    `Original user topic: ${context.topic}.`,
    `Verified working topic: ${verifiedTopic}.`,
    `Style (user-selected): ${context.style}.`,
    durationGuide ? durationGuide : '',
    researchBrief ? `Verified research brief:\n${researchBrief}` : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking summary: ${benchmarkSummary || '(none)'}. Benchmarking patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}.`
      : '',
    `Planning (JSON): ${JSON.stringify(planning)}.`,
    'Write the full master script in Korean.',
    'Include narration and, when helpful, optional timestamps/seconds (e.g. [0-3초]), music cues (e.g. 음악: ...), and screen directions (e.g. 화면: ...).',
    'Return JSON.',
  ].filter(Boolean).join(' ');
  try {
    const { output } = await callStep3Gemini({
      prompt,
      systemPrompt: sys,
      googleSearch: true,
      responseSchema: STEP3_SCRIPT_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = safeJsonParse<{ master_script?: string }>(output, {});
    const fallback = `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.`;
    const initialScript = typeof parsed.master_script === 'string' ? parsed.master_script : fallback;
    const masterScript = await refineMasterScriptToTargetDuration({
      script: initialScript,
      topic: context.topic,
      verifiedTopic,
      style: context.style,
      styleRules: context.styleRules,
      planning,
      researchBrief,
      benchmarkSummary,
      benchmarkPatterns,
      targetDuration: planning.targetDuration,
    });
    return { master_script: masterScript };
  } catch (e) {
    return { master_script: `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.` };
  }
};

/**
 * 대본(script_segment)에서 음악·초·화면 지시를 제거하고 내레이션만 남김.
 * - "음악: ..." 줄 제거
 * - "[0-3초]", "[3-5초]" 등 시간 구간 및 "화면: ..." 줄 제거
 * - (음악: ...), (화면: ...) 괄호 블록 제거
 */
export function sanitizeScriptSegment(raw: string): string {
  let text = (raw || '').trim();
  if (!text) return text;
  const narrationMarkers = ['**내레이션:**', '내레이션:'];
  for (const marker of narrationMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      text = text.slice(idx + marker.length).trim();
      break;
    }
  }
  text = text
    .replace(/\(화면\s*:\s*[^)]*\)/g, '')
    .replace(/\(음악\s*:\s*[^)]*\)/g, '')
    .replace(/^음악\s*:\s*[^\n]*\n?/gm, '')
    .replace(/^\[\s*[^\]]*초\s*\]\s*화면\s*:\s*[^\n]*\n?/gm, '')
    .replace(/^\[\s*[^\]]*초\s*\]\s*[^\n]*\n?/gm, '')
    .replace(/^화면\s*:\s*[^\n]*\n?/gm, '')
    .replace(/\*\*\[\s*[^\]]*\]\s*[^*]*\*\*/g, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  return text || raw.trim();
}

export const splitScriptIntoScenes = async (fullScript: string) => {
  const sys = [
    buildStudioPersona({
      role: 'senior video editor and storyboard artist',
      domain: 'storyboarding, beat mapping, and visual continuity for YouTube videos',
    }),
    'Reply with JSON only: an array of { "script_segment": string, "scene_description": string }.',
    'Rules for script_segment:',
    '- Put ONLY the spoken narration (내레이션) that will be read aloud. No music cues, no timestamps, no visual directions.',
    '- Do NOT include: "음악: ...", "[0-3초]", "화면: ...", or similar. Those belong in scene_description or nowhere.',
    'scene_description should describe the visual in English (can include timing/mood for the visual).',
  ].join('\n');
  const prompt = `Split this script into scene items. Each item:
- script_segment: ONLY the narration text (what the narrator says). No music, no seconds/timestamps, no "화면:" directions.
- scene_description: visual prompt for image (can include timing/mood for the visual).
Script:\n${fullScript}\nReturn JSON array only.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<Array<{ script_segment?: string; scene_description?: string }>>(output, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = parsed.map(p => ({
        script_segment: sanitizeScriptSegment(p.script_segment ?? ''),
        scene_description: p.scene_description ?? 'Cinematic scene.',
      })).filter((item) => item.script_segment.trim().length > 0);
      if (cleaned.length > 0) return cleaned;
    }
  } catch (e) {
    /* fallback */
  }
  return [
    { script_segment: '오프닝: 시청자의 관심을 끄는 한 문장 훅.', scene_description: 'Minimal studio, neon rim light, close-up.' },
    { script_segment: '본문: 핵심 포인트 1~2를 빠르게 전달.', scene_description: 'Clean desk, soft shadows, cinematic framing.' },
    { script_segment: '마무리: 요약 및 CTA.', scene_description: 'Dark gradient background, subtle light beam.' },
  ];
};

/**
 * 업로드된 레퍼런스 이미지 분석
 */
export const analyzeReferenceImage = async (base64Image: string) => {
  void base64Image;
  const sys = [
    buildStudioPersona({
      role: 'senior art director and image prompt engineer',
      domain: 'visual style analysis for image generation',
    }),
    'Describe the visual style of an image in one short sentence for use as an image generation prompt.',
    'Reply with plain text only (English).',
  ].join(' ');
  const prompt = 'Describe the style of this reference image in one concise sentence (lighting, mood, colors, composition). No preamble. English only.';
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    return (output || '').trim() || 'Minimal dark studio lighting, soft rim light, matte textures, premium cinematic mood.';
  } catch (e) {
    return 'Minimal dark studio lighting, soft rim light, matte textures, premium cinematic mood.';
  }
};

/**
 * 상세 이미지 프롬프트 생성
 */
export const generateScenePrompt = async (
  narrative: string,
  styleDesc: string,
  referenceStyle: string,
  benchmark?: { summary?: string; patterns?: string[] }
) => {
  const sys = [
    buildStudioPersona({
      role: 'senior cinematic prompt engineer',
      domain: 'high-quality image generation prompts for consistent visual style',
      style: styleDesc || referenceStyle,
    }),
    'You write a single production-ready image generation prompt in English for fal-ai/nano-banana-2 or fal-ai/nano-banana-2/edit.',
    'The prompt must describe one final image only, not a collage or storyboard.',
    'Be direct and constraint-driven: subject, action, environment, camera framing, lens feel, lighting, mood, color energy, and what must stay consistent.',
    'When reference style is provided, preserve that rendering language and mood rather than inventing a new one.',
    'Explicitly avoid text, subtitles, logos, UI, watermarks, arrows, and template graphics.',
    'Reply with plain text only (English), no JSON.',
  ].join(' ');
  const benchSummary = typeof benchmark?.summary === 'string' ? benchmark?.summary.trim() : '';
  const benchPatterns = Array.isArray(benchmark?.patterns) ? benchmark?.patterns.filter(Boolean).slice(0, 12) : [];
  const benchPart = benchSummary || benchPatterns.length
    ? ` Benchmarking vibe: summary="${benchSummary || 'N/A'}"; patterns="${benchPatterns.length ? benchPatterns.join(' | ') : 'N/A'}". Reflect the vibe/patterns without copying verbatim.`
    : '';
  const prompt = [
    `Narrative: ${narrative}.`,
    `Style target: ${styleDesc || 'N/A'}.`,
    `Reference style and mood: ${referenceStyle || 'N/A'}.`,
    benchPart ? benchPart.trim() : '',
    'Write one English prompt optimized for Nano Banana 2.',
    'It should produce one polished final frame with a clear focal subject, readable silhouette, deliberate composition, and clean cinematic lighting.',
    'Include camera/framing language and preserve reference style consistency.',
    'Do not output bullets, numbering, markdown, JSON, or multiple prompt variants.',
  ].filter(Boolean).join(' ');
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    return (output || '').trim() || `Cinematic frame, ${styleDesc}. ${referenceStyle}. Scene: ${narrative}`;
  } catch (e) {
    return `Cinematic frame, ${styleDesc}. ${referenceStyle}. Scene: ${narrative}`;
  }
};

/**
 * 장면 이미지 생성. model은 styleLab의 model 값 (예: fal-ai/imagen4/preview).
 */
const NO_TEXT_PROMPT_SUFFIX = ', no text, no letters, no words in the image';

function shouldUseImageWebSearch(text: string): boolean {
  const s = (text || '').toLowerCase();
  if (!s) return false;
  return /(속보|최신|실시간|사망|암살|공습|전쟁|휴전|대선|총선|대통령|총리|지도자|정권|외교|관세|제재|trump|iran|israel|hamas|ukraine|putin|election|war|ceasefire|president|leader|sanction)/i.test(s);
}

function buildNanoBananaSingleImagePrompt(
  basePrompt: string,
  options?: {
    aspectRatio?: '9:16' | '16:9';
    withReferences?: boolean;
    preserveReferenceMood?: boolean;
    useCase?: 'scene' | 'thumbnail';
  }
) {
  const aspectText = options?.aspectRatio === '9:16' ? 'vertical 9:16 frame' : 'horizontal 16:9 frame';
  const useCase = options?.useCase || 'scene';
  const referenceLine = options?.withReferences
    ? 'Use the provided reference images as hard constraints. Preserve the same character identity, outfit logic, material feel, silhouette, rendering language, lighting family, and color energy unless the prompt explicitly asks for a change.'
    : 'Keep one coherent visual language and one dominant focal subject. Do not drift into mixed styles.';
  const moodLine = options?.preserveReferenceMood
    ? 'Preserve the benchmark/reference mood, packaging energy, contrast strategy, and focal hierarchy while rebuilding the content for the new request.'
    : '';
  const useCaseLine = useCase === 'thumbnail'
    ? 'This must read like one strong clickable thumbnail: one dominant focal point, simplified hierarchy, bold contrast, clean subject separation, and optional headline space without rendering any text.'
    : 'This must read like one finished cinematic frame, not a draft sheet or storyboard.';
  return [
    (basePrompt || '').trim(),
    `Create one single finished ${useCase === 'thumbnail' ? 'thumbnail image' : 'image'} only, composed specifically for a ${aspectText}.`,
    useCaseLine,
    'Do not create a collage, split screen, storyboard, multi-panel layout, before/after, or contact sheet unless explicitly requested.',
    'Prioritize clear composition, readable silhouette separation, clean depth, strong local contrast, and one obvious focal hierarchy.',
    referenceLine,
    moodLine,
    'Do not add text, captions, subtitles, letters, words, logos, watermarks, arrows, guide marks, panel borders, badges, or UI elements.',
  ].filter(Boolean).join(' ');
}

export const generateSceneImage = async (
  prompt: string,
  style: string,
  aspectRatio: '9:16' | '16:9',
  model?: string,
  referenceImageUrls?: string[]
): Promise<string> => {
  const cleanReferenceImageUrls = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).slice(0, 10)
    : [];
  const falModel = cleanReferenceImageUrls.length > 0 ? 'fal-ai/nano-banana-2/edit' : (model || 'fal-ai/imagen4/preview');
  const promptWithNoText = buildNanoBananaSingleImagePrompt(
    `${(prompt || '').trim()}${cleanReferenceImageUrls.length > 0 ? ' Keep the same character identity and preserve the uploaded reference mood while changing only the scene-specific pose, framing, and environment needed for this beat.' : ''}${NO_TEXT_PROMPT_SUFFIX}`,
    {
      aspectRatio,
      withReferences: cleanReferenceImageUrls.length > 0,
      preserveReferenceMood: cleanReferenceImageUrls.length > 0,
      useCase: 'scene',
    }
  );
  try {
    const { images } = await studioImage({
      prompt: promptWithNoText,
      model: falModel,
      aspect_ratio: aspectRatio,
      num_images: 1,
      limit_generations: true,
      enable_web_search: shouldUseImageWebSearch(promptWithNoText),
      ...(cleanReferenceImageUrls.length > 0 ? {
        reference_image_url: cleanReferenceImageUrls[0],
        image_urls: cleanReferenceImageUrls,
      } : {}),
    });
    const url = images?.[0]?.url;
    if (url) return url;
  } catch (e) {
    /* fallback to mock */
  }
  return createMockImage(style || 'Scene', aspectRatio);
};

export interface GeneratedMeta {
  title: string;
  description: string;
  pinnedComment: string;
}

/**
 * 영상 제목, 설명(타임라인·해시태그 포함), 고정댓글을 AI로 생성
 */
export const generateMetaData = async (context: {
  topic?: string;
  summary?: string;
  targetDuration?: string;
}): Promise<GeneratedMeta> => {
  const topic = context.topic || '영상 주제';
  const duration = context.targetDuration || '1m';
  const sys = [
    buildStudioPersona({
      role: 'YouTube growth strategist and SEO-focused metadata specialist',
      domain: 'titles, descriptions, hashtags, and pinned comments optimized for retention and CTR',
    }),
    'Reply with JSON only: { "title": string, "description": string, "pinnedComment": string }.',
    'All fields must be in Korean.',
  ].join(' ');
  const prompt = `Topic: ${topic}. Summary: ${context.summary || 'N/A'}. Duration: ${duration}. Generate title, description (with timeline and hashtags), and pinned comment in Korean. Return JSON.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<GeneratedMeta>(output, {} as GeneratedMeta);
    if (parsed.title && parsed.description && parsed.pinnedComment)
      return parsed;
  } catch (e) {
    /* fallback */
  }
  return {
    title: `${topic} | 60초 요약으로 핵심만 정리`,
    description: `${topic}에 대한 핵심 내용을 짧고 명확하게 정리했습니다.\n\n📌 타임라인\n0:00 오프닝\n0:10 본문 파트 1\n0:25 본문 파트 2\n0:40 클라이맥스\n0:55 아웃트로 & 구독 CTA\n\n#${topic.replace(/\s/g, '_')} #숏폼 #요약 #WEAV스튜디오 #영상제작 #AI`,
    pinnedComment: '📌 이 영상은 WEAV AI 스튜디오로 제작되었습니다.\n궁금한 점이나 다음에 다뤄줬으면 하는 주제가 있으면 댓글로 남겨주세요. 구독과 좋아요는 다음 영상 제작에 큰 힘이 됩니다 🙏',
  };
};

/**
 * 유튜브 썸네일을 분석하고, 현재 프로젝트 포맷에 맞춘 벤치마킹 이미지 URL 생성
 */
export const generateBenchmarkThumbnail = async (
  referenceThumbnailUrl: string,
  targetTopic: string,
  aspectRatio: '9:16' | '16:9',
): Promise<{ imageUrl: string; analysisSummary: string }> => {
  const normalizedTopic = (targetTopic || '').trim();
  const sys = [
    buildStudioPersona({
      role: 'senior YouTube thumbnail analyst and creative director',
      domain: 'thumbnail composition, color, typography, and high-CTR visual patterns',
    }),
    'Analyze a thumbnail and write one short sentence summarizing its style (composition, color, typography).',
    'Reply with plain text only in Korean.',
  ].join(' ');
  const prompt = [
    `Analyze this thumbnail URL style: ${referenceThumbnailUrl}.`,
    normalizedTopic ? `The new thumbnail topic is: ${normalizedTopic}.` : '',
    'One sentence summary in Korean focused on composition, color, packaging, and click trigger.',
  ].filter(Boolean).join(' ');
  let analysisSummary = '레퍼런스 썸네일의 구도·색감·타이포 톤을 분석해 동일한 분위기의 벤치마킹 이미지를 생성했습니다.';
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    if ((output || '').trim()) analysisSummary = output.trim();
  } catch (e) {
    /* keep default */
  }
  try {
    const { images } = await studioImage({
      prompt: buildNanoBananaSingleImagePrompt(
        [
          'Create a NEW YouTube thumbnail by benchmarking the provided reference thumbnail image.',
          normalizedTopic ? `The new thumbnail must be about this topic: ${normalizedTopic}.` : 'Create a strong, clickable benchmarked thumbnail.',
          `Thumbnail benchmark summary: ${analysisSummary}.`,
          'Use the reference thumbnail only as a packaging benchmark for composition, crop, color energy, focal hierarchy, emotional intensity, and click-through structure.',
          'Preserve the benchmark mood and packaging energy, but rebuild the subject matter for the new topic.',
          'Do NOT copy the original thumbnail literally.',
          'Do NOT keep the original subject, original face, original text, original logo, or original branding unless it naturally matches the requested topic.',
          'Keep one dominant focal subject or symbol, a simplified composition, and aggressive thumbnail readability.',
          `Final output must be composed for a ${aspectRatio} thumbnail canvas.`,
        ].join(' '),
        {
          aspectRatio,
          withReferences: true,
          preserveReferenceMood: true,
          useCase: 'thumbnail',
        }
      ),
      model: 'fal-ai/nano-banana-2/edit',
      aspect_ratio: aspectRatio,
      num_images: 1,
      reference_image_url: referenceThumbnailUrl,
      image_urls: [referenceThumbnailUrl],
      resolution: '4K',
      output_format: 'png',
      limit_generations: true,
      enable_web_search: shouldUseImageWebSearch(normalizedTopic),
    });
    const url = images?.[0]?.url;
    if (url) return { imageUrl: url, analysisSummary };
  } catch (e) {
    /* fallback */
  }
  return { imageUrl: createMockImage('벤치마킹 썸네일', aspectRatio), analysisSummary };
};

export const translateToKorean = async (englishText: string): Promise<string> => {
  const text = (englishText || '').trim();
  if (!text) return '';
  const sys = [
    buildStudioPersona({
      role: 'professional Korean-English translator and localization specialist',
      domain: 'accurate, natural Korean translations for creative/technical prompts',
    }),
    'Translate the given text to natural Korean.',
    'Preserve meaning, intent, and structure. Do not add new information.',
    'Keep proper nouns and model/technical terms as-is when appropriate.',
    'If the input is already Korean, return it as-is.',
    'Reply with Korean text only.',
  ].join(' ');
  const prompt = `Text:\n${text}\n\nKorean translation only.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    return (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').trim();
  } catch {
    return '';
  }
};

export const translateToEnglish = async (koreanText: string): Promise<string> => {
  const text = (koreanText || '').trim();
  if (!text) return '';
  const sys = [
    buildStudioPersona({
      role: 'professional Korean-English translator and localization specialist',
      domain: 'accurate, natural English translations for creative/technical prompts',
    }),
    'Translate the given text to natural English.',
    'Preserve meaning, intent, and structure. Do not add new information.',
    'Keep proper nouns and model/technical terms as-is when appropriate.',
    'If the input is already English, return it as-is.',
    'Reply with English text only.',
  ].join(' ');
  const prompt = `Text:\n${text}\n\nEnglish translation only.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    return (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').trim();
  } catch {
    return '';
  }
};
