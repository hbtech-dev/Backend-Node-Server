const fs = require('fs');
const path = require('path');

/**
 * Public base directory for uploaded & generated evidence images
 */
const EVIDENCE_DIR = path.join(__dirname, '../../public/evidence');

const ensureEvidenceDir = () => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
};

/**
 * Get public base URL for backend assets
 */
const getPublicBaseUrl = () => {
  const envUrl = process.env.BACKEND_URL || process.env.SERVER_URL || process.env.API_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'https://api.ederapp.de';
};

/**
 * Save a base64 Data URL or raw base64 string as a permanent PNG on disk
 * and return the public HTTP URL suitable for submitting to Temu Open API.
 *
 * @param {string} dataUrlOrBase64 - e.g. "data:image/png;base64,iVBORw..." or an existing HTTP(S) URL
 * @param {string} prefix - Filename prefix (e.g. 'fulfillment', 'ticket', 'return')
 * @returns {string} Public HTTP URL of the image
 */
const saveBase64Image = (dataUrlOrBase64, prefix = 'evidence') => {
  if (!dataUrlOrBase64 || typeof dataUrlOrBase64 !== 'string') {
    return '';
  }

  const trimmed = dataUrlOrBase64.trim();

  // If already an HTTP/HTTPS URL, return as-is
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  try {
    ensureEvidenceDir();

    let base64Data = trimmed;
    let ext = 'png';

    // Parse data URL prefix if present (e.g. data:image/png;base64,...)
    const matches = trimmed.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      ext = matches[1].replace('jpeg', 'jpg');
      base64Data = matches[2];
    }

    const cleanPrefix = String(prefix || 'evidence').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanPrefix}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}.${ext}`;
    const filePath = path.join(EVIDENCE_DIR, filename);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const baseUrl = getPublicBaseUrl();
    const publicUrl = `${baseUrl}/public/evidence/${filename}`;
    return publicUrl;
  } catch (err) {
    console.error('⚠️ Failed to save base64 evidence image:', err.message);
    return trimmed; // fallback to original input
  }
};

module.exports = {
  saveBase64Image,
  getPublicBaseUrl
};
