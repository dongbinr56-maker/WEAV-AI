#!/usr/bin/env python3
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[2]
DOCS_DIR = ROOT / "00_docs"
INPUT_MD = DOCS_DIR / "Learn_About_This_Project_E2E.md"
OUTPUT_PDF = DOCS_DIR / "Learn_About_This_Project_E2E.pdf"


def _escape_para(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _find_korean_font_path() -> Optional[Path]:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf"),
        Path("/System/Library/Fonts/Supplemental/AppleMyungjo.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
    ]
    for p in candidates:
        if p.exists() and p.is_file():
            return p
    return None


def _register_fonts() -> Tuple[str, str]:
    """
    Returns (body_font_name, mono_font_name).
    """
    mono = "Courier"
    font_path = _find_korean_font_path()
    if not font_path:
        # Fallback: Helvetica may render Korean poorly/missing on some systems.
        return "Helvetica", mono
    body = "WEAVBody"
    pdfmetrics.registerFont(TTFont(body, str(font_path)))
    return body, mono


@dataclass
class MdBlock:
    kind: str
    level: int = 0
    text: str = ""
    items: Optional[List[str]] = None
    ordered: bool = False


_RE_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_RE_OLI = re.compile(r"^\s*(\d+)\.\s+(.*)$")


def parse_markdown(md: str) -> List[MdBlock]:
    lines = md.splitlines()
    blocks: List[MdBlock] = []
    i = 0

    def flush_paragraph(buf: List[str]):
        if not buf:
            return
        text = " ".join(s.strip() for s in buf if s.strip())
        if text:
            blocks.append(MdBlock(kind="p", text=text))
        buf.clear()

    paragraph_buf: List[str] = []

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip("\n")

        if line.strip() == "":
            flush_paragraph(paragraph_buf)
            i += 1
            continue

        if line.strip() in ("[[PAGEBREAK]]", "<!-- pagebreak -->"):
            flush_paragraph(paragraph_buf)
            blocks.append(MdBlock(kind="pagebreak"))
            i += 1
            continue

        if line.strip() == "---":
            flush_paragraph(paragraph_buf)
            blocks.append(MdBlock(kind="hr"))
            i += 1
            continue

        m = _RE_HEADING.match(line)
        if m:
            flush_paragraph(paragraph_buf)
            level = len(m.group(1))
            text = m.group(2).strip()
            blocks.append(MdBlock(kind="h", level=level, text=text))
            i += 1
            continue

        if line.strip().startswith("```"):
            flush_paragraph(paragraph_buf)
            fence = line.strip()
            lang = fence[3:].strip()
            code_lines: List[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i].rstrip("\n"))
                i += 1
            if i < len(lines) and lines[i].strip().startswith("```"):
                i += 1
            blocks.append(MdBlock(kind="code", text="\n".join(code_lines)))
            if lang:
                blocks.append(MdBlock(kind="code_lang", text=lang))
            continue

        if line.lstrip().startswith("- "):
            flush_paragraph(paragraph_buf)
            items: List[str] = []
            while i < len(lines) and lines[i].lstrip().startswith("- "):
                items.append(lines[i].lstrip()[2:].strip())
                i += 1
            blocks.append(MdBlock(kind="list", items=items, ordered=False))
            continue

        if _RE_OLI.match(line):
            flush_paragraph(paragraph_buf)
            items: List[str] = []
            while i < len(lines):
                m2 = _RE_OLI.match(lines[i])
                if not m2:
                    break
                items.append(m2.group(2).strip())
                i += 1
            blocks.append(MdBlock(kind="list", items=items, ordered=True))
            continue

        paragraph_buf.append(line.strip())
        i += 1

    flush_paragraph(paragraph_buf)
    return blocks


class WeavDoc(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        self._heading_seq = 0
        self._toc = TableOfContents()

    def afterFlowable(self, flowable):  # noqa: N802 (reportlab hook)
        if not isinstance(flowable, Paragraph):
            return
        style_name = getattr(flowable.style, "name", "")
        if not style_name.startswith("H"):
            return
        try:
            level = int(style_name[1:]) - 1  # H1 -> 0, H2 -> 1 ...
        except Exception:
            level = 0
        text = flowable.getPlainText()
        self._heading_seq += 1
        key = f"h{self._heading_seq}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page))


def build_pdf(input_md: Path, output_pdf: Path) -> None:
    body_font, mono_font = _register_fonts()

    base = getSampleStyleSheet()
    styles = {
        "Body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName=body_font,
            fontSize=10.5,
            leading=15,
            spaceAfter=6,
        ),
        "Small": ParagraphStyle(
            "Small",
            parent=base["Normal"],
            fontName=body_font,
            fontSize=9,
            leading=13,
            textColor=colors.HexColor("#4B5563"),
            spaceAfter=6,
        ),
        "H1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName=body_font,
            fontSize=20,
            leading=26,
            spaceBefore=10,
            spaceAfter=10,
        ),
        "H2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName=body_font,
            fontSize=15,
            leading=20,
            spaceBefore=12,
            spaceAfter=8,
        ),
        "H3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName=body_font,
            fontSize=12.5,
            leading=17,
            spaceBefore=10,
            spaceAfter=6,
        ),
        "H4": ParagraphStyle(
            "H4",
            parent=base["Heading4"],
            fontName=body_font,
            fontSize=11,
            leading=15,
            spaceBefore=8,
            spaceAfter=4,
        ),
        "Code": ParagraphStyle(
            "Code",
            parent=base["Code"],
            fontName=mono_font,
            fontSize=8.8,
            leading=11.5,
        ),
        "Bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName=body_font,
            fontSize=10.5,
            leading=15,
            leftIndent=14,
            firstLineIndent=-10,
            spaceAfter=3,
        ),
        "Title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName=body_font,
            fontSize=26,
            leading=32,
            alignment=TA_CENTER,
            spaceAfter=10,
        ),
        "Subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName=body_font,
            fontSize=12,
            leading=18,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#374151"),
            spaceAfter=8,
        ),
    }

    md_text = input_md.read_text(encoding="utf-8")
    blocks = parse_markdown(md_text)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    def on_page(canvas, doc):  # noqa: ANN001
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#6B7280"))
        canvas.setFont(body_font, 8.5)
        canvas.drawString(18 * mm, 12 * mm, "WEAV AI - Learn About This Project (E2E)")
        canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"{doc.page}")
        canvas.restoreState()

    frame = Frame(
        18 * mm,
        18 * mm,
        A4[0] - 36 * mm,
        A4[1] - 36 * mm,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="normal",
    )
    doc = WeavDoc(
        str(output_pdf),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=on_page)])

    story = []

    # Cover
    now = datetime.now().strftime("%Y-%m-%d")
    story.append(Spacer(1, 30 * mm))
    story.append(Paragraph("WEAV AI", styles["Title"]))
    story.append(Paragraph("프로젝트 E2E 이해 가이드 (3일 완주)", styles["Subtitle"]))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(_escape_para(f"생성일: {now}"), styles["Subtitle"]))
    story.append(Paragraph(_escape_para(f"저장소: {ROOT}"), styles["Small"]))
    story.append(PageBreak())

    # TOC
    story.append(Paragraph("목차", styles["H1"]))
    doc._toc.levelStyles = [
        ParagraphStyle(
            name="TOC0",
            fontName=body_font,
            fontSize=10.5,
            leading=14,
            leftIndent=0,
            firstLineIndent=0,
            spaceBefore=2,
            spaceAfter=2,
        ),
        ParagraphStyle(
            name="TOC1",
            fontName=body_font,
            fontSize=10,
            leading=13,
            leftIndent=12,
            firstLineIndent=0,
            spaceBefore=1,
            spaceAfter=1,
            textColor=colors.HexColor("#374151"),
        ),
        ParagraphStyle(
            name="TOC2",
            fontName=body_font,
            fontSize=9.5,
            leading=12.5,
            leftIndent=24,
            firstLineIndent=0,
            spaceBefore=1,
            spaceAfter=1,
            textColor=colors.HexColor("#4B5563"),
        ),
    ]
    story.append(doc._toc)
    story.append(PageBreak())

    # Content blocks
    for b in blocks:
        if b.kind == "pagebreak":
            story.append(PageBreak())
            continue
        if b.kind == "hr":
            story.append(Spacer(1, 4 * mm))
            story.append(Paragraph(_escape_para("-" * 80), styles["Small"]))
            story.append(Spacer(1, 2 * mm))
            continue
        if b.kind == "h":
            level = max(1, min(4, b.level))
            story.append(Paragraph(_escape_para(b.text), styles[f"H{level}"]))
            continue
        if b.kind == "p":
            story.append(Paragraph(_escape_para(b.text), styles["Body"]))
            continue
        if b.kind == "code":
            story.append(Spacer(1, 2 * mm))
            story.append(
                Preformatted(b.text, styles["Code"], dedent=0)
            )
            story.append(Spacer(1, 3 * mm))
            continue
        if b.kind == "code_lang":
            # Language blocks are informational; skip to keep output clean.
            continue
        if b.kind == "list":
            items = b.items or []
            if not items:
                continue
            for idx, item in enumerate(items, start=1):
                prefix = f"{idx}. " if b.ordered else "• "
                story.append(Paragraph(_escape_para(prefix + item), styles["Bullet"]))
            story.append(Spacer(1, 2 * mm))
            continue

    # Use multiBuild so TableOfContents is populated (2-pass).
    doc.multiBuild(story)


def main() -> int:
    if not INPUT_MD.exists():
        raise SystemExit(f"Input markdown not found: {INPUT_MD}")
    build_pdf(INPUT_MD, OUTPUT_PDF)
    print(f"Wrote: {OUTPUT_PDF}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
