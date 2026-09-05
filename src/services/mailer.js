// Sends the app's emails (verification, invitation, and a test email).
const MAIL_FROM = process.env.MAIL_FROM || 'Security Console <no-reply@localhost>';

function resendConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT);
}

// True if some delivery path is set up at all (used by the admin "status" panel).
function emailConfigured() {
  return resendConfigured() || smtpConfigured();
}

async function deliverViaResend({ to, subject, text }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to, subject, text }),
    });
    if (res.ok) return { delivered: true };
    const body = await res.text().catch(() => '');
    return { delivered: false, error: `Resend API error ${res.status}: ${body.slice(0, 300)}` };
  } catch (e) {
    return { delivered: false, error: `Could not reach Resend API: ${e.message}` };
  }
}

async function deliverViaSmtp({ to, subject, text }) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer'); // lazy: app runs even if not installed
  } catch (e) {
    return { delivered: false, error: 'The "nodemailer" package is not installed (run: npm i nodemailer).' };
  }

  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth:
        process.env.SMTP_USER || process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      connectionTimeout: 10000, // fail fast instead of hanging on a blocked/unreachable host
      greetingTimeout: 8000,
    });
    await transport.sendMail({ from: MAIL_FROM, to, subject, text });
    return { delivered: true };
  } catch (e) {
    return { delivered: false, error: e.message };
  }
}

// Single delivery path shared by every email. Returns a status object:
async function deliver({ to, subject, text, linkForLog }) {
  if (!emailConfigured()) {
    if (linkForLog) {
      console.log(`[mailer] No email delivery configured - link for ${to} (deliver manually):\n         ${linkForLog}`);
    }
    return { delivered: false, notConfigured: true, logged: !!linkForLog };
  }

  const result = resendConfigured()
    ? await deliverViaResend({ to, subject, text })
    : await deliverViaSmtp({ to, subject, text });

  if (!result.delivered) {
    console.error(`[mailer] Failed to send to ${to} (via ${resendConfigured() ? 'Resend API' : 'SMTP'}): ${result.error}`);
    if (linkForLog) console.error(`[mailer] Link (deliver manually): ${linkForLog}`);
  }
  return result;
}

function sendVerificationEmail(to, link) {
  return deliver({
    to,
    subject: 'Verify your Security Console account',
    text:
      `Welcome to the Security Console.\n\n` +
      `Please confirm your email address by opening this link:\n${link}\n\n` +
      `This link expires in 24 hours. If you didn't create this account, ignore this email.`,
    linkForLog: link,
  });
}

function sendInviteEmail(to, link) {
  return deliver({
    to,
    subject: "You've been invited to the Security Console",
    text:
      `An administrator invited you to the Security Console.\n\n` +
      `Activate your account and set a password here:\n${link}\n\n` +
      `This invitation expires in 7 days.`,
    linkForLog: link,
  });
}

function sendPasswordResetEmail(to, link) {
  return deliver({
    to,
    subject: 'Reset your Security Console password',
    text:
      `We received a request to reset the password for this account.\n\n` +
      `Choose a new password here:\n${link}\n\n` +
      `This link expires in 1 hour and can be used once. If you didn't request this, ignore this email - your password stays unchanged.`,
    linkForLog: link,
  });
}

function sendTestEmail(to) {
  return deliver({
    to,
    subject: 'Security Console - test email',
    text: 'This is a test email from your Security Console. If you received it, SMTP is configured correctly.',
  });
}

module.exports = {
  sendVerificationEmail,
  sendInviteEmail,
  sendPasswordResetEmail,
  sendTestEmail,
  smtpConfigured,
  resendConfigured,
  emailConfigured,
};
