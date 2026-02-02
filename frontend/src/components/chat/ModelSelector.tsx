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
      className="bg-transparent text-foreground min-h-[52px] py-3 px-3 text-sm min-w-[180px] transition-colors duration-200 focus:outline-none focus:ring-0"
    >
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
