import React from 'react';
import { CHAT_MODELS } from '@/constants/models';
import { IMAGE_MODELS } from '@/constants/models';
import type { SessionKind } from '@/types';

type ModelSelectorProps = {
  kind: SessionKind;
  value: string;
  onChange: (modelId: string) => void;
};

export function ModelSelector({ kind, value, onChange }: ModelSelectorProps) {
  const models = kind === 'chat' ? CHAT_MODELS : IMAGE_MODELS;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-input text-foreground border border-input rounded px-3 py-2 text-sm min-w-[180px] transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
