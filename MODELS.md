# OpenRouter models for fictional adult writing

These are candidates for stories about fictional adults. OpenRouter's catalog and [roleplay guide](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) describe the models and their providers. Whether a particular scene is accepted depends on the chosen model and host. Cydonia passed a live non-explicit writing test in Story Studio. Explicit content behavior was not tested.

Prices checked on 15 November 2026. One estimated chapter uses 2,000 billed input tokens and 5,000 billed output tokens total. Extra context, retries, or splitting a chapter into multiple turns can add input tokens.

| Model | What to try it for | Context | USD per million input / output tokens | Estimated USD per chapter |
| --- | --- | ---: | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | First choice for creative prose | 131K | $0.30 / $0.50 | $0.00310 |
| [Venice Dolphin 24B](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition) | Steerable alternative | 128K | $0.20 / $0.90 | $0.00490 |
| [Euryale 70B v2.2](https://openrouter.ai/sao10k/l3.1-euryale-70b) | Character voice and dialogue | 131K | $0.85 / $0.85 | $0.00595 |
| [Magnum v4 72B](https://openrouter.ai/anthracite-org/magnum-v4-72b) | More expensive prose comparison | 32K | $2.50 / $5.00 | $0.03000 |
| [UnslopNemo 12B](https://openrouter.ai/thedrummer/unslopnemo-12b) | Lightweight adventure writing and roleplay | 1,024K | $0.40 / $0.40 | $0.00280 |
| [MythoMax 13B](https://openrouter.ai/gryphe/mythomax-l2-13b) | Cheap short scenes with compact context | 8K | $0.08 / $0.11 | $0.00071 |

[Grok 4.7](https://openrouter.ai/x-ai/grok-4.7) is a general writing and planning comparison. The listed $2.00 input and $6.00 output per million tokens would be about $0.034 per chapter at this usage. Its availability and moderation can differ from the consumer Grok app. For Jess's main workflow, start with Cydonia.

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

The selected model receives the current direction, recent eligible turns, narrator instructions, cast, world lore, relationship events, and the in-story clock. It follows the writer's requested style, point of view and tense when provided. OpenRouter can receive earlier explicit or unverified turns. **Keep this turn out of AI context** also excludes that turn from OpenRouter.

Story Studio checks the selected model's OpenRouter endpoint capabilities. When an endpoint advertises structured outputs, Story Studio requests a strict JSON Schema for `text`, `input`, `reply`, `storyTime`, and `updates`. Routing requires support for the requested parameters and retains the app's data-collection preference. The app validates the returned labels, time, and updates before saving. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

Among the six presets, Venice Dolphin 24B was the only model without an endpoint advertising JSON Schema support when checked on November 15, 2026. Check the current endpoint listings for changes. [OpenRouter model catalog](https://openrouter.ai/api/v1/models)

If schema support is missing or cannot be confirmed, Story Studio requests the same information as prose followed by a fenced `story-safety` block. A final standard `json` block with recognizable safety fields is also accepted. One writing request uses the selected format and model. The app keeps prose from the `text` field or the reply body and stores the metadata separately.

The model labels the writer input and assistant reply separately and records the in-story time to the minute. A regular reply can suggest up to five non-explicit map updates if suggestions are enabled. The shapes match the [MCP updates array](MCP.md#tool-contract). An alternate keeps the original scene time and has no map updates. This is an example of the footer format:

````text
Story prose appears here.

```story-safety
{"input":"safe","reply":"safe","storyTime":"1998-10-25T00:11","updates":[{"kind":"fact","note":"The log copy is at East Pier."}]}
```
````

Missing labels and length-limited replies stay outside MCP until reviewed. Invalid map entries are skipped with a warning. Correct labels with **Edit** and check accepted continuity under **Character & lore** before handing a story back to MCP. [OpenRouter API reference](https://openrouter.ai/docs/api_reference/overview)

## Free routes checked on 15 November 2026

I found no currently verifiable free route intended for explicit fiction. OpenRouter still shows the historical [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free), but its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list and the ID was absent from the public model catalog. The paid variant is still listed. A catalog page alone does not establish that a hosted model is callable.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
