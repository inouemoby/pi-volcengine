# pi-volcengine

Register [Volcengine (火山引擎/火山方舟)](https://www.volcengine.com/docs/82379) as a provider for [pi coding agent](https://github.com/earendil-works/pi-mono). Automatically fetches all available coding models on startup.

## Install

```bash
pi install git:github.com/inouemoby/pi-volcengine
```

## Setup

Run `/volcengine-login` to configure your API Key:

```
/volcengine-login
→ Enter your API Key (ark-...)
```

Or set the environment variable:

```bash
export VOLCENGINE_API_KEY=ark-your-key-here
```

The API Key is stored in `~/.pi/agent/settings.json` under `volcengine.apiKey` and persists across sessions.

## What It Does

On session start, this extension:

1. Reads the API Key from environment variable or `settings.json`
2. Fetches the full model list from `ark.cn-beijing.volces.com/api/v3/models`
3. Filters to active coding-capable models (excludes embedding, image/video generation, etc.)
4. Auto-detects context window, vision support, and reasoning capability from model metadata
5. Registers `volcengine` as a provider with all discovered models

No hardcoded keys — each user provides their own via `/volcengine-login`.

## Available Models

Models are fetched dynamically at startup. New models appear automatically without plugin updates. Includes:

- **Doubao Seed 2.0** — pro, lite, mini, code
- **DeepSeek V4** — pro, flash
- **GLM 4.7**
- **Kimi K2** / K2 Thinking
- **Doubao Seed 1.8** / 1.6 series
- And more

## Capabilities

Each model is automatically configured with:

- **Vision** — models with image input modality accept image input
- **Reasoning** — models with `max_reasoning_token_length` support extended thinking
- **Context window** — auto-detected from `token_limits.context_window`
- **Cost** — free under Coding Plan subscription

## Commands

| Command | Description |
|---------|-------------|
| `/volcengine-login` | Set or update API Key |
| `/volcengine-logout` | Clear API Key |

## License

MIT
