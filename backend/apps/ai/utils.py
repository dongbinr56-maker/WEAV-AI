from apps.chats.services import memory_service

def get_rag_enhanced_system_prompt(session_id: int, user_prompt: str, base_system_prompt: str = "You are a helpful AI assistant.") -> str:
    """
    Constructs a system prompt with RAG context and specific instructions for Visual Continuity.
    """
    # 1. Retrieve relevant memories (Shared Context potential here by expanding session_ids)
    memories = memory_service.search_memory([session_id], user_prompt, limit=5)

    # 2. Format memories
    # We want to be concise.
    memory_context = ""
    if memories:
        memory_items = []
        for m in memories:
            # If it's an image generation memory, include metadata summary
            if m.metadata and m.metadata.get('type') == 'image_generation':
                 memory_items.append(f"[Image Generated] {m.content} (ID: {m.metadata.get('image_record_id')})")
            else:
                 memory_items.append(f"- {m.content}")

        memory_context = "## Context History\n" + "\n".join(memory_items)

    # 3. Kling / Visual Continuity Instructions
    # Instruct the LLM to maintain consistency by referencing previous image parameters.
    visual_continuity_instructions = (
        "\n## Visual Continuity Instructions\n"
        "When the user requests to MODIFY an existing image (e.g., 'change cat to dog', 'add hat'):\n"
        "1. Identify the previous image from Context History.\n"
        "2. Use its 'seed' and 'image_url' (as reference) to maintain style/layout.\n"
        "3. Explicitly mention which image ID you are modifying.\n"
        "4. For Kling, use the 'reference_image_url' parameter to ensure consistency."
    )

    # Combine
    full_prompt = f"{base_system_prompt}\n\n{memory_context}\n{visual_continuity_instructions}"

    # 4. Length Check (Soft limit 3000 chars)
    if len(full_prompt) > 3000:
        # Naive strategy: keep instructions, truncate context
        allowed_context_len = 3000 - len(base_system_prompt) - len(visual_continuity_instructions) - 100
        if allowed_context_len > 0:
            memory_context = memory_context[:allowed_context_len] + "...(truncated)"
            full_prompt = f"{base_system_prompt}\n\n{memory_context}\n{visual_continuity_instructions}"
        else:
            # Fallback: just base + instructions
            full_prompt = f"{base_system_prompt}\n{visual_continuity_instructions}"

    return full_prompt
