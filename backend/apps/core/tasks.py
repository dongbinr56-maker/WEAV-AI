import os
import re
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from typing import Any, Iterable, Optional

import requests
from celery import shared_task

from apps.chats.models import Job
from storage.s3 import minio_client


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "").strip() or f"Command failed: {' '.join(cmd)}")


def _download_to(url: str, out_path: str, timeout: int = 60) -> None:
    r = requests.get(
        url,
        stream=True,
        timeout=timeout,
        headers={
            "User-Agent": "WEAV-Studio-Export/1.0 (+https://weav.ai; contact: dev@weav.ai)",
            "Accept": "*/*",
        },
    )
    r.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)


def _probe_duration_seconds(audio_path: str) -> float:
    # Uses ffprobe (bundled with ffmpeg).
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audio_path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "").strip() or "ffprobe failed")
    try:
        return max(0.0, float((proc.stdout or "").strip()))
    except Exception:
        raise RuntimeError("Failed to parse ffprobe duration")


def _fmt_srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    if ms < 0:
        ms = 0
    h = ms // 3_600_000
    ms -= h * 3_600_000
    m = ms // 60_000
    ms -= m * 60_000
    s = ms // 1000
    ms -= s * 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _fmt_vtt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    if ms < 0:
        ms = 0
    h = ms // 3_600_000
    ms -= h * 3_600_000
    m = ms // 60_000
    ms -= m * 60_000
    s = ms // 1000
    ms -= s * 1000
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _chunk_caption_text(text: str, max_chars: int = 34) -> list[str]:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if not cleaned:
        return []
    parts: list[str] = []
    while cleaned:
        if len(cleaned) <= max_chars:
            parts.append(cleaned)
            break
        cut = cleaned.rfind(" ", 0, max_chars + 1)
        if cut == -1:
            cut = max_chars
        parts.append(cleaned[:cut].strip())
        cleaned = cleaned[cut:].strip()
    return [p for p in parts if p]


@dataclass(frozen=True)
class CaptionCue:
    start: float
    end: float
    text: str


def _build_captions_from_scenes(
    scenes: list[dict[str, Any]],
    min_cue_sec: float = 0.8,
) -> list[CaptionCue]:
    cues: list[CaptionCue] = []
    t = 0.0
    for scene in scenes:
        dur = float(scene.get("duration_sec") or 0.0)
        txt = (scene.get("text") or "").strip()
        if dur <= 0:
            continue
        if not txt:
            t += dur
            continue

        chunks = _chunk_caption_text(txt)
        if not chunks:
            t += dur
            continue

        # Evenly distribute cue times across scene duration.
        per = max(min_cue_sec, dur / len(chunks))
        start = t
        for i, chunk in enumerate(chunks):
            end = min(t + dur, start + per)
            # Ensure last cue ends at scene end.
            if i == len(chunks) - 1:
                end = t + dur
            if end - start >= 0.2:
                cues.append(CaptionCue(start=start, end=end, text=chunk))
            start = end
        t += dur
    return cues


def _render_srt(cues: Iterable[CaptionCue]) -> str:
    lines: list[str] = []
    for i, cue in enumerate(cues, start=1):
        lines.append(str(i))
        lines.append(f"{_fmt_srt_time(cue.start)} --> {_fmt_srt_time(cue.end)}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _render_vtt(cues: Iterable[CaptionCue]) -> str:
    lines: list[str] = ["WEBVTT", ""]
    for cue in cues:
        lines.append(f"{_fmt_vtt_time(cue.start)} --> {_fmt_vtt_time(cue.end)}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _target_resolution(aspect_ratio: str) -> tuple[int, int]:
    if aspect_ratio == "9:16":
        return (1080, 1920)
    return (1920, 1080)


@shared_task(bind=True, max_retries=1)
def task_studio_export(
    self,
    job_id: int,
    *,
    aspect_ratio: str,
    scenes: list[dict[str, Any]],
    subtitles_enabled: bool = True,
    burn_in_subtitles: bool = False,
    fps: int = 30,
) -> dict[str, Any]:
    job = Job.objects.get(pk=job_id)
    job.status = "running"
    job.save(update_fields=["status", "updated_at"])

    tmpdir = tempfile.mkdtemp(prefix="studio_export_")
    try:
        width, height = _target_resolution(aspect_ratio)
        segment_paths: list[str] = []
        normalized_scenes: list[dict[str, Any]] = []

        # Download and render segments
        for idx, scene in enumerate(scenes or []):
            image_url = (scene.get("image_url") or "").strip()
            audio_url = (scene.get("audio_url") or "").strip()
            text = (scene.get("text") or "").strip()
            if not image_url or not audio_url:
                continue

            img_path = os.path.join(tmpdir, f"img_{idx:03d}.jpg")
            aud_path = os.path.join(tmpdir, f"aud_{idx:03d}.mp3")
            _download_to(image_url, img_path)
            _download_to(audio_url, aud_path)

            dur = scene.get("duration_sec")
            try:
                dur_f = float(dur) if dur is not None else 0.0
            except Exception:
                dur_f = 0.0
            if dur_f <= 0:
                dur_f = _probe_duration_seconds(aud_path)
            dur_f = max(0.2, dur_f)

            seg_path = os.path.join(tmpdir, f"seg_{idx:03d}.mp4")
            vf = (
                f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
                "format=yuv420p"
            )
            _run(
                [
                    "ffmpeg",
                    "-y",
                    "-loop",
                    "1",
                    "-i",
                    img_path,
                    "-i",
                    aud_path,
                    "-t",
                    f"{dur_f:.3f}",
                    "-r",
                    str(int(fps)),
                    "-vf",
                    vf,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    seg_path,
                ]
            )
            segment_paths.append(seg_path)
            normalized_scenes.append({"duration_sec": dur_f, "text": text})

        if not segment_paths:
            raise RuntimeError("No valid scenes to export (need image_url + audio_url).")

        concat_list = os.path.join(tmpdir, "concat.txt")
        with open(concat_list, "w", encoding="utf-8") as f:
            for p in segment_paths:
                f.write(f"file '{p}'\n")

        out_path = os.path.join(tmpdir, "output.mp4")
        _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", out_path])

        cues = _build_captions_from_scenes(normalized_scenes) if subtitles_enabled else []
        srt_text = _render_srt(cues) if cues else ""
        vtt_text = _render_vtt(cues) if cues else ""

        srt_path = os.path.join(tmpdir, "captions.srt")
        vtt_path = os.path.join(tmpdir, "captions.vtt")
        if srt_text:
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write(srt_text)
        if vtt_text:
            with open(vtt_path, "w", encoding="utf-8") as f:
                f.write(vtt_text)

        final_path = out_path
        if burn_in_subtitles and srt_text:
            burned = os.path.join(tmpdir, "output_burned.mp4")
            _run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    out_path,
                    "-vf",
                    f"subtitles={srt_path}",
                    "-c:a",
                    "copy",
                    "-movflags",
                    "+faststart",
                    burned,
                ]
            )
            final_path = burned

        export_id = uuid.uuid4().hex
        base_key = f"studio_exports/{job.session_id}/{export_id}"
        with open(final_path, "rb") as f:
            video_url = minio_client.upload_file(f, f"{base_key}.mp4", content_type="video/mp4")

        srt_url = None
        vtt_url = None
        if srt_text:
            with open(srt_path, "rb") as f:
                srt_url = minio_client.upload_file(f, f"{base_key}.srt", content_type="text/plain; charset=utf-8")
        if vtt_text:
            with open(vtt_path, "rb") as f:
                vtt_url = minio_client.upload_file(f, f"{base_key}.vtt", content_type="text/vtt; charset=utf-8")

        job.status = "success"
        job.error_message = ""
        job.result = {
            "video_url": video_url,
            "captions": {
                "srt_url": srt_url,
                "vtt_url": vtt_url,
                "burn_in": bool(burn_in_subtitles),
                "enabled": bool(subtitles_enabled),
            },
            "meta": {
                "aspect_ratio": aspect_ratio,
                "fps": int(fps),
                "resolution": {"width": width, "height": height},
                "scene_count": len(segment_paths),
            },
        }
        job.save(update_fields=["status", "error_message", "result", "updated_at"])
        return job.result
    except Exception as e:
        job.status = "failure"
        job.error_message = str(e)
        job.result = {}
        job.save(update_fields=["status", "error_message", "result", "updated_at"])
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@shared_task(bind=True, max_retries=1)
def task_studio_thumbnail_benchmark(
    self,
    job_id: int,
    *,
    reference_thumbnail_url: str,
    target_topic: str,
    aspect_ratio: str = "16:9",
) -> dict[str, Any]:
    job = Job.objects.get(pk=job_id)
    job.status = "running"
    job.save(update_fields=["status", "updated_at"])

    try:
        from apps.ai.fal_client import image_generation_fal
        from .views import _gemini_generate_text

        normalized_topic = (target_topic or "").strip()
        analysis_summary = "레퍼런스 썸네일의 구도·색감·타이포 톤을 분석해 동일한 분위기의 벤치마킹 이미지를 생성했습니다."

        try:
            analysis_summary = _gemini_generate_text(
                prompt="\n".join(
                    [
                        f"Analyze this thumbnail URL style: {reference_thumbnail_url}.",
                        f"The new thumbnail topic is: {normalized_topic}." if normalized_topic else "",
                        "One sentence summary in Korean focused on composition, color, packaging, and click trigger.",
                    ]
                ),
                system_prompt=" ".join(
                    [
                        "Persona:",
                        "You are a senior YouTube thumbnail analyst and creative director.",
                        "Domain: thumbnail composition, color, typography, and high-CTR visual patterns.",
                        "Analyze a thumbnail and write one short sentence summarizing its style (composition, color, typography).",
                        "Reply with plain text only in Korean.",
                    ]
                ),
                model="google/gemini-2.5-flash",
                google_search=False,
            ) or analysis_summary
        except Exception:
            pass

        image_prompt = " ".join(
            [
                "Create a NEW YouTube thumbnail by benchmarking the provided reference thumbnail image.",
                f"The new thumbnail must be about this topic: {normalized_topic}." if normalized_topic else "Create a strong, clickable benchmarked thumbnail.",
                f"Thumbnail benchmark summary: {analysis_summary}.",
                "Use the reference thumbnail only as a packaging benchmark for composition, crop, color energy, focal hierarchy, emotional intensity, and click-through structure.",
                "Preserve the benchmark mood and packaging energy, but rebuild the subject matter for the new topic.",
                "Do NOT copy the original thumbnail literally.",
                "Do NOT keep the original subject, original face, original text, original logo, or original branding unless it naturally matches the requested topic.",
                "Keep one dominant focal subject or symbol, a simplified composition, and aggressive thumbnail readability.",
                f"Final output must be composed for a {aspect_ratio} thumbnail canvas.",
                "Create only one final thumbnail image. No collage, no split layout, no storyboard, no grid, no multiple panels.",
                "Avoid text, watermark, logo, interface chrome, and guide marks unless the topic absolutely requires title typography.",
            ]
        )
        images = image_generation_fal(
            image_prompt,
            model="fal-ai/nano-banana-2/edit",
            aspect_ratio=aspect_ratio if aspect_ratio in ("9:16", "16:9") else "16:9",
            num_images=1,
            reference_image_url=reference_thumbnail_url,
            image_urls=[reference_thumbnail_url],
            resolution="4K",
            output_format="png",
            limit_generations=True,
        )
        image_url = (images or [{}])[0].get("url")
        if not image_url:
            raise RuntimeError("benchmark thumbnail image missing")

        job.status = "success"
        job.error_message = ""
        job.result = {
            "image_url": image_url,
            "analysis_summary": analysis_summary,
            "meta": {
                "aspect_ratio": aspect_ratio,
                "target_topic": normalized_topic,
                "reference_thumbnail_url": reference_thumbnail_url,
            },
        }
        job.save(update_fields=["status", "error_message", "result", "updated_at"])
        return job.result
    except Exception as e:
        job.status = "failure"
        job.error_message = str(e)
        job.result = {}
        job.save(update_fields=["status", "error_message", "result", "updated_at"])
        raise
