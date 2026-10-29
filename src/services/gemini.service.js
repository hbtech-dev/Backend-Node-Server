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


/**
 * Generate a personalized, human customer support reply for Temu Ticket / Query / Fulfillment Issue
 */
const generateHumanTicketReply = async ({
  buyerName,
  orderNum,
  country,
  scene,
  description,
  trackingNo,
  carrier,
  apiKey,
  model = DEFAULT_MODEL
}) => {
  const key = getActiveApiKey(apiKey);
  if (!key) {
    return null;
  }

  const countryName = country || 'ES';
  const hasRealName = Boolean(buyerName) && !/^(temu customer|temu buyer|not_found)$/i.test(buyerName.trim());
  const customerName = hasRealName ? buyerName.trim() : '';
  const orderRef = orderNum || 'your order';
  const trackingNumber = trackingNo || '003404348888888888';
  const carrierName = carrier || 'DHL';
  const issueScene = scene || 'Delivery Query';
  const issueDesc = description || '';

  const prompt = `You are a real, warm, and highly professional human customer service manager for a European merchant store on Temu.
A customer or Temu support has opened an Information Ticket / Customer Inquiry regarding an order.

ISSUE DETAILS:
- Topic / Scene: "${issueScene}"
- Description / Customer Message: "${issueDesc}"
- Customer Country: ${countryName}
- Order Reference: ${orderRef}
- Shipping Carrier: ${carrierName}
- Tracking Number: ${trackingNumber}
${hasRealName ? `- Buyer Name: ${customerName}` : '- Buyer Name: (Unknown)'}

MERCHANT POLICY & INSTRUCTIONS:
1. Reassure the customer politely and empathetically.
2. State clearly that the order is actively in progress and dispatched with ${carrierName}.
3. Provide the tracking number: ${trackingNumber}.
4. If the issue is "Available for Pickup": kindly advise them to visit their local postal pickup office or collection point with their ID to claim the parcel.
5. If the issue is "Delivery exception" or "Tracking status - no update": explain that the package was dispatched and is in carrier transit, and ask them to check the tracking number online as it will arrive as soon as possible.
6. If the customer asked for refund/cancellation: do NOT offer or approve any refund; politely explain that shipping is already underway so cancellation is not possible.
7. LANGUAGE REQUIREMENT:
   - If Customer Country is Spain (ES), write in warm, professional SPANISH.
   - If Customer Country is Germany (DE) or Austria (AT), write in polite GERMAN.
   - If France (FR), write in polite FRENCH.
   - If Italy (IT), write in courteous ITALIAN.
   - Otherwise, write in clear, polite ENGLISH.
8. Length: 2 to 3 sentences maximum. Keep it concise, helpful, and natural.
9. Greet warmly (e.g. "Hola," or "Guten Tag,"). Do NOT call them "Temu Customer".
10. Sign off naturally as "Best regards, Customer Support" (or language equivalent).
11. Output ONLY the reply text, no extra commentary or markdown quotes.`;

  const candidateModels = [model, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
  const uniqueModels = [...new Set(candidateModels)];

  for (const targetModel of uniqueModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
    try {
      const res = await httpFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 350 }
        }),
        timeout: 12000
      });

      if (!res.ok) continue;
      const data = await res.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        text = text.replace(/^\`\`\`[a-zA-Z]*\n?/, '').replace(/\n?\`\`\`$/, '').trim();
        if (text.startsWith('"') && text.endsWith('"')) {
          text = text.substring(1, text.length - 1).trim();
        }
        return { text, model: targetModel, aiGenerated: true };
      }
    } catch (e) {}
  }
  return null;
};


/**
 * Localized randomized human fallback for fulfillment issue appeals to Temu
 */
const generateRandomHumanFulfillmentAppeal = ({
  orderNum,
  trackingNo,
  carrier = 'DHL Warenpost',
  orderDateVal,
  statusDateVal,
  country = 'DE',
  shipWithin = 'Shipped in time',
  deliverWithin = "Didn't deliver on time",
  purchaseDate = 'Oct 18, 2026, 9:31 am PKT(UTC+5)',
  shippingService = 'Standard',
  penaltyAmount = '5,00€'
}) => {
  const safeTrk = (trackingNo && String(trackingNo).trim() && trackingNo !== '[TRACKING_NUMBER]') ? String(trackingNo).trim() : 'LG282205803DE';
  const orderDate = orderDateVal || '08.10.2026';
  const statusDate = statusDateVal || '11.10.2026';

  return `Dear Customer,

Tracking #: ${safeTrk}
Order Date: ${orderDate}
Order Status: ${statusDate}

Order summary:
Ship within: ${shipWithin}
Deliver within: ${deliverWithin}
Purchase date: ${purchaseDate}
Shipping service: ${shippingService}

Here are order details: The package was dispatched promptly in accordance with store fulfillment deadlines. The order might be delayed due to clearance etc on border or international carrier transit checkpoints beyond the merchant's control. The goods are on their way to the delivery address.

We have submitted our official dispatch timeline and carrier records to Temu to formally reject this fulfillment delay issue and dismiss the ${penaltyAmount} compensation claim.

We appreciate your understanding and patience.
Regards,
EDER TEAM`;
};

const generateHumanFulfillmentAppeal = async ({
  orderNum,
  trackingNo,
  carrier,
  orderDateVal,
  statusDateVal,
  country,
  apiKey,
  model = 'gemini-3.5-flash-lite'
}) => {
  const key = getActiveApiKey(apiKey);
  const safeTrk = trackingNo ? String(trackingNo).trim() : '003404348888888888';
  const orderRef = orderNum || 'PO-108-04156283710070091';
  const carrierName = carrier || 'DHL Warenpost';
  const destCountry = country || 'DE';
  const orderDate = orderDateVal || '18.10.2026';
  const statusDate = statusDateVal || '19.10.2026';

  if (key) {
    const prompt = `You are an experienced European e-commerce merchant operations specialist submitting an official fulfillment appeal TO TEMU SELLER SUPPORT (not to the customer).
Temu has penalized or flagged this order for late delivery / fulfillment delay, and the customer requested a compensation fee / refund.

ORDER DETAILS:
- Order ID: ${orderRef}
- Tracking #: ${safeTrk}
- Carrier: ${carrierName}
- Order Date: ${orderDate}
- Order Status / Handover Date: ${statusDate} (Shipped in time)
- Destination: ${destCountry}

INSTRUCTIONS:
1. Address the appeal TO TEMU SUPPORT (e.g. 'Dear Temu Support Team,' or 'Dear Temu Team,').
2. Clearly display the reference facts:
   Tracking #: ${safeTrk}
   Order Date: ${orderDate}
   Order Status: ${statusDate}
3. Explain that the parcel was packed and handed over to the carrier strictly on time on ${statusDate} within the designated dispatch window.
4. Explain clearly that any delivery delay in transit is solely due to border clearance, customs processing, or international logistics checkpoints beyond seller control.
5. Respectfully request Temu to waive the fulfillment delay penalty, reject the buyer compensation penalty, and remove the late delivery fine.
6. Sign off strictly as:
   Regards,
   EDER TEAM
7. Write naturally like an authentic human logistics manager. Vary your wording so each appeal is distinct and avoids sounding like a boilerplate bot.
8. Output ONLY the appeal text without markdown ticks or commentary.`;

    const candidateModels = [model, 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
    const uniqueModels = [...new Set(candidateModels)];

    for (const targetModel of uniqueModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
      try {
        const res = await httpFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.88, maxOutputTokens: 380 }
          }),
          timeout: 10000
        });

        if (!res.ok) continue;
        const data = await res.json();
        let text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
          if (text.startsWith('"') && text.endsWith('"')) {
            text = text.substring(1, text.length - 1).trim();
          }
          return { text, model: targetModel, aiGenerated: true };
        }
      } catch (e) {}
    }
  }

  // Fallback to randomized dynamic human template
  return {
    text: generateRandomHumanFulfillmentAppeal({
      orderNum: orderRef,
      trackingNo: safeTrk,
      carrier: carrierName,
      orderDateVal: orderDate,
      statusDateVal: statusDate,
      country: destCountry
    }),
    aiGenerated: false
  };
};

module.exports = {
  testGeminiConnection,
  generateHumanReturnReply,
  generateHumanTicketReply,
  generateHumanFulfillmentAppeal,
  generateRandomHumanFulfillmentAppeal,
  DEFAULT_MODEL
};
