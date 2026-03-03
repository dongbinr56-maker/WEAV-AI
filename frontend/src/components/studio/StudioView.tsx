
import React, { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';
import {
  X, History, Ghost, BookOpen, TrendingUp, Globe, MonitorPlay, ChevronRight, Flame, Loader2,
  CheckCircle2, PlayCircle, Layers, Trash2, Link as LinkIcon, Sparkles, Target, Terminal,
  Image as ImageIcon, Video, Wand2, Camera, Plus, Mic2, FileText, AlignLeft, Settings2,
	  Sliders, Music4, Activity, Smartphone, Monitor, PenTool, RefreshCcw, Utensils,
	  MessageCircle, Zap, Hash, Compass, Sword, Microscope, Palette, Map, Film, Heart, Gift,
	  Leaf, Smile, BarChart3, Box, CheckSquare, ImagePlus, ScanLine
	} from 'lucide-react';
import { StudioGlobalContextType, StudioScene, StudioScriptSegment, StudioAnalysisResult, StudioScriptPlanningData } from '@/types/studio';
import { 
  analyzeUrlPattern, generateTopics, generatePlanningStep, 
  rewritePlanningStep, generateMasterPlan, splitMasterPlanToSteps,
  synthesizeMasterScript, splitScriptIntoScenes, generateSceneImage,
  analyzeReferenceImage, generateScenePrompt, generateMetaData, generateBenchmarkThumbnail, translateToKorean
} from '@/services/studio/geminiService';
import { studioTts, uploadStudioReferenceImage, studioExport, studioExportJobStatus, studioExportJobCancel } from '@/services/studio/studioFalApi';
import { fetchTrendingByCategory, formatTrendingGrowth, type TrendingItemWithCategory } from '@/services/studio/trendingApi';

// --- [전역 상태 관리] ---
const GlobalContext = createContext<StudioGlobalContextType | undefined>(undefined);

const STORAGE_KEY_PREFIX = 'weav_studio_pro_v12';

function loadStoredStudio(storageKey: string): Record<string, unknown> | null {
  try {
    const s = localStorage.getItem(storageKey);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

	const GlobalProvider: React.FC<{ children: React.ReactNode; sessionId?: number }> = ({ children, sessionId }) => {
	  const storageKey = sessionId != null ? `${STORAGE_KEY_PREFIX}_${sessionId}` : STORAGE_KEY_PREFIX;
	  const stored = useMemo(() => loadStoredStudio(storageKey), [storageKey]);

	  const [currentStep, setCurrentStep] = useState<number>(() => (stored && typeof stored.currentStep === 'number') ? stored.currentStep : 1);
	  const [activeTags, setActiveTags] = useState<string[]>(() => Array.isArray(stored?.activeTags) ? stored.activeTags : []);
	  const [urlInput, setUrlInput] = useState(() => (typeof stored?.urlInput === 'string') ? stored.urlInput : '');
	  const [urlAnalysisData, setUrlAnalysisData] = useState<any>(() => (stored?.urlAnalysisData && typeof stored.urlAnalysisData === 'object') ? stored.urlAnalysisData : null);
	  const [selectedBenchmarkPatterns, setSelectedBenchmarkPatterns] = useState<string[]>(() => Array.isArray(stored?.selectedBenchmarkPatterns) ? stored.selectedBenchmarkPatterns as string[] : []);
	  const [isLoading, setIsLoading] = useState(false);
	  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
	  const [isDevMode, setIsDevMode] = useState(false);
  const [videoFormat, setVideoFormat] = useState(() => (typeof stored?.videoFormat === 'string') ? stored.videoFormat : '9:16');
  const [inputMode, setInputMode] = useState<'tag' | 'description'>(() => (stored?.inputMode === 'tag' || stored?.inputMode === 'description') ? stored.inputMode : 'tag');
  const [descriptionInput, setDescriptionInput] = useState(() => (typeof stored?.descriptionInput === 'string') ? stored.descriptionInput : '');
  const [isFileLoaded, setIsFileLoaded] = useState(false);

  const [masterScript, setMasterScript] = useState(() => (typeof stored?.masterScript === 'string') ? stored.masterScript : '');
  const [selectedStyle, setSelectedStyle] = useState(() => (typeof stored?.selectedStyle === 'string') ? stored.selectedStyle : 'Realistic');
  const [referenceImage, setReferenceImage] = useState(() => (typeof stored?.referenceImage === 'string') ? stored.referenceImage : '');
  const [referenceImageUrl, setReferenceImageUrl] = useState(() => (typeof stored?.referenceImageUrl === 'string') ? stored.referenceImageUrl : '');
  const [analyzedStylePrompt, setAnalyzedStylePrompt] = useState(() => (typeof stored?.analyzedStylePrompt === 'string') ? stored.analyzedStylePrompt : '');
  const [analyzedStylePromptKo, setAnalyzedStylePromptKo] = useState(() => (typeof stored?.analyzedStylePromptKo === 'string') ? stored.analyzedStylePromptKo : '');
	  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState(() => (typeof stored?.selectedVoicePresetId === 'string') ? stored.selectedVoicePresetId : 'ko-female-1');
	  const [subtitlesEnabled, setSubtitlesEnabled] = useState(() => (typeof stored?.subtitlesEnabled === 'boolean') ? stored.subtitlesEnabled : true);
	  const [burnInSubtitles, setBurnInSubtitles] = useState(() => (typeof stored?.burnInSubtitles === 'boolean') ? stored.burnInSubtitles : false);
	  const [videoUrl, setVideoUrl] = useState<string | null>(() => (typeof stored?.videoUrl === 'string' && stored.videoUrl) ? stored.videoUrl : null);
	  const [metaTitle, setMetaTitle] = useState(() => (typeof stored?.metaTitle === 'string') ? stored.metaTitle : '');
	  const [metaDescription, setMetaDescription] = useState(() => (typeof stored?.metaDescription === 'string') ? stored.metaDescription : '');
	  const [metaPinnedComment, setMetaPinnedComment] = useState(() => (typeof stored?.metaPinnedComment === 'string') ? stored.metaPinnedComment : '');
	  const [thumbnailData, setThumbnailData] = useState(() => {
	    const def = { thumbnails: [] as any[], ytUrlInput: '', ytThumbnailUrl: null as string | null };
	    if (stored?.thumbnailData && typeof stored.thumbnailData === 'object' && !Array.isArray(stored.thumbnailData)) {
	      const t = stored.thumbnailData as Record<string, unknown>;
	      const thumbs = Array.isArray(t.thumbnails) ? (t.thumbnails as any[]) : def.thumbnails;
	      return {
	        thumbnails: thumbs,
	        ytUrlInput: typeof t.ytUrlInput === 'string' ? (t.ytUrlInput as string) : def.ytUrlInput,
	        ytThumbnailUrl: typeof t.ytThumbnailUrl === 'string' ? (t.ytThumbnailUrl as string) : def.ytThumbnailUrl,
	      };
	    }
	    return def;
	  });

  const [analysisResult, setAnalysisResult] = useState<StudioAnalysisResult>({
    niche: [],
    trending: [],
    confidence: '--',
    error: null,
    isAnalyzing: false,
    isUrlAnalyzing: false
  });

	  const [scenes, setScenes] = useState<StudioScene[]>(() => Array.isArray(stored?.scenes) && stored.scenes.length > 0 ? stored.scenes as StudioScene[] : []);
	  const [sceneDurations, setSceneDurations] = useState<number[]>(() => Array.isArray(stored?.sceneDurations) ? (stored.sceneDurations as number[]) : []);
	  const [scriptSegments, setScriptSegments] = useState<StudioScriptSegment[]>([]);
	  const [generatedTopics, setGeneratedTopics] = useState<string[]>(() => Array.isArray(stored?.generatedTopics) ? stored.generatedTopics : []);
	  const [selectedTopic, setSelectedTopic] = useState(() => (typeof stored?.selectedTopic === 'string') ? stored.selectedTopic : '');
	  const [finalTopic, setFinalTopic] = useState(() => (typeof stored?.finalTopic === 'string') ? stored.finalTopic : '');
	  const [referenceScript, setReferenceScript] = useState('');
	  const [scriptStyle, setScriptStyle] = useState(() => (typeof stored?.scriptStyle === 'string') ? stored.scriptStyle : 'type-a');
	  const [customScriptStyleText, setCustomScriptStyleText] = useState(() => (typeof stored?.customScriptStyleText === 'string') ? stored.customScriptStyleText : '');
	  const [scriptLength, setScriptLength] = useState(() => (typeof stored?.scriptLength === 'string') ? stored.scriptLength : 'short');
	  const [masterPlan, setMasterPlan] = useState(() => (typeof stored?.masterPlan === 'string') ? stored.masterPlan : '');
	  const [planningData, setPlanningData] = useState<StudioScriptPlanningData>(() => {
    const def = { contentType: '', summary: '', opening: '', body: '', climax: '', outro: '', targetDuration: '1m' as string };
    if (stored?.planningData && typeof stored.planningData === 'object' && !Array.isArray(stored.planningData)) {
      const p = stored.planningData as Record<string, unknown>;
      return {
        contentType: typeof p.contentType === 'string' ? p.contentType : def.contentType,
        summary: typeof p.summary === 'string' ? p.summary : def.summary,
        opening: typeof p.opening === 'string' ? p.opening : def.opening,
        body: typeof p.body === 'string' ? p.body : def.body,
        climax: typeof p.climax === 'string' ? p.climax : def.climax,
        outro: typeof p.outro === 'string' ? p.outro : def.outro,
        targetDuration: typeof p.targetDuration === 'string' ? p.targetDuration : def.targetDuration
      };
    }
    return def;
  });

	  useEffect(() => {
	    const data = {
	      currentStep, activeTags, urlInput, urlAnalysisData, videoFormat, inputMode,
	      descriptionInput, scenes, sceneDurations, scriptStyle, customScriptStyleText, scriptLength, planningData,
	      selectedTopic, finalTopic, generatedTopics, masterPlan, masterScript, selectedStyle,
	      referenceImage, referenceImageUrl, analyzedStylePrompt, analyzedStylePromptKo,
	      selectedBenchmarkPatterns,
	      selectedVoicePresetId, subtitlesEnabled, burnInSubtitles,
	      videoUrl, metaTitle, metaDescription, metaPinnedComment, thumbnailData
	    };
	    localStorage.setItem(storageKey, JSON.stringify(data));
	  }, [
	    storageKey,
	    currentStep, activeTags, urlInput, urlAnalysisData, videoFormat, inputMode,
	    descriptionInput, scenes, sceneDurations, scriptStyle, customScriptStyleText, scriptLength, planningData,
	    selectedTopic, finalTopic, generatedTopics, masterPlan, masterScript, selectedStyle,
	    referenceImage, referenceImageUrl, analyzedStylePrompt, analyzedStylePromptKo,
	    selectedBenchmarkPatterns,
	    selectedVoicePresetId, subtitlesEnabled, burnInSubtitles,
	    videoUrl, metaTitle, metaDescription, metaPinnedComment, thumbnailData
	  ]);

  const value = {
    sessionId,
    currentStep, setCurrentStep,
    activeTags, setActiveTags,
    urlInput, setUrlInput, urlAnalysisData, setUrlAnalysisData,
    selectedBenchmarkPatterns, setSelectedBenchmarkPatterns,
    isLoading, setIsLoading,
    loadingMessage, setLoadingMessage,
    isDevMode, setIsDevMode,
    videoFormat, setVideoFormat,
    analysisResult, setAnalysisResult,
	    inputMode, setInputMode,
	    descriptionInput, setDescriptionInput,
	    scenes, setScenes,
	    sceneDurations, setSceneDurations,
	    scriptSegments, setScriptSegments,
	    generatedTopics, setGeneratedTopics,
	    selectedTopic, setSelectedTopic,
	    finalTopic, setFinalTopic,
	    referenceScript, setReferenceScript,
	    scriptStyle, setScriptStyle,
	    customScriptStyleText, setCustomScriptStyleText,
	    scriptLength, setScriptLength,
	    planningData, setPlanningData,
	    masterPlan, setMasterPlan,
    isFileLoaded, setIsFileLoaded,
    masterScript, setMasterScript,
    selectedStyle, setSelectedStyle,
    referenceImage, setReferenceImage,
    referenceImageUrl, setReferenceImageUrl,
    analyzedStylePrompt, setAnalyzedStylePrompt,
	    analyzedStylePromptKo, setAnalyzedStylePromptKo,
	    selectedVoicePresetId, setSelectedVoicePresetId,
	    subtitlesEnabled, setSubtitlesEnabled,
	    burnInSubtitles, setBurnInSubtitles,
	    videoUrl, setVideoUrl,
	    metaTitle, setMetaTitle,
	    metaDescription, setMetaDescription,
	    metaPinnedComment, setMetaPinnedComment,
	    thumbnailData, setThumbnailData
	  };

  return <GlobalContext.Provider value={value}>{children}</GlobalContext.Provider>;
};

const useGlobal = () => {
  const context = useContext(GlobalContext);
  if (!context) throw new Error("useGlobal must be used within GlobalProvider");
  return context;
};

// --- [공통 UI 컴포넌트] ---

const AutoResizeTextarea: React.FC<{ 
  value: string; 
  onChange: (val: string) => void; 
  placeholder: string;
  isHighlighted?: boolean;
  className?: string;
}> = ({ value, onChange, placeholder, isHighlighted, className }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <div className={`${isHighlighted ? 'ring-2 ring-primary/60 rounded-2xl' : ''}`}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`ui-textarea resize-none leading-relaxed overflow-hidden ${className || ''}`}
        rows={1}
      />
    </div>
  );
};

const StandardTagInput: React.FC = () => {
  const { activeTags, setActiveTags } = useGlobal();
  const [inputValue, setInputValue] = useState('');

  const addTag = useCallback((val: string) => {
    const tags = val.split(/[,\s]+/).map(t => t.trim().replace(/#/g, '')).filter(t => t.length > 0);
    if (tags.length > 0) {
      setActiveTags(prev => {
        const next = [...prev];
        tags.forEach(t => {
          if (!next.includes(t) && next.length < 15) next.push(t);
        });
        return next;
      });
    }
    setInputValue('');
  }, [setActiveTags]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && activeTags.length > 0) {
      setActiveTags(activeTags.slice(0, -1));
    }
  };

  return (
    <div className="planner-tagbox">
      {activeTags.map((tag, idx) => (
        <span key={idx} className="planner-tag">
          <Hash size={12} /> {tag}
          <button onClick={() => setActiveTags(activeTags.filter(t => t !== tag))} className="planner-tag__remove">
            <X size={12} />
          </button>
        </span>
      ))}
      <div className="planner-tagbox__field">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeTags.length === 0 ? "영상 키워드 입력 (엔터/콤마)" : "키워드 추가..."}
          className="planner-tagbox__input"
        />
        {inputValue && (
          <button onClick={() => addTag(inputValue)} className="planner-tagbox__add">
            <Plus size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

const SectionHeader = ({
  kicker,
  title,
  subtitle,
  right
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) => (
  <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
    <div className="space-y-3">
      <span className="ui-label">{kicker}</span>
      <h2 className="ui-title">{title}</h2>
      {subtitle && <p className="ui-subtitle max-w-2xl">{subtitle}</p>}
    </div>
    {right}
  </div>
);

// --- [Step 1: 기획 및 전략 분석] ---
const TopicAnalysisStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    activeTags, setActiveTags, analysisResult, setAnalysisResult, inputMode, setInputMode, descriptionInput, setDescriptionInput,
    videoFormat, setVideoFormat, urlInput, setUrlInput, setGeneratedTopics, urlAnalysisData, setUrlAnalysisData,
    selectedBenchmarkPatterns, setSelectedBenchmarkPatterns,
    isFileLoaded, setCurrentStep
  } = useGlobal();

  const [isTopicGenerating, setIsTopicGenerating] = useState(false);

  const [templateMode, setTemplateMode] = useState<'mainstream' | 'niche'>('mainstream');
  const [trendPeriod, setTrendPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [trendDataRaw, setTrendDataRaw] = useState<TrendingItemWithCategory[] | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);

  // 인기 카테고리: YouTube 공식 video category 한글 표기 (categoryId 기준)
  const mainstreamCategories = [
    { name: '뉴스/정치', icon: <Globe size={20} />, color: 'bg-secondary text-foreground', categoryId: '25' },
    { name: '여행/이벤트', icon: <Map size={20} />, color: 'bg-secondary text-foreground', categoryId: '19' },
    { name: '팁/스타일', icon: <Utensils size={20} />, color: 'bg-secondary text-foreground', categoryId: '26' },
    { name: '사람/블로그', icon: <Camera size={20} />, color: 'bg-secondary text-foreground', categoryId: '22' },
    { name: '과학/기술', icon: <Microscope size={20} />, color: 'bg-secondary text-foreground', categoryId: '28' },
    { name: '영화/애니메이션', icon: <Film size={20} />, color: 'bg-secondary text-foreground', categoryId: '1' },
    { name: '엔터테인먼트', icon: <Gift size={20} />, color: 'bg-secondary text-foreground', categoryId: '24' },
    { name: '교육', icon: <Activity size={20} />, color: 'bg-secondary text-foreground', categoryId: '27' },
  ];

  const nicheCategories = [
    { name: '미스터리', icon: <Ghost size={20} />, color: 'bg-secondary text-foreground', categoryId: '24' },
    { name: '전문가 노하우', icon: <PenTool size={20} />, color: 'bg-secondary text-foreground', categoryId: '27' },
    { name: '오프그리드', icon: <Leaf size={20} />, color: 'bg-secondary text-foreground', categoryId: '28' },
    { name: '골동품 복원', icon: <Settings2 size={20} />, color: 'bg-secondary text-foreground', categoryId: '26' },
    { name: '밀리터리', icon: <Sword size={20} />, color: 'bg-secondary text-foreground', categoryId: '20' },
    { name: '심리 상담', icon: <Heart size={20} />, color: 'bg-secondary text-foreground', categoryId: '22' },
    { name: '아카이브/역사', icon: <History size={20} />, color: 'bg-secondary text-foreground', categoryId: '27' },
    { name: '로컬 탐방', icon: <Compass size={20} />, color: 'bg-secondary text-foreground', categoryId: '19' },
  ];

  const categories = templateMode === 'mainstream' ? mainstreamCategories : nicheCategories;
  const selectedCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const name of activeTags) {
      const c = categories.find((cat) => cat.name === name && 'categoryId' in cat);
      if (c && 'categoryId' in c) ids.add((c as { categoryId: string }).categoryId);
    }
    return ids;
  }, [activeTags, categories]);

  const categoryFilterKey = useMemo(
    () => Array.from(selectedCategoryIds).sort().join(','),
    [selectedCategoryIds]
  );

  useEffect(() => {
    if (selectedCategoryIds.size === 0) {
      setTrendDataRaw(null);
      setTrendError(null);
      setTrendLoading(false);
      return;
    }
    let cancelled = false;
    const ids = Array.from(selectedCategoryIds);
    setTrendLoading(true);
    setTrendError(null);
    fetchTrendingByCategory(ids)
      .then((res) => {
        if (cancelled) return;
        if (res.error) setTrendError(res.error);
        if (res.items?.length) {
          const sorted = [...res.items].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
          setTrendDataRaw(sorted);
        } else {
          setTrendDataRaw(null);
        }
      })
      .catch(() => {
        if (!cancelled) setTrendDataRaw(null);
        setTrendError('트렌드를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => { cancelled = true; };
  }, [categoryFilterKey]);

  const trendDisplayLists = useMemo(() => {
    if (!trendDataRaw?.length) return { weekly: [], monthly: [] };
    const sorted = [...trendDataRaw].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    const mid = Math.ceil(sorted.length / 2);
    return {
      weekly: sorted.slice(0, mid),
      monthly: sorted.slice(mid),
    };
  }, [trendDataRaw]);

  const formatOptions = [
    { id: '9:16', label: '세로형', sub: 'Shorts / Reels', icon: <Smartphone size={16} /> },
    { id: '16:9', label: '가로형', sub: 'YouTube / Standard', icon: <Monitor size={16} /> }
  ];

  const runUrlAnalysis = async (url: string) => {
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube\.com\/shorts)\/.+$/;
    if (!ytRegex.test(url)) return showToast("유효한 유튜브 주소가 아닙니다.");
    
    setUrlAnalysisData(null);
    setAnalysisResult(p => ({ ...p, isUrlAnalyzing: true, error: null }));
    try {
      const result = await analyzeUrlPattern(url);
      setUrlAnalysisData(result);
      setAnalysisResult(p => ({
        ...p,
        isUrlAnalyzing: false,
        confidence: 85,
        niche: [result.summary, ...result.patterns.slice(0, 2)],
        trending: ["벤치마킹 데이터 로드 완료"]
      }));
      setSelectedBenchmarkPatterns([]);
      showToast(`패턴 분석이 완료되었습니다. (모드: ${benchmarkModeLabel((result as any)?.meta?.analysisMode)}) 패턴을 클릭해 선택한 뒤 주제 생성하기를 누르세요.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "URL 분석에 실패했습니다.";
      setUrlAnalysisData(null);
      setAnalysisResult(p => ({ ...p, isUrlAnalyzing: false, error: msg }));
      showToast(msg);
    }
  };

  const handleStartTopicGen = async () => {
    if (activeTags.length === 0 && !descriptionInput.trim()) return showToast("기획 정보를 입력해주세요.");
    setIsTopicGenerating(true);
    try {
      const urlData = urlAnalysisData
        ? {
            summary: urlAnalysisData.summary,
            patterns: selectedBenchmarkPatterns.length > 0 ? selectedBenchmarkPatterns : urlAnalysisData.patterns,
          }
        : null;
      const trendTitles = (trendDataRaw || []).slice(0, 20).map((t) => t.name).filter(Boolean);
      const res = await generateTopics({
        tags: activeTags,
        description: descriptionInput,
        urlData,
        trendData: trendTitles.length ? { titles: trendTitles } : null
      });
      setGeneratedTopics(res.topics);
      setCurrentStep(2);
    } catch (e) {
      showToast("주제 생성 실패.");
    } finally {
      setIsTopicGenerating(false);
    }
  };

  const toggleBenchmarkPattern = (pattern: string) => {
    setSelectedBenchmarkPatterns((prev) =>
      prev.includes(pattern) ? prev.filter((p) => p !== pattern) : [...prev, pattern]
    );
  };

  const benchmarkModeLabel = (mode: unknown) => {
    if (mode === 'youtube-url-video') return '직접 영상 분석 (YouTube URL)';
    if (mode === 'metadata-transcript-fallback') return '메타데이터/자막 기반 폴백';
    return '알 수 없음';
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 1 / Strategy"
        title="기획 분석"
        subtitle="아이디어를 정리하고, 시장과 콘텐츠 방향성을 빠르게 정교화합니다."
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-7 space-y-6">
          <div className="wf-panel">
            <div className="wf-panel__header">
              <div>
                <div className="wf-panel__title">설정</div>
              </div>
            </div>

            <div className="wf-split">
              <div className="wf-split__col">
                <div className="wf-subhead">
                  <span>영상 포맷</span>
                  <span className="wf-hint">콘텐츠 성격에 맞게 선택</span>
                </div>
                <div className="format-grid">
                  {formatOptions.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setVideoFormat(f.id)}
                      className={`format-option ${videoFormat === f.id ? 'is-active' : ''}`}
                    >
                      <span className="format-option__icon">{f.icon}</span>
                      <span className="format-option__text">
                        <span className="format-option__title">{f.label}</span>
                        <span className="format-option__meta">{f.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="wf-split__divider" />

              <div className="wf-split__col">
                <div className="wf-subhead">
                  <span>시장 카테고리</span>
                  <div className="planner-toggle">
                    <button onClick={() => setTemplateMode('mainstream')} className={`planner-toggle__item ${templateMode === 'mainstream' ? 'is-active' : ''}`}>인기</button>
                    <button onClick={() => setTemplateMode('niche')} className={`planner-toggle__item ${templateMode === 'niche' ? 'is-active' : ''}`}>틈새</button>
                  </div>
                </div>
                <div className="planner-chips">
                  {categories.map(c => (
                    <button
                      key={c.name}
                      onClick={() => setActiveTags(prev => prev.includes(c.name) ? prev.filter(x => x !== c.name) : [...prev, c.name].slice(0, 15))}
                      className={`planner-chip ${activeTags.includes(c.name) ? 'is-active' : ''}`}
                    >
                      <span className="planner-chip__icon">{c.icon}</span>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="wf-panel">
            <div className="wf-panel__header">
              <div>
                <div className="wf-panel__title">아이디어</div>
              </div>
              <div className="planner-tabs">
                <button onClick={() => setInputMode('tag')} className={`planner-tab ${inputMode === 'tag' ? 'is-active' : ''}`}>키워드</button>
                <button onClick={() => setInputMode('description')} className={`planner-tab ${inputMode === 'description' ? 'is-active' : ''}`}>설명</button>
              </div>
            </div>
            <div className="mb-3">
              {inputMode === 'tag' ? (
                <StandardTagInput />
              ) : (
                <div className="space-y-3">
                  {isFileLoaded && <span className="ui-badge"><FileText size={12} /> 파일 데이터 로드됨</span>}
                  <AutoResizeTextarea
                    value={descriptionInput}
                    onChange={setDescriptionInput}
                    placeholder="영상 기획 내용을 자유롭게 입력하세요."
                    className="min-h-[120px]"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="wf-panel">
            <div className="wf-panel__header">
              <div>
                <div className="wf-panel__title">벤치마킹</div>
              </div>
            </div>
            <div className="wf-inline">
              <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="참고할 유튜브 주소를 입력하세요..." className="ui-input" />
              <button onClick={() => runUrlAnalysis(urlInput)} disabled={analysisResult.isUrlAnalyzing} className="wf-secondary">
                {analysisResult.isUrlAnalyzing ? <><Loader2 size={14} className="animate-spin" /> 패턴 분석 중...</> : '패턴 분석'}
              </button>
            </div>
            {urlAnalysisData && (
              <div className="mt-4 p-4 rounded-xl bg-secondary/50 border border-border/70 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  패턴 분석 결과
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <div>
                    <span className="font-medium text-slate-700">분석 모드:</span>{' '}
                    {benchmarkModeLabel(urlAnalysisData?.meta?.analysisMode)}
                  </div>
                  {typeof urlAnalysisData?.meta?.model === 'string' && urlAnalysisData.meta.model.trim() && (
                    <div>
                      <span className="font-medium text-slate-700">모델:</span> {urlAnalysisData.meta.model}
                    </div>
                  )}
                  {urlAnalysisData?.meta?.directVideoAttempted && urlAnalysisData?.meta?.analysisMode === 'metadata-transcript-fallback' && (
                    <div>
                      <span className="font-medium text-slate-700">직접 영상 분석:</span>{' '}
                      실패 후 폴백됨
                      {typeof urlAnalysisData?.meta?.directVideoError === 'string' && urlAnalysisData.meta.directVideoError.trim()
                        ? ` (${urlAnalysisData.meta.directVideoError})`
                        : ''}
                    </div>
                  )}
                </div>

                {(urlAnalysisData?.content?.summary || (urlAnalysisData?.content?.keyPoints?.length ?? 0) > 0) && (
                  <div className="pt-2">
                    <span className="text-xs font-medium text-slate-500">1) 내용 벤치마킹 (상세)</span>
                    {urlAnalysisData?.content?.summary && (
                      <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{urlAnalysisData.content.summary}</p>
                    )}
                    {Array.isArray(urlAnalysisData?.content?.keyPoints) && urlAnalysisData.content.keyPoints.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-sm text-slate-800 space-y-1">
                        {urlAnalysisData.content.keyPoints.slice(0, 14).map((kp: string, i: number) => (
                          <li key={i}>{kp}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {urlAnalysisData.summary && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">2) 진행 방식/패턴 분석 (요약)</span>
                    <p className="mt-1 text-sm text-slate-800">{urlAnalysisData.summary}</p>
                  </div>
                )}
                {urlAnalysisData.patterns?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">패턴 (클릭하여 선택 후 주제 생성/기획에 반영)</span>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {urlAnalysisData.patterns.map((p: string, i: number) => {
                        const isSelected = selectedBenchmarkPatterns.includes(p);
                        return (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => toggleBenchmarkPattern(p)}
                              className={`px-2.5 py-1 rounded-md border text-sm transition-colors ${
                                isSelected
                                  ? 'bg-primary/16 border-primary/45 text-foreground'
                                  : 'bg-secondary/55 border-border/70 text-slate-700 hover:bg-secondary/75'
                              }`}
                            >
                              {p}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <button onClick={handleStartTopicGen} disabled={isTopicGenerating} className="wf-primary w-full mt-4">
              {isTopicGenerating ? <><Loader2 size={16} className="animate-spin" /> 주제 생성 중...</> : <><Sparkles size={16} /> 주제 생성하기</>}
            </button>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-6">
          <div className="wf-panel">
            <div className="wf-panel__header">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} />
                <span className="wf-label">Trend Signals</span>
              </div>
              <div className="planner-tabs">
                <button onClick={() => setTrendPeriod('monthly')} className={`planner-tab ${trendPeriod === 'monthly' ? 'is-active' : ''}`}>월간</button>
                <button onClick={() => setTrendPeriod('weekly')} className={`planner-tab ${trendPeriod === 'weekly' ? 'is-active' : ''}`}>일주일간</button>
              </div>
            </div>
            <div className="wf-list text-sm max-h-[420px] overflow-y-auto">
              {trendLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (() => {
                const list = trendPeriod === 'monthly' ? trendDisplayLists.monthly : trendDisplayLists.weekly;
                if (!list.length) {
                  const msg = trendError
                    ? (trendError.includes('YOUTUBE_API_KEY') ? 'YouTube API 키가 설정되지 않았습니다. (backend .env 또는 infra/.env)' : trendError)
                    : selectedCategoryIds.size === 0
                      ? '시장 카테고리를 선택하면 트렌드를 불러옵니다.'
                      : '선택한 카테고리에 해당하는 트렌드가 없습니다.';
                  return (
                    <div className="wf-empty py-8 text-muted-foreground text-center text-sm">
                      {msg}
                    </div>
                  );
                }
                return list.map((trend, idx) => (
                  <div key={idx} className="wf-node wf-node--compact">
                    <div className="wf-node__left">
                      <span className="wf-node__dot wf-node__dot--muted" />
                      <span>{trend.name}</span>
                    </div>
                    <span className="wf-node__status">{formatTrendingGrowth(trend)}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 2: 주제 선정] ---
const TopicGenerationStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { generatedTopics, selectedTopic, setSelectedTopic, finalTopic, setFinalTopic, setCurrentStep, setPlanningData, setMasterPlan, setMasterScript, setScenes } = useGlobal();
  const [manualTopic, setManualTopic] = useState('');

  const handleFinalize = async () => {
    const topic = selectedTopic === 'manual' ? manualTopic : selectedTopic;
    if (!topic) return showToast("분석에 사용할 주제를 선택하거나 직접 입력해주세요.");
    // Manual 입력인 경우 selectedTopic을 실제 텍스트로 확정
    if (selectedTopic === 'manual') setSelectedTopic(topic);
    if (finalTopic !== topic) {
      // 주제가 바뀌면 이후 단계 결과물을 초기화해서 불일치/혼선을 방지
      setMasterPlan('');
      setPlanningData((p) => ({ ...p, contentType: '', summary: '', opening: '', body: '', climax: '', outro: '' }));
      setMasterScript('');
      setScenes([]);
    }
    setFinalTopic(topic);
    setCurrentStep(3);
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1000px] mx-auto">
      <SectionHeader
        kicker="Step 2 / Topic"
        title="주제 선택"
        subtitle="AI가 추천한 주제 중 하나를 선택하거나 직접 입력하세요."
      />

      <div className="ui-card ui-card--flush overflow-hidden">
        {generatedTopics.map((topic, idx) => (
          <button
            key={idx}
            onClick={() => setSelectedTopic(topic)}
            className={`topic-row w-full flex items-center justify-between px-6 py-5 text-left transition-colors ${selectedTopic === topic ? 'is-selected' : ''}`}
          >
            <div className="flex items-center gap-4">
              <span className={`ui-step__num ${selectedTopic === topic ? 'is-selected' : ''}`}>{(idx + 1).toString().padStart(2, '0')}</span>
              <span className="text-base font-semibold">{topic}</span>
            </div>
            {selectedTopic === topic && <CheckCircle2 size={20} />}
          </button>
        ))}
      </div>

      <div className="ui-card space-y-3">
        <div className="flex items-center justify-between">
          <span className="ui-label">직접 입력</span>
          <button onClick={() => setSelectedTopic('manual')} className="ui-btn ui-btn--secondary">선택</button>
        </div>
        <textarea
          value={manualTopic}
          onChange={e => { setManualTopic(e.target.value); if (selectedTopic !== 'manual') setSelectedTopic('manual'); }}
          placeholder="직접 기획한 고유 주제를 입력하세요..."
          className="ui-textarea min-h-[120px]"
        />
      </div>

      <div className="flex justify-end">
        <button onClick={handleFinalize} disabled={!selectedTopic} className="ui-btn ui-btn--primary">
          주제 확정 및 시나리오 설계
        </button>
      </div>
    </div>
  );
};

// --- [Step 3: 대본 아키텍처] ---
const ScriptPlanningStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    selectedTopic, finalTopic, scriptStyle, setScriptStyle, scriptLength,
    planningData, setPlanningData, setCurrentStep,
    masterPlan, setMasterPlan,
    masterScript, setMasterScript,
    urlAnalysisData, selectedBenchmarkPatterns
  } = useGlobal();

  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<'architecture' | 'script'>('architecture');
  const [loadingStepKey, setLoadingStepKey] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [synthesizeProgress, setSynthesizeProgress] = useState<string | null>(null); 

  const archetypes = [
    { id: 'type-a', name: '내러티브 중심형', desc: '이야기의 흐름을 따라가는 몰입형 스토리', icon: <AlignLeft size={18} /> },
    { id: 'type-b', name: '정보 큐레이션형', desc: '핵심을 요약하여 전달하는 지식 전달형', icon: <Layers size={18} /> },
    { id: 'type-c', name: '심층 분석 브리핑', desc: '데이터와 근거 기반의 논리적 분석 스타일', icon: <Compass size={18} /> },
    { id: 'type-d', name: '감성 스토리텔링', desc: '공감과 무드를 강조하는 서정적 문체', icon: <BookOpen size={18} /> },
    { id: 'type-e', name: '속보/사건 보고형', desc: '빠른 팩트 전달 중심의 현장감 강조형', icon: <Zap size={18} /> },
    { id: 'type-f', name: 'POV (1인칭 관찰)', desc: '화자의 시선에서 생생하게 전달하는 방식', icon: <MessageCircle size={18} /> },
    { id: 'custom', name: '사용자 지정 스타일', desc: '고유의 개성을 담은 커스텀 디자인 문체', icon: <PenTool size={18} /> },
  ];

  const selectedArchetype = useMemo(
    () => archetypes.find((a) => a.id === scriptStyle) || null,
    [scriptStyle]
  );
  const styleLabelForPrompt = selectedArchetype
    ? `${selectedArchetype.name} — ${selectedArchetype.desc}`
    : scriptStyle;

  const topicForPlanning = (finalTopic || selectedTopic || '').trim();

  const benchmarkSummaryForPrompt = typeof (urlAnalysisData?.summary) === 'string' ? urlAnalysisData.summary : '';
  const benchmarkPatternsForPrompt = useMemo(() => {
    const all = Array.isArray(urlAnalysisData?.patterns) ? (urlAnalysisData.patterns as string[]) : [];
    const picked = Array.isArray(selectedBenchmarkPatterns) ? selectedBenchmarkPatterns : [];
    return (picked.length ? picked : all).filter(Boolean).slice(0, 12);
  }, [urlAnalysisData, selectedBenchmarkPatterns]);

  const styleRulesForPrompt = useMemo(() => {
    const rules: Record<string, string> = {
      'type-a': [
        '- Must feel like a narrative arc (hook → tension → payoff).',
        '- Use curiosity gaps and micro-cliffhangers between beats.',
        '- Avoid listicle/lecture tone; keep story momentum.',
      ].join('\n'),
      'type-b': [
        '- Must be a clear knowledge-delivery plan (key points, examples, takeaways).',
        '- Use crisp structure and scannable bullets; prioritize clarity over drama.',
        '- Avoid excessive emotional framing or cinematic narration.',
      ].join('\n'),
      'type-c': [
        '- Must be evidence-driven (claims → rationale → implications).',
        '- Include what to verify, what data/examples to use, and how to present them.',
        '- Avoid vague statements; separate facts vs assumptions explicitly.',
      ].join('\n'),
      'type-d': [
        '- Must be empathetic and mood-driven (emotion → reflection → gentle takeaway).',
        '- Use sensory/relatable moments; keep warmth and authenticity.',
        '- Avoid cold news/briefing tone or overly technical phrasing.',
      ].join('\n'),
      'type-e': [
        '- Must sound like breaking news / incident report: fast, factual, urgent.',
        '- Use the 5W1H structure (What/Where/When/Who/Why/Impact/What\'s next).',
        '- Short sentences, active voice, high tempo. Avoid long paragraphs.',
        '- No documentary narration, no poetic metaphors. If a fact is unknown, mark it as "확인 필요" and do not speculate.',
      ].join('\n'),
      'type-f': [
        '- Must be in 1st-person POV (I/me) with present-tense observation.',
        '- Show what the narrator sees/hears/thinks beat-by-beat.',
        '- Avoid third-person documentary voice or lecture tone.',
      ].join('\n'),
      'custom': [
        '- Follow the user-provided custom style exactly.',
        '- If custom style details are missing, ask implicitly by making assumptions explicit in the plan.',
      ].join('\n'),
    };
    return rules[scriptStyle] || '';
  }, [scriptStyle]);

  const steps = [
    { id: 1, key: 'contentType', name: '1) 콘텐츠 타입' },
    { id: 2, key: 'summary', name: '2) 전체 이야기 한 줄 요약' },
    { id: 3, key: 'opening', name: '3) 오프닝 기획' },
    { id: 4, key: 'body', name: '4) 본문 구성 설계 파트 별로' },
    { id: 5, key: 'climax', name: '5) 클라이맥스/ 핵심 메시지' },
    { id: 6, key: 'outro', name: '6) 아웃트로 설계' },
  ];

  const durations = [
    { id: '30s', label: '30초 (Short)', icon: <Flame size={14}/> },
    { id: '1m', label: '1분 (Standard)', icon: <Smartphone size={14}/> },
    { id: '3m', label: '3분 (Long)', icon: <MonitorPlay size={14}/> },
    { id: '5m', label: '5분 (Deep)', icon: <Film size={14}/> },
    { id: 'custom', label: '직접 입력', icon: <PenTool size={14}/> }
  ];

  const stepGuides: Record<string, string> = {
    contentType: "이 영상의 정체성을 정의합니다. 어떤 장르이며, 누구에게 어떤 가치를 주고자 하는지 명확히 하세요.",
    summary: "기획의 핵심 줄기를 잡는 과정입니다. 시청자가 기억하게 될 한 문장 메시지를 정의하세요.",
    opening: "첫 5초가 승부처입니다. 시청자의 시선을 즉시 사로잡을 수 있는 강력한 훅을 설계하세요.",
    body: "전달하고자 하는 정보를 논리적인 파트별로 배치합니다. 자연스러운 연결 고리를 설계하세요.",
    climax: "영상의 감정이 고조되거나 지식이 완결되는 가장 임팩트 있는 순간입니다.",
    outro: "영상의 여운을 남기는 마무리입니다. CTA를 명확히 설정하세요."
  };

  const runStepAI = async (key: string, name: string) => {
    setLoadingStepKey(key);
    try {
      const res = await generatePlanningStep(name, {
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        length: scriptLength,
        masterPlanText: masterPlan,
        planningData,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt
      });
      setPlanningData(p => ({ ...p, [key]: res.result }));
    } finally {
      setLoadingStepKey(null);
    }
  };

  const runRewriteAI = async (key: string, name: string, mode: 'expand' | 'compress' | 'style_stronger') => {
    const currentText = planningData[key as keyof StudioScriptPlanningData] || '';
    const loadingKey = `${key}:${mode}`;
    setLoadingStepKey(loadingKey);
    try {
      const instruction =
        mode === 'expand'
          ? 'Expand with more concrete beats, examples, and editing/graphic cues. Keep the same intent and style.'
          : mode === 'compress'
            ? 'Compress into a concise plan. Keep only the highest-value beats and remove redundancy.'
            : 'Strengthen the user-selected style and remove any tone drift. Make it unmistakably in-style.';
      const res = await rewritePlanningStep(name, {
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        currentText,
        mode,
        instruction,
        masterPlanText: masterPlan,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt
      });
      setPlanningData(p => ({ ...p, [key]: res.result }));
    } finally {
      setLoadingStepKey(null);
    }
  };

  const runAllStepsAI = async () => {
    if (!topicForPlanning) {
      showToast('주제가 확정되지 않았습니다. 2단계에서 주제를 확정해 주세요.');
      return;
    }
    setIsGeneratingAll(true);
    setLoadingStepKey('masterPlan');
    try {
      const master = await generateMasterPlan({
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        length: scriptLength,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt,
        existingMasterPlan: masterPlan,
        planningData
      });
      const masterText = (master.result || '').trim();
      if (!masterText) throw new Error('master plan empty');
      setMasterPlan(masterText);

      setLoadingStepKey('masterPlan:split');
      const split = await splitMasterPlanToSteps({
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        masterPlanText: masterText,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt
      });
      setPlanningData((p) => ({ ...p, ...split }));
      showToast('대단원 기획 생성 및 1~6 분할이 완료되었습니다.');
    } catch (e) {
      showToast('기획 생성에 실패했습니다.');
      console.error(e);
    } finally {
      setLoadingStepKey(null);
      setIsGeneratingAll(false);
    }
  };

  const runMasterPlanOnlyAI = async () => {
    if (!topicForPlanning) return showToast('주제가 확정되지 않았습니다. 2단계에서 주제를 확정해 주세요.');
    setLoadingStepKey('masterPlan');
    try {
      const res = await generateMasterPlan({
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        length: scriptLength,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt,
        existingMasterPlan: masterPlan,
        planningData
      });
      const text = (res.result || '').trim();
      if (text) {
        setMasterPlan(text);
        showToast('대단원 기획안이 생성되었습니다.');
      } else {
        showToast('대단원 기획안 생성에 실패했습니다.');
      }
    } catch (e) {
      showToast('대단원 기획안 생성에 실패했습니다.');
      console.error(e);
    } finally {
      setLoadingStepKey(null);
    }
  };

  const runSplitFromMasterPlan = async () => {
    if (!topicForPlanning) return showToast('주제가 확정되지 않았습니다. 2단계에서 주제를 확정해 주세요.');
    if (!masterPlan.trim()) return showToast('대단원 기획안이 비어 있습니다. 먼저 생성하거나 입력해 주세요.');
    setLoadingStepKey('masterPlan:split');
    try {
      const split = await splitMasterPlanToSteps({
        topic: topicForPlanning,
        style: styleLabelForPrompt,
        styleRules: styleRulesForPrompt,
        masterPlanText: masterPlan,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt
      });
      setPlanningData((p) => ({ ...p, ...split }));
      showToast('대단원 기획안을 1~6 파트로 분할했습니다.');
    } catch (e) {
      showToast('분할에 실패했습니다.');
      console.error(e);
    } finally {
      setLoadingStepKey(null);
    }
  };

  const handleSynthesizeScript = async () => {
    setSynthesizeProgress('통합 시나리오 생성 중...');
    try {
      const res = await synthesizeMasterScript({ 
        topic: topicForPlanning, 
        planningData, 
        style: styleLabelForPrompt || 'Standard',
        styleRules: styleRulesForPrompt,
        benchmarkSummary: benchmarkSummaryForPrompt,
        benchmarkPatterns: benchmarkPatternsForPrompt
      });
      setMasterScript(res.master_script);
      setReviewMode('script');
    } catch (e) {
      console.error(e);
    } finally {
      setSynthesizeProgress(null);
    }
  };

  const handleGoToVisualStep = () => {
    setIsPreviewOpen(false);
    setCurrentStep(4);
  };

  return (
    <div className="space-y-10 pb-24 relative max-w-[1200px] mx-auto">
      {isPreviewOpen && (
        <div className="fixed inset-0 z-[150] bg-background/86 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-5xl w-full ui-card relative space-y-6">
            <button onClick={() => setIsPreviewOpen(false)} className="ui-btn ui-btn--ghost absolute right-4 top-4">
              <X size={16} />
            </button>
            <div className="space-y-2 pr-10">
              <span className="ui-label">{reviewMode === 'architecture' ? '설계안 검토' : '시나리오 교정'}</span>
              <h2 className="font-serif text-2xl text-foreground">
                {reviewMode === 'architecture' ? '기획 파트 흐름 점검' : '완성 원고 확인'}
              </h2>
              <p className="text-sm text-slate-600">
                {reviewMode === 'architecture'
                  ? '작성된 파트를 검토한 뒤 통합 시나리오를 생성하세요.'
                  : '말투와 흐름을 다듬고 시각화 단계로 이동합니다.'}
              </p>
            </div>

            <div className="max-h-[55vh] overflow-y-auto scrollbar-hide pr-2">
              {reviewMode === 'architecture' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {steps.map(s => (
                    <div key={s.id} className="ui-card--muted space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="ui-label">{s.name}</span>
                        <span className="ui-pill">0{s.id}</span>
                      </div>
                      <AutoResizeTextarea
                        value={planningData[s.key as keyof StudioScriptPlanningData]}
                        onChange={v => setPlanningData(p => ({ ...p, [s.key]: v }))}
                        placeholder={`${s.name} 내용을 입력하세요...`}
                        className="min-h-[120px]"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ui-card--muted">
                  <AutoResizeTextarea
                    value={masterScript}
                    onChange={setMasterScript}
                    placeholder="전체 원고가 여기에 나타납니다."
                    className="min-h-[320px] text-lg font-semibold"
                  />
                </div>
              )}
            </div>

            {reviewMode === 'architecture' ? (
              <button onClick={handleSynthesizeScript} disabled={!!synthesizeProgress} className="ui-btn ui-btn--primary w-full">
                {synthesizeProgress ? <><Loader2 size={16} className="animate-spin" /> {synthesizeProgress}</> : <>통합 시나리오 생성하기 <Sparkles size={16} /></>}
              </button>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => setReviewMode('architecture')} className="ui-btn ui-btn--secondary w-full sm:w-auto">
                  설계도 다시 수정
                </button>
                <button onClick={handleGoToVisualStep} className="ui-btn ui-btn--primary w-full sm:flex-1">
                  이미지 및 대본 생성 단계로 <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <SectionHeader
        kicker="Step 3 / Script"
        title="시나리오 구조 설계"
        subtitle="전개 구조와 문체를 정리하고, 핵심 메시지를 설계합니다."
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <span className="ui-label">스타일 선택</span>
            <div className="space-y-2">
              {archetypes.map(a => (
                <button
                  key={a.id}
                  onClick={() => setScriptStyle(a.id)}
                  className={`style-choice w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${scriptStyle === a.id ? 'is-selected' : ''}`}
                >
                  <div className="mt-0.5 style-choice__icon">{a.icon}</div>
                  <div className="text-left">
                    <div className="style-choice__title">{a.name}</div>
                    <div className="style-choice__desc">{a.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card space-y-3">
            <span className="ui-label">목표 길이</span>
            <div className="flex flex-wrap gap-2">
              {durations.map(d => (
                <button
                  key={d.id}
                  onClick={() => setPlanningData(p => ({ ...p, targetDuration: d.id === 'custom' ? '' : d.id }))}
                  className={`duration-pill ui-btn ${planningData.targetDuration === d.id || (d.id === 'custom' && !durations.some(x => x.id === planningData.targetDuration)) ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                >
                  {d.icon} {d.label}
                </button>
              ))}
            </div>
          </div>
	        </div>
	
	        <div className="col-span-12 lg:col-span-8 space-y-4">
	          <div className="ui-card space-y-4">
	            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
	              <div className="min-w-0">
	                <span className="ui-label">대단원 기획안 (1~6 통합)</span>
	                <div className="text-sm text-slate-600 mt-1">
	                  먼저 1~6 전체가 포함된 큰 기획안을 만든 뒤, 1~6 파트로 분할해 일관성을 유지합니다.
	                  {topicForPlanning ? ` (주제: ${topicForPlanning})` : ''}
	                </div>
	              </div>
	              <div className="flex flex-wrap gap-2">
	                <button
	                  onClick={runMasterPlanOnlyAI}
	                  disabled={!!loadingStepKey || isGeneratingAll}
	                  className="ui-btn ui-btn--secondary"
	                >
	                  {loadingStepKey === 'masterPlan' ? <><Loader2 size={16} className="animate-spin" /> 대단원 생성 중...</> : <><Sparkles size={16} /> 대단원 생성</>}
	                </button>
	                <button
	                  onClick={runSplitFromMasterPlan}
	                  disabled={!!loadingStepKey || isGeneratingAll || !masterPlan.trim()}
	                  className="ui-btn ui-btn--ghost"
	                >
	                  {loadingStepKey === 'masterPlan:split' ? <><Loader2 size={16} className="animate-spin" /> 분할 중...</> : '1~6 분할'}
	                </button>
	                <button
	                  onClick={runAllStepsAI}
	                  disabled={!!loadingStepKey || isGeneratingAll}
	                  className="ui-btn ui-btn--primary"
	                >
	                  {isGeneratingAll ? <><Loader2 size={16} className="animate-spin" /> 생성+분할 중...</> : <><Zap size={16} /> 생성+분할</>}
	                </button>
	                <button
	                  onClick={() => {
	                    setReviewMode('architecture');
	                    setIsPreviewOpen(true);
	                  }}
	                  className="ui-btn ui-btn--secondary"
	                >
	                  구성 점검 <CheckSquare size={16} />
	                </button>
	              </div>
	            </div>
	
	            <AutoResizeTextarea
	              value={masterPlan}
	              onChange={(v) => setMasterPlan(v)}
	              placeholder="대단원 기획안을 입력하거나 '대단원 생성'으로 자동 생성하세요..."
	              className="min-h-[220px] text-base font-semibold"
	            />
	          </div>

	          <div className="ui-card">
	            <span className="ui-label">기획 파트 (1~6)</span>
	            <div className="text-sm text-slate-600 mt-1">
	              대단원 기획안에서 분할된 파트를 확인하고, 필요하면 파트별로 추가 수정/리라이트하세요.
	            </div>
	          </div>

          {steps.map((s, idx) => (
            <div key={s.key} className="ui-card space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <span className="ui-label">파트 {String(idx + 1).padStart(2, '0')}</span>
                  <h3 className="font-serif text-2xl text-foreground">
                    {s.name.replace(/^\d+\)\s/, '')}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runStepAI(s.key, s.name)}
                    disabled={!!loadingStepKey || isGeneratingAll}
                    className="ui-btn ui-btn--secondary"
                  >
                    {loadingStepKey === s.key
                      ? <><Loader2 size={16} className="animate-spin" /> 초안 생성 중...</>
                      : <><Sparkles size={16} /> AI 초안</>
                    }
                  </button>
                  <button
                    onClick={() => runRewriteAI(s.key, s.name, 'expand')}
                    disabled={!!loadingStepKey || isGeneratingAll || !(planningData[s.key as keyof StudioScriptPlanningData] || '').trim()}
                    className="ui-btn ui-btn--ghost"
                  >
                    {loadingStepKey === `${s.key}:expand` ? <><Loader2 size={16} className="animate-spin" /> 확장 중...</> : '더 자세히'}
                  </button>
                  <button
                    onClick={() => runRewriteAI(s.key, s.name, 'compress')}
                    disabled={!!loadingStepKey || isGeneratingAll || !(planningData[s.key as keyof StudioScriptPlanningData] || '').trim()}
                    className="ui-btn ui-btn--ghost"
                  >
                    {loadingStepKey === `${s.key}:compress` ? <><Loader2 size={16} className="animate-spin" /> 축약 중...</> : '더 짧게'}
                  </button>
                  <button
                    onClick={() => runRewriteAI(s.key, s.name, 'style_stronger')}
                    disabled={!!loadingStepKey || isGeneratingAll || !(planningData[s.key as keyof StudioScriptPlanningData] || '').trim()}
                    className="ui-btn ui-btn--ghost"
                  >
                    {loadingStepKey === `${s.key}:style_stronger` ? <><Loader2 size={16} className="animate-spin" /> 톤 고정 중...</> : '스타일 강화'}
                  </button>
                </div>
              </div>

              <div className="ui-card--muted text-sm text-slate-700">
                {stepGuides[s.key]}
              </div>

              <AutoResizeTextarea
                value={planningData[s.key as keyof StudioScriptPlanningData]}
                onChange={v => setPlanningData(p => ({ ...p, [s.key]: v }))}
                className="min-h-[200px] text-lg font-semibold"
                placeholder="아이디어를 상세히 기술하세요..."
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- [Step 4: 이미지 및 대본 생성] ---
const ImageAndScriptStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    masterScript, scenes, setScenes, selectedStyle, setSelectedStyle, videoFormat,
    referenceImage, setReferenceImage, referenceImageUrl, setReferenceImageUrl,
    analyzedStylePrompt, setAnalyzedStylePrompt, analyzedStylePromptKo, setAnalyzedStylePromptKo,
    urlAnalysisData, selectedBenchmarkPatterns
  } = useGlobal();

  const [isImgDragging, setIsImgDragging] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isRefAnalyzing, setIsRefAnalyzing] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const styleLab = [
    { 
      id: 'Realistic', 
      name: '리얼(Realistic)', 
      model: 'fal-ai/imagen4/preview', 
      price: '$0.05', 
      desc: '압도적 고퀄리티 실사 렌더링 스타일', 
      icon: <Camera size={24}/>,
      meta: "최종본(최고퀄): imagen4/preview/ultra ($0.06)" 
    },
    { 
      id: 'Photo', 
      name: '사진풍(Photo)', 
      model: 'fal-ai/nano-banana', 
      price: '$0.039', 
      desc: '자연스러운 채광과 사실적인 렌즈 질감', 
      icon: <ScanLine size={24}/>,
      meta: "최종본(브랜딩): nano-banana-pro ($0.15)"
    },
    { 
      id: 'Illustration', 
      name: '일러스트(Concept)', 
      model: 'fal-ai/flux/dev', 
      price: '$0.025', 
      desc: '감각적인 컨셉 아트 및 드로잉 스타일', 
      icon: <Palette size={24}/>,
      meta: "빠름(러프): flux/schnell ($0.003)"
    },
    { 
      id: 'Anime', 
      name: '애니메이션(Anime)', 
      model: 'fal-ai/fast-sdxl', 
      price: '$0.002', 
      desc: '전통적인 2D/3D 애니메이션 캐릭터 화풍', 
      icon: <Smile size={24}/>,
      meta: "표현확장: flux/dev ($0.025)"
    },
    { 
      id: '3D', 
      name: '3D 렌더(3D Render)', 
      model: 'fal-ai/flux/dev', 
      price: '$0.025', 
      desc: '입체적 재질과 시네마틱 라이팅 렌더링', 
      icon: <Box size={24}/>,
      meta: "실사재질: imagen4/preview ($0.05)"
    },
    { 
      id: 'LineArt', 
      name: '라인 아트(Line Art)', 
      model: 'fal-ai/fast-sdxl', 
      price: '$0.002', 
      desc: '간결한 선과 세련된 명암 대비의 그래픽', 
      icon: <PenTool size={24}/>,
      meta: "정교함: flux/dev ($0.025)"
    },
    { 
      id: 'Custom', 
      name: '사용자 지정(Custom)', 
      model: 'fal-ai/nano-banana', 
      price: '$0.039', 
      desc: '고유의 개성적인 화풍과 창의적 연출 스타일', 
      icon: <Sliders size={24}/>,
      meta: "고퀄기본: flux/dev ($0.025)"
    },
  ];

  const benchmarkSummaryForPrompt = typeof (urlAnalysisData?.summary) === 'string' ? urlAnalysisData.summary : '';
  const benchmarkPatternsForPrompt = useMemo(() => {
    const all = Array.isArray(urlAnalysisData?.patterns) ? (urlAnalysisData.patterns as string[]) : [];
    const picked = Array.isArray(selectedBenchmarkPatterns) ? selectedBenchmarkPatterns : [];
    return (picked.length ? picked : all).filter(Boolean).slice(0, 12);
  }, [urlAnalysisData, selectedBenchmarkPatterns]);

  const handleStudioSceneSplitting = async () => {
    if (!masterScript) return showToast("시나리오 데이터가 없습니다. 3단계에서 시나리오를 먼저 생성하세요.");
    setIsSplitting(true);
    try {
      const splitRes = await splitScriptIntoScenes(masterScript);
      const mapped = splitRes.map((s: any, i: number) => ({
        id: Date.now() + i,
        narrative: s.script_segment,
        aiPrompt: s.scene_description,
        aiPromptKo: '',
        imageUrl: '',
        duration: 5,
        cameraWork: 'Static',
        isPromptVisible: true,
        isSyncing: false,
        isGenerating: false
      }));
      setScenes(mapped);

      const styleObj = styleLab.find(s => s.id === selectedStyle);
      for (let i = 0; i < mapped.length; i++) {
        const prompt = await generateScenePrompt(mapped[i].narrative, styleObj?.desc || '', analyzedStylePrompt, {
          summary: benchmarkSummaryForPrompt,
          patterns: benchmarkPatternsForPrompt
        });
        mapped[i].aiPrompt = prompt;
        mapped[i].aiPromptKo = await translateToKorean(prompt);
      }
      setScenes([...mapped]);
      showToast("전문가급 씬 매핑 및 프롬프트 정밀화가 완료되었습니다.");
    } catch (e) {
      showToast("시나리오 분석 실패.");
    } finally {
      setIsSplitting(false);
    }
  };

  const handleImgUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setReferenceImage(base64);
      setIsRefAnalyzing(true);
      try {
        let uploadedUrl = '';
        try {
          const uploaded = await uploadStudioReferenceImage(file);
          uploadedUrl = uploaded.url;
          setReferenceImageUrl(uploaded.url);
        } catch {
          uploadedUrl = '';
          setReferenceImageUrl('');
        }
        const styleText = await analyzeReferenceImage(base64);
        setAnalyzedStylePrompt(styleText);
        setAnalyzedStylePromptKo(await translateToKorean(styleText));
        showToast(uploadedUrl ? "레퍼런스 이미지 업로드 및 스타일 분석 완료." : "레퍼런스 이미지 스타일 분석 완료.");
      } finally {
        setIsRefAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const addManualStudioScene = () => {
    const newScene: StudioScene = {
      id: Date.now(),
      narrative: '',
      aiPrompt: '',
      aiPromptKo: '',
      imageUrl: '',
      duration: 5,
      cameraWork: 'Static',
      isPromptVisible: true,
      isSyncing: false,
      isGenerating: false
    };
    setScenes([...scenes, newScene]);
    showToast("새 장면이 추가되었습니다.");
  };

  const translatingRef = useRef(false);
  const promptTranslateTimersRef = useRef<Record<number, number>>({});

  const scheduleScenePromptTranslate = useCallback((sceneId: number, englishPrompt: string) => {
    const current = promptTranslateTimersRef.current[sceneId];
    if (current) window.clearTimeout(current);
    const trimmed = (englishPrompt || '').trim();
    if (!trimmed) return;
    promptTranslateTimersRef.current[sceneId] = window.setTimeout(async () => {
      const ko = await translateToKorean(trimmed);
      if (!ko) return;
      setScenes((prev) =>
        prev.map((p) => (p.id === sceneId && p.aiPrompt.trim() === trimmed ? { ...p, aiPromptKo: ko } : p))
      );
    }, 1200);
  }, [setScenes]);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(promptTranslateTimersRef.current)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  useEffect(() => {
    if (translatingRef.current) return;
    if (analyzedStylePrompt && !analyzedStylePromptKo) {
      translatingRef.current = true;
      translateToKorean(analyzedStylePrompt)
        .then((ko) => {
          if (ko) setAnalyzedStylePromptKo(ko);
        })
        .finally(() => {
          translatingRef.current = false;
        });
    }
  }, [analyzedStylePrompt, analyzedStylePromptKo, setAnalyzedStylePromptKo]);

  const handleGenImage = async (idx: number) => {
    const scene = scenes[idx];
    const styleObj = styleLab.find(s => s.id === selectedStyle);
    const next = [...scenes];
    next[idx].isGenerating = true;
    setScenes(next);
    try {
      const url = await generateSceneImage(scene.aiPrompt, selectedStyle, videoFormat as '9:16' | '16:9', styleObj?.model, referenceImageUrl || undefined);
      const updated = [...scenes];
      updated[idx].imageUrl = url;
      updated[idx].isGenerating = false;
      setScenes(updated);
      showToast(`${idx+1}번 장면 비주얼 생성 완료.`);
    } catch (e) {
      const reset = [...scenes];
      reset[idx].isGenerating = false;
      setScenes(reset);
      showToast("생성 실패.");
    }
  };

  const generateAll = async () => {
    if (scenes.length === 0) return;
    const toGenerate = scenes
      .map((scene, i) => ({ scene, i }))
      .filter(({ scene }) => !scene.imageUrl)
      .map(({ i }) => i);
    if (toGenerate.length === 0) return showToast("생성할 이미지가 없습니다.");
    setIsGeneratingAll(true);
    setGenerateAllProgress(`(0/${toGenerate.length})`);
    showToast("모든 이미지를 순차적으로 생성합니다...");
    try {
      for (let i = 0; i < toGenerate.length; i++) {
        setGenerateAllProgress(`(${i + 1}/${toGenerate.length})`);
        await handleGenImage(toGenerate[i]);
      }
    } finally {
      setIsGeneratingAll(false);
      setGenerateAllProgress(null);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 4 / Visual"
        title="이미지 및 대본 생성"
        subtitle="장면 단위로 시각적 연출과 프롬프트를 정리합니다."
        right={(
          <div className="flex flex-wrap gap-2">
            <button onClick={handleStudioSceneSplitting} disabled={isSplitting || isGeneratingAll} className="ui-btn ui-btn--secondary">
              {isSplitting ? <><Loader2 size={16} className="animate-spin" /> 대본 분할 중...</> : <><ScanLine size={16} /> 대본 분할</>}
            </button>
            <button onClick={generateAll} disabled={isSplitting || isGeneratingAll} className="ui-btn ui-btn--primary">
              {isGeneratingAll ? <><Loader2 size={16} className="animate-spin" /> 전체 생성 중 {generateAllProgress}...</> : <><Zap size={16} /> 전체 생성</>}
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <span className="ui-label">스타일 선택</span>
            <div className="space-y-2">
              {styleLab.map(style => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`style-choice w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${selectedStyle === style.id ? 'is-selected' : ''}`}
                >
                  <div className="mt-0.5 style-choice__icon">{style.icon}</div>
                  <div className="text-left">
                    <div className="style-choice__title">{style.name}</div>
                    <div className="style-choice__desc">{style.desc}</div>
                  </div>
                  <span className="style-choice__price ml-auto">{style.price}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card space-y-4">
            <div className="flex items-center justify-between">
              <span className="ui-label">레퍼런스</span>
              <button onClick={() => fileInputRef.current?.click()} disabled={isRefAnalyzing} className="ui-btn ui-btn--secondary">
                {isRefAnalyzing ? <><Loader2 size={14} className="animate-spin" /> 분석 중...</> : '업로드'}
              </button>
            </div>
            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleImgUpload(e.target.files[0])} accept="image/*" />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsImgDragging(true); }}
              onDragLeave={() => setIsImgDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsImgDragging(false); if (e.dataTransfer.files[0]) handleImgUpload(e.dataTransfer.files[0]); }}
              className={`aspect-square rounded-2xl border border-dashed flex items-center justify-center overflow-hidden cursor-pointer ${isImgDragging ? 'bg-primary/12 border-primary/45' : 'border-border/70 bg-secondary/45'}`}
            >
              {referenceImage ? (
                <img src={referenceImage} className="w-full h-full object-cover" />
              ) : (
                <div className="text-center space-y-2 text-slate-500">
                  <ImagePlus size={28} className="mx-auto" />
                  <p className="text-sm">이미지를 드래그하거나 클릭하세요</p>
                </div>
              )}
            </div>
            {analyzedStylePrompt && (
              <div className="ui-card--muted text-sm text-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="ui-label">스타일 요약 (EN)</span>
                  <button
                    onClick={async () => {
                      if (!analyzedStylePrompt) return;
                      const ko = await translateToKorean(analyzedStylePrompt);
                      if (ko) setAnalyzedStylePromptKo(ko);
                    }}
                    className="ui-btn ui-btn--ghost"
                  >
                    KO 번역
                  </button>
                </div>
                <div className="whitespace-pre-wrap mt-2">{analyzedStylePrompt}</div>
                <div className="mt-3 pt-3 border-t border-border/60">
                  <span className="ui-label">번역 (KO)</span>
                  <div className="whitespace-pre-wrap mt-2 text-slate-800">
                    {analyzedStylePromptKo || '번역이 아직 없습니다.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card flex items-center justify-between">
            <span className="ui-label">StudioScene Timeline</span>
            <button onClick={addManualStudioScene} className="ui-btn ui-btn--secondary">
              <Plus size={14} /> 씬 추가
            </button>
          </div>

          {scenes.length > 0 ? (
            scenes.map((scene, idx) => (
              <div key={scene.id} className="ui-card space-y-4">
                <div className="flex items-center justify-between">
                  <span className="ui-label">StudioScene {String(idx + 1).padStart(2, '0')}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setScenes(scenes.filter(s => s.id !== scene.id))} className="ui-btn ui-btn--ghost">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="space-y-2">
                      <span className="ui-label">대본</span>
                      <AutoResizeTextarea
                        value={scene.narrative}
                        onChange={v => { const n = [...scenes]; n[idx].narrative = v; setScenes(n); }}
                        placeholder="대본 조각을 입력하세요..."
                        className="min-h-[120px] text-base font-semibold"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="ui-label">프롬프트 (EN)</span>
                        <button
                          onClick={async () => {
                            const ko = await translateToKorean(scene.aiPrompt);
                            if (!ko) return;
                            const n = [...scenes];
                            n[idx].aiPromptKo = ko;
                            setScenes(n);
                          }}
                          className="ui-btn ui-btn--ghost"
                        >
                          KO 번역
                        </button>
                      </div>
                      <AutoResizeTextarea
                        value={scene.aiPrompt}
                        onChange={v => {
                          const n = [...scenes];
                          n[idx].aiPrompt = v;
                          n[idx].aiPromptKo = '';
                          setScenes(n);
                          scheduleScenePromptTranslate(scene.id, v);
                        }}
                        placeholder="장면 연출 설명을 입력하세요..."
                        className="min-h-[140px] text-sm"
                      />
                      <div className="ui-card--muted text-sm text-slate-700 whitespace-pre-wrap">
                        <span className="ui-label">번역 (KO)</span>
                        <div className="mt-2 text-slate-800">
                          {scene.aiPromptKo || '번역이 아직 없습니다.'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="aspect-video rounded-2xl border border-dashed border-border/70 bg-secondary/45 flex items-center justify-center overflow-hidden relative">
                      {scene.isGenerating && (
                        <div className="absolute inset-0 bg-card/80 backdrop-blur-sm flex items-center justify-center">
                          <Loader2 size={20} className="animate-spin text-primary" />
                        </div>
                      )}
                      {scene.imageUrl ? (
                        <img src={scene.imageUrl} alt={`StudioScene ${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-center text-slate-500 text-sm">미리보기 없음</div>
                      )}
                    </div>
                    <button onClick={() => handleGenImage(idx)} disabled={scene.isGenerating} className="ui-btn ui-btn--primary w-full">
                      {scene.isGenerating ? <><Loader2 size={14} className="animate-spin" /> 생성 중...</> : <><Wand2 size={14} /> {styleLab.find(s => s.id === selectedStyle)?.name} 생성</>}
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="ui-card--ghost ui-card--airy text-center text-slate-500">
              대본 분할 또는 씬 추가로 시작하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// --- [Step 5: 보이스 프리셋 (MiniMax voice_id)] ---
const VOICE_PRESETS = [
  { id: 'ko-female-1', voiceId: 'Wise_Woman', name: '한국어 여성 (밝은 톤)', sample: '안녕하세요. 오늘 영상도 재미있게 봐 주세요.' },
  { id: 'ko-female-2', voiceId: 'Young_Lady', name: '한국어 여성 (친근)', sample: '일상 브이로그나 리뷰에 잘 어울려요.' },
  { id: 'ko-male-1', voiceId: 'Wise_Man', name: '한국어 남성 (차분)', sample: '핵심만 간단히 전달하는 내러티브에 적합합니다.' },
  { id: 'ko-male-2', voiceId: 'Present_Male', name: '한국어 남성 (뉴스)', sample: '속보나 정보 전달형 콘텐츠에 추천합니다.' },
  { id: 'en-neutral', voiceId: 'Wise_Woman', name: 'English (Neutral)', sample: 'Suitable for global shorts and tutorials.' },
];

type VoiceSegment = {
  id: number;
  sceneIndex: number;
  text: string;
  durationSec: number;
  status: 'pending' | 'done';
  audioUrl?: string;
};

type ThumbnailCandidate = {
  id: string;
  title: string;
  imagePlaceholder?: string;
  imageUrl?: string;
  ctrHint: string;
  isSelected: boolean;
};

const MOCK_THUMBNAILS: ThumbnailCandidate[] = [
  { id: 't1', title: '메인 (이미지 강조)', imagePlaceholder: '썸네일 A', ctrHint: '클릭률 예상 +12%', isSelected: true },
  { id: 't2', title: '대안 (텍스트 강조)', imagePlaceholder: '썸네일 B', ctrHint: '클릭률 예상 +8%', isSelected: false },
  { id: 't3', title: '감성 톤', imagePlaceholder: '썸네일 C', ctrHint: '클릭률 예상 +5%', isSelected: false },
];

function getYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const match =
    trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/) ||
    trimmed.match(/^([a-zA-Z0-9_-]{11})$/);
  return match ? match[1] : null;
}

function getYoutubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

// --- [Step 5: AI 음성 합성] ---
const VoiceStep = () => {
  const { scenes, setScenes, setSceneDurations, selectedVoicePresetId, setSelectedVoicePresetId } = useGlobal();
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [samplePlaying, setSamplePlaying] = useState(false);

  const selectedVoice = VOICE_PRESETS.find(v => v.id === selectedVoicePresetId) ?? VOICE_PRESETS[0];

  useEffect(() => {
    if (scenes.length > 0)
        setSegments(scenes.map((s, i) => ({
          id: s.id,
          sceneIndex: i + 1,
          text: s.narrative || '(대사 없음)',
          durationSec: (s.durationSec ?? s.audioDurationSec ?? 0) || 0,
          status: s.audioUrl ? 'done' : 'pending',
          audioUrl: s.audioUrl,
        })));
    else
      setSegments([]);
  }, [scenes]);

  const handleSynthesizeAll = async () => {
    const voiceId = selectedVoice?.voiceId ?? 'Wise_Woman';
    setIsSynthesizing(true);
    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const text = (seg.text || '').trim().replace(/^\(대사 없음\)$/, '');
        if (!text) {
          setSegments(prev => prev.map((p, j) => j === i ? { ...p, status: 'done' as const } : p));
          continue;
        }
        try {
          const { url, duration_ms } = await studioTts({ text, voice_id: voiceId });
          setSegments(prev => prev.map((p, j) =>
            j === i ? { ...p, status: 'done' as const, audioUrl: url, durationSec: duration_ms / 1000 } : p
          ));
          setScenes(prev => {
            const next = prev.map((s, j) => {
              if (j !== i) return s;
              const durationSec = duration_ms / 1000;
              return { ...s, audioUrl: url, durationSec, audioDurationSec: durationSec, duration: durationSec };
            });
            setSceneDurations(next.map(s => (s.durationSec ?? s.audioDurationSec ?? 0) || 0));
            return next;
          });
        } catch {
          setSegments(prev => prev.map((p, j) => j === i ? { ...p, status: 'pending' as const } : p));
        }
      }
    } finally {
      setIsSynthesizing(false);
    }
  };

  const playUrl = (url: string) => {
    const audio = new Audio(url);
    audio.play().catch(() => {});
  };

  const handleSamplePlay = async () => {
    if (!selectedVoice?.sample) return;
    setSamplePlaying(true);
    try {
      const { url } = await studioTts({ text: selectedVoice.sample, voice_id: selectedVoice.voiceId });
      playUrl(url);
    } catch {
      /* ignore */
    } finally {
      setSamplePlaying(false);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 5 / Voice"
        title="AI 음성 합성"
        subtitle="장면별 대본을 선택한 보이스로 합성합니다. 미리듣기 후 전체 내보내기를 진행하세요."
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <span className="ui-label">보이스 선택</span>
            <div className="space-y-2">
              {VOICE_PRESETS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVoicePresetId(v.id)}
                  className={`style-choice w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${selectedVoicePresetId === v.id ? 'is-selected' : ''}`}
                >
                  <div className="mt-0.5 style-choice__icon"><Mic2 size={18}/></div>
                  <div className="text-left flex-1 min-w-0">
                    <div className="style-choice__title">{v.name}</div>
                    <div className="style-choice__desc text-xs truncate">{v.sample}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="ui-card ui-card--muted">
            <span className="ui-label">미리듣기</span>
            <p className="text-sm text-slate-600 mb-2">{selectedVoice?.sample}</p>
            <button
              className="ui-btn ui-btn--secondary w-full"
              disabled={samplePlaying}
              onClick={handleSamplePlay}
            >
              {samplePlaying ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
              샘플 재생
            </button>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card flex items-center justify-between">
            <span className="ui-label">장면별 음성 세그먼트</span>
            <button
              onClick={handleSynthesizeAll}
              disabled={isSynthesizing || segments.length === 0}
              className="ui-btn ui-btn--primary"
            >
              {isSynthesizing ? <Loader2 size={14} className="animate-spin" /> : <Music4 size={14} />}
              전체 합성
            </button>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className="ui-card--ghost ui-card--airy text-center text-slate-500">
                Step 4에서 장면을 만든 뒤 여기로 오세요.
              </div>
            ) : (
              segments.map((seg, idx) => (
                <div key={seg.id} className="ui-card flex items-center gap-4">
                  <span className="ui-step__num is-selected">{(idx + 1).toString().padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{seg.text}</p>
                    <p className="text-xs text-slate-500">{seg.durationSec > 0 ? `${seg.durationSec.toFixed(1)}초` : '—'} · 씬 {seg.sceneIndex}</p>
                  </div>
                  <span className="ui-pill">{seg.status === 'done' ? '완료' : '대기'}</span>
                  <button
                    className="ui-btn ui-btn--ghost"
                    disabled={!seg.audioUrl}
                    onClick={() => seg.audioUrl && playUrl(seg.audioUrl)}
                  >
                    <PlayCircle size={14} /> 재생
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 6: AI 영상 생성] ---
const VideoStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { sessionId, scenes, videoFormat, subtitlesEnabled, setSubtitlesEnabled, burnInSubtitles, setBurnInSubtitles, setVideoUrl } = useGlobal();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'pending' | 'running' | 'success' | 'failure'>('idle');
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultSrtUrl, setResultSrtUrl] = useState<string | null>(null);
  const [resultVttUrl, setResultVttUrl] = useState<string | null>(null);

  const timeline = useMemo(() => {
    return (scenes || []).map((s, idx) => ({
      id: s.id,
      label: `씬 ${idx + 1}`,
	      hasImage: !!s.imageUrl,
	      hasAudio: !!s.audioUrl,
	      duration: Number.isFinite(s.durationSec as number) && (s.durationSec as number) > 0
	        ? (s.durationSec as number)
	        : (Number.isFinite(s.audioDurationSec as number) && (s.audioDurationSec as number) > 0
	          ? (s.audioDurationSec as number)
	          : (Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 5)),
	      text: s.narrative || '',
	    }));
	  }, [scenes]);

  const totalDuration = useMemo(() => timeline.reduce((acc, t) => acc + (t.duration || 0), 0), [timeline]);
  const readyScenes = useMemo(() => timeline.filter(t => t.hasImage && t.hasAudio), [timeline]);

  const formatTimeSrt = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms2).padStart(3, '0')}`;
  };
  const formatTimeVtt = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const ms2 = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms2).padStart(3, '0')}`;
  };
  const chunkText = (text: string, maxChars = 34) => {
    const cleaned = (text || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return [];
    const parts: string[] = [];
    let rest = cleaned;
    while (rest.length > 0) {
      if (rest.length <= maxChars) { parts.push(rest); break; }
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < 0) cut = maxChars;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    return parts.filter(Boolean);
  };
  const buildCues = () => {
    const cues: Array<{ start: number; end: number; text: string }> = [];
    let t = 0;
    for (const clip of readyScenes) {
      const dur = clip.duration || 0;
      const txt = (clip.text || '').trim();
      if (!dur || !txt) { t += dur; continue; }
      const chunks = chunkText(txt);
      if (chunks.length === 0) { t += dur; continue; }
      const per = Math.max(0.8, dur / chunks.length);
      let start = t;
      for (let i = 0; i < chunks.length; i++) {
        const end = (i === chunks.length - 1) ? (t + dur) : Math.min(t + dur, start + per);
        if (end - start >= 0.2) cues.push({ start, end, text: chunks[i] });
        start = end;
      }
      t += dur;
    }
    return cues;
  };

  const downloadText = (filename: string, text: string, mime: string) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadSrt = () => {
    if (readyScenes.length === 0) return showToast('자막을 만들려면 이미지+음성이 있는 씬이 필요합니다. (Step 4~5 완료)');
    const cues = buildCues();
    const lines: string[] = [];
    cues.forEach((c, i) => {
      lines.push(String(i + 1));
      lines.push(`${formatTimeSrt(c.start)} --> ${formatTimeSrt(c.end)}`);
      lines.push(c.text);
      lines.push('');
    });
    downloadText('captions.srt', lines.join('\n').trim() + '\n', 'text/plain;charset=utf-8');
  };

  const handleDownloadVtt = () => {
    if (readyScenes.length === 0) return showToast('자막을 만들려면 이미지+음성이 있는 씬이 필요합니다. (Step 4~5 완료)');
    const cues = buildCues();
    const lines: string[] = ['WEBVTT', ''];
    cues.forEach((c) => {
      lines.push(`${formatTimeVtt(c.start)} --> ${formatTimeVtt(c.end)}`);
      lines.push(c.text);
      lines.push('');
    });
    downloadText('captions.vtt', lines.join('\n').trim() + '\n', 'text/vtt;charset=utf-8');
  };

  const handleExport = async () => {
    if (!sessionId) return showToast('세션 ID가 없습니다. (Studio 프로젝트를 새로 생성 후 시도해주세요)');
    if (readyScenes.length === 0) return showToast('내보내려면 이미지+음성이 모두 있는 씬이 필요합니다. Step 4~5를 완료해주세요.');
    setJobError(null);
    setResultVideoUrl(null);
    setResultSrtUrl(null);
    setResultVttUrl(null);
    setJobStatus('pending');
    try {
      const res = await studioExport({
        session_id: sessionId,
        aspect_ratio: (videoFormat === '9:16' ? '9:16' : '16:9'),
        fps: 30,
        subtitles_enabled: subtitlesEnabled,
        burn_in_subtitles: subtitlesEnabled ? burnInSubtitles : false,
        scenes: readyScenes.map(s => ({
          image_url: scenes.find(x => x.id === s.id)?.imageUrl || '',
          audio_url: scenes.find(x => x.id === s.id)?.audioUrl || '',
          text: s.text || '',
          duration_sec: s.duration,
        })),
      });
      setTaskId(res.task_id);
      setJobStatus('running');
      showToast('영상 렌더링을 시작했습니다.');
    } catch (e) {
      setJobStatus('failure');
      setJobError(e instanceof Error ? e.message : '내보내기 실패');
    }
  };

  const handleCancel = async () => {
    if (!taskId) return;
    try {
      await studioExportJobCancel(taskId);
      showToast('렌더링을 취소했습니다.');
    } catch {
      showToast('취소 요청에 실패했습니다.');
    } finally {
      setTaskId(null);
      setJobStatus('idle');
    }
  };

  useEffect(() => {
    if (!taskId) return;
    if (jobStatus !== 'pending' && jobStatus !== 'running') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await studioExportJobStatus(taskId);
        if (cancelled) return;
        setJobStatus(s.status);
        if (s.status === 'success') {
          const vurl = s.result?.video_url || null;
          setResultVideoUrl(vurl);
          setVideoUrl(vurl);
          setResultSrtUrl((s.result?.captions as any)?.srt_url || null);
          setResultVttUrl((s.result?.captions as any)?.vtt_url || null);
          showToast('영상 렌더링이 완료되었습니다.');
        }
        if (s.status === 'failure') {
          setJobError(s.error || '렌더링 실패');
        }
      } catch (e) {
        if (!cancelled) setJobError(e instanceof Error ? e.message : '상태 조회 실패');
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [taskId, jobStatus]);

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 6 / Video"
        title="AI 영상 생성"
        subtitle="음성·이미지 타임라인을 합쳐 최종 영상으로 내보냅니다. 포맷에 맞춰 렌더링됩니다."
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <span className="ui-label">내보내기 설정</span>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">포맷</span>
                <span className="font-medium">{videoFormat === '9:16' ? '9:16 (Shorts)' : '16:9 (Standard)'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">총 길이</span>
                <span className="font-medium">{totalDuration.toFixed(1)}초</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">클립 수</span>
                <span className="font-medium">{readyScenes.length}개</span>
              </div>
            </div>
            <div className="ui-card--muted text-sm text-slate-600 p-3 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span>자막 생성</span>
                <button
                  type="button"
                  className={`ui-btn text-xs ${subtitlesEnabled ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                  onClick={() => setSubtitlesEnabled(v => !v)}
                  disabled={jobStatus === 'running' || jobStatus === 'pending'}
                >
                  {subtitlesEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>자막 번인</span>
                <button
                  type="button"
                  className={`ui-btn text-xs ${burnInSubtitles ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                  onClick={() => setBurnInSubtitles(v => !v)}
                  disabled={!subtitlesEnabled || jobStatus === 'running' || jobStatus === 'pending'}
                >
                  {burnInSubtitles ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleDownloadSrt} className="ui-btn ui-btn--secondary flex-1 text-xs">
                  <FileText size={12} /> SRT
                </button>
                <button type="button" onClick={handleDownloadVtt} className="ui-btn ui-btn--secondary flex-1 text-xs">
                  <FileText size={12} /> VTT
                </button>
              </div>
            </div>

            <button
              onClick={handleExport}
              disabled={jobStatus === 'pending' || jobStatus === 'running'}
              className="ui-btn ui-btn--primary w-full"
            >
              {(jobStatus === 'pending' || jobStatus === 'running') ? (
                <><Loader2 size={14} className="animate-spin" /> 렌더링 중...</>
              ) : (
                <><Video size={14} /> 영상 내보내기</>
              )}
            </button>
            {(jobStatus === 'pending' || jobStatus === 'running') && taskId && (
              <button onClick={handleCancel} className="ui-btn ui-btn--secondary w-full">
                <X size={14} /> 취소
              </button>
            )}
            {resultVideoUrl && (
              <a href={resultVideoUrl} className="ui-btn ui-btn--secondary w-full text-center" download>
                <Video size={14} /> MP4 다운로드
              </a>
            )}
            {(resultSrtUrl || resultVttUrl) && (
              <div className="flex gap-2">
                {resultSrtUrl && <a href={resultSrtUrl} className="ui-btn ui-btn--secondary flex-1 text-center" download><FileText size={12} /> SRT</a>}
                {resultVttUrl && <a href={resultVttUrl} className="ui-btn ui-btn--secondary flex-1 text-center" download><FileText size={12} /> VTT</a>}
              </div>
            )}
            {jobError && <div className="text-sm text-destructive">{jobError}</div>}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card">
            <span className="ui-label">타임라인</span>
            <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
              {timeline.map((clip) => (
                <div
                  key={clip.id}
                  className="flex-shrink-0 w-24 aspect-video rounded-xl border border-slate-200 bg-slate-50 flex flex-col items-center justify-center"
                >
                  <Film size={20} className="text-slate-400 mb-1" />
                  <span className="text-xs font-medium text-slate-700">{clip.label}</span>
                  <span className="text-[10px] text-slate-500">{clip.duration.toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ui-card ui-card--muted text-sm text-slate-600">
            Step 4에서 씬 이미지, Step 5에서 씬 음성을 만든 뒤 이 단계에서 MP4로 렌더링합니다.
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 7: 최적화 메타 설정 — AI 자동 생성] ---
const MetaStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const {
    selectedTopic,
    finalTopic,
    planningData,
    metaTitle,
    setMetaTitle,
    metaDescription,
    setMetaDescription,
    metaPinnedComment,
    setMetaPinnedComment,
  } = useGlobal();
  const topicForMeta = (finalTopic || selectedTopic || '').trim();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedOnce, setGeneratedOnce] = useState(() => !!(metaTitle || metaDescription || metaPinnedComment));

  const handleGenerateAll = async () => {
    setIsGenerating(true);
    try {
      const meta = await generateMetaData({
        topic: topicForMeta,
        summary: planningData?.summary,
        targetDuration: planningData?.targetDuration,
      });
      setMetaTitle(meta.title);
      setMetaDescription(meta.description);
      setMetaPinnedComment(meta.pinnedComment);
      setGeneratedOnce(true);
      showToast('메타데이터 생성이 완료되었습니다.');
    } catch (e) {
      showToast('메타데이터 생성에 실패했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async (field: 'title' | 'description' | 'pinnedComment') => {
    setIsGenerating(true);
    try {
      const meta = await generateMetaData({
        topic: topicForMeta,
        summary: planningData?.summary,
        targetDuration: planningData?.targetDuration,
      });
      if (field === 'title') setMetaTitle(meta.title);
      if (field === 'description') setMetaDescription(meta.description);
      if (field === 'pinnedComment') setMetaPinnedComment(meta.pinnedComment);
      showToast(`${field === 'title' ? '제목' : field === 'description' ? '설명' : '고정댓글'}을 다시 생성했습니다.`);
    } catch (e) {
      showToast('다시 생성에 실패했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 7 / Meta"
        title="메타데이터 AI 생성"
        subtitle="영상 제목, 설명(타임라인·해시태그 포함), 고정댓글을 AI가 자동으로 생성합니다. 생성 후 수정 가능합니다."
        right={
          <button
            onClick={handleGenerateAll}
            disabled={isGenerating}
            className="ui-btn ui-btn--primary"
          >
            {isGenerating ? (
              <><Loader2 size={16} className="animate-spin" /> 생성 중...</>
            ) : (
              <><Sparkles size={16} /> AI로 메타데이터 생성</>
            )}
          </button>
        }
      />

      <div className="space-y-6">
        <div className="ui-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="ui-label">영상 제목</span>
            <button
              type="button"
              onClick={() => handleRegenerate('title')}
              disabled={isGenerating}
              className="ui-btn ui-btn--ghost text-xs"
            >
              <RefreshCcw size={12} /> 다시 생성
            </button>
          </div>
          <input
            type="text"
            value={metaTitle}
            onChange={e => setMetaTitle(e.target.value)}
            placeholder="AI 생성 버튼을 누르면 제목이 생성됩니다"
            className="ui-input"
          />
        </div>

        <div className="ui-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="ui-label">설명 (타임라인 · 해시태그 포함)</span>
            <button
              type="button"
              onClick={() => handleRegenerate('description')}
              disabled={isGenerating}
              className="ui-btn ui-btn--ghost text-xs"
            >
              <RefreshCcw size={12} /> 다시 생성
            </button>
          </div>
          <textarea
            value={metaDescription}
            onChange={e => setMetaDescription(e.target.value)}
            placeholder="타임라인과 해시태그가 포함된 영상 설명이 생성됩니다"
            className="ui-textarea min-h-[200px] whitespace-pre-wrap"
          />
        </div>

        <div className="ui-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="ui-label">고정댓글</span>
            <button
              type="button"
              onClick={() => handleRegenerate('pinnedComment')}
              disabled={isGenerating}
              className="ui-btn ui-btn--ghost text-xs"
            >
              <RefreshCcw size={12} /> 다시 생성
            </button>
          </div>
          <textarea
            value={metaPinnedComment}
            onChange={e => setMetaPinnedComment(e.target.value)}
            placeholder="영상 업로드 후 고정할 댓글 문구가 생성됩니다"
            className="ui-textarea min-h-[120px]"
          />
        </div>

        {!generatedOnce && (
          <div className="ui-card ui-card--muted text-center py-8 text-slate-600">
            <Monitor size={24} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">오른쪽 상단 <strong>AI로 메타데이터 생성</strong>을 누르면 제목·설명·고정댓글이 한 번에 생성됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- [Step 8: 썸네일 연구소] ---
const ThumbnailStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { thumbnailData, setThumbnailData } = useGlobal();
  const thumbnails = (thumbnailData.thumbnails?.length ?? 0) > 0 ? (thumbnailData.thumbnails as ThumbnailCandidate[]) : MOCK_THUMBNAILS;
  const ytUrlInput = thumbnailData.ytUrlInput || '';
  const ytThumbnailUrl = thumbnailData.ytThumbnailUrl;
  const [ytThumbnailError, setYtThumbnailError] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkSummary, setBenchmarkSummary] = useState<string | null>(null);

  const loadYtThumbnail = () => {
    const id = getYoutubeVideoId(ytUrlInput);
    if (!id) {
      setThumbnailData(prev => ({ ...prev, ytThumbnailUrl: null }));
      setYtThumbnailError(true);
      showToast('유효한 유튜브 URL을 입력해주세요.');
      return;
    }
    setYtThumbnailError(false);
    setThumbnailData(prev => ({ ...prev, ytThumbnailUrl: getYoutubeThumbnailUrl(id) }));
  };

  const handleBenchmark = async () => {
    if (!ytThumbnailUrl) {
      showToast('먼저 유튜브 URL을 입력하고 썸네일을 불러와주세요.');
      return;
    }
    setIsBenchmarking(true);
    setBenchmarkSummary(null);
    try {
      const { imageUrl, analysisSummary } = await generateBenchmarkThumbnail(ytThumbnailUrl);
      setBenchmarkSummary(analysisSummary);
      const newThumb: ThumbnailCandidate = {
        id: `bench-${Date.now()}`,
        title: '벤치마킹 썸네일',
        imageUrl,
        ctrHint: '레퍼런스 분석 기반 생성',
        isSelected: false,
      };
      setThumbnailData(prev => {
        const base = (prev.thumbnails?.length ?? 0) > 0 ? prev.thumbnails : MOCK_THUMBNAILS;
        return { ...prev, thumbnails: [...base, newThumb] };
      });
      showToast('벤치마킹 썸네일이 생성되었습니다.');
    } catch (e) {
      showToast('벤치마킹 생성에 실패했습니다.');
    } finally {
      setIsBenchmarking(false);
    }
  };

  const selectThumb = (id: string) => {
    setThumbnailData(prev => {
      const base = (prev.thumbnails?.length ?? 0) > 0 ? prev.thumbnails : MOCK_THUMBNAILS;
      return { ...prev, thumbnails: base.map((t: ThumbnailCandidate) => ({ ...t, isSelected: t.id === id })) };
    });
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  const handleDownloadSelected = async () => {
    const selected = thumbnails.find(t => t.isSelected);
    if (!selected?.imageUrl) {
      showToast('다운로드할 썸네일을 선택하거나(생성된 이미지) 벤치마킹을 먼저 실행해주세요.');
      return;
    }
    await downloadImage(selected.imageUrl, 'thumbnail.jpg');
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 8 / Thumbnail"
        title="썸네일 연구소"
        subtitle="유튜브 URL로 썸네일을 불러온 뒤 벤치마킹하면, 같은 톤의 썸네일을 AI가 생성합니다."
      />

      <div className="ui-card space-y-4">
        <span className="ui-label">유튜브 썸네일 불러오기</span>
        <div className="flex flex-col sm:flex-row gap-3">
	          <input
	            type="text"
	            value={ytUrlInput}
	            onChange={e => {
	              setThumbnailData(prev => ({ ...prev, ytUrlInput: e.target.value }));
	              setYtThumbnailError(false);
	            }}
	            onKeyDown={e => e.key === 'Enter' && loadYtThumbnail()}
	            placeholder="https://www.youtube.com/watch?v=... 또는 youtu.be/..."
	            className="ui-input flex-1"
	          />
          <button type="button" onClick={loadYtThumbnail} className="ui-btn ui-btn--secondary shrink-0">
            <LinkIcon size={14} /> 썸네일 불러오기
          </button>
        </div>
        {ytThumbnailError && <p className="text-sm text-destructive">유효한 유튜브 영상 URL을 입력해주세요.</p>}

        {ytThumbnailUrl && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">해당 영상 썸네일</p>
            <div className="inline-block rounded-2xl border border-border/70 overflow-hidden bg-secondary/45 max-w-md">
	              <img
	                src={ytThumbnailUrl}
	                alt="유튜브 썸네일"
	                className="aspect-video w-full object-cover block"
	                onError={() => { setThumbnailData(prev => ({ ...prev, ytThumbnailUrl: null })); setYtThumbnailError(true); }}
	              />
            </div>
            <button
              type="button"
              onClick={handleBenchmark}
              disabled={isBenchmarking}
              className="ui-btn ui-btn--primary"
            >
              {isBenchmarking ? (
                <><Loader2 size={14} className="animate-spin" /> 벤치마킹 생성 중...</>
              ) : (
                <><BarChart3 size={14} /> 썸네일 벤치마킹하기</>
              )}
            </button>
            {benchmarkSummary && (
              <div className="ui-card--muted text-sm text-slate-700 p-3 rounded-xl">
                {benchmarkSummary}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ui-card space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span className="ui-label">썸네일 후보</span>
          <button type="button" onClick={handleDownloadSelected} className="ui-btn ui-btn--secondary text-xs">
            <ImagePlus size={12} /> 선택 썸네일 다운로드
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {thumbnails.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectThumb(t.id)}
              className={`rounded-2xl border overflow-hidden text-left transition-all ${t.isSelected ? 'border-primary/50 ring-1 ring-primary/35' : 'border-border/70 hover:border-border/90'}`}
            >
              <div className="aspect-video bg-slate-100 flex items-center justify-center text-slate-400 font-medium text-sm overflow-hidden">
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt={t.title} className="w-full h-full object-cover" />
                ) : (
                  t.imagePlaceholder
                )}
              </div>
              <div className="p-3 space-y-1">
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
                <p className="text-xs text-primary">{t.ctrHint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- [메인 레이아웃 쉘] ---
const AppContent = ({ projectName }: { projectName: string }) => {
  const {
    currentStep, setCurrentStep, isLoading, loadingMessage, setDescriptionInput, setIsFileLoaded, isDevMode, setIsDevMode,
    videoFormat, setVideoFormat, scriptStyle, setScriptStyle, planningData, setPlanningData,
    selectedStyle, setSelectedStyle, selectedVoicePresetId, setSelectedVoicePresetId,
    subtitlesEnabled, setSubtitlesEnabled, burnInSubtitles, setBurnInSubtitles,
  } = useGlobal();
  const [toast, setToast] = useState<string | null>(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const PRESET_KEY = 'weav_studio_presets_v1';
  type StudioPreset = {
    id: string;
    name: string;
    createdAt: number;
    data: {
      videoFormat: string;
      scriptStyle: string;
      targetDuration: string;
      selectedStyle: string;
      selectedVoicePresetId: string;
      subtitlesEnabled: boolean;
      burnInSubtitles: boolean;
    };
  };
  const [presets, setPresets] = useState<StudioPreset[]>(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const showToast = useCallback((msg: string) => { 
    setToast(msg); 
    setTimeout(() => setToast(null), 3500); 
  }, []);

  const persistPresets = (next: StudioPreset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const handleSavePreset = () => {
    const name = window.prompt('프리셋 이름을 입력하세요', `내 프리셋 ${presets.length + 1}`);
    if (!name) return;
    const preset: StudioPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim().slice(0, 48) || `내 프리셋 ${presets.length + 1}`,
      createdAt: Date.now(),
      data: {
        videoFormat,
        scriptStyle,
        targetDuration: planningData?.targetDuration || '1m',
        selectedStyle,
        selectedVoicePresetId,
        subtitlesEnabled,
        burnInSubtitles,
      },
    };
    persistPresets([preset, ...presets]);
    setSelectedPresetId(preset.id);
    showToast('프리셋이 저장되었습니다.');
  };

  const handleApplyPreset = () => {
    const p = presets.find(x => x.id === selectedPresetId);
    if (!p) return showToast('적용할 프리셋을 선택하세요.');
    setVideoFormat(p.data.videoFormat || '9:16');
    setScriptStyle(p.data.scriptStyle || 'type-a');
    setPlanningData(prev => ({ ...prev, targetDuration: p.data.targetDuration || prev.targetDuration || '1m' }));
    setSelectedStyle(p.data.selectedStyle || 'Realistic');
    setSelectedVoicePresetId(p.data.selectedVoicePresetId || 'ko-female-1');
    setSubtitlesEnabled(!!p.data.subtitlesEnabled);
    setBurnInSubtitles(!!p.data.burnInSubtitles);
    showToast('프리셋이 적용되었습니다.');
  };

  const handleDeletePreset = () => {
    const p = presets.find(x => x.id === selectedPresetId);
    if (!p) return;
    if (!window.confirm(`프리셋 "${p.name}"을 삭제할까요?`)) return;
    const next = presets.filter(x => x.id !== selectedPresetId);
    persistPresets(next);
    setSelectedPresetId('');
    showToast('프리셋이 삭제되었습니다.');
  };

  const handleFileAction = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        // 간단한 텍스트 로드 시 기획의도 필드로 주입
        setDescriptionInput(content);
        setIsFileLoaded(true);
        showToast("외부 데이터 소스가 기획 필드에 성공적으로 로드되었습니다.");
      } catch (err) {
        showToast("파일 로드 중 오류가 발생했습니다.");
      }
    };
    reader.readAsText(file);
  };

  const topSteps = [
    { id: 1, label: '기획', icon: <Target size={14}/> },
    { id: 2, label: '주제', icon: <Sparkles size={14}/> },
    { id: 3, label: '구조', icon: <PenTool size={14}/> },
    { id: 4, label: '비주얼', icon: <ImageIcon size={14}/> },
    { id: 5, label: '음성', icon: <Mic2 size={14}/> },
    { id: 6, label: '영상', icon: <Video size={14}/> },
    { id: 7, label: '메타', icon: <Monitor size={14}/> },
    { id: 8, label: '썸네일', icon: <ImageIcon size={14}/> }
  ];

  return (
    <div 
      className="ui-shell flex flex-1 text-foreground overflow-hidden font-sans relative"
      onDragOver={(e) => { e.preventDefault(); setIsGlobalDragging(true); }}
      onDragEnter={(e) => { e.preventDefault(); setIsGlobalDragging(true); }}
      onDragLeave={(e) => { if (e.relatedTarget === null) setIsGlobalDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setIsGlobalDragging(false); if (e.dataTransfer.files[0]) handleFileAction(e.dataTransfer.files[0]); }}
    >
      {isLoading && (
        <div className="absolute inset-0 z-[100] bg-background/82 backdrop-blur-sm flex flex-col items-center justify-center">
          <Loader2 size={40} className="text-primary animate-spin mb-4"/>
          <p className="ui-label">{loadingMessage ?? '처리 중...'}</p>
        </div>
      )}
      
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] ui-card">
          <div className="flex items-center gap-3 text-sm text-slate-700">
            <div className="w-2 h-2 rounded-full bg-primary" />
            {String(toast)}
          </div>
        </div>
      )}

      {isGlobalDragging && (
        <div className="absolute inset-0 z-[90] bg-background/56 backdrop-blur-sm flex items-center justify-center text-foreground text-sm font-medium">
          파일을 놓아 업로드하세요
        </div>
      )}

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto scrollbar-hide relative bg-transparent">
        <div className="p-6 lg:p-10 w-full">
          <div className="pb-8">
            <div className="mb-6 text-center">
              <h1 className="font-serif text-3xl text-foreground mb-2">{projectName}</h1>
              <span className="ui-label">WEAV Studio Project</span>
            </div>
            <div className="ui-card ui-card--muted max-w-[900px] mx-auto mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <span className="ui-label">프리셋</span>
                  <select
                    className="ui-input mt-2 w-full"
                    value={selectedPresetId}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                  >
                    <option value="">선택…</option>
                    {presets.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={handleApplyPreset} className="ui-btn ui-btn--secondary">
                    적용
                  </button>
                  <button type="button" onClick={handleSavePreset} className="ui-btn ui-btn--primary">
                    저장
                  </button>
                  <button type="button" onClick={handleDeletePreset} className="ui-btn ui-btn--ghost">
                    <Trash2 size={14} /> 삭제
                  </button>
                </div>
              </div>
              <div className="text-xs text-slate-600 mt-3">
                영상 포맷·대본 스타일·길이·이미지 스타일·보이스·자막 설정을 한 번에 저장/적용합니다.
              </div>
            </div>
            <div className="flex justify-center">
              <div className="step-pillbar">
                {topSteps.map(step => {
                  const isActive = currentStep === step.id;
                  const isLocked = !isDevMode && step.id > currentStep;
                  return (
                    <button
                      key={step.id}
                      onClick={() => !isLocked && setCurrentStep(step.id)}
                      className={`step-pill ${isActive ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}`}
                    >
                      <span className="step-pill__num">{step.id}</span>
                      <span className="step-pill__label">{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {currentStep === 1 && <TopicAnalysisStep showToast={showToast} />}
          {currentStep === 2 && <TopicGenerationStep showToast={showToast} />}
          {currentStep === 3 && <ScriptPlanningStep showToast={showToast} />}
          {currentStep === 4 && <ImageAndScriptStep showToast={showToast} />}
          {currentStep === 5 && <VoiceStep />}
          {currentStep === 6 && <VideoStep showToast={showToast} />}
          {currentStep === 7 && <MetaStep showToast={showToast} />}
          {currentStep === 8 && <ThumbnailStep showToast={showToast} />}
        </div>
      </main>
      
      <button
        onClick={() => setIsDevMode(!isDevMode)}
        className="fixed left-6 bottom-6 ui-btn ui-btn--secondary z-40"
      >
        <Terminal size={14} /> Dev
      </button>
    </div>
  );
};

type StudioViewProps = {
  sessionId?: number;
  projectName: string;
};

export function StudioView({ sessionId, projectName }: StudioViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 화면 전환 시 스크롤을 최상단으로 이동
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    // main 태그도 스크롤 가능할 수 있으므로 확인
    const mainElement = containerRef.current?.closest('main');
    if (mainElement) {
      mainElement.scrollTop = 0;
    }
    // window 스크롤도 확인
    window.scrollTo(0, 0);
  }, [projectName]);

  return (
    <div ref={containerRef} className="weav-studio-bg flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <GlobalProvider sessionId={sessionId}>
        <AppContent projectName={projectName} />
      </GlobalProvider>
    </div>
  );
}
