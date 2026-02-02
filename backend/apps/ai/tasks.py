from typing import Optional

from celery import shared_task
from django.db import transaction
from apps.chats.models import Message, ImageRecord, Job
from apps.chats.services import memory_service
from .router import run_chat, run_image
from .errors import AIError


@shared_task(bind=True, max_retries=2)
def task_chat(self, job_id: int, prompt: str, model: str, system_prompt: Optional[str] = None):
    job = Job.objects.get(pk=job_id)
    job.status = 'running'
    job.save(update_fields=['status', 'updated_at'])
    try:
        reply = run_chat(prompt, model=model, system_prompt=system_prompt)
        with transaction.atomic():
            msg = Message.objects.create(session=job.session, role='assistant', content=reply)
            job.message = msg
            job.status = 'success'
            job.error_message = ''
            job.save(update_fields=['message_id', 'status', 'error_message', 'updated_at'])

        # Index assistant response in RAG
        # Optimal point: After transaction commit to ensure data consistency
        memory_service.add_memory(
            job.session.id,
            reply,
            metadata={'role': 'assistant', 'message_id': msg.id, 'model': model}
        )

        return {'message_id': msg.id, 'content': reply}
    except AIError as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise


@shared_task(bind=True, max_retries=2)
def task_image(self, job_id: int, prompt: str, model: str, aspect_ratio: str = '1:1', num_images: int = 1, seed: int = None, reference_image_id: int = None, mask_url: str = None):
    job = Job.objects.get(pk=job_id)
    job.status = 'running'
    job.save(update_fields=['status', 'updated_at'])

    ref_url = None
    ref_image = None
    if reference_image_id:
        try:
            ref_image = ImageRecord.objects.get(pk=reference_image_id)
            ref_url = ref_image.image_url
        except ImageRecord.DoesNotExist:
            pass

    try:
        images = run_image(
            prompt,
            model=model,
            aspect_ratio=aspect_ratio,
            num_images=num_images,
            seed=seed,
            reference_image_url=ref_url,
            mask_url=mask_url
        )

        if not images:
            raise AIError('No image URL returned')

        with transaction.atomic():
            for img in images:
                url = img.get('url')
                img_seed = img.get('seed')
                if url:
                    rec = ImageRecord.objects.create(
                        session=job.session,
                        prompt=prompt,
                        image_url=url,
                        model=model,
                        seed=img_seed or seed,
                        mask_url=mask_url,
                        reference_image=ref_image,
                        metadata={'aspect_ratio': aspect_ratio}
                    )
                    job.image_record = rec
                    break # Only link one for now

            job.status = 'success'
            job.error_message = ''
            job.save(update_fields=['image_record_id', 'status', 'error_message', 'updated_at'])

        # Index generated image in RAG
        # Optimal point: After transaction, ensures ImageRecord exists
        if job.image_record:
            memory_service.add_memory(
                job.session.id,
                f"Generated image with prompt: {prompt}",
                metadata={
                    'type': 'image_generation',
                    'image_record_id': job.image_record.id,
                    'image_url': job.image_record.image_url,
                    'model': model
                }
            )

        return {'image_record_id': job.image_record_id, 'url': job.image_record.image_url}
    except AIError as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
    except Exception as e:
        job.status = 'failure'
        job.error_message = str(e)
        job.save(update_fields=['status', 'error_message', 'updated_at'])
        raise
