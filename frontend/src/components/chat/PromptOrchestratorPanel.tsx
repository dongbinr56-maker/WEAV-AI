import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Copy, Sparkles } from 'lucide-react';

type PromptVariant = 'short' | 'precise' | 'creative';

type PromptBundle = Record<PromptVariant, string>;

type PromptOrchestratorPanelProps = {
  open: boolean;
  onToggle: () => void;
  showTrigger?: boolean;
  triggerTopClassName?: string;
  panelWidth: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
};

type PromptProfile = {
  intent: string;
  domain: string;
  taskType: string;
  outputFormat: string;
  tone: string;
  role: string;
};

const VARIANT_LABELS: Record<PromptVariant, string> = {
  short: '짧게',
  precise: '정밀하게',
  creative: '크리에이티브',
};

function inferPromptProfile(task: string, context: string, outputFormat: string): PromptProfile {
  const joined = `${task} ${context}`.toLowerCase();
  const has = (keywords: string[]) => keywords.some((keyword) => joined.includes(keyword));

  let domain = '일반';
  let role = '문제 해결형 AI 컨설턴트';
  if (has(['마케팅', '광고', '트래픽', 'sns', '콘텐츠'])) {
    domain = '마케팅';
    role = '성과 중심 마케팅 전략가';
  } else if (has(['매출', '브랜드', '사업', '고객', '세일즈'])) {
    domain = '비즈니스';
    role = '실행 중심 비즈니스 코치';
  } else if (has(['개발', '코드', 'api', '버그', '앱', '웹'])) {
    domain = '개발';
    role = '제품/개발 실행 아키텍트';
  } else if (has(['공부', '시험', '학습', '요약', '암기'])) {
    domain = '학습';
    role = '학습 설계 멘토';
  }

  let tone = '실무형';
  if (has(['냉정', '직설', '팩트', '독설'])) tone = '직설형';
  if (has(['친절', '쉽게', '초보'])) tone = '친절형';

  let taskType = '실행 계획';
  if (has(['아이디어', '브레인스토밍', '기획'])) taskType = '아이디어 발굴';
  if (has(['분석', '진단', '리뷰'])) taskType = '상황 분석';

  let intent = '작업 목표를 빠르게 달성';
  if (taskType === '아이디어 발굴') intent = '실행 가능한 아이디어 확보';
  if (taskType === '상황 분석') intent = '현재 문제의 원인 파악';

  return {
    intent,
    domain,
    taskType,
    outputFormat: outputFormat || '체크리스트 + 우선순위',
    tone,
    role,
  };
}

function buildPromptBundle(
  task: string,
  context: string,
  constraints: string,
  outputFormat: string
): { prompts: PromptBundle; reasons: string[] } {
  const profile = inferPromptProfile(task, context, outputFormat);
  const contextText = context || '상황 설명 없음';
  const constraintText = constraints || '별도 제약 없음';
  const formatText = profile.outputFormat;

  const shortPrompt = [
    `당신은 ${profile.role}입니다.`,
    `목표: ${task}`,
    `현재 상황: ${contextText}`,
    `제약 조건: ${constraintText}`,
    `작업 요청: 지금 바로 실행 가능한 핵심 액션 5가지를 우선순위로 제시하세요.`,
    `출력 형식: ${formatText}`,
    `정보가 부족하면 시작 전에 핵심 질문을 최대 3개만 하세요.`,
  ].join('\n');

  const precisePrompt = [
    `당신은 ${profile.role}입니다. 아래 요청을 정확히 수행하세요.`,
    '',
    '[사용자 목적]',
    `- 핵심 의도: ${profile.intent}`,
    `- 작업 유형: ${profile.taskType}`,
    '',
    '[입력 데이터]',
    `- 작업 설명: ${task}`,
    `- 현재 상황: ${contextText}`,
    `- 제약 조건: ${constraintText}`,
    '',
    '[요구사항]',
    '1. 상황을 3줄로 진단하세요.',
    '2. 실행 계획을 우선순위 기준 1~5번으로 제시하세요.',
    '3. 각 계획마다 예상 효과/리스크/소요시간을 포함하세요.',
    '4. 지금 당장 시작 가능한 첫 행동 1개를 명확히 제시하세요.',
    '',
    '[출력 형식]',
    `- ${formatText}`,
    '- 한국어로 작성하고, 모호한 표현 없이 구체적으로 작성하세요.',
    '- 정보가 부족하면 시작 전에 핵심 질문 최대 3개만 먼저 제시하세요.',
  ].join('\n');

  const creativePrompt = [
    `당신은 ${profile.role}이자 창의적 문제 해결 파트너입니다.`,
    `내 목표는 "${task}" 입니다.`,
    '',
    '[맥락]',
    `- 현재 상황: ${contextText}`,
    `- 제약 조건: ${constraintText}`,
    '',
    '[요청]',
    '1. 관점이 다른 실행 아이디어를 5개 제안하세요. (안정형/공격형 섞어서)',
    '2. 각 아이디어마다 한 줄 훅(Hook)과 실행 첫 단계, 실패 방지 팁을 제시하세요.',
    '3. 최종 추천안 1개를 선택하고, 선택 이유를 3줄로 설명하세요.',
    '',
    '[출력 형식]',
    `- ${formatText}`,
    '- 톤: 명확하고 동기 부여되는 실전형 문체',
    '- 정보가 부족하면 시작 전에 핵심 질문 최대 3개만 먼저 제시하세요.',
  ].join('\n');

  const reasons = [
    `${profile.domain} 도메인 신호와 "${profile.taskType}" 유형을 기준으로 프롬프트 구조를 맞췄습니다.`,
    `요청한 출력 형태(${formatText})와 톤(${profile.tone})을 반영해 바로 실행 가능한 지시문으로 구성했습니다.`,
  ];

  return {
    prompts: {
      short: shortPrompt,
      precise: precisePrompt,
      creative: creativePrompt,
    },
    reasons,
  };
}

export function PromptOrchestratorPanel({
  open,
  onToggle,
  showTrigger = true,
  triggerTopClassName = 'top-40',
  panelWidth,
  minWidth,
  maxWidth,
  onResize,
}: PromptOrchestratorPanelProps) {
  const [task, setTask] = useState('');
  const [context, setContext] = useState('');
  const [constraints, setConstraints] = useState('');
  const [outputFormat, setOutputFormat] = useState('');
  const [activeVariant, setActiveVariant] = useState<PromptVariant>('precise');
  const [bundle, setBundle] = useState<PromptBundle | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [copyLabel, setCopyLabel] = useState('복사');
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

  const handleGenerate = () => {
    const trimmedTask = task.trim();
    if (!trimmedTask) {
      setError('진행하고 싶은 작업을 입력해 주세요.');
      return;
    }
    setError('');
    const generated = buildPromptBundle(trimmedTask, context.trim(), constraints.trim(), outputFormat.trim());
    setBundle(generated.prompts);
    setReasons(generated.reasons);
    setActiveVariant('precise');
    setCopyLabel('복사');
  };

  const handleCopy = async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(bundle[activeVariant]);
      setCopyLabel('복사됨');
      window.setTimeout(() => setCopyLabel('복사'), 1200);
    } catch {
      setCopyLabel('실패');
      window.setTimeout(() => setCopyLabel('복사'), 1200);
    }
  };

  const activePrompt = bundle?.[activeVariant] ?? '';

  return (
    <>
      {!open && showTrigger && (
        <button
          type="button"
          onClick={onToggle}
          className={`fixed right-0 ${triggerTopClassName} z-20 rounded-l-xl border border-border/65 bg-card/86 backdrop-blur-xl px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground`}
        >
          프롬프트 조립기
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
              <Sparkles size={16} />
              프롬프트 조립기
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
                <span className="text-xs font-semibold text-muted-foreground">무슨 작업을 하고 싶나요?</span>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="예: 퇴근 후 1시간으로 가능한 AI 부업의 첫 주 실행 계획 만들기"
                  className="mt-1 h-20 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">현재 상황</span>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="예: 직장인, 마케팅 경력 3년, 하루 1시간 가능, 예산 10만원"
                  className="mt-1 h-16 w-full rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">제약 조건</span>
                <input
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder="예: 초기 비용 최소, 주말 제외, 안정형 선호"
                  className="mt-1 h-9 w-full rounded-md border border-border/70 bg-secondary/55 px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">원하는 출력 형식</span>
                <input
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value)}
                  placeholder="예: 체크리스트 + 우선순위 + 시간표"
                  className="mt-1 h-9 w-full rounded-md border border-border/70 bg-secondary/55 px-3 text-sm outline-none focus:border-primary/50"
                />
              </label>
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <button
                type="button"
                onClick={handleGenerate}
                className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-secondary/55 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Sparkles size={14} />
                프롬프트 생성
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
                    <p className="text-xs font-semibold text-muted-foreground">완성 프롬프트</p>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Copy size={12} />
                      {copyLabel}
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap px-3 py-3 text-xs leading-relaxed text-foreground">
                    {activePrompt}
                  </pre>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground">생성 근거</p>
                  <p className="mt-1 text-xs text-muted-foreground">{reasons[0]}</p>
                  <p className="text-xs text-muted-foreground">{reasons[1]}</p>
                </div>
              </section>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
