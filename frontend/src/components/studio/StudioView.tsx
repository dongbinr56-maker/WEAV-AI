
import React, { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react';
import { 
  Search, X, Info, Rocket, History, Ghost, BookOpen, Lightbulb, 
  TrendingUp, Globe, MonitorPlay, ChevronRight, Flame, Lock, 
  Loader2, CheckCircle2, PlayCircle, Layers, Trash2, Link as LinkIcon,
  Sparkles, Clock, LayoutDashboard, Target, Cpu, 
  AlertTriangle, Terminal, ShieldCheck, Image as ImageIcon, Type,
  Video, Wand2, Eye, MessageSquare, Camera, Plus, ChevronDown, ChevronUp,
  Mic2, FileText, AlignLeft, Settings2, Sliders, ArrowUp, ArrowDown, Users,
  Music4, Activity, Smartphone, Monitor, PenTool, Share2, RefreshCcw, Utensils,
  MessageCircle, GripVertical, Zap, Hash, Compass, Sword, Microscope, Palette,
  Map, Film, Church, Heart, FileUp, FileType, Star, Gift, Laptop, Leaf, Coffee, Smile,
  BarChart3, Fingerprint, ClipboardCheck, Quote, ChevronLeft, Box, Boxes, Wand, UploadCloud, EyeOff, CheckSquare, Edit3, ImagePlus, ScanLine, Download
} from 'lucide-react';
import { StudioGlobalContextType, StudioScene, StudioScriptSegment, StudioAnalysisResult, StudioScriptPlanningData } from '@/types/studio';
import { 
  analyzeTopic, analyzeUrlPattern, generateTopics, generatePlanningStep, 
  synthesizeMasterScript, splitScriptIntoScenes, sanitizeScriptSegment, generateSceneImage,
  analyzeReferenceImage, generateScenePrompt, generateMetaData, generateBenchmarkThumbnail
} from '@/services/studio/geminiService';
import { studioTts, studioExportVideo } from '@/services/studio/studioFalApi';
import { fetchTrendingByCategory, formatTrendingGrowth, type TrendingItemWithCategory, type TrendTemplate } from '@/services/studio/trendingApi';

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
  const [urlAnalysisData, setUrlAnalysisData] = useState<any>(null);
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
  const [analyzedStylePrompt, setAnalyzedStylePrompt] = useState(() => (typeof stored?.analyzedStylePrompt === 'string') ? stored.analyzedStylePrompt : '');

  const [analysisResult, setAnalysisResult] = useState<StudioAnalysisResult>({
    niche: [],
    trending: [],
    confidence: '--',
    error: null,
    isAnalyzing: false,
    isUrlAnalyzing: false
  });

  const [scenes, setScenes] = useState<StudioScene[]>(() => Array.isArray(stored?.scenes) && stored.scenes.length > 0 ? stored.scenes as StudioScene[] : []);
  const [sceneDurations, setSceneDurations] = useState<number[]>([]);
  const [scriptSegments, setScriptSegments] = useState<StudioScriptSegment[]>([]);
  const [generatedTopics, setGeneratedTopics] = useState<string[]>(() => Array.isArray(stored?.generatedTopics) ? stored.generatedTopics : []);
  const [selectedTopic, setSelectedTopic] = useState(() => (typeof stored?.selectedTopic === 'string') ? stored.selectedTopic : '');
  const [referenceScript, setReferenceScript] = useState('');
  const [scriptStyle, setScriptStyle] = useState(() => (typeof stored?.scriptStyle === 'string') ? stored.scriptStyle : 'type-a');
  const [customScriptStyleText, setCustomScriptStyleText] = useState(() => (typeof stored?.customScriptStyleText === 'string') ? stored.customScriptStyleText : '');
  const [scriptLength, setScriptLength] = useState(() => (typeof stored?.scriptLength === 'string') ? stored.scriptLength : 'short');
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
      currentStep, activeTags, urlInput, videoFormat, inputMode,
      descriptionInput, scenes, scriptStyle, customScriptStyleText, scriptLength, planningData,
      selectedTopic, generatedTopics, masterScript, selectedStyle,
      referenceImage, analyzedStylePrompt
    };
    localStorage.setItem(storageKey, JSON.stringify(data));
  }, [storageKey, currentStep, activeTags, urlInput, videoFormat, inputMode, descriptionInput, scenes, scriptStyle, customScriptStyleText, scriptLength, planningData, selectedTopic, generatedTopics, masterScript, selectedStyle, referenceImage, analyzedStylePrompt]);

  const value = {
    currentStep, setCurrentStep, activeTags, setActiveTags, urlInput, setUrlInput, urlAnalysisData, setUrlAnalysisData,
    isLoading, setIsLoading, loadingMessage, setLoadingMessage, isDevMode, setIsDevMode, videoFormat, setVideoFormat,
    analysisResult, setAnalysisResult, inputMode, setInputMode, descriptionInput, setDescriptionInput,
    scenes, setScenes, sceneDurations, setSceneDurations, scriptSegments, setScriptSegments,
    generatedTopics, setGeneratedTopics, selectedTopic, setSelectedTopic, referenceScript, setReferenceScript,
    scriptStyle, setScriptStyle, customScriptStyleText, setCustomScriptStyleText, scriptLength, setScriptLength, planningData, setPlanningData,
    isFileLoaded, setIsFileLoaded, masterScript, setMasterScript, selectedStyle, setSelectedStyle,
    referenceImage, setReferenceImage, analyzedStylePrompt, setAnalyzedStylePrompt
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

// --- [사이드바] ---
const Sidebar = ({ isOpen, toggleSidebar }: { isOpen: boolean, toggleSidebar: () => void }) => {
  const { currentStep, setCurrentStep, isDevMode, setIsDevMode } = useGlobal();
  const steps = [
    { id: 1, name: '1. 기획 및 전략 분석', icon: <Target size={18}/> },
    { id: 2, name: '2. 영상 주제 선정', icon: <Sparkles size={18}/> },
    { id: 3, name: '3. 대본 구조 설계', icon: <PenTool size={18}/> },
    { id: 4, name: '4. 이미지 및 대본 생성', icon: <ImageIcon size={18}/> },
    { id: 5, name: '5. AI 음성 생성', icon: <Mic2 size={18}/> },
    { id: 6, name: '6. AI 영상 생성', icon: <Video size={18}/> },
    { id: 7, name: '7. 최적화 메타 설정', icon: <Monitor size={18}/> },
    { id: 8, name: '8. 썸네일 연구소', icon: <ImageIcon size={18}/> }
  ];

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/40 z-[45] backdrop-blur-sm lg:hidden" onClick={toggleSidebar} />}
      <aside className={`fixed lg:static inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col z-50 transition-all duration-300 shadow-2xl lg:shadow-none ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} shrink-0`}>
        <div className="h-32 px-12 border-b border-slate-100 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Zap size={18} fill="currentColor" className="text-yellow-400" />
            </div>
            <div className="flex flex-col">
              <span className="ui-label">WEAV STUDIO</span>
              <span className="font-serif text-lg text-slate-900">Creative Suite</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-2 scrollbar-hide">
          {steps.map(s => {
            const isActive = currentStep === s.id;
            const isLocked = !isDevMode && s.id > currentStep;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-7 px-12 py-6 cursor-pointer transition-all duration-500 relative ${isActive ? 'bg-slate-50/70' : isLocked ? 'opacity-20 cursor-not-allowed' : 'hover:bg-slate-50/40'}`}
                onClick={() => !isLocked && (setCurrentStep(s.id), window.innerWidth < 1024 && toggleSidebar())}
              >
                <div className={`w-11 h-11 rounded-[1.2rem] flex items-center justify-center text-[13px] font-black border-2 transition-all duration-500 ${isActive ? 'bg-slate-900 border-slate-900 text-white shadow-xl rotate-6' : 'bg-white border-slate-200 text-slate-700 group-hover:text-slate-900'}`}>
                  {isLocked ? <Lock size={12} /> : s.id}
                </div>
                <div className="flex-1 flex flex-col">
                  <span className={`text-[14px] font-black uppercase tracking-tight transition-colors duration-300 ${isActive ? 'text-slate-900 italic' : 'text-slate-700 group-hover:text-slate-900'}`}>{s.name}</span>
                  {isActive && <div className="h-[2.5px] w-full bg-rose-600 mt-1.5 animate-in slide-in-from-left duration-700 shadow-lg shadow-rose-200" />}
                </div>
                {isActive && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-12 bg-rose-600 rounded-l-full shadow-xl shadow-rose-200" />}
              </div>
            );
          })}
        </nav>

        <div className="p-12 border-t border-slate-100 flex items-center justify-between bg-slate-50/30">
          <button onClick={() => setIsDevMode(!isDevMode)} className={`p-4 rounded-[1.2rem] transition-all duration-500 shadow-sm border ${isDevMode ? 'bg-slate-900 text-white border-slate-900 shadow-xl' : 'bg-white text-slate-700 border-slate-200 hover:text-slate-900'}`}>
            <Terminal size={20} />
          </button>
          <div className="flex flex-col items-end">
            <p className={`text-[10px] font-black uppercase tracking-widest leading-none ${isDevMode ? 'text-slate-900' : 'text-slate-700'}`}>Workspace Status</p>
            <p className="text-[9px] text-slate-700 font-bold mt-2 tracking-tighter italic">V 1.2 PRO STABLE</p>
          </div>
        </div>
      </aside>
    </>
  );
};

// --- [Step 1: 기획 및 전략 분석] ---
const TopicAnalysisStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    activeTags, setActiveTags, analysisResult, setAnalysisResult, inputMode, setInputMode, descriptionInput, setDescriptionInput,
    videoFormat, setVideoFormat, urlInput, setUrlInput, setGeneratedTopics, urlAnalysisData, setUrlAnalysisData, isFileLoaded, setCurrentStep
  } = useGlobal();

  const [isTopicGenerating, setIsTopicGenerating] = useState(false);
  const [selectedBenchmarkPatterns, setSelectedBenchmarkPatterns] = useState<string[]>([]);

  const [templateMode, setTemplateMode] = useState<'mainstream' | 'niche'>('mainstream');
  const [trendDisplayFilter, setTrendDisplayFilter] = useState<TrendTemplate>('all');
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

  const runTopicAnalysis = async () => {
    const triggerValue = inputMode === 'tag' ? activeTags.join(', ') : descriptionInput.trim();
    if (triggerValue.length < 2) return showToast("분석할 내용을 입력해주세요.");

    setAnalysisResult(p => ({ ...p, isAnalyzing: true, error: null }));
    try {
      const res = await analyzeTopic(triggerValue, inputMode);
      setAnalysisResult(prev => ({
        ...prev,
        isAnalyzing: false,
        niche: res.niche,
        trending: res.trending,
        confidence: res.confidence
      }));
    } catch {
      setAnalysisResult(p => ({ ...p, isAnalyzing: false, error: "분석 실패" }));
      showToast("분석 엔진 호출 중 오류가 발생했습니다.");
    }
  };

  const runUrlAnalysis = async (url: string) => {
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube\.com\/shorts)\/.+$/;
    if (!ytRegex.test(url)) return showToast("유효한 유튜브 주소가 아닙니다.");
    
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
      showToast("패턴 분석이 완료되었습니다. 패턴을 클릭해 선택한 뒤 주제 생성하기를 누르세요.");
    } catch (e) {
      setAnalysisResult(p => ({ ...p, isUrlAnalyzing: false, error: "분석 실패" }));
      showToast("URL 분석에 실패했습니다.");
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
      const res = await generateTopics({ tags: activeTags, description: descriptionInput, urlData });
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

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 1 / 기획"
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
                    <button
                      onClick={() => { setTemplateMode('mainstream'); setTrendDisplayFilter('mainstream'); }}
                      className={`planner-toggle__item ${trendDisplayFilter === 'mainstream' ? 'is-active' : ''}`}
                    >
                      인기
                    </button>
                    <button
                      onClick={() => { setTemplateMode('niche'); setTrendDisplayFilter('niche'); }}
                      className={`planner-toggle__item ${trendDisplayFilter === 'niche' ? 'is-active' : ''}`}
                    >
                      틈새
                    </button>
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
                {urlAnalysisData.summary && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">요약</span>
                    <p className="mt-1 text-sm text-slate-800">{urlAnalysisData.summary}</p>
                  </div>
                )}
                {urlAnalysisData.patterns?.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-slate-500">패턴 (클릭하여 선택 후 주제 생성 시 반영)</span>
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
            <div className="mt-4">
              <button onClick={handleStartTopicGen} disabled={isTopicGenerating} className="wf-primary w-full">
                {isTopicGenerating ? <><Loader2 size={16} className="animate-spin" /> 주제 생성 중...</> : <><Sparkles size={16} /> 주제 생성하기</>}
              </button>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-6">
          <div className="wf-panel">
            <div className="wf-panel__header">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} />
                <span className="wf-label">실시간 트렌드</span>
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
  const { generatedTopics, selectedTopic, setSelectedTopic, setCurrentStep } = useGlobal();
  const [manualTopic, setManualTopic] = useState('');

  const handleFinalize = async () => {
    const topic = selectedTopic === 'manual' ? manualTopic : selectedTopic;
    if (!topic) return showToast("분석에 사용할 주제를 선택하거나 직접 입력해주세요.");
    setCurrentStep(3);
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1000px] mx-auto">
      <SectionHeader
        kicker="Step 2 / 주제"
        title="주제 선택"
        subtitle="AI가 추천한 주제 중 하나를 선택하거나 직접 입력하세요."
      />

      <div className="ui-card ui-card--flush overflow-hidden">
        {generatedTopics.map((topic, idx) => (
          <button
            key={idx}
            onClick={() => setSelectedTopic(topic)}
            className={`topic-row w-full flex items-center justify-between px-6 py-5 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl ${selectedTopic === topic ? 'is-selected' : ''}`}
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
const ScriptPlanningStep = () => {
  const { 
    selectedTopic, scriptStyle, setScriptStyle, customScriptStyleText, setCustomScriptStyleText, scriptLength,
    planningData, setPlanningData, setCurrentStep,
    masterScript, setMasterScript
  } = useGlobal();

  const [activeSubStep, setActiveSubStep] = useState(1);
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
    { id: 'custom', label: '직접 입력', icon: <PenTool size={14}/> }
  ];

  /** 목표 길이 직접 입력 검증: 숫자+초(s) 또는 분(m), 1초~60분 */
  const validateCustomDuration = (value: string): { valid: boolean; error?: string } => {
    const v = value.trim().toLowerCase();
    if (!v) return { valid: false, error: '값을 입력해 주세요.' };
    if (!/^\d+[sm]$/.test(v)) return { valid: false, error: '형식: 숫자+초(s) 또는 분(m), 예: 90s, 2m' };
    const num = parseInt(v, 10);
    if (v.endsWith('s')) {
      if (num < 1 || num > 3600) return { valid: false, error: '초(s)는 1~3600 사이로 입력해 주세요.' };
    } else {
      if (num < 1 || num > 60) return { valid: false, error: '분(m)은 1~60 사이로 입력해 주세요.' };
    }
    return { valid: true };
  };

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
      const styleForApi = scriptStyle === 'custom' ? (customScriptStyleText.trim() || '사용자 지정 스타일') : (archetypes.find(a => a.id === scriptStyle)?.name ?? scriptStyle);
      const res = await generatePlanningStep(name, { topic: selectedTopic, style: styleForApi, length: scriptLength, planningData });
      setPlanningData(p => ({ ...p, [key]: res.result }));
    } finally {
      setLoadingStepKey(null);
    }
  };

  const runAllStepsAI = async () => {
    setIsGeneratingAll(true);
    try {
      for (let i = 0; i < steps.length; i++) {
        const { id, key, name } = steps[i];
        setActiveSubStep(id);
        setLoadingStepKey(key);
        const styleForApi = scriptStyle === 'custom' ? (customScriptStyleText.trim() || '사용자 지정 스타일') : (archetypes.find(a => a.id === scriptStyle)?.name ?? scriptStyle);
        const res = await generatePlanningStep(name, { topic: selectedTopic, style: styleForApi, length: scriptLength, planningData });
        setPlanningData(p => ({ ...p, [key]: res.result }));
        setLoadingStepKey(null);
        await new Promise(r => setTimeout(r, 1200));
      }
    } finally {
      setLoadingStepKey(null);
      setIsGeneratingAll(false);
    }
  };

  const handleSynthesizeScript = async () => {
    setSynthesizeProgress('통합 시나리오 생성 중...');
    try {
      const styleName = scriptStyle === 'custom'
        ? (customScriptStyleText.trim() || '사용자 지정 스타일')
        : (archetypes.find(a=>a.id===scriptStyle)?.name || 'Standard');
      const res = await synthesizeMasterScript({ 
        topic: selectedTopic, 
        planningData, 
        style: styleName
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
                <div className="grid grid-cols-1 gap-4">
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
        kicker="Step 3 / 구조"
        title="시나리오 구조 설계"
        subtitle="전개 구조와 문체를 정리하고, 핵심 메시지를 설계합니다."
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <span className="ui-label">스타일 선택</span>
            <div className="space-y-2">
              {archetypes.filter(a => a.id !== 'custom').map(a => (
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
              <button
                onClick={() => setScriptStyle('custom')}
                className={`style-choice w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${scriptStyle === 'custom' ? 'is-selected' : ''}`}
              >
                <div className="mt-0.5 style-choice__icon"><PenTool size={18} /></div>
                <div className="text-left">
                  <div className="style-choice__title">사용자 지정 스타일</div>
                  <div className="style-choice__desc">고유의 개성을 담은 커스텀 디자인 문체</div>
                </div>
              </button>
            </div>
            {scriptStyle === 'custom' && (
              <div className="pt-1 space-y-1">
                <input
                  type="text"
                  value={customScriptStyleText}
                  onChange={e => setCustomScriptStyleText(e.target.value)}
                  placeholder="예: 감성적인 1인칭 시점의 일상 브이로그 톤"
                  className="ui-input w-full"
                  aria-label="사용자 지정 스타일 입력"
                />
              </div>
            )}
          </div>

          <div className="ui-card space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="ui-label">목표 길이</span>
              <span className="group/tip relative inline-flex">
                <Info size={14} className="text-muted-foreground shrink-0 cursor-help" aria-hidden />
                <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 z-10 ml-2 w-56 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/tip:opacity-100 whitespace-normal">
                  대본·영상의 목표 재생 시간입니다. 선택한 길이에 맞춰 AI가 분량을 조절합니다. 다만 영상의 길이가 모델에 따라 조금 다를 수 있습니다.
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {durations.filter(d => d.id !== 'custom').map(d => (
                  <button
                    key={d.id}
                    onClick={() => setPlanningData(p => ({ ...p, targetDuration: d.id }))}
                    className={`duration-pill ui-btn ${planningData.targetDuration === d.id ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                  >
                    {d.icon} {d.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPlanningData(p => ({ ...p, targetDuration: '' }))}
                  className={`duration-pill ui-btn ${!planningData.targetDuration || !durations.some(x => x.id !== 'custom' && x.id === planningData.targetDuration) ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                >
                  <PenTool size={14} /> 직접 입력
                </button>
              </div>
            </div>
            {(() => {
              const presetIds = durations.filter(d => d.id !== 'custom').map(d => d.id);
              const isCustom = !planningData.targetDuration || !presetIds.includes(planningData.targetDuration);
              if (!isCustom) return null;
              const customValue = planningData.targetDuration;
              const { valid, error } = validateCustomDuration(customValue);
              const showError = customValue !== '' && !valid;
              const handleCustomDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                const v = e.target.value.toLowerCase().trim();
                if (v === '' || /^\d+[sm]?$/.test(v)) setPlanningData(p => ({ ...p, targetDuration: v }));
              };
              return (
                <div className="pt-1 space-y-1">
                  <input
                    type="text"
                    value={planningData.targetDuration}
                    onChange={handleCustomDurationChange}
                    placeholder="예: 2m, 90s"
                    className={`ui-input w-full max-w-[200px] ${showError ? 'border-red-500 focus:ring-red-500/30' : ''}`}
                    aria-label="목표 길이 직접 입력"
                    aria-invalid={showError}
                    aria-describedby={showError ? 'target-duration-error' : undefined}
                  />
                  {showError && (
                    <p id="target-duration-error" className="text-xs text-red-600" role="alert">
                      {error}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card">
            <div className="flex flex-wrap gap-2">
              {steps.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSubStep(s.id)}
                  className={`substep-pill ui-btn ${activeSubStep === s.id ? 'ui-btn--primary is-selected' : 'ui-btn--secondary'}`}
                >
                  {s.id}. {s.name.replace(/^\d+\)\s/, '')}
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card space-y-6 min-h-[520px]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <span className="ui-label">현재 파트</span>
                <h3 className="font-serif text-2xl text-foreground">
                  {steps[activeSubStep - 1].name.replace(/^\d+\)\s/, '')}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runStepAI(steps[activeSubStep - 1].key, steps[activeSubStep - 1].name)}
                  disabled={!!loadingStepKey || isGeneratingAll}
                  className="ui-btn ui-btn--secondary"
                >
                  {loadingStepKey === steps[activeSubStep - 1].key ? <><Loader2 size={16} className="animate-spin" /> AI 초안 생성 중...</> : <><Sparkles size={16} /> AI 초안</>}
                </button>
                <button
                  onClick={runAllStepsAI}
                  disabled={!!loadingStepKey || isGeneratingAll}
                  className="ui-btn ui-btn--primary"
                >
                  {isGeneratingAll ? (
                    <><Loader2 size={16} className="animate-spin" /> 전체 생성 중 {loadingStepKey ? `(${steps.findIndex(s => s.key === loadingStepKey) + 1}/${steps.length})` : ''}...</>
                  ) : (
                    <><Zap size={16} /> 전체 생성</>
                  )}
                </button>
              </div>
            </div>

            <div className="ui-card--muted text-sm text-slate-700">
              {stepGuides[steps[activeSubStep - 1].key]}
            </div>

            <AutoResizeTextarea
              value={planningData[steps[activeSubStep - 1].key as keyof StudioScriptPlanningData]}
              onChange={v => setPlanningData(p => ({ ...p, [steps[activeSubStep - 1].key]: v }))}
              className="min-h-[240px] text-lg font-semibold"
              placeholder="아이디어를 상세히 기술하세요..."
            />

            <div className="flex items-center justify-between">
              <button onClick={() => setActiveSubStep(p => Math.max(1, p - 1))} className="ui-btn ui-btn--ghost">
                <ChevronLeft size={16} /> 이전
              </button>
              {activeSubStep < 6 ? (
                <button onClick={() => setActiveSubStep(p => p + 1)} className="ui-btn ui-btn--primary">
                  다음 파트 <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={() => {
                    setReviewMode('architecture');
                    setIsPreviewOpen(true);
                  }}
                  className="ui-btn ui-btn--primary"
                >
                  구성 점검 <CheckSquare size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 4: 이미지 및 대본 생성] ---
const ImageAndScriptStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    masterScript, scenes, setScenes, selectedStyle, setSelectedStyle, videoFormat,
    referenceImage, setReferenceImage, analyzedStylePrompt, setAnalyzedStylePrompt,
    setCurrentStep
  } = useGlobal();

  const [isImgDragging, setIsImgDragging] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [isRefAnalyzing, setIsRefAnalyzing] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [enhancingPromptIndex, setEnhancingPromptIndex] = useState<number | null>(null);
  const [expandedSceneImageUrl, setExpandedSceneImageUrl] = useState<string | null>(null);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneImageInputRef = useRef<HTMLInputElement>(null);
  const sceneImageUploadTargetRef = useRef<number | null>(null);

  const handleSceneImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const idx = sceneImageUploadTargetRef.current;
    if (!file || idx == null) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setScenes(prev => prev.map((s, i) => i === idx ? { ...s, imageUrl: dataUrl } : s));
    };
    reader.readAsDataURL(file);
    sceneImageUploadTargetRef.current = null;
    e.target.value = '';
  };

  const handleDownloadExpandedImage = async () => {
    if (!expandedSceneImageUrl) return;
    setIsDownloadingImage(true);
    try {
      const res = await fetch(expandedSceneImageUrl, { mode: 'cors' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scene-image-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('이미지가 다운로드되었습니다.');
    } catch {
      window.open(expandedSceneImageUrl, '_blank');
      showToast('다운로드 대신 새 탭에서 열었습니다.');
    } finally {
      setIsDownloadingImage(false);
    }
  };

  const handleEnhancePromptForScene = async (idx: number) => {
    const scene = scenes[idx];
    if (!scene?.narrative?.trim()) {
      showToast('대본을 먼저 입력해 주세요.');
      return;
    }
    setEnhancingPromptIndex(idx);
    try {
      const styleObj = styleLab.find(s => s.id === selectedStyle);
      const prompt = await generateScenePrompt(scene.narrative, styleObj?.desc || '', analyzedStylePrompt);
      const next = [...scenes];
      next[idx].aiPrompt = prompt;
      setScenes(next);
      showToast('프롬프트가 향상되었습니다.');
    } catch {
      showToast('프롬프트 향상에 실패했습니다.');
    } finally {
      setEnhancingPromptIndex(null);
    }
  };

  const handleSceneDragStart = (e: React.DragEvent, idx: number) => {
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndex(idx);
  };

  const handleSceneDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(idx);
  };

  const handleSceneDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleSceneDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);
    setDraggedIndex(null);
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (Number.isNaN(dragIndex) || dragIndex === dropIndex) return;
    const newScenes = [...scenes];
    const [removed] = newScenes.splice(dragIndex, 1);
    newScenes.splice(dropIndex, 0, removed);
    setScenes(newScenes);
  };

  const handleSceneDragEnd = () => {
    setDragOverIndex(null);
    setDraggedIndex(null);
  };

  useEffect(() => {
    if (selectedStyle !== 'Custom') {
      setReferenceImage('');
      setAnalyzedStylePrompt('');
    }
  }, [selectedStyle, setReferenceImage, setAnalyzedStylePrompt]);

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

  const handleStudioSceneSplitting = async () => {
    if (!masterScript) return showToast("시나리오 데이터가 없습니다. 3단계에서 시나리오를 먼저 생성하세요.");
    setIsSplitting(true);
    try {
      const splitRes = await splitScriptIntoScenes(masterScript);
      const mapped = splitRes.map((s: any, i: number) => ({
        id: Date.now() + i,
        narrative: s.script_segment,
        aiPrompt: s.scene_description,
        imageUrl: '',
        duration: 5,
        cameraWork: 'Static',
        isPromptVisible: true,
        isSyncing: false,
        isGenerating: false,
        isManualAdd: false
      }));

      const styleObj = styleLab.find(s => s.id === selectedStyle);
      for (let i = 0; i < mapped.length; i++) {
        const prompt = await generateScenePrompt(mapped[i].narrative, styleObj?.desc || '', analyzedStylePrompt);
        mapped[i].aiPrompt = prompt;
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
        const styleText = await analyzeReferenceImage(base64);
        setAnalyzedStylePrompt(styleText);
        showToast("레퍼런스 이미지 스타일 분석 완료.");
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
      imageUrl: '',
      duration: 5,
      cameraWork: 'Static',
      isPromptVisible: true,
      isSyncing: false,
      isGenerating: false,
      isManualAdd: true
    };
    setScenes([...scenes, newScene]);
    showToast("새 장면이 추가되었습니다.");
  };

  const handleGenImage = async (idx: number) => {
    const scene = scenes[idx];
    const styleObj = styleLab.find(s => s.id === selectedStyle);
    setScenes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], isGenerating: true };
      return next;
    });
    try {
      const url = await generateSceneImage(scene.aiPrompt, selectedStyle, videoFormat as '9:16' | '16:9', styleObj?.model);
      setScenes(prev => {
        const next = prev.map((s, i) => i === idx ? { ...s, imageUrl: url, isGenerating: false } : s);
        return next;
      });
      showToast(`${idx+1}번 장면 비주얼 생성 완료.`);
    } catch (e) {
      setScenes(prev => prev.map((s, i) => i === idx ? { ...s, isGenerating: false } : s));
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
        const sceneIndex = toGenerate[i];
        setGenerateAllProgress(`(${i + 1}/${toGenerate.length})`);
        await handleGenImage(sceneIndex);
        setTimeout(() => {
          document.getElementById(`scene-card-${sceneIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } finally {
      setIsGeneratingAll(false);
      setGenerateAllProgress(null);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      {expandedSceneImageUrl && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedSceneImageUrl(null)}
          role="presentation"
        >
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDownloadExpandedImage(); }}
              disabled={isDownloadingImage}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors disabled:opacity-60"
              aria-label="다운로드"
              title="다운로드"
            >
              {isDownloadingImage ? <Loader2 size={22} className="animate-spin" /> : <Download size={22} />}
            </button>
            <button
              type="button"
              onClick={() => setExpandedSceneImageUrl(null)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              aria-label="닫기"
            >
              <X size={24} />
            </button>
          </div>
          <img
            src={expandedSceneImageUrl}
            alt="확대 보기"
            className="max-w-[90vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <SectionHeader
        kicker="Step 4 / 비주얼"
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

          {selectedStyle === 'Custom' && (
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
                  {analyzedStylePrompt}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="ui-label">스튜디오장면 클립</span>
              <span className="text-xs font-medium text-slate-500 tabular-nums">전체 대본 {masterScript.length.toLocaleString()}자 (공백 포함)</span>
            </div>
            <button onClick={addManualStudioScene} className="ui-btn ui-btn--secondary">
              <Plus size={14} /> 씬 추가
            </button>
          </div>

          {scenes.length > 0 ? (
            <>
            <div className="space-y-4">
            {scenes.map((scene, idx) => (
              <div
                id={`scene-card-${idx}`}
                key={scene.id}
                draggable
                onDragStart={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('button') || target.closest('textarea') || target.closest('input')) return;
                  handleSceneDragStart(e, idx);
                }}
                onDragEnd={handleSceneDragEnd}
                onDragOver={(e) => handleSceneDragOver(e, idx)}
                onDragLeave={handleSceneDragLeave}
                onDrop={(e) => handleSceneDrop(e, idx)}
                className={`ui-card space-y-4 cursor-grab active:cursor-grabbing transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg
                  ${draggedIndex === idx ? 'opacity-60 scale-[0.98] shadow-lg rotate-[-0.5deg] z-10' : ''}
                  ${dragOverIndex === idx && draggedIndex !== idx ? 'ring-2 ring-rose-400 ring-offset-2 scale-[1.01] bg-rose-50/50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical size={18} className="text-slate-400 shrink-0" />
                    <span className="ui-label">클립 {String(idx + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setScenes(scenes.filter(s => s.id !== scene.id)); }} className="ui-btn ui-btn--ghost">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="ui-label">대본</span>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {(scene.narrative || '').length.toLocaleString()}자 (공백 포함)
                        </span>
                      </div>
                      <AutoResizeTextarea
                        value={scene.narrative}
                        onChange={v => { const n = [...scenes]; n[idx].narrative = v; setScenes(n); }}
                        placeholder="대본 조각을 입력하세요..."
                        className="min-h-[120px] text-base font-semibold"
                      />
                    </div>
                    <div className="space-y-2 relative">
                      <span className="ui-label">프롬프트</span>
                      <div className="relative">
                        <AutoResizeTextarea
                          value={scene.aiPrompt}
                          onChange={v => { const n = [...scenes]; n[idx].aiPrompt = v; setScenes(n); }}
                          placeholder="장면 연출 설명을 입력하세요..."
                          className={`min-h-[140px] text-sm ${scene.isManualAdd ? 'pr-28' : ''}`}
                        />
                        {scene.isManualAdd && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleEnhancePromptForScene(idx); }}
                            disabled={enhancingPromptIndex === idx}
                            className="absolute right-2 bottom-2 rounded-lg bg-rose-100 hover:bg-rose-300 hover:text-rose-900 text-rose-700 flex items-center gap-1.5 px-2.5 py-1.5 shadow-sm transition-colors duration-150 disabled:opacity-60 text-xs font-medium"
                            title="프롬프트 향상"
                          >
                            {enhancingPromptIndex === idx ? (
                              <Loader2 size={14} className="animate-spin shrink-0" />
                            ) : (
                              <Sparkles size={14} className="shrink-0" />
                            )}
                            <span>프롬프트 향상</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div
                      className={`aspect-video rounded-2xl border border-dashed border-border/70 bg-secondary/45 flex items-center justify-center overflow-hidden relative ${scene.imageUrl ? 'cursor-pointer hover:ring-2 hover:ring-primary/50 hover:ring-offset-1 transition-shadow' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (scene.imageUrl) setExpandedSceneImageUrl(scene.imageUrl);
                      }}
                      role={scene.imageUrl ? 'button' : undefined}
                      aria-label={scene.imageUrl ? '이미지 확대 보기' : undefined}
                    >
                      {scene.isGenerating && (
                        <div className="absolute inset-0 bg-card/80 backdrop-blur-sm flex items-center justify-center">
                          <Loader2 size={20} className="animate-spin text-primary" />
                        </div>
                      )}
                      {scene.imageUrl ? (
                        <img src={scene.imageUrl} alt={`StudioScene ${idx + 1}`} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <div className="text-center text-slate-500 text-sm">미리보기 없음</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <button onClick={() => handleGenImage(idx)} disabled={scene.isGenerating} className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2 min-w-0">
                        {scene.isGenerating ? (
                          <><Loader2 size={12} className="animate-spin shrink-0" /> 생성 중...</>
                        ) : (
                          <>
                            <Wand2 size={14} className="shrink-0" />
                            <span className="min-w-0 truncate" title={styleLab.find(s => s.id === selectedStyle)?.name + ' 생성'}>
                              {selectedStyle === 'Custom' ? 'Custom' : selectedStyle === '3D' ? '3D 렌더링' : styleLab.find(s => s.id === selectedStyle)?.name} 생성
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { sceneImageUploadTargetRef.current = idx; sceneImageInputRef.current?.click(); }}
                        className="ui-btn ui-btn--secondary w-full flex items-center justify-center gap-2"
                      >
                        <ImagePlus size={14} /> 사진 업로드
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            </div>
            <button
              type="button"
              onClick={() => setCurrentStep(5)}
              className="ui-btn ui-btn--primary w-full mt-6 flex items-center justify-center gap-2"
            >
              음성 생성 <ChevronRight size={18} />
            </button>
            </>
          ) : (
            <div className="ui-card--ghost ui-card--airy text-center text-slate-500">
              대본 분할 또는 씬 추가로 시작하세요.
            </div>
          )}
          <input
            type="file"
            ref={sceneImageInputRef}
            accept="image/*"
            className="hidden"
            onChange={handleSceneImageUpload}
          />
        </div>
      </div>
    </div>
  );
};

// --- [Step 5: 보이스 프리셋 (MiniMax voice_id)] ---
const VOICE_PRESETS = [
  { id: 'ko-female-1', voiceId: 'Wise_Woman', name: '한국어 여성 (밝은 톤)', sample: '안녕하세요. 오늘 영상도 재미있게 봐 주세요.', sampleAudioUrl: '/voice-samples/ko-female-1.mp3' },
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

const MOCK_VIDEO_TIMELINE = [
  { id: 'v1', label: '씬 1', duration: 4.2, thumb: null },
  { id: 'v2', label: '씬 2', duration: 3.8, thumb: null },
  { id: 'v3', label: '씬 3', duration: 4.1, thumb: null },
  { id: 'v4', label: '씬 4', duration: 3.5, thumb: null },
];

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

/** 대본에서 내레이션만 추출 (음악/화면 지시문 제거). TTS 합성용 */
function extractNarrationOnly(raw: string): string {
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
    .replace(/\n\s*\n/g, '\n')
    .trim();

  return text || raw.trim();
}

// --- [Step 5: AI 음성 생성] ---
const VoiceStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const context = useContext(GlobalContext);
  const scenes = context?.scenes ?? [];
  const setScenes = context?.setScenes;
  const setSceneDurations = context?.setSceneDurations;
  const setCurrentStep = context?.setCurrentStep;
  const [selectedVoiceId, setSelectedVoiceId] = useState(VOICE_PRESETS[0].id);
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesizingSegmentIndex, setSynthesizingSegmentIndex] = useState<number | null>(null);
  const [samplePlaying, setSamplePlaying] = useState(false);

  const selectedVoice = VOICE_PRESETS.find(v => v.id === selectedVoiceId);

  useEffect(() => {
    if (scenes.length > 0)
      setSegments(scenes.map((s, i) => ({
        id: s.id,
        sceneIndex: i + 1,
        text: s.narrative || '(대사 없음)',
        durationSec: s.durationSec ?? 0,
        status: s.audioUrl ? ('done' as const) : ('pending' as const),
        audioUrl: s.audioUrl,
      })));
    else
      setSegments([]);
  }, [scenes]);

  const handleSynthesizeAll = async () => {
    const voiceId = selectedVoice?.voiceId ?? 'Wise_Woman';
    setIsSynthesizing(true);
    try {
      // 결과를 배열에 모은 뒤 한 번에 setScenes/setSegments 호출 → Step 6에 durationSec이 모두 전달됨
      const results: Array<{ url: string; durationSec: number } | null> = new Array(segments.length).fill(null);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const raw = (seg.text || '').trim().replace(/^\(대사 없음\)$/, '');
        const text = extractNarrationOnly(raw);
        if (!text) continue;
        try {
          const { url, duration_ms } = await studioTts({ text, voice_id: voiceId });
          results[i] = { url, durationSec: duration_ms / 1000 };
        } catch {
          // 실패한 항목은 null 유지
        }
        setTimeout(() => document.getElementById(`scene-card-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }
      setSegments(prev => prev.map((p, j) => {
        const r = results[j];
        if (r) return { ...p, status: 'done' as const, audioUrl: r.url, durationSec: r.durationSec };
        if ((p.text || '').trim().replace(/^\(대사 없음\)$/, '') === '') return { ...p, status: 'done' as const };
        return p;
      }));
      setScenes?.(prev => prev.map((s, j) => {
        const r = results[j];
        if (r) return { ...s, audioUrl: r.url, durationSec: r.durationSec };
        return s;
      }));
      // Step 6에서 씬별 재생 길이를 확실히 쓰도록 별도 배열에 저장
      setSceneDurations?.(results.map(r => (r ? r.durationSec : 5)));
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleSynthesizeOne = async (idx: number) => {
    const seg = segments[idx];
    const raw = (seg?.text || '').trim().replace(/^\(대사 없음\)$/, '');
    const text = extractNarrationOnly(raw);
    if (!text) return;
    const voiceId = selectedVoice?.voiceId ?? 'Wise_Woman';
    setSynthesizingSegmentIndex(idx);
    try {
      const { url, duration_ms } = await studioTts({ text, voice_id: voiceId });
      const durationSec = duration_ms / 1000;
      setSegments(prev => prev.map((p, j) =>
        j === idx ? { ...p, status: 'done' as const, audioUrl: url, durationSec } : p
      ));
      setScenes?.(prev => prev.map((s, j) => j === idx ? { ...s, audioUrl: url, durationSec } : s));
      setSceneDurations?.(prev => {
        const next = prev.length >= segments.length ? [...prev] : [...prev, ...Array(segments.length - prev.length).fill(5)];
        next[idx] = durationSec;
        return next;
      });
    } catch {
      setSegments(prev => prev.map((p, j) => j === idx ? { ...p, status: 'pending' as const } : p));
    } finally {
      setSynthesizingSegmentIndex(null);
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
      const url = 'sampleAudioUrl' in selectedVoice && selectedVoice.sampleAudioUrl
        ? selectedVoice.sampleAudioUrl
        : (await studioTts({ text: selectedVoice.sample, voice_id: selectedVoice.voiceId })).url;
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
        kicker="Step 5 / 음성"
        title="AI 음성 생성"
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
                  onClick={() => setSelectedVoiceId(v.id)}
                  className={`style-choice w-full flex items-start gap-3 px-4 py-3 rounded-xl border transition-colors ${selectedVoiceId === v.id ? 'is-selected' : ''}`}
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
          <div className="ui-card flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-col gap-1">
              <span className="ui-label">장면별 음성 세그먼트</span>
              {segments.length > 0 && (
                <span className="text-xs font-medium text-slate-500 tabular-nums">
                  전체 음성 시간{' '}
                  {(() => {
                    const totalSec = segments.reduce((a, s) => a + (s.durationSec ?? 0), 0);
                    return totalSec >= 60
                      ? `${Math.floor(totalSec / 60)}:${Math.floor(totalSec % 60).toString().padStart(2, '0')}`
                      : `${totalSec.toFixed(1)}초`;
                  })()}
                </span>
              )}
            </div>
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
              segments.map((seg, idx) => {
                const hasText = (seg.text || '').trim().replace(/^\(대사 없음\)$/, '').length > 0;
                const isThisSynthesizing = synthesizingSegmentIndex === idx;
                return (
                  <div key={seg.id} className="ui-card flex items-center gap-4 flex-wrap">
                    <span className="ui-step__num is-selected">{(idx + 1).toString().padStart(2, '0')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{seg.text}</p>
                      <p className="text-xs text-slate-500">{seg.durationSec > 0 ? `${seg.durationSec.toFixed(1)}초` : '—'} · 씬 {seg.sceneIndex}</p>
                    </div>
                    <span className="ui-pill">{seg.status === 'done' ? '완료' : '대기'}</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="ui-btn ui-btn--secondary"
                        disabled={!hasText || isThisSynthesizing || isSynthesizing}
                        onClick={() => handleSynthesizeOne(idx)}
                      >
                        {isThisSynthesizing ? <Loader2 size={14} className="animate-spin" /> : <Music4 size={14} />}
                        생성
                      </button>
                      <button
                        className={`ui-btn ui-btn--ghost ${seg.status !== 'done' || !seg.audioUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={seg.status !== 'done' || !seg.audioUrl}
                        onClick={() => seg.audioUrl && playUrl(seg.audioUrl)}
                        title={seg.status !== 'done' ? '음성 생성 완료 후 재생할 수 있습니다.' : undefined}
                      >
                        <PlayCircle size={14} /> 재생
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {setCurrentStep && (
            <button type="button" onClick={() => setCurrentStep(6)} className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2">
              영상 생성 <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/** 초 단위를 "M:SS" 또는 "0:00" 형식으로 표시 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- [Step 6: AI 영상 생성] ---
const VideoStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const context = useContext(GlobalContext);
  const scenes = context?.scenes ?? [];
  const sceneDurations = context?.sceneDurations ?? [];
  const videoFormat = context?.videoFormat ?? '9:16';
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [hoveredClipIndex, setHoveredClipIndex] = useState<number | null>(null);

  const timeline = useMemo(() => {
    let start = 0;
    return scenes.map((s, i) => {
      // Step 5에서 저장한 sceneDurations 우선 사용, 0/미설정이면 최소 1초
      const raw = (sceneDurations[i] != null && sceneDurations[i] > 0) ? sceneDurations[i] : ((s.durationSec != null && s.durationSec > 0) ? s.durationSec : (s.duration ?? 5));
      const duration = Math.max(1, raw);
      const item = {
        id: String(s.id),
        label: `씬 ${i + 1}`,
        duration,
        startTime: start,
        thumb: s.imageUrl || null,
        audioUrl: s.audioUrl,
        imageUrl: s.imageUrl,
      };
      start += duration;
      return item;
    });
  }, [scenes, sceneDurations]);
  const totalDuration = timeline.reduce((acc, t) => acc + t.duration, 0);

  const handleExport = async () => {
    const hasAll = timeline.every(t => t.thumb && t.audioUrl);
    if (!hasAll || timeline.length === 0) {
      showToast('모든 씬에 이미지와 음성이 있어야 영상을 생성할 수 있습니다.');
      return;
    }
    setExportError(null);
    setVideoUrl(null);
    setIsExporting(true);
    try {
      const result = await studioExportVideo({
        clips: timeline.map(t => ({
          image_url: t.imageUrl!,
          audio_url: t.audioUrl!,
          duration_sec: t.duration,
        })),
        aspect_ratio: videoFormat === '16:9' ? '16:9' : '9:16',
      });
      if (result.video_url) {
        setVideoUrl(result.video_url);
        showToast('영상 생성이 완료되었습니다.');
      } else {
        showToast('영상 URL을 받지 못했습니다.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '영상 생성에 실패했습니다.';
      setExportError(msg);
      showToast(msg);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (!videoUrl) return;
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
      showToast('다운로드에 실패했습니다.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 6 / 영상"
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
                <span className="font-medium">{videoFormat === '16:9' ? '16:9' : '9:16 (Shorts)'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">총 길이</span>
                <span className="font-medium">{formatTime(totalDuration)} ({totalDuration.toFixed(1)}초)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">클립 수</span>
                <span className="font-medium">{timeline.length}개</span>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={isExporting || timeline.length === 0}
              className="ui-btn ui-btn--primary w-full"
            >
              {isExporting ? (
                <><Loader2 size={14} className="animate-spin" /> 렌더링 중...</>
              ) : (
                <><Video size={14} /> 영상 생성</>
              )}
            </button>
            {exportError && <p className="text-xs text-red-600">{exportError}</p>}
            {videoUrl && (
              <div className="flex flex-col gap-3 pt-2 border-t border-slate-200">
                <span className="ui-label">생성된 영상</span>
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-black aspect-video max-h-[320px]">
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className="w-full h-full object-contain"
                    preload="metadata"
                  >
                    이 브라우저는 비디오 재생을 지원하지 않습니다.
                  </video>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={handleDownloadVideo}
                    disabled={isDownloading}
                    className="ui-btn ui-btn--secondary w-full text-sm"
                  >
                    {isDownloading ? <><Loader2 size={14} className="animate-spin" /> 다운로드 중...</> : <><Download size={14} /> 다운로드</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="ui-card">
            <div className="flex items-center justify-between gap-4 mb-4">
              <span className="ui-label">타임라인</span>
              {timeline.length > 0 && (
                <span className="text-xs font-medium text-slate-500 tabular-nums">
                  총 {formatTime(totalDuration)}
                </span>
              )}
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-500">Step 4에서 장면을 만들고 Step 5에서 음성을 합성한 뒤 여기로 오세요.</p>
            ) : (
              <div className="flex gap-6">
                {/* 왼쪽: 얇은 세로 비율 막대, 씬별로 갭으로 구분 */}
                <div
                  className="flex flex-col gap-1 flex-shrink-0 rounded-lg p-1 border border-border/70 bg-secondary/55"
                  style={{ minHeight: '12rem', width: '0.875rem' }}
                  title={`전체 ${formatTime(totalDuration)}`}
                >
                  {timeline.map((clip, idx) => (
                    <div
                      key={clip.id}
                      className={`w-full rounded-md flex-shrink-0 transition-all duration-200 ${hoveredClipIndex === idx ? 'ring-2 ring-primary ring-offset-1 ring-offset-background opacity-100 scale-105' : 'hover:opacity-90'}`}
                      style={{
                        flex: totalDuration > 0 ? clip.duration / totalDuration : 0,
                        minHeight: 10,
                        backgroundColor: clip.thumb && clip.audioUrl ? 'hsl(222, 47%, 11%)' : 'hsl(215, 16%, 47%)',
                      }}
                      title={`${clip.label} ${clip.duration.toFixed(1)}초`}
                    />
                  ))}
                </div>
                {/* 오른쪽: 클립 카드 목록 */}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                  {timeline.map((clip, idx) => (
                    <div
                      key={clip.id}
                      onMouseEnter={() => setHoveredClipIndex(idx)}
                      onMouseLeave={() => setHoveredClipIndex(null)}
                      className="flex gap-5 rounded-2xl border border-border/70 bg-card p-4 hover:border-border hover:shadow-sm transition-all"
                    >
                      <div className="w-36 flex-shrink-0 aspect-video rounded-xl overflow-hidden bg-secondary/55">
                        {clip.thumb ? (
                          <img src={clip.thumb} alt={clip.label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film size={28} className="text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-base font-semibold text-foreground">{clip.label}</span>
                          <span className="text-sm font-semibold text-muted-foreground tabular-nums">{clip.duration.toFixed(1)}초</span>
                        </div>
                        <p className="text-sm text-muted-foreground tabular-nums">
                          <span className="font-medium">{formatTime(clip.startTime)}</span>
                          <span className="text-muted-foreground/70 mx-1.5">→</span>
                          <span className="font-medium">{formatTime(clip.startTime + clip.duration)}</span>
                        </p>
                        {(!clip.thumb || !clip.audioUrl) && (
                          <span className="text-xs font-medium text-amber-600">이미지 또는 음성 없음</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-border/70 bg-secondary/45 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
            위 타임라인은 각 씬의 시작·종료 시간과 비율을 보여줍니다. 영상 생성 버튼을 누르면 서버에서 이미지와 음성을 합쳐 최종 영상으로 렌더링합니다.
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 7: 최적화 메타 설정 — AI 자동 생성] ---
const MetaStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { selectedTopic, planningData } = useGlobal();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pinnedComment, setPinnedComment] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedOnce, setGeneratedOnce] = useState(false);

  const handleGenerateAll = async () => {
    setIsGenerating(true);
    try {
      const meta = await generateMetaData({
        topic: selectedTopic,
        summary: planningData?.summary,
        targetDuration: planningData?.targetDuration,
      });
      setTitle(meta.title);
      setDescription(meta.description);
      setPinnedComment(meta.pinnedComment);
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
        topic: selectedTopic,
        summary: planningData?.summary,
        targetDuration: planningData?.targetDuration,
      });
      if (field === 'title') setTitle(meta.title);
      if (field === 'description') setDescription(meta.description);
      if (field === 'pinnedComment') setPinnedComment(meta.pinnedComment);
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
        kicker="Step 7 / 메타데이터"
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
            value={title}
            onChange={e => setTitle(e.target.value)}
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
            value={description}
            onChange={e => setDescription(e.target.value)}
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
            value={pinnedComment}
            onChange={e => setPinnedComment(e.target.value)}
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
  const [thumbnails, setThumbnails] = useState<ThumbnailCandidate[]>(MOCK_THUMBNAILS);
  const [ytUrlInput, setYtUrlInput] = useState('');
  const [ytThumbnailUrl, setYtThumbnailUrl] = useState<string | null>(null);
  const [ytThumbnailError, setYtThumbnailError] = useState(false);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkSummary, setBenchmarkSummary] = useState<string | null>(null);

  const loadYtThumbnail = () => {
    const id = getYoutubeVideoId(ytUrlInput);
    if (!id) {
      setYtThumbnailUrl(null);
      setYtThumbnailError(true);
      showToast('유효한 유튜브 URL을 입력해주세요.');
      return;
    }
    setYtThumbnailError(false);
    setYtThumbnailUrl(getYoutubeThumbnailUrl(id));
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
      setThumbnails(prev => [...prev, newThumb]);
      showToast('벤치마킹 썸네일이 생성되었습니다.');
    } catch (e) {
      showToast('벤치마킹 생성에 실패했습니다.');
    } finally {
      setIsBenchmarking(false);
    }
  };

  const selectThumb = (id: string) => {
    setThumbnails(prev => prev.map(t => ({ ...t, isSelected: t.id === id })));
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 8 / 썸네일"
        title="썸네일 연구소"
        subtitle="유튜브 URL로 썸네일을 불러온 뒤 벤치마킹하면, 같은 톤의 썸네일을 AI가 생성합니다."
      />

      <div className="ui-card space-y-4">
        <span className="ui-label">유튜브 썸네일 불러오기</span>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={ytUrlInput}
            onChange={e => { setYtUrlInput(e.target.value); setYtThumbnailError(false); }}
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
                onError={() => { setYtThumbnailUrl(null); setYtThumbnailError(true); }}
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
        <span className="ui-label">썸네일 후보</span>
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
  const { currentStep, setCurrentStep, isLoading, loadingMessage, setDescriptionInput, setIsFileLoaded, isDevMode, setIsDevMode } = useGlobal();
  const [toast, setToast] = useState<string | null>(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);

  const showToast = useCallback((msg: string) => { 
    setToast(msg); 
    setTimeout(() => setToast(null), 3500); 
  }, []);

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

  const stepTitles = [
    '1. 기획 및 전략 분석',
    '2. 영상 주제 선정',
    '3. 대본 구조 설계',
    '4. 이미지 및 대본 생성',
    '5. AI 음성 생성',
    '6. AI 영상 생성',
    '7. 최적화 메타 설정',
    '8. 썸네일 연구소'
  ];

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
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setIsGlobalDragging(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setIsGlobalDragging(true);
      }}
      onDragLeave={(e) => { if (e.relatedTarget === null) setIsGlobalDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setIsGlobalDragging(false);
        if (e.dataTransfer.files?.[0]) handleFileAction(e.dataTransfer.files[0]);
      }}
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
          {currentStep === 3 && <ScriptPlanningStep />}
          {currentStep === 4 && <ImageAndScriptStep showToast={showToast} />}
          {currentStep === 5 && <VoiceStep showToast={showToast} />}
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
