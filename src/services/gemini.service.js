const httpFetch = require('../utils/httpHelper');

/**
 * Google Gemini Generative AI Service
 * Supports free models: gemini-1.5-flash, gemini-2.0-flash
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
  const customerName = buyerName && !buyerName.toLowerCase().includes('temu customer') ? buyerName : 'Customer';
  const orderRef = orderNum || 'your order';
  const amountStr = refundAmount ? `€${Number(refundAmount).toFixed(2)}` : 'the requested amount';
  const shippingStatusDesc = isShipped
    ? `Dispatched with ${carrier || 'DHL'} (Tracking: ${trackingNo || 'in transit'})`
    : 'Not dispatched yet (still in warehouse / unshipped)';

  const prompt = `You are a real, warm, and highly empathetic human customer service manager for a European merchant store on Temu.
A customer has opened a return / refund request on Temu.

DETAILS OF THE CASE:
- Buyer Name: ${customerName}
- Order Reference: ${orderRef}
- Customer Country: ${countryName}
- Customer Stated Reason: "${reason || 'Return / Refund Request'}"
- Refund Amount: ${amountStr}
- Physical Shipping Status: ${shippingStatusDesc}
- Store Decision: ${recommendedAction.toUpperCase()} (${situation})

YOUR INSTRUCTIONS:
1. Write a genuine, caring reply as a REAL HUMAN customer service representative. Do NOT sound like an automated robotic system.
2. LANGUAGE:
   - If Customer Country is Germany (DE) or Austria (AT), write in friendly, professional GERMAN.
   - If Spain (ES), write in warm, professional SPANISH.
   - If France (FR), write in polite, professional FRENCH.
   - If Italy (IT), write in courteous ITALIAN.
   - Otherwise, write in clear, courteous ENGLISH.
3. CONTEXTUAL LOGIC:
   - IF UNSHIPPED / NOT DISPATCHED: Reassure the customer that we caught the parcel in our dispatch center before it left, so their cancellation has been immediately approved and a full refund of ${amountStr} is processed directly to their account.
   - IF ALREADY SHIPPED WITH TRACKING: Explain politely that their parcel has already been dispatched with ${carrier || 'DHL'} (Tracking: ${trackingNo || 'provided in order details'}). Let them know that once the package arrives, they can return it in its original packaging, and we will immediately finalize their refund as soon as it is returned.
   - IF DEFECTIVE / DAMAGED: Apologize sincerely for the inconvenience and let them know return/refund has been approved to resolve this immediately for them.
4. TONE & LENGTH:
   - Keep it 2 to 4 sentences maximum. Concise, helpful, polite, and reassuring.
   - Greet them warmly (e.g., "Hello ${customerName}," or language equivalent).
   - Sign off naturally as "Best regards, Customer Care Team" (or language equivalent).
   - NEVER use placeholder brackets like [Your Name] or [Company Name].
   - Output ONLY the final message text to send to the buyer.`;

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
