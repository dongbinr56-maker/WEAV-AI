import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Sparkles, Wand2 } from 'lucide-react';
import { IMAGE_MODELS, imageModelSupportsReference } from '@/constants/models';
import {
  loadLocalbananaPromptBlocks,
  loadLocalbananaPromptLibrary,
  searchLocalbananaPromptLibrary,
  type LocalbananaPromptLibrarySearchResult,
} from '@/services/localbananaPromptLibrary';
import { translateToEnglish } from '@/services/studio/geminiService';

type PromptVariant = 'short' | 'precise' | 'creative';

type PromptBundle = Record<
  PromptVariant,
  {
    display: string;
    apply: string;
  }
>;

type ImagePromptBuilderPanelProps = {
  open: boolean;
  onToggle: () => void;
  showTrigger?: boolean;
  triggerTopClassName?: string;
  panelWidth: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  modelId: string;
  onApplyPrompt: (prompt: string) => void;
};

type ImagePromptProfile = {
  subject: string;
  style: string;
  mood: string;
  composition: string;
  environment: string;
  emphasis: string;
  negatives: string;
  outputIntent: string;
};

type PromptReferenceContext = LocalbananaPromptLibrarySearchResult | null;

type PromptJsonPayload = {
  subject: string;
  style: string;
  mood: string;
  composition: string;
  environment: string;
  must_keep: string[];
  avoid: string[];
  output_goal: string;
  final_prompt: string;
  negative_prompt: string;
};

const VARIANT_LABELS: Record<PromptVariant, string> = {
  short: '짧게',
  precise: '정밀하게',
  creative: '크리에이티브',
};

function containsKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

function toList(value: string): string[] {
  return value
    .split(/[,\n|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toJsonPrompt(payload: PromptJsonPayload): string {
  return JSON.stringify(payload, null, 2);
}

function cleanClause(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/g, '');
}

function joinPromptClauses(clauses: string[]): string {
  return clauses
    .map(cleanClause)
    .filter(Boolean)
    .join(', ');
}

function inferImageProfile(
  subject: string,
  style: string,
  composition: string,
  environment: string,
  emphasis: string,
  negatives: string,
  outputIntent: string
): ImagePromptProfile {
  const joined = `${subject} ${style} ${composition} ${environment} ${emphasis} ${outputIntent}`.toLowerCase();
  const has = (keywords: string[]) => keywords.some((keyword) => joined.includes(keyword));

  let normalizedStyle = style.trim();
  if (!normalizedStyle) {
    if (has(['광고', '제품', '브랜딩', '패키지'])) {
      normalizedStyle = 'clean commercial product photography, premium detail, polished lighting';
    } else if (has(['일러스트', '캐릭터', '애니', '만화'])) {
      normalizedStyle = 'stylized illustration, strong silhouette, clean rendering';
    } else if (has(['포스터', '타이포', '그래픽'])) {
      normalizedStyle = 'editorial poster design, bold graphic composition';
    } else {
      normalizedStyle = 'cinematic, highly detailed, visually intentional';
    }
  }

  let normalizedMood = 'focused, polished, premium';
  if (has(['감성', '따뜻', '포근', 'nostalgic', '빈티지'])) normalizedMood = 'warm, nostalgic, intimate';
  if (has(['차갑', '미니멀', '모던', 'clean'])) normalizedMood = 'minimal, crisp, restrained';
  if (has(['다크', '강렬', '긴장', 'dramatic'])) normalizedMood = 'dramatic, high tension, moody';
  if (has(['귀엽', 'cute', '발랄', '컬러풀'])) normalizedMood = 'playful, bright, charming';

  const normalizedComposition =
    composition.trim() ||
    (has(['인물', 'portrait', '셀카', '패션'])
      ? 'portrait framing, clean subject separation, camera-conscious composition'
      : 'clear focal point, layered depth, balanced composition');

  const normalizedEnvironment =
    environment.trim() ||
    (has(['스튜디오', '제품', '광고']) ? 'controlled studio environment with intentional background styling' : 'context-rich environment that supports the subject without clutter');

  const normalizedEmphasis =
    emphasis.trim() ||
    (has(['얼굴', '인물', 'portrait']) ? 'preserve facial identity, natural skin texture, believable expression' : 'preserve the core subject shape, texture, and readability');

  const normalizedNegatives =
    negatives.trim() ||
    'low quality, blurry details, distorted anatomy, extra fingers, awkward pose, messy background, flat lighting, oversaturated artifacts, unreadable text';

  const normalizedOutput =
    outputIntent.trim() ||
    (has(['썸네일', 'thumbnail', '유튜브']) ? 'thumbnail-ready, instantly readable, strong focal hierarchy' : 'high quality final image output');

  return {
    subject: subject.trim(),
    style: normalizedStyle,
    mood: normalizedMood,
    composition: normalizedComposition,
    environment: normalizedEnvironment,
    emphasis: normalizedEmphasis,
    negatives: normalizedNegatives,
    outputIntent: normalizedOutput,
  };
}

function getModelPromptHint(modelId: string): string {
  if (modelId === 'fal-ai/nano-banana-pro') {
    return 'Keep identity and reference consistency when a reference image is provided. Prioritize clean subject preservation over unnecessary variation.';
  }
  if (modelId === 'fal-ai/nano-banana-2') {
    return 'Favor a clean, direct scene description with explicit subject, composition, lighting, and material cues. Keep the prompt concise but concrete.';
  }
  if (modelId === 'kling-ai/kling-v1') {
    return 'Prioritize a strong single-image concept with clear subject readability and cinematic clarity.';
  }
  if (modelId === 'fal-ai/imagen4/preview') {
    return 'Use precise scene description, lighting, and material detail rather than vague adjectives.';
  }
  if (modelId === 'fal-ai/flux-pro/v1.1-ultra') {
    return 'Lean into tactile detail, lighting precision, and strong image structure.';
  }
  return 'Use concrete visual language with a clear focal subject and intentional composition.';
}

function buildImagePromptBundle(
  subject: string,
  style: string,
  composition: string,
  environment: string,
  emphasis: string,
  negatives: string,
  outputIntent: string,
  modelId: string,
  references: PromptReferenceContext
): { prompts: PromptBundle; reasons: string[] } {
  const profile = inferImageProfile(
    subject,
    style || references?.blockMatches.style[0]?.text || references?.styleHints[0] || '',
    composition || references?.blockMatches.composition[0]?.text || references?.compositionHints[0] || '',
    environment || references?.blockMatches.environment[0]?.text || references?.blockMatches.lighting[0]?.text || references?.environmentHints[0] || references?.lightingHints[0] || '',
    emphasis,
    negatives || references?.blockMatches.negative[0]?.text || references?.negativeHints[0] || '',
    outputIntent
  );
  const modelName = IMAGE_MODELS.find((model) => model.id === modelId)?.name ?? '현재 이미지 모델';
  const referenceHint = imageModelSupportsReference(modelId)
    ? 'If a reference image is attached, preserve identity, silhouette, and key reference cues unless explicitly changed.'
    : 'Do not assume a reference image is available; make the prompt self-sufficient.';
  const modelHint = getModelPromptHint(modelId);
  const topReferenceTitles = references?.topMatches.map((item) => item.title) ?? [];
  const shortPromptText = joinPromptClauses([
    profile.subject,
    profile.style,
    profile.composition,
    profile.environment,
  ]);

  const precisePromptText = joinPromptClauses([
    profile.subject,
    profile.style,
    `${profile.mood} mood`,
    profile.composition,
    profile.environment,
    profile.emphasis,
    profile.outputIntent,
  ]);

  const creativePromptText = joinPromptClauses([
    profile.subject,
    `${profile.style} with a ${profile.mood} mood`,
    profile.composition,
    profile.environment,
    `emphasize ${cleanClause(profile.emphasis).toLowerCase()}`,
    `designed for ${cleanClause(profile.outputIntent).toLowerCase()}`,
  ]);

  const buildPromptJsonPayload = (
    finalPrompt: string
  ): PromptJsonPayload => ({
    subject: profile.subject,
    style: profile.style,
    mood: profile.mood,
    composition: profile.composition,
    environment: profile.environment,
    must_keep: toList(profile.emphasis),
    avoid: toList(profile.negatives),
    output_goal: profile.outputIntent,
    final_prompt: finalPrompt,
    negative_prompt: profile.negatives,
  });

  const reasons = [
    `${modelName}에 맞춰 장면 설명, 구도, 강조 포인트 순으로 조립했습니다.`,
    topReferenceTitles.length
      ? `LocalBanana 코퍼스에서 의미 기반 유사도 검색 후 ${topReferenceTitles.slice(0, 3).join(', ')} 를 참고해 패턴을 반영했습니다.`
      : 'LocalBanana 유사 프롬프트 매치가 부족해 입력값 중심으로 조립했습니다.',
    modelHint,
    referenceHint,
    'subject/style/composition/environment/lighting/negative 블록을 분리해 재조합하도록 바꿨습니다.',
  ];

  return {
    prompts: {
      short: {
        display: toJsonPrompt(buildPromptJsonPayload(shortPromptText)),
        apply: shortPromptText,
      },
      precise: {
        display: toJsonPrompt(buildPromptJsonPayload(precisePromptText)),
        apply: precisePromptText,
      },
      creative: {
        display: toJsonPrompt(buildPromptJsonPayload(creativePromptText)),
        apply: creativePromptText,
      },
    },
    reasons,
  };
}

export function ImagePromptBuilderPanel({
  open,
  onToggle,
  showTrigger = true,
  triggerTopClassName = 'top-40',
  panelWidth,
  minWidth,
  maxWidth,
  onResize,
  modelId,
  onApplyPrompt,
}: ImagePromptBuilderPanelProps) {
  const [subject, setSubject] = useState('');
  const [style, setStyle] = useState('');
  const [composition, setComposition] = useState('');
  const [environment, setEnvironment] = useState('');
  const [emphasis, setEmphasis] = useState('');
  const [negatives, setNegatives] = useState('');
  const [outputIntent, setOutputIntent] = useState('');
  const [activeVariant, setActiveVariant] = useState<PromptVariant>('precise');
  const [bundle, setBundle] = useState<PromptBundle | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [copyLabel, setCopyLabel] = useState('복사');
  const [applyLabel, setApplyLabel] = useState('입력창에 넣기');
  const [generating, setGenerating] = useState(false);
  const [references, setReferences] = useState<PromptReferenceContext>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      if (!resizeStart.current) return;
      const delta = resizeStart.current.x - e.clientX;
      const next = Math.min(maxWidth, Math.max(minWidth, resizeStart.current.width + delta));
      onResize(next);
    };
    const handleUp = () => {
      setResizing(false);
      resizeStart.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [maxWidth, minWidth, onResize, resizing]);

  useEffect(() => {
    if (!open) return;
    loadLocalbananaPromptLibrary().catch(() => {});
    loadLocalbananaPromptBlocks().catch(() => {});
  }, [open]);

  const normalizeForPrompt = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (!containsKorean(trimmed)) return trimmed;
    const translated = await translateToEnglish(trimmed);
    return translated || trimmed;
  };

  const handleGenerate = async () => {
    const trimmedSubject = subject.trim();
    if (!trimmedSubject) {
      setError('무엇을 만들지 먼저 입력해 주세요.');
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const [
        normalizedSubject,
        normalizedStyle,
        normalizedComposition,
        normalizedEnvironment,
        normalizedEmphasis,
        normalizedNegatives,
        normalizedOutputIntent,
      ] = await Promise.all([
        normalizeForPrompt(trimmedSubject),
        normalizeForPrompt(style),
        normalizeForPrompt(composition),
        normalizeForPrompt(environment),
        normalizeForPrompt(emphasis),
        normalizeForPrompt(negatives),
        normalizeForPrompt(outputIntent),
      ]);

      const referenceMatches = await searchLocalbananaPromptLibrary({
        subject: normalizedSubject,
        style: normalizedStyle,
        composition: normalizedComposition,
        environment: normalizedEnvironment,
        emphasis: normalizedEmphasis,
        negatives: normalizedNegatives,
        outputIntent: normalizedOutputIntent,
      }).catch(() => null);

      const generated = buildImagePromptBundle(
        normalizedSubject,
        normalizedStyle,
        normalizedComposition,
        normalizedEnvironment,
        normalizedEmphasis,
        normalizedNegatives,
        normalizedOutputIntent,
        modelId,
        referenceMatches
      );
      setBundle(generated.prompts);
      setReasons(generated.reasons);
      setReferences(referenceMatches);
      setActiveVariant('precise');
      setCopyLabel('복사');
      setApplyLabel('입력창에 넣기');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(bundle[activeVariant].display);
      setCopyLabel('복사됨');
      window.setTimeout(() => setCopyLabel('복사'), 1200);
    } catch {
      setCopyLabel('실패');
      window.setTimeout(() => setCopyLabel('복사'), 1200);
    }
  };

  const handleApply = () => {
    if (!bundle) return;
    onApplyPrompt(bundle[activeVariant].apply);
    setApplyLabel('삽입됨');
    window.setTimeout(() => setApplyLabel('입력창에 넣기'), 1200);
  };

  const activePrompt = bundle?.[activeVariant].display ?? '';

  return (
    <>
      {!open && showTrigger && (
        <button
          type="button"
          onClick={onToggle}
          className={`fixed right-0 ${triggerTopClassName} z-20 rounded-l-xl border border-border/65 bg-card/86 backdrop-blur-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground`}
        >
          이미지 프롬프트 생성기
        </button>
      )}
      <aside
        className={`chat-slide-panel fixed top-14 right-0 z-20 h-[calc(100vh-3.5rem)] w-full border-l border-border/65 bg-card/86 backdrop-blur-xl transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: panelWidth }}
      >
        {open && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setResizing(true);
              resizeStart.current = { x: e.clientX, width: panelWidth };
            }}
            className="chat-slide-panel__resizer absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/25"
            title="드래그하여 크기 조절"
          />
        )}
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 size={16} />
              이미지 프롬프트 생성기
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              aria-label="닫기"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            <section className="space-y-2">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">무엇을 만들고 싶나요?</span>
                <textarea
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="예: 비 오는 밤 네온 골목에서 서 있는 패션 에디토리얼 여성 인물"
                  className="mt-1 h-20 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">스타일 / 무드</span>
                <textarea
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="예: 시네마틱 에디토리얼, 무디한 분위기, 은은한 광택, 따뜻한 하이라이트"
                  className="mt-1 h-16 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">구도 / 카메라</span>
                <textarea
                  value={composition}
                  onChange={(e) => setComposition(e.target.value)}
                  placeholder="예: 허리 위 인물 구도, 50mm 렌즈 느낌, 얕은 심도, 중앙 프레이밍"
                  className="mt-1 h-16 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">배경 / 환경</span>
                <textarea
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  placeholder="예: 비 내리는 네온 골목, 젖은 아스팔트 반사, 옅은 안개, 겹겹이 보이는 간판"
                  className="mt-1 h-16 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">반드시 살릴 요소</span>
                <input
                  value={emphasis}
                  onChange={(e) => setEmphasis(e.target.value)}
                  placeholder="예: 얼굴 디테일 유지, 검은 가죽 재킷 질감, 강한 시선"
                  className="mt-1 h-9 w-full rounded-md border border-border/70 bg-secondary/55 px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">빼고 싶은 요소</span>
                <input
                  value={negatives}
                  onChange={(e) => setNegatives(e.target.value)}
                  placeholder="예: 흐릿한 디테일, 손가락 오류, 복잡한 배경, 밋밋한 조명"
                  className="mt-1 h-9 w-full rounded-md border border-border/70 bg-secondary/55 px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">용도 / 출력 힌트</span>
                <input
                  value={outputIntent}
                  onChange={(e) => setOutputIntent(e.target.value)}
                  placeholder="예: 4:5 인스타 포스트, 썸네일용, 제품 상세페이지 메인 컷"
                  className="mt-1 h-9 w-full rounded-md border border-border/70 bg-secondary/55 px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Sparkles size={14} />
                {generating ? '영문 프롬프트 생성 중...' : '프롬프트 생성'}
              </button>
            </section>

            {bundle && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  {(Object.keys(VARIANT_LABELS) as PromptVariant[]).map((variant) => (
                    <button
                      key={variant}
                      type="button"
                      onClick={() => {
                        setActiveVariant(variant);
                        setCopyLabel('복사');
                        setApplyLabel('입력창에 넣기');
                      }}
                      className={`rounded-md border px-2.5 py-1 text-xs ${
                        activeVariant === variant
                          ? 'border-primary/45 bg-primary/12 text-foreground'
                          : 'border-border/70 bg-background/70 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {VARIANT_LABELS[variant]}
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/18">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">완성 프롬프트 JSON</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleApply}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Wand2 size={12} />
                        {applyLabel}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Copy size={12} />
                        {copyLabel}
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] px-3 py-3 text-xs leading-relaxed text-foreground">
                    {activePrompt}
                  </pre>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground">생성 근거</p>
                  {reasons.map((reason) => (
                    <p key={reason} className="mt-1 text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
                      {reason}
                    </p>
                  ))}
                </div>
                {references?.topMatches?.length ? (
                  <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">참고한 LocalBanana 프롬프트</p>
                    <div className="mt-2 space-y-2">
                      {references.topMatches.map((item) => (
                        <a
                          key={item.url}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block min-w-0 rounded-md border border-border/60 bg-secondary/35 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <div className="font-medium text-foreground break-words [overflow-wrap:anywhere]">{item.title}</div>
                          <div className="mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">{item.keywords.join(', ')}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                {references ? (
                  <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                    <p className="text-xs font-semibold text-muted-foreground">선택된 블록</p>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">
                      {references.blockMatches.style[0] ? (
                        <p><span className="font-medium text-foreground">Style</span>: {references.blockMatches.style[0].text}</p>
                      ) : null}
                      {references.blockMatches.composition[0] ? (
                        <p><span className="font-medium text-foreground">Composition</span>: {references.blockMatches.composition[0].text}</p>
                      ) : null}
                      {references.blockMatches.environment[0] ? (
                        <p><span className="font-medium text-foreground">Environment</span>: {references.blockMatches.environment[0].text}</p>
                      ) : null}
                      {references.blockMatches.lighting[0] ? (
                        <p><span className="font-medium text-foreground">Lighting</span>: {references.blockMatches.lighting[0].text}</p>
                      ) : null}
                      {references.blockMatches.negative[0] ? (
                        <p><span className="font-medium text-foreground">Negative</span>: {references.blockMatches.negative[0].text}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
