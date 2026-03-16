
import React, { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, useLayoutEffect } from 'react';
import JSZip from 'jszip';
import {
  X, History, Ghost, BookOpen, TrendingUp, Globe, MonitorPlay, ChevronRight, Flame, Loader2,
  CheckCircle2, PlayCircle, Layers, Trash2, Link as LinkIcon, Sparkles, Target,
  Download,
  Image as ImageIcon, Video, Wand2, Camera, Plus, Mic2, FileText, AlignLeft, Settings2,
	  Sliders, Music4, Activity, Smartphone, Monitor, PenTool, RefreshCcw, Utensils,
	  MessageCircle, Zap, Hash, Compass, Sword, Microscope, Palette, Map, Film, Heart, Gift,
	  Leaf, Smile, BarChart3, Box, ImagePlus, ScanLine, ArrowUp, ArrowDown, Info
	} from 'lucide-react';
	import {
	  StudioGlobalContextType,
	  StudioScene,
	  StudioScriptSegment,
	StudioAnalysisResult,
	StudioScriptPlanningData,
	type StudioTopicSuggestion,
	type StudioTopicGenerationBasis,
	type StudioVisualReferenceAsset,
	type StudioExportJobState,
	type StudioThumbnailBenchmarkJobState,
  type StudioThumbnailCandidate,
	  type StudioReferenceMode,
	  type StudioReferenceState,
	  type StudioReferenceView,
	} from '@/types/studio';
	import { 
	  analyzeUrlPattern, generateTopics, generatePlanningStep, 
	  rewritePlanningStep, generateMasterPlan, splitMasterPlanToSteps,
	  synthesizeMasterScript, splitScriptIntoScenes, generateSceneImage,
	  analyzeReferenceImage, generateScenePrompt, generateMetaData, translateToKorean, translateToEnglish
	} from '@/services/studio/geminiService';
import { studioTts, studioImage, uploadStudioReferenceImage, studioExport, studioExportJobStatus, studioExportJobCancel, studioThumbnailBenchmark, studioThumbnailBenchmarkJobStatus } from '@/services/studio/studioFalApi';
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

function normalizeThumbnailCandidates(raw: unknown): StudioThumbnailCandidate[] {
  if (!Array.isArray(raw)) return [];
  const normalized: Array<StudioThumbnailCandidate | null> = raw
    .map((item, index): StudioThumbnailCandidate | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : `thumb-${index + 1}`;
      const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : `썸네일 후보 ${index + 1}`;
      const imagePlaceholder = typeof obj.imagePlaceholder === 'string' && obj.imagePlaceholder.trim() ? obj.imagePlaceholder.trim() : undefined;
      const imageUrl = typeof obj.imageUrl === 'string' && obj.imageUrl.trim() ? obj.imageUrl.trim() : undefined;
      const ctrHint = typeof obj.ctrHint === 'string' && obj.ctrHint.trim() ? obj.ctrHint.trim() : '생성된 후보';
      const isSelected = obj.isSelected === true;
      if (!imageUrl && !imagePlaceholder) return null;
      return { id, title, imagePlaceholder, imageUrl, ctrHint, isSelected };
    });
  const filtered = normalized.filter((item): item is StudioThumbnailCandidate => item !== null);

  if (filtered.length === 0) return [];
  if (filtered.some((item) => item.isSelected)) return filtered;
  return filtered.map((item, index) => ({ ...item, isSelected: index === 0 }));
}

function buildSceneNarrativeSignature(scenes: StudioScene[]) {
  return scenes
    .map((scene) => `${scene.id}:${(scene.narrative || '').trim()}`)
    .join('||');
}

function buildSceneRenderSignature(scenes: StudioScene[]) {
  return scenes
    .map((scene) => [
      scene.id,
      (scene.narrative || '').trim(),
      (scene.imageUrl || '').trim(),
      (scene.audioUrl || '').trim(),
      scene.durationSec || scene.audioDurationSec || scene.duration || 0,
    ].join(':'))
    .join('||');
}

function getBenchmarkContentSummary(urlAnalysisData: any): string {
  return typeof urlAnalysisData?.content?.summary === 'string' ? urlAnalysisData.content.summary.trim() : '';
}

function getBenchmarkContentKeyPoints(urlAnalysisData: any): string[] {
  if (!Array.isArray(urlAnalysisData?.content?.keyPoints)) return [];
  return (urlAnalysisData.content.keyPoints as unknown[])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 10);
}

function parseBenchmarkPattern(pattern: string): { time: string | null; body: string } {
  const raw = (pattern || '').trim();
  if (!raw) return { time: null, body: '' };

  const leadingBracket = raw.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–—]?\s*(.+)$/);
  if (leadingBracket) {
    return {
      time: leadingBracket[1],
      body: leadingBracket[2].trim(),
    };
  }

  const trailingParen = raw.match(/^(.+?)\s*\((\d{1,2}:\d{2}(?::\d{2})?)\)\s*$/);
  if (trailingParen) {
    return {
      time: trailingParen[2],
      body: trailingParen[1].trim(),
    };
  }

  return { time: null, body: raw };
}

function buildBenchmarkSummaryForPrompt(urlAnalysisData: any): string {
  const contentSummary = getBenchmarkContentSummary(urlAnalysisData);
  const keyPoints = getBenchmarkContentKeyPoints(urlAnalysisData);
  const deliverySummary = typeof urlAnalysisData?.summary === 'string' ? urlAnalysisData.summary.trim() : '';
  const sections = [
    contentSummary ? `내용 요약: ${contentSummary}` : '',
    keyPoints.length ? `핵심 포인트: ${keyPoints.join(' | ')}` : '',
    deliverySummary ? `전개/패턴 요약: ${deliverySummary}` : '',
  ].filter(Boolean);
  return sections.join('\n');
}

const createDefaultPlanningData = (): StudioScriptPlanningData => ({
  contentType: '',
  summary: '',
  opening: '',
  body: '',
  climax: '',
  outro: '',
  targetDuration: '1m',
});

const createDefaultReferenceState = (): StudioReferenceState => ({
  mode: 'USE_EXISTING_REFERENCE',
  nickname: '',
  style_target: '',
  style_preset_id: 'realistic',
  style_option_ids: ['studio_clean', 'high_detail'],
  custom_style_keywords: [],
  age_group: '',
  gender: '',
  height_cm: null,
  must_keep: ['face', 'hair', 'colors'],
  may_change: [],
  palette: { primary: '', secondary: '', accent: '' },
  constraints: { must_not_have: ['text', 'watermark', 'logo', 'busy background', 'multiple characters'] },
  metadata: null,
});

const createDefaultThumbnailData = () => ({
  thumbnails: [] as any[],
  ytUrlInput: '',
  ytThumbnailUrl: null as string | null,
});

const createDefaultAnalysisResult = (): StudioAnalysisResult => ({
  niche: [],
  trending: [],
  confidence: '--',
  error: null,
  isAnalyzing: false,
  isUrlAnalyzing: false,
});

const createDefaultExportJobState = (): StudioExportJobState => ({
  taskId: null,
  status: 'idle',
  error: null,
  resultVideoUrl: null,
  resultSrtUrl: null,
  resultVttUrl: null,
});

const createDefaultThumbnailBenchmarkJobState = (): StudioThumbnailBenchmarkJobState => ({
  taskId: null,
  status: 'idle',
  error: null,
  resultImageUrl: null,
  resultAnalysisSummary: null,
  resultCandidates: [],
});

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
  const [topicGenerationBasis, setTopicGenerationBasis] = useState<StudioTopicGenerationBasis | null>(() => (
    stored?.topicGenerationBasis === 'idea-only' ||
    stored?.topicGenerationBasis === 'benchmark-only' ||
    stored?.topicGenerationBasis === 'idea-plus-benchmark'
      ? stored.topicGenerationBasis
      : null
  ));
  const [isFileLoaded, setIsFileLoaded] = useState(false);

  const [masterScript, setMasterScript] = useState(() => (typeof stored?.masterScript === 'string') ? stored.masterScript : '');
  const [selectedStyle, setSelectedStyle] = useState(() => (typeof stored?.selectedStyle === 'string') ? stored.selectedStyle : 'Realistic');
	  const [referenceImage, setReferenceImage] = useState(() => (typeof stored?.referenceImage === 'string') ? stored.referenceImage : '');
	  const [referenceImageUrl, setReferenceImageUrl] = useState(() => (typeof stored?.referenceImageUrl === 'string') ? stored.referenceImageUrl : '');
	  const [useVisualReferencesInSceneGeneration, setUseVisualReferencesInSceneGeneration] = useState(() => (
	    typeof stored?.useVisualReferencesInSceneGeneration === 'boolean' ? stored.useVisualReferencesInSceneGeneration : false
	  ));
	  const [visualReferenceAssets, setVisualReferenceAssets] = useState<StudioVisualReferenceAsset[]>(() => {
	    if (!Array.isArray(stored?.visualReferenceAssets)) return [];
	    return (stored.visualReferenceAssets as unknown[])
	      .map((item) => {
	        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
	        const obj = item as Record<string, unknown>;
	        const id = typeof obj.id === 'string' ? obj.id.trim() : '';
	        const url = typeof obj.url === 'string' ? obj.url.trim() : '';
	        const name = typeof obj.name === 'string' ? obj.name.trim() : '';
	        if (!id || !url) return null;
	        return { id, url, name: name || 'reference' };
	      })
	      .filter((item): item is StudioVisualReferenceAsset => Boolean(item));
	  });
	  const [analyzedStylePrompt, setAnalyzedStylePrompt] = useState(() => (typeof stored?.analyzedStylePrompt === 'string') ? stored.analyzedStylePrompt : '');
	  const [analyzedStylePromptKo, setAnalyzedStylePromptKo] = useState(() => (typeof stored?.analyzedStylePromptKo === 'string') ? stored.analyzedStylePromptKo : '');
	  const [referenceState, setReferenceState] = useState<StudioReferenceState>(() => {
	    const def: StudioReferenceState = createDefaultReferenceState();
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
	      mode: (['USE_EXISTING_REFERENCE', 'GENERATE_NEW', 'RESTYLE_REFERENCE'].includes(mode) ? mode : def.mode) as StudioReferenceMode,
	      nickname: typeof obj.nickname === 'string' ? obj.nickname : def.nickname,
	      style_target: typeof obj.style_target === 'string' ? obj.style_target : def.style_target,
	      style_preset_id: typeof obj.style_preset_id === 'string' ? obj.style_preset_id : def.style_preset_id,
	      style_option_ids: Array.isArray(obj.style_option_ids)
	        ? (obj.style_option_ids as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
	        : def.style_option_ids,
        custom_style_keywords: Array.isArray(obj.custom_style_keywords)
          ? (obj.custom_style_keywords as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : def.custom_style_keywords,
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
	      metadata: (obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)) ? obj.metadata as any : def.metadata,
	    };
	  });
	  const [selectedVoicePresetId, setSelectedVoicePresetId] = useState(() => (typeof stored?.selectedVoicePresetId === 'string') ? stored.selectedVoicePresetId : 'ko-female-1');
	  const [subtitlesEnabled, setSubtitlesEnabled] = useState(() => (typeof stored?.subtitlesEnabled === 'boolean') ? stored.subtitlesEnabled : true);
	  const [burnInSubtitles, setBurnInSubtitles] = useState(() => (typeof stored?.burnInSubtitles === 'boolean') ? stored.burnInSubtitles : false);
	  const [videoUrl, setVideoUrl] = useState<string | null>(() => (typeof stored?.videoUrl === 'string' && stored.videoUrl) ? stored.videoUrl : null);
	  const [exportJob, setExportJob] = useState<StudioExportJobState>(() => {
	    const def = createDefaultExportJobState();
	    const raw = stored?.exportJob;
	    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
	    const obj = raw as Record<string, unknown>;
	    return {
	      taskId: typeof obj.taskId === 'string' && obj.taskId.trim() ? obj.taskId : null,
	      status: obj.status === 'pending' || obj.status === 'running' || obj.status === 'success' || obj.status === 'failure' ? obj.status : def.status,
	      error: typeof obj.error === 'string' && obj.error.trim() ? obj.error : null,
	      resultVideoUrl: typeof obj.resultVideoUrl === 'string' && obj.resultVideoUrl.trim() ? obj.resultVideoUrl : null,
	      resultSrtUrl: typeof obj.resultSrtUrl === 'string' && obj.resultSrtUrl.trim() ? obj.resultSrtUrl : null,
	      resultVttUrl: typeof obj.resultVttUrl === 'string' && obj.resultVttUrl.trim() ? obj.resultVttUrl : null,
	    };
	  });
	  const [thumbnailBenchmarkJob, setThumbnailBenchmarkJob] = useState<StudioThumbnailBenchmarkJobState>(() => {
	    const def = createDefaultThumbnailBenchmarkJobState();
	    const raw = stored?.thumbnailBenchmarkJob;
	    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
	    const obj = raw as Record<string, unknown>;
	    return {
	      taskId: typeof obj.taskId === 'string' && obj.taskId.trim() ? obj.taskId : null,
	      status: obj.status === 'pending' || obj.status === 'running' || obj.status === 'success' || obj.status === 'failure' ? obj.status : def.status,
	      error: typeof obj.error === 'string' && obj.error.trim() ? obj.error : null,
	      resultImageUrl: typeof obj.resultImageUrl === 'string' && obj.resultImageUrl.trim() ? obj.resultImageUrl : null,
	      resultAnalysisSummary: typeof obj.resultAnalysisSummary === 'string' && obj.resultAnalysisSummary.trim() ? obj.resultAnalysisSummary : null,
        resultCandidates: normalizeThumbnailCandidates(obj.resultCandidates),
	    };
	  });
	  const [metaTitle, setMetaTitle] = useState(() => (typeof stored?.metaTitle === 'string') ? stored.metaTitle : '');
	  const [metaDescription, setMetaDescription] = useState(() => (typeof stored?.metaDescription === 'string') ? stored.metaDescription : '');
	  const [metaPinnedComment, setMetaPinnedComment] = useState(() => (typeof stored?.metaPinnedComment === 'string') ? stored.metaPinnedComment : '');
	  const [thumbnailData, setThumbnailData] = useState(() => {
	    const def = createDefaultThumbnailData();
	    if (stored?.thumbnailData && typeof stored.thumbnailData === 'object' && !Array.isArray(stored.thumbnailData)) {
	      const t = stored.thumbnailData as Record<string, unknown>;
	      const thumbs = normalizeThumbnailCandidates(t.thumbnails);
	      return {
	        thumbnails: thumbs,
	        ytUrlInput: typeof t.ytUrlInput === 'string' ? (t.ytUrlInput as string) : def.ytUrlInput,
	        ytThumbnailUrl: typeof t.ytThumbnailUrl === 'string' ? (t.ytThumbnailUrl as string) : def.ytThumbnailUrl,
	      };
	    }
	    return def;
	  });

  const [analysisResult, setAnalysisResult] = useState<StudioAnalysisResult>(() => createDefaultAnalysisResult());

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
    const def = createDefaultPlanningData();
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
			      descriptionInput, topicGenerationBasis, scenes, sceneDurations, scriptStyle, customScriptStyleText, scriptLength, planningData,
			      selectedTopic, finalTopic, generatedTopics, masterPlan, masterScript, selectedStyle,
			      referenceImage, referenceImageUrl, useVisualReferencesInSceneGeneration, visualReferenceAssets, analyzedStylePrompt, analyzedStylePromptKo,
            referenceState,
			      selectedBenchmarkPatterns,
			      selectedVoicePresetId, subtitlesEnabled, burnInSubtitles,
			      videoUrl, exportJob, thumbnailBenchmarkJob, metaTitle, metaDescription, metaPinnedComment, thumbnailData
		    };
	    localStorage.setItem(storageKey, JSON.stringify(data));
	  }, [
	    storageKey,
	    currentStep, activeTags, urlInput, urlAnalysisData, videoFormat, inputMode,
	    descriptionInput, topicGenerationBasis, scenes, sceneDurations, scriptStyle, customScriptStyleText, scriptLength, planningData,
	    selectedTopic, finalTopic, generatedTopics, masterPlan, masterScript, selectedStyle,
		    referenceImage, referenceImageUrl, useVisualReferencesInSceneGeneration, visualReferenceAssets, analyzedStylePrompt, analyzedStylePromptKo,
		    referenceState,
		    selectedBenchmarkPatterns,
		    selectedVoicePresetId, subtitlesEnabled, burnInSubtitles,
		    videoUrl, exportJob, thumbnailBenchmarkJob, metaTitle, metaDescription, metaPinnedComment, thumbnailData
		  ]);

  useEffect(() => {
    if (!exportJob.taskId) return;
    if (exportJob.status !== 'pending' && exportJob.status !== 'running') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await studioExportJobStatus(exportJob.taskId as string);
        if (cancelled) return;
        setExportJob((prev) => {
          if (prev.taskId !== status.task_id) return prev;
          return {
            ...prev,
            status: status.status,
            error: status.status === 'failure' ? (status.error || '렌더링 실패') : null,
            resultVideoUrl: status.result?.video_url || prev.resultVideoUrl,
            resultSrtUrl: (status.result?.captions as any)?.srt_url || prev.resultSrtUrl,
            resultVttUrl: (status.result?.captions as any)?.vtt_url || prev.resultVttUrl,
          };
        });
        if (status.status === 'success') {
          setVideoUrl(status.result?.video_url || null);
        }
      } catch (error) {
        if (cancelled) return;
        setExportJob((prev) => (
          prev.taskId === exportJob.taskId
            ? { ...prev, status: 'failure', error: error instanceof Error ? error.message : '상태 조회 실패' }
            : prev
        ));
      }
    };
    tick();
    const intervalId = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [exportJob.taskId, exportJob.status, setVideoUrl]);

  useEffect(() => {
    if (exportJob.status === 'success' && exportJob.resultVideoUrl && videoUrl !== exportJob.resultVideoUrl) {
      setVideoUrl(exportJob.resultVideoUrl);
    }
  }, [exportJob.status, exportJob.resultVideoUrl, videoUrl, setVideoUrl]);

  useEffect(() => {
    if (!thumbnailBenchmarkJob.taskId) return;
    if (thumbnailBenchmarkJob.status !== 'pending' && thumbnailBenchmarkJob.status !== 'running') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await studioThumbnailBenchmarkJobStatus(thumbnailBenchmarkJob.taskId as string);
        if (cancelled) return;
        setThumbnailBenchmarkJob((prev) => {
          if (prev.taskId !== status.task_id) return prev;
          return {
            ...prev,
            status: status.status,
            error: status.status === 'failure' ? (status.error || '썸네일 벤치마킹 실패') : null,
            resultImageUrl: status.result?.image_url || prev.resultImageUrl,
            resultAnalysisSummary: status.result?.analysis_summary || prev.resultAnalysisSummary,
            resultCandidates: normalizeThumbnailCandidates(
              (status.result?.images || []).map((item) => ({
                id: item.id,
                title: item.title,
                imageUrl: item.image_url,
                ctrHint: item.ctr_hint,
                isSelected: false,
              }))
            ),
          };
        });
      } catch (error) {
        if (cancelled) return;
        setThumbnailBenchmarkJob((prev) => (
          prev.taskId === thumbnailBenchmarkJob.taskId
            ? { ...prev, status: 'failure', error: error instanceof Error ? error.message : '상태 조회 실패' }
            : prev
        ));
      }
    };
    tick();
    const intervalId = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [thumbnailBenchmarkJob.taskId, thumbnailBenchmarkJob.status]);

  useEffect(() => {
    if (thumbnailBenchmarkJob.status !== 'success') return;
    const candidates = normalizeThumbnailCandidates(thumbnailBenchmarkJob.resultCandidates);
    if (candidates.length === 0) return;
    setThumbnailData((prev) => ({ ...prev, thumbnails: candidates }));
  }, [thumbnailBenchmarkJob.status, thumbnailBenchmarkJob.resultCandidates, setThumbnailData]);

  const resetThumbnailArtifacts = useCallback(() => {
    setThumbnailBenchmarkJob(createDefaultThumbnailBenchmarkJobState());
    setThumbnailData((prev) => ({ ...prev, thumbnails: [] }));
  }, [setThumbnailBenchmarkJob, setThumbnailData]);

  const narrativeSignature = useMemo(() => buildSceneNarrativeSignature(scenes), [scenes]);
  const renderSignature = useMemo(() => buildSceneRenderSignature(scenes), [scenes]);
  const metaSignature = useMemo(
    () => JSON.stringify({
      finalTopic: (finalTopic || '').trim(),
      selectedTopic: (selectedTopic || '').trim(),
      summary: (planningData?.summary || '').trim(),
      targetDuration: (planningData?.targetDuration || '').trim(),
      masterScript: (masterScript || '').trim(),
    }),
    [finalTopic, selectedTopic, planningData?.summary, planningData?.targetDuration, masterScript]
  );
  const thumbnailDependencySignature = useMemo(
    () => JSON.stringify({
      topic: (finalTopic || selectedTopic || '').trim(),
      videoFormat,
    }),
    [finalTopic, selectedTopic, videoFormat]
  );

  const prevNarrativeSignatureRef = useRef(narrativeSignature);
  const prevRenderSignatureRef = useRef(renderSignature);
  const prevMetaSignatureRef = useRef(metaSignature);
  const prevThumbnailSignatureRef = useRef(thumbnailDependencySignature);

  useEffect(() => {
    const previous = prevNarrativeSignatureRef.current;
    if (previous && previous !== narrativeSignature) {
      setScenes((prev) => {
        const hasAnyAudio = prev.some((scene) => !!scene.audioUrl);
        if (!hasAnyAudio) return prev;
        return prev.map((scene) => ({
          ...scene,
          audioUrl: '',
          durationSec: undefined,
          audioDurationSec: undefined,
        }));
      });
      setSceneDurations([]);
      setExportJob(createDefaultExportJobState());
      setVideoUrl(null);
    }
    prevNarrativeSignatureRef.current = narrativeSignature;
  }, [narrativeSignature, setExportJob, setSceneDurations, setScenes, setVideoUrl]);

  useEffect(() => {
    const previous = prevRenderSignatureRef.current;
    if (previous && previous !== renderSignature) {
      setExportJob((prev) => {
        if (!prev.taskId && !prev.resultVideoUrl && prev.status === 'idle') return prev;
        return createDefaultExportJobState();
      });
      setVideoUrl((prev) => (prev ? null : prev));
    }
    prevRenderSignatureRef.current = renderSignature;
  }, [renderSignature, setExportJob, setVideoUrl]);

  useEffect(() => {
    const previous = prevMetaSignatureRef.current;
    if (previous && previous !== metaSignature) {
      if (metaTitle || metaDescription || metaPinnedComment) {
        setMetaTitle('');
        setMetaDescription('');
        setMetaPinnedComment('');
      }
    }
    prevMetaSignatureRef.current = metaSignature;
  }, [metaDescription, metaPinnedComment, metaSignature, metaTitle, setMetaDescription, setMetaPinnedComment, setMetaTitle]);

  useEffect(() => {
    const previous = prevThumbnailSignatureRef.current;
    if (previous && previous !== thumbnailDependencySignature) {
      resetThumbnailArtifacts();
    }
    prevThumbnailSignatureRef.current = thumbnailDependencySignature;
  }, [thumbnailDependencySignature, resetThumbnailArtifacts]);

  const resetStudioProject = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setCurrentStep(1);
    setActiveTags([]);
    setUrlInput('');
    setUrlAnalysisData(null);
    setSelectedBenchmarkPatterns([]);
    setIsLoading(false);
    setLoadingMessage(null);
    setVideoFormat('9:16');
    setAnalysisResult(createDefaultAnalysisResult());
    setInputMode('tag');
    setDescriptionInput('');
    setTopicGenerationBasis(null);
    setScenes([]);
    setSceneDurations([]);
    setScriptSegments([]);
    setGeneratedTopics([]);
    setSelectedTopic('');
    setFinalTopic('');
    setReferenceScript('');
    setScriptStyle('type-a');
    setCustomScriptStyleText('');
    setScriptLength('short');
    setPlanningData(createDefaultPlanningData());
    setIsFileLoaded(false);
    setMasterPlan('');
    setMasterScript('');
    setSelectedStyle('Realistic');
    setReferenceImage('');
    setReferenceImageUrl('');
    setUseVisualReferencesInSceneGeneration(false);
    setVisualReferenceAssets([]);
    setAnalyzedStylePrompt('');
    setAnalyzedStylePromptKo('');
    setReferenceState(createDefaultReferenceState());
    setSelectedVoicePresetId('ko-female-1');
    setSubtitlesEnabled(true);
    setBurnInSubtitles(false);
    setVideoUrl(null);
    setExportJob(createDefaultExportJobState());
    setThumbnailBenchmarkJob(createDefaultThumbnailBenchmarkJobState());
    setMetaTitle('');
    setMetaDescription('');
    setMetaPinnedComment('');
    setThumbnailData(createDefaultThumbnailData());
  }, [storageKey]);

  const value = {
    sessionId,
    resetStudioProject,
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
      topicGenerationBasis, setTopicGenerationBasis,
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
    useVisualReferencesInSceneGeneration, setUseVisualReferencesInSceneGeneration,
    visualReferenceAssets, setVisualReferenceAssets,
	    analyzedStylePrompt, setAnalyzedStylePrompt,
		    analyzedStylePromptKo, setAnalyzedStylePromptKo,
        referenceState, setReferenceState,
		    selectedVoicePresetId, setSelectedVoicePresetId,
	    subtitlesEnabled, setSubtitlesEnabled,
	    burnInSubtitles, setBurnInSubtitles,
	    videoUrl, setVideoUrl,
      exportJob, setExportJob,
	    thumbnailBenchmarkJob, setThumbnailBenchmarkJob,
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
  collapsible?: boolean;
  collapseThreshold?: number;
  collapseTitle?: string;
  collapseHeaderMode?: 'default' | 'minimal';
  headerLabel?: string;
  headerAction?: React.ReactNode;
  alwaysCollapsible?: boolean;
  forceShowCollapseHeader?: boolean;
  expandedOverride?: boolean;
  onExpandedChange?: (next: boolean) => void;
  readOnly?: boolean;
}> = ({ value, onChange, placeholder, isHighlighted, className, collapsible = false, collapseThreshold = 260, collapseTitle = '생성된 내용', collapseHeaderMode = 'default', headerLabel, headerAction, alwaysCollapsible = false, forceShowCollapseHeader = false, expandedOverride, onExpandedChange, readOnly = false }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trimmedValue = value.trim();
  const shouldCollapse = collapsible && (alwaysCollapsible || trimmedValue.length > collapseThreshold);
  const [isExpanded, setIsExpanded] = useState(() => !shouldCollapse);
  const [contentHeight, setContentHeight] = useState(0);
  const hasManualToggleRef = useRef(false);
  const prevLengthRef = useRef(trimmedValue.length);
  const isControlled = typeof expandedOverride === 'boolean';
  const expanded = isControlled ? expandedOverride : isExpanded;
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const content = contentRef.current;
    if (!textarea || !content) return;

    const rafId = requestAnimationFrame(() => {
      textarea.style.height = 'auto';
      const textareaHeight = textarea.scrollHeight;
      textarea.style.height = `${textareaHeight}px`;
      const measuredContentHeight = Math.max(content.scrollHeight, textareaHeight);
      setContentHeight(measuredContentHeight + 2);
    });

    return () => cancelAnimationFrame(rafId);
  }, [expanded, shouldCollapse, value]);

  useEffect(() => {
    const prevLength = prevLengthRef.current;
    const nextLength = trimmedValue.length;

    if (isControlled) {
      prevLengthRef.current = nextLength;
      return;
    }

    if (!hasManualToggleRef.current) {
      if (!shouldCollapse) {
        setIsExpanded(true);
      } else if (prevLength === 0 && nextLength > collapseThreshold) {
        setIsExpanded(false);
      }
    } else if (!shouldCollapse) {
      setIsExpanded(true);
      hasManualToggleRef.current = false;
    }

    prevLengthRef.current = nextLength;
  }, [collapseThreshold, isControlled, shouldCollapse, trimmedValue.length]);

  const toggleExpanded = () => {
    if (isControlled) {
      onExpandedChange?.(!expanded);
      return;
    }
    hasManualToggleRef.current = true;
    setIsExpanded((prev) => !prev);
  };

  return (
    <div className={`${isHighlighted ? 'ring-2 ring-primary/60 rounded-2xl' : ''}`}>
      {(shouldCollapse || forceShowCollapseHeader) && (
        <div className={collapseHeaderMode === 'minimal'
          ? 'mb-2 flex items-center justify-between gap-3'
          : 'mb-2 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/35 px-3 py-2'
        }>
          {collapseHeaderMode === 'default' ? (
            <div className="text-xs text-slate-400">{collapseTitle}</div>
          ) : headerLabel || headerAction ? (
            <div className="flex min-w-0 items-center gap-2">
              {headerLabel ? <div className="ui-label">{headerLabel}</div> : null}
              {headerAction}
            </div>
          ) : (
            <div />
          )}
          {shouldCollapse ? (
            <button
              type="button"
              onClick={toggleExpanded}
              className={`ui-btn ui-btn--ghost text-xs shrink-0 ${collapseHeaderMode === 'minimal' ? '!px-0 !py-0 min-h-0 h-auto' : ''}`}
            >
              {expanded ? '△ 접기' : '▽ 펼치기'}
            </button>
          ) : collapseHeaderMode === 'default' ? (
            <div className="w-16" />
          ) : null}
        </div>
      )}
      <div
        className={`studio-collapse ${shouldCollapse ? '' : 'is-static'} ${expanded || !shouldCollapse ? 'is-open' : 'is-closed'}`}
        style={shouldCollapse ? { maxHeight: expanded ? `${Math.max(contentHeight, 24)}px` : '0px' } : undefined}
      >
        <div ref={contentRef}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              if (!isControlled && shouldCollapse) setIsExpanded(true);
            }}
            placeholder={placeholder}
            readOnly={readOnly}
            className={`ui-textarea resize-none leading-relaxed overflow-hidden ${className || ''}`}
            rows={1}
          />
        </div>
      </div>
    </div>
  );
};

const StudioCollapsibleSection: React.FC<{
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, expanded, onToggle, children }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const rafId = requestAnimationFrame(() => {
      if (!contentRef.current) return;
      setContentHeight(contentRef.current.scrollHeight);
    });
    return () => cancelAnimationFrame(rafId);
  }, [children, expanded]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <button
          type="button"
          onClick={onToggle}
          className="ui-btn ui-btn--ghost text-xs shrink-0"
        >
          {expanded ? '△ 접기' : '▽ 펼치기'}
        </button>
      </div>
      <div
        className={`studio-collapse ${expanded ? 'is-open' : 'is-closed'}`}
        style={{ maxHeight: expanded ? `${Math.max(contentHeight, 24)}px` : '0px' }}
      >
        <div ref={contentRef}>
          {children}
        </div>
      </div>
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

const DisabledButtonHint = ({
  disabled,
  reason,
  children,
  className = '',
}: {
  disabled: boolean;
  reason?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`studio-disabled-hint ${disabled && reason ? 'is-disabled' : ''} ${className}`.trim()}
    tabIndex={disabled && reason ? 0 : undefined}
  >
    {children}
    {disabled && reason ? (
      <div className="studio-disabled-hint__tooltip" role="tooltip">
        {reason}
      </div>
    ) : null}
  </div>
);

// --- [Step 1: 기획 및 전략 분석] ---
const TopicAnalysisStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    activeTags, setActiveTags, analysisResult, setAnalysisResult, inputMode, setInputMode, descriptionInput, setDescriptionInput,
    topicGenerationBasis, setTopicGenerationBasis,
    videoFormat, setVideoFormat, urlInput, setUrlInput, setGeneratedTopics, urlAnalysisData, setUrlAnalysisData,
    selectedBenchmarkPatterns, setSelectedBenchmarkPatterns,
    isFileLoaded, setIsFileLoaded, setCurrentStep
  } = useGlobal();

  const [isTopicGenerating, setIsTopicGenerating] = useState(false);
  const [isBenchmarkContentExpanded, setIsBenchmarkContentExpanded] = useState(false);
  const [isBenchmarkDeliveryExpanded, setIsBenchmarkDeliveryExpanded] = useState(false);
  const [isTrendSignalsOpen, setIsTrendSignalsOpen] = useState(false);

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
  const currentTrendList = trendPeriod === 'monthly' ? trendDisplayLists.monthly : trendDisplayLists.weekly;

  const formatOptions = [
    { id: '9:16', label: '세로형', sub: 'Shorts / Reels', icon: <Smartphone size={16} /> },
    { id: '16:9', label: '가로형', sub: 'YouTube / Standard', icon: <Monitor size={16} /> }
  ];
  const topicBasisOptions: Array<{
    id: StudioTopicGenerationBasis;
    label: string;
    desc: string;
  }> = [
    {
      id: 'idea-only',
      label: '아이디어만 사용',
      desc: '내 키워드와 설명만 기준으로 주제를 만듭니다.',
    },
    {
      id: 'benchmark-only',
      label: '벤치마킹만 사용',
      desc: '분석한 유튜브 영상의 내용과 패턴만 기준으로 주제를 만듭니다.',
    },
    {
      id: 'idea-plus-benchmark',
      label: '둘 다 함께 사용',
      desc: '내 아이디어 방향과 벤치마킹 영상의 내용/패턴을 같이 반영합니다.',
    },
  ];
  const hasIdeaInput = activeTags.length > 0 || descriptionInput.trim().length > 0;
  const hasBenchmarkInput = Boolean(urlAnalysisData);
  const shouldChooseTopicBasis = hasBenchmarkInput;
  const effectiveTopicGenerationBasis: StudioTopicGenerationBasis | null = shouldChooseTopicBasis
    ? topicGenerationBasis
    : 'idea-only';
  const canGenerateTopicsByBasis =
    effectiveTopicGenerationBasis === 'idea-only'
      ? hasIdeaInput
      : effectiveTopicGenerationBasis === 'benchmark-only'
        ? hasBenchmarkInput
        : effectiveTopicGenerationBasis === 'idea-plus-benchmark'
          ? hasIdeaInput && hasBenchmarkInput
          : false;
  const topicGenerationDisabledReason = useMemo(() => {
    if (shouldChooseTopicBasis && !topicGenerationBasis) {
      return '주제 생성 기준 3개 중 하나를 먼저 선택해야 주제 생성이 가능합니다.';
    }
    if (canGenerateTopicsByBasis) return '';
    if (effectiveTopicGenerationBasis === 'idea-only') {
      return '아이디어만 사용으로 주제를 만들려면 먼저 키워드 또는 설명을 입력해야 합니다.';
    }
    if (effectiveTopicGenerationBasis === 'benchmark-only') {
      return '벤치마킹만 사용으로 주제를 만들려면 먼저 유튜브 링크로 내용 + 패턴 분석을 완료해야 합니다.';
    }
    return '둘 다 함께 사용을 선택했기 때문에, 아이디어 입력과 벤치마킹 분석을 모두 완료해야 주제 생성 버튼이 활성화됩니다.';
  }, [canGenerateTopicsByBasis, effectiveTopicGenerationBasis, shouldChooseTopicBasis, topicGenerationBasis]);
  const topicGenerationBasisHint = useMemo(() => {
    if (!shouldChooseTopicBasis) {
      return '현재는 벤치마킹 분석 결과가 없으므로, 아이디어 입력 기준으로 주제가 생성됩니다.';
    }
    if (!topicGenerationBasis) {
      return '내용 + 패턴 분석이 완료되었습니다. 아래 3개 중 하나를 선택해야 주제 생성하기를 사용할 수 있습니다.';
    }
    if (topicGenerationBasis === 'idea-only') {
      return '현재 선택: 아이디어 입력만 사용합니다. 벤치마킹 분석 결과는 무시됩니다.';
    }
    if (topicGenerationBasis === 'benchmark-only') {
      return '현재 선택: 벤치마킹 영상의 내용 요약과 패턴만 사용합니다. 아이디어 입력은 무시됩니다.';
    }
    return '현재 선택: 아이디어 입력과 벤치마킹 영상의 내용/패턴을 함께 사용합니다.';
  }, [shouldChooseTopicBasis, topicGenerationBasis]);

  const runUrlAnalysis = async (url: string) => {
    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube\.com\/shorts)\/.+$/;
    if (!ytRegex.test(url)) return showToast("유효한 유튜브 주소가 아닙니다.");
    
    setUrlAnalysisData(null);
    setTopicGenerationBasis(null);
    setIsBenchmarkContentExpanded(false);
    setIsBenchmarkDeliveryExpanded(false);
    setAnalysisResult(p => ({ ...p, isUrlAnalyzing: true, error: null }));
    try {
      const result = await analyzeUrlPattern(url);
      setUrlAnalysisData(result);
      setTopicGenerationBasis(null);
      setIsBenchmarkContentExpanded(false);
      setIsBenchmarkDeliveryExpanded(false);
      setAnalysisResult(p => ({
        ...p,
        isUrlAnalyzing: false,
        confidence: 85,
        niche: [result.summary, ...result.patterns.slice(0, 2)],
        trending: ["벤치마킹 데이터 로드 완료"]
      }));
      setSelectedBenchmarkPatterns([]);
      showToast(`내용 + 패턴 분석이 완료되었습니다. (모드: ${benchmarkModeLabel((result as any)?.meta?.analysisMode)}) 내용은 자동 반영되며, 패턴은 클릭해 선택 후 주제 생성하기를 누르세요.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "URL 분석에 실패했습니다.";
      setUrlAnalysisData(null);
      setAnalysisResult(p => ({ ...p, isUrlAnalyzing: false, error: msg }));
      showToast(msg);
    }
  };

  const handleStartTopicGen = async () => {
    if (!canGenerateTopicsByBasis) return showToast(topicGenerationDisabledReason || "주제 생성 기준에 맞는 입력을 먼저 완료해주세요.");
    setIsTopicGenerating(true);
    try {
      const urlData = effectiveTopicGenerationBasis !== 'idea-only' && urlAnalysisData
        ? {
            summary: buildBenchmarkSummaryForPrompt(urlAnalysisData),
            patterns: selectedBenchmarkPatterns.length > 0 ? selectedBenchmarkPatterns : urlAnalysisData.patterns,
          }
        : null;
      const topicTags = effectiveTopicGenerationBasis === 'benchmark-only' ? [] : activeTags;
      const topicDescription = effectiveTopicGenerationBasis === 'benchmark-only' ? '' : descriptionInput;
      const trendTitles = effectiveTopicGenerationBasis === 'benchmark-only'
        ? []
        : (trendDataRaw || []).slice(0, 20).map((t) => t.name).filter(Boolean);
      const res = await generateTopics({
        tags: topicTags,
        description: topicDescription,
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
    setTopicGenerationBasis(null);
    setIsBenchmarkContentExpanded(false);
    setIsBenchmarkDeliveryExpanded(false);
    setSelectedBenchmarkPatterns([]);
    setAnalysisResult((p) => ({ ...p, isUrlAnalyzing: false, error: null }));
  };

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 1 / Strategy"
        title="기획 분석"
        subtitle="아이디어를 정리하고, 시장과 콘텐츠 방향성을 빠르게 정교화합니다."
        className="max-w-[980px] mx-auto"
      />

      <div className="max-w-[980px] mx-auto space-y-6">
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} />
                <div className="wf-panel__title !mt-0">Trend Signals</div>
              </div>
              <p className="text-sm text-slate-500">
                선택한 시장 카테고리를 기준으로 참고할 트렌드 신호입니다. 필요할 때만 펼쳐 확인하세요.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isTrendSignalsOpen && (
                <div className="planner-tabs">
                  <button onClick={() => setTrendPeriod('monthly')} className={`planner-tab ${trendPeriod === 'monthly' ? 'is-active' : ''}`}>월간</button>
                  <button onClick={() => setTrendPeriod('weekly')} className={`planner-tab ${trendPeriod === 'weekly' ? 'is-active' : ''}`}>일주일간</button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setIsTrendSignalsOpen((prev) => !prev)}
                className="ui-btn ui-btn--ghost shrink-0"
              >
                {isTrendSignalsOpen ? '△ 접기' : '▽ 펼치기'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/35 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-border/70 bg-secondary/45 px-3 py-1 text-slate-200">
                선택 카테고리 {selectedCategoryIds.size}개
              </span>
              <span className="rounded-full border border-border/70 bg-secondary/45 px-3 py-1 text-slate-200">
                현재 {trendPeriod === 'monthly' ? '월간' : '일주일간'} 신호 {currentTrendList.length}개
              </span>
              {trendLoading && (
                <span className="rounded-full border border-border/70 bg-secondary/45 px-3 py-1 text-slate-300">
                  불러오는 중...
                </span>
              )}
            </div>
          </div>

          {isTrendSignalsOpen && (
            <div className="wf-list text-sm max-h-[420px] overflow-y-auto pt-2">
              {trendLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (() => {
                if (!currentTrendList.length) {
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
                return currentTrendList.map((trend, idx) => (
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
          )}
        </div>

        <div className="space-y-6">
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
                {analysisResult.isUrlAnalyzing ? <><Loader2 size={14} className="animate-spin" /> 내용 + 패턴 분석 중...</> : '내용 + 패턴 분석'}
              </button>
            </div>
            {urlAnalysisData && (
              <div className="mt-4 p-5 rounded-xl bg-secondary/50 border border-border/70 space-y-4">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-800">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  내용 + 패턴 분석 결과
                </div>
                <div className="text-sm text-slate-600 space-y-1.5 leading-6">
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
                    <StudioCollapsibleSection
                      title="1) 내용 벤치마킹 (상세)"
                      expanded={isBenchmarkContentExpanded}
                      onToggle={() => setIsBenchmarkContentExpanded((prev) => !prev)}
                    >
                      <>
                        {urlAnalysisData?.content?.summary && (
                          <p className="mt-1 text-base leading-7 text-slate-800 whitespace-pre-wrap">{urlAnalysisData.content.summary}</p>
                        )}
                        {Array.isArray(urlAnalysisData?.content?.keyPoints) && urlAnalysisData.content.keyPoints.length > 0 && (
                          <ul className="mt-2 list-disc pl-5 text-base leading-7 text-slate-800 space-y-1.5">
                            {urlAnalysisData.content.keyPoints.slice(0, 14).map((kp: string, i: number) => (
                              <li key={i}>{kp}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    </StudioCollapsibleSection>
                  </div>
                )}

                {urlAnalysisData.summary && (
                  <StudioCollapsibleSection
                    title="2) 진행 방식/패턴 분석 (요약)"
                    expanded={isBenchmarkDeliveryExpanded}
                    onToggle={() => setIsBenchmarkDeliveryExpanded((prev) => !prev)}
                  >
                    <p className="mt-1 text-base leading-7 text-slate-800 whitespace-pre-wrap">{urlAnalysisData.summary}</p>
                  </StudioCollapsibleSection>
                )}
                {urlAnalysisData.patterns?.length > 0 && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <span className="text-sm font-semibold text-slate-700">패턴</span>
                      <p className="text-sm leading-6 text-slate-500">클릭해 선택하면 주제 생성과 기획에 반영됩니다. 내용 요약은 자동으로 함께 반영됩니다.</p>
                    </div>
                    <ul className="space-y-2">
                      {urlAnalysisData.patterns.map((p: string, i: number) => {
                        const isSelected = selectedBenchmarkPatterns.includes(p);
                        const parsedPattern = parseBenchmarkPattern(p);
                        return (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => toggleBenchmarkPattern(p)}
                              className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                                isSelected
                                  ? 'bg-primary/12 border-primary/45 ring-1 ring-primary/25'
                                  : 'bg-card/30 border-border/70 hover:border-border/90 hover:bg-card/45'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                                    isSelected ? 'bg-primary ring-4 ring-primary/15' : 'bg-slate-500/80'
                                  }`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className={`text-sm leading-6 ${isSelected ? 'text-slate-100' : 'text-slate-200'}`}>
                                    {parsedPattern.body}
                                  </div>
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 space-y-3">
              {shouldChooseTopicBasis && (
                <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-label">주제 생성 기준</span>
                    <span className="text-xs text-muted-foreground">3개 중 하나를 선택해야 생성할 수 있습니다</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {topicBasisOptions.map((option) => {
                      const active = topicGenerationBasis === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setTopicGenerationBasis(option.id)}
                          className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                            active
                              ? 'border-primary/55 bg-primary/8 ring-1 ring-primary/30'
                              : 'border-border/70 bg-card/30 hover:border-border/90'
                          }`}
                        >
                          <div className="text-sm font-semibold text-slate-100">{option.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground leading-5">{option.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card/35 px-3 py-2 text-xs text-slate-300">
                    {topicGenerationBasisHint}
                  </div>
                </div>
              )}
              <DisabledButtonHint disabled={!canGenerateTopicsByBasis || isTopicGenerating} reason={!canGenerateTopicsByBasis ? topicGenerationDisabledReason : undefined} className="w-full">
                <button onClick={handleStartTopicGen} disabled={!canGenerateTopicsByBasis || isTopicGenerating} className="wf-primary w-full">
                  {isTopicGenerating ? <><Loader2 size={16} className="animate-spin" /> 주제 생성 중...</> : <><Sparkles size={16} /> 주제 생성하기</>}
                </button>
              </DisabledButtonHint>
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
  const [topicSelectionMode, setTopicSelectionMode] = useState<'ai' | 'manual'>(() => (generatedTopics.length > 0 ? 'ai' : 'manual'));

  useEffect(() => {
    if (selectedTopic === 'manual') {
      setTopicSelectionMode('manual');
      return;
    }
    if (generatedTopics.length === 0) {
      setTopicSelectionMode('manual');
    }
  }, [generatedTopics.length, selectedTopic]);

  const handleFinalize = async () => {
    const topic = topicSelectionMode === 'manual' ? manualTopic : selectedTopic;
    if (!topic) return showToast("분석에 사용할 주제를 선택하거나 직접 입력해주세요.");
    // Manual 입력인 경우 selectedTopic을 실제 텍스트로 확정
    if (topicSelectionMode === 'manual') setSelectedTopic(topic);
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
        subtitle="AI 추천 주제를 고르거나, 원하는 주제를 직접 입력해 다음 단계로 진행합니다."
      />

      <div className="ui-card space-y-4">
        <div className="inline-flex w-full rounded-2xl border border-border/70 bg-card/35 p-1">
          <button
            type="button"
            onClick={() => setTopicSelectionMode('ai')}
            disabled={generatedTopics.length === 0}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
              topicSelectionMode === 'ai'
                ? 'bg-primary/12 text-slate-100 ring-1 ring-primary/30'
                : 'text-slate-300 hover:bg-card/50'
            } ${generatedTopics.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            AI 추천
          </button>
          <button
            type="button"
            onClick={() => {
              setTopicSelectionMode('manual');
              if (selectedTopic !== 'manual') setSelectedTopic('manual');
            }}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
              topicSelectionMode === 'manual'
                ? 'bg-primary/12 text-slate-100 ring-1 ring-primary/30'
                : 'text-slate-300 hover:bg-card/50'
            }`}
          >
            직접 입력
          </button>
        </div>
        <div className="text-sm text-slate-500">
          {topicSelectionMode === 'ai'
            ? 'AI가 추천한 주제 중 하나를 고르면 바로 다음 단계로 이어갈 수 있습니다.'
            : '원하는 주제가 명확하다면 직접 입력으로 바로 확정할 수 있습니다.'}
        </div>
      </div>

      {topicSelectionMode === 'ai' ? (
        <div className="ui-card ui-card--flush overflow-hidden">
          {generatedTopics.length > 0 ? (
            generatedTopics.map((topic) => (
              <button
                key={topic.title}
                onClick={() => setSelectedTopic(topic.title)}
                className={`topic-row w-full flex items-center justify-between px-6 py-5 text-left transition-colors ${selectedTopic === topic.title ? 'is-selected' : ''}`}
              >
                <div className="flex items-start gap-4">
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
            ))
          ) : (
            <div className="px-6 py-10 text-center text-slate-500">
              아직 추천된 주제가 없습니다. Step 1에서 주제를 생성하거나 직접 입력으로 진행하세요.
            </div>
          )}
        </div>
      ) : (
        <div className="ui-card space-y-3">
          <div className="flex items-center justify-between">
            <span className="ui-label">직접 입력</span>
            <button
              onClick={() => setSelectedTopic('manual')}
              className="ui-btn ui-btn--secondary"
            >
              선택
            </button>
          </div>
          <textarea
            value={manualTopic}
            onChange={e => { setManualTopic(e.target.value); if (selectedTopic !== 'manual') setSelectedTopic('manual'); }}
            placeholder="직접 기획한 고유 주제를 입력하세요..."
            className="ui-textarea min-h-[120px]"
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
        <button
          type="button"
          onClick={() => setCurrentStep(1)}
          className="ui-btn ui-btn--secondary w-full justify-center"
        >
          <ChevronRight size={16} className="rotate-180" /> 1 기획 돌아가기
        </button>
        <button onClick={handleFinalize} disabled={!selectedTopic} className="ui-btn ui-btn--primary w-full justify-center">
          3 구조 진행하기 <ChevronRight size={16} />
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

  const benchmarkSummaryForPrompt = useMemo(() => buildBenchmarkSummaryForPrompt(urlAnalysisData), [urlAnalysisData]);
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
        targetDuration: planningData.targetDuration,
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
        length: scriptLength,
        targetDuration: planningData.targetDuration,
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
        targetDuration: planningData.targetDuration,
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
      const nextMasterScript = (res.master_script || '').trim();
      if (!nextMasterScript) {
        showToast('통합 시나리오 생성 결과가 비어 있습니다. 다시 시도해 주세요.');
        return false;
      }
      setMasterScript(nextMasterScript);
      setReviewMode('script');
      return true;
    } catch (e) {
      console.error(e);
      showToast('통합 시나리오 생성에 실패했습니다.');
      return false;
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
    const ok = await handleSynthesizeScript();
    if (ok) setIsPreviewOpen(true);
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
                    collapsible
                    collapseThreshold={340}
                    collapseTitle="완성 원고"
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
                  이미지 및 대본 생성 진행하기 <ChevronRight size={16} />
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
                collapsible
                collapseThreshold={220}
                collapseTitle="대단원 기획안"
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
                collapsible
                collapseThreshold={220}
                collapseTitle={s.name}
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
                <ChevronRight size={16} className="rotate-180" /> 2 주제 돌아가기
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
  const MAX_VISUAL_REFERENCE_UPLOADS = 10;
  const DEFAULT_REFERENCE_STATE: StudioReferenceState = {
    mode: 'USE_EXISTING_REFERENCE',
    nickname: '',
    style_target: '',
    style_preset_id: 'realistic',
    style_option_ids: ['studio_clean', 'high_detail'],
    custom_style_keywords: [],
    age_group: '',
    gender: '',
    height_cm: null,
    must_keep: ['face', 'hair', 'colors'],
    may_change: [],
    palette: { primary: '', secondary: '', accent: '' },
    constraints: { must_not_have: ['text', 'watermark', 'logo', 'busy background', 'multiple characters'] },
    metadata: null,
  };
  const {
    setReferenceImage, referenceImageUrl, setReferenceImageUrl,
    visualReferenceAssets, setVisualReferenceAssets,
    setUseVisualReferencesInSceneGeneration,
    analyzedStylePrompt, setAnalyzedStylePrompt, analyzedStylePromptKo, setAnalyzedStylePromptKo,
    referenceState, setReferenceState,
    setCurrentStep
  } = useGlobal();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isImgDragging, setIsImgDragging] = useState(false);
  const [isRefUploading, setIsRefUploading] = useState(false);
  const [isRefStyleAnalyzing, setIsRefStyleAnalyzing] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [workStatus, setWorkStatus] = useState<string | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string>('');
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [baseFrontUrl, setBaseFrontUrl] = useState<string>('');
  const [baseFrontCutoutUrl, setBaseFrontCutoutUrl] = useState<string>('');
  const [turnaroundUrls, setTurnaroundUrls] = useState<Partial<Record<StudioReferenceView, string>>>({});
  const [turnaroundCutoutUrls, setTurnaroundCutoutUrls] = useState<Partial<Record<StudioReferenceView, string>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visualReferenceInputRef = useRef<HTMLInputElement>(null);
  const translatingRef = useRef(false);
  const [isZipDownloading, setIsZipDownloading] = useState(false);
  const [isVisualReferenceUploading, setIsVisualReferenceUploading] = useState(false);
  const [gridProgress, setGridProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [tileEditPrompt, setTileEditPrompt] = useState('');
  const [isTileRegenerating, setIsTileRegenerating] = useState(false);
  const [tileOverrideAngle, setTileOverrideAngle] = useState('');
  const [customStyleKeywordInput, setCustomStyleKeywordInput] = useState('');
  const customStyleKeywordComposingRef = useRef(false);

  const handleImgUpload = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      setReferenceImage(base64);
      setSourceFileName(file?.name || '');
      setIsRefUploading(true);
      try {
        const uploaded = await uploadStudioReferenceImage(file);
        setSourceImageUrl(uploaded.url);
        // 기존 Visual Step 호환: 업로드만 했을 때는 URL을 유지
        setReferenceImageUrl(uploaded.url);
        setIsRefUploading(false);
        setIsRefStyleAnalyzing(true);
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
        setIsRefUploading(false);
        setIsRefStyleAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleVisualReferenceUpload = async (incomingFiles: FileList | File[]) => {
    const files = Array.from(incomingFiles || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const remaining = MAX_VISUAL_REFERENCE_UPLOADS - visualReferenceAssets.length;
    if (remaining <= 0) {
      showToast(`추가 레퍼런스는 최대 ${MAX_VISUAL_REFERENCE_UPLOADS}장까지 업로드할 수 있습니다.`);
      return;
    }
    const targetFiles = files.slice(0, remaining);
    if (targetFiles.length < files.length) {
      showToast(`최대 ${MAX_VISUAL_REFERENCE_UPLOADS}장까지만 업로드됩니다.`);
    }
    setIsVisualReferenceUploading(true);
    try {
      const uploadedAssets: StudioVisualReferenceAsset[] = [];
      for (const file of targetFiles) {
        const uploaded = await uploadStudioReferenceImage(file);
        uploadedAssets.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          url: uploaded.url,
          name: file.name || 'reference',
        });
      }
      if (uploadedAssets.length) {
        setVisualReferenceAssets((prev) => [...prev, ...uploadedAssets]);
        showToast(`${uploadedAssets.length}장의 비주얼 레퍼런스를 추가했습니다.`);
      }
    } catch (error) {
      console.error(error);
      showToast('비주얼 레퍼런스 업로드에 실패했습니다.');
    } finally {
      setIsVisualReferenceUploading(false);
    }
  };

  const handleResetReferenceStep = useCallback(() => {
    setReferenceImage('');
    setReferenceImageUrl('');
    setVisualReferenceAssets([]);
    setUseVisualReferencesInSceneGeneration(false);
    setAnalyzedStylePrompt('');
    setAnalyzedStylePromptKo('');
    setReferenceState({ ...DEFAULT_REFERENCE_STATE });

    setShowAdvanced(false);
    setIsImgDragging(false);
    setIsRefUploading(false);
    setIsRefStyleAnalyzing(false);
    setIsWorking(false);
    setWorkStatus(null);
    setSourceImageUrl('');
    setSourceFileName('');
    setBaseFrontUrl('');
    setBaseFrontCutoutUrl('');
    setTurnaroundUrls({});
    setTurnaroundCutoutUrls({});
    setIsZipDownloading(false);
    setIsVisualReferenceUploading(false);
    setGridProgress(null);
    setSelectedTileIndex(null);
    setTileEditPrompt('');
    setIsTileRegenerating(false);
    setTileOverrideAngle('');
    showToast('레퍼런스 스탭이 초기화되었습니다.');
  }, [
    setAnalyzedStylePrompt,
    setAnalyzedStylePromptKo,
    setReferenceImage,
    setReferenceImageUrl,
    setReferenceState,
    setUseVisualReferencesInSceneGeneration,
    setVisualReferenceAssets,
    showToast,
  ]);

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

  const styleBasePresets = useMemo(() => ([
    {
      id: 'realistic',
      label: '실사형',
      description: '광고 컷처럼 사실적인 피부, 조명, 질감을 강조합니다.',
      value: 'photorealistic, natural skin, realistic lighting, high fidelity detail',
    },
    {
      id: 'anime_jp',
      label: '일본 애니형',
      description: '선명한 셀 셰이딩과 또렷한 라인 중심의 애니 스타일입니다.',
      value: 'Japanese anime, clean line art, crisp cel shading, vivid eyes',
    },
    {
      id: 'webtoon',
      label: '웹툰형',
      description: '깔끔한 선과 부드러운 명암의 한국형 웹툰 톤입니다.',
      value: 'Korean webtoon style, soft shading, tidy line art, balanced pastel tones',
    },
    {
      id: 'illustration',
      label: '일러스트형',
      description: '브러시 터치와 분위기를 살리는 감성 일러스트 톤입니다.',
      value: 'editorial illustration, painterly brushwork, soft gradients, refined textures',
    },
    {
      id: 'render_3d',
      label: '3D 렌더형',
      description: '입체적인 재질감과 정리된 라이팅의 3D 캐릭터 톤입니다.',
      value: '3D character render, PBR materials, studio lighting, clean geometry',
    },
    {
      id: 'game_mascot',
      label: '게임 캐릭터형',
      description: '실루엣이 명확하고 읽기 쉬운 게임용 캐릭터 느낌입니다.',
      value: 'stylized game character design, readable silhouette, polished character sheet, clean rendering',
    },
  ]), []);

  const styleOptionGroups = useMemo(() => ([
    {
      key: 'lighting',
      label: '조명',
      options: [
        { id: 'studio_clean', label: '깔끔한 스튜디오 조명', value: 'clean studio lighting, even exposure, plain white background' },
        { id: 'soft_light', label: '부드러운 조명', value: 'soft lighting, soft shadows, gentle contrast' },
        { id: 'cinematic_light', label: '시네마틱 조명', value: 'cinematic lighting, dramatic contrast, depth separation' },
        { id: 'rim_light', label: '림라이트 강조', value: 'subtle rim lighting, subject separation, polished highlights' },
      ],
    },
    {
      key: 'rendering',
      label: '표현 방식',
      options: [
        { id: 'high_detail', label: '디테일 선명', value: 'high detail, production-ready finish' },
        { id: 'cel_shading', label: '셀 셰이딩', value: 'strong cel shading, clear shadow shapes' },
        { id: 'clean_line', label: '깔끔한 라인', value: 'clean line art, tidy contours' },
        { id: 'bold_outline', label: '굵은 외곽선', value: 'bold outlines, graphic readability' },
        { id: 'smooth_skin', label: '매끈한 피부 표현', value: 'smooth skin shading, polished surfaces' },
      ],
    },
    {
      key: 'mood',
      label: '무드',
      options: [
        { id: 'premium_mood', label: '프리미엄 무드', value: 'premium cinematic mood, refined finish' },
        { id: 'cute_mood', label: '귀여운 무드', value: 'appealing cute character energy, friendly expression language' },
        { id: 'cool_mood', label: '시크한 무드', value: 'cool stylish tone, composed attitude' },
        { id: 'bright_mood', label: '밝고 경쾌한 무드', value: 'bright upbeat mood, vibrant readability' },
      ],
    },
    {
      key: 'material',
      label: '질감',
      options: [
        { id: 'fabric_texture', label: '의상 재질감 강조', value: 'textured fabric, readable material separation' },
        { id: 'sharp_silhouette', label: '실루엣 또렷하게', value: 'sharp silhouette, strong shape definition' },
        { id: 'pastel_palette', label: '파스텔 톤', value: 'pastel palette, soft color harmony' },
        { id: 'high_contrast', label: '대비감 있게', value: 'high contrast, punchy color separation' },
      ],
    },
  ]), []);

  const stylePresetMap = useMemo(
    () => Object.fromEntries(styleBasePresets.map((preset) => [preset.id, preset])) as Record<string, typeof styleBasePresets[number]>,
    [styleBasePresets]
  );

  const styleOptionMap = useMemo(
    () => Object.fromEntries(styleOptionGroups.flatMap((group) => group.options.map((option) => [option.id, option]))) as Record<string, { id: string; label: string; value: string }>,
    [styleOptionGroups]
  );

  const selectedStyleKoreanLabels = useMemo(() => {
    const labels = [];
    const preset = stylePresetMap[referenceState.style_preset_id];
    if (preset) labels.push(preset.label);
    for (const optionId of referenceState.style_option_ids) {
      const option = styleOptionMap[optionId];
      if (option) labels.push(option.label);
    }
    for (const keyword of referenceState.custom_style_keywords) {
      if (keyword?.trim()) labels.push(keyword.trim());
    }
    return labels;
  }, [referenceState.custom_style_keywords, referenceState.style_option_ids, referenceState.style_preset_id, styleOptionMap, stylePresetMap]);

  const styleTags = useMemo(() => {
    const t = (referenceState.style_target || '').trim();
    if (!t) return [];
    return t.split(/[,\n]/g).map((s) => s.trim()).filter(Boolean).slice(0, 16);
  }, [referenceState.style_target]);

  const applyBaseStylePreset = useCallback((presetId: string) => {
    setReferenceState((prev) => ({ ...prev, style_preset_id: presetId }));
  }, [setReferenceState]);

  const toggleStyleOption = useCallback((optionId: string) => {
    setReferenceState((prev) => {
      const exists = prev.style_option_ids.includes(optionId);
      return {
        ...prev,
        style_option_ids: exists
          ? prev.style_option_ids.filter((id) => id !== optionId)
          : [...prev.style_option_ids, optionId],
      };
    });
  }, [setReferenceState]);

  const addCustomStyleKeywords = useCallback((rawValue: string) => {
    const keywords = rawValue
      .split(/[,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!keywords.length) return;
    setReferenceState((prev) => {
      const next = [...prev.custom_style_keywords];
      keywords.forEach((keyword) => {
        if (!next.includes(keyword) && next.length < 10) next.push(keyword);
      });
      return { ...prev, custom_style_keywords: next };
    });
    setCustomStyleKeywordInput('');
  }, [setReferenceState]);

  const removeCustomStyleKeyword = useCallback((keyword: string) => {
    setReferenceState((prev) => ({
      ...prev,
      custom_style_keywords: prev.custom_style_keywords.filter((item) => item !== keyword),
    }));
  }, [setReferenceState]);

  useEffect(() => {
    if (referenceState.mode !== 'GENERATE_NEW') return;
    const presetValue = stylePresetMap[referenceState.style_preset_id]?.value || stylePresetMap.realistic?.value || '';
    const optionValues = referenceState.style_option_ids
      .map((id) => styleOptionMap[id]?.value)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const customKeywordValues = referenceState.custom_style_keywords
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    const nextStyleTarget = Array.from(new Set([presetValue, ...optionValues, ...customKeywordValues])).join(', ');
    if (nextStyleTarget !== referenceState.style_target) {
      setReferenceState((prev) => ({ ...prev, style_target: nextStyleTarget }));
    }
  }, [
    referenceState.custom_style_keywords,
    referenceState.mode,
    referenceState.style_option_ids,
    referenceState.style_preset_id,
    referenceState.style_target,
    setReferenceState,
    styleOptionMap,
    stylePresetMap,
  ]);

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

    const randomPalette = pickOne(randomCharacterSeedSets.palettes);
    const randomConstraints = pickMany(randomCharacterSeedSets.constraints, 5, 7);
    const mustKeepPool = ['face', 'hair', 'outfit', 'colors', 'body_type', 'accessories'] as StudioReferenceState['must_keep'];
    const mayChangePool = ['outfit', 'colors', 'hairstyle', 'accessories', 'material', 'mood'] as StudioReferenceState['may_change'];
    const nextMustKeep = pickMany(mustKeepPool, 3, 5) as StudioReferenceState['must_keep'];
    const nextMayChange = pickMany(mayChangePool, 1, 3) as StudioReferenceState['may_change'];
    const nextNickname = buildRandomNickname();
    const nextPreset = pickOne(styleBasePresets).id;
    const allOptionIds = styleOptionGroups.flatMap((group) => group.options.map((option) => option.id));
    const nextStyleOptionIds = pickMany(allOptionIds, 4, 7);
    const nextAge = pickOne(randomCharacterSeedSets.ages);
    const nextGender = pickOne(randomCharacterSeedSets.genders);
    const nextHeight = pickOne(randomCharacterSeedSets.heights);

    setReferenceState((prev) => ({
      ...prev,
      nickname: nextNickname,
      style_preset_id: nextPreset,
      style_option_ids: nextStyleOptionIds,
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
  }, [buildRandomNickname, pickMany, pickOne, randomCharacterSeedSets, referenceState.mode, setReferenceState, showToast, styleBasePresets, styleOptionGroups]);

  const downloadReferenceZip = useCallback(async () => {
    const nickname = (referenceState.nickname || 'character').trim() || 'character';
    const safeBaseName = nickname.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'character';
    const zipItems: Array<{ url: string; label: string }> = [];
    if (gridCutoutUrls.length > 0) {
      gridCutoutUrls.forEach((url, idx) => {
        zipItems.push({ url, label: `${safeBaseName}${idx + 1}` });
      });
    } else if (referenceImageUrl) {
      zipItems.push({ url: referenceImageUrl, label: `${safeBaseName}1` });
    }

    if (zipItems.length === 0) {
      showToast('다운로드할 레퍼런스 이미지가 없습니다.');
      return;
    }
    const zipName = `${safeBaseName}.zip`;

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
      const folder = zip.folder(safeBaseName) ?? zip;
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
      'Create one final polished tile only. Do not generate alternative variants, contact sheets, or exploratory layouts.',
      'Use the provided reference image as the canonical identity source.',
      'Preserve the reference identity EXACTLY: same face, hairstyle, hair volume, outfit, materials, accessories, proportions, silhouette, lighting family, and render style.',
      'Single character only. No text, no labels, no borders, no grid.',
      'Solid light gray background, seamless (no horizon line, no gradient).',
      'Even studio lighting, soft shadows only.',
      'Keep the pose neutral and readable with clean silhouette separation and strong reference-sheet clarity.',
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
        resolution: '1K',
        output_format: 'png',
        limit_generations: true,
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
          'Create one final polished turnaround sheet only. Do not produce alternative layouts, extra framing experiments, or visible guide overlays.',
	          'PRIMARY GOAL: produce nine panels showing the exact same character with strict identity consistency and strict view-direction compliance.',
	          'All panels must preserve the same face, body proportions, hairstyle, outfit, materials, colors, accessories, expression, and neutral standing pose.',
	          'Only the character facing direction changes across panels, using a clock-face system where facing the camera is 6 o’clock.',
	          'PRIORITY ORDER: 1) identity consistency across all 9 panels, 2) exact assigned clock direction for each panel, 3) exact framing for each panel, 4) outfit/material/accessory consistency, 5) clean studio presentation.',
	          'STUDIO SETUP: 3x3 equal-sized grid, no text, no labels, no watermarks, no logos, no borders.',
	          'Use a plain light neutral gray seamless studio background, even studio lighting, minimal soft floor shadow, consistent white balance, consistent exposure, and consistent subject scale across panels.',
          'Keep the sheet visually clean, production-ready, and highly readable with crisp silhouette separation.',
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
          generated_mode: referenceState.mode,
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
            limit_generations: true,
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
        if (!sourceImageUrl) return showToast('캐릭터 캡처 이미지를 업로드해 주세요.');
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
          limit_generations: true,
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
        showToast('캐릭터 턴어라운드 생성이 완료되었습니다.');
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
  const isExistingReferenceMode = mode === 'USE_EXISTING_REFERENCE';
  const showUploadCard = mode === 'RESTYLE_REFERENCE';
  const showExample = mode === 'GENERATE_NEW' || mode === 'RESTYLE_REFERENCE';
  const showStyleTarget = mode === 'GENERATE_NEW';
  const showBodyInfo = mode === 'GENERATE_NEW';
  const showPalette = mode === 'GENERATE_NEW' || (showAdvanced && mode !== 'RESTYLE_REFERENCE');
  const showKeepChange = false;
  const showStyleAnalysisBox = mode === 'GENERATE_NEW' && !!analyzedStylePrompt;
  const hasPreview = gridCutoutUrls.length > 0;
  const hasPreviewForCurrentMode = hasPreview && referenceState.metadata?.generated_mode === mode;
  const hasVisualReferencesForStep5 = visualReferenceAssets.length > 0;
  const canDownloadReferenceMetadata =
    (mode === 'GENERATE_NEW' || mode === 'RESTYLE_REFERENCE') &&
    !!referenceState.metadata &&
    hasPreviewForCurrentMode;
  const canRunReferencePipeline =
    !isWorking &&
    !isRefUploading &&
    !isRefStyleAnalyzing &&
    (mode !== 'RESTYLE_REFERENCE' || !!sourceImageUrl);
  const canMoveToVisualWithReferences = isExistingReferenceMode
    ? hasVisualReferencesForStep5
    : hasPreviewForCurrentMode && hasVisualReferencesForStep5;

  const referencePipelineDisabledReason = useMemo(() => {
    if (canRunReferencePipeline) return '';
    if (isWorking) return '지금은 레퍼런스 생성 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 시도하세요.';
    if (isRefUploading) return '캡처 이미지를 업로드하는 중입니다. 업로드가 완전히 끝나야 레퍼런스 만들기 버튼이 활성화됩니다.';
    if (isRefStyleAnalyzing) return '업로드한 이미지를 분석하는 중입니다. 분석이 끝나면 레퍼런스 만들기를 눌러 턴어라운드를 생성할 수 있습니다.';
    if (mode === 'RESTYLE_REFERENCE' && !sourceImageUrl) return '먼저 기준이 되는 캐릭터 캡처 이미지를 업로드해야 합니다. 업로드가 완료되면 레퍼런스 만들기 버튼이 활성화됩니다.';
    return '먼저 필요한 입력을 완료해야 레퍼런스 만들기 버튼을 사용할 수 있습니다.';
  }, [canRunReferencePipeline, isRefStyleAnalyzing, isRefUploading, isWorking, mode, sourceImageUrl]);

  const metadataDownloadDisabledReason = useMemo(() => {
    if (canDownloadReferenceMetadata) return '';
    if (mode === 'USE_EXISTING_REFERENCE') return '기존 래퍼런스 사용 모드에서는 별도의 생성 메타데이터가 없습니다. 신규 생성 또는 턴어라운드 생성이 끝난 뒤에만 다운로드할 수 있습니다.';
    if (!hasPreviewForCurrentMode) return '먼저 현재 모드에서 레퍼런스 생성 작업을 완료해야 합니다. 생성된 레퍼런스 타일이 있어야 메타데이터 JSON을 다운로드할 수 있습니다.';
    if (!referenceState.metadata) return '생성 메타데이터가 아직 준비되지 않았습니다. 레퍼런스 생성이 완료된 뒤 다시 시도하세요.';
    return '현재는 메타데이터 JSON을 다운로드할 수 없습니다.';
  }, [canDownloadReferenceMetadata, hasPreviewForCurrentMode, mode, referenceState.metadata]);

  const moveToVisualDisabledReason = useMemo(() => {
    if (canMoveToVisualWithReferences) return '';
    if (!isExistingReferenceMode && !hasPreviewForCurrentMode) {
      return '먼저 레퍼런스 만들기를 완료해 현재 모드의 레퍼런스 타일을 생성해야 합니다. 생성이 끝난 뒤 Step 5용 래퍼런스를 업로드하고 이동할 수 있습니다.';
    }
    if (!hasVisualReferencesForStep5) {
      return 'Step 5에서 함께 사용할 래퍼런스를 먼저 업로드해야 합니다. 래퍼런스를 추가한 뒤 5 비주얼 진행하기를 눌러주세요. 참고 없이 넘어가려면 건너뛰기를 누르세요.';
    }
    return '현재는 5 비주얼 진행하기 버튼을 사용할 수 없습니다.';
  }, [canMoveToVisualWithReferences, hasPreviewForCurrentMode, hasVisualReferencesForStep5, isExistingReferenceMode]);

  const handleSkipToVisualStep = useCallback(() => {
    setUseVisualReferencesInSceneGeneration(false);
    setCurrentStep(5);
  }, [setCurrentStep, setUseVisualReferencesInSceneGeneration]);

  const handleMoveToVisualStepWithReferences = useCallback(() => {
    if (!hasVisualReferencesForStep5) {
      showToast('래퍼런스가 업로드되지 않았다. 래퍼런스를 업로드하고 5 비주얼 진행하기를 눌러라. 래퍼런스를 추가하지 않고 넘어가고 싶으면 그냥 건너뛰기를 눌러라.');
      return;
    }
    setUseVisualReferencesInSceneGeneration(true);
    setCurrentStep(5);
  }, [hasVisualReferencesForStep5, setCurrentStep, setUseVisualReferencesInSceneGeneration, showToast]);

  const handleReferenceModeChange = useCallback((nextMode: StudioReferenceMode) => {
    if (nextMode !== 'GENERATE_NEW') {
      setShowAdvanced(false);
    }
    setReferenceState((prev) => ({ ...prev, mode: nextMode }));
  }, [setReferenceState]);

  return (
    <div className="space-y-10 pb-24 max-w-[1200px] mx-auto">
      <SectionHeader
        kicker="Step 4 / Reference"
        title="레퍼런스 이미지"
        subtitle="캐릭터/아바타 등 생성에 반영할 레퍼런스 이미지를 업로드합니다."
        className="max-w-[900px] mx-auto"
        right={(
          <button
            type="button"
            onClick={handleResetReferenceStep}
            disabled={isWorking || isRefUploading || isRefStyleAnalyzing || isVisualReferenceUploading || isTileRegenerating}
            className="ui-btn ui-btn--ghost shrink-0"
          >
            <RefreshCcw size={14} /> 초기화
          </button>
        )}
      />

      <div className="max-w-[900px] mx-auto space-y-6">
        <div className="ui-card space-y-4">
          <span className="ui-label">모드</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {([
              { id: 'USE_EXISTING_REFERENCE', label: 'A. 기존 래퍼런스 사용하기', desc: '이미 준비된 캐릭터/아바타 레퍼런스를 그대로 활용할게요' },
              { id: 'GENERATE_NEW', label: 'C. 레퍼런스 새로 생성', desc: '이미지가 없어서 캐릭터를 새로 만들고 싶어요' },
              { id: 'RESTYLE_REFERENCE', label: 'D. 기존 캐릭터 캡처로 턴어라운드 생성', desc: '보유한 캐릭터 캡처 1장 기준으로 같은 화풍/분위기를 유지한 3x3 턴어라운드를 만들어요' },
            ] as Array<{ id: StudioReferenceMode; label: string; desc: string }>).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleReferenceModeChange(m.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${referenceState.mode === m.id ? 'border-primary/50 ring-1 ring-primary/35 bg-primary/5' : 'border-border/70 hover:border-border/90'}`}
              >
                <div className="text-sm font-semibold">{m.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

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

        {!isExistingReferenceMode && (
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
            {mode === 'GENERATE_NEW' && (
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
              <div className="space-y-5 rounded-2xl border border-border/60 bg-secondary/10 p-4">
                <div className="space-y-2">
                  <label className="ui-label">스타일 조합</label>
                  <div className="text-xs text-muted-foreground">
                    한국어 옵션만 고르면 내부적으로 영문 스타일 프롬프트를 자동 조합합니다.
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-semibold text-slate-200">기본 스타일</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {styleBasePresets.map((preset) => {
                      const isSelected = referenceState.style_preset_id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyBaseStylePreset(preset.id)}
                          className={`rounded-2xl border px-4 py-4 text-left transition-colors ${isSelected ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/35' : 'border-border/70 hover:border-border/90 bg-card/40'}`}
                        >
                          <div className="text-sm font-semibold text-slate-100">{preset.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground leading-5">{preset.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-4">
                  {styleOptionGroups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <div className="text-sm font-semibold text-slate-200">{group.label}</div>
                      <div className="flex flex-wrap gap-2">
                        {group.options.map((option) => {
                          const active = referenceState.style_option_ids.includes(option.id);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => toggleStyleOption(option.id)}
                              className={`rounded-full border px-3 py-2 text-xs transition-colors ${active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/70 text-slate-300 hover:border-border/90'}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-4">
                  <div className="text-sm font-semibold text-slate-100">현재 선택 조합</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedStyleKoreanLabels.length > 0 ? (
                      selectedStyleKoreanLabels.map((label) => {
                        const isCustomKeyword = referenceState.custom_style_keywords.includes(label);
                        return (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${isCustomKeyword ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-primary/10 text-primary'}`}
                          >
                            {label}
                            {isCustomKeyword && (
                              <button
                                type="button"
                                onClick={() => removeCustomStyleKeyword(label)}
                                className="rounded-full text-primary/80 transition hover:text-primary"
                                aria-label={`${label} 제거`}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </span>
                        );
                      })
                    ) : (
                      <span className="text-xs text-muted-foreground">아직 선택된 스타일이 없습니다.</span>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="planner-tagbox">
                      <div className="planner-tagbox__field">
                        <input
                          type="text"
                          value={customStyleKeywordInput}
                          onChange={(e) => setCustomStyleKeywordInput(e.target.value)}
                          onCompositionStart={() => {
                            customStyleKeywordComposingRef.current = true;
                          }}
                          onCompositionEnd={(e) => {
                            customStyleKeywordComposingRef.current = false;
                            setCustomStyleKeywordInput(e.currentTarget.value);
                          }}
                          onKeyDown={(e) => {
                            if (customStyleKeywordComposingRef.current || e.nativeEvent.isComposing) return;
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              addCustomStyleKeywords(customStyleKeywordInput);
                            }
                          }}
                          placeholder="원하는 키워드를 직접 입력하고 엔터로 추가"
                          className="planner-tagbox__input"
                        />
                        {customStyleKeywordInput && (
                          <button
                            type="button"
                            onClick={() => addCustomStyleKeywords(customStyleKeywordInput)}
                            className="planner-tagbox__add"
                          >
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      선택 조합 외에 원하는 키워드가 있으면 직접 입력해서 함께 반영할 수 있습니다.
                    </div>
                  </div>
                </div>

                {showAdvanced && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-slate-200">내부 적용 스타일 프롬프트 (영문)</div>
                    <textarea
                      className="ui-input min-h-[110px] text-sm"
                      value={referenceState.style_target}
                      readOnly
                      placeholder="영문 프롬프트를 직접 보정하고 싶을 때만 수정하세요."
                    />
                    <div className="text-xs text-muted-foreground">
                      기본 사용자는 위 한국어 선택만 해도 충분합니다. 선택한 옵션이 내부적으로 어떻게 조합됐는지 확인하는 용도입니다.
                    </div>
                  </div>
                )}
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
        )}

        {showUploadCard && (
          <div className="ui-card space-y-4">
            <div className="flex items-center justify-between">
              <span className="ui-label">레퍼런스 업로드</span>
              <button onClick={() => fileInputRef.current?.click()} disabled={isRefUploading || isWorking} className="ui-btn ui-btn--secondary">
                {isRefUploading
                  ? <><Loader2 size={14} className="animate-spin" /> 업로드 중...</>
                  : isRefStyleAnalyzing
                    ? <><Loader2 size={14} className="animate-spin" /> 분석 중...</>
                    : '파일 선택'}
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {mode === 'RESTYLE_REFERENCE'
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
                {isRefStyleAnalyzing
                  ? '업로드는 완료되었고, 현재 스타일 분석을 마무리하고 있습니다.'
                  : '업로드 URL이 저장되었습니다. (Step 5 비주얼 생성 시 레퍼런스로 사용)'}
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

        {!isExistingReferenceMode && (
        <div className="flex flex-col sm:flex-row gap-3">
          <DisabledButtonHint disabled={!canRunReferencePipeline} reason={referencePipelineDisabledReason} className="w-full">
            <button
              type="button"
              onClick={runPipeline}
              disabled={!canRunReferencePipeline}
              className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
            >
              {isWorking ? <><Loader2 size={16} className="animate-spin" /> {workStatus || '처리 중...'}</> : '레퍼런스 만들기'}
            </button>
          </DisabledButtonHint>
          <DisabledButtonHint disabled={!canDownloadReferenceMetadata} reason={metadataDownloadDisabledReason} className="w-full">
            <button
              type="button"
              onClick={() => referenceState.metadata && downloadJson(`weav_reference_${(referenceState.nickname || 'character').trim() || 'character'}.json`, referenceState.metadata)}
              disabled={!canDownloadReferenceMetadata}
              className="ui-btn ui-btn--secondary w-full"
            >
              메타데이터 JSON 다운로드
            </button>
          </DisabledButtonHint>
        </div>
        )}

        {hasPreviewForCurrentMode && !isExistingReferenceMode && (
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

        {hasPreview && (
          <div className="ui-card space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="ui-label">비주얼 스탭에서 사용할 래퍼런스 업로드하기 (최대 10장 이미지 첨부 가능)</span>
                <div className="mt-1 text-xs text-muted-foreground">
                  Step 5 비주얼 생성 시 캐릭터 자세, 시선 방향, 의상 디테일 참고용으로 함께 사용합니다.
                </div>
              </div>
              <button
                type="button"
                onClick={() => visualReferenceInputRef.current?.click()}
                disabled={isVisualReferenceUploading || visualReferenceAssets.length >= MAX_VISUAL_REFERENCE_UPLOADS}
                className="ui-btn ui-btn--secondary shrink-0"
              >
                {isVisualReferenceUploading ? <><Loader2 size={14} className="animate-spin" /> 업로드 중...</> : <><ImagePlus size={14} /> 래퍼런스 추가</>}
              </button>
            </div>
            <input
              ref={visualReferenceInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) {
                  void handleVisualReferenceUpload(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            {visualReferenceAssets.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {visualReferenceAssets.map((asset, idx) => (
                  <div key={asset.id} className="rounded-2xl border border-border/60 bg-secondary/20 p-2">
                    <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                      <img src={asset.url} alt={asset.name || `visual reference ${idx + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setVisualReferenceAssets((prev) => prev.filter((item) => item.id !== asset.id))}
                        className="absolute right-2 top-2 rounded-full bg-black/65 p-1 text-white"
                        aria-label={`${asset.name || `reference ${idx + 1}`} 삭제`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-2 truncate text-xs text-slate-600">{asset.name || `reference_${idx + 1}`}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-5 text-sm text-slate-500">
                추가 레퍼런스를 올리면 Step 5의 모든 씬 이미지가 이 레퍼런스들을 함께 참고합니다.
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            className="ui-btn ui-btn--secondary w-full"
          >
            &lt; 3 구조 돌아가기
          </button>
          <button
            type="button"
            onClick={handleSkipToVisualStep}
            className="ui-btn ui-btn--ghost w-full"
          >
            건너뛰기
          </button>
          <DisabledButtonHint disabled={!canMoveToVisualWithReferences} reason={moveToVisualDisabledReason} className="w-full">
            <button
              type="button"
              onClick={handleMoveToVisualStepWithReferences}
              disabled={!canMoveToVisualWithReferences}
              className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
            >
              5 비주얼 진행하기 <ChevronRight size={18} />
            </button>
          </DisabledButtonHint>
        </div>
      </div>
    </div>
  );
};

// --- [Step 5: 이미지 및 대본 생성] ---
const ImageAndScriptStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { 
    masterScript, planningData, scenes, setScenes, selectedStyle, setSelectedStyle, videoFormat,
    referenceImageUrl,
    useVisualReferencesInSceneGeneration,
    visualReferenceAssets,
    analyzedStylePrompt,
    urlAnalysisData, selectedBenchmarkPatterns, setCurrentStep
  } = useGlobal();

  const [isSplitting, setIsSplitting] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string | null>(null);
  const [isStyleNoticeOpen, setIsStyleNoticeOpen] = useState(true);

  const styleLab = [
    { 
      id: 'Realistic', 
      name: '리얼', 
      model: 'fal-ai/nano-banana-2', 
      desc: '압도적 고퀄리티 실사 렌더링 스타일', 
      icon: <Camera size={24}/>
    },
    { 
      id: 'Photo', 
      name: '사진풍', 
      model: 'fal-ai/nano-banana-2', 
      desc: '자연스러운 채광과 사실적인 렌즈 질감', 
      icon: <ScanLine size={24}/>
    },
    { 
      id: 'Illustration', 
      name: '일러스트', 
      model: 'fal-ai/nano-banana-2', 
      desc: '감각적인 컨셉 아트 및 드로잉 스타일', 
      icon: <Palette size={24}/>
    },
    { 
      id: 'Anime', 
      name: '애니메이션', 
      model: 'fal-ai/nano-banana-2', 
      desc: '전통적인 2D/3D 애니메이션 캐릭터 화풍', 
      icon: <Smile size={24}/>
    },
    { 
      id: '3D', 
      name: '3D 렌더', 
      model: 'fal-ai/nano-banana-2', 
      desc: '입체적 재질과 시네마틱 라이팅 렌더링', 
      icon: <Box size={24}/>
    },
    { 
      id: 'LineArt', 
      name: '라인 아트', 
      model: 'fal-ai/nano-banana-2', 
      desc: '간결한 선과 세련된 명암 대비의 그래픽', 
      icon: <PenTool size={24}/>
    },
    { 
      id: 'Custom', 
      name: '사용자 지정', 
      model: 'fal-ai/nano-banana-2', 
      desc: '업로드한 레퍼런스의 분위기와 동일한 스타일로 생성', 
      icon: <Sliders size={24}/>
    },
  ];

  const benchmarkSummaryForPrompt = useMemo(() => buildBenchmarkSummaryForPrompt(urlAnalysisData), [urlAnalysisData]);
  const benchmarkPatternsForPrompt = useMemo(() => {
    const all = Array.isArray(urlAnalysisData?.patterns) ? (urlAnalysisData.patterns as string[]) : [];
    const picked = Array.isArray(selectedBenchmarkPatterns) ? selectedBenchmarkPatterns : [];
    return (picked.length ? picked : all).filter(Boolean).slice(0, 12);
  }, [urlAnalysisData, selectedBenchmarkPatterns]);

  const sceneReferenceImageUrls = useMemo(() => {
    if (!useVisualReferencesInSceneGeneration) return [];
    const urls = [
      referenceImageUrl,
      ...visualReferenceAssets.map((asset) => asset.url),
    ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
    return Array.from(new Set(urls)).slice(0, 10);
  }, [referenceImageUrl, useVisualReferencesInSceneGeneration, visualReferenceAssets]);

  const isReferenceStyleLocked = useMemo(
    () => useVisualReferencesInSceneGeneration && sceneReferenceImageUrls.length > 0,
    [sceneReferenceImageUrls.length, useVisualReferencesInSceneGeneration]
  );

  const availableStyles = useMemo(() => {
    if (isReferenceStyleLocked) {
      return styleLab.filter((style) => style.id === 'Custom');
    }
    return styleLab.filter((style) => style.id !== 'Custom');
  }, [isReferenceStyleLocked, styleLab]);

  const hasPreparedSceneBundle = useMemo(
    () => scenes.length > 0 && scenes.every((scene) => scene.narrative.trim().length > 0 && scene.aiPrompt.trim().length > 0),
    [scenes]
  );
  const hasVoiceReadySceneBundle = useMemo(
    () => scenes.length > 0 && scenes.every((scene) => scene.narrative.trim().length > 0),
    [scenes]
  );

  const splitScenesDisabledReason = useMemo(() => {
    if (!isSplitting && !isGeneratingAll) return '';
    if (isGeneratingAll) return '현재 각 씬 이미지 전체 자동 생성이 진행 중입니다. 이 작업이 끝난 뒤 다시 대본 및 이미지 프롬프트 생성을 사용할 수 있습니다.';
    return '지금 대본 및 이미지 프롬프트 생성이 진행 중입니다. 완료될 때까지 잠시 기다려주세요.';
  }, [isGeneratingAll, isSplitting]);

  const generateAllDisabledReason = useMemo(() => {
    if (!isSplitting && !isGeneratingAll && hasPreparedSceneBundle) return '';
    if (isSplitting) return '먼저 대본 및 이미지 프롬프트 생성이 끝나야 합니다. 각 씬의 대본과 이미지 프롬프트가 준비된 뒤 전체 자동 생성이 활성화됩니다.';
    if (isGeneratingAll) return '현재 각 씬 이미지를 자동 생성 중입니다. 현재 작업이 끝난 뒤 다시 사용할 수 있습니다.';
    return '먼저 대본 및 이미지 프롬프트 생성을 눌러 각 씬의 대본과 이미지 프롬프트를 준비해야 합니다. 준비가 끝나면 전체 자동 생성이 활성화됩니다.';
  }, [hasPreparedSceneBundle, isGeneratingAll, isSplitting]);
  const moveToVoiceDisabledReason = useMemo(() => {
    if (hasVoiceReadySceneBundle) return '';
    if (scenes.length === 0) {
      return '먼저 대본 및 이미지 프롬프트 생성을 눌러 씬을 만들고 장면별 대본을 준비해야 6 음성 진행하기를 사용할 수 있습니다.';
    }
    return '각 씬의 대본이 아직 준비되지 않았습니다. 최소 한 번 대본 및 이미지 프롬프트 생성을 완료한 뒤 6 음성 진행하기를 눌러주세요.';
  }, [hasVoiceReadySceneBundle, scenes.length]);

  const styleNoticeMessage = isReferenceStyleLocked
    ? '레퍼런스를 사용해서 넘어온 상태라 현재는 사용자 지정만 사용할 수 있습니다. 스타일은 업로드한 레퍼런스의 분위기를 기준으로 자동 반영됩니다.'
    : '레퍼런스를 건너뛰고 넘어왔기 때문에 스타일 프리셋만 사용할 수 있습니다. 이 경우 사용자 지정은 선택할 수 없습니다.';

  useEffect(() => {
    if (isReferenceStyleLocked) {
      if (selectedStyle !== 'Custom') setSelectedStyle('Custom');
      return;
    }
    if (selectedStyle === 'Custom') {
      setSelectedStyle('Realistic');
    }
  }, [isReferenceStyleLocked, selectedStyle, setSelectedStyle]);

  useEffect(() => {
    setIsStyleNoticeOpen(true);
  }, [isReferenceStyleLocked, useVisualReferencesInSceneGeneration]);

  const handleStudioSceneSplitting = async () => {
    if (!masterScript) return showToast("시나리오 데이터가 없습니다. 3단계에서 시나리오를 먼저 생성하세요.");
    setIsSplitting(true);
    try {
      setScenes([]);
      const splitRes = await splitScriptIntoScenes(masterScript, { targetDuration: planningData?.targetDuration });
      const mapped = splitRes
        .map((s: any, i: number) => ({
        id: Date.now() + i,
        narrative: (s.script_segment || '').trim(),
        aiPrompt: s.scene_description,
        aiPromptKo: '',
        imageUrl: '',
        duration: 5,
        cameraWork: 'Static',
        isPromptVisible: true,
        isSyncing: false,
        isGenerating: false
      }))
        .filter((scene) => scene.narrative.length > 0);

      if (mapped.length === 0) {
        throw new Error('scene split result empty');
      }

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
      showToast("대본 및 이미지 프롬프트 생성이 완료되었습니다.");
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
    if (!trimmed) {
      setScenes((prev) =>
        prev.map((p) => (p.id === sceneId ? { ...p, aiPromptKo: '', isSyncing: false } : p))
      );
      return;
    }
    setScenes((prev) =>
      prev.map((p) => (p.id === sceneId ? { ...p, aiPromptKo: '', isSyncing: true } : p))
    );
    promptTranslateTimersRef.current[sceneId] = window.setTimeout(async () => {
      try {
        const ko = await translateToKorean(trimmed);
        setScenes((prev) =>
          prev.map((p) =>
            p.id === sceneId && p.aiPrompt.trim() === trimmed
              ? { ...p, aiPromptKo: ko || '', isSyncing: false }
              : p.id === sceneId
                ? { ...p, isSyncing: false }
                : p
          )
        );
      } catch {
        setScenes((prev) =>
          prev.map((p) => (p.id === sceneId ? { ...p, isSyncing: false } : p))
        );
      }
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
      const url = await generateSceneImage(
        scene.aiPrompt,
        selectedStyle,
        videoFormat as '9:16' | '16:9',
        styleObj?.model,
        sceneReferenceImageUrls
      );
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
            <DisabledButtonHint disabled={isSplitting || isGeneratingAll} reason={splitScenesDisabledReason}>
              <button onClick={handleStudioSceneSplitting} disabled={isSplitting || isGeneratingAll} className="ui-btn ui-btn--secondary">
                {isSplitting ? <><Loader2 size={16} className="animate-spin" /> 대본 및 이미지 프롬프트 생성 중...</> : <><ScanLine size={16} /> 대본 및 이미지 프롬프트 생성</>}
              </button>
            </DisabledButtonHint>
            <DisabledButtonHint disabled={isSplitting || isGeneratingAll || !hasPreparedSceneBundle} reason={generateAllDisabledReason}>
              <button onClick={generateAll} disabled={isSplitting || isGeneratingAll || !hasPreparedSceneBundle} className="ui-btn ui-btn--primary">
                {isGeneratingAll ? <><Loader2 size={16} className="animate-spin" /> 각 씬 이미지 전체 자동 생성 중 {generateAllProgress}...</> : <><Zap size={16} /> 각 씬 이미지 전체 자동 생성</>}
              </button>
            </DisabledButtonHint>
          </div>
        )}
      />

      <div className="grid grid-cols-12 gap-8 items-start">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="ui-card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="ui-label">스타일 선택</span>
              <button
                type="button"
                onClick={() => setIsStyleNoticeOpen((prev) => !prev)}
                className="ui-btn ui-btn--ghost shrink-0"
                aria-label={isStyleNoticeOpen ? '스타일 안내 닫기' : '스타일 안내 열기'}
              >
                <Info size={14} /> {isStyleNoticeOpen ? '닫기' : '열기'}
              </button>
            </div>
            {sceneReferenceImageUrls.length > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-slate-600">
                총 {sceneReferenceImageUrls.length}장의 레퍼런스를 함께 참고합니다. 캐릭터 자세, 방향, 의상 디테일뿐 아니라 레퍼런스 분위기와 동일한 톤으로 비주얼을 생성합니다.
              </div>
            )}
            {isStyleNoticeOpen && (
              <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-xs text-slate-600">
                {styleNoticeMessage}
              </div>
            )}
            <div className="space-y-2">
              {availableStyles.map(style => (
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
                  <div className="lg:col-span-2 space-y-2">
                    <span className="ui-label">대본</span>
                    <AutoResizeTextarea
                      value={scene.narrative}
                      onChange={v => { const n = [...scenes]; n[idx].narrative = v; setScenes(n); }}
                      placeholder="대본 조각을 입력하세요..."
                      className="min-h-[140px] text-base font-semibold"
                    />
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

                <div className="ui-card--muted rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="ui-label">프롬프트</span>
                    <div className="inline-flex rounded-full border border-border/70 bg-card/55 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          const n = [...scenes];
                          n[idx].isPromptVisible = true;
                          setScenes(n);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${scene.isPromptVisible ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        영어 프롬프트
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const n = [...scenes];
                          n[idx].isPromptVisible = false;
                          setScenes(n);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${!scene.isPromptVisible ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        한국어 프롬프트
                      </button>
                    </div>
                  </div>
                  {scene.isPromptVisible ? (
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
                      className="min-h-[220px] text-sm"
                      collapsible
                      collapseThreshold={140}
                      collapseTitle={`StudioScene ${String(idx + 1).padStart(2, '0')} 프롬프트`}
                      collapseHeaderMode="minimal"
                      headerLabel="영어 프롬프트"
                      alwaysCollapsible
                      forceShowCollapseHeader
                    />
                  ) : (
                    <div className="space-y-2">
                      {scene.isSyncing && (
                        <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
                          <Loader2 size={12} className="animate-spin" />
                          번역중입니다...
                        </div>
                      )}
                      <AutoResizeTextarea
                        value={scene.aiPromptKo || ''}
                        onChange={() => {}}
                        placeholder={scene.isSyncing ? '번역중입니다...' : '번역이 아직 없습니다.'}
                        className="min-h-[220px] text-sm"
                        collapsible
                        collapseThreshold={140}
                        collapseTitle={`StudioScene ${String(idx + 1).padStart(2, '0')} 번역`}
                        collapseHeaderMode="minimal"
                        headerLabel="한국어 프롬프트"
                        alwaysCollapsible
                        forceShowCollapseHeader
                        readOnly
                      />
                    </div>
                  )}
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

      <div className="grid grid-cols-12 gap-8 pt-6">
        <div className="hidden lg:block lg:col-span-4" />
        <div className="col-span-12 lg:col-span-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(4)}
              className="ui-btn ui-btn--secondary w-full justify-center"
            >
              <ChevronRight size={16} className="rotate-180" /> 4 레퍼런스 돌아가기
            </button>
            <DisabledButtonHint
              disabled={!hasVoiceReadySceneBundle}
              reason={moveToVoiceDisabledReason}
              className="w-full"
            >
              <button
                type="button"
                onClick={() => setCurrentStep(6)}
                disabled={!hasVoiceReadySceneBundle}
                className="ui-btn ui-btn--primary w-full justify-center"
              >
                6 음성 진행하기 <ChevronRight size={16} />
              </button>
            </DisabledButtonHint>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- [Step 6: 보이스 프리셋 (ElevenLabs Turbo v2.5)] ---
const VOICE_PRESETS = [
  { id: 'ko-female-bright', voice: 'Jessica', name: '한국어 여성 (밝고 선명)', sample: '안녕하세요. 오늘 영상도 끝까지 재미있게 봐 주세요.', stability: 0.42, similarityBoost: 0.82, style: 0.24, speed: 1.0 },
  { id: 'ko-female-soft', voice: 'Laura', name: '한국어 여성 (부드럽고 친근)', sample: '일상 브이로그나 리뷰처럼 편안한 톤에 잘 어울려요.', stability: 0.5, similarityBoost: 0.78, style: 0.18, speed: 0.98 },
  { id: 'ko-male-calm', voice: 'Eric', name: '한국어 남성 (차분한 내레이션)', sample: '핵심을 또렷하게 전달하는 설명형 콘텐츠에 적합합니다.', stability: 0.48, similarityBoost: 0.8, style: 0.16, speed: 0.98 },
  { id: 'ko-male-news', voice: 'Will', name: '한국어 남성 (정보/뉴스형)', sample: '속보나 정보 전달형 콘텐츠에서 빠르고 분명한 전달감을 살려줍니다.', stability: 0.38, similarityBoost: 0.84, style: 0.12, speed: 1.02 },
];

type VoiceSegment = {
  id: number;
  sceneIndex: number;
  text: string;
  durationSec: number;
  status: 'pending' | 'done';
  audioUrl?: string;
};

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
  const { scenes, setScenes, setSceneDurations, selectedVoicePresetId, setSelectedVoicePresetId, setCurrentStep } = useGlobal();
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [samplePlaying, setSamplePlaying] = useState(false);
  const durationProbeCacheRef = useRef<Record<number, string>>({});

  const selectedVoice = VOICE_PRESETS.find(v => v.id === selectedVoicePresetId) ?? VOICE_PRESETS[0];

  const formatTtsDuration = useCallback((totalSec: number) => {
    const safe = Math.max(0, totalSec || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = Math.round(safe % 60);
    if (minutes <= 0) return `${seconds}초`;
    if (seconds === 0) return `${minutes}분`;
    return `${minutes}분 ${seconds}초`;
  }, []);

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

  const totalGeneratedTtsSec = useMemo(
    () => segments.reduce((acc, seg) => acc + (Number.isFinite(seg.durationSec) ? seg.durationSec : 0), 0),
    [segments]
  );

  const syncSegmentDuration = useCallback((sceneId: number, durationSec: number) => {
    const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
    if (!safeDuration) return;
    setSegments((prev) =>
      prev.map((seg) => (seg.id === sceneId && (!seg.durationSec || seg.durationSec <= 0)
        ? { ...seg, durationSec: safeDuration }
        : seg))
    );
    setScenes((prev) => {
      const next = prev.map((scene) =>
        scene.id === sceneId && (!(scene.durationSec && scene.durationSec > 0))
          ? { ...scene, durationSec: safeDuration, audioDurationSec: safeDuration, duration: safeDuration }
          : scene
      );
      setSceneDurations(next.map((scene) => (scene.durationSec ?? scene.audioDurationSec ?? 0) || 0));
      return next;
    });
  }, [setSceneDurations, setScenes]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    segments.forEach((seg) => {
      if (!seg.audioUrl || (seg.durationSec && seg.durationSec > 0)) return;
      if (durationProbeCacheRef.current[seg.id] === seg.audioUrl) return;
      durationProbeCacheRef.current[seg.id] = seg.audioUrl;

      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = seg.audioUrl;

      const handleLoaded = () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          syncSegmentDuration(seg.id, probe.duration);
        }
      };
      const handleError = () => {
        delete durationProbeCacheRef.current[seg.id];
      };

      probe.addEventListener('loadedmetadata', handleLoaded);
      probe.addEventListener('error', handleError);
      probe.load();

      cleanups.push(() => {
        probe.removeEventListener('loadedmetadata', handleLoaded);
        probe.removeEventListener('error', handleError);
        probe.src = '';
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [segments, syncSegmentDuration]);

  const handleSynthesizeAll = async () => {
    const voice = selectedVoice?.voice ?? 'Jessica';
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
          const previousText = i > 0 ? segments[i - 1]?.text?.trim().replace(/^\(대사 없음\)$/, '') : '';
          const nextText = i < segments.length - 1 ? segments[i + 1]?.text?.trim().replace(/^\(대사 없음\)$/, '') : '';
          const { url, duration_ms } = await studioTts({
            text,
            voice,
            speed: selectedVoice?.speed ?? 1.0,
            language_code: 'ko',
            stability: selectedVoice?.stability ?? 0.45,
            similarity_boost: selectedVoice?.similarityBoost ?? 0.8,
            style: selectedVoice?.style ?? 0.2,
            ...(previousText ? { previous_text: previousText } : {}),
            ...(nextText ? { next_text: nextText } : {}),
          });
          console.log('[WEAV Studio][TTS][fal response]', {
            sceneIndex: i + 1,
            voice,
            text,
            result: { url, duration_ms },
          });
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
      const { url } = await studioTts({
        text: selectedVoice.sample,
        voice: selectedVoice.voice,
        speed: selectedVoice.speed,
        language_code: 'ko',
        stability: selectedVoice.stability,
        similarity_boost: selectedVoice.similarityBoost,
        style: selectedVoice.style,
      });
      playUrl(url);
    } catch {
      /* ignore */
    } finally {
      setSamplePlaying(false);
    }
  };
  const canMoveToVideoStep = segments.length > 0 && segments.every((seg) => !!seg.audioUrl);
  const canSkipToVideoStep = segments.length > 0;
  const moveToVideoDisabledReason = useMemo(() => {
    if (canMoveToVideoStep) return '';
    if (segments.length === 0) {
      return '먼저 Step 5에서 씬을 만들고, 여기서 전체 합성을 진행해야 7 영상 진행하기를 사용할 수 있습니다.';
    }
    return '모든 씬의 음성 합성이 완료되어야 7 영상 진행하기가 활성화됩니다. 먼저 전체 합성을 완료해 주세요.';
  }, [canMoveToVideoStep, segments.length]);
  const skipToVideoDisabledReason = useMemo(() => {
    if (canSkipToVideoStep) return '';
    return '먼저 Step 5에서 씬을 만든 뒤에만 TTS 생성을 건너뛰고 7 영상으로 이동할 수 있습니다.';
  }, [canSkipToVideoStep]);

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
            <span className="ui-label">생성된 음성 확인</span>
            <button
              onClick={handleSynthesizeAll}
              disabled={isSynthesizing || segments.length === 0}
              className="ui-btn ui-btn--primary"
            >
              {isSynthesizing ? <Loader2 size={14} className="animate-spin" /> : <Music4 size={14} />}
              TTS 전체 자동 생성
            </button>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className="ui-card--ghost ui-card--airy text-center text-slate-500">
                Step 5에서 장면을 만든 뒤 여기로 오세요.
              </div>
            ) : (
              segments.map((seg, idx) => (
                <div key={seg.id} className="ui-card flex flex-col gap-3">
                  <div className="flex items-center gap-4">
                  <span className="ui-step__num is-selected">{(idx + 1).toString().padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{seg.text}</p>
                    <p className="text-xs text-slate-500">
                      {seg.durationSec > 0 ? `${formatTtsDuration(seg.durationSec)} (${seg.durationSec.toFixed(1)}초)` : '오디오 길이 확인 중...'} · 씬 {seg.sceneIndex}
                    </p>
                  </div>
                  <span className="ui-pill">{seg.status === 'done' ? '완료' : '대기'}</span>
                  </div>
                  {seg.audioUrl ? (
                    <div className="pl-12">
                      <audio
                        controls
                        preload="none"
                        src={seg.audioUrl}
                        className="w-full"
                        onLoadedMetadata={(event) => {
                          const audioEl = event.currentTarget;
                          if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
                            syncSegmentDuration(seg.id, audioEl.duration);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="pl-12 text-xs text-slate-500">
                      아직 생성된 음성이 없습니다.
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {segments.length > 0 && (
            <div className="ui-card ui-card--muted space-y-2">
              <span className="ui-label">생성된 전체 음성 길이</span>
              <div className="text-lg font-semibold text-foreground">
                {totalGeneratedTtsSec > 0 ? formatTtsDuration(totalGeneratedTtsSec) : '계산 중...'}
              </div>
              <p className="text-xs text-slate-500">
                {totalGeneratedTtsSec > 0
                  ? `총 ${totalGeneratedTtsSec.toFixed(1)}초 분량의 음성이 준비되어 있습니다.`
                  : '생성된 음성 메타데이터를 읽는 중입니다.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
        <button
          type="button"
          onClick={() => setCurrentStep(5)}
          className="ui-btn ui-btn--secondary w-full justify-center"
        >
          <ChevronRight size={16} className="rotate-180" /> 5 비주얼 돌아가기
        </button>
        <DisabledButtonHint
          disabled={!canSkipToVideoStep}
          reason={skipToVideoDisabledReason}
          className="w-full"
        >
          <button
            type="button"
            onClick={() => setCurrentStep(7)}
            disabled={!canSkipToVideoStep}
            className="ui-btn ui-btn--secondary w-full justify-center"
          >
            건너뛰기
          </button>
        </DisabledButtonHint>
        <DisabledButtonHint
          disabled={!canMoveToVideoStep}
          reason={moveToVideoDisabledReason}
          className="w-full"
        >
          <button
            type="button"
            onClick={() => setCurrentStep(7)}
            disabled={!canMoveToVideoStep}
            className="ui-btn ui-btn--primary w-full justify-center"
          >
            7 영상 진행하기 <ChevronRight size={16} />
          </button>
        </DisabledButtonHint>
      </div>
    </div>
  );
};

// --- [Step 7: AI 영상 생성] ---
const VideoStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { sessionId, scenes, videoFormat, subtitlesEnabled, setSubtitlesEnabled, burnInSubtitles, setBurnInSubtitles, exportJob, setExportJob, setCurrentStep } = useGlobal();
  const { taskId, status: jobStatus, error: jobError, resultVideoUrl, resultSrtUrl, resultVttUrl } = exportJob;
  const prevJobStatusRef = useRef<typeof jobStatus>('idle');

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
  const isRenderLocked = jobStatus === 'running' || jobStatus === 'pending';
  const effectiveBurnInSubtitles = false;
  const formatTimelineDuration = useCallback((sec: number) => {
    const safe = Math.max(0, sec || 0);
    const minutes = Math.floor(safe / 60);
    const seconds = Math.round(safe % 60);
    if (minutes <= 0) return `${seconds}초`;
    if (seconds === 0) return `${minutes}분`;
    return `${minutes}분 ${seconds}초`;
  }, []);

  useEffect(() => {
    if (burnInSubtitles) setBurnInSubtitles(false);
  }, [burnInSubtitles, setBurnInSubtitles]);

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
    setExportJob({
      taskId: null,
      status: 'pending',
      error: null,
      resultVideoUrl: null,
      resultSrtUrl: null,
      resultVttUrl: null,
    });
    try {
      const res = await studioExport({
        session_id: sessionId,
        aspect_ratio: (videoFormat === '9:16' ? '9:16' : '16:9'),
        fps: 30,
        subtitles_enabled: subtitlesEnabled,
        burn_in_subtitles: false,
        scenes: readyScenes.map(s => ({
          image_url: scenes.find(x => x.id === s.id)?.imageUrl || '',
          audio_url: scenes.find(x => x.id === s.id)?.audioUrl || '',
          text: s.text || '',
          duration_sec: s.duration,
        })),
      });
      setExportJob({
        taskId: res.task_id,
        status: 'running',
        error: null,
        resultVideoUrl: null,
        resultSrtUrl: null,
        resultVttUrl: null,
      });
      showToast('영상 렌더링을 시작했습니다.');
    } catch (e) {
      setExportJob({
        taskId: null,
        status: 'failure',
        error: e instanceof Error ? e.message : '내보내기 실패',
        resultVideoUrl: null,
        resultSrtUrl: null,
        resultVttUrl: null,
      });
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
      setExportJob(createDefaultExportJobState());
    }
  };

  useEffect(() => {
    const prev = prevJobStatusRef.current;
    if (jobStatus === 'success' && prev !== 'success' && resultVideoUrl) {
      showToast('영상 렌더링이 완료되었습니다.');
    }
    prevJobStatusRef.current = jobStatus;
  }, [jobStatus, resultVideoUrl, showToast]);

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
            <div className="ui-card--muted p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-100">자막</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={subtitlesEnabled}
                  onClick={() => {
                    if (isRenderLocked) return;
                    setSubtitlesEnabled(!subtitlesEnabled);
                  }}
                  disabled={isRenderLocked}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    subtitlesEnabled ? 'bg-primary/80' : 'bg-white/10'
                  } ${isRenderLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${subtitlesEnabled ? 'translate-x-8' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">직접 삽입</span>
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                    현재 미구현
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveBurnInSubtitles}
                  disabled
                  className="relative inline-flex h-7 w-14 cursor-not-allowed items-center rounded-full bg-white/10 opacity-45"
                >
                  <span className="inline-block h-5 w-5 rounded-full bg-white translate-x-1" />
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
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <span className="ui-label">영상 타임라인 미리보기</span>
                <p className="text-sm text-slate-600">
                  현재 준비된 씬 순서와 길이를 한눈에 확인합니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="rounded-full border border-border/70 bg-card/45 px-3 py-1.5 text-xs text-slate-500">
                  전체 길이 <span className="ml-1 font-semibold text-foreground">{formatTimelineDuration(totalDuration)}</span>
                </div>
                <div className="rounded-full border border-border/70 bg-card/45 px-3 py-1.5 text-xs text-slate-500">
                  준비 완료 씬 <span className="ml-1 font-semibold text-foreground">{readyScenes.length}개</span>
                </div>
                <div className="rounded-full border border-border/70 bg-card/45 px-3 py-1.5 text-xs text-slate-500">
                  전체 씬 <span className="ml-1 font-semibold text-foreground">{timeline.length}개</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
              {timeline.map((clip) => (
                <div
                  key={clip.id}
                  className={`rounded-2xl border px-4 py-4 transition-colors ${
                    clip.hasImage && clip.hasAudio
                      ? 'border-primary/25 bg-primary/5'
                      : 'border-border/70 bg-card/35'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      clip.hasImage && clip.hasAudio
                        ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                        : 'border border-white/10 bg-white/5 text-slate-500'
                    }`}>
                      {clip.hasImage && clip.hasAudio ? '준비 완료' : '준비 중'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-foreground">{clip.label}</div>
                    <div className="text-xs text-slate-500">{formatTimelineDuration(clip.duration)}</div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${clip.hasImage ? 'bg-emerald-300' : 'bg-slate-500/50'}`} />
                    이미지
                    <span className={`ml-2 inline-flex h-2.5 w-2.5 rounded-full ${clip.hasAudio ? 'bg-sky-300' : 'bg-slate-500/50'}`} />
                    음성
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="ui-card ui-card--muted text-sm text-slate-600">
            Step 5에서 씬 이미지, Step 6에서 씬 음성을 만든 뒤 이 단계에서 MP4로 렌더링합니다.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
        <button
          type="button"
          onClick={() => setCurrentStep(6)}
          className="ui-btn ui-btn--secondary w-full justify-center"
        >
          <ChevronRight size={16} className="rotate-180" /> 6 음성 돌아가기
        </button>
        <button
          type="button"
          onClick={() => setCurrentStep(8)}
          className="ui-btn ui-btn--primary w-full justify-center"
        >
          8 메타 진행하기 <ChevronRight size={16} />
        </button>
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
    setCurrentStep,
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
          <AutoResizeTextarea
            value={metaDescription}
            onChange={setMetaDescription}
            placeholder="타임라인과 해시태그가 포함된 영상 설명이 생성됩니다"
            className="min-h-[200px] whitespace-pre-wrap"
            collapsible
            collapseThreshold={260}
            collapseTitle="영상 설명"
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
          <AutoResizeTextarea
            value={metaPinnedComment}
            onChange={setMetaPinnedComment}
            placeholder="영상 업로드 후 고정할 댓글 문구가 생성됩니다"
            className="min-h-[120px]"
            collapsible
            collapseThreshold={180}
            collapseTitle="고정댓글"
          />
        </div>

        {!generatedOnce && (
          <div className="ui-card ui-card--muted text-center py-8 text-slate-600">
            <Monitor size={24} className="mx-auto mb-2 opacity-60" />
            <p className="text-sm">오른쪽 상단 <strong>AI로 메타데이터 생성</strong>을 누르면 제목·설명·고정댓글이 한 번에 생성됩니다.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
        <button
          type="button"
          onClick={() => setCurrentStep(7)}
          className="ui-btn ui-btn--secondary w-full justify-center"
        >
          <ChevronRight size={16} className="rotate-180" /> 7 영상 돌아가기
        </button>
        <button
          type="button"
          onClick={() => setCurrentStep(9)}
          className="ui-btn ui-btn--primary w-full justify-center"
        >
          9 썸네일 진행하기 <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
};

// --- [Step 9: 썸네일 연구소] ---
const ThumbnailStep = ({ showToast }: { showToast: (msg: string) => void }) => {
  const { sessionId, thumbnailData, setThumbnailData, setCurrentStep, videoFormat, selectedTopic, finalTopic, thumbnailBenchmarkJob, setThumbnailBenchmarkJob } = useGlobal();
  const thumbnails = thumbnailData.thumbnails || [];
  const ytUrlInput = thumbnailData.ytUrlInput || '';
  const ytThumbnailUrl = thumbnailData.ytThumbnailUrl;
  const [ytThumbnailError, setYtThumbnailError] = useState(false);
  const isBenchmarking = thumbnailBenchmarkJob.status === 'pending' || thumbnailBenchmarkJob.status === 'running';
  const benchmarkSummary = thumbnailBenchmarkJob.resultAnalysisSummary;
  const previousBenchmarkStatusRef = useRef(thumbnailBenchmarkJob.status);
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
    setThumbnailBenchmarkJob({
      taskId: null,
      status: 'pending',
      error: null,
      resultImageUrl: null,
      resultAnalysisSummary: null,
      resultCandidates: [],
    });
    try {
      if (!sessionId) {
        showToast('세션 ID가 없습니다. Studio 프로젝트를 새로 만든 뒤 다시 시도해주세요.');
        setThumbnailBenchmarkJob(createDefaultThumbnailBenchmarkJobState());
        return;
      }
      const started = await studioThumbnailBenchmark({
        session_id: sessionId,
        reference_thumbnail_url: ytThumbnailUrl,
        target_topic: topicForThumbnail,
        aspect_ratio: videoFormat === '9:16' ? '9:16' : '16:9',
        num_candidates: 3,
      });
      setThumbnailBenchmarkJob({
        taskId: started.task_id,
        status: 'pending',
        error: null,
        resultImageUrl: null,
        resultAnalysisSummary: null,
        resultCandidates: [],
      });
      showToast('벤치마킹 작업을 시작했습니다. 다른 스텝으로 이동해도 계속 진행됩니다.');
    } catch (e) {
      setThumbnailBenchmarkJob({
        taskId: null,
        status: 'failure',
        error: e instanceof Error ? e.message : '벤치마킹 생성 실패',
        resultImageUrl: null,
        resultAnalysisSummary: null,
        resultCandidates: [],
      });
      showToast('벤치마킹 생성에 실패했습니다.');
    }
  };

  const selectThumb = (id: string) => {
    setThumbnailData(prev => {
      const base = prev.thumbnails || [];
      return { ...prev, thumbnails: base.map((t: StudioThumbnailCandidate) => ({ ...t, isSelected: t.id === id })) };
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

  useEffect(() => {
    const previous = previousBenchmarkStatusRef.current;
    if (previous !== thumbnailBenchmarkJob.status) {
      if (thumbnailBenchmarkJob.status === 'success') {
        showToast('벤치마킹 썸네일이 생성되었습니다.');
      } else if (thumbnailBenchmarkJob.status === 'failure' && thumbnailBenchmarkJob.error) {
        showToast(thumbnailBenchmarkJob.error);
      }
    }
    previousBenchmarkStatusRef.current = thumbnailBenchmarkJob.status;
  }, [thumbnailBenchmarkJob.status, thumbnailBenchmarkJob.error, showToast]);

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
            {isBenchmarking && (
              <div className="ui-card--muted text-sm text-slate-700 p-3 rounded-xl">
                썸네일 벤치마킹 작업이 백그라운드에서 진행 중입니다. 다른 스텝으로 이동해도 계속 생성됩니다.
              </div>
            )}
            {thumbnailBenchmarkJob.status === 'failure' && thumbnailBenchmarkJob.error && (
              <div className="ui-card--muted text-sm text-destructive p-3 rounded-xl">
                {thumbnailBenchmarkJob.error}
              </div>
            )}
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
          {thumbnails.length > 0 ? thumbnails.map(t => (
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
          )) : (
            <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-border/70 bg-secondary/20 p-8 text-center text-sm text-slate-500">
              썸네일 후보가 아직 없습니다. 벤치마킹을 실행하면 실제 생성된 후보 3개가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </div>

      {setCurrentStep && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
          <button
            type="button"
            onClick={() => setCurrentStep(8)}
            className="ui-btn ui-btn--secondary w-full justify-center"
          >
            <ChevronRight size={16} className="rotate-180" /> 8 메타 돌아가기
          </button>
          <button
            type="button"
            onClick={() => setCurrentStep(10)}
            className="ui-btn ui-btn--primary w-full flex items-center justify-center gap-2"
          >
            10 미리보기 진행하기 <ChevronRight size={18} />
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

  const thumbnails = (thumbnailData?.thumbnails?.length ?? 0) > 0 ? thumbnailData.thumbnails as StudioThumbnailCandidate[] : [];
  const selectedThumb = thumbnails.find((t: StudioThumbnailCandidate) => t.isSelected) ?? thumbnails[0];
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
              &lt; 9 썸네일 돌아가기
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
    sessionId, resetStudioProject,
    currentStep, setCurrentStep, isLoading, loadingMessage, setDescriptionInput, setIsFileLoaded, isDevMode,
    videoFormat, setVideoFormat, scriptStyle, setScriptStyle, planningData, setPlanningData,
    selectedStyle, setSelectedStyle, selectedVoicePresetId, setSelectedVoicePresetId,
    subtitlesEnabled, setSubtitlesEnabled, burnInSubtitles, setBurnInSubtitles,
  } = useGlobal();
  const [toast, setToast] = useState<string | null>(null);
  const [isGlobalDragging, setIsGlobalDragging] = useState(false);
  const [showPresetSaveDialog, setShowPresetSaveDialog] = useState(false);
  const [showProjectResetConfirm, setShowProjectResetConfirm] = useState(false);
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

  const handleProjectReset = () => {
    resetStudioProject();
    setShowProjectResetConfirm(false);
    showToast('현재 WEAV Studio 프로젝트 설정이 초기화되었습니다.');
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

  const mainScrollRef = useRef<HTMLElement | null>(null);

  const scrollStudioViewport = useCallback((position: 'top' | 'bottom') => {
    const behavior: ScrollBehavior = 'smooth';
    const targetTop = position === 'top' ? 0 : Number.MAX_SAFE_INTEGER;
    const targetMain = mainScrollRef.current;
    if (targetMain) {
      targetMain.scrollTo({
        top: position === 'top' ? 0 : targetMain.scrollHeight,
        behavior,
      });
    }
    window.scrollTo({ top: targetTop, behavior });
    document.documentElement?.scrollTo({ top: targetTop, behavior });
    document.body?.scrollTo({ top: targetTop, behavior });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollStudioViewport('top');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentStep, scrollStudioViewport]);

  const scrollToTop = useCallback(() => {
    scrollStudioViewport('top');
  }, [scrollStudioViewport]);

  const scrollToBottom = useCallback(() => {
    scrollStudioViewport('bottom');
  }, [scrollStudioViewport]);

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
      <ConfirmDialog
        open={showProjectResetConfirm}
        title="프로젝트 초기화"
        message="정말 지금 프로젝트 내 1~10 스탭 내용을 초기화할까요? 현재 입력한 기획, 레퍼런스, 비주얼, 메타데이터, 썸네일 정보가 모두 비워집니다."
        confirmLabel="초기화"
        cancelLabel="취소"
        variant="destructive"
        onConfirm={handleProjectReset}
        onCancel={() => setShowProjectResetConfirm(false)}
      />

      {isGlobalDragging && (
        <div className="absolute inset-0 z-[90] bg-background/56 backdrop-blur-sm flex items-center justify-center text-foreground text-sm font-medium">
          파일을 놓아 업로드하세요
        </div>
      )}

      <main ref={mainScrollRef} className="flex-1 flex flex-col min-w-0 overflow-y-auto scrollbar-hide relative bg-transparent">
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
            <div className="step-toolbar mx-auto w-full max-w-[1120px]">
              <div className="step-pillbar flex-1">
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
              <button
                type="button"
                onClick={() => setShowProjectResetConfirm(true)}
                className="step-reset-btn shrink-0"
              >
                <RefreshCcw size={12} /> 초기화
              </button>
            </div>
          </div>
          <div key={currentStep} className="studio-step-shell">
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
        </div>
        <div className="studio-scroll-nav" aria-label="페이지 스크롤 이동">
          <button type="button" onClick={scrollToTop} className="studio-scroll-nav__btn" aria-label="화면 최상단으로 이동">
            <ArrowUp size={16} />
            <span>맨 위로</span>
          </button>
          <button type="button" onClick={scrollToBottom} className="studio-scroll-nav__btn" aria-label="화면 최하단으로 이동">
            <ArrowDown size={16} />
            <span>맨 아래로</span>
          </button>
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
