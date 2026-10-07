const httpFetch = require('../utils/httpHelper');

/**
 * Google Gemini Generative AI Service
 * Supports free models: gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3.5-flash
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

/**
 * Get the active Gemini API key from parameters, env, or runtime state
 */
const getActiveApiKey = (customKey) => {
  return (customKey || process.env.GEMINI_API_KEY || '').trim();
};

/**
 * Test Gemini API connection with a given key
 */
const testGeminiConnection = async (apiKey, model = DEFAULT_MODEL) => {
  const key = getActiveApiKey(apiKey);
  if (!key) {
    return { success: false, message: 'No Gemini API key provided.' };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  try {
    const res = await httpFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Respond with "OK" if you are operational.' }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 10
        }
      }),
      timeout: 10000
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.error?.message || `HTTP ${res.status}`;
      return { success: false, message: `Gemini API error: ${errMsg}` };
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return {
      success: true,
      message: 'Gemini API connection successful!',
      model,
      sampleResponse: reply
    };
  } catch (err) {
    return { success: false, message: `Connection test failed: ${err.message}` };
  }
};

/**
 * Generate a personalized, human customer support reply for Temu return/dispute
 * Policy: Orders are NOT refunded. The buyer is notified that due to shipping processing,
 * the order is in progress, the tracking number is provided, and the parcel will arrive as soon as possible.
 */
const generateHumanReturnReply = async ({
  buyerName,
  orderNum,
  country,
  reason,
  refundAmount,
  isShipped,
  hasTracking,
  trackingNo,
  carrier,
  recommendedAction,
  situation,
  apiKey,
  model = DEFAULT_MODEL
}) => {
  const key = getActiveApiKey(apiKey);
  if (!key) {
    return null; // Return null to allow fallback to rule-based template
  }

  const countryName = country || 'International';
  const hasRealName = Boolean(buyerName) && !/^(temu customer|temu buyer|not_found)$/i.test(buyerName.trim());
  const customerName = hasRealName ? buyerName.trim() : '(name unknown)';
  const orderRef = orderNum || 'your order';
  const trackingNumber = trackingNo || '003404348888888888';
  const carrierName = carrier || 'DHL';

  const prompt = `You are a real, warm, and highly professional human customer service manager for a European merchant store on Temu.
A customer has requested a cancellation or return for their order on Temu.

STORE POLICY & SITUATION:
- We do NOT cancel or refund this order.
- Explain kindly that due to ongoing shipping processing, their order is already in progress and being delivered.
- Provide the customer with their shipping tracking number: ${trackingNumber} (Carrier: ${carrierName}).
- Ask them to check the delivery tracking status, and reassure them that their parcel will reach them as soon as possible.
- NEVER mention or promise any refund or cancellation approval.

CASE DETAILS:
- Buyer Name: ${customerName}
- Order Reference: ${orderRef}
- Customer Country: ${countryName}
- Stated Reason: "${reason || 'Return / Cancellation Request'}"
- Carrier: ${carrierName}
- Shipping Tracking Number: ${trackingNumber}

YOUR INSTRUCTIONS:
1. Write a genuine, warm, and reassuring reply as a REAL HUMAN customer service representative.
2. Greet them warmly. ${hasRealName ? `Address them by name: "${customerName}".` : 'The buyer name is UNKNOWN: greet with a plain "Hello," (or language equivalent) and NEVER write the words "Customer" or "Temu Customer" as a name.'}
3. Inform them kindly that due to shipping processing, their order is already in progress and on its way to them.
4. Clearly state their tracking number: ${trackingNumber}.
5. Advise them to check the tracking status and reassure them that their order will reach them as soon as possible.
6. LANGUAGE:
   - If Customer Country is Germany (DE) or Austria (AT), write in friendly, professional GERMAN.
   - If Spain (ES), write in warm, professional SPANISH.
   - If France (FR), write in polite, professional FRENCH.
   - If Italy (IT), write in courteous ITALIAN.
   - Otherwise, write in clear, courteous ENGLISH.
7. Length: 2 to 3 sentences maximum. Concise, polite, and reassuring.
8. Sign off naturally as "Best regards, Customer Care Team" (or language equivalent).
9. NEVER use placeholder brackets like [Your Name] or [Company Name].
10. Output ONLY the final message text to send to the buyer.`;

  const candidateModels = [model, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
  const uniqueModels = [...new Set(candidateModels)];

  for (const targetModel of uniqueModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
    try {
      const res = await httpFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 350
          }
        }),
        timeout: 12000
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[Gemini API] Model ${targetModel} error (${res.status}):`, errText);
        continue; // Try next model
      }

      const data = await res.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        // Strip markdown code fences if model wrapped response in ```
        text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
        // Remove surrounding quotes if model added them
        if (text.startsWith('"') && text.endsWith('"')) {
          text = text.substring(1, text.length - 1).trim();
        }
        return {
          text,
          model: targetModel,
          aiGenerated: true
        };
      }
    } catch (apiErr) {
      console.warn(`[Gemini API] Request error on ${targetModel}:`, apiErr.message);
    }
  }

  return null;
};

module.exports = {
  testGeminiConnection,
  generateHumanReturnReply,
  DEFAULT_MODEL
};
