# OpenRouter models for fictional adult writing

These are candidates for stories about fictional adults. OpenRouter's catalog and [roleplay guide](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) describe the models and their providers. Whether a particular scene is accepted depends on the chosen model and host. Cydonia was tested on a fictional adult scene through OpenRouter. Its plain-prose responses followed the request more consistently than its schema-constrained responses in a small matched comparison.

Prices checked on 15 November 2026. One estimated chapter uses 2,000 billed input tokens and 5,000 billed output tokens total. The estimate covers the writing model. DeepSeek metadata calls add a separate charge, and extra context, retries, or splitting a chapter into multiple turns can add input tokens.

| Model | What to try it for | Context | USD per million input / output tokens | Estimated USD per chapter |
| --- | --- | ---: | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | First choice for creative prose | 131K | $0.30 / $0.50 | $0.00310 |
| [Euryale 70B v2.2](https://openrouter.ai/sao10k/l3.1-euryale-70b) | Character voice and dialogue | 131K | $0.85 / $0.85 | $0.00595 |
| [Magnum v4 72B](https://openrouter.ai/anthracite-org/magnum-v4-72b) | More expensive prose comparison | 32K | $2.50 / $5.00 | $0.03000 |
| [UnslopNemo 12B](https://openrouter.ai/thedrummer/unslopnemo-12b) | Lightweight adventure writing and roleplay | 1,024K | $0.40 / $0.40 | $0.00280 |
| [MythoMax 13B](https://openrouter.ai/gryphe/mythomax-l2-13b) | Cheap short scenes with compact context | 8K | $0.08 / $0.11 | $0.00071 |

[Grok 4.7](https://openrouter.ai/x-ai/grok-4.7) is a general writing and planning comparison. The listed $2.00 input and $6.00 output per million tokens would be about $0.034 per chapter at this usage. Its availability and moderation can differ from the consumer Grok app. For Jess's main workflow, start with Cydonia.

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

The selected model receives one system message with narrator instructions, the full cast, world lore, relationship events, and the in-story clock. The recent eligible turns follow in order, ending with the current author direction. For short follow-ups such as “go into more detail,” the prompt tells the model to expand the latest narrated beat in place. OpenRouter can receive earlier explicit or unverified turns. **Exclude this turn’s text from all AI prompts** also excludes that turn from OpenRouter. To see the assembled messages, use **Prompt** with your direction still in the composer.

The writing call uses plain prose. The composer selects that model, and custom writing models can use this route without JSON Schema support. Story Studio allows up to 8,000 output tokens for Cydonia and 2,048 for the other writing models.

After drafting, Story Studio sends the exact prose, the author direction, and a smaller set of recent turns and continuity references to [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash). This second, separately billed call uses strict JSON Schema for `input`, `reply`, `storyTime`, and `updates`. DeepSeek labels the direction and actual draft independently, infers the time, and can propose up to five non-explicit map updates. The app validates the proposals against the cast. An alternate preserves the original scene time and has no map updates. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

If the prose reaches its output limit, Story Studio keeps and classifies the partial text, warns you about the cutoff, and leaves map updates empty. If analysis fails, Story Studio keeps the draft and marks the affected turns **Unverified · outside MCP**. Check the labels with **Edit** before passing the story to MCP. Both calls request providers that deny data collection, and may reach different hosting providers.

## Free routes checked on 15 November 2026

I found no currently verifiable free route intended for explicit fiction. OpenRouter still shows the historical [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free), but its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list and the ID was absent from the public model catalog. The paid variant is still listed. A catalog page alone does not establish that a hosted model is callable.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
