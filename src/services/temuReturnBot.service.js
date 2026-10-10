const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const TemuReturn = require('../models/temuReturn.model');
const TemuOrder = require('../models/temuOrder.model');
const User = require('../models/user.model');
const temuSyncService = require('./temuSync.service');
const geminiService = require('./gemini.service');

// Optional Puppeteer lazy loader
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (_) {
  // Puppeteer not installed or optional
}

// In-memory bot execution log and state
const botState = {
  isRunning: false,
  isAutoActive: true,
  lastRunAt: null,
  totalProcessed: 0,
  autoApproveUnshipped: false, // Orders are NOT refunded - shipping in progress policy
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  aiCount: 0,
  logs: []
};

let botInterval = null;

/**
 * Generate a realistic DHL format dummy tracking number for orders lacking one
 */
const generateDummyTracking = (orderNum) => {
  const digits = (orderNum || '').replace(/\D/g, '');
  const suffix = digits.slice(-10).padStart(10, '8');
  return `00340434${suffix}`;
};

/**
 * Launch Puppeteer browser instance using available Chrome binary
 */
const launchBrowser = async () => {
  if (!puppeteer) {
    throw new Error('Puppeteer is not installed.');
  }

  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  let executablePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      break;
    }
  }

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  return await puppeteer.launch(launchOptions);
};

/**
 * Capture a screenshot of a return / dispute page
 */
const captureReturnScreenshot = async (url, options = {}) => {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const screenshotsDir = path.join(__dirname, '../../public/screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const filename = `return-${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);
    await page.screenshot({ path: filepath, fullPage: Boolean(options.fullPage) });

    return {
      success: true,
      filename,
      filepath,
      url: `/screenshots/${filename}`
    };
  } catch (err) {
    console.warn('Puppeteer screenshot capture warning:', err.message);
    return {
      success: false,
      error: err.message
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

/**
 * Evaluate the return situation based on DB order, return data, and Gemini AI analysis
 * POLICY: We do NOT refund orders. We inform the customer that due to shipping processing
 * the order is in progress, provide the shipping tracking number, and reassure them it will arrive ASAP.
 */
const evaluateReturnSituation = async (user, returnDoc) => {
  const orderNum = returnDoc.orderNum;
  const order = await TemuOrder.findOne({
    user: user._id,
    $or: [
      { orderNum: orderNum },
      { orderNum: orderNum.replace(/^PO-/i, '') },
      { orderNum: `PO-${orderNum.replace(/^PO-/i, '')}` }
    ]
  }).lean();

  let trackingNo = order?.tracking;
  if (!trackingNo || trackingNo.trim() === '') {
    trackingNo = generateDummyTracking(orderNum);
  }
  const carrier = order?.shippingMethod || 'DHL Paket';
  const refundAmount = Number(returnDoc.refundAmount || (order?.price) || 0).toFixed(2);
  const countryCode = (returnDoc.country || order?.country || 'DE').toUpperCase();

  const situation = 'SHIPPING_IN_PROGRESS';
  const description = `Order is in progress with ${carrier} tracking ${trackingNo}. Return/refund declined - delivery in progress.`;
  const recommendedAction = 'reject'; // NEVER refund - order is in progress

  // Localized human fallback messages in case Gemini AI is offline
  let defaultReply = `Hello, due to ongoing shipping logistics, your order is already in progress and on its way. Here is your ${carrier} tracking number: ${trackingNo}. Please check the tracking status, and your parcel will reach you as soon as possible. Best regards, Customer Care Team`;
  if (countryCode === 'DE' || countryCode === 'AT') {
    defaultReply = `Guten Tag, aufgrund der laufenden Versandlogistik ist Ihre Bestellung bereits in Bearbeitung und auf dem Weg zu Ihnen. Ihre Sendungsnummer lautet: ${trackingNo}. Bitte überprüfen Sie den Sendungsstatus – Ihre Sendung wird Sie schnellstmöglich erreichen. Viele Grüße, Ihr Kundenservice-Team`;
  } else if (countryCode === 'ES') {
    defaultReply = `Hola, debido a la gestión del envío, su pedido ya está en curso y en camino. Su número de seguimiento es: ${trackingNo}. Por favor, revise el estado del envío; su paquete le llegará lo antes posible. Atentamente, Equipo de Atención al Cliente`;
  } else if (countryCode === 'FR') {
    defaultReply = `Bonjour, en raison du traitement logistique en cours, votre commande est déjà en cours d'acheminement. Voici votre numéro de suivi : ${trackingNo}. Veuillez vérifier le statut de livraison, votre colis vous parviendra dans les plus brefs délais. Cordialement, L'équipe du service client`;
  } else if (countryCode === 'IT') {
    defaultReply = `Buongiorno, a causa della gestione della spedizione, il suo ordine è già in corso e in transito. Il suo codice di tracciamento è: ${trackingNo}. La preghiamo di verificare lo stato della spedizione; il pacco le arriverà il prima possibile. Cordiali saluti, Servizio Clienti`;
  }

  // Attempt Gemini AI Human Generation
  const activeKey = (user?.geminiApiKey || botState.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  let aiResult = null;
  if (activeKey) {
    try {
      aiResult = await geminiService.generateHumanReturnReply({
        buyerName: returnDoc.buyerName,
        orderNum: returnDoc.orderNum,
        country: returnDoc.country,
        reason: returnDoc.reason,
        refundAmount,
        isShipped: true,
        hasTracking: true,
        trackingNo,
        carrier,
        recommendedAction,
        situation,
        apiKey: activeKey,
        model: botState.geminiModel
      });
      if (aiResult && aiResult.text) {
        botState.aiCount++;
      }
    } catch (aiErr) {
      console.warn('[Temu Bot] Gemini AI generation error, using fallback template:', aiErr.message);
    }
  }

  const replyMessage = (aiResult && aiResult.text) ? aiResult.text : defaultReply;
  const isAiGenerated = Boolean(aiResult && aiResult.text);
  const usedModel = aiResult ? aiResult.model : 'rule-template';

  return {
    situation,
    description,
    recommendedAction,
    replyMessage,
    trackingNo,
    carrier,
    aiGenerated: isAiGenerated,
    model: usedModel
  };
};

/**
 * Process a single pending return through the bot
 */
const processSingleReturn = async (user, returnDoc) => {
  const analysis = await evaluateReturnSituation(user, returnDoc);
  const action = analysis.recommendedAction;
  const replyText = analysis.replyMessage;
  const trackingNo = analysis.trackingNo;
  const carrier = analysis.carrier;

  // 1. Update Return status in DB to 'rejected' (cancellation/refund declined because shipping is in progress)
  returnDoc.status = 'rejected';
  returnDoc.resolutionNotes = replyText;
  returnDoc.resolvedAt = new Date();
  await returnDoc.save();

  // 2. Attach tracking number to internal TemuOrder and keep it active in fulfillment
  await TemuOrder.updateOne(
    {
      user: user._id,
      $or: [
        { orderNum: returnDoc.orderNum },
        { orderNum: returnDoc.orderNum.replace(/^PO-/i, '') },
        { orderNum: `PO-${returnDoc.orderNum.replace(/^PO-/i, '')}` }
      ]
    },
    {
      $set: {
        tracking: trackingNo,
        shippingMethod: carrier,
        status: 'printed'
      }
    }
  ).catch(() => {});

  // 3. Submit reply and rejection resolution to Temu Open API
  let temuSubmitted = false;
  try {
    const integration = (user.temuIntegrations && user.temuIntegrations.find(i => i.isConnected)) || user.temuIntegration;
    if (integration && integration.isConnected && integration.appKey && integration.appSecret) {
      temuSubmitted = await temuSyncService.submitTemuReturnResolution(integration, returnDoc, 'reject', replyText);
    }
  } catch (err) {
    console.warn(`[Temu Bot] Return API submission warning for ${returnDoc.returnId}:`, err.message);
  }

  const logEntry = {
    id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date(),
    returnId: returnDoc.returnId,
    orderNum: returnDoc.orderNum,
    buyerName: returnDoc.buyerName,
    country: returnDoc.country,
    refundAmount: returnDoc.refundAmount,
    situation: analysis.situation,
    situationDescription: analysis.description,
    actionTaken: 'reject', // We decline the return/cancellation
    trackingNo,
    carrier,
    replyMessage: replyText,
    aiGenerated: analysis.aiGenerated,
    model: analysis.model,
    temuSubmitted
  };

  botState.logs.unshift(logEntry);
  if (botState.logs.length > 100) botState.logs.pop(); // keep last 100 logs

  return logEntry;
};

/**
 * Run the return bot cycle for a specific user (or all users)
 */
const runReturnBotCycle = async (userId) => {
  if (botState.isRunning) {
    return {
      status: 'in_progress',
      message: 'Bot is already running a check cycle.',
      logs: botState.logs.slice(0, 20)
    };
  }

  botState.isRunning = true;
  botState.lastRunAt = new Date();
  const processedLogs = [];

  try {
    const userQuery = userId ? { _id: userId } : {};
    const users = await User.find(userQuery);

    for (const user of users) {
      // Refresh user returns from Temu first
      if (typeof temuSyncService.syncUserTemuReturnsAndIssues === 'function') {
        await temuSyncService.syncUserTemuReturnsAndIssues(user).catch(() => {});
      }

      // Find all pending returns for this user
      const pendingReturns = await TemuReturn.find({
        user: user._id,
        status: 'pending'
      });

      console.log(`🤖 [Temu Return Bot] Found ${pendingReturns.length} pending returns for user ${user.email || user._id}`);

      for (const returnDoc of pendingReturns) {
        try {
          const logEntry = await processSingleReturn(user, returnDoc);
          processedLogs.push(logEntry);
          botState.totalProcessed++;
        } catch (itemErr) {
          console.warn(`[Temu Return Bot] Error processing ${returnDoc.returnId}:`, itemErr.message);
        }
      }

      // Find and process all pending tickets for this user
      const TemuTicket = require('../models/temuTicket.model');
      const pendingTickets = await TemuTicket.find({
        user: user._id,
        status: 'pending'
      });

      console.log(`🤖 [Temu Bot] Found ${pendingTickets.length} pending tickets for user ${user.email || user._id}`);

      for (const ticketDoc of pendingTickets) {
        try {
          const logEntry = await processSingleTicket(user, ticketDoc);
          processedLogs.push(logEntry);
          botState.totalProcessed++;
        } catch (itemErr) {
          console.warn(`[Temu Bot] Error processing ticket ${ticketDoc.ticketId}:`, itemErr.message);
        }
      }
    }

    return {
      status: 'completed',
      processedCount: processedLogs.length,
      logs: processedLogs,
      botState: {
        lastRunAt: botState.lastRunAt,
        totalProcessed: botState.totalProcessed,
        isAutoActive: botState.isAutoActive,
        hasGeminiKey: Boolean(botState.geminiApiKey || process.env.GEMINI_API_KEY),
        geminiModel: botState.geminiModel,
        aiCount: botState.aiCount
      }
    };
  } finally {
    botState.isRunning = false;
  }
};

/**
 * Start 24/7 background worker
 */
const startBackgroundBot = () => {
  if (botInterval) return;
  console.log('🤖 [Temu Return Bot] Background automation worker started (checking every 60s)...');

  const tick = async () => {
    if (!botState.isAutoActive) return;
    try {
      await runReturnBotCycle();
    } catch (err) {
      console.warn('⚠️ [Temu Return Bot] Background cycle warning:', err.message);
    }
  };

  setTimeout(tick, 10000);
  botInterval = setInterval(tick, 60000);
};

const stopBackgroundBot = () => {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }
};

/**
 * Configure Gemini API Key and Model (Backend management)
 */
const setGeminiConfig = async ({ apiKey, model, user }) => {
  if (apiKey !== undefined) {
    botState.geminiApiKey = (apiKey || '').trim();
    if (user && user._id) {
      await User.updateOne({ _id: user._id }, { $set: { geminiApiKey: botState.geminiApiKey } }).catch(() => {});
    }
  }
  if (model) {
    botState.geminiModel = model.trim();
  }

  // Test connection if key provided
  let testResult = null;
  if (botState.geminiApiKey) {
    testResult = await geminiService.testGeminiConnection(botState.geminiApiKey, botState.geminiModel);
  }

  return {
    success: true,
    hasGeminiKey: Boolean(botState.geminiApiKey),
    geminiModel: botState.geminiModel,
    testResult
  };
};

/**
 * Get current bot status & recent activity logs
 */
const getBotStatus = (user) => {
  const activeKey = (user?.geminiApiKey || botState.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  return {
    isRunning: botState.isRunning,
    isAutoActive: botState.isAutoActive,
    lastRunAt: botState.lastRunAt,
    totalProcessed: botState.totalProcessed,
    hasGeminiKey: Boolean(activeKey),
    geminiModel: botState.geminiModel,
    aiCount: botState.aiCount,
    recentLogs: botState.logs.slice(0, 30)
  };
};

/**
 * Toggle auto bot
 */
const toggleAutoBot = (active) => {
  botState.isAutoActive = typeof active === 'boolean' ? active : !botState.isAutoActive;
  return getBotStatus();
};

module.exports = {
  launchBrowser,
  captureReturnScreenshot,
  evaluateReturnSituation,
  processSingleReturn,
  runReturnBotCycle,
  startBackgroundBot,
  stopBackgroundBot,
  getBotStatus,
  toggleAutoBot,
  setGeminiConfig,
  generateDummyTracking
};
