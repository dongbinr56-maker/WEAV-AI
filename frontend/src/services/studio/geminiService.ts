const LEAD_SCRIPTWRITER_INSTRUCTION = `
# Role
You are the Lead Scriptwriter for a YouTube channel with over 1 million subscribers. You specialize in "High Retention Storytelling."
Your goal is to write a script so engaging that viewers cannot skip a single second, regardless of the topic.
`;

const mockDelay = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));

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
  await mockDelay();
  return {
    niche: [
      `${input} 기반의 간결한 메시지`,
      "짧은 길이, 높은 몰입감",
      "명확한 CTA와 리듬감"
    ],
    trending: ["Short-form 스토리텔링", "데스크테리어/무드", "AI 활용 제작"],
    confidence: mode === 'tag' ? 82 : 88
  };
};

export const generateTopics = async (context: { tags: string[], description: string, urlData: any }) => {
  await mockDelay();
  const base = context.tags.length ? context.tags[0] : "콘텐츠";
  return {
    topics: mockTopics.map(t => `${base} · ${t}`).slice(0, 12)
  };
};

export const analyzeUrlPattern = async (url: string) => {
  await mockDelay();
  return {
    summary: "고정된 인트로와 짧은 하이라이트 구조",
    patterns: ["3초 내 훅", "단문 자막", "마지막 CTA"]
  };
};

export const generatePlanningStep = async (stepName: string, context: any) => {
  await mockDelay();
  return {
    result: `[${stepName}] 핵심을 한 문장으로 정리하고, 3단계 전개로 압축합니다. 주제: ${context.topic}`
  };
};

export const synthesizeMasterScript = async (context: { topic: string, planningData: any, style: string }) => {
  await mockDelay();
  return {
    master_script: `제목: ${context.topic}\n\n오프닝: 오늘은 ${context.topic}의 핵심을 60초 안에 정리합니다.\n본문: 핵심 포인트 1, 2, 3을 짧고 명확하게 전달합니다.\n클라이맥스: 가장 중요한 인사이트를 한 문장으로 강조합니다.\n아웃트로: 다음 영상 예고와 구독 CTA로 마무리합니다.`
  };
};

export const splitScriptIntoScenes = async (fullScript: string) => {
  await mockDelay();
  return [
    { script_segment: "오프닝: 시청자의 관심을 끄는 한 문장 훅.", scene_description: "Minimal studio, neon rim light, close-up." },
    { script_segment: "본문: 핵심 포인트 1~2를 빠르게 전달.", scene_description: "Clean desk, soft shadows, cinematic framing." },
    { script_segment: "마무리: 요약 및 CTA.", scene_description: "Dark gradient background, subtle light beam." }
  ];
};

/**
 * 업로드된 레퍼런스 이미지 분석
 */
export const analyzeReferenceImage = async (base64Image: string) => {
  await mockDelay(200);
  return "Minimal dark studio lighting, soft rim light, matte textures, premium cinematic mood.";
};

/**
 * 상세 이미지 프롬프트 생성
 */
export const generateScenePrompt = async (narrative: string, styleDesc: string, referenceStyle: string) => {
  await mockDelay();
  return `Cinematic frame, ${styleDesc}. ${referenceStyle}. Scene: ${narrative}`;
};

export const generateSceneImage = async (prompt: string, style: string, aspectRatio: "9:16" | "16:9") => {
  await mockDelay(500);
  return createMockImage(style || "Scene", aspectRatio);
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
  await mockDelay(800);
  const topic = context.topic || "영상 주제";
  const duration = context.targetDuration || "1m";
  return {
    title: `${topic} | 60초 요약으로 핵심만 정리`,
    description: `${topic}에 대한 핵심 내용을 짧고 명확하게 정리했습니다.\n\n📌 타임라인\n0:00 오프닝\n0:10 본문 파트 1\n0:25 본문 파트 2\n0:40 클라이맥스\n0:55 아웃트로 & 구독 CTA\n\n#${topic.replace(/\s/g, "_")} #숏폼 #요약 #WEAV스튜디오 #영상제작 #AI`,
    pinnedComment: `📌 이 영상은 WEAV AI 스튜디오로 제작되었습니다.\n궁금한 점이나 다음에 다뤄줬으면 하는 주제가 있으면 댓글로 남겨주세요. 구독과 좋아요는 다음 영상 제작에 큰 힘이 됩니다 🙏`,
  };
};

/**
 * 유튜브 썸네일을 분석하고, 그 스타일을 벤치마킹한 이미지 URL 생성
 * (실제 연동 시 레퍼런스 이미지 분석 + 이미지 생성 API 호출)
 */
export const generateBenchmarkThumbnail = async (referenceThumbnailUrl: string): Promise<{ imageUrl: string; analysisSummary: string }> => {
  await mockDelay(1200);
  return {
    imageUrl: createMockImage("벤치마킹 썸네일", "16:9"),
    analysisSummary: "레퍼런스 썸네일의 구도·색감·타이포 톤을 분석해 동일한 분위기의 벤치마킹 이미지를 생성했습니다. 클릭률 테스트용 A/B 후보로 활용할 수 있습니다.",
  };
};
