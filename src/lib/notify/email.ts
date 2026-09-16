import { env } from "@/lib/env";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  /** printed to the server console when no RESEND_API_KEY is configured */
  consoleFallback?: string;
};

export type EmailResult = { ok: boolean; error?: string };

/**
 * Send an email via Resend when configured, else log to console.
 * Never throws - callers record the result (e.g. alert delivery status).
 */
export async function sendEmail({
  to,
  subject,
  html,
  consoleFallback,
}: SendEmailArgs): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) {
    console.log(
      consoleFallback ??
        `\n📧 [email:console-fallback] to=${to} subject="${subject}"\n${html}\n`
    );
    return { ok: true };
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
