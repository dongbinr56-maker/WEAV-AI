import logging
import boto3
from botocore.exceptions import ClientError
from django.conf import settings

logger = logging.getLogger(__name__)

class MinIOStorage:
    def __init__(self):
        self.endpoint_url = f"http{'s' if settings.MINIO_USE_SSL else ''}://{settings.MINIO_ENDPOINT}"
        self.access_key = settings.MINIO_ACCESS_KEY
        self.secret_key = settings.MINIO_SECRET_KEY
        self.bucket_name = settings.MINIO_BUCKET_NAME
        
        self.client = boto3.client(
            's3',
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=boto3.session.Config(signature_version='s3v4')
        )
        
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        try:
            self.client.head_bucket(Bucket=self.bucket_name)
        except ClientError:
            try:
                self.client.create_bucket(Bucket=self.bucket_name)
                logger.info(f"Created bucket: {self.bucket_name}")
            except Exception as e:
                logger.error(f"Failed to create bucket {self.bucket_name}: {e}")
                raise

    def upload_file(self, file_obj, filename: str) -> str:
        """
        Uploads a file-like object to MinIO and returns the URL.
        """
        try:
            self.client.upload_fileobj(
                file_obj,
                self.bucket_name,
                filename,
                ExtraArgs={'ContentType': 'application/pdf'} # Assuming PDF for now, can be dynamic
            )
            # Generate URL (assuming public or presigned - for now simple concatenation for internal usage or public bucket)
            # If the bucket is private, we should use presigned URLs, but for this RAG pipeline
            # the worker just needs to access it. 
            # Let's return the internal URL or a presigned URL.
            # For simplicity and internal use, we'll return a presigned URL valid for 1 hour, 
            # or just the path if the worker has access.
            # Let's return a direct URL if public, or pre-signed.
            # User request said "download from MinIO" in tasks.
            # So the task needs to know the bucket and key.
            # I will return the key as well or a dict. 
            # BUT the prompt asked for "URL".
            # Let's return a accessible URL.
             
            # url = f"{self.endpoint_url}/{self.bucket_name}/{filename}" # Simple public URL construction
            # return url
            
            # Actually, better to return the presigned URL for safety
            url = self.client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': filename},
                ExpiresIn=3600
            )
            logger.info(f"Successfully uploaded {filename} to MinIO.")
            return url
        except Exception as e:
            logger.error(f"Failed to upload {filename} to MinIO: {e}")
            raise

    def get_file_content(self, filename: str) -> bytes:
        """
        Downloads file content from MinIO.
        """
        try:
            response = self.client.get_object(Bucket=self.bucket_name, Key=filename)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Failed to download {filename} from MinIO: {e}")
            raise

minio_client = MinIOStorage()
