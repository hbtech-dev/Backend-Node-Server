const nodemailer = require('nodemailer');

// Initialize Nodemailer Transporter
const createTransporter = () => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass || pass === 'YOUR_SMTP_APP_PASSWORD_HERE') {
    return null; // Return null if SMTP not configured yet
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: {
      user,
      pass
    }
  });
};

/**
 * Base Email Sender Helper
 */
async function sendEmail({ to, subject, html, text }) {
  try {
    const transporter = createTransporter();
    const from = process.env.EMAIL_FROM || 'Eder App <support@ederapp.de>';

    if (!transporter) {
      console.log(`ℹ️ [Email Simulation] To: ${to} | Subject: "${subject}"`);
      return { success: true, simulated: true };
    }

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || subject,
      html
    });

    console.log(`✉️ Email sent to ${to} (Message ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 1. Welcome Registration Email (7-Day Trial Started)
 */
async function sendWelcomeEmail(user) {
  const subject = 'Welcome to Eder App! Your 7-Day Free Trial Has Started ⚡';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 24px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 24px;">Welcome to Eder App! 🚀</h1>
        <p style="margin-top: 8px; font-size: 14px; opacity: 0.9;">Multichannel Shipping & Label Management System</p>
      </div>
      <div style="padding: 24px; color: #334155;">
        <p style="font-size: 16px;">Hello <strong>${user.companyName || user.email.split('@')[0]}</strong>,</p>
        <p>Thank you for signing up for <strong>Eder App</strong>! Your account has been initialized with a <strong>7-Day Full Access Free Trial</strong>.</p>
        
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #1e293b; font-size: 15px;">⚡ Included in Your Trial:</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; color: #475569;">
            <li>Full Temu & eBay Multi-Store Integration</li>
            <li>DHL & FedEx Express Label Generation</li>
            <li>Automatic Order Syncing & PDF Invoices</li>
            <li>Unlimited Access for 7 Days</li>
          </ul>
        </div>

        <p style="text-align: center; margin: 28px 0;">
          <a href="https://ederapp.de/dashboard" style="background: #4f46e5; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">Go to Dashboard →</a>
        </p>

        <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">If you have any questions, reply to this email or contact support@ederapp.de</p>
      </div>
    </div>
  `;
  return sendEmail({ to: user.email, subject, html });
}

/**
 * 2. Payment Receipt Email (Card Top-Up)
 */
async function sendPaymentReceiptEmail(user, invoice) {
  const subject = `Payment Receipt - Invoice #${invoice.number} [€${parseFloat(invoice.amount).toFixed(2)}]`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: #0f172a; padding: 24px; color: #ffffff; text-align: center;">
        <h2 style="margin: 0; font-size: 20px;">Payment Receipt 💳</h2>
        <p style="margin-top: 4px; font-size: 13px; color: #94a3b8;">Eder App Shipping Credit Top-Up</p>
      </div>
      <div style="padding: 24px; color: #334155;">
        <p>Dear <strong>${user.companyName || user.email}</strong>,</p>
        <p>We have successfully processed your card payment. Below are your transaction details:</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 0; color: #64748b;">Invoice Number:</td>
            <td style="padding: 8px 0; font-weight: bold; text-align: right;">${invoice.number}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 0; color: #64748b;">Date:</td>
            <td style="padding: 8px 0; text-align: right;">${new Date(invoice.date).toLocaleDateString('de-DE')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 0; color: #64748b;">Payment Method:</td>
            <td style="padding: 8px 0; text-align: right;">${invoice.paymentMethod || 'Stripe Card (Sandbox)'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 0; color: #64748b;">Transaction Reference:</td>
            <td style="padding: 8px 0; text-align: right; font-family: monospace;">${invoice.stripePaymentId || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-weight: bold; font-size: 16px;">Total Charged:</td>
            <td style="padding: 12px 0; font-weight: bold; font-size: 18px; color: #10b981; text-align: right;">€${parseFloat(invoice.amount).toFixed(2)}</td>
          </tr>
        </table>

        <p style="text-align: center; margin: 24px 0;">
          <a href="https://ederapp.de/invoices" style="background: #0f172a; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px; display: inline-block;">View & Download PDF Invoice →</a>
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: user.email, subject, html });
}

/**
 * 3. Subscription Plan Upgrade Email
 */
async function sendSubscriptionUpdateEmail(user, planName, invoice) {
  const subject = `Subscription Confirmed: ${planName.toUpperCase()} Plan 🎉`;
  const amountStr = invoice ? `€${parseFloat(invoice.amount).toFixed(2)}` : '0.00 €';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 24px; color: #ffffff; text-align: center;">
        <h2 style="margin: 0; font-size: 22px;">Subscription Confirmed! 💎</h2>
        <p style="margin-top: 6px; font-size: 14px; opacity: 0.95;">You are now on the <strong>${planName.toUpperCase()} Plan</strong></p>
      </div>
      <div style="padding: 24px; color: #334155;">
        <p>Hello <strong>${user.companyName || user.email}</strong>,</p>
        <p>Your subscription plan has been successfully updated to <strong>${planName.toUpperCase()} Plan</strong> (${amountStr}/month).</p>

        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 20px 0; color: #166534;">
          <h4 style="margin: 0 0 8px 0; font-size: 14px;">Plan Highlights & Quota:</h4>
          <p style="margin: 0; font-size: 13px;">Included Monthly Shipping Labels: <strong>${user.subscription?.labelsLimit || 100} labels</strong></p>
          <p style="margin: 4px 0 0 0; font-size: 13px;">Renewal Date: <strong>${new Date(user.subscription?.renewDate || Date.now() + 30*24*60*60*1000).toLocaleDateString('de-DE')}</strong></p>
        </div>

        <p style="text-align: center; margin: 24px 0;">
          <a href="https://ederapp.de/dashboard" style="background: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">Return to Dashboard →</a>
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: user.email, subject, html });
}

/**
 * 4. Trial Warning / Expiration Email
 */
async function sendTrialWarningEmail(user, daysLeft) {
  const isExpired = daysLeft <= 0;
  const subject = isExpired
    ? '⚠️ Action Required: Your 7-Day Free Trial Has Expired'
    : `⚡ Reminder: Your 7-Day Free Trial Ends in ${daysLeft} Day(s)`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: ${isExpired ? '#dc2626' : '#d97706'}; padding: 24px; color: #ffffff; text-align: center;">
        <h2 style="margin: 0; font-size: 20px;">${isExpired ? 'Trial Expired — Account Locked 🔒' : 'Trial Ending Soon ⚡'}</h2>
      </div>
      <div style="padding: 24px; color: #334155;">
        <p>Dear <strong>${user.companyName || user.email}</strong>,</p>
        <p>${isExpired 
          ? 'Your 7-day free trial on Eder App has expired. Order creation, label printing, and store synchronization are currently locked.' 
          : `Your 7-day free trial will end in <strong>${daysLeft} day(s)</strong>. Upgrade to a plan today to ensure your stores remain synced without interruption.`}</p>

        <p style="text-align: center; margin: 28px 0;">
          <a href="https://ederapp.de/pricing" style="background: ${isExpired ? '#dc2626' : '#d97706'}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">Select a Plan Now →</a>
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: user.email, subject, html });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendPaymentReceiptEmail,
  sendSubscriptionUpdateEmail,
  sendTrialWarningEmail
};
