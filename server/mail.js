import 'dotenv/config';
import nodemailer from 'nodemailer';

// =============================================================================
// SMTP mailer — used for transactional emails (meeting confirmations, etc).
// Lazy: built on first send. Falls back to a no-op log when not configured so
// the rest of the app keeps working in dev without SMTP creds.
// =============================================================================

const HOST   = process.env.SMTP_HOST || '';
const PORT   = Number(process.env.SMTP_PORT || 587);
const USER   = process.env.SMTP_USER || '';
const PASS   = process.env.SMTP_PASS || '';
const FROM   = process.env.SMTP_FROM || (USER ? `Voice Portal <${USER}>` : '');
// Some MTAs require explicit TLS for port 465. nodemailer auto-picks based on
// port but allow an override via SMTP_SECURE=true.
const SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === 'true'
  : PORT === 465;

export const mailConfigured = !!(HOST && USER && PASS && FROM);

let transporter = null;
const getTransporter = () => {
  if (!mailConfigured) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,
    auth: { user: USER, pass: PASS },
  });
  return transporter;
};

/**
 * sendMail({ to, subject, html, text, replyTo }) — returns the SMTP messageId.
 * Throws when mail isn't configured, so callers must check `mailConfigured` first
 * (or wrap with their own try/catch).
 */
export async function sendMail({ to, subject, html, text, replyTo, cc, bcc }) {
  const t = getTransporter();
  if (!t) throw new Error('Mailer not configured — set SMTP_HOST/PORT/USER/PASS/FROM in .env');
  if (!to)      throw new Error('sendMail: `to` is required');
  if (!subject) throw new Error('sendMail: `subject` is required');

  const info = await t.sendMail({
    from: FROM,
    to,
    cc, bcc,
    subject,
    html,
    text: text || (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
    replyTo,
  });
  return info.messageId;
}

export function mailFromAddress() {
  return FROM || null;
}
