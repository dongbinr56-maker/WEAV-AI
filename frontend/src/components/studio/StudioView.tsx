
import React, { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';
import JSZip from 'jszip';
import {
  X, History, Ghost, BookOpen, TrendingUp, Globe, MonitorPlay, ChevronRight, Flame, Loader2,
  CheckCircle2, PlayCircle, Layers, Trash2, Link as LinkIcon, Sparkles, Target,
  Download,
  Image as ImageIcon, Video, Wand2, Camera, Plus, Mic2, FileText, AlignLeft, Settings2,
	  Sliders, Music4, Activity, Smartphone, Monitor, PenTool, RefreshCcw, Utensils,
	  MessageCircle, Zap, Hash, Compass, Sword, Microscope, Palette, Map, Film, Heart, Gift,
	  Leaf, Smile, BarChart3, Box, ImagePlus, ScanLine
	} from 'lucide-react';
	import {
	  StudioGlobalContextType,
	  StudioScene,
	  StudioScriptSegment,
	StudioAnalysisResult,
	StudioScriptPlanningData,
	type StudioTopicSuggestion,
	  type StudioReferenceMode,
	  type StudioReferenceState,
	  type StudioReferenceView,
	} from '@/types/studio';
	import { 
	  analyzeUrlPattern, generateTopics, generatePlanningStep, 
	  rewritePlanningStep, generateMasterPlan, splitMasterPlanToSteps,
	  synthesizeMasterScript, splitScriptIntoScenes, generateSceneImage,
	  analyzeReferenceImage, generateScenePrompt, generateMetaData, generateBenchmarkThumbnail, translateToKorean, translateToEnglish
	} from '@/services/studio/geminiService';
import { studioTts, studioImage, uploadStudioReferenceImage, studioExport, studioExportJobStatus, studioExportJobCancel } from '@/services/studio/studioFalApi';
import { fetchTrendingByCategory, formatTrendingGrowth, type TrendingItemWithCategory } from '@/services/studio/trendingApi';
import { InputDialog } from '@/components/ui/InputDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

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

function normalizeStoredTopicSuggestions(raw: unknown): StudioTopicSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return { title: item, reason: '' };
      }
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const title = typeof obj.title === 'string' ? obj.title.trim() : '';
        const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
        if (title) return { title, reason };
      }
      return null;
    })
    .filter((item): item is StudioTopicSuggestion => Boolean(item));
}

	const GlobalProvider: React.FC<{ children: React.ReactNode; sessionId?: number }> = ({ children, sessionId }) => {
	  const storageKey = sessionId != null ? `${STORAGE_KEY_PREFIX}_${sessionId}` : STORAGE_KEY_PREFIX;
	  const stored = useMemo(() => loadStoredStudio(storageKey), [storageKey]);

  const STEP_SCHEMA_VERSION = 2;
  const storedStepSchemaVersion = (stored && typeof stored.stepSchemaVersion === 'number') ? stored.stepSchemaVersion : 1;
  const [currentStep, setCurrentStep] = useState<number>(() => {
    const raw = (stored && typeof stored.currentStep === 'number') ? stored.currentStep : 1;
    // v1(기존): 1~9, v2: 1~10 (Step 4 Reference 추가)
    if (storedStepSchemaVersion < STEP_SCHEMA_VERSION && raw >= 4) return raw + 1;
    return raw;
  });
	  const [activeTags, setActiveTags] = useState<string[]>(() => Array.isArray(stored?.activeTags) ? stored.activeTags : []);
	  const [urlInput, setUrlInput] = useState(() => (typeof stored?.urlInput === 'string') ? stored.urlInput : '');
	  const [urlAnalysisData, setUrlAnalysisData] = useState<any>(() => (stored?.urlAnalysisData && typeof stored.urlAnalysisData === 'object') ? stored.urlAnalysisData : null);
	  const [selectedBenchmarkPatterns, setSelectedBenchmarkPatterns] = useState<string[]>(() => Array.isArray(stored?.selectedBenchmarkPatterns) ? stored.selectedBenchmarkPatterns as string[] : []);
	  const [isLoading, setIsLoading] = useState(false);
	  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
	  const isDevMode = true;
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
	  const [referenceState, setReferenceState] = useState<StudioReferenceState>(() => {
	    const def: StudioReferenceState = {
	      mode: 'REMOVE_BACKGROUND',
	      nickname: '',
	      style_target: '',
	      age_group: '',
	      gender: '',
	      height_cm: null,
	      must_keep: ['face', 'hair', 'colors'],
	      may_change: [],
	      palette: { primary: '', secondary: '', accent: '' },
	      constraints: { must_not_have: ['text', 'watermark', 'logo', 'busy background', 'multiple characters'] },
	      crop_to_bbox: false,
	      metadata: null,
	    };
	    const raw = stored?.referenceState;
	    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
	    const obj = raw as Record<string, unknown>;
	    const mode = typeof obj.mode === 'string' ? obj.mode : def.mode;
	    const palette = (obj.palette && typeof obj.palette === 'object' && !Array.isArray(obj.palette)) ? obj.palette as Record<string, unknown> : {};
	    const constraints = (obj.constraints && typeof obj.constraints === 'object' && !Array.isArray(obj.constraints)) ? obj.constraints as Record<string, unknown> : {};
	    const must_keep = Array.isArray(obj.must_keep) ? obj.must_keep : def.must_keep;
	    const may_change = Array.isArray(obj.may_change) ? obj.may_change : def.may_change;
	    const height = typeof obj.height_cm === 'number' ? obj.height_cm : def.height_cm;
	    return {
	      mode: (['USE_EXISTING_CUTOUT', 'REMOVE_BACKGROUND', 'GENERATE_NEW', 'RESTYLE_REFERENCE'].includes(mode) ? mode : def.mode) as StudioReferenceMode,
	      nickname: typeof obj.nickname === 'string' ? obj.nickname : def.nickname,
	      style_target: typeof obj.style_target === 'string' ? obj.style_target : def.style_target,
	      age_group: typeof obj.age_group === 'string' ? obj.age_group : def.age_group,
	      gender: typeof obj.gender === 'string' ? obj.gender : def.gender,
	      height_cm: height,
	      must_keep: (must_keep as StudioReferenceState['must_keep']).filter(Boolean),
	      may_change: (may_change as StudioReferenceState['may_change']).filter(Boolean),
	      palette: {
	        primary: typeof palette.primary === 'string' ? palette.primary : def.palette.primary,
	        secondary: typeof palette.secondary === 'string' ? palette.secondary : def.palette.secondary,
	        accent: typeof palette.accent === 'string' ? palette.accent : def.palette.accent,
	      },
	      constraints: {
	        must_not_have: Array.isArray(constraints.must_not_have)
	          ? (constraints.must_not_have as unknown[]).filter((v) => typeof v === 'string') as string[]
	          : def.constraints.must_not_have,
	      },
	      crop_to_bbox: typeof obj.crop_to_bbox === 'boolean' ? obj.crop_to_bbox : def.crop_to_bbox,
	      metadata: (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)) ? obj.metadata as any : def.metadata,
	    };
	  });
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
	  const [generatedTopics, setGeneratedTopics] = useState<StudioTopicSuggestion[]>(() => normalizeStoredTopicSuggestions(stored?.generatedTopics));
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
	          stepSchemaVersion: STEP_SCHEMA_VERSION,
			      currentStep, activeTags, urlInput, urlAnalysisData, videoFormat, inputMode,
			      descriptionInput, scenes, sceneDurations, scriptStyle, customScriptStyleText, scriptLength, planningData,
			      selectedTopic, finalTopic, generatedTopics, masterPlan, masterScript, selectedStyle,
			      referenceImage, referenceImageUrl, analyzedStylePrompt, analyzedStylePromptKo,
            referenceState,
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
        referenceState,
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
    isDevMode,
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
        referenceState, setReferenceState,
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
  const isComposingRef = useRef(false);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing) {
      return;
    }
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
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            setInputValue(e.currentTarget.value);
          }}
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
  right,
  className
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) => (
  <div className={`flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 ${className || ''}`}>
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
    isFileLoaded, setIsFileLoaded, setCurrentStep
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

  const handleResetIdea = () => {
    setActiveTags([]);
    setDescriptionInput('');
    setGeneratedTopics([]);
    setIsFileLoaded(false);
  };

  const handleResetBenchmark = () => {
    setUrlInput('');
    setUrlAnalysisData(null);
    setSelectedBenchmarkPatterns([]);
    setAnalysisResult((p) => ({ ...p, isUrlAnalyzing: false, error: null }));
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
              <div className="flex items-center gap-3">
                <button onClick={handleResetIdea} className="ui-btn ui-btn--ghost text-xs">
                  <RefreshCcw size={12} /> 초기화
                </button>
                <div className="planner-tabs">
                  <button onClick={() => setInputMode('tag')} className={`planner-tab ${inputMode === 'tag' ? 'is-active' : ''}`}>키워드</button>
                  <button onClick={() => setInputMode('description')} className={`planner-tab ${inputMode === 'description' ? 'is-active' : ''}`}>설명</button>
                </div>
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
              <button onClick={handleResetBenchmark} className="ui-btn ui-btn--ghost text-xs">
                <RefreshCcw size={12} /> 초기화
              </button>
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
            key={`${topic.title}-${idx}`}
            onClick={() => setSelectedTopic(topic.title)}
            className={`topic-row w-full flex items-center justify-between px-6 py-5 text-left transition-colors ${selectedTopic === topic.title ? 'is-selected' : ''}`}
          >
            <div className="flex items-start gap-4">
              <span className={`ui-step__num mt-0.5 ${selectedTopic === topic.title ? 'is-selected' : ''}`}>{(idx + 1).toString().padStart(2, '0')}</span>
              <div className="space-y-2">
                <div className="text-base font-semibold">{topic.title}</div>
                {topic.reason && (
                  <p className="text-sm text-slate-500 leading-relaxed">
                    추천 이유: {topic.reason}
                  </p>
                )}
              </div>
            </div>
            {selectedTopic === topic.title && <CheckCircle2 size={20} />}
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
    selectedTopic, finalTopic, scriptStyle, setScriptStyle, customScriptStyleText, setCustomScriptStyleText, scriptLength,
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
  const trimmedCustomStyleText = customScriptStyleText.trim();
  const styleLabelForPrompt = selectedArchetype
    ? (
        scriptStyle === 'custom' && trimmedCustomStyleText
          ? `${selectedArchetype.name} — ${trimmedCustomStyleText}`
          : `${selectedArchetype.name} — ${selectedArchetype.desc}`
      )
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
        trimmedCustomStyleText
          ? `- Custom style instruction from user:\n${trimmedCustomStyleText}`
          : '- Custom style details are currently missing. Do not guess a custom style; wait for explicit user direction.',
        '- Treat the custom style instruction as the top-priority tone/format rule unless it conflicts with factual safety.',
      ].join('\n'),
    };
    return rules[scriptStyle] || '';
  }, [scriptStyle, trimmedCustomStyleText]);

  const isCustomStyleReady = scriptStyle !== 'custom' || trimmedCustomStyleText.length > 0;

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
  const presetDurationIds = durations.filter((d) => d.id !== 'custom').map((d) => d.id);
  const isCustomDurationSelected = !presetDurationIds.includes(planningData.targetDuration || '');

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

  const handleOpenScriptReview = async () => {
    setReviewMode('script');
    setIsPreviewOpen(true);
    await handleSynthesizeScript();
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
                  : '말투와 흐름을 다듬고 레퍼런스 단계로 이동합니다.'}
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
              <div className="flex flex-col gap-3">
                <button onClick={handleGoToVisualStep} className="ui-btn ui-btn--primary w-full">
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
            {scriptStyle === 'custom' && (
              <div className="ui-card--muted mt-4 space-y-3 p-4 rounded-2xl">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">사용자 지정 스타일 입력</div>
                  <p className="text-sm text-slate-600">
                    원하는 문체, 톤, 전개 방식, 참고 채널 느낌, 금지 표현 등을 직접 적어주세요.
                  </p>
                </div>
                <AutoResizeTextarea
                  value={customScriptStyleText}
                  onChange={setCustomScriptStyleText}
                  placeholder="예: 속보 톤으로 짧고 날카롭게, 첫 문장은 충격 포인트부터 시작, 문장은 짧게 끊고 확인된 사실과 파장 중심으로 전개, 과한 감성 표현 금지"
                  className="min-h-[120px]"
                />
                <p className="text-xs text-slate-500">
                  입력한 내용이 Step 3 전체 기획 프롬프트에 직접 반영됩니다.
                </p>
              </div>
            )}
          </div>

          <div className="ui-card space-y-3">
            <span className="ui-label">목표 길이</span>
            <div className="grid grid-cols-2 gap-2">
              {durations.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setPlanningData(p => ({ ...p, targetDuration: d.id === 'custom' ? (isCustomDurationSelected ? p.targetDuration : '') : d.id }))}
                  className={`duration-pill ui-btn w-full justify-center min-h-[52px] ${d.id === 'custom' ? 'col-span-2' : ''} ${planningData.targetDuration === d.id || (d.id === 'custom' && isCustomDurationSelected) ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                >
                  {d.icon} {d.label}
                </button>
              ))}
            </div>
            {isCustomDurationSelected && (
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  value={planningData.targetDuration}
                  onChange={(e) => setPlanningData(p => ({ ...p, targetDuration: e.target.value }))}
                  placeholder="예: 90초, 2분, 2분 30초, 2m30s"
                  className="ui-input w-full"
                />
                <p className="text-xs text-slate-500">
                  원하는 영상 길이를 직접 입력하세요. 분/초 모두 입력 가능합니다.
                </p>
              </div>
            )}
          </div>
	        </div>
	
	        <div className="col-span-12 lg:col-span-8 space-y-4">
	          <div className="ui-card space-y-4">
	            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
	              <div className="min-w-0 flex-1">
	                <span className="ui-label">대단원 기획안 (1~6 통합)</span>
	                <div className="text-sm text-slate-600 mt-1">
	                  생성+분할을 한 번에 실행해 1~6 전체 흐름을 일관되게 맞춥니다.
	                  {topicForPlanning ? ` (주제: ${topicForPlanning})` : ''}
	                </div>
	              </div>
	              <div className="flex items-center gap-2 sm:flex-nowrap shrink-0">
	                <button
	                  onClick={runAllStepsAI}
	                  disabled={!!loadingStepKey || isGeneratingAll || !isCustomStyleReady}
	                  className="ui-btn ui-btn--primary"
	                >
	                  {isGeneratingAll ? <><Loader2 size={16} className="animate-spin" /> 생성+분할 중...</> : <><Zap size={16} /> 생성+분할</>}
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

          <div className="pt-4">
            {!isCustomStyleReady && (
              <div className="mb-3 text-sm text-amber-300">
                사용자 지정 스타일을 선택한 경우, 원하는 스타일 설명을 먼저 입력해야 기획 생성이 가능합니다.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="ui-btn ui-btn--secondary w-full justify-center"
              >
                <ChevronRight size={16} className="rotate-180" /> 이전 2 주제 돌아가기
              </button>
              <button
                type="button"
                onClick={handleOpenScriptReview}
                disabled={!!synthesizeProgress}
                className="ui-btn ui-btn--primary w-full justify-center"
              >
                {synthesizeProgress
                  ? <><Loader2 size={16} className="animate-spin" /> {synthesizeProgress}</>
                  : <>통합 시나리오 생성하기 <ChevronRight size={16} /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 4: 레퍼런스] ---
const ReferenceStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const TURNAROUND_GUIDE_TEMPLATE_PATH = '/studio/turnaround-guide.png';
  const {
    setReferenceImage, referenceImageUrl, setReferenceImageUrl,
    analyzedStylePrompt, setAnalyzedStylePrompt, analyzedStylePromptKo, setAnalyzedStylePromptKo,
    referenceState, setReferenceState,
    setCurrentStep
  } = useGlobal();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isImgDragging, setIsImgDragging] = useState(false);
  const [isRefAnalyzing, setIsRefAnalyzing] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [baseFrontUrl, setBaseFrontUrl] = useState<string>('');
  const [baseFrontCutoutUrl, setBaseFrontCutoutUrl] = useState<string>('');
  const [turnaroundUrls, setTurnaroundUrls] = useState<Partial<Record<StudioReferenceView, string>>>({});
  const [turnaroundCutoutUrls, setTurnaroundCutoutUrls] = useState<Partial<Record<StudioReferenceView, string>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const translatingRef = useRef(false);
  const [isZipDownloading, setIsZipDownloading] = useState(false);
  const [gridProgress, setGridProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [tileEditPrompt, setTileEditPrompt] = useState('');
  const [isTileRegenerating, setIsTileRegenerating] = useState(false);
  const [tileOverrideAngle, setTileOverrideAngle] = useState('');

  const handleImgUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setReferenceImage(base64);
      setSourceFileName(file?.name || '');
      setIsRefAnalyzing(true);
      try {
        const uploaded = await uploadStudioReferenceImage(file);
        setSourceImageUrl(uploaded.url);
        // 기존 Visual Step 호환: 업로드만 했을 때는 URL을 유지
        setReferenceImageUrl(uploaded.url);
        try {
          const styleText = await analyzeReferenceImage(base64);
          setAnalyzedStylePrompt(styleText);
          setAnalyzedStylePromptKo(await translateToKorean(styleText));
          setReferenceState((p) => (p.style_target || '').trim() ? p : ({ ...p, style_target: styleText }));
        } catch {
          /* ignore */
        }
        showToast("레퍼런스 이미지 업로드 완료.");
      } finally {
        setIsRefAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

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

  const styleTags = useMemo(() => {
    const t = (referenceState.style_target || '').trim();
    if (!t) return [];
    return t.split(/[,\n]/g).map(s => s.trim()).filter(Boolean).slice(0, 12);
  }, [referenceState.style_target]);

  const styleBasePresets = useMemo(() => ([
    {
      id: 'realistic',
      label: '실사/리얼',
      value: 'photorealistic, natural skin, realistic lighting, high fidelity detail',
    },
    {
      id: 'anime_jp',
      label: '일본 애니',
      value: 'Japanese anime, clean line art, crisp cel shading, vivid eyes',
    },
    {
      id: 'us_cartoon',
      label: '미국 카툰',
      value: 'American cartoon style, bold outlines, simplified shapes, flat shading',
    },
    {
      id: 'webtoon',
      label: '웹툰',
      value: 'Korean webtoon style, soft shading, tidy line art, balanced pastel tones',
    },
    {
      id: 'illustration',
      label: '일러스트',
      value: 'editorial illustration, painterly brushwork, soft gradients, refined textures',
    },
    {
      id: 'render_3d',
      label: '3D 렌더',
      value: '3D character render, PBR materials, studio lighting, clean geometry',
    },
  ]), []);

  const styleModifiers = useMemo(() => ([
    'high detail',
    'soft lighting',
    'cinematic lighting',
    'strong cel shading',
    'clean line art',
    'bold outlines',
    'flat shading',
    'pastel palette',
    'high contrast',
    'smooth skin',
    'textured fabric',
    'sharp silhouette',
    'soft shadows',
    'minimal background',
  ]), []);

  const normalizeStyleTag = useCallback((tag: string) => tag.toLowerCase().replace(/\s+/g, ' ').trim(), []);

  const applyBaseStylePreset = useCallback((value: string) => {
    setReferenceState((prev) => ({ ...prev, style_target: value }));
  }, [setReferenceState]);

  const toggleStyleModifier = useCallback((tag: string) => {
    const normalized = normalizeStyleTag(tag);
    const existing = styleTags.map(normalizeStyleTag);
    if (existing.includes(normalized)) {
      const next = styleTags.filter((t) => normalizeStyleTag(t) !== normalized);
      setReferenceState((prev) => ({ ...prev, style_target: next.join(', ') }));
      return;
    }
    const next = [...styleTags, tag];
    setReferenceState((prev) => ({ ...prev, style_target: next.join(', ') }));
  }, [normalizeStyleTag, setReferenceState, styleTags]);

  const gridCutoutUrls = useMemo(() => {
    const urls = referenceState.metadata?.generated_assets?.grid_cutout_urls;
    if (!Array.isArray(urls)) return [];
    return urls.filter((u) => typeof u === 'string' && u.trim().length > 0);
  }, [referenceState.metadata]);

  const gridSourceUrl = useMemo(() => {
    const url = referenceState.metadata?.generated_assets?.grid_source_url;
    if (typeof url !== 'string') return '';
    return url.trim();
  }, [referenceState.metadata]);

  const tileSpecs = useMemo(() => ([
    { index: 0, label: '1', shot: 'upper-body', angle: '6시', view: 'front' },
    { index: 1, label: '2', shot: 'full-body', angle: '6시', view: 'front' },
    { index: 2, label: '3', shot: 'full-body', angle: '7시 30분', view: 'three-quarter left' },
    { index: 3, label: '4', shot: 'full-body', angle: '9시', view: 'left profile' },
    { index: 4, label: '5', shot: 'full-body', angle: '10시 30분', view: 'rear three-quarter left' },
    { index: 5, label: '6', shot: 'full-body', angle: '12시', view: 'back' },
    { index: 6, label: '7', shot: 'full-body', angle: '1시 30분', view: 'rear three-quarter right' },
    { index: 7, label: '8', shot: 'full-body', angle: '3시', view: 'right profile' },
    { index: 8, label: '9', shot: 'full-body', angle: '4시 30분', view: 'three-quarter right' },
  ]), []);

  const tileAngleOptions = useMemo(() => ([
    { value: '6시', label: '6시 정면' },
    { value: '7시 30분', label: '7시 30분 좌전면' },
    { value: '9시', label: '9시 좌측면' },
    { value: '10시 30분', label: '10시 30분 좌후면' },
    { value: '12시', label: '12시 후면' },
    { value: '1시 30분', label: '1시 30분 우후면' },
    { value: '3시', label: '3시 우측면' },
    { value: '4시 30분', label: '4시 30분 우전면' },
  ]), []);

  const tileAngleViewMap = useMemo(() => ({
    '6시': 'front',
    '7시 30분': 'three-quarter left',
    '9시': 'left profile',
    '10시 30분': 'rear three-quarter left',
    '12시': 'back',
    '1시 30분': 'rear three-quarter right',
    '3시': 'right profile',
    '4시 30분': 'three-quarter right',
  } as Record<string, string>), []);

  useEffect(() => {
    if (selectedTileIndex == null) return;
    if (selectedTileIndex >= gridCutoutUrls.length) {
      setSelectedTileIndex(null);
      setTileEditPrompt('');
      setTileOverrideAngle('');
    }
  }, [gridCutoutUrls.length, selectedTileIndex]);



  const randomCharacterSeedSets = useMemo(() => ({
    namePrefixes: ['Nova', 'Lumi', 'Rin', 'Mika', 'Sora', 'Ari', 'Theo', 'Kana', 'Milo', 'Yuna', 'Haru', 'Ciel'],
    nameSuffixes: ['Fox', 'Vale', 'Mint', 'Ray', 'Bloom', 'Drift', 'Core', 'Wave', 'Echo', 'Spark', 'Leaf', 'Tone'],
    ages: ['late teens', 'early 20s', 'mid 20s', 'late 20s', 'early 30s'],
    genders: ['female', 'male', 'androgynous'],
    heights: [155, 160, 165, 170, 175],
    styleTargets: [
      'clean 2D anime, cel shading, crisp line art, studio lighting, plain white background, high character consistency',
      'stylized semi-realistic avatar, polished facial features, soft global illumination, neutral white seamless backdrop, production-ready reference sheet',
      'bright game-ready mascot design, readable silhouette, vivid color blocking, tidy rendering, front-facing character sheet look',
      'premium VTuber character design, elegant proportions, smooth cel shading, clean rim light, high-detail costume read, plain background',
      'modern webtoon-inspired character art, sharp contour lines, balanced pastel contrast, soft key light, reusable avatar reference aesthetic',
      'cinematic 3D animation concept render, simplified materials, precise silhouette separation, soft studio shadows, neutral reference-board composition',
    ],
    palettes: [
      { primary: '#1F2937', secondary: '#F3F4F6', accent: '#60A5FA' },
      { primary: '#111827', secondary: '#E5E7EB', accent: '#F59E0B' },
      { primary: '#2B2D42', secondary: '#EDF2F4', accent: '#EF476F' },
      { primary: '#243B53', secondary: '#F7F3E9', accent: '#2EC4B6' },
      { primary: '#2D1E2F', secondary: '#F8F7FF', accent: '#8AC926' },
      { primary: '#22333B', secondary: '#FAF9F6', accent: '#E76F51' },
    ],
    constraints: [
      'text',
      'watermark',
      'logo',
      'busy background',
      'multiple characters',
      'cropped head',
      'cropped feet',
      'extra fingers',
      'deformed hands',
      'low-detail face',
      'muddy shadows',
      'extreme perspective',
    ],
  }), []);

  const normalizeHexColor = useCallback((value: string) => {
    const v = (value || '').trim();
    if (!v) return null;
    const m = v.match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return null;
    return `#${m[1].toUpperCase()}`;
  }, []);

  const safeColorInputValue = useCallback((value: string) => normalizeHexColor(value) ?? '#000000', [normalizeHexColor]);

  const containsKorean = useCallback((text: string) => /[가-힣]/.test(text || ''), []);

  const pickOne = useCallback(<T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)], []);

  const buildRandomNickname = useCallback(() => {
    const prefix = pickOne(randomCharacterSeedSets.namePrefixes);
    const suffix = pickOne(randomCharacterSeedSets.nameSuffixes);
    const serial = String(Math.floor(Math.random() * 90) + 10);
    return `${prefix}${suffix}_${serial}`;
  }, [pickOne, randomCharacterSeedSets]);

  const pickMany = useCallback(<T,>(items: T[], min: number, max: number): T[] => {
    const pool = [...items];
    const count = Math.max(min, Math.min(pool.length, Math.floor(Math.random() * (max - min + 1)) + min));
    const chosen: T[] = [];
    while (pool.length > 0 && chosen.length < count) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(idx, 1)[0]);
    }
    return chosen;
  }, []);

  const fillRandomReferenceFields = useCallback(() => {
    if (referenceState.mode !== 'GENERATE_NEW') return;

    const randomStyleParts = pickMany(randomCharacterSeedSets.styleTargets, 1, 2);
    const randomPalette = pickOne(randomCharacterSeedSets.palettes);
    const randomConstraints = pickMany(randomCharacterSeedSets.constraints, 5, 7);
    const mustKeepPool = ['face', 'hair', 'outfit', 'colors', 'body_type', 'accessories'] as StudioReferenceState['must_keep'];
    const mayChangePool = ['outfit', 'colors', 'hairstyle', 'accessories', 'material', 'mood'] as StudioReferenceState['may_change'];
    const nextMustKeep = pickMany(mustKeepPool, 3, 5) as StudioReferenceState['must_keep'];
    const nextMayChange = pickMany(mayChangePool, 1, 3) as StudioReferenceState['may_change'];
    const nextNickname = buildRandomNickname();
    const nextStyleTarget = randomStyleParts.join(', ');
    const nextAge = pickOne(randomCharacterSeedSets.ages);
    const nextGender = pickOne(randomCharacterSeedSets.genders);
    const nextHeight = pickOne(randomCharacterSeedSets.heights);

    setReferenceState((prev) => ({
      ...prev,
      nickname: nextNickname,
      style_target: nextStyleTarget,
      age_group: nextAge,
      gender: nextGender,
      height_cm: nextHeight,
      must_keep: nextMustKeep,
      may_change: nextMayChange,
      palette: {
        primary: randomPalette.primary,
        secondary: randomPalette.secondary,
        accent: randomPalette.accent,
      },
      constraints: {
        must_not_have: randomConstraints,
      },
      metadata: null,
    }));
    setShowAdvanced(true);
    showToast('GENERATE_NEW용 랜덤 캐릭터 설정을 새로 채웠습니다.');
  }, [buildRandomNickname, pickMany, pickOne, randomCharacterSeedSets, referenceState.mode, setReferenceState, showToast]);

  const downloadReferenceZip = useCallback(async () => {
    const zipItems: Array<{ url: string; label: string }> = [];
    if (gridCutoutUrls.length > 0) {
      gridCutoutUrls.forEach((url, idx) => {
        zipItems.push({ url, label: `${String(idx + 1).padStart(2, '0')}_reference` });
      });
    } else if (referenceImageUrl) {
      zipItems.push({ url: referenceImageUrl, label: '01_reference' });
    }

    if (zipItems.length === 0) {
      showToast('다운로드할 레퍼런스 이미지가 없습니다.');
      return;
    }
    const nickname = (referenceState.nickname || 'character').trim() || 'character';
    const safeNickname = nickname.replace(/[^a-zA-Z0-9_-]+/g, '_');
    const zipName = `weav_reference_${safeNickname}.zip`;

    const guessExt = (url: string, mime: string | undefined) => {
      const type = (mime || '').toLowerCase();
      if (type.includes('png')) return 'png';
      if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
      if (type.includes('webp')) return 'webp';
      const m = url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i);
      if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
      return 'png';
    };

    setIsZipDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`weav_reference_${safeNickname}`) ?? zip;
      for (let i = 0; i < zipItems.length; i += 1) {
        const targetUrl = zipItems[i].url;
        const res = await fetch(targetUrl);
        if (!res.ok) throw new Error(`download failed: ${targetUrl}`);
        const blob = await res.blob();
        const ext = guessExt(targetUrl, blob.type);
        const fileName = `${zipItems[i].label}.${ext}`;
        folder.file(fileName, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
      showToast('레퍼런스 압축 파일 다운로드가 시작되었습니다.');
    } catch (e) {
      console.error(e);
      showToast('레퍼런스 압축 다운로드에 실패했습니다.');
    } finally {
      setIsZipDownloading(false);
    }
  }, [gridCutoutUrls, gridSourceUrl, referenceImageUrl, referenceState.nickname, showToast]);

  const buildTilePromptEn = useCallback((opts: { spec: { shot: string; angle?: string; view?: string }; styleTargetEn: string; userNote?: string }) => {
    const { spec, styleTargetEn, userNote } = opts;
    const palette = referenceState.palette;
    const paletteParts = [
      palette.primary ? `primary ${palette.primary}` : null,
      palette.secondary ? `secondary ${palette.secondary}` : null,
      palette.accent ? `accent ${palette.accent}` : null,
    ].filter(Boolean).join(', ');
    const ageGroup = (referenceState.age_group || '').trim();
    const gender = (referenceState.gender || '').trim();
    const height = referenceState.height_cm;
    const base = [
      'You are a senior avatar/character reference artist and production designer.',
      'Generate exactly ONE turnaround-sheet tile, not a multi-panel grid.',
      'Use the provided reference image as the canonical identity source.',
      'Preserve the reference identity EXACTLY: same face, hairstyle, hair volume, outfit, materials, accessories, proportions, silhouette, lighting family, and render style.',
      'Single character only. No text, no labels, no borders, no grid.',
      'Solid light gray background, seamless (no horizon line, no gradient).',
      'Even studio lighting, soft shadows only.',
      'The character must be standing upright (no sitting, kneeling, crouching, leaning, or walking).',
      'Hands must be empty; do not hold any objects or phones.',
      'Outfit must remain identical to the reference image. Do NOT change wardrobe.',
      'The entire body must rotate to the requested clock-face direction as one unit. Head, eyes, nose, shoulders, chest, hips, knees, and feet must agree with the same facing direction.',
      'Do not keep the torso front-facing while only turning the head.',
      'Do not keep the face aimed at the camera unless the requested facing direction is 6 o’clock front.',
      `Shot type: ${spec.shot === 'upper-body' ? 'upper-body (about 60% frame height)' : 'full-body head-to-toe, fully visible inside the frame'}.`,
      spec.angle ? `Target facing direction on the clock face: ${spec.angle}${spec.view ? ` (${spec.view})` : ''}.` : null,
      ageGroup ? `apparent age: ${ageGroup}` : null,
      gender ? `gender presentation: ${gender}` : null,
      height ? `approx height: ${height} cm` : null,
      styleTargetEn ? `style target: ${styleTargetEn}` : null,
      paletteParts ? `palette: ${paletteParts}` : null,
      userNote ? `User request: ${userNote}` : null,
    ].filter(Boolean).join(' ');
    const negative = [
      'text',
      'watermark',
      'logo',
      'multiple characters',
      'busy background',
      'uneven lighting',
      'cropped head',
      'cropped feet',
      'missing head',
      'missing feet',
      'half-body',
      'truncated body',
      'deformed hands',
      'extra fingers',
      'outfit change',
      'wardrobe change',
      'costume change',
      'style change',
      'lighting change',
      'color grading change',
      'background change',
      'different materials',
      'different accessories',
      'duplicate angle from another turnaround tile',
      'head-only rotation',
      'eyes looking at camera when body is profile or back',
      'front torso with profile head',
      'profile torso with front-facing head',
      'back torso with front-facing head',
      'phone',
      'smartphone',
      'holding objects',
    ].join(', ');
    return `${base}. Avoid: ${negative}.`;
  }, [referenceState.age_group, referenceState.gender, referenceState.height_cm, referenceState.palette]);

  const withCacheBust = useCallback((url: string) => {
    if (!url) return url;
    return url.includes('?') ? `${url}&v=${Date.now()}` : `${url}?v=${Date.now()}`;
  }, []);

  const loadTurnaroundGuideTemplateBlob = useCallback(async () => {
    const response = await fetch(TURNAROUND_GUIDE_TEMPLATE_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error(`turnaround guide template fetch failed: ${response.status}`);
    return await response.blob();
  }, [TURNAROUND_GUIDE_TEMPLATE_PATH]);

  const regenerateTile = useCallback(async () => {
    if (selectedTileIndex == null) return;
    if (!gridCutoutUrls[selectedTileIndex]) return showToast('선택된 타일 이미지가 없습니다.');
    const note = tileEditPrompt.trim();
    const overrideAngle = tileOverrideAngle.trim();
    if (!note && !overrideAngle) return showToast('수정 요청을 입력하거나 방향을 재지정해 주세요.');
    const spec = tileSpecs[selectedTileIndex];
    if (!spec) return showToast('타일 정보가 없습니다.');
    const finalSpec = overrideAngle
      ? { ...spec, angle: overrideAngle, view: tileAngleViewMap[overrideAngle] || spec.view }
      : { ...spec, angle: undefined, view: undefined };
    const referenceForTile = overrideAngle
      ? (baseFrontCutoutUrl || gridCutoutUrls[1] || gridCutoutUrls[selectedTileIndex])
      : gridCutoutUrls[selectedTileIndex];

    setIsTileRegenerating(true);
    try {
      const noteEn = note
        ? (containsKorean(note) ? (await translateToEnglish(note)) || note : note)
        : '';
      const angleNote = overrideAngle
        ? `Change the facing direction to ${finalSpec.angle}${finalSpec.view ? ` (${finalSpec.view})` : ''}. Do not keep the original facing direction.`
        : '';
      const mergedNote = [angleNote, noteEn].filter(Boolean).join(' ').trim();
      const styleTargetRaw = (referenceState.style_target || '').trim();
      const styleTargetEn =
        styleTargetRaw && containsKorean(styleTargetRaw) ? (await translateToEnglish(styleTargetRaw)) || styleTargetRaw : styleTargetRaw;
      const prompt = buildTilePromptEn({ spec: finalSpec, styleTargetEn, userNote: mergedNote || undefined });
      const res = await studioImage({
        prompt,
        model: 'fal-ai/nano-banana-2/edit',
        aspect_ratio: '9:16',
        num_images: 1,
        ...(referenceForTile ? { reference_image_url: referenceForTile, image_urls: [referenceForTile] } : {}),
        resolution: '4K',
        output_format: 'png',
      });
      const nextUrl = res.images?.[0]?.url;
      if (!nextUrl) throw new Error('tile image url missing');
      const updatedUrl = withCacheBust(nextUrl);
      setReferenceState((prev) => {
        const meta = prev.metadata;
        if (!meta) return prev;
        const current = Array.isArray(meta.generated_assets?.grid_cutout_urls) ? [...meta.generated_assets!.grid_cutout_urls!] : [];
        current[selectedTileIndex] = updatedUrl;
        return {
          ...prev,
          metadata: {
            ...meta,
            generated_assets: {
              ...meta.generated_assets,
              grid_cutout_urls: current,
            },
          },
        };
      });
      showToast(`타일 ${finalSpec.label} 재생성이 완료되었습니다.`);
    } catch (e) {
      console.error(e);
      showToast('타일 재생성에 실패했습니다.');
    } finally {
      setIsTileRegenerating(false);
    }
  }, [
    buildTilePromptEn,
    baseFrontCutoutUrl,
    containsKorean,
    gridCutoutUrls,
    referenceState.style_target,
    selectedTileIndex,
    showToast,
    tileEditPrompt,
    tileAngleViewMap,
    tileOverrideAngle,
    tileSpecs,
    withCacheBust,
  ]);


	  const mustKeepOptions = ['face', 'hair', 'outfit', 'colors', 'body_type', 'accessories'] as const;
	  const mayChangeOptions = ['outfit', 'colors', 'hairstyle', 'accessories', 'material', 'mood'] as const;
	  const mustKeepLabel: Record<(typeof mustKeepOptions)[number], string> = {
	    face: '얼굴',
	    hair: '헤어',
	    outfit: '의상',
	    colors: '색감',
	    body_type: '체형',
	    accessories: '액세서리',
	  };
	  const mayChangeLabel: Record<(typeof mayChangeOptions)[number], string> = {
	    outfit: '의상',
	    colors: '색감',
	    hairstyle: '헤어스타일',
	    accessories: '액세서리',
	    material: '소재/재질',
	    mood: '분위기',
	  };

	  const conflictMustToMay: Partial<Record<(typeof mustKeepOptions)[number], Array<(typeof mayChangeOptions)[number]>>> = {
	    hair: ['hairstyle'],
	    outfit: ['outfit'],
	    colors: ['colors'],
	    accessories: ['accessories'],
	  };
	  const conflictMayToMust: Partial<Record<(typeof mayChangeOptions)[number], Array<(typeof mustKeepOptions)[number]>>> = {
	    hairstyle: ['hair'],
	    outfit: ['outfit'],
	    colors: ['colors'],
	    accessories: ['accessories'],
	  };

	  const downloadJson = useCallback((filename: string, obj: unknown) => {
	    try {
	      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
	      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('JSON 다운로드에 실패했습니다.');
    }
  }, [showToast]);

	  const runPipeline = useCallback(async () => {
	    const nickname = (referenceState.nickname || '').trim();
	    if (!nickname) return showToast('캐릭터 별명을 입력해 주세요.');
	    if (referenceState.mode === 'GENERATE_NEW') {
	      const ageGroup = (referenceState.age_group || '').trim();
	      const gender = (referenceState.gender || '').trim();
	      const height = referenceState.height_cm;
	      if (!ageGroup || !gender || !height) {
	        return showToast('나이/성별/키 정보를 선택해 주세요.');
	      }
	    }

	    setIsWorking(true);
	    setWorkStatus('준비 중...');
	    try {
      const styleTargetRaw = (referenceState.style_target || '').trim();
      const styleTargetEn =
        styleTargetRaw && containsKorean(styleTargetRaw) ? (await translateToEnglish(styleTargetRaw)) || styleTargetRaw : styleTargetRaw;

	      const model = 'fal-ai/nano-banana-2/edit';
	      const aspectRatio = '9:16';
	      const resolution = '4K' as const;

	      const buildGridPromptEn = (opts?: { mode?: 'generate' | 'restyle'; referenceHint?: string }) => {
	        const mode = opts?.mode ?? 'generate';
	        const referenceHint = (opts?.referenceHint || '').trim();
	        const palette = referenceState.palette;
	        const paletteParts = [
	          palette.primary ? `primary ${palette.primary}` : null,
	          palette.secondary ? `secondary ${palette.secondary}` : null,
	          palette.accent ? `accent ${palette.accent}` : null,
	        ].filter(Boolean).join(', ');
	        const ageGroup = (referenceState.age_group || '').trim();
	        const gender = (referenceState.gender || '').trim();
	        const height = referenceState.height_cm;
	        const variationPolicy = referenceState.mode === 'RESTYLE_REFERENCE'
	          ? [
	              'TURNAROUND FROM EXISTING CHARACTER MODE: use the uploaded character capture as the source of truth.',
	              'Preserve the same person, same outfit design, same hairstyle, same accessories, same materials, same rendering language, same shading style, same mood, and same overall vibe.',
	              'Do not redesign the character. Do not change the art style. Do not reinterpret the costume. Do not modernize or simplify the look.',
	              'Your job is to expand one existing character capture into a full 3x3 turnaround reference sheet while keeping the original visual identity intact.',
	            ].join(' ')
	          : null;
	        const positive = [
	          'You are a senior character turnaround artist and production reference-sheet designer.',
	          'Create one single image containing a 3x3 equal-sized grid for ONE fictional character only.',
	          'This is a production reference sheet, not a moodboard, not a collage of different poses.',
	          'PRIMARY GOAL: produce nine panels showing the exact same character with strict identity consistency and strict view-direction compliance.',
	          'All panels must preserve the same face, body proportions, hairstyle, outfit, materials, colors, accessories, expression, and neutral standing pose.',
	          'Only the character facing direction changes across panels, using a clock-face system where facing the camera is 6 o’clock.',
	          'PRIORITY ORDER: 1) identity consistency across all 9 panels, 2) exact assigned clock direction for each panel, 3) exact framing for each panel, 4) outfit/material/accessory consistency, 5) clean studio presentation.',
	          'STUDIO SETUP: 3x3 equal-sized grid, no text, no labels, no watermarks, no logos, no borders.',
	          'Use a plain light neutral gray seamless studio background, even studio lighting, minimal soft floor shadow, consistent white balance, consistent exposure, and consistent subject scale across panels.',
	          'POSE AND IDENTITY LOCK: one character only, same neutral facial expression in every panel, same neutral standing pose in every panel, standing upright, arms relaxed naturally at the sides.',
	          'No contrapposto, no walking pose, no gesture, no hand pose variation, no props, no phone, no handheld objects.',
	          'No outfit change, no hairstyle change, no accessory change, no material change.',
	          'The guide image is instruction-only. Any arrows, mannequin shapes, graphic markers, corner badges, or helper overlays from the guide image must NOT appear in the final output.',
	          'Do not copy any arrows, icons, symbols, labels, numbers, or black graphic shapes from the guide image.',
	          'If any arrow or guide overlay appears in the final image, the output is invalid.',
	          'CRITICAL ANTI-FAILURE RULES: no duplicated panels, each panel must show a unique clock direction, do not improvise a new direction.',
	          'Clock-direction accuracy is more important than artistic variation.',
	          'If any panel would look too similar to another panel, correct only that panel so all nine views remain unique.',
	          'Panels 2 to 9 must follow this clockwise clock-face sequence: 6시 -> 7시 30분 -> 9시 -> 10시 30분 -> 12시 -> 1시 30분 -> 3시 -> 4시 30분.',
	          'The entire body must rotate together. Never rotate only the head. Never keep the torso front-facing while the head looks sideways.',
	          'When the body is profile or rear, the face and eyes must follow that same clock direction. Do not make the character look back toward the camera.',
	          ageGroup ? `CHARACTER SPECIFICATION: age group ${ageGroup}.` : null,
	          gender ? `gender presentation ${gender}.` : null,
	          height ? `height ${height} cm.` : null,
	          referenceState.mode === 'RESTYLE_REFERENCE'
	            ? 'Preserve the rendering language and visual style from the first reference image exactly. Do not restyle.'
	            : styleTargetEn
	              ? `style target ${styleTargetEn}.`
	              : 'style target clean studio render, neutral lighting, simple shading.',
	          paletteParts ? `palette ${paletteParts}.` : null,
	          variationPolicy,
	          mode === 'restyle'
	            ? 'Use the provided reference image as the hard source of truth for who the person is. Style target is secondary to identity preservation.'
	            : null,
	          mode === 'generate'
	            ? 'If a guide template image is provided, use it only to follow the 3x3 panel order and facing directions exactly. Do not render the guide arrows, mannequin, badges, or any helper graphics in the final output.'
	            : null,
	          mode === 'restyle'
	            ? 'If two reference images are provided, use the first image as the hard identity source and the second image only as the turnaround direction guide. Keep the same person from the first image, follow the panel order and facing directions from the second image, and never copy arrows, mannequin shapes, badges, or overlay graphics from the second image.'
	            : null,
	          referenceHint ? `Reference hint: ${referenceHint}` : null,
	          'VIEW ASSIGNMENT:',
	          'Panel 1: Upper-body portrait, 6시 방향, chest-up, eye-level, facing straight toward the camera. Fill about 60% of panel height. Clean centered portrait framing.',
	          'Panel 2: Full-body 6시 방향, eye-level, neutral stance, full head and full feet visible.',
	          'Panel 3: Full-body 7시 30분 방향, three-quarter LEFT view. Both eyes visible. More of the character left side is visible than the right side.',
	          'Panel 4: Full-body 9시 방향, LEFT profile view. Strict side view. Only one eye visible.',
	          'Panel 5: Full-body 10시 30분 방향, rear three-quarter LEFT view. Mostly back visible. Only a slight amount of the left cheek and left side of the body visible.',
	          'Panel 6: Full-body 12시 방향, direct back view. No face visible.',
	          'Panel 7: Full-body 1시 30분 방향, rear three-quarter RIGHT view. Mostly back visible. Only a slight amount of the right cheek and right side of the body visible.',
	          'Panel 8: Full-body 3시 방향, RIGHT profile view. Strict side view. Only one eye visible.',
	          'Panel 9: Full-body 4시 30분 방향, three-quarter RIGHT view. Both eyes visible. More of the character right side is visible than the left side.',
	          'CAMERA / RENDERING LANGUAGE: photorealistic studio reference sheet, panel 1 feels like an 85mm portrait lens, panels 2 to 9 feel like a 50mm full-body studio lens, eye-level camera for all panels, realistic anatomy, production-ready reference clarity.',
	          'OUTPUT REQUIREMENTS: final output must be one single 3x3 reference grid image, maintain strict character resemblance in all panels, maintain identical clothing and materials in all panels, maintain identical pose except for yaw rotation, maintain clean empty unobstructed studio presentation.',
	        ].filter(Boolean).join(' ');
        const negative = [
          'text',
          'watermark',
          'logo',
          'multiple characters',
          'busy background',
          'uneven lighting',
          'cropped head',
          'cropped feet',
          'missing head',
          'missing feet',
	          'wrong panel order',
	          'duplicate panel angle',
	          'mirrored duplicate angle',
	          'arrows',
	          'arrow icons',
	          'direction markers',
	          'overlay graphics',
	          'corner badges',
	          'panel badges',
	          'panel numbers',
	          'guide mannequin',
	          'black graphic shapes',
	          'head-only rotation',
	          'front torso with turned head',
          'profile torso with front-facing eyes',
          'back torso with face visible toward camera',
          'deformed hands',
          'extra fingers',
          'outfit change',
          'wardrobe change',
          'costume change',
          'phone',
          'smartphone',
          'holding objects',
        ].join(', ');
	        return `${positive}. Avoid: ${negative}.`;
	      };

	      const sliceGridImage = async (gridUrl: string) => {
	        const res = await fetch(gridUrl);
	        if (!res.ok) throw new Error('grid fetch failed');
	        const blob = await res.blob();
	        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
	          const image = new Image();
	          image.onload = () => resolve(image);
	          image.onerror = () => reject(new Error('grid load failed'));
	          image.src = URL.createObjectURL(blob);
	        });
	        const width = img.width;
	        const height = img.height;
	        const cellW = Math.floor(width / 3);
	        const cellH = Math.floor(height / 3);
	        const tiles: Blob[] = [];
	        for (let r = 0; r < 3; r += 1) {
	          for (let c = 0; c < 3; c += 1) {
	            const canvas = document.createElement('canvas');
	            canvas.width = cellW;
	            canvas.height = cellH;
	            const ctx = canvas.getContext('2d');
	            if (!ctx) throw new Error('canvas not available');
	            ctx.drawImage(
	              img,
	              c * cellW,
	              r * cellH,
	              cellW,
	              cellH,
	              0,
	              0,
	              cellW,
	              cellH
	            );
	            const tile = await new Promise<Blob>((resolve, reject) => {
	              canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('tile blob failed'))), 'image/png');
	            });
	            tiles.push(tile);
	          }
	        }
	        return tiles;
	      };

      const setMeta = (partial: any) => {
        const meta = {
          nickname,
          style_tags: styleTags,
          age_group: referenceState.age_group,
          gender: referenceState.gender,
          height_cm: referenceState.height_cm,
          palette: referenceState.palette,
          constraints: referenceState.constraints,
          allowed_variations: { must_keep: referenceState.must_keep, may_change: referenceState.may_change },
          generated_assets: {
            source_image_url: sourceImageUrl || undefined,
            base_front_url: baseFrontUrl || undefined,
            base_front_cutout_url: baseFrontCutoutUrl || undefined,
            turnaround_urls: turnaroundUrls,
            turnaround_cutout_urls: turnaroundCutoutUrls,
          },
          ...partial,
        };
        setReferenceState((p) => ({ ...p, metadata: meta }));
        return meta;
      };

      if (referenceState.mode === 'USE_EXISTING_CUTOUT') {
        if (!sourceImageUrl) return showToast('컷아웃(투명 PNG 등) 이미지를 업로드해 주세요.');
        setWorkStatus('컷아웃 레퍼런스 저장 중...');
        setBaseFrontUrl('');
        setBaseFrontCutoutUrl('');
        setTurnaroundUrls({});
        setTurnaroundCutoutUrls({});
        setReferenceImageUrl(sourceImageUrl);
        setMeta({ generated_assets: { source_image_url: sourceImageUrl, base_front_cutout_url: sourceImageUrl } });
        showToast('레퍼런스가 저장되었습니다.');
        return;
      }

      if (referenceState.mode === 'REMOVE_BACKGROUND') {
        showToast('배경 제거 기능은 비활성화되었습니다. 컷아웃 이미지를 직접 업로드해 주세요.');
        return;
      }

	      if (referenceState.mode === 'GENERATE_NEW') {
	        setWorkStatus('레퍼런스 그리드 생성 중...');
	        setGridProgress(null);
	        setBaseFrontUrl('');
	        setBaseFrontCutoutUrl('');
	        setTurnaroundUrls({});
	        setTurnaroundCutoutUrls({});
	        const guideTemplateBlob = await loadTurnaroundGuideTemplateBlob();
	        const guideTemplateFile = new File([guideTemplateBlob], `weav_reference_${nickname}_guide_template.png`, { type: 'image/png' });
	        const uploadedGuideTemplate = await uploadStudioReferenceImage(guideTemplateFile);
	        const gridPrompt = buildGridPromptEn({ mode: 'generate' });
	        const gridRes = await studioImage({
	          prompt: gridPrompt,
	          model,
	          aspect_ratio: aspectRatio,
	          num_images: 1,
	          reference_image_url: uploadedGuideTemplate.url,
	          image_urls: [uploadedGuideTemplate.url],
	          resolution,
	          output_format: 'png',
	        });
	        const gridUrl = gridRes.images?.[0]?.url;
	        if (!gridUrl) throw new Error('grid image url missing');

	        setWorkStatus('그리드 9분할 중...');
	        const tiles = await sliceGridImage(gridUrl);
	        const cutouts: string[] = [];
	        for (let i = 0; i < tiles.length; i += 1) {
	          setGridProgress({ current: i + 1, total: tiles.length, label: '타일 업로드' });
	          setWorkStatus(`타일 업로드 중... (${i + 1}/9)`);
	          const tileFile = new File([tiles[i]], `weav_reference_${nickname}_tile_${i + 1}.png`, { type: 'image/png' });
	          const uploaded = await uploadStudioReferenceImage(tileFile);
	          cutouts.push(uploaded.url);
	        }

	        const primaryCutout = cutouts[1] || cutouts[0] || '';
	        setBaseFrontCutoutUrl(primaryCutout);
	        setReferenceImageUrl(primaryCutout);

	        setMeta({
	          generated_assets: {
	            grid_source_url: gridUrl,
	            grid_cutout_urls: cutouts,
	            base_front_cutout_url: primaryCutout,
	            turnaround_cutout_urls: {},
	          },
	        });
	        showToast('레퍼런스 생성이 완료되었습니다.');
	        setGridProgress(null);
	        return;
	      }

      if (referenceState.mode === 'RESTYLE_REFERENCE') {
        if (!sourceImageUrl) return showToast('스타일 변경할 레퍼런스 이미지를 업로드해 주세요.');
        setBaseFrontUrl('');
        setBaseFrontCutoutUrl('');
        setTurnaroundUrls({});
        setTurnaroundCutoutUrls({});
        const guideTemplateBlob = await loadTurnaroundGuideTemplateBlob();
        const guideTemplateFile = new File([guideTemplateBlob], `weav_reference_${nickname}_guide_template.png`, { type: 'image/png' });
        const uploadedGuideTemplate = await uploadStudioReferenceImage(guideTemplateFile);
        const refForEdit = sourceImageUrl;
        const guideForEdit = uploadedGuideTemplate.url;

        setWorkStatus('리스타일 레퍼런스 그리드 생성 중...');
        setGridProgress(null);
	        const restylePrompt = buildGridPromptEn({
	          mode: 'restyle',
	          referenceHint: 'Two reference images are provided. Use the first image for exact person identity, outfit, and face consistency. Use the second image only for the turnaround panel order and facing directions.',
	        });
        const gridRes = await studioImage({
          prompt: restylePrompt,
          model,
          aspect_ratio: aspectRatio,
          num_images: 1,
          reference_image_url: refForEdit,
          image_urls: [refForEdit, guideForEdit],
          resolution,
          output_format: 'png',
        });
        const gridUrl = gridRes.images?.[0]?.url;
        if (!gridUrl) throw new Error('restyled grid url missing');

        setWorkStatus('그리드 9분할 중...');
        const tiles = await sliceGridImage(gridUrl);
        const cutouts: string[] = [];
        for (let i = 0; i < tiles.length; i += 1) {
          setGridProgress({ current: i + 1, total: tiles.length, label: '타일 업로드' });
          setWorkStatus(`타일 업로드 중... (${i + 1}/9)`);
          const tileFile = new File([tiles[i]], `weav_reference_${nickname}_tile_${i + 1}.png`, { type: 'image/png' });
          const uploaded = await uploadStudioReferenceImage(tileFile);
          cutouts.push(uploaded.url);
        }

        const primaryCutout = cutouts[1] || cutouts[0] || '';
        setBaseFrontCutoutUrl(primaryCutout);
        setReferenceImageUrl(primaryCutout);

        setMeta({
          generated_assets: {
            source_image_url: sourceImageUrl,
            grid_source_url: gridUrl,
            grid_cutout_urls: cutouts,
            base_front_cutout_url: primaryCutout,
            turnaround_cutout_urls: {},
          },
        });
        showToast('리스타일 레퍼런스 생성이 완료되었습니다.');
        setGridProgress(null);
      }
    } catch (e) {
      console.error(e);
      showToast('레퍼런스 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setWorkStatus(null);
      setIsWorking(false);
    }
  }, [
    referenceState,
    styleTags,
    sourceImageUrl,
    baseFrontUrl,
    baseFrontCutoutUrl,
    turnaroundUrls,
    turnaroundCutoutUrls,
    downloadJson,
    loadTurnaroundGuideTemplateBlob,
    setReferenceImageUrl,
    setReferenceState,
    showToast,
  ]);

  const mode = referenceState.mode;
  const showUploadCard = mode !== 'GENERATE_NEW';
  const showExample = mode === 'GENERATE_NEW' || mode === 'RESTYLE_REFERENCE';
  const showStyleTarget = mode === 'GENERATE_NEW';
  const showBodyInfo = mode === 'GENERATE_NEW' || (mode === 'RESTYLE_REFERENCE' && showAdvanced);
  const showPalette = mode === 'GENERATE_NEW' || mode === 'RESTYLE_REFERENCE' || showAdvanced;
  const showKeepChange = false;
  const showStyleAnalysisBox = (mode === 'GENERATE_NEW' || showAdvanced) && !!analyzedStylePrompt;
  const hasPreview = gridCutoutUrls.length > 0;

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 4 / Reference"
        title="레퍼런스 이미지"
        subtitle="캐릭터/아바타 등 생성에 반영할 레퍼런스 이미지를 업로드합니다."
        className="max-w-[900px] mx-auto"
      />

      <div className="max-w-[900px] mx-auto space-y-6">
        {showExample && (
          <div className="ui-card ui-card--muted text-sm text-slate-700">
            <span className="ui-label">예시 (하나의 캐릭터로 이어지는 입력)</span>
            <div className="mt-2 whitespace-pre-wrap">
              예시 캐릭터: 민수_01
              {"\n"}- 스타일: 깔끔한 2D 애니, 셀 셰이딩, 선명한 라인, 스튜디오 조명, 흰 배경
              {"\n"}- 잠금: 검은 단발(앞머리), 짙은 갈색 눈, 오프화이트 후드 + 검정 슬랙스 + 흰 스니커즈, 동그란 안경 + 왼쪽 눈 밑 점
              {"\n"}- 팔레트: 주색 #111827 / 보조색 #F9FAFB / 포인트 #3B82F6
            </div>
          </div>
        )}

        <div className="ui-card space-y-4">
          <span className="ui-label">모드</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { id: 'USE_EXISTING_CUTOUT', label: 'A. 컷아웃 그대로 사용', desc: '투명 PNG(배경제거) 이미지를 이미 갖고 있어요' },
              { id: 'REMOVE_BACKGROUND', label: 'B. AI 배경 제거해서 레퍼런스로', desc: '이미지는 있는데, AI로 배경 제거(컷아웃 PNG)가 필요해요' },
              { id: 'GENERATE_NEW', label: 'C. 레퍼런스 새로 생성', desc: '이미지가 없어서 캐릭터를 새로 만들고 싶어요' },
              { id: 'RESTYLE_REFERENCE', label: 'D. 기존 캐릭터 캡처로 턴어라운드 생성', desc: '보유한 캐릭터 캡처 1장 기준으로 같은 화풍/분위기를 유지한 3x3 턴어라운드를 만들어요' },
            ] as Array<{ id: StudioReferenceMode; label: string; desc: string }>).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setReferenceState((p) => ({ ...p, mode: m.id }))}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${referenceState.mode === m.id ? 'border-primary/50 ring-1 ring-primary/35 bg-primary/5' : 'border-border/70 hover:border-border/90'}`}
              >
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="ui-card space-y-4">
          <span className="ui-label">필수 입력</span>
          {mode === 'GENERATE_NEW' && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-700">
                캐릭터 설계가 비어 있으면 `랜덤 생성`으로 디테일한 기본값을 자동 채울 수 있습니다.
              </div>
              <button
                type="button"
                onClick={fillRandomReferenceFields}
                className="ui-btn ui-btn--secondary shrink-0"
              >
                랜덤 생성
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="ui-label">별명 (필수)</label>
              <input
                className="ui-input mt-2 w-full"
                value={referenceState.nickname}
                onChange={(e) => setReferenceState((p) => ({ ...p, nickname: e.target.value }))}
                placeholder="예: 민수_01"
              />
              <div className="text-xs text-muted-foreground mt-2">
                프로젝트 안에서 캐릭터를 구분하는 이름이에요. (추천: 한글/영문+숫자 조합)
              </div>
            </div>
            {(mode === 'GENERATE_NEW' || mode === 'RESTYLE_REFERENCE') && (
              <div className="flex items-end justify-end">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="ui-btn ui-btn--ghost"
                >
                  {showAdvanced ? '고급 설정 닫기' : '고급 설정 열기'}
                </button>
              </div>
            )}
          </div>
          {showBodyInfo && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="ui-label">나이대 {mode === 'GENERATE_NEW' ? '(필수)' : '(선택)'}</label>
                <select
                  className="ui-input mt-2 w-full"
                  value={referenceState.age_group}
                  onChange={(e) => setReferenceState((p) => ({ ...p, age_group: e.target.value }))}
                >
                  <option value="">선택</option>
                  <option value="late teens">10대 후반</option>
                  <option value="early 20s">20대 초반</option>
                  <option value="mid 20s">20대 중반</option>
                  <option value="late 20s">20대 후반</option>
                  <option value="early 30s">30대 초반</option>
                  <option value="mid 30s">30대 중반</option>
                  <option value="late 30s">30대 후반</option>
                  <option value="40s">40대</option>
                  <option value="50s+">50대 이상</option>
                </select>
              </div>
              <div>
                <label className="ui-label">성별 표현 {mode === 'GENERATE_NEW' ? '(필수)' : '(선택)'}</label>
                <select
                  className="ui-input mt-2 w-full"
                  value={referenceState.gender}
                  onChange={(e) => setReferenceState((p) => ({ ...p, gender: e.target.value }))}
                >
                  <option value="">선택</option>
                  <option value="female">여성</option>
                  <option value="male">남성</option>
                  <option value="androgynous">중성적</option>
                </select>
              </div>
              <div>
                <label className="ui-label">키 {mode === 'GENERATE_NEW' ? '(필수)' : '(선택)'}</label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={120}
                    max={220}
                    className="ui-input w-full"
                    value={referenceState.height_cm ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = raw === '' ? null : Number(raw);
                      setReferenceState((p) => ({ ...p, height_cm: Number.isNaN(next) ? null : next }));
                    }}
                    placeholder="cm"
                  />
                  <span className="text-xs text-muted-foreground">cm</span>
                </div>
              </div>
            </div>
          )}
          {showStyleTarget && (
            <div>
              <label className="ui-label">스타일/분위기 키워드</label>
              <input
                className="ui-input mt-2 w-full"
                value={referenceState.style_target}
                onChange={(e) => setReferenceState((p) => ({ ...p, style_target: e.target.value }))}
                placeholder="예: 깔끔한 2D 애니, 셀 셰이딩, 선명한 라인, 스튜디오 조명, 흰 배경"
              />
              <div className="text-xs text-muted-foreground mt-2">
                쉼표(,)로 나누면 좋아요. (예: “깔끔한 2D 애니, 셀 셰이딩, 스튜디오 조명”)
              </div>
              <div className="mt-4 space-y-3">
                <div className="text-xs text-muted-foreground">스타일 빠른 선택 (클릭 시 입력값을 교체합니다)</div>
                <div className="flex flex-wrap gap-2">
                  {styleBasePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyBaseStylePreset(preset.value)}
                      className="ui-btn ui-btn--secondary"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">스타일 추가 옵션 (클릭해서 토글)</div>
                <div className="flex flex-wrap gap-2">
                  {styleModifiers.map((tag) => {
                    const active = styleTags.map(normalizeStyleTag).includes(normalizeStyleTag(tag));
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleStyleModifier(tag)}
                        className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/70 text-slate-600 hover:border-border/90'}`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {showKeepChange && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="ui-label">꼭 유지할 요소</span>
                <div className="flex flex-wrap gap-3 text-sm">
                  {mustKeepOptions.map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={referenceState.must_keep.includes(k)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReferenceState((p) => {
                            const nextMust = checked
                              ? Array.from(new Set([...p.must_keep, k]))
                              : p.must_keep.filter((x) => x !== k);
                            const conflicts = conflictMustToMay[k] ?? [];
                            const nextMay = checked ? p.may_change.filter((x) => !conflicts.includes(x as any)) : p.may_change;
                            return { ...p, must_keep: nextMust as any, may_change: nextMay as any };
                          });
                        }}
                      />
                      {mustKeepLabel[k]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="ui-label">변경해도 되는 요소</span>
                <div className="flex flex-wrap gap-3 text-sm">
                  {mayChangeOptions.map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={referenceState.may_change.includes(k)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReferenceState((p) => {
                            const nextMay = checked
                              ? Array.from(new Set([...p.may_change, k]))
                              : p.may_change.filter((x) => x !== k);
                            const conflicts = conflictMayToMust[k] ?? [];
                            const nextMust = checked ? p.must_keep.filter((x) => !conflicts.includes(x as any)) : p.must_keep;
                            return { ...p, must_keep: nextMust as any, may_change: nextMay as any };
                          });
                        }}
                      />
                      {mayChangeLabel[k]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {showUploadCard && (
          <div className="ui-card space-y-4">
            <div className="flex items-center justify-between">
              <span className="ui-label">레퍼런스 업로드</span>
              <div className="flex items-center gap-2">
                {mode === 'REMOVE_BACKGROUND' && (
                  <label className="text-xs text-muted-foreground flex items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={referenceState.crop_to_bbox}
                      onChange={(e) => setReferenceState((p) => ({ ...p, crop_to_bbox: e.target.checked }))}
                    />
                    인물 중심으로 자동 크롭
                  </label>
                )}
                <button onClick={() => fileInputRef.current?.click()} disabled={isRefAnalyzing || isWorking} className="ui-btn ui-btn--secondary">
                  {isRefAnalyzing ? <><Loader2 size={14} className="animate-spin" /> 업로드 중...</> : '파일 선택'}
                </button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {mode === 'USE_EXISTING_CUTOUT'
                ? '투명 PNG(배경 제거된 이미지)를 업로드해 주세요.'
                : mode === 'REMOVE_BACKGROUND'
                  ? '배경이 있는 이미지를 올리면 AI 배경 제거(모델 기반)로 컷아웃(투명 PNG)으로 만들어 드립니다. (복잡한 배경은 경계가 조금 거칠 수 있어요)'
                : mode === 'RESTYLE_REFERENCE'
                  ? '기준이 되는 캐릭터 캡처 이미지를 업로드해 주세요. 화풍과 분위기를 바꾸지 않고 같은 캐릭터의 턴어라운드를 생성합니다.'
                  : '기준이 되는 레퍼런스 이미지를 업로드해 주세요.'}
            </div>
            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && handleImgUpload(e.target.files[0])} accept="image/*" />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsImgDragging(true); }}
              onDragLeave={() => setIsImgDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsImgDragging(false); if (e.dataTransfer.files[0]) handleImgUpload(e.dataTransfer.files[0]); }}
              className={`rounded-2xl border border-dashed px-4 py-5 cursor-pointer ${isImgDragging ? 'bg-primary/12 border-primary/45' : 'border-border/70 bg-secondary/20'}`}
            >
              {sourceImageUrl ? (
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-primary mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">업로드 완료</div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {sourceFileName ? `파일: ${sourceFileName}` : '파일이 업로드되었습니다.'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      필요하면 클릭해서 다른 파일로 바꿀 수 있어요.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 text-slate-500">
                  <ImagePlus size={18} className="mt-0.5" />
                  <div>
                    <div className="text-sm">여기에 파일을 드래그하거나 클릭해서 선택하세요</div>
                    <div className="text-xs mt-1">지원: JPG/PNG/WebP (권장: 정면/전신, 단순 배경)</div>
                  </div>
                </div>
              )}
            </div>
            {!!referenceImageUrl && (
              <div className="text-xs text-muted-foreground">
                업로드 URL이 저장되었습니다. (Step 5 비주얼 생성 시 레퍼런스로 사용)
              </div>
            )}
          </div>
        )}

        {showStyleAnalysisBox && (
          <div className="ui-card space-y-4">
            <span className="ui-label">스타일 요약 (자동 분석)</span>
            <div className="text-xs text-muted-foreground">
              업로드한 이미지를 바탕으로 “스타일/분위기 키워드”를 자동으로 뽑아줬어요. 필요하면 위 입력칸에서 수정해도 됩니다.
            </div>
            <div className="ui-card--muted text-sm text-slate-700">
              <div className="whitespace-pre-wrap">{analyzedStylePrompt}</div>
              <div className="mt-3 pt-3 border-t border-border/60">
                <span className="ui-label">번역 (KO)</span>
                <div className="whitespace-pre-wrap mt-2 text-slate-800">
                  {analyzedStylePromptKo || '번역이 아직 없습니다.'}
                </div>
              </div>
            </div>
          </div>
        )}

        {showPalette && (
          <div className="ui-card space-y-4">
            <span className="ui-label">팔레트 (선택)</span>
            <div className="text-xs text-muted-foreground">
              레퍼런스의 주요 색감을 지정하면 캐릭터 톤이 더 안정적으로 유지됩니다.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="주색 선택"
                  value={safeColorInputValue(referenceState.palette.primary)}
                  onChange={(e) =>
                    setReferenceState((p) => ({
                      ...p,
                      palette: { ...p.palette, primary: normalizeHexColor(e.target.value) ?? e.target.value },
                    }))
                  }
                  className="h-10 w-10 rounded-xl border border-border/70 bg-transparent"
                />
                <input
                  className="ui-input flex-1"
                  value={referenceState.palette.primary}
                  onChange={(e) => setReferenceState((p) => ({ ...p, palette: { ...p.palette, primary: e.target.value } }))}
                  placeholder="주색 예시: #111827 (검정 계열)"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="보조색 선택"
                  value={safeColorInputValue(referenceState.palette.secondary)}
                  onChange={(e) =>
                    setReferenceState((p) => ({
                      ...p,
                      palette: { ...p.palette, secondary: normalizeHexColor(e.target.value) ?? e.target.value },
                    }))
                  }
                  className="h-10 w-10 rounded-xl border border-border/70 bg-transparent"
                />
                <input
                  className="ui-input flex-1"
                  value={referenceState.palette.secondary}
                  onChange={(e) => setReferenceState((p) => ({ ...p, palette: { ...p.palette, secondary: e.target.value } }))}
                  placeholder="보조색 예시: #F9FAFB (오프화이트)"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="포인트 색 선택"
                  value={safeColorInputValue(referenceState.palette.accent)}
                  onChange={(e) =>
                    setReferenceState((p) => ({
                      ...p,
                      palette: { ...p.palette, accent: normalizeHexColor(e.target.value) ?? e.target.value },
                    }))
                  }
                  className="h-10 w-10 rounded-xl border border-border/70 bg-transparent"
                />
                <input
                  className="ui-input flex-1"
                  value={referenceState.palette.accent}
                  onChange={(e) => setReferenceState((p) => ({ ...p, palette: { ...p.palette, accent: e.target.value } }))}
                  placeholder="포인트 색 예시: #3B82F6 (파랑)"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={runPipeline}
            disabled={isWorking || isRefAnalyzing}
            className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
          >
            {isWorking ? <><Loader2 size={16} className="animate-spin" /> {workStatus || '처리 중...'}</> : '레퍼런스 만들기'}
          </button>
          <button
            type="button"
            onClick={() => referenceState.metadata && downloadJson(`weav_reference_${(referenceState.nickname || 'character').trim() || 'character'}.json`, referenceState.metadata)}
            disabled={!referenceState.metadata}
            className="ui-btn ui-btn--secondary w-full"
          >
            메타데이터 JSON 다운로드
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCurrentStep(5)}
          className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
        >
          비주얼로 이동 <ChevronRight size={18} />
        </button>

        {hasPreview && (
          <div className="ui-card space-y-4">
            <div className="flex items-center justify-between">
              <span className="ui-label">레퍼런스 타일 수정</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>필요한 타일만 선택해서 수정하세요.</span>
                <button
                  type="button"
                  onClick={downloadReferenceZip}
                  disabled={isZipDownloading}
                  className="ui-btn ui-btn--ghost"
                >
                  {isZipDownloading ? '압축 중...' : 'ZIP 다운로드'}
                </button>
              </div>
            </div>
            {gridCutoutUrls.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-2xl overflow-hidden border border-border/60 bg-secondary/20">
                  <div className="grid grid-cols-3 gap-0">
                    {gridCutoutUrls.map((url, idx) => {
                      const spec = tileSpecs[idx];
                      const selected = selectedTileIndex === idx;
                      return (
                        <button
                          key={url || idx}
                          type="button"
                          onClick={() => {
                            setSelectedTileIndex(idx);
                            setTileEditPrompt('');
                            setTileOverrideAngle('');
                          }}
                          className={`relative aspect-[9/16] w-full overflow-hidden border border-border/40 bg-slate-100 ${selected ? 'ring-2 ring-primary/60 z-10' : ''} cursor-pointer`}
                        >
                          <img src={url} alt={`reference tile ${idx + 1}`} className="h-full w-full object-cover" />
                          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                            {spec?.label ?? idx + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {selectedTileIndex != null && tileSpecs[selectedTileIndex] && (
                  <div className="ui-card--muted space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">
                        선택한 타일: {tileSpecs[selectedTileIndex].label} ({tileSpecs[selectedTileIndex].angle}, {tileSpecs[selectedTileIndex].view})
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTileIndex(null);
                          setTileEditPrompt('');
                        }}
                        className="ui-btn ui-btn--ghost"
                      >
                        선택 해제
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="ui-label">방향 재지정 (선택)</label>
                        <select
                          className="ui-input mt-2 w-full"
                          value={tileOverrideAngle}
                          onChange={(e) => setTileOverrideAngle(e.target.value)}
                        >
                          <option value="">기본 각도 유지</option>
                          {tileAngleOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-end">
                        각도를 재지정하면 해당 방향으로 다시 생성합니다.
                      </div>
                    </div>
                    <textarea
                      className="ui-input min-h-[96px]"
                      value={tileEditPrompt}
                      onChange={(e) => setTileEditPrompt(e.target.value)}
                      placeholder="예: 5번은 반대로 고개를 돌려주세요. 7번은 오른쪽을 바라보게 해주세요."
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={regenerateTile}
                        disabled={isTileRegenerating}
                        className="ui-btn ui-btn--secondary"
                      >
                        {isTileRegenerating ? '재생성 중...' : '선택 타일 재생성'}
                      </button>
                      <span className="text-xs text-muted-foreground">이 타일만 새로 생성됩니다.</span>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {isWorking && gridProgress && (
              <div className="ui-card--muted text-sm text-slate-600">
                <div className="flex items-center justify-between">
                  <span>{gridProgress.label}</span>
                  <span>{gridProgress.current} / {gridProgress.total}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-secondary/60 overflow-hidden">
                  <div
                    className="h-full bg-primary/60"
                    style={{ width: `${Math.round((gridProgress.current / gridProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- [Step 5: 이미지 및 대본 생성] ---
const ImageAndScriptStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    masterScript, scenes, setScenes, selectedStyle, setSelectedStyle, videoFormat,
    referenceImageUrl,
    analyzedStylePrompt,
    urlAnalysisData, selectedBenchmarkPatterns
  } = useGlobal();

  const [isSplitting, setIsSplitting] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);

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
	        kicker="Step 5 / Visual"
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

// --- [Step 6: 보이스 프리셋 (MiniMax voice_id)] ---
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

// --- [Step 6: AI 음성 합성] ---
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
        kicker="Step 6 / Voice"
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
                Step 5에서 장면을 만든 뒤 여기로 오세요.
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

// --- [Step 7: AI 영상 생성] ---
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
    if (readyScenes.length === 0) return showToast('자막을 만들려면 이미지+음성이 있는 씬이 필요합니다. (Step 5~6 완료)');
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
    if (readyScenes.length === 0) return showToast('자막을 만들려면 이미지+음성이 있는 씬이 필요합니다. (Step 5~6 완료)');
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
    if (readyScenes.length === 0) return showToast('내보내려면 이미지+음성이 모두 있는 씬이 필요합니다. Step 5~6를 완료해주세요.');
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
        kicker="Step 7 / Video"
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
            Step 5에서 씬 이미지, Step 6에서 씬 음성을 만든 뒤 이 단계에서 MP4로 렌더링합니다.
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 8: 최적화 메타 설정 — AI 자동 생성] ---
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
        kicker="Step 8 / Meta"
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

// --- [Step 9: 썸네일 연구소] ---
const ThumbnailStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { thumbnailData, setThumbnailData, setCurrentStep, videoFormat, selectedTopic, finalTopic } = useGlobal();
  const thumbnails = (thumbnailData.thumbnails?.length ?? 0) > 0 ? (thumbnailData.thumbnails as ThumbnailCandidate[]) : MOCK_THUMBNAILS;
  const ytUrlInput = thumbnailData.ytUrlInput || '';
  const ytThumbnailUrl = thumbnailData.ytThumbnailUrl;
  const [ytThumbnailError, setYtThumbnailError] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkSummary, setBenchmarkSummary] = useState<string | null>(null);
  const thumbnailAspectClass = videoFormat === '9:16' ? 'aspect-[9/16]' : 'aspect-video';
  const videoFormatLabel = videoFormat === '9:16' ? '세로형(9:16)' : '가로형(16:9)';
  const topicForThumbnail = (finalTopic || selectedTopic || '').trim();

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
    if (!topicForThumbnail) {
      showToast('먼저 주제를 확정한 뒤 벤치마킹 썸네일을 생성해주세요.');
      return;
    }
    setIsBenchmarking(true);
    setBenchmarkSummary(null);
    try {
      const { imageUrl, analysisSummary } = await generateBenchmarkThumbnail(
        ytThumbnailUrl,
        topicForThumbnail,
        videoFormat === '9:16' ? '9:16' : '16:9'
      );
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
        kicker="Step 9 / Thumbnail"
        title="썸네일 연구소"
        subtitle={`유튜브 URL로 썸네일을 불러온 뒤 벤치마킹하면, 같은 톤의 썸네일을 AI가 생성합니다. 최종 결과물은 현재 영상 포맷인 ${videoFormatLabel}으로 고정됩니다.`}
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
            <div className="text-xs text-slate-500">
              벤치마킹 원본이 가로/세로 무엇이든, 생성 결과는 Step 1에서 선택한 영상 포맷({videoFormatLabel})에 맞춰 제작됩니다.
            </div>
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
              <div className={`${thumbnailAspectClass} bg-slate-100 flex items-center justify-center text-slate-400 font-medium text-sm overflow-hidden`}>
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

      {setCurrentStep && (
        <div className="pt-4">
          <button
            type="button"
            onClick={() => setCurrentStep(10)}
            className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
          >
            완성 미리보기 <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
};

// --- [Step 10: 완성 미리보기] ---
const PreviewStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { videoUrl, metaTitle, metaDescription, metaPinnedComment, thumbnailData, setCurrentStep, videoFormat } = useGlobal();
  const [isDownloading, setIsDownloading] = useState(false);

  const thumbnails = (thumbnailData?.thumbnails?.length ?? 0) > 0 ? thumbnailData.thumbnails as ThumbnailCandidate[] : [];
  const selectedThumb = thumbnails.find((t: ThumbnailCandidate) => t.isSelected) ?? thumbnails[0];
  const thumbImg = selectedThumb?.imageUrl ?? thumbnailData?.ytThumbnailUrl ?? null;
  const previewAspectClass = videoFormat === '9:16' ? 'aspect-[9/16]' : 'aspect-video';

  const handleDownload = async () => {
    if (!videoUrl) {
      showToast('영상을 먼저 생성해 주세요. (Step 7)');
      return;
    }
    setIsDownloading(true);
    try {
      const res = await fetch(videoUrl, { mode: 'cors' });
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'weav-studio-video.mp4';
      a.click();
      URL.revokeObjectURL(blobUrl);
      showToast('다운로드가 시작되었습니다.');
    } catch {
      showToast('다운로드에 실패했습니다. 링크가 만료되었을 수 있습니다.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 10 / 미리보기"
        title="완성 미리보기"
        subtitle="유튜브 업로드 후 보이는 모습으로 한눈에 확인하세요."
      />

      <div className="ui-card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          {/* 영상/썸네일 영역 */}
          <div className="lg:col-span-7">
            <div className={`relative ${previewAspectClass} bg-black rounded-xl overflow-hidden`}>
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                  poster={thumbImg || undefined}
                  preload="metadata"
                >
                  이 브라우저는 비디오 재생을 지원하지 않습니다.
                </video>
              ) : thumbImg ? (
                <div className="relative w-full h-full">
                  <img src={thumbImg} alt="썸네일" className="w-full h-full object-contain" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <p className="text-white/90 text-sm">Step 7에서 영상을 생성해 주세요</p>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                  <Film size={48} className="mb-2 opacity-50" />
                  <p className="text-sm">영상·썸네일을 먼저 완성해 주세요</p>
                  <p className="text-xs mt-1">Step 7 영상 생성 → Step 9 썸네일</p>
                </div>
              )}
            </div>
          </div>

          {/* 메타데이터 영역 (유튜브 스타일) */}
          <div className="lg:col-span-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground line-clamp-2">
                {metaTitle || '제목 없음'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">WEAV Studio</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-secondary/45 px-4 py-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              {metaDescription || '설명이 없습니다. Step 8에서 메타데이터를 생성해 주세요.'}
            </div>
            {metaPinnedComment && (
              <div className="rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground mb-1">고정 댓글</p>
                <p className="text-foreground whitespace-pre-wrap">{metaPinnedComment}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 pt-6 border-t border-border/70 mt-6">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!videoUrl || isDownloading}
            className="ui-btn ui-btn--primary"
          >
            {isDownloading ? <><Loader2 size={14} className="animate-spin" /> 다운로드 중...</> : <><Download size={14} /> 영상 다운로드</>}
          </button>
          {setCurrentStep && (
            <button
              type="button"
	              onClick={() => setCurrentStep(9)}
              className="ui-btn ui-btn--secondary"
            >
              썸네일로 돌아가기
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- [메인 레이아웃 쉘] ---
const AppContent = ({ projectName }: { projectName: string }) => {
  const {
    sessionId,
    currentStep, setCurrentStep, isLoading, loadingMessage, setDescriptionInput, setIsFileLoaded, isDevMode,
    videoFormat, setVideoFormat, scriptStyle, setScriptStyle, planningData, setPlanningData,
    selectedStyle, setSelectedStyle, selectedVoicePresetId, setSelectedVoicePresetId,
    subtitlesEnabled, setSubtitlesEnabled, burnInSubtitles, setBurnInSubtitles,
  } = useGlobal();
  const [toast, setToast] = useState<string | null>(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  const PRESET_KEY = 'weav_studio_presets_v1';
  const selectedPresetStorageKey = useMemo(
    () => `weav_studio_selected_preset_id_v1${sessionId != null ? `_${sessionId}` : ''}`,
    [sessionId]
  );
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
  const [selectedPresetId, setSelectedPresetIdState] = useState<string>(() => {
    try {
      const key = `weav_studio_selected_preset_id_v1${sessionId != null ? `_${sessionId}` : ''}`;
      const raw = localStorage.getItem(PRESET_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const saved = localStorage.getItem(key);
      const id = typeof saved === 'string' ? saved : '';
      if (id && list.some((p: StudioPreset) => p.id === id)) return id;
      return '';
    } catch {
      return '';
    }
  });
  const [showPresetDeleteConfirm, setShowPresetDeleteConfirm] = useState(false);

  const setSelectedPresetId = useCallback((id: string) => {
    setSelectedPresetIdState(id);
    try {
      localStorage.setItem(selectedPresetStorageKey, id);
    } catch {
      /* ignore */
    }
  }, [selectedPresetStorageKey]);

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
    setShowPresetSaveDialog(true);
  };

  const confirmSavePreset = (name: string) => {
    setShowPresetSaveDialog(false);
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
    setShowPresetDeleteConfirm(true);
  };

  const confirmDeletePreset = () => {
    const p = presets.find(x => x.id === selectedPresetId);
    if (!p) {
      setShowPresetDeleteConfirm(false);
      return;
    }
    const next = presets.filter(x => x.id !== selectedPresetId);
    persistPresets(next);
    setSelectedPresetId('');
    setShowPresetDeleteConfirm(false);
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
    { id: 4, label: '레퍼런스', icon: <ImagePlus size={14}/> },
    { id: 5, label: '비주얼', icon: <ImageIcon size={14}/> },
    { id: 6, label: '음성', icon: <Mic2 size={14}/> },
    { id: 7, label: '영상', icon: <Video size={14}/> },
    { id: 8, label: '메타', icon: <Monitor size={14}/> },
    { id: 9, label: '썸네일', icon: <ImageIcon size={14}/> },
    { id: 10, label: '미리보기', icon: <Film size={14}/> }
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

      <InputDialog
        open={showPresetSaveDialog}
        title="프리셋 저장"
        message="프리셋 이름을 입력하세요"
        placeholder={`내 프리셋 ${presets.length + 1}`}
        defaultValue={`내 프리셋 ${presets.length + 1}`}
        confirmLabel="저장"
        cancelLabel="취소"
        onConfirm={confirmSavePreset}
        onCancel={() => setShowPresetSaveDialog(false)}
      />
      <ConfirmDialog
        open={showPresetDeleteConfirm}
        title="프리셋 삭제"
        message={
          selectedPresetId && presets.find((p) => p.id === selectedPresetId)
            ? `프리셋 "${presets.find((p) => p.id === selectedPresetId)?.name}"을 삭제할까요?`
            : ''
        }
        confirmLabel="삭제"
        cancelLabel="취소"
        variant="destructive"
        onConfirm={confirmDeletePreset}
        onCancel={() => setShowPresetDeleteConfirm(false)}
      />

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
          {currentStep === 4 && <ReferenceStep showToast={showToast} />}
          {currentStep === 5 && <ImageAndScriptStep showToast={showToast} />}
          {currentStep === 6 && <VoiceStep />}
          {currentStep === 7 && <VideoStep showToast={showToast} />}
          {currentStep === 8 && <MetaStep showToast={showToast} />}
          {currentStep === 9 && <ThumbnailStep showToast={showToast} />}
          {currentStep === 10 && <PreviewStep showToast={showToast} />}
        </div>
      </main>
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
