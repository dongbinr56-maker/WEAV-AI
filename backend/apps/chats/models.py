from django.db import models
from pgvector.django import VectorField

SESSION_KIND_CHAT = 'chat'
SESSION_KIND_IMAGE = 'image'
SESSION_KIND_CHOICES = [
    (SESSION_KIND_CHAT, 'Chat'),
    (SESSION_KIND_IMAGE, 'Image'),
]


class Session(models.Model):
    kind = models.CharField(max_length=20, choices=SESSION_KIND_CHOICES)
    title = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']


class ChatMemory(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='memories')
    content = models.TextField()
    embedding = VectorField(dimensions=1536)  # OpenAI text-embedding-3-small
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Message(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=20)  # user | assistant
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']


class ImageRecord(models.Model):
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='image_records')
    prompt = models.TextField()
    image_url = models.URLField(max_length=2048)
    mask_url = models.URLField(max_length=2048, blank=True, null=True)
    model = models.CharField(max_length=128)
    seed = models.BigIntegerField(null=True, blank=True)
    reference_image = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='derived_images')
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Job(models.Model):
    task_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name='jobs')
    kind = models.CharField(max_length=20)  # chat | image
    status = models.CharField(max_length=20, default='pending')  # pending | running | success | failure
    message = models.ForeignKey(Message, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    image_record = models.ForeignKey(ImageRecord, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
