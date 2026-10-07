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
  autoApproveUnshipped: true,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  aiCount: 0,
  logs: []
};

let botInterval = null;

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

  const isShipped = order && (order.status === 'printed' || Boolean(order.tracking) || order.status === 'created_label');
  const isUnshipped = !isShipped || (order && order.status === 'open');
  const hasTracking = order && Boolean(order.tracking);
  const refundAmount = Number(returnDoc.refundAmount || (order?.price) || 0).toFixed(2);
  const reasonText = (returnDoc.reason || '').toLowerCase();
  const trackingNo = order?.tracking || '';
  const carrier = order?.shippingMethod || 'DHL';

  let situation = 'STANDARD_CUSTOMER_RETURN';
  let description = 'Standard customer return request.';
  let recommendedAction = 'approve';
  let defaultReply = `Return request accepted. Please return the item in original condition to process your refund of €${refundAmount}.`;

  // Situation 1: Order is still in warehouse / unshipped (Not Dispatched)
  if (isUnshipped && !hasTracking) {
    situation = 'ORDER_NOT_DISPATCHED';
    description = 'Order is still unshipped in warehouse. No tracking number generated.';
    recommendedAction = 'refund';
    defaultReply = `Cancellation & full refund approved. The order has not been dispatched yet. A full refund of €${refundAmount} has been processed for the customer.`;
  }
  // Situation 2: Order was already shipped with tracking number
  else if (isShipped || hasTracking) {
    situation = 'ORDER_DISPATCHED_IN_TRANSIT';
    description = `Order has already been dispatched via ${carrier} (Tracking: ${trackingNo}).`;
    recommendedAction = 'approve';
    defaultReply = `The order has already been processed and dispatched with ${carrier} tracking number ${trackingNo}. Please return the item in original packaging for a refund upon delivery.`;
  }
  // Situation 3: Damaged / defective claim
  else if (reasonText.includes('damaged') || reasonText.includes('defect') || reasonText.includes('broken')) {
    situation = 'DAMAGED_OR_DEFECTIVE';
    description = 'Customer claims damaged or defective goods.';
    recommendedAction = 'approve';
    defaultReply = `Return request approved. Please use the authorized return label to return the item so our inspection team can issue a full refund of €${refundAmount}.`;
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
        isShipped,
        hasTracking,
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

  // 1. Update Return status in DB
  returnDoc.status = action === 'reject' ? 'rejected' : action === 'approve' ? 'approved' : 'refunded';
  returnDoc.resolutionNotes = replyText;
  returnDoc.resolvedAt = new Date();
  await returnDoc.save();

  // 2. If it was an unshipped cancellation/refund, mark internal order as canceled so warehouse doesn't ship it
  if (analysis.situation === 'ORDER_NOT_DISPATCHED') {
    await TemuOrder.updateOne(
      { user: user._id, orderNum: returnDoc.orderNum },
      { $set: { status: 'canceled', orderStatus: 'canceled' } }
    ).catch(() => {});
  }

  // 3. Submit reply and resolution to Temu Open API
  let temuSubmitted = false;
  try {
    const integration = (user.temuIntegrations && user.temuIntegrations.find(i => i.isConnected)) || user.temuIntegration;
    if (integration && integration.isConnected && integration.appKey && integration.appSecret) {
      temuSubmitted = await temuSyncService.submitTemuReturnResolution(integration, returnDoc, action, replyText);
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
    actionTaken: action,
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
 * Configure Gemini API Key and Model
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
  setGeminiConfig
};
