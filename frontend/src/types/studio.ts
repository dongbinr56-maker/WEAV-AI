import React from 'react';

export interface StudioScene {
  id: number;
  imageUrl: string;
  narrative: string;
  duration: number;
  cameraWork: string;
  aiPrompt: string;
  isPromptVisible: boolean;
  isSyncing: boolean;
  isGenerating?: boolean;
}

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

export interface StudioGlobalContextType {
  currentStep: number;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  activeTags: string[];
  setActiveTags: React.Dispatch<React.SetStateAction<string[]>>;
  urlInput: string;
  setUrlInput: React.Dispatch<React.SetStateAction<string>>;
  urlAnalysisData: any;
  setUrlAnalysisData: React.Dispatch<React.SetStateAction<any>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isDevMode: boolean;
  setIsDevMode: React.Dispatch<React.SetStateAction<boolean>>;
  videoFormat: string;
  setVideoFormat: React.Dispatch<React.SetStateAction<string>>;
  analysisResult: StudioAnalysisResult;
  setAnalysisResult: React.Dispatch<React.SetStateAction<StudioAnalysisResult>>;
  inputMode: 'tag' | 'description';
  setInputMode: React.Dispatch<React.SetStateAction<'tag' | 'description'>>;
  descriptionInput: string;
  setDescriptionInput: React.Dispatch<React.SetStateAction<string>>;
  scenes: StudioScene[];
  setScenes: React.Dispatch<React.SetStateAction<StudioScene[]>>;
  scriptSegments: StudioScriptSegment[];
  setScriptSegments: React.Dispatch<React.SetStateAction<StudioScriptSegment[]>>;

  generatedTopics: string[];
  setGeneratedTopics: React.Dispatch<React.SetStateAction<string[]>>;
  selectedTopic: string;
  setSelectedTopic: React.Dispatch<React.SetStateAction<string>>;
  referenceScript: string;
  setReferenceScript: React.Dispatch<React.SetStateAction<string>>;
  
  scriptStyle: string;
  setScriptStyle: React.Dispatch<React.SetStateAction<string>>;

  scriptLength: string;
  setScriptLength: React.Dispatch<React.SetStateAction<string>>;
  planningData: StudioScriptPlanningData;
  setPlanningData: React.Dispatch<React.SetStateAction<StudioScriptPlanningData>>;

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
}
