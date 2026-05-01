const { MailerSend, EmailParams, Sender, Recipient } = require('mailersend');

function getMailerSendClient() {
  if (!process.env.MAILERSEND_API_KEY || !process.env.MAILERSEND_API_KEY.trim()) {
    const error = new Error('MAILERSEND_API_KEY is missing.');
    error.statusCode = 500;
    throw error;
  }

  return new MailerSend({
    apiKey: process.env.MAILERSEND_API_KEY.trim(),
  });
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
  const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'info@domain.com';
  const fromName = process.env.MAILERSEND_FROM_NAME || 'Verilearn';
  const mailerSend = getMailerSendClient();

  const sentFrom = new Sender(fromEmail, fromName);
  const recipients = [new Recipient(recipientEmail, recipientName || recipientEmail)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setReplyTo(sentFrom)
    .setSubject('Your Verilearn password reset code')
    .setHtml(
      createResetCodeEmailHtml({
        recipientName,
        code,
        expiresInMinutes,
      }),
    )
    .setText(
      `Your Verilearn password reset code is ${code}. This code expires in ${expiresInMinutes} minutes.`,
    );

  await mailerSend.email.send(emailParams);
}

async function sendEmailVerificationCodeEmail({ recipientEmail, recipientName, code, expiresInMinutes }) {
  const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'info@domain.com';
  const fromName = process.env.MAILERSEND_FROM_NAME || 'Verilearn';
  const mailerSend = getMailerSendClient();

  const sentFrom = new Sender(fromEmail, fromName);
  const recipients = [new Recipient(recipientEmail, recipientName || recipientEmail)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setReplyTo(sentFrom)
    .setSubject('Verify your Verilearn account')
    .setHtml(
      createEmailVerificationCodeHtml({
        recipientName,
        code,
        expiresInMinutes,
      }),
    )
    .setText(
      `Your Verilearn email verification code is ${code}. This code expires in ${expiresInMinutes} minutes.`,
    );

  await mailerSend.email.send(emailParams);
}

module.exports = {
  sendPasswordResetCodeEmail,
  sendEmailVerificationCodeEmail,
};
