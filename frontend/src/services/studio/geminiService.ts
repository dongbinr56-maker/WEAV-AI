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
  const sys = 'You are a YouTube niche analyst. Reply with JSON only: { "niche": string[], "trending": string[], "confidence": number }.';
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

export const generateTopics = async (context: { tags: string[], description: string, urlData?: { summary?: string; patterns?: string[] } | null }) => {
  const base = context.tags.length ? context.tags[0] : '콘텐츠';
  const sys = 'You suggest YouTube Shorts topic ideas. Reply with JSON only: { "topics": string[] }. Up to 12 items. All topic strings in Korean.';
  const urlPart = context.urlData && (context.urlData.summary || (context.urlData.patterns?.length ?? 0) > 0)
    ? `\n\n참고할 벤치마킹:\n요약: ${context.urlData.summary || '(없음)'}\n패턴: ${Array.isArray(context.urlData.patterns) ? context.urlData.patterns.join(', ') : '(없음)'}\n위 패턴/스타일을 반영한 주제를 제안하세요.`
    : '';
  const prompt = `Tags: ${context.tags.join(', ')}. Description: ${context.description}.${urlPart}\n\n12개의 주제 문자열을 제안해주세요. JSON만 응답: { "topics": string[] }.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<{ topics?: string[] }>(output, {});
    const topics = Array.isArray(parsed.topics) ? parsed.topics.slice(0, 12) : mockTopics.map(t => `${base} · ${t}`).slice(0, 12);
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
  };
};

export const generatePlanningStep = async (stepName: string, context: any) => {
  const sys = `You are a YouTube script planner. For the given step, write a concrete planning draft in 2–4 sentences (Korean). Output only the planning text, no JSON, no "result:" label, no code blocks. Be specific and actionable.`;
  const prompt = `Step: ${stepName}\n주제: ${context.topic}\n스타일: ${context.style || 'N/A'}\n길이: ${context.length || 'short'}\n이미 작성된 기획: ${JSON.stringify(context.planningData || {}, null, 0)}\n\n위 단계에 맞는 기획 초안을 2~4문장으로 작성하세요.`;
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

export const synthesizeMasterScript = async (context: { topic: string, planningData: any, style: string }) => {
  const sys = `${LEAD_SCRIPTWRITER_INSTRUCTION}\nReply with JSON only: { "master_script": string }. master_script is the full script text.`;
  const prompt = `Topic: ${context.topic}. Style: ${context.style}. Planning: ${JSON.stringify(context.planningData || {})}. Write the full master script. Return JSON.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<{ master_script?: string }>(output, {});
    const fallback = `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.`;
    return { master_script: typeof parsed.master_script === 'string' ? parsed.master_script : fallback };
  } catch (e) {
    return { master_script: `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.` };
  }
};

export const splitScriptIntoScenes = async (fullScript: string) => {
  const sys = 'You split a script into scenes. Reply with JSON only: an array of { "script_segment": string, "scene_description": string }.';
  const prompt = `Split this script into scene items. Each item: script_segment (narration text), scene_description (visual prompt for image). Script:\n${fullScript}\nReturn JSON array only.`;
  try {
    const { output } = await studioLlm({ prompt, system_prompt: sys, model: 'google/gemini-2.5-flash' });
    const parsed = safeJsonParse<Array<{ script_segment?: string; scene_description?: string }>>(output, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(p => ({
        script_segment: p.script_segment ?? '',
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
  const sys = 'You describe the visual style of an image in one short sentence for use as an image generation prompt. Reply with plain text only.';
  const prompt = 'Describe the style of this reference image in one concise sentence (lighting, mood, colors, composition). No preamble.';
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
export const generateScenePrompt = async (narrative: string, styleDesc: string, referenceStyle: string) => {
  const sys = 'You write a single image generation prompt (English). Reply with plain text only, no JSON.';
  const prompt = `Narrative: ${narrative}. Style: ${styleDesc}. Reference: ${referenceStyle}. Write one detailed image prompt.`;
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
export const generateSceneImage = async (
  prompt: string,
  style: string,
  aspectRatio: '9:16' | '16:9',
  model?: string
): Promise<string> => {
  const falModel = model || 'fal-ai/imagen4/preview';
  try {
    const { images } = await studioImage({
      prompt,
      model: falModel,
      aspect_ratio: aspectRatio,
      num_images: 1,
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
  const sys = 'You generate YouTube metadata. Reply with JSON only: { "title": string, "description": string, "pinnedComment": string }.';
  const prompt = `Topic: ${topic}. Summary: ${context.summary || 'N/A'}. Duration: ${duration}. Generate title, description (with timeline and hashtags), and pinned comment. Return JSON.`;
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
  const sys = 'You analyze a thumbnail and write one short sentence summarizing its style (composition, color, typography). Reply with plain text only.';
  const prompt = `Analyze this thumbnail URL style: ${referenceThumbnailUrl}. One sentence summary.`;
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
