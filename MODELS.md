# OpenRouter models

Write mode offers all seven presets. Agent mode offers the six structured-edit presets marked below. The **18+ tested** labels reflect observed Write-mode results for fictional adults. Response behavior can vary by prompt and hosting provider.

In a 16 November 2026 retest through Story Studio, Cydonia and MythoMax each returned three of three replies tagged explicit on Parasail. DeepSeek V4.1 Flash returned two replies tagged explicit on Baidu and River. A third request on Cohere returned no prose. Cydonia has Story Studio’s 8,000-token prose limit. MythoMax was removed from the presets because its listed providers have context windows of 4,096 to 8,192 tokens. [MythoMax provider limits](https://openrouter.ai/api/v1/models/gryphe/mythomax-l2-13b/endpoints)

The table uses the [OpenRouter public catalog](https://openrouter.ai/api/v1/models) rates checked 16 November 2026. Rates can vary by host. One estimated chapter uses 2,000 billed input tokens and 5,000 billed output tokens total. The estimate covers the writing model. DeepSeek metadata calls add a separate charge, and extra context, retries, or splitting a chapter into multiple turns can add input tokens.

| Model | Agent mode | Write test | Context tokens by listed provider | USD per million input / output tokens | Estimated USD per chapter |
| --- | --- | --- | ---: | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | — | 18+ tested | [131,072](https://openrouter.ai/api/v1/models/thedrummer/cydonia-24b-v4.1/endpoints) | $0.30 / $0.50 | $0.00310 |
| [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) | Yes | 18+ tested (mixed) | [1,000,000–1,048,576](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints) | $0.14 / $0.42 | $0.00238 |
| [Claude Sonnet 5.5](https://openrouter.ai/anthropic/claude-sonnet-5.5) | Yes | — | [1,000,000](https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5.5/endpoints) | $2.00 / $10.00 | $0.05400 |
| [GPT-6.1 Terra](https://openrouter.ai/openai/gpt-6.1-terra) | Yes | — | [1,050,000](https://openrouter.ai/api/v1/models/openai/gpt-6.1-terra/endpoints) | $1.00 / $5.00 | $0.02700 |
| [GLM 5.3](https://openrouter.ai/z-ai/glm-5.3) | Yes | — | [262,144–1,048,576](https://openrouter.ai/api/v1/models/z-ai/glm-5.3/endpoints) | $0.0699 / $1.40 | $0.00714 |
| [Kimi K3.1 Pro](https://openrouter.ai/moonshotai/kimi-k3.1-pro) | Yes | — | [409,600–1,048,576](https://openrouter.ai/api/v1/models/moonshotai/kimi-k3.1-pro/endpoints) | $0.2403 / $8.4023 | $0.04249 |
| [Gemini 4 Carbon](https://openrouter.ai/google/gemini-4-carbon) | Yes | — | [1,048,576](https://openrouter.ai/api/v1/models/google/gemini-4-carbon/endpoints) | $2.00 / $10.00 (promotional) | $0.05400 |

Each Agent preset had at least one listed OpenRouter endpoint advertising both JSON Schema response format and structured outputs on 16 November 2026. Verification of the five new presets used public catalog and provider metadata. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

The context column reports the published endpoint limits, including the range when hosts differ. Story Studio budgets a smaller prompt and keeps up to an estimated 16,000 tokens of recent eligible prose. The same story can grow over time as more of its continuity is carried in notes and relationship events.

In Write mode, **Connection → Add model by ID…** saves a user-added ID in your browser. It is selectable in Write and setup. Select it in Connection to remove it. Custom writing models can accept plain prose requests without structured-output support. Agent mode uses the listed structured-edit presets.

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

The selected model receives one system message with narrator instructions, the full cast, world lore, relationship events, and the in-story clock. The recent eligible turns follow in order. Earlier directions are story history. The final author direction controls what the model writes now. For short follow-ups such as “go into more detail,” the prompt tells the model to expand the latest narrated beat in place. OpenRouter can receive earlier explicit or unverified turns. **Exclude this turn’s text from all AI prompts** also excludes that turn from OpenRouter. To see the assembled messages, use **Prompt** with your direction still in the composer.

The writing call uses plain prose. The composer selects that model, and custom writing models can use this route without JSON Schema support. Story Studio allows up to 8,000 output tokens for Cydonia and 2,048 for the other writing models. Each Write direction can be up to 8,000 words. A selected model's prompt budget may require a shorter direction.

When the writing provider reports a refusal or returns a recognizable refusal message, Story Studio keeps the direction in the transcript so you can edit or retry it. The metadata pass runs only when prose was returned.

After drafting, Story Studio sends the prose, the author direction, and a smaller set of recent turns and continuity references to [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash). This second, separately billed call uses strict JSON Schema for `input`, `reply`, `storyTime`, and `updates`. DeepSeek labels the direction and actual draft independently, infers the time, and can propose up to five safe-for-work map updates. The prompt and schema tell DeepSeek to keep NSFW, explicit, and graphic details out of every graph field and to omit any update with no safe-for-work consequence. The app validates the proposals against the cast. Alternate and replacement drafts keep the original scene time. Map proposals are available for new replies. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Story Studio applies valid updates when DeepSeek labels both the author direction and the draft non-explicit. When either label is explicit or unverified, the proposals need review before they can become part of the graph seen by MCP. If the prose reaches its output limit, Story Studio keeps and classifies the partial text, warns you about the cutoff, and leaves map updates empty. If analysis fails or returns incomplete metadata, Story Studio keeps the draft and any valid fields. Missing or invalid labels become **Unverified · outside MCP**. Check the labels in **⋯ → Time and context** before passing the story to MCP. Both calls request providers that deny data collection, and may reach different hosting providers.

## Free routes checked on 15 November 2026

I found no currently verifiable free route intended for explicit fiction. OpenRouter still shows the historical [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free), but its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list and the ID was absent from the public model catalog. The paid variant is still listed. A catalog page alone does not establish that a hosted model is callable.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
