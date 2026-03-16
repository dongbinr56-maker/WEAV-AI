import {
  IMAGE_MODEL_ID_FLUX,
  IMAGE_MODEL_ID_IMAGEN4,
  IMAGE_MODEL_ID_NANO_BANANA,
  IMAGE_MODEL_ID_NANO_BANANA_2,
  IMAGE_MODELS,
} from '@/constants/models';

export type ImageModelGuide = {
  modelName: string;
  capabilities: string[];
  limitations: string[];
  tips: string[];
  toast: string;
};

const IMAGE_MODEL_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  IMAGE_MODELS.map((m) => [m.id, m.name])
) as Record<string, string>;

export function getImageModelGuide(modelId: string, options?: { hasReference?: boolean }): ImageModelGuide {
  const hasReference = options?.hasReference ?? false;
  const modelName = IMAGE_MODEL_NAME_BY_ID[modelId] ?? '이미지 모델';

  if (modelId === IMAGE_MODEL_ID_NANO_BANANA) {
    const maxAttach = hasReference ? 1 : 2;
    return {
      modelName,
      capabilities: [
        '참조 이미지 기반 편집 지원',
        `이미지 첨부 최대 ${maxAttach}개`,
        '텍스트만 입력 시 Gemini 3 Pro TTI 경로 사용',
      ],
      limitations: [
        '참조 + 첨부 이미지는 합산 최대 2개',
        '세부 편집 요청은 프롬프트를 명확히 작성해야 안정적',
      ],
      tips: [
        '인물/제품 합성, 스타일 유지 편집에 적합',
        '구도 고정을 원하면 참조 이미지를 먼저 지정하세요.',
      ],
      toast: 'Nano Banana: 참조 편집 지원, 첨부는 최대 2개(참조 사용 시 1개)입니다.',
    };
  }

  if (modelId === IMAGE_MODEL_ID_NANO_BANANA_2) {
    return {
      modelName,
      capabilities: [
        '참조 이미지 기반 편집 지원',
        '텍스트 전용 이미지 생성(TTI)',
        '빠른 콘셉트 시안과 범용 비율 생성',
      ],
      limitations: [
        '현재 채팅 UI 기준 첨부 이미지는 미지원',
        '참조 기반 재생성 중심으로 사용하는 것이 안정적',
      ],
      tips: [
        '장면, 주제, 조명, 재질을 분리해서 구체적으로 쓰면 안정적입니다.',
        '참조 기반 편집이 필요하면 Nano Banana 2 또는 Nano Banana Pro를 사용하세요.',
      ],
      toast: 'Nano Banana 2: 참조 이미지 기반 재생성과 텍스트 생성이 가능합니다.',
    };
  }

  if (modelId === IMAGE_MODEL_ID_IMAGEN4 || modelId === IMAGE_MODEL_ID_FLUX) {
    return {
      modelName,
      capabilities: [
        '텍스트 전용 이미지 생성(TTI)',
      ],
      limitations: [
        '참조 이미지 미지원',
        '첨부 이미지 미지원',
      ],
      tips: [
        '이미지 입력이 필요한 작업은 Nano Banana로 전환하세요.',
      ],
      toast: `${modelName}: 텍스트 전용 모델입니다. 이미지 첨부/참조는 지원하지 않습니다.`,
    };
  }

  return {
    modelName,
    capabilities: ['기본 이미지 생성'],
    limitations: ['세부 제약 정보가 등록되지 않은 모델입니다.'],
    tips: ['필요 시 다른 모델로 전환해 제약을 비교하세요.'],
    toast: `${modelName}으로 전환되었습니다.`,
  };
}
