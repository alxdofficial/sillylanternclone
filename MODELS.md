# Models to try for fictional adult writing

OpenRouter catalog checked 15 November 2026. The table reflects model descriptions and listed prices, not an independent writing or refusal benchmark. Prices are USD per million input / output tokens. A 10,000-token prompt and 1,000-token reply at Cydonia's listed rate would cost about $0.0035, before any other charges.

| Model | First job I'd try | Context listed | Input / output |
| --- | --- | ---: | ---: |
| [Cydonia 24B v4.1](https://openrouter.ai/thedrummer/cydonia-24b-v4.1) | First pick for dialogue and prose. The model is tuned for creative writing and described as less restrictive. | 131K | $0.30 / $0.50 |
| [Venice Dolphin Mistral 24B](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition) | Compare if steerability and fewer refusals are the priority. Its description emphasizes those goals. | 128K | $0.20 / $0.90 |
| [Euryale 70B v2.2](https://openrouter.ai/sao10k/l3.1-euryale-70b) | Compare if distinct voices and sustained roleplay matter more than cost. It is a roleplay-focused fine-tune. | 131K | $0.85 / $0.85 |

These are candidates for stories about fictional adults. Model tuning and the serving provider both affect behavior. OpenRouter's [SillyTavern guide](https://openrouter.ai/blog/tutorials/sillytavern-openrouter/) discusses provider filtering. Listing a model does not guarantee availability with Story Studio's data-collection restriction. The three options above are in the Connection dialog, or enter any supported model ID yourself.

To compare them, start with the same small story bible and scene direction. Check whether each keeps the characters' voices distinct, follows the requested POV, remembers a continuity detail, leaves room for the writer's next move, and honors the requested tone. Pick on that evidence before buying more credits.

For local inference, a [quantized Cydonia GGUF](https://huggingface.co/bartowski/TheDrummer_Cydonia-24B-v4.1-GGUF) can run with llama.cpp on a machine with enough memory for the weights and context. This avoids hosted inference charges and sends no draft to a hosted model. Story Studio currently has no local-model adapter. [SillyTavern already supports both llama.cpp and OpenRouter](https://docs.sillytavern.app/usage/api-connections/).
