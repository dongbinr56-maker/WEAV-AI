from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chats', '0010_session_reference_image_urls'),
    ]

    operations = [
        migrations.AddField(
            model_name='job',
            name='result',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]

