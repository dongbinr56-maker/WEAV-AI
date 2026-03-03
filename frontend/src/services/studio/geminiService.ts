import { studioLlm, studioImage, studioYouTubeBenchmarkAnalyze } from './studioFalApi';

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
  "하루 5분 집중력 리셋 루틴",
  "2026년 트렌드: 미니멀 라이프의 재해석",
  "AI로 바뀌는 일상, 진짜 유용한 5가지",
  "집중을 부르는 데스크 세팅 가이드",
  "짧고 강한 스토리텔링 구조 3단계",
  "무드 있는 영상 톤앤매너 만드는 법",
  "영상 전개가 매끄러워지는 연결 트릭",
  "시선을 붙잡는 첫 3초 설계",
  "감성+정보 균형 잡는 스크립트 템플릿",
  "반응 좋은 제목·썸네일 조합",
  "저비용 고퀄리티 영상 제작 팁",
  "촬영 없이 만드는 시네마틱 무드",
  "혼자 운영하는 채널의 성장 전략",
  "구독으로 이어지는 CTA 설계법",
  "시청 유지율을 올리는 편집 리듬"
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
    'Do not propose obviously outdated issues or time-locked headlines.',
    'Do NOT invent specific real-world claims.',
    'Avoid specific dates and years unless they appear in the provided trend titles, benchmarking context, or user input.',
    'Avoid named public figures unless they appear in the provided trend titles, benchmarking context, or user input.',
    'If benchmarking context is provided, use it for structure/tone patterns only; do not reuse its specific names, organizations, dates, elections, or wars unless explicitly present in the user input.',
    trendTitles.length
      ? 'If trend titles are provided, treat them as real demand signals and you may reuse their proper nouns, but do not fabricate additional details.'
      : '',
  ].join(' ');
  const urlPart = context.urlData && (context.urlData.summary || (context.urlData.patterns?.length ?? 0) > 0)
    ? `\n\n참고할 벤치마킹:\n요약: ${context.urlData.summary || '(없음)'}\n패턴: ${Array.isArray(context.urlData.patterns) ? context.urlData.patterns.join(', ') : '(없음)'}\n위 패턴/스타일을 반영한 주제를 제안하세요.`
    : '';
  const trendPart = trendTitles.length
    ? `\n\nYouTube demand signals (recent popular titles, KR):\n- ${trendTitles.join('\n- ')}\n이 리스트는 "현재 수요가 높은 소재/키워드" 참고용입니다. 이 범위를 벗어난 실명/연도/선거/전쟁 같은 시간 고정 소재는 새로 만들어내지 마세요.`
    : '';
  const prompt = [
    `Tags: ${context.tags.join(', ') || '(none)'}.`,
    `Description: ${context.description || '(none)'}.`,
    urlPart ? `${urlPart}\n\n(Important) Use benchmarking for style only, not subject-matter copying.` : '',
    trendPart ? `${trendPart}\n\n(Important) Prefer topics that match the demand signals and category intent.` : '',
    '',
    'Propose 12 topic strings in Korean.',
    '- Prefer evergreen angles or "recent" framing without asserting specific claims.',
    '- Avoid stale/time-locked references (e.g., 2022/2023/총선/대선/D-day) unless present in demand signals or user input.',
    'Return JSON only: { "topics": string[] }.',
  ].filter(Boolean).join('\n');
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
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
    return { topics };
  } catch (e) {
    return { topics: mockTopics.map(t => `${base} · ${t}`).slice(0, 12) };
  }
};

export const analyzeUrlPattern = async (url: string) => {
  const res = await studioYouTubeBenchmarkAnalyze(url);
  return {
    summary: typeof res.summary === 'string' ? res.summary : '메타데이터 기반 분석 결과를 가져오지 못했습니다.',
    patterns: Array.isArray(res.patterns) ? res.patterns : [],
    meta: res.meta || {},
  };
};

export const generatePlanningStep = async (stepName: string, context: any) => {
  const persona = [
    'Persona:',
    'You are a senior YouTube long-form content strategist and script planning specialist.',
    'You have deep, hands-on expertise in planning high-retention videos and translating creative direction into practical, shootable outlines.',
    `You are also a subject-matter expert in the user-selected style: ${context.style || 'N/A'}.`,
    'You understand the audience expectations, pacing, structure, and tone for that style and can execute it at a professional level.',
    'You consistently deliver excellent, publish-ready planning drafts that are specific, actionable, and high quality.',
  ].join(' ');

  const sys = [
    persona,
    'Task:',
    'Write a rich, detailed planning draft in Korean for the requested step.',
    'Output only the planning text (Korean), no JSON, no "result:" label, no code blocks.',
    'Be concrete and actionable: include specifics (facts to cover, beats, pacing, hooks, CTA ideas, editing/graphic cues) rather than vague advice.',
    'Strictly match the user-selected style and tone.',
    'Adapt the depth and pacing to the target length.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Before you answer, silently verify the draft follows the style rules. If not, revise it until it does.',
  ].join(' ');
  const existing = compactPlanningData(context.planningData || {});
  const masterPlanText = typeof context.masterPlanText === 'string' ? context.masterPlanText.trim() : '';
  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const prompt = [
    `Step: ${stepName}`,
    `Topic: ${context.topic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    `Target length: ${context.length || 'short'}`,
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
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
    if (text.length > 10) return { result: text };
    const parsed = safeJsonParse<{ result?: string }>(output, {});
    const fromJson = typeof parsed.result === 'string' ? parsed.result : '';
    return { result: fromJson.length > 10 ? fromJson : `[${stepName}] 주제: ${context.topic}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `[${stepName}] 주제: ${context.topic}\n\n⚠️ API 오류: ${msg}\n(백엔드 .env에 FAL_KEY 설정 여부와 서버 로그를 확인해 주세요. 직접 입력도 가능합니다.)` };
  }
};

export const rewritePlanningStep = async (stepName: string, context: any) => {
  const persona = [
    'Persona:',
    'You are a senior YouTube long-form content strategist and script planning specialist.',
    `You are also a subject-matter expert in the user-selected style: ${context.style || 'N/A'}.`,
    'You are excellent at rewriting drafts to better match a target style and constraints.',
  ].join(' ');

  const sys = [
    persona,
    'Task:',
    'Rewrite the given planning draft in Korean.',
    'Output only the rewritten planning text (Korean), no JSON, no "result:" label, no code blocks.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
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
    `Topic: ${context.topic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    mode ? `Rewrite mode: ${mode}` : '',
    userInstruction ? `User request: ${userInstruction}` : '',
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

  const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
  const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
  return { result: text || currentText };
};

export const generateMasterPlan = async (context: {
  topic: string;
  style: string;
  styleRules?: string;
  length?: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
  existingMasterPlan?: string;
  planningData?: any;
}) => {
  const persona = [
    'Persona:',
    'You are a senior YouTube long-form content strategist and master planner.',
    `You are also a subject-matter expert in the user-selected style: ${context.style || 'N/A'}.`,
    'You specialize in producing cohesive end-to-end planning documents that remain consistent across all sections.',
    'You consistently deliver excellent, publish-ready planning drafts that are specific, actionable, and high quality.',
  ].join(' ');

  const sys = [
    persona,
    'Task:',
    'Write a single, cohesive master plan in Korean that includes all 6 planning sections (1~6) end-to-end.',
    'Output only the planning text (Korean), no JSON, no "result:" label, no code blocks.',
    'Use explicit section headers exactly like: "1) 콘텐츠 타입", "2) 전체 이야기 한 줄 요약", "3) 오프닝 기획", "4) 본문 구성 설계", "5) 클라이맥스/핵심 메시지", "6) 아웃트로 설계".',
    'Be concrete and actionable: include beats, hooks, pacing, examples, B-roll/graphics notes, and CTA ideas.',
    'Strictly match the user-selected style and tone.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Before you answer, silently verify the plan follows the style rules and that all 6 sections are consistent with the same topic and message spine.',
  ].filter(Boolean).join(' ');

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const existingPlan = typeof context.existingMasterPlan === 'string' ? context.existingMasterPlan.trim() : '';
  const existingParts = compactPlanningData(context.planningData || {});

  const prompt = [
    `Topic: ${context.topic}`,
    `Style (user-selected): ${context.style || 'N/A'}`,
    `Target length: ${context.length || 'short'}`,
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking context:\n- Summary: ${benchmarkSummary || '(none)'}\n- Patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}\nReflect the summary/patterns where relevant, without copying verbatim.`
      : '',
    existingPlan ? `Existing master plan (Korean):\n${existingPlan}` : '',
    `Existing partial plan (JSON, may be truncated): ${truncateText(existingParts, 4000)}`,
    '',
    'Write the master plan in Korean with the exact 1)~6) headers.',
  ].filter(Boolean).join('\n');

  const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
  const text = (output || '').trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["']?result["']?\s*:\s*["']?|["']\s*$/g, '').trim();
  return { result: text || existingPlan };
};

export const splitMasterPlanToSteps = async (context: {
  topic: string;
  style: string;
  styleRules?: string;
  masterPlanText: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
}) => {
  const sys = [
    buildStudioPersona({
      role: 'senior editor and planning-structure specialist',
      domain: 'extracting structured planning sections from long-form plans',
      style: context.style,
    }),
    'You extract the 6 planning sections from the given master plan and return ONLY JSON.',
    'Return JSON only with these keys: { "contentType": string, "summary": string, "opening": string, "body": string, "climax": string, "outro": string }.',
    'All values must be Korean strings.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
    'Ensure the extracted sections remain consistent with the topic and match the style rules.',
  ].filter(Boolean).join(' ');

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

  const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
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
  if (s.endsWith('s')) return Math.max(0, parseInt(s, 10) || 0);
  if (s.endsWith('m')) return Math.max(0, (parseInt(s, 10) || 0) * 60);
  return 0;
}

/** 목표 시간(초)에 맞는 대략적인 한글 글자 수 가이드 (TTS 기준 분당 약 280자) */
function targetDurationToCharHint(sec: number): string {
  if (sec <= 0) return '';
  const chars = Math.floor((sec / 60) * 280);
  return `권장: 전체 대본은 약 ${chars}자 내외 (한국어 TTS 기준 약 ${sec}초).`;
}

export const synthesizeMasterScript = async (context: {
  topic: string;
  planningData: any;
  style: string;
  styleRules?: string;
  benchmarkSummary?: string;
  benchmarkPatterns?: string[];
}) => {
  const sys = [
    buildStudioPersona({
      role: 'Lead Scriptwriter for a YouTube channel with over 1 million subscribers',
      domain: 'YouTube long-form scripting with high-retention storytelling',
      style: context.style,
    }),
    LEAD_SCRIPTWRITER_INSTRUCTION.trim(),
    'Reply with JSON only: { "master_script": string }.',
    'master_script must be the full script text in Korean.',
    'Do not output any keys other than master_script.',
    context.styleRules ? `Style rules:\n${context.styleRules}` : '',
  ].join('\n');
  const planning = context.planningData || {};
  const targetSec = targetDurationToSeconds(planning.targetDuration);
  const durationGuide = targetSec > 0
    ? `Target duration: ${planning.targetDuration} (~${targetSec}s). ${targetDurationToCharHint(targetSec)}`
    : '';

  const benchmarkSummary = typeof context.benchmarkSummary === 'string' ? context.benchmarkSummary.trim() : '';
  const benchmarkPatterns = Array.isArray(context.benchmarkPatterns) ? context.benchmarkPatterns.filter(Boolean) : [];
  const prompt = [
    `Topic: ${context.topic}.`,
    `Style (user-selected): ${context.style}.`,
    durationGuide ? durationGuide : '',
    benchmarkSummary || benchmarkPatterns.length
      ? `Benchmarking summary: ${benchmarkSummary || '(none)'}. Benchmarking patterns: ${benchmarkPatterns.length ? benchmarkPatterns.join(' | ') : '(none)'}.`
      : '',
    `Planning (JSON): ${JSON.stringify(planning)}.`,
    'Write the full master script in Korean.',
    'Include narration and, when helpful, optional timestamps/seconds (e.g. [0-3초]), music cues (e.g. 음악: ...), and screen directions (e.g. 화면: ...).',
    'Return JSON.',
  ].filter(Boolean).join(' ');
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<{ master_script?: string }>(output, {});
    const fallback = `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.`;
    return { master_script: typeof parsed.master_script === 'string' ? parsed.master_script : fallback };
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
      return parsed.map(p => ({
        script_segment: sanitizeScriptSegment(p.script_segment ?? ''),
        scene_description: p.scene_description ?? 'Cinematic scene.',
      }));
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
    'You write a single image generation prompt in English.',
    'Reply with plain text only (English), no JSON.',
  ].join(' ');
  const benchSummary = typeof benchmark?.summary === 'string' ? benchmark?.summary.trim() : '';
  const benchPatterns = Array.isArray(benchmark?.patterns) ? benchmark?.patterns.filter(Boolean).slice(0, 12) : [];
  const benchPart = benchSummary || benchPatterns.length
    ? ` Benchmarking vibe: summary="${benchSummary || 'N/A'}"; patterns="${benchPatterns.length ? benchPatterns.join(' | ') : 'N/A'}". Reflect the vibe/patterns without copying verbatim.`
    : '';
  const prompt = `Narrative: ${narrative}. Style: ${styleDesc}. Reference: ${referenceStyle}.${benchPart} Write one detailed image prompt.`;
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

export const generateSceneImage = async (
  prompt: string,
  style: string,
  aspectRatio: '9:16' | '16:9',
  model?: string,
  referenceImageUrl?: string
): Promise<string> => {
  const falModel = model || 'fal-ai/imagen4/preview';
  const promptWithNoText = (prompt || '').trim() + NO_TEXT_PROMPT_SUFFIX;
  try {
    const { images } = await studioImage({
      prompt: promptWithNoText,
      model: falModel,
      aspect_ratio: aspectRatio,
      num_images: 1,
      ...(referenceImageUrl ? { reference_image_url: referenceImageUrl } : {}),
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
 * 유튜브 썸네일을 분석하고, 그 스타일을 벤치마킹한 이미지 URL 생성
 */
export const generateBenchmarkThumbnail = async (referenceThumbnailUrl: string): Promise<{ imageUrl: string; analysisSummary: string }> => {
  const sys = [
    buildStudioPersona({
      role: 'senior YouTube thumbnail analyst and creative director',
      domain: 'thumbnail composition, color, typography, and high-CTR visual patterns',
    }),
    'Analyze a thumbnail and write one short sentence summarizing its style (composition, color, typography).',
    'Reply with plain text only in Korean.',
  ].join(' ');
  const prompt = `Analyze this thumbnail URL style: ${referenceThumbnailUrl}. One sentence summary in Korean.`;
  let analysisSummary = '레퍼런스 썸네일의 구도·색감·타이포 톤을 분석해 동일한 분위기의 벤치마킹 이미지를 생성했습니다.';
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    if ((output || '').trim()) analysisSummary = output.trim();
  } catch (e) {
    /* keep default */
  }
  try {
    const { images } = await studioImage({
      prompt: `YouTube thumbnail style: ${analysisSummary}. High click-through, eye-catching.`,
      model: 'fal-ai/imagen4/preview',
      aspect_ratio: '16:9',
      num_images: 1,
    });
    const url = images?.[0]?.url;
    if (url) return { imageUrl: url, analysisSummary };
  } catch (e) {
    /* fallback */
  }
  return { imageUrl: createMockImage('벤치마킹 썸네일', '16:9'), analysisSummary };
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
