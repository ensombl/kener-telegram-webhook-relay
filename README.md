# kener-telegram-relay

A tiny Express + TypeScript service that receives [Kener](https://kener.io/) webhook events and relays them to a Telegram chat with nicely formatted HTML notifications.

## Features

-   Validates incoming webhook tokens via `x-kener-token` header (optional but recommended).
-   Normalizes Kener payloads and builds HTML-rich Telegram messages.
-   Includes `/health` endpoint for readiness checks.
-   Ships with pnpm/TypeScript boilerplate, VS Code debug config, Dockerfile, and docker-compose with healthcheck.

## Requirements

-   Node.js 22+
-   pnpm
-   Telegram Bot token and target chat ID

## Getting started

```bash
pnpm install
cp .env.example .env
# edit .env with your secrets
pnpm start
```

The default server listens on `http://localhost:3000`.

### Environment variables

| Name                   | Description                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `PORT`                 | Port Express listens on (default `3000`).                                              |
| `KENER_WEBHOOK_SECRET` | Shared secret matched against the `x-kener-token` header. Leave blank to disable auth. |
| `TELEGRAM_BOT_TOKEN`   | Telegram Bot API token. Required.                                                      |
| `TELEGRAM_CHAT_ID`     | Destination chat/channel ID. Required.                                                 |

## Development scripts

| Command      | Description                                    |
| ------------ | ---------------------------------------------- |
| `pnpm start` | Runs the TypeScript entrypoint with `ts-node`. |
| `pnpm build` | Produces transpiled output in `dist/`.         |

## Debugging in VS Code

Press **F5** and choose **Debug kener-telegram-relay**. The debugger launches Node with `ts-node/register`, so breakpoints in `.ts` files work out of the box.

## Docker usage

Build and run with Docker Compose:

```bash
docker compose up -d --build
```

The compose file expects a `.env` sitting next to it (copy from `.env.example`). A health check hits `/health` every 30 seconds. To tail logs:

```bash
docker compose logs -f app
```

You can also build manually:

```bash
docker build -t kener-telegram-relay .
docker run --env-file .env -p 3000:3000 kener-telegram-relay
```

## Webhook endpoints

| Method | Path      | Purpose                                                   |
| ------ | --------- | --------------------------------------------------------- |
| `GET`  | `/health` | Returns `ok` for health checks.                           |
| `POST` | `/`       | Accepts a Kener webhook payload and forwards to Telegram. |

## Testing the relay locally

```bash
curl -X POST http://localhost:3000/ \
  -H "Content-Type: application/json" \
  -H "x-kener-token: ${KENER_WEBHOOK_SECRET}" \
  -d '{
        "id": "demo-1",
        "alert_name": "CPU high",
        "status": "TRIGGERED",
        "severity": "critical"
      }'
```

Check Telegram for the formatted message.

## Project structure

```
├── src/index.ts          # Express app + Telegram relay logic
├── tsconfig.json         # TypeScript compiler settings
├── .vscode/launch.json   # VS Code debug config
├── Dockerfile            # Multi-stage container build
├── docker-compose.yml    # Local orchestration with health check
└── .env.example          # Documented environment variables
```

## License

MIT
