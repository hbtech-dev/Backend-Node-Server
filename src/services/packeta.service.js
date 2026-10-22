const https = require('https');

const DEFAULT_CARRIERS_BY_COUNTRY = {
  // Primary options requested by user from Packeta Home Delivery table
  BG: { id: 4015, name: "BG Speedy HD", code: "speedy", phonePrefix: "+359", temuCourier: "Speedy" },
  GR: { id: 27954, name: "Elta HD", code: "elta", phonePrefix: "+30", temuCourier: "ELTA" },
  HR: { id: 4634, name: "HR Post HD", code: "hrpost", phonePrefix: "+385", temuCourier: "Hrvatska Pošta (HR Post)" },
  PL: { id: 1406, name: "DPD HD", code: "dpd", phonePrefix: "+48", temuCourier: "DPD" },
  SI: { id: 19515, name: "SI Post HD", code: "sipost", phonePrefix: "+386", temuCourier: "Pošta Slovenije (SI Post)" },
  CZ: { id: 106, name: "Packeta HD", code: "packeta_cz", phonePrefix: "+420", temuCourier: "Packeta / Zásilkovna" },
  SK: { id: 131, name: "Packeta HD", code: "packeta_sk", phonePrefix: "+421", temuCourier: "Packeta" },
  RO: { id: 762, name: "Fan Courier HD", code: "fancourier", phonePrefix: "+40", temuCourier: "Fan Courier" },
  HU: { id: 3828, name: "Express One HD", code: "expressone", phonePrefix: "+36", temuCourier: "Express One" },
  LV: { id: 5063, name: "Omniva HD", code: "omniva_lv", phonePrefix: "+371", temuCourier: "Omniva" },
  EE: { id: 5060, name: "Omniva HD", code: "omniva_ee", phonePrefix: "+372", temuCourier: "Omniva" },
  PT: { id: 4655, name: "PT MRW HD", code: "mrw_pt", phonePrefix: "+351", temuCourier: "MRW" },
  CH: { id: 29738, name: "CH Post HD", code: "chpost", phonePrefix: "+41", temuCourier: "Swiss Post (Die Post)" },
  DK: { id: 4993, name: "DK Post HD", code: "postnord", phonePrefix: "+45", temuCourier: "PostNord" },
  // Additional European Home Delivery options
  LT: { id: 5065, name: "LT Omniva HD", code: "omniva_lt", phonePrefix: "+370", temuCourier: "Omniva" },
  AT: { id: 6830, name: "AT DPD HD", code: "dpd_at", phonePrefix: "+43", temuCourier: "DPD" },
  DE: { id: 141252268, name: "DHL Kleinpaket / Warenpost", code: "dhl_de", phonePrefix: "+49", temuCourier: "DHL" },
  IT: { id: 9103, name: "IT Bartolini Home", code: "bartolini", phonePrefix: "+39", temuCourier: "BRT (Bartolini)" },
  ES: { id: 4638, name: "ES Correos HD", code: "correos", phonePrefix: "+34", temuCourier: "Correos" },
  FR: { id: 4309, name: "FR Colissimo HD", code: "colissimo", phonePrefix: "+33", temuCourier: "Colissimo" },
  NL: { id: 8000, name: "NL DHL HD", code: "dhl_nl", phonePrefix: "+31", temuCourier: "DHL" },
  BE: { id: 7909, name: "BE Belgická pošta HD", code: "bpost", phonePrefix: "+32", temuCourier: "bpost" }
};

const ALTERNATIVE_CARRIERS = {
  BG: [{ id: 4015, name: "BG Speedy HD", temuCourier: "Speedy" }, { id: 19469, name: "BG Econt HD", temuCourier: "Econt" }],
  GR: [{ id: 27954, name: "Elta HD", temuCourier: "ELTA" }, { id: 17465, name: "GR Speedex and ACS HD", temuCourier: "ACS" }],
  HR: [{ id: 4634, name: "HR Post HD", temuCourier: "Hrvatska Pošta (HR Post)" }, { id: 10618, name: "HR Overseas HD", temuCourier: "Overseas Express" }],
  PL: [{ id: 1406, name: "DPD HD", temuCourier: "DPD" }, { id: 3603, name: "PL InPost HD", temuCourier: "InPost" }],
  SI: [{ id: 19515, name: "SI Post HD", temuCourier: "Pošta Slovenije (SI Post)" }, { id: 25004, name: "Express One HD", temuCourier: "Express One" }],
  RO: [{ id: 762, name: "Fan Courier HD", temuCourier: "Fan Courier" }, { id: 7397, name: "RO Sameday HD", temuCourier: "Sameday" }],
  HU: [{ id: 3828, name: "Express One HD", temuCourier: "Express One" }, { id: 763, name: "HU Magyar Post HD", temuCourier: "Magyar Post" }],
  CH: [{ id: 29738, name: "CH Post HD", temuCourier: "Swiss Post (Die Post)" }]
};

function postXml(xml) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://www.zasilkovna.cz/api/rest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xml)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(xml);
    req.end();
  });
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatPhoneForCountry(rawPhone, country) {
  const c = (country || 'DE').toUpperCase();
  const cfg = DEFAULT_CARRIERS_BY_COUNTRY[c] || { phonePrefix: '+49' };
  const prefix = cfg.phonePrefix;
  
  if (!rawPhone || !String(rawPhone).trim()) {
    return prefix + '987654321';
  }
  
  let cleaned = String(rawPhone).trim().replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  if (cleaned.startsWith('00')) {
    return '+' + cleaned.slice(2);
  }
  if (cleaned.startsWith('0')) {
    return prefix + cleaned.slice(1);
  }
  if (cleaned.startsWith(prefix.replace('+', ''))) {
    return '+' + cleaned;
  }
  return prefix + cleaned;
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    return { name: 'Customer', surname: 'Eder' };
  }
  if (parts.length === 1) {
    return { name: parts[0], surname: '.' };
  }
  const name = parts[0];
  const surname = parts.slice(1).join(' ');
  return { name, surname };
}

function parseAddress(order) {
  let street = (order.streetName || '').trim();
  let houseNumber = (order.houseNumber || '').trim();
  const fullAddr = (order.address || '').trim();
  
  if (!street && fullAddr) {
    const match = fullAddr.match(/^(.+?)\s+(\d+[a-zA-Z0-9\/\-\s]*)$/);
    if (match) {
      street = match[1].trim();
      houseNumber = match[2].trim();
    } else {
      street = fullAddr;
      houseNumber = '1';
    }
  }
  if (!street) street = 'Main Street';
  if (!houseNumber) houseNumber = '1';
  
  return { street, houseNumber };
}

/**
 * Create a Packet in Packeta System
 */
async function createPacket({ order, user, carrierId, weight, senderLabel }) {
  const apiPassword = (user && user.packetaIntegration && user.packetaIntegration.apiPassword) ||
                      process.env.PACKETA_API_PASSWORD ||
                      'ec486a9b163632ebedcfd2d081343eee';
  const eshop = senderLabel ||
                (user && user.packetaIntegration && user.packetaIntegration.senderLabel) ||
                process.env.PACKETA_SENDER_LABEL ||
                'EDER UG';

  const country = (order.country || 'BG').toUpperCase();
  const carrierConfig = DEFAULT_CARRIERS_BY_COUNTRY[country] || DEFAULT_CARRIERS_BY_COUNTRY['BG'];
  const finalCarrierId = carrierId || carrierConfig.id;
  const carrierName = carrierConfig.name;

  const { name, surname } = splitFullName(order.recipientName || order.name);
  const { street, houseNumber } = parseAddress(order);
  const phone = formatPhoneForCountry(order.phone, country);
  const email = (order.email || (user && user.contactEmail) || (user && user.email) || 'edergmbh01@gmail.com').trim();
  const city = (order.cityName || order.city || 'City').trim();
  const zip = (order.postcode || order.zip || '1000').trim();
  
  let numWeight = parseFloat(weight || order.weight || '0.3');
  if (isNaN(numWeight) || numWeight <= 0) numWeight = 0.3;
  if (numWeight > 30) numWeight = 30;

  let numValue = parseFloat(order.price || '25.0');
  if (isNaN(numValue) || numValue <= 0) numValue = 25.0;

  const orderNumber = String(order.orderNum || order.id || ('ORD-' + Date.now())).trim();

  const xml = `
<createPacket>
    <apiPassword>${escapeXml(apiPassword)}</apiPassword>
    <packetAttributes>
        <number>${escapeXml(orderNumber)}</number>
        <name>${escapeXml(name)}</name>
        <surname>${escapeXml(surname)}</surname>
        <email>${escapeXml(email)}</email>
        <phone>${escapeXml(phone)}</phone>
        <addressId>${finalCarrierId}</addressId>
        <street>${escapeXml(street)}</street>
        <houseNumber>${escapeXml(houseNumber)}</houseNumber>
        <city>${escapeXml(city)}</city>
        <zip>${escapeXml(zip)}</zip>
        <weight>${numWeight.toFixed(2)}</weight>
        <value>${numValue.toFixed(2)}</value>
        <currency>EUR</currency>
        <eshopId>${escapeXml(eshop)}</eshopId>
    </packetAttributes>
</createPacket>
  `.trim();

  const res = await postXml(xml);
  const resText = res.body;

  if (resText.includes('<status>ok</status>')) {
    const idMatch = resText.match(/<id>(\d+)<\/id>/);
    const barcodeMatch = resText.match(/<barcode>([^<]+)<\/barcode>/);
    const barcodeTextMatch = resText.match(/<barcodeText>([^<]+)<\/barcodeText>/);

    const packetId = idMatch ? idMatch[1] : '';
    const barcode = barcodeMatch ? barcodeMatch[1] : ('Z' + packetId);
    const barcodeText = barcodeTextMatch ? barcodeTextMatch[1] : barcode;

    return {
      success: true,
      packetId,
      barcode,
      barcodeText,
      trackingNumber: barcode,
      carrierId: finalCarrierId,
      carrierName,
      temuCourier: carrierConfig.temuCourier || carrierName,
      country,
      trackingUrl: `https://tracking.packeta.com/en/?id=${barcode}`
    };
  }

  // Parse fault description
  const faultMatch = resText.match(/<fault>([\s\S]*?)<\/fault>/);
  const faultDesc = faultMatch ? faultMatch[1].replace(/<[^>]+>/g, ' ').trim() : 'Packet creation failed';
  throw new Error(faultDesc || 'Failed to create Packeta shipment');
}

/**
 * Fetch Base64 PDF Label
 */
async function getPacketLabelPdf(packetId, user, format = 'A6 on A6', offset = 0) {
  const apiPassword = (user && user.packetaIntegration && user.packetaIntegration.apiPassword) ||
                      process.env.PACKETA_API_PASSWORD ||
                      'ec486a9b163632ebedcfd2d081343eee';

  const xml = `
<packetLabelPdf>
    <apiPassword>${escapeXml(apiPassword)}</apiPassword>
    <packetId>${escapeXml(packetId)}</packetId>
    <format>${escapeXml(format)}</format>
    <offset>${offset}</offset>
</packetLabelPdf>
  `.trim();

  const res = await postXml(xml);
  const resText = res.body;

  if (resText.includes('<status>ok</status>')) {
    const resultMatch = resText.match(/<result>([A-Za-z0-9+\/=]+)<\/result>/);
    if (resultMatch) {
      return {
        success: true,
        base64Pdf: resultMatch[1],
        buffer: Buffer.from(resultMatch[1], 'base64')
      };
    }
  }

  const faultMatch = resText.match(/<fault>([\s\S]*?)<\/fault>/);
  const faultDesc = faultMatch ? faultMatch[1].replace(/<[^>]+>/g, ' ').trim() : 'Failed to retrieve label PDF';
  throw new Error(faultDesc);
}

/**
 * Cancel a Packet
 */
async function cancelPacket(packetId, user) {
  const apiPassword = (user && user.packetaIntegration && user.packetaIntegration.apiPassword) ||
                      process.env.PACKETA_API_PASSWORD ||
                      'ec486a9b163632ebedcfd2d081343eee';

  const xml = `
<cancelPacket>
    <apiPassword>${escapeXml(apiPassword)}</apiPassword>
    <packetId>${escapeXml(packetId)}</packetId>
</cancelPacket>
  `.trim();

  const res = await postXml(xml);
  return res.body.includes('<status>ok</status>');
}

/**
 * Fetch Carriers Feed JSON
 */
async function fetchCarriers(apiKey) {
  const key = apiKey || process.env.PACKETA_API_KEY || 'ec486a9b163632eb';
  const url = `https://pickup-point.api.packeta.com/v5/${key}/carrier/json`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Failed to parse carrier JSON: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

module.exports = {
  DEFAULT_CARRIERS_BY_COUNTRY,
  ALTERNATIVE_CARRIERS,
  createPacket,
  getPacketLabelPdf,
  cancelPacket,
  fetchCarriers
};
