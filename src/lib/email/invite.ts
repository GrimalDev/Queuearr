import nodemailer, { Transporter } from 'nodemailer';

interface QueuearrInviteEmailParams {
  to: string;
  queuearrUrl: string;
}

let smtpTransporter: Transporter | null = null;

export class InviteEmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteEmailConfigurationError';
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InviteEmailConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseSmtpPort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InviteEmailConfigurationError('SMTP_PORT must be a positive integer');
  }
  return parsed;
}

function getInviteTransporter(): Transporter {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const host = requireEnv('SMTP_HOST');
  const port = parseSmtpPort(requireEnv('SMTP_PORT'));
  const user = requireEnv('SMTP_USER');
  const pass = requireEnv('SMTP_PASS');

  const secureEnv = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureEnv ? secureEnv === 'true' : port === 465;

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return smtpTransporter;
}

function buildInviteText(queuearrUrl: string): string {
  return [
    'You have been invited to Queuearr.',
    '',
    'Please follow these 3 steps in order:',
    '1) Create or sign in to your Plex account at https://app.plex.tv',
    '2) Accept the Plex library invitation from the Plex email/notifications',
    `3) Open Queuearr and sign in with Plex: ${queuearrUrl}`,
    '',
    'If you do step 3 before accepting the Plex invite, your access may not be ready yet.',
    '',
    '---',
    'TIP: Add Queuearr to your home screen for a native app experience.',
    '',
    'On iPhone / iPad (Safari):',
    `  1. Open ${queuearrUrl} in Safari`,
    '  2. Tap the Share button (rectangle with arrow at the bottom)',
    '  3. Scroll down and tap "Add to Home Screen"',
    '  4. Tap "Add" — Queuearr will appear on your home screen',
    '',
    'On Android (Chrome):',
    `  1. Open ${queuearrUrl} in Chrome`,
    '  2. Tap the three-dot menu (⋮) in the top-right corner',
    '  3. Tap "Add to Home screen"',
    '  4. Tap "Add" — Queuearr will appear on your home screen',
  ].join('\n');
}

function buildInviteHtml(queuearrUrl: string): string {
  return `
    <p>You have been invited to <strong>Queuearr</strong>.</p>
    <p>Please follow these <strong>3 steps</strong> in order:</p>
    <ol>
      <li>Create or sign in to your Plex account at <a href="https://app.plex.tv">app.plex.tv</a></li>
      <li>Accept the Plex library invitation from the Plex email/notifications</li>
      <li>Open Queuearr and sign in with Plex: <a href="${queuearrUrl}">${queuearrUrl}</a></li>
    </ol>
    <p>If you do step 3 before accepting the Plex invite, your access may not be ready yet.</p>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />

    <p><strong>💡 Tip: Add Queuearr to your home screen</strong> for a native app-like experience.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td width="50%" valign="top" style="padding-right:12px">
          <p style="margin:0 0 6px"><strong>🍎 iPhone / iPad (Safari)</strong></p>
          <ol style="margin:0;padding-left:20px;line-height:1.7">
            <li>Open <a href="${queuearrUrl}">${queuearrUrl}</a> in <strong>Safari</strong></li>
            <li>Tap the <strong>Share</strong> button (rectangle with arrow at the bottom of the screen)</li>
            <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
            <li>Tap <strong>"Add"</strong> — Queuearr will appear on your home screen</li>
          </ol>
        </td>
        <td width="50%" valign="top" style="padding-left:12px">
          <p style="margin:0 0 6px"><strong>🤖 Android (Chrome)</strong></p>
          <ol style="margin:0;padding-left:20px;line-height:1.7">
            <li>Open <a href="${queuearrUrl}">${queuearrUrl}</a> in <strong>Chrome</strong></li>
            <li>Tap the <strong>three-dot menu (⋮)</strong> in the top-right corner</li>
            <li>Tap <strong>"Add to Home screen"</strong></li>
            <li>Tap <strong>"Add"</strong> — Queuearr will appear on your home screen</li>
          </ol>
        </td>
      </tr>
    </table>
  `;
}

export async function sendQueuearrInviteEmail({
  to,
  queuearrUrl,
}: QueuearrInviteEmailParams): Promise<void> {
  const transporter = getInviteTransporter();
  const from = requireEnv('SMTP_FROM');

  await transporter.sendMail({
    from,
    to,
    subject: 'Queuearr invitation: complete these 3 steps',
    text: buildInviteText(queuearrUrl),
    html: buildInviteHtml(queuearrUrl),
  });
}
