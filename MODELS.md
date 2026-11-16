# OpenRouter models

In **Progress the story**, choose the **Prose artist** and **Continuity agent** separately. Economy and Preferred labels appear beside applicable models in both pickers and in **Editor agent**. Marking a **Sensitive scene** switches continuity to the sensitive model list and limits the writing route to the labeled writers. The settings remember the normal and sensitive continuity choices separately.

In a 16 November 2026 retest through Story Studio, Cydonia and MythoMax each returned three of three replies tagged explicit on Parasail. DeepSeek V4.1 Flash returned two replies tagged explicit on Baidu and River. A third request on Cohere returned no prose. Cydonia has Story Studio’s 8,000-token prose limit. MythoMax was removed from the presets because its listed providers have context windows of 4,096 to 8,192 tokens. [MythoMax provider limits](https://openrouter.ai/api/v1/models/gryphe/mythomax-l2-13b/endpoints)

The rates were checked on 16 November 2026 and can vary by host. The **Prose artist** menu estimates cost for a chapter of 2,000 billed input and 5,000 billed output tokens. Continuity calls add a separate charge, and extra context, retries, or splitting a chapter into multiple turns can add input tokens. [OpenRouter public catalog](https://openrouter.ai/api/v1/models)

| Model | Role or tier | Context floor | USD per million input / output |
| --- | --- | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | NSFW-friendly writer | 131,072 | $0.30 / $0.50 |
| [Dolphin Mistral 24B Venice](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition) | NSFW-friendly writer | 128,000 | $0.20 / $0.90 |
| [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) | Economy, sensitive continuity | 1,000,000 | $0.14 / $0.42 |
| [GLM 5.3 Flash](https://openrouter.ai/z-ai/glm-5.3-flash) | Economy | 262,000 | $0.0399 / $0.0784 |
| [Xiaomi MiMo-V2.6-Flash](https://openrouter.ai/xiaomi/mimo-v2.6-flash) | Economy | 1,000,000 | $0.10 / $0.28 |
| [MiniMax M3.1 Flash](https://openrouter.ai/minimax/minimax-m3.1-flash) | Economy | 1,000,000 | $0.075 / $0.30 |
| [GPT-6.1 Terra](https://openrouter.ai/openai/gpt-6.1-terra) | Preferred | 1,050,000 | $1.00 / $5.00 |
| [Gemini 4 Hydrogen](https://openrouter.ai/google/gemini-4-hydrogen) | Preferred | 1,048,576 | $1.50 / $7.50 |
| [Claude Sonnet 5.5](https://openrouter.ai/anthropic/claude-sonnet-5.5) | Preferred | 1,000,000 | $2.00 / $10.00 |
| [Qwen4 Max](https://openrouter.ai/qwen/qwen4-max) | Preferred | 1,000,000 | $1.50 / $4.50 |
| [Mistral Large 4](https://openrouter.ai/mistralai/mistral-large-4-0) | Sensitive continuity | 524,288 | $0.70 / $2.10 |
| [Grok 4.7](https://openrouter.ai/x-ai/grok-4.7) | Sensitive continuity | 500,000 | $2.00 / $6.00 |
| [GLM 5.3](https://openrouter.ai/z-ai/glm-5.3) | Preferred | 262,144 | $0.0699 / $1.40 |
| [Kimi K3.1 Pro](https://openrouter.ai/moonshotai/kimi-k3.1-pro) | Preferred | 409,600 | $0.2403 / $8.4023 |
| [Gemini 4 Carbon](https://openrouter.ai/google/gemini-4-carbon) | Preferred | 1,048,576 | $2.00 / $10.00 |

The Mistral Large 4 OpenRouter ID is **mistralai/mistral-large-4-0**. The sensitive continuity choices have listed tool-capable providers. The presets reflect application routing choices and provider capabilities. The earlier live prose test covered Cydonia and DeepSeek, and provider moderation or refusals can vary.

The state-editing routes use OpenRouter's native function calls. The selected provider needs to support tools. Availability varies with the model, host, and your provider settings. [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)

The context column gives the conservative window used for each model. Story Studio budgets a smaller prompt and keeps up to an estimated 16,000 tokens of recent eligible prose. The same story can grow over time as more of its continuity is carried in notes and relationship events.

Choose **Writer → Manage custom models…** to add an OpenRouter model by ID or remove it from your browser. Custom models are selectable as writers in **Progress the story** or for setup chat. These uses only require ordinary text completions. Choose a supported Editor agent preset for direct story edits.

To compare, use the same short scene with consenting fictional adults and the same direction. Check whether each model follows the point of view, keeps the voices distinct, and maintains the desired level of detail. Review the [provider routing guidance](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) if a request is unavailable or rejected. Story Studio requests providers that deny data collection, which can narrow availability.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. Story Studio currently has no local-model adapter. [SillyTavern supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).

## What Story Studio sends and expects

### Progress the story

The writer receives narrator instructions, full cast and world information, writing notes, the current graph, eligible recent story, and your current direction. It returns plain prose. Built-in writers share 112,000 estimated input tokens. Recent prose uses up to 16,000 within that budget, and the writer has a separate 8,000-token output reserve. User-added models use a conservative 28,000 input and 2,048 output until Studio has a verified window. Click the context ring at the lower left of the composer to see the assembled writing messages.

An NSFW-friendly writer can receive sensitive history for turns marked **Sensitive scene**. The marked direction stays explicit even if the later classification suggests otherwise. **Exclude this turn’s text from all AI prompts** also withholds that turn from the sensitive writer. Automatic classification occurs after the artist receives the direction, so use **Sensitive scene** whenever you intend to request sensitive content.

The selected continuity agent gets the new direction and draft, full current story state, and eligible prior exchanges. It can inspect state and calls `record_scene` to classify the new material, infer a time, and propose durable non-explicit updates. Explicit standing style preferences go in writing notes. The call can take multiple tool rounds. [OpenRouter client tools](https://openrouter.ai/docs/guides/features/tool-calling)

Both direction and draft must be labeled non-explicit for automatic updates. Proposals from sensitive or unverified scenes require review before they enter shared continuity. If the artist reaches its output limit, Story Studio keeps and classifies the partial draft and leaves map updates empty. If the continuity pass fails, the prose is still saved and the unverified text stays outside general model context. A provider refusal leaves the direction available to edit or retry. Alternates and rewrites retain the original time and do not record new graph facts.

### Story Flow

The **Suggest directions** icon above the composer starts Story Flow in Write. The selected continuity model returns three or four next beats through a dedicated function using eligible story context and available non-explicit continuity. After a successful scene, Studio requests new directions if you chose a suggestion or wrote your own direction with an active OpenRouter offer. If the suggestion call fails, the scene stays in the manuscript.

### Editor agent

The selected model receives your edit request, full canonical state, and eligible history. The input threshold is 90% of its configured window minus the 8,192-token output reserve. Studio removes complete older exchanges in batches of about 30% of the window when it reaches the threshold. Current state stays in the prompt, and removed prompt history stays in the local library. Retained prose, reviewed setup notes, and approved tool outcomes can form a stable prefix. Longer scopes, active tool replies, and reasoning still consume provider context. The final tool applies a revision-checked edit to story metadata. [OpenRouter caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)

### New story setup

Setup runs through the same agent runner. The selected model responds conversationally while you brainstorm. When you click **Prepare setup draft**, a supported Editor agent preset calls `prepare_story_setup` with fields for the proposed story. If your chat model is outside those presets, the wizard shows that DeepSeek V4.1 Flash will prepare the draft. The app validates the draft and stages it for review. The inputs are the complete planning chat, reference notes, and attached manuscript. When the source fits the selected model’s window, setup sends it in one prompt. Otherwise **Prepare setup draft** reads consecutive sections, collects structured story and author notes, and synthesizes an editable draft. Chunked setup can bill multiple calls. After setup, approved material is eligible as early history on the OpenRouter agent path.

Story Studio asks OpenRouter to route each request to endpoints with `data_collection: "deny"`. The artist and continuity calls can reach different hosts. The structured runner allows up to four model rounds, validates the arguments locally, and accepts one final batch. A browser disconnect cancels unfinished upstream calls on a best-effort basis. Requests already processed can still be billed. [Provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection)

## Free routes checked on 15 November 2026

The 15 November check found no verifiable free route intended for explicit fiction. The [Venice Dolphin free model card](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free) was visible, its [provider endpoint response](https://openrouter.ai/api/v1/models/cognitivecomputations/dolphin-mistral-24b-venice-edition:free/endpoints) returned an empty list, and the ID was absent from the public catalog. The paid variant was listed. Use the live endpoint listing to check present availability.

The public [Free Models collection](https://openrouter.ai/collections/free-models/) has models suitable for ordinary drafting. For example, [Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it:free) is listed, but its [model card](https://ai.google.dev/gemma/docs/core/model_card_4) documents safeguards for sexually explicit content. Free endpoints can rotate and still require an OpenRouter key. Content behavior on the free routes was not tested.
