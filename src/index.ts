import express, { Request, Response } from "express";
import crypto from "crypto";
import dotenv from "dotenv";

type KenerPayload = {
    id?: string;
    alert_name?: string;
    severity?: string;
    status?: string; // TRIGGERED / RESOLVED etc
    source?: string;
    timestamp?: string;
    description?: string;
    details?: {
        metric?: string;
        current_value?: number | string;
        threshold?: number | string;
        [k: string]: unknown;
    };
    actions?: Array<{ text?: string; url?: string }>;
    [k: string]: unknown;
};

dotenv.config();

type AppConfig = {
    port: number;
    kenerWebhookSecret: string;
    telegramBotToken: string;
    telegramChatId: string;
};

function loadConfig(): AppConfig {
    const portRaw = (process.env.PORT || "3000").trim();
    const port = Number(portRaw);
    if (!Number.isFinite(port) || port <= 0) {
        throw new Error(`Invalid PORT value "${portRaw}"`);
    }

    const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!telegramBotToken) {
        throw new Error("Missing TELEGRAM_BOT_TOKEN");
    }

    const telegramChatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (!telegramChatId) {
        throw new Error("Missing TELEGRAM_CHAT_ID");
    }

    return {
        port,
        kenerWebhookSecret: (process.env.KENER_WEBHOOK_SECRET || "").trim(),
        telegramBotToken,
        telegramChatId,
    };
}

const config = (() => {
    try {
        return loadConfig();
    } catch (err) {
        console.error(`[config] ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
        throw err;
    }
})();

const app = express();

// Keep payload small and safe.
app.use(express.json({ limit: "256kb" }));

function timingSafeEq(a: string, b: string): boolean {
    const ba = Buffer.from(a || "", "utf8");
    const bb = Buffer.from(b || "", "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function escapeHtml(s: string): string {
    return (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function pickAction(p: KenerPayload): { text: string; url: string } {
    const a =
        Array.isArray(p.actions) && p.actions.length ? p.actions[0] : undefined;
    return { text: a?.text || "Open", url: a?.url || "" };
}

function normalize(p: KenerPayload) {
    const action = pickAction(p);
    const details = (p.details ?? {}) as NonNullable<KenerPayload["details"]>;

    return {
        id: p.id || "",
        alertName: p.alert_name || "Alert",
        severity: p.severity || "unknown",
        status: p.status || "UNKNOWN",
        source: p.source || "Kener",
        timestamp: p.timestamp || new Date().toISOString(),
        description: (p.description || "").toString(),
        metric: (details.metric || "").toString(),
        currentValue: details.current_value ?? null,
        threshold: details.threshold ?? null,
        actionText: action.text,
        actionUrl: action.url,
    };
}

function formatTime(iso: string): string {
    try {
        return (
            new Date(iso).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
            }) + " UTC"
        );
    } catch {
        return iso;
    }
}

function buildTelegramMessage(k: ReturnType<typeof normalize>): string {
    const statusEmoji =
        k.status === "TRIGGERED" ? "🚨" : k.status === "RESOLVED" ? "✅" : "ℹ️";
    const severityEmoji =
        k.severity === "critical"
            ? "🔴"
            : k.severity === "warning"
            ? "🟠"
            : "🟢";

    const lines: string[] = [];
    lines.push(`<b>${escapeHtml(`${statusEmoji} ${k.alertName}`)}</b>`);

    if (k.description) {
        lines.push("");
        lines.push(escapeHtml(k.description));
    }

    lines.push("");
    lines.push(
        `${severityEmoji} <b>Severity:</b> <code>${escapeHtml(
            k.severity
        )}</code>`
    );
    lines.push(`<b>Status:</b> <code>${escapeHtml(k.status)}</code>`);
    if (k.source)
        lines.push(`<b>Source:</b> <code>${escapeHtml(k.source)}</code>`);
    if (k.metric)
        lines.push(`<b>Monitor:</b> <code>${escapeHtml(k.metric)}</code>`);
    if (k.currentValue !== null)
        lines.push(
            `<b>Current:</b> <code>${escapeHtml(String(k.currentValue))}</code>`
        );
    if (k.threshold !== null)
        lines.push(
            `<b>Threshold:</b> <code>${escapeHtml(String(k.threshold))}</code>`
        );
    if (k.timestamp)
        lines.push(
            `<b>Time:</b> <code>${escapeHtml(formatTime(k.timestamp))}</code>`
        );
    if (k.actionUrl)
        lines.push(
            `\n<a href="${escapeHtml(k.actionUrl)}">${escapeHtml(
                k.actionText
            )}</a>`
        );

    return lines.join("\n");
}

const TELEGRAM_PARSE_MODE = "HTML";

async function sendTelegram(
    text: string,
    cfg: Pick<AppConfig, "telegramBotToken" | "telegramChatId">
): Promise<void> {
    const url = `https://api.telegram.org/bot${cfg.telegramBotToken}/sendMessage`;

    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: cfg.telegramChatId,
            text,
            parse_mode: TELEGRAM_PARSE_MODE,
            disable_web_page_preview: true,
        }),
    });

    // Telegram returns JSON with { ok: boolean, ... }
    const data = (await resp.json().catch(() => null)) as any;
    if (!resp.ok || !data?.ok) {
        throw new Error(
            `Telegram sendMessage failed: HTTP ${
                resp.status
            } body=${JSON.stringify(data)}`
        );
    }
}

app.get("/health", (_req: Request, res: Response) =>
    res.status(200).send("ok")
);

app.post("/", (req: Request, res: Response) => {
    // Optional inbound auth (recommended)
    if (config.kenerWebhookSecret) {
        const got = (req.header("x-kener-token") || "").trim();
        if (!timingSafeEq(got, config.kenerWebhookSecret)) {
            return res.status(401).json({ ok: false, error: "invalid token" });
        }
    }

    // ACK immediately
    res.status(200).json({ ok: true });

    // Fan-out async (just Telegram)
    const payload = req.body as KenerPayload;
    const k = normalize(payload);
    const msg = buildTelegramMessage(k);

    void sendTelegram(msg, config).catch((err) => {
        console.error("[relay] telegram error:", err?.message || err);
    });
});

app.listen(config.port, () => {
    console.log(`kener-telegram-relay listening on :${config.port}`);
});
