#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'output' / 'localbanana_prompts.jsonl'
TARGET_INDEX = ROOT / 'frontend' / 'public' / 'data' / 'localbanana_prompt_index.json'
TARGET_BLOCKS = ROOT / 'frontend' / 'public' / 'data' / 'localbanana_prompt_blocks.json'

STYLE_TERMS = (
    'style', 'aesthetic', 'editorial', 'cinematic', 'vibe', 'film', 'vintage', 'glossy',
    'render', 'illustration', 'poster', 'fashion', 'photorealistic', 'photography'
)
COMPOSITION_TERMS = (
    'shot', 'portrait', 'framing', 'close-up', 'close up', 'wide shot', 'waist-up',
    'waist up', 'full body', 'full-body', '50mm', '35mm', '85mm', 'depth of field',
    'camera', 'angle', 'focal length', 'centered'
)
ENVIRONMENT_TERMS = (
    'background', 'environment', 'setting', 'scene', 'room', 'studio', 'street',
    'alley', 'forest', 'city', 'indoor', 'outdoor', 'kitchen', 'bedroom', 'neon'
)
LIGHTING_TERMS = (
    'lighting', 'light', 'shadow', 'glow', 'highlight', 'flash', 'sunlight',
    'golden hour', 'moody', 'warm', 'soft light', 'rim light'
)


def collapse_text(value):
    if value is None:
      return ''
    if isinstance(value, str):
        return ' '.join(value.replace('\r', ' ').replace('\n', ' ').split())
    if isinstance(value, list):
        return ' '.join(filter(None, (collapse_text(item) for item in value)))
    if isinstance(value, dict):
        return ' '.join(filter(None, (collapse_text(item) for item in value.values())))
    return str(value)


def first_text(obj, patterns):
    if isinstance(obj, dict):
        collected = []
        for key, value in obj.items():
            lowered = key.lower()
            if any(pattern in lowered for pattern in patterns):
                text = collapse_text(value)
                if text:
                    collected.append(text)
            nested = first_text(value, patterns)
            if nested:
                collected.extend(nested if isinstance(nested, list) else [nested])
        return collected
    if isinstance(obj, list):
        collected = []
        for item in obj:
            nested = first_text(item, patterns)
            if nested:
                collected.extend(nested if isinstance(nested, list) else [nested])
        return collected
    return []


def extract_sentences(text):
    if not text:
        return []
    normalized = text.replace('\n', ' ')
    parts = re.split(r'(?<=[.!?])\s+|,\s+', normalized)
    return [' '.join(part.split()) for part in parts if part.strip()]


def pick_sentence(text, terms):
    for sentence in extract_sentences(text):
        lowered = sentence.lower()
        if any(term in lowered for term in terms):
            return sentence
    return ''


def parse_prompt(prompt):
    prompt = (prompt or '').strip()
    parsed = None
    if prompt.startswith('{'):
        try:
            parsed = json.loads(prompt)
        except Exception:
            parsed = None

    style = composition = environment = lighting = negative = subject = ''
    if isinstance(parsed, dict):
        subject = collapse_text(first_text(parsed, ('subject', 'description', 'character_reference', 'prompt')))
        style = collapse_text(first_text(parsed, ('style', 'aesthetic', 'film_simulation', 'color_palette', 'photography')))
        composition = collapse_text(first_text(parsed, ('composition', 'framing', 'camera', 'shot', 'focal_length', 'pose')))
        environment = collapse_text(first_text(parsed, ('environment', 'background', 'setting', 'scene', 'atmosphere')))
        lighting = collapse_text(first_text(parsed, ('lighting', 'light', 'shadow', 'glow')))
        negative = collapse_text(first_text(parsed, ('negative_prompt', 'negative')))

    flat = collapse_text(parsed) if parsed is not None else prompt
    subject = subject or pick_sentence(flat, ('subject', 'portrait', 'person', 'character', 'product', 'model'))
    style = style or pick_sentence(flat, STYLE_TERMS)
    composition = composition or pick_sentence(flat, COMPOSITION_TERMS)
    environment = environment or pick_sentence(flat, ENVIRONMENT_TERMS)
    lighting = lighting or pick_sentence(flat, LIGHTING_TERMS)
    if not negative:
        negative_match = re.search(r'(negative prompt\s*:\s*.+)$', flat, re.I)
        negative = negative_match.group(1) if negative_match else ''

    return {
        'subject': subject[:400],
        'style': style[:400],
        'composition': composition[:400],
        'environment': environment[:400],
        'lighting': lighting[:400],
        'negative': negative[:400],
        'search_text': flat[:2200],
    }


def build_blocks(rows):
    fields = ('subject', 'style', 'composition', 'environment', 'lighting', 'negative')
    dedupe = {field: set() for field in fields}
    blocks = {field: [] for field in fields}
    for row in rows:
        for field in fields:
            text = (row.get(field) or '').strip()
            normalized = ' '.join(text.lower().split())
            if not normalized or normalized in dedupe[field]:
                continue
            dedupe[field].add(normalized)
            blocks[field].append({
                'text': text,
                'title': row.get('title') or '',
                'url': row.get('url') or '',
                'keywords': row.get('keywords') or [],
            })
    return blocks


def main():
    rows = []
    with SOURCE.open('r', encoding='utf-8') as fh:
        for line in fh:
            row = json.loads(line)
            parsed = parse_prompt(row.get('prompt') or '')
            rows.append({
                'title': row.get('title') or '',
                'url': row.get('url') or '',
                'keywords': row.get('keywords') or [],
                'subject': parsed['subject'],
                'style': parsed['style'],
                'composition': parsed['composition'],
                'environment': parsed['environment'],
                'lighting': parsed['lighting'],
                'negative': parsed['negative'],
                'search_text': parsed['search_text'],
            })

    blocks = build_blocks(rows)

    TARGET_INDEX.parent.mkdir(parents=True, exist_ok=True)
    TARGET_INDEX.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    TARGET_BLOCKS.write_text(json.dumps(blocks, ensure_ascii=False), encoding='utf-8')
    print(f'Wrote {len(rows)} entries to {TARGET_INDEX}')
    print(f'Wrote block library to {TARGET_BLOCKS}')


if __name__ == '__main__':
    main()
