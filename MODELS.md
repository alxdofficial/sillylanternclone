# OpenRouter models

**Story** mode offers all seven presets as prose artists. **Agent** mode offers the models marked for direct story-state edits. Story Studio uses DeepSeek V4.1 Flash for the continuity pass after an OpenRouter artist writes. Cydonia is the artist for requests marked **Sensitive scene**. Response behavior can vary by prompt and hosting provider.

In a 16 November 2026 retest through Story Studio, Cydonia and MythoMax each returned three of three replies tagged explicit on Parasail. DeepSeek V4.1 Flash returned two replies tagged explicit on Baidu and River. A third request on Cohere returned no prose. Cydonia has Story Studio’s 8,000-token prose limit. MythoMax was removed from the presets because its listed providers have context windows of 4,096 to 8,192 tokens. [MythoMax provider limits](https://openrouter.ai/api/v1/models/gryphe/mythomax-l2-13b/endpoints)

The rates were checked on 16 November 2026 and can vary by host. One estimated chapter uses 2,000 billed input tokens and 5,000 billed output tokens total. The estimate covers the artist. Continuity calls add a separate charge, and extra context, retries, or splitting a chapter into multiple turns can add input tokens. [OpenRouter public catalog](https://openrouter.ai/api/v1/models)

| Model | Agent mode | Past adult-fiction tests | Context tokens by listed provider | USD per million input / output tokens | Estimated USD per chapter |
| --- | --- | --- | ---: | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | — | 18+ tested | [131,072](https://openrouter.ai/api/v1/models/thedrummer/cydonia-24b-v4.1/endpoints) | $0.30 / $0.50 | $0.00310 |
| [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) | Yes | 18+ tested (mixed) | [1,000,000–1,048,576](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints) | $0.14 / $0.42 | $0.00238 |
| [Claude Sonnet 5.5](https://openrouter.ai/anthropic/claude-sonnet-5.5) | Yes | — | [1,000,000](https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5.5/endpoints) | $2.00 / $10.00 | $0.05400 |
| [GPT-6.1 Terra](https://openrouter.ai/openai/gpt-6.1-terra) | Yes | — | [1,050,000](https://openrouter.ai/api/v1/models/openai/gpt-6.1-terra/endpoints) | $1.00 / $5.00 | $0.02700 |
| [GLM 5.3](https://openrouter.ai/z-ai/glm-5.3) | Yes | — | [262,144–1,048,576](https://openrouter.ai/api/v1/models/z-ai/glm-5.3/endpoints) | $0.0699 / $1.40 | $0.00714 |
| [Kimi K3.1 Pro](https://openrouter.ai/moonshotai/kimi-k3.1-pro) | Yes | — | [409,600–1,048,576](https://openrouter.ai/api/v1/models/moonshotai/kimi-k3.1-pro/endpoints) | $0.2403 / $8.4023 | $0.04249 |
| [Gemini 4 Carbon](https://openrouter.ai/google/gemini-4-carbon) | Yes | — | [1,048,576](https://openrouter.ai/api/v1/models/google/gemini-4-carbon/endpoints) | $2.00 / $10.00 (promotional) | $0.05400 |

The state-editing routes use OpenRouter's native function calls. The selected provider needs to support tools. Availability varies with the model, host, and your provider settings. [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)

The context column reports the published endpoint limits, including the range when hosts differ. Story Studio budgets a smaller prompt and keeps up to an estimated 16,000 tokens of recent eligible prose. The same story can grow over time as more of its continuity is carried in notes and relationship events.

In **Story** mode, **Connection → Add model by ID…** saves a user-added ID in your browser. It is selectable as an artist in Story mode or for setup chat. Select it in Connection to remove it. These uses only require ordinary text completions. Choose a supported Agent preset for direct story edits.

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

### Story mode

The artist receives narrator instructions, cast and world information, the in-story clock, approved continuity, eligible recent turns, and your current direction. It returns plain prose. Story Studio allows up to 8,000 output tokens for Cydonia and 2,048 for other artists. Directions can be up to 8,000 words, subject to the prompt budget for the selected model. To see the writing messages, use **Prompt** with your direction still in the composer.

Only Cydonia receives withheld history when you check **Sensitive scene** for that turn. The marked direction stays explicit even if the later classification suggests otherwise. **Exclude this turn’s text from all AI prompts** also withholds that turn from Cydonia. Automatic classification occurs after the artist receives the direction, so use **Sensitive scene** whenever you intend to request sensitive content.

When the artist returns prose, DeepSeek V4.1 Flash receives the new direction, draft, cast names, known scene time, and a smaller eligible history. It can call `inspect_continuity` to fetch relevant state. It finishes with `record_scene` to label the direction and draft independently, provide an in-story time, and propose up to five non-explicit facts. Story Studio runs these functions locally, returns relevant results for follow-up calls, and validates updates before saving. The continuity pass can take more than one separately billed model call. [OpenRouter client tools](https://openrouter.ai/docs/guides/features/tool-calling)

Both direction and draft must be labeled non-explicit for automatic updates. Proposals from sensitive or unverified scenes require review before they enter shared continuity. If the artist reaches its output limit, Story Studio keeps and classifies the partial draft and leaves map updates empty. If the continuity pass fails, the prose is still saved and the unverified text stays outside general model context. A provider refusal leaves the direction available to edit or retry. Alternates and rewrites retain the original time and do not record new graph facts.

### Agent mode

The selected model receives your edit request and eligible story context. It uses the same scoped state reads and finishes with `edit_story_state`, a batch of changes to the cast, world, writing notes, or continuity. The app validates the batch against the current revision and applies the requested changes to story information. Agent calls leave the manuscript intact.

### New story setup

Setup runs through the same agent runner. The selected model responds conversationally while you brainstorm. When you click **Prepare setup draft**, a supported Agent preset calls `prepare_story_setup` with fields for the proposed story. If your chat model is outside those presets, the wizard shows that DeepSeek V4.1 Flash will prepare the draft. The app validates the draft and stages it for review. The inputs are the planning chat, additional context, and the manuscript excerpts you can preview. Setup state is scoped to the new story session.

OpenRouter requests use providers that deny data collection. The artist and the continuity editor can be served by different hosting providers.

## Free routes checked on 15 November 2026

I found no currently verifiable free route intended for explicit fiction. OpenRouter still shows the historical [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free), but its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list and the ID was absent from the public model catalog. The paid variant is still listed. A catalog page alone does not establish that a hosted model is callable.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
