import React from 'react';

export interface StudioScene {
  id: number;
  imageUrl: string;
  narrative: string;
  duration: number;
  cameraWork: string;
  aiPrompt: string;
  aiPromptKo?: string;
  isPromptVisible: boolean;
  isSyncing: boolean;
  isGenerating?: boolean;
  /** 씬 추가 버튼으로 추가된 씬만 true (대본 분할로 생성된 씬은 false/미설정) */
  isManualAdd?: boolean;
  /** Step 6 음성 합성 후 저장된 오디오 URL */
  audioUrl?: string;
  /** Step 6 음성 합성 후 저장된 재생 길이(초) */
  durationSec?: number;
  /** @deprecated durationSec를 사용하세요. */
  audioDurationSec?: number;
}

export type StudioReferenceMode = 'USE_EXISTING_REFERENCE' | 'GENERATE_NEW' | 'RESTYLE_REFERENCE';
export type StudioReferenceView = 'front' | 'side_right' | 'back' | 'three_quarter_front';

export type StudioReferencePalette = { primary: string; secondary: string; accent: string };

export type StudioReferenceMetadata = {
  generated_mode?: StudioReferenceMode;
  nickname: string;
  style_tags: string[];
  age_group: string;
  gender: string;
  height_cm: number | null;
  palette: StudioReferencePalette;
  constraints: { must_not_have: string[] };
  allowed_variations: {
    must_keep: Array<'face' | 'hair' | 'outfit' | 'colors' | 'body_type' | 'accessories'>;
    may_change: Array<'outfit' | 'colors' | 'hairstyle' | 'accessories' | 'material' | 'mood'>;
  };
  generated_assets: {
    source_image_url?: string;
    base_front_url?: string;
    base_front_cutout_url?: string;
    turnaround_urls?: Partial<Record<StudioReferenceView, string>>;
    turnaround_cutout_urls?: Partial<Record<StudioReferenceView, string>>;
    grid_source_url?: string;
    grid_cutout_urls?: string[];
  };
};

export type StudioReferenceState = {
  mode: StudioReferenceMode;
  nickname: string;
  style_target: string;
  style_preset_id: string;
  style_option_ids: string[];
  custom_style_keywords: string[];
  age_group: string;
  gender: string;
  height_cm: number | null;
  must_keep: StudioReferenceMetadata['allowed_variations']['must_keep'];
  may_change: StudioReferenceMetadata['allowed_variations']['may_change'];
  palette: StudioReferencePalette;
  constraints: { must_not_have: string[] };
  metadata: StudioReferenceMetadata | null;
};

export interface StudioScriptSegment {
  id: number;
  sceneId: number;
  speaker: string;
  text: string;
  mood: string;
  speed: number;
}

export interface StudioAnalysisResult {
  niche: string[];
  trending: string[];
  confidence: string | number;
  error: string | null;
  isAnalyzing: boolean;
  isUrlAnalyzing: boolean;
}

export interface StudioScriptPlanningData {
  contentType: string;
  summary: string;
  opening: string;
  body: string;
  climax: string;
  outro: string;
  targetDuration: string;
}

export interface StudioTopicSuggestion {
  title: string;
  reason: string;
}

export interface StudioVisualReferenceAsset {
  id: string;
  url: string;
  name: string;
}

export type StudioTopicGenerationBasis = 'idea-only' | 'benchmark-only' | 'idea-plus-benchmark';

export interface StudioExportJobState {
  taskId: string | null;
  status: 'idle' | 'pending' | 'running' | 'success' | 'failure';
  error: string | null;
  resultVideoUrl: string | null;
  resultSrtUrl: string | null;
  resultVttUrl: string | null;
}

export interface StudioThumbnailCandidate {
  id: string;
  title: string;
  imagePlaceholder?: string;
  imageUrl?: string;
  ctrHint: string;
  isSelected: boolean;
}

export interface StudioThumbnailBenchmarkJobState {
  taskId: string | null;
  status: 'idle' | 'pending' | 'running' | 'success' | 'failure';
  error: string | null;
  resultImageUrl: string | null;
  resultAnalysisSummary: string | null;
  resultCandidates: StudioThumbnailCandidate[];
}

export interface StudioGlobalContextType {
  sessionId?: number;
  resetStudioProject: () => void;
  currentStep: number;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  activeTags: string[];
  setActiveTags: React.Dispatch<React.SetStateAction<string[]>>;
  urlInput: string;
  setUrlInput: React.Dispatch<React.SetStateAction<string>>;
  urlAnalysisData: any;
  setUrlAnalysisData: React.Dispatch<React.SetStateAction<any>>;
  selectedBenchmarkPatterns: string[];
  setSelectedBenchmarkPatterns: React.Dispatch<React.SetStateAction<string[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loadingMessage: string | null;
  setLoadingMessage: React.Dispatch<React.SetStateAction<string | null>>;
  isDevMode: boolean;
  videoFormat: string;
  setVideoFormat: React.Dispatch<React.SetStateAction<string>>;
  analysisResult: StudioAnalysisResult;
  setAnalysisResult: React.Dispatch<React.SetStateAction<StudioAnalysisResult>>;
  inputMode: 'tag' | 'description';
  setInputMode: React.Dispatch<React.SetStateAction<'tag' | 'description'>>;
  descriptionInput: string;
  setDescriptionInput: React.Dispatch<React.SetStateAction<string>>;
  topicGenerationBasis: StudioTopicGenerationBasis | null;
  setTopicGenerationBasis: React.Dispatch<React.SetStateAction<StudioTopicGenerationBasis | null>>;
  scenes: StudioScene[];
  setScenes: React.Dispatch<React.SetStateAction<StudioScene[]>>;
  /** Step 6 음성 합성 후 씬별 재생 길이(초). Step 7 영상 생성 시 이 값을 우선 사용. */
  sceneDurations: number[];
  setSceneDurations: React.Dispatch<React.SetStateAction<number[]>>;
  scriptSegments: StudioScriptSegment[];
  setScriptSegments: React.Dispatch<React.SetStateAction<StudioScriptSegment[]>>;

  generatedTopics: StudioTopicSuggestion[];
  setGeneratedTopics: React.Dispatch<React.SetStateAction<StudioTopicSuggestion[]>>;
  selectedTopic: string;
  setSelectedTopic: React.Dispatch<React.SetStateAction<string>>;
  finalTopic: string;
  setFinalTopic: React.Dispatch<React.SetStateAction<string>>;
  referenceScript: string;
  setReferenceScript: React.Dispatch<React.SetStateAction<string>>;
  
  scriptStyle: string;
  setScriptStyle: React.Dispatch<React.SetStateAction<string>>;
  customScriptStyleText: string;
  setCustomScriptStyleText: React.Dispatch<React.SetStateAction<string>>;

  scriptLength: string;
  setScriptLength: React.Dispatch<React.SetStateAction<string>>;
  planningData: StudioScriptPlanningData;
  setPlanningData: React.Dispatch<React.SetStateAction<StudioScriptPlanningData>>;
  masterPlan: string;
  setMasterPlan: React.Dispatch<React.SetStateAction<string>>;

  isFileLoaded: boolean;
  setIsFileLoaded: React.Dispatch<React.SetStateAction<boolean>>;

  masterScript: string;
  setMasterScript: React.Dispatch<React.SetStateAction<string>>;
  selectedStyle: string;
  setSelectedStyle: React.Dispatch<React.SetStateAction<string>>;

  // 추가 필드
  referenceImage: string;
  setReferenceImage: React.Dispatch<React.SetStateAction<string>>;
  analyzedStylePrompt: string;
  setAnalyzedStylePrompt: React.Dispatch<React.SetStateAction<string>>;
  analyzedStylePromptKo: string;
  setAnalyzedStylePromptKo: React.Dispatch<React.SetStateAction<string>>;

  // Studio export / presets
  selectedVoicePresetId: string;
  setSelectedVoicePresetId: React.Dispatch<React.SetStateAction<string>>;
  subtitlesEnabled: boolean;
  setSubtitlesEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  burnInSubtitles: boolean;
  setBurnInSubtitles: React.Dispatch<React.SetStateAction<boolean>>;
  referenceImageUrl: string;
  setReferenceImageUrl: React.Dispatch<React.SetStateAction<string>>;
  visualReferenceAssets: StudioVisualReferenceAsset[];
  setVisualReferenceAssets: React.Dispatch<React.SetStateAction<StudioVisualReferenceAsset[]>>;
  useVisualReferencesInSceneGeneration: boolean;
  setUseVisualReferencesInSceneGeneration: React.Dispatch<React.SetStateAction<boolean>>;

  // Step 4 레퍼런스 오케스트레이션 상태
  referenceState: StudioReferenceState;
  setReferenceState: React.Dispatch<React.SetStateAction<StudioReferenceState>>;

  // Step 8 메타데이터
  metaTitle: string;
  setMetaTitle: React.Dispatch<React.SetStateAction<string>>;
  metaDescription: string;
  setMetaDescription: React.Dispatch<React.SetStateAction<string>>;
  metaPinnedComment: string;
  setMetaPinnedComment: React.Dispatch<React.SetStateAction<string>>;

  /** Step 7에서 생성된 영상 URL. 새로고침 후에도 유지. */
  videoUrl: string | null;
  setVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
  exportJob: StudioExportJobState;
  setExportJob: React.Dispatch<React.SetStateAction<StudioExportJobState>>;
  thumbnailBenchmarkJob: StudioThumbnailBenchmarkJobState;
  setThumbnailBenchmarkJob: React.Dispatch<React.SetStateAction<StudioThumbnailBenchmarkJobState>>;

  // Step 9 썸네일
  thumbnailData: {
    thumbnails: StudioThumbnailCandidate[];
    ytUrlInput: string;
    ytThumbnailUrl: string | null;
  };
  setThumbnailData: React.Dispatch<React.SetStateAction<{
    thumbnails: StudioThumbnailCandidate[];
    ytUrlInput: string;
    ytThumbnailUrl: string | null;
  }>>;
}
