export type DiscordResult = { ok: boolean; error?: string };

export type DiscordAlertMessage = {
  alertName: string;
  alertType: string;
  productName: string;
  setName: string;
  imageUrl?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  pctChange?: number | null;
  detail?: string;
  productUrl: string;
};

/** Post an alert embed to a store's Discord webhook. Never throws. */
export async function sendDiscordAlert(
  webhookUrl: string,
  msg: DiscordAlertMessage
): Promise<DiscordResult> {
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (msg.oldPrice != null && msg.newPrice != null) {
    fields.push({
      name: "Price",
      value: `$${msg.oldPrice.toFixed(2)} → **$${msg.newPrice.toFixed(2)}**`,
      inline: true,
    });
  } else if (msg.newPrice != null) {
    fields.push({ name: "Price", value: `$${msg.newPrice.toFixed(2)}`, inline: true });
  }
  if (msg.pctChange != null) {
    fields.push({
      name: "Change",
      value: `${msg.pctChange > 0 ? "+" : ""}${msg.pctChange.toFixed(1)}%`,
      inline: true,
    });
  }
  if (msg.detail) fields.push({ name: "Detail", value: msg.detail });

  const body = {
    embeds: [
      {
        title: `🔔 ${msg.alertName}`,
        description: `**${msg.productName}** · ${msg.setName}\n[View product](${msg.productUrl})`,
        color: msg.pctChange != null && msg.pctChange < 0 ? 0xdc2626 : 0x16a34a,
        fields,
        thumbnail: msg.imageUrl ? { url: msg.imageUrl } : undefined,
        footer: { text: `Countertop · ${msg.alertType}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `Discord webhook HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
