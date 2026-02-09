import logging
import tempfile
import os
import fitz  # PyMuPDF
from celery import shared_task
from django.conf import settings
from .models import Document, ChatMemory
from .services import ChatMemoryService
try:
    from PIL import Image
    import pytesseract
except ImportError:
    Image = None
    pytesseract = None

try:
    from storage.s3 import minio_client
except ImportError:
    # Fallback for circular import or if storage app is not ready
    import boto3
    minio_client = None

logger = logging.getLogger(__name__)

def get_bbox_iou(box1, box2):
    """
    Calculate Intersection over Union (IoU) of two bounding boxes.
    box: [x0, y0, x1, y1]
    """
    x0_1, y0_1, x1_1, y1_1 = box1
    x0_2, y0_2, x1_2, y1_2 = box2

    x_left = max(x0_1, x0_2)
    y_top = max(y0_1, y0_2)
    x_right = min(x1_1, x1_2)
    y_bottom = min(y1_1, y1_2)

    if x_right < x_left or y_bottom < y_top:
        return 0.0

    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    box1_area = (x1_1 - x0_1) * (y1_1 - y0_1)
    box2_area = (x1_2 - x0_2) * (y1_2 - y0_2)

    union_area = box1_area + box2_area - intersection_area
    if union_area == 0:
        return 0.0
    return intersection_area / union_area

def extract_text_and_bbox_with_pymupdf(doc):
    """
    Extracts text blocks with their bounding boxes and page numbers using PyMuPDF (fitz).
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

def extract_text_and_bbox_with_ocr(doc):
    """
    Extracts text blocks using OCR on page images.
    Returns a list of dicts: {'text': str, 'bbox': list, 'page': int, 'source_type': 'ocr'}
    """
    extracted_data = []
    if not pytesseract or not Image:
        logger.warning("pytesseract or PIL not installed. Skipping OCR.")
        return extracted_data

    try:
        for page_num, page in enumerate(doc):
            pix = page.get_pixmap()
            img_data = pix.tobytes("png")
            image = Image.open(io.BytesIO(img_data))
            
            # Use image_to_data to get boxes
            ocr_res = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
            
            n_boxes = len(ocr_res['text'])
            
            # Group by block_num
            # block_num -> {'text': [], 'bboxes': []}
            blocks = {} 
            
            for i in range(n_boxes):
                if int(ocr_res['conf'][i]) < 30: # Low confidence filter
                    continue
                text = ocr_res['text'][i].strip()
                if not text:
                    continue
                
                block_num = ocr_res['block_num'][i]
                x, y, w, h = ocr_res['left'][i], ocr_res['top'][i], ocr_res['width'][i], ocr_res['height'][i]
                x0, y0, x1, y1 = x, y, x + w, y + h
                
                if block_num not in blocks:
                    blocks[block_num] = {'text': [text], 'bbox': [x0, y0, x1, y1]}
                else:
                    blocks[block_num]['text'].append(text)
                    # Expand bbox to cover all words in block
                    b = blocks[block_num]['bbox']
                    blocks[block_num]['bbox'] = [
                        min(b[0], x0), min(b[1], y0),
                        max(b[2], x1), max(b[3], y1)
                    ]
            
            for b_id, content in blocks.items():
                full_text = " ".join(content['text'])
                if len(full_text) > 3: # Ignore tiny noise
                    extracted_data.append({
                        'text': full_text,
                        'bbox': content['bbox'],
                        'page': page_num + 1,
                        'source_type': 'ocr'
                    })

    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
    
    return extracted_data

def merge_parsed_and_ocr(parsed_data, ocr_data):
    """
    Merges parsed text and OCR text. 
    1. Prefer parsed text.
    2. Add OCR text only if it doesn't significantly overlap with parsed text.
    """
    if not ocr_data:
        return parsed_data
        
    merged_data = list(parsed_data)
    
    # Organize parsed data by page for faster lookup
    parsed_by_page = {}
    for item in parsed_data:
        p = item['page']
        if p not in parsed_by_page:
            parsed_by_page[p] = []
        parsed_by_page[p].append(item)
    
    for ocr_item in ocr_data:
        page = ocr_item['page']
        ocr_bbox = ocr_item['bbox']
        
        is_duplicate = False
        if page in parsed_by_page:
            for parsed_item in parsed_by_page[page]:
                # Check IoU or simple box overlap
                parsed_bbox = parsed_item['bbox']
                iou = get_bbox_iou(ocr_bbox, parsed_bbox)
                
                # If overlap is significant, assume it's covered by parsed text
                if iou > 0.1:
                    is_duplicate = True
                    break
        
        if not is_duplicate:
            logger.info(f"Adding OCR unique content on page {page}: {ocr_item['text'][:30]}...")
            merged_data.append(ocr_item)
            
    # Sort by page then y position
    merged_data.sort(key=lambda x: (x['page'], x['bbox'][1]))
    return merged_data

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
        
        logger.info(f"Starting extraction for doc {document_id}")

        # A. Parse Text + BBox
        parsed_chunks = extract_text_and_bbox_with_pymupdf(pdf_doc)
        logger.info(f"Parsed {len(parsed_chunks)} text blocks.")
        
        # B. OCR Text + BBox
        ocr_chunks = extract_text_and_bbox_with_ocr(pdf_doc)
        logger.info(f"OCR extracted {len(ocr_chunks)} blocks.")
        
        # C. Merge
        final_chunks = merge_parsed_and_ocr(parsed_chunks, ocr_chunks)
        logger.info(f"Final merged chunks: {len(final_chunks)}")
        
        if not final_chunks:
            # Fallback if both failed (e.g. empty scan without OCR setup)
            logger.warning(f"No text extracted from {doc_record.file_name}")
            doc_record.status = Document.STATUS_FAILED
            doc_record.error_message = "No text extracted (Parsed + OCR both empty)."
            doc_record.save()
            return

        # 3. Indexing
        service = ChatMemoryService()
        
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
        logger.error(f"Error processing document {document_id}: {e}", exc_info=True)
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
            try:
                # PDF might be open by fitz, close it explicitly if referenced, 
                # but 'pdf_doc' is local. fitz usually doesn't lock heavily on linux but on windows might.
                # pdf_doc.close() should be called if we persist the object
                pass
            except:
                pass
            try:
                os.unlink(tmp_path)
            except Exception as e:
                 logger.warning(f"Failed to delete temp file {tmp_path}: {e}")
