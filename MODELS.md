# OpenRouter models for fictional adult writing

Story Studio offers two OpenRouter presets for stories about fictional adults. Response behavior can vary by prompt and hosting provider.

In a 16 November 2026 retest through Story Studio, DeepSeek classified three of three replies from each preset as explicit. Both ran on Parasail. Cydonia has Story Studio’s 8,000-token prose limit. MythoMax is suited to shorter scenes.

Prices checked on 15 November 2026. One estimated chapter uses 2,000 billed input tokens and 5,000 billed output tokens total. The estimate covers the writing model. DeepSeek metadata calls add a separate charge, and extra context, retries, or splitting a chapter into multiple turns can add input tokens.

| Model | What to try it for | Context | USD per million input / output tokens | Estimated USD per chapter |
| --- | --- | ---: | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | First choice for creative prose | 131K | $0.30 / $0.50 | $0.00310 |
| [MythoMax 13B](https://openrouter.ai/gryphe/mythomax-l2-13b) | Cheap short scenes with compact context | 8K | $0.08 / $0.11 | $0.00071 |

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

The selected model receives one system message with narrator instructions, the full cast, world lore, relationship events, and the in-story clock. The recent eligible turns follow in order. Earlier directions are story history. The final author direction controls what the model writes now. For short follow-ups such as “go into more detail,” the prompt tells the model to expand the latest narrated beat in place. OpenRouter can receive earlier explicit or unverified turns. **Exclude this turn’s text from all AI prompts** also excludes that turn from OpenRouter. To see the assembled messages, use **Prompt** with your direction still in the composer.

The writing call uses plain prose. The composer selects that model, and custom writing models can use this route without JSON Schema support. Story Studio allows up to 8,000 output tokens for Cydonia and 2,048 for the other writing models. The writing and metadata calls use up to 6,000 characters of the author direction. For a longer direction, Story Studio keeps the full text in the transcript and withholds it from MCP until you review its label.

When the writing provider reports a refusal or returns a recognizable refusal message, Story Studio keeps the direction in the transcript so you can edit or retry it. The metadata pass runs only when prose was returned.

After drafting, Story Studio sends the prose, the author direction, and a smaller set of recent turns and continuity references to [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash). This second, separately billed call uses strict JSON Schema for `input`, `reply`, `storyTime`, and `updates`. DeepSeek labels the direction and actual draft independently, infers the time, and can propose up to five safe-for-work map updates. The prompt and schema tell DeepSeek to keep NSFW, explicit, and graphic details out of every graph field and to omit any update with no safe-for-work consequence. The app validates the proposals against the cast. Alternate and replacement drafts keep the original scene time. Map proposals are available for new replies. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Story Studio applies valid updates when DeepSeek labels both the author direction and the draft non-explicit. When either label is explicit or unverified, the proposals need review before they can become part of the graph seen by MCP. If the prose reaches its output limit, Story Studio keeps and classifies the partial text, warns you about the cutoff, and leaves map updates empty. If analysis fails or returns incomplete metadata, Story Studio keeps the draft and any valid fields. Missing or invalid labels become **Unverified · outside MCP**. Check the labels in **⋯ → Time and context** before passing the story to MCP. Both calls request providers that deny data collection, and may reach different hosting providers.

## Free routes checked on 15 November 2026

I found no currently verifiable free route intended for explicit fiction. OpenRouter still shows the historical [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free), but its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list and the ID was absent from the public model catalog. The paid variant is still listed. A catalog page alone does not establish that a hosted model is callable.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
