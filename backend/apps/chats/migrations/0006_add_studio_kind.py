# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chats', '0005_drop_message_attachment_urls'),
    ]

    operations = [
        migrations.AlterField(
            model_name='session',
            name='kind',
            field=models.CharField(choices=[('chat', 'Chat'), ('image', 'Image'), ('studio', 'Studio')], max_length=20),
        ),
    ]
