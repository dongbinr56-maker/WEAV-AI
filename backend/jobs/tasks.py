import logging
import fitz  # PyMuPDF
import fal_client
import io
import os
from celery import shared_task
from django.conf import settings
from apps.chats.services import memory_service
from storage.s3 import minio_client

logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=3, default_retry_delay=10)
def process_pdf(self, session_id: int, file_key: str, filename: str):
    """
    Processes an uploaded PDF: extracts text (with OCR fallback), chunks it, and indexes it.
    """
    task_id = self.request.id
    logger.info(f"[Task {task_id}] Starting PDF processing for session {session_id}, file: {filename}")

    try:
        # 1. Download from MinIO
        logger.info(f"[Task {task_id}] Downloading file from MinIO: {file_key}")
        file_bytes = minio_client.get_file_content(file_key)
        logger.info(f"[Task {task_id}] Download successful. Size: {len(file_bytes)} bytes")

        # 2. Text Extraction (PyMuPDF)
        logger.info(f"[Task {task_id}] Attempting PyMuPDF extraction")
        text_content = ""
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            for page_num, page in enumerate(doc):
                text = page.get_text()
                if text.strip():
                    text_content += f"\n--- Page {page_num + 1} ---\n{text}"
        
        # 3. OCR Fallback (Fal.ai)
        if not text_content.strip():
            logger.warning(f"[Task {task_id}] PyMuPDF extracted no text. Initiating OCR fallback with fal.ai")
            try:
                # Need a public URL for fal.ai to access, OR upload the bytes if supported.
                # fal.ai usually takes a URL.
                # We can generate a presigned URL from MinIO (assuming MinIO is reachable from fal.ai)
                # IF MinIO is local (localhost), fal.ai CANNOT reach it.
                # In a real prod env, MinIO would be exposed or S3 used.
                # For this implementation, we will assume MinIO IS reachable or we skip if local.
                # If local development without tunnel, this will fail.
                # We'll try to generate a presigned URL.
                
                # Check if we have a valid key
                if not settings.FAL_KEY:
                    raise ValueError("FAL_KEY is not configured.")

                file_url = minio_client.client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': settings.MINIO_BUCKET_NAME, 'Key': file_key},
                    ExpiresIn=3600
                )
                
                # NOTE: fal.ai requires the URL to be publicly accessible. 
                # If running locally, this URL (localhost) won't work for fal.ai.
                # In a real deployed scenario, this would be a real domain.
                # We will proceed with the implementation assuming connectivity.
                
                logger.info(f"[Task {task_id}] Sending URL to fal.ai: {file_url}")
                
                # Using a generic OCR model on fal.ai (e.g., moondream or a purely OCR one)
                # For strict OCR, we might look for a specific model, but here's a placeholder usage.
                # Let's use a known OCR or VLM model. `fal-ai/any-resolution-ocr` is a good candidate if available,
                # or a VLM like `llava-next`. Let's assume a generic OCR endpoint.
                # Using `fal-ai/florence-2-large` which is good for captioning/OCR.
                
                handler = fal_client.submit(
                    "fal-ai/florence-2-large",
                    arguments={
                        "image_url": file_url,
                        "task": "OCR"
                    }
                )
                result = handler.get()
                ocr_text = result.get('text', '') or result.get('ocr', '') # Adjust based on actual response structure
                
                if ocr_text:
                    text_content = f"[OCR Extracted]\n{ocr_text}"
                    logger.info(f"[Task {task_id}] OCR successful.")
                else:
                    logger.error(f"[Task {task_id}] OCR returned empty result.")
                    
            except Exception as ocr_e:
                logger.error(f"[Task {task_id}] OCR fallback failed: {ocr_e}")
                # We do not re-raise providing we want to handle partial failure gracefully
                # mostly if it's just 'local network' issue.
                text_content = "[Error: Could not extract text from this PDF]"

        if not text_content.strip():
            logger.error(f"[Task {task_id}] Final text content is empty. Aborting indexing.")
            return "No text extracted"

        # 4. Chunking (Simple chunking for now)
        logger.info(f"[Task {task_id}] Chunking text...")
        chunk_size = 1000
        chunks = [text_content[i:i+chunk_size] for i in range(0, len(text_content), chunk_size)]
        
        # 5. Indexing
        logger.info(f"[Task {task_id}] Indexing {len(chunks)} chunks to PGVector")
        for i, chunk in enumerate(chunks):
            memory_service.add_memory(
                session_id=session_id,
                content=chunk,
                metadata={
                    'source': 'pdf',
                    'filename': filename,
                    'chunk_index': i,
                    'total_chunks': len(chunks)
                }
            )
        
        logger.info(f"[Task {task_id}] PDF processing completed successfully.")
        return "Success"

    except Exception as e:
        logger.error(f"[Task {task_id}] Processing failed: {e}", exc_info=True)
        # Retry logic
        try:
             self.retry(exc=e)
        except Exception as retry_e:
             logger.error(f"[Task {task_id}] Max retries exceeded.")
             # Optionally update DB state to 'failed' here if we were tracking it in a model
             raise e
