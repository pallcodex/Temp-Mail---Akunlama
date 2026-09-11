const https = require('https');
const url = require('url');

const BASE_URL = 'https://akunlama.com/api';
const DOMAIN = 'akunlama.com';
const CREATOR = 'Lann';

function request(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

function cleanRecipient(emailOrUsername) {
  return (emailOrUsername || '').replace(`@${DOMAIN}`, '').trim();
}

function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractOtp(text) {
  if (!text) return null;
  const labeled = text.match(/(?:otp|code|verification|kode|verifikasi)[\s:=#\-]+([0-9]{4,8})/i);
  if (labeled) return labeled[1];
  const standalone = text.match(/\b(?!(?:19\d\d|20\d\d)\b)([0-9]{4,8})\b/);
  return standalone ? standalone[1] : null;
}

function extractLinks(html) {
  if (typeof html !== 'string') return [];
  const links = [];
  const regex = /href=["'](https?:\/\/[^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const matchedUrl = match[1].replace(/&amp;/g, '&');
    if (!links.includes(matchedUrl)) links.push(matchedUrl);
  }
  return links;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const millis = ts > 1e11 ? ts : ts * 1000;
  return new Date(millis).toISOString();
}

const ADJECTIVES = ['happy', 'sleepy', 'clever', 'swift', 'brave', 'calm', 'wild'];
const ANIMALS = ['kitten', 'cat', 'tiger', 'lion', 'panther', 'cheetah'];

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${animal}-${num}`;
}

async function listInbox(username) {
  const recipient = cleanRecipient(username);
  const reqUrl = `${BASE_URL}/list?recipient=${encodeURIComponent(recipient)}`;
  const res = await request(reqUrl);
  return Array.isArray(res) ? res : [];
}

async function getEmailDetail(region, key) {
  const metaUrl = `${BASE_URL}/getKey?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`;
  const htmlUrl = `${BASE_URL}/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`;
  
  const [meta, html] = await Promise.all([request(metaUrl), request(htmlUrl)]);
  const rawHtml = typeof html === 'string' ? html : JSON.stringify(html);
  const textContent = stripHtml(rawHtml);

  return {
    meta,
    html: rawHtml,
    text: textContent,
    links: extractLinks(rawHtml),
    possibleOtp: extractOtp(textContent)
  };
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept, Authorization, Origin');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data, null, 2));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 200;
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const query = parsed.query;

  try {
    // Generate Email Random
    if (pathname.includes('/gen')) {
      const user = generateRandomName();
      return sendJson(res, 200, {
        creator: CREATOR,
        status: 'success',
        email: `${user}@${DOMAIN}`,
        username: user,
        domain: DOMAIN,
        data: { email: `${user}@${DOMAIN}`, username: user, domain: DOMAIN }
      });
    }

    // Custom Email
    if (pathname.includes('/use')) {
      const parts = pathname.split('/').filter(Boolean);
      let user = query.user || query.username || query.email || query.name;
      if (!user && parts.length >= 2 && !parts[parts.length - 1].includes('use')) {
        user = parts[parts.length - 1];
      }

      if (!user) {
        return sendJson(res, 400, { creator: CREATOR, status: 'error', message: 'Parameter user wajib diisi' });
      }

      const clean = cleanRecipient(user);
      return sendJson(res, 200, {
        creator: CREATOR,
        status: 'success',
        email: `${clean}@${DOMAIN}`,
        username: clean,
        domain: DOMAIN,
        data: { email: `${clean}@${DOMAIN}`, username: clean, domain: DOMAIN }
      });
    }

    // List Inbox
    if (pathname.includes('/inbox')) {
      const parts = pathname.split('/').filter(Boolean);
      let user = query.user || query.username || query.email;
      if (!user && parts.length >= 2 && !parts[parts.length - 1].includes('inbox')) {
        user = parts[parts.length - 1];
      }

      if (!user) {
        return sendJson(res, 400, { creator: CREATOR, status: 'error', message: 'Parameter user wajib diisi' });
      }

      const clean = cleanRecipient(user);
      const messages = await listInbox(clean);
      const formatted = messages.map((m, idx) => ({
        index: idx + 1,
        id: m.storage?.key || null,
        region: m.storage?.region || 'us',
        from: m.message?.headers?.from || m.sender || 'Unknown Sender',
        subject: m.message?.headers?.subject || m.preview || '(No Subject)',
        date: parseTimestamp(m.timestamp)
      }));

      return sendJson(res, 200, {
        creator: CREATOR,
        status: 'success',
        email: `${clean}@${DOMAIN}`,
        total: formatted.length,
        messages: formatted,
        data: formatted
      });
    }

    // Baca Pesan Detail
    if (pathname.includes('/read')) {
      const parts = pathname.split('/').filter(Boolean);
      let user = query.user || query.username;
      let index = query.index || query.key || '1';

      if (parts.length >= 3) {
        user = parts[parts.length - 2];
        index = parts[parts.length - 1];
      }

      if (!user) {
        return sendJson(res, 400, { creator: CREATOR, status: 'error', message: 'Parameter user wajib diisi' });
      }

      const clean = cleanRecipient(user);
      const messages = await listInbox(clean);
      if (!messages.length) {
        return sendJson(res, 404, { creator: CREATOR, status: 'error', message: 'Inbox kosong' });
      }

      let selected = messages[parseInt(index, 10) - 1] || messages.find(m => m.storage?.key === index);
      if (!selected) {
        return sendJson(res, 404, { creator: CREATOR, status: 'error', message: 'Pesan tidak ditemukan' });
      }

      const detail = await getEmailDetail(selected.storage?.region || 'us', selected.storage?.key);
      const emailDetail = {
        index,
        id: selected.storage?.key,
        from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : detail.meta?.emailAddress,
        subject: detail.meta?.subject || '(No Subject)',
        otp: detail.possibleOtp,
        links: detail.links,
        text: detail.text,
        html: detail.html
      };

      return sendJson(res, 200, {
        creator: CREATOR,
        status: 'success',
        data: emailDetail,
        message: emailDetail
      });
    }

    // Root status
    return sendJson(res, 200, {
      creator: CREATOR,
      status: 'online',
      message: 'Akunlama Temp Mail API Vercel Online'
    });

  } catch (err) {
    return sendJson(res, 500, { creator: CREATOR, status: 'error', message: err.message });
  }
};
