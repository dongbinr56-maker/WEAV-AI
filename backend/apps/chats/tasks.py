import logging
import tempfile
import os
import fitz  # PyMuPDF
from celery import shared_task
from django.conf import settings
from .models import Document, ChatMemory
from .services import ChatMemoryService

try:
    from storage.s3 import minio_client
except ImportError:
    # Fallback for circular import or if storage app is not ready
    import boto3
    minio_client = None

logger = logging.getLogger(__name__)

def extract_text_and_bbox_with_pymupdf(doc):
    """
    Extracts text blocks with their bounding boxes and page numbers.
    Returns a list of dicts: {'text': str, 'bbox': list, 'page': int, 'source_type': 'parsed'}
    """
    extracted_data = []
    try:
        for page_num, page in enumerate(doc):
            # "blocks" -> (x0, y0, x1, y1, "lines", block_no, block_type)
            # block_type=0 is text, block_type=1 is image
            blocks = page.get_text("blocks")
            for block in blocks:
                if block[6] == 0:  # Text block
                    text = block[4].strip()
                    if not text:
                        continue
                        
                    bbox = list(block[0:4]) # [x0, y0, x1, y1]
                    extracted_data.append({
                        'text': text,
                        'bbox': bbox,
                        'page': page_num + 1, # 1-indexed for user friendliness
                        'source_type': 'parsed'
                    })
    except Exception as e:
        logger.error(f"PyMuPDF block extraction failed: {e}")
    return extracted_data

def merge_parsed_and_ocr(parsed_data, ocr_data):
    """
    Merges parsed text and OCR text. 
    1. Prefer parsed text.
    2. If OCR text is in a region significantly different from parsed text, add it.
    For simplicity in this robust-but-simple implementation:
    - We currently just append OCR data since we assume OCR is run on images 
      that *failed* text parsing or are distinct images.
    - A complex spatial merge is out of scope without geometric libraries.
    """
    # Simple Deduplication could be done by text similarity, but visual merge is better.
    # Here we just combine them, assuming OCR is complementary or redundant-but-safe.
    # To reduce noise, strict deduping would be needed.
    return parsed_data + ocr_data

@shared_task(bind=True, max_retries=3)
def process_pdf_document(self, document_id):
    tmp_path = None # Initialize tmp_path to ensure it's defined for os.unlink
    try:
        doc_record = Document.objects.get(id=document_id)
        doc_record.status = Document.STATUS_PROCESSING
        doc_record.save()

        # 1. Download Content
        content_bytes = None
        if minio_client:
            content_bytes = minio_client.get_file_content(doc_record.file_name)
        else:
             logger.warning("minio_client not available, cannot download file content.")
             pass    

        if not content_bytes:
             raise Exception("Failed to retrieve file content from MinIO")

        # Save to temp file for fitz
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(content_bytes)
            tmp_path = tmp.name

        # 2. Extract & Merge
        # We need to open the PDF file with fitz
        pdf_doc = fitz.open(tmp_path)
        
        # A. Parse Text + BBox
        parsed_chunks = extract_text_and_bbox_with_pymupdf(pdf_doc)
        
        # B. OCR (Simulated/Placeholder for Merge Mode)
        # In a real system, iterate pages, convert to images, run OCR.
        # Since we don't have OCR deps, we simulate empty list or log.
        ocr_chunks = []
        # for page in pdf_doc: ...
        
        # C. Merge
        final_chunks = merge_parsed_and_ocr(parsed_chunks, ocr_chunks)
        
        if not final_chunks:
            # Fallback if both failed (e.g. empty scan without OCR setup)
            logger.warning(f"No text extracted from {doc_record.file_name}")
            doc_record.status = Document.STATUS_FAILED
            doc_record.error_message = "No text extracted."
            doc_record.save()
            # Clean up
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            # Must return here to prevent iteration error
            return

        # 3. Indexing
        service = ChatMemoryService()
        
        # For simplicity, we treat each block as a memory unit. 
        # This is good for citations but might be small for context.
        # Merging blocks into larger chunks while keeping citation info is advanced.
        # We will keep blocks separate for precise citation.
        
        for i, chunk in enumerate(final_chunks):
            content_text = chunk['text']
            
            # Metadata construction with bbox and page
            meta = {
                'source': 'pdf',
                'document_id': doc_record.id,
                'filename': doc_record.file_name,
                'page': chunk['page'],
                'bbox': chunk['bbox'],
                'source_type': chunk.get('source_type', 'unknown')
            }
            
            service.add_memory(
                session_id=doc_record.session_id,
                content=content_text,
                metadata=meta
            )
            
        doc_record.status = Document.STATUS_COMPLETED
        doc_record.save()
        
    except Exception as e:
        logger.error(f"Error processing document {document_id}: {e}")
        try:
            # Re-fetch in case transaction failed or stale
            doc_record = Document.objects.get(id=document_id)
            doc_record.status = Document.STATUS_FAILED
            doc_record.error_message = str(e)
            doc_record.save()
        except:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
