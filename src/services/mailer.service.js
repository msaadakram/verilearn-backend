const nodemailer = require('nodemailer');

let gmailTransporter = null;

function getGmailTransporter() {
  if (gmailTransporter) {
    return gmailTransporter;
  }

  const gmailEmail = (process.env.GMAIL_EMAIL || '').trim();
  const gmailAppPassword = (process.env.GMAIL_APP_PASSWORD || '').trim();

  if (!gmailEmail || !gmailAppPassword) {
    const error = new Error('GMAIL_EMAIL and GMAIL_APP_PASSWORD are required.');
    error.statusCode = 500;
    throw error;
  }

  gmailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailEmail,
      pass: gmailAppPassword,
    },
  });

  return gmailTransporter;
}

function createResetCodeEmailHtml({ recipientName, code, expiresInMinutes }) {
  const safeName = recipientName || 'there';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a2332;">
      <h2 style="margin: 0 0 16px;">Reset your Verilearn password</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 20px;">Use the 6-digit verification code below to reset your password:</p>
      <div style="display: inline-block; padding: 14px 20px; border-radius: 10px; background: #f0f9f9; border: 1px solid #b3e1e3; font-size: 28px; letter-spacing: 6px; font-weight: 700; color: #1a2332;">
        ${code}
      </div>
      <p style="margin: 20px 0 12px;">This code expires in ${expiresInMinutes} minutes.</p>
      <p style="margin: 0; color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
}

function createEmailVerificationCodeHtml({ recipientName, code, expiresInMinutes }) {
  const safeName = recipientName || 'there';

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a2332;">
      <h2 style="margin: 0 0 16px;">Verify your Verilearn email</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 20px;">Use the 6-digit verification code below to activate your account:</p>
      <div style="display: inline-block; padding: 14px 20px; border-radius: 10px; background: #f0f9f9; border: 1px solid #b3e1e3; font-size: 28px; letter-spacing: 6px; font-weight: 700; color: #1a2332;">
        ${code}
      </div>
      <p style="margin: 20px 0 12px;">This code expires in ${expiresInMinutes} minutes.</p>
      <p style="margin: 0; color: #6b7280; font-size: 13px;">If you did not create an account, you can safely ignore this email.</p>
    </div>
  `;
}

async function sendPasswordResetCodeEmail({ recipientEmail, recipientName, code, expiresInMinutes }) {
  const gmailEmail = process.env.GMAIL_EMAIL || 'noreply@verilearn.com';
  const fromName = process.env.GMAIL_FROM_NAME || 'Verilearn';
  const transporter = getGmailTransporter();

  const htmlContent = createResetCodeEmailHtml({
    recipientName,
    code,
    expiresInMinutes,
  });

  const textContent = `Your Verilearn password reset code is ${code}. This code expires in ${expiresInMinutes} minutes.`;

  await transporter.sendMail({
    from: `${fromName} <${gmailEmail}>`,
    to: recipientEmail,
    replyTo: gmailEmail,
    subject: 'Your Verilearn password reset code',
    html: htmlContent,
    text: textContent,
  });
}

async function sendEmailVerificationCodeEmail({ recipientEmail, recipientName, code, expiresInMinutes }) {
  const gmailEmail = process.env.GMAIL_EMAIL || 'noreply@verilearn.com';
  const fromName = process.env.GMAIL_FROM_NAME || 'Verilearn';
  const transporter = getGmailTransporter();

  const htmlContent = createEmailVerificationCodeHtml({
    recipientName,
    code,
    expiresInMinutes,
  });

  const textContent = `Your Verilearn email verification code is ${code}. This code expires in ${expiresInMinutes} minutes.`;

  await transporter.sendMail({
    from: `${fromName} <${gmailEmail}>`,
    to: recipientEmail,
    replyTo: gmailEmail,
    subject: 'Verify your Verilearn account',
    html: htmlContent,
    text: textContent,
  });
}

module.exports = {
  sendPasswordResetCodeEmail,
  sendEmailVerificationCodeEmail,
};
