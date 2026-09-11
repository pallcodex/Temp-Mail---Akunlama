#!/usr/bin/env node

const http = require('http');
const https = require('https');
const readline = require('readline');
const url = require('url');

const BASE_URL = 'https://akunlama.com/api';
const DOMAIN = 'akunlama.com';
const CREATOR = 'Lann';

// Styling untuk Claude Code UI
const ui = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  coral: '\x1b[38;2;217;119;87m',
  green: '\x1b[38;2;74;222;128m',
  red: '\x1b[38;2;248;113;113m'
};

let currentMailbox = null;
let lastMessages = [];
let rl = null;

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

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

const ADJECTIVES = ['happy', 'sleepy', 'clever', 'swift', 'brave', 'calm', 'wild', 'gentle', 'lucky', 'proud', 'cozy', 'fuzzy'];
const ANIMALS = ['kitten', 'cat', 'tiger', 'lion', 'panther', 'cheetah', 'lynx', 'puma', 'jaguar', 'leopard'];

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${animal}-${num}`;
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
    if (!links.includes(matchedUrl)) {
      links.push(matchedUrl);
    }
  }
  return links;
}

function parseTimestamp(ts) {
  if (!ts) return null;
  const millis = ts > 1e11 ? ts : ts * 1000;
  return new Date(millis).toISOString();
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
  
  const [meta, html] = await Promise.all([
    request(metaUrl),
    request(htmlUrl)
  ]);

  const rawHtml = typeof html === 'string' ? html : JSON.stringify(html);
  const textContent = stripHtml(rawHtml);
  const links = extractLinks(rawHtml);
  const possibleOtp = extractOtp(textContent);

  return {
    meta,
    html: rawHtml,
    text: textContent,
    links,
    possibleOtp
  };
}

// Core Operations
function opGenerate() {
  const user = generateRandomName();
  return {
    creator: CREATOR,
    status: 'success',
    data: {
      email: `${user}@${DOMAIN}`,
      username: user,
      domain: DOMAIN
    }
  };
}

function opUse(target) {
  if (!target) {
    return {
      creator: CREATOR,
      status: 'error',
      message: 'Username or email required. Usage: use <username>'
    };
  }
  const clean = cleanRecipient(target);
  return {
    creator: CREATOR,
    status: 'success',
    message: `Active mailbox set to ${clean}@${DOMAIN}`,
    data: {
      email: `${clean}@${DOMAIN}`,
      username: clean,
      domain: DOMAIN
    }
  };
}

async function opInbox(username) {
  const clean = cleanRecipient(username);
  if (!clean) {
    return {
      creator: CREATOR,
      status: 'error',
      message: 'Username or email required: inbox <user>'
    };
  }
  const fullEmail = `${clean}@${DOMAIN}`;
  const messages = await listInbox(clean);

  const formatted = messages.map((m, idx) => {
    const headers = m.message?.headers || {};
    return {
      index: idx + 1,
      id: m.storage?.key || null,
      region: m.storage?.region || 'us',
      from: headers.from || m.sender || null,
      subject: headers.subject || m.preview || '(No Subject)',
      date: parseTimestamp(m.timestamp)
    };
  });

  return {
    creator: CREATOR,
    status: 'success',
    email: fullEmail,
    total: formatted.length,
    messages: formatted,
    _rawMessages: messages
  };
}

async function opRead(username, indexOrKey) {
  const clean = cleanRecipient(username);
  if (!clean) {
    return {
      creator: CREATOR,
      status: 'error',
      message: 'Username or email required'
    };
  }

  const messages = await listInbox(clean);
  if (!messages.length) {
    return {
      creator: CREATOR,
      status: 'error',
      message: `Mailbox ${clean}@${DOMAIN} is empty`
    };
  }

  let selected = null;
  let targetIndex = null;

  const parsedInt = parseInt(indexOrKey, 10);
  if (!isNaN(parsedInt) && parsedInt > 0 && parsedInt <= messages.length) {
    targetIndex = parsedInt;
    selected = messages[parsedInt - 1];
  } else {
    const foundIdx = messages.findIndex(m => m.storage?.key === indexOrKey);
    if (foundIdx !== -1) {
      targetIndex = foundIdx + 1;
      selected = messages[foundIdx];
    }
  }

  if (!selected) {
    return {
      creator: CREATOR,
      status: 'error',
      message: `Message '${indexOrKey}' not found. Available index: 1..${messages.length}`
    };
  }

  const region = selected.storage?.region || 'us';
  const key = selected.storage?.key;
  const detail = await getEmailDetail(region, key);

  return {
    creator: CREATOR,
    status: 'success',
    data: {
      index: targetIndex,
      id: key,
      region,
      from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || null),
      to: detail.meta?.recipients || `${clean}@${DOMAIN}`,
      subject: detail.meta?.subject || '(No Subject)',
      date: detail.meta?.Date || parseTimestamp(selected.timestamp),
      otp: detail.possibleOtp || null,
      links: detail.links || [],
      text: detail.text,
      html: detail.html
    }
  };
}

async function opDump(username) {
  const clean = cleanRecipient(username);
  if (!clean) {
    return {
      creator: CREATOR,
      status: 'error',
      message: 'Username or email required for dump'
    };
  }

  const fullEmail = `${clean}@${DOMAIN}`;
  const list = await listInbox(clean);

  const fullData = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const region = item.storage?.region || 'us';
    const key = item.storage?.key;
    if (key) {
      const detail = await getEmailDetail(region, key);
      fullData.push({
        index: i + 1,
        id: key,
        region,
        from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || item.message?.headers?.from || null),
        to: detail.meta?.recipients || `${clean}@${DOMAIN}`,
        subject: detail.meta?.subject || item.message?.headers?.subject || item.preview || '(No Subject)',
        date: detail.meta?.Date || parseTimestamp(item.timestamp),
        otp: detail.possibleOtp || null,
        links: detail.links || [],
        text: detail.text,
        html: detail.html
      });
    }
  }

  return {
    creator: CREATOR,
    status: 'success',
    email: fullEmail,
    total: fullData.length,
    messages: fullData
  };
}

// REST API Request Handler Core (Bisa dipakai Serverless Vercel & HTTP Native)
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

async function handleApiRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  let pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const query = parsed.query;

  // Normalisasi path untuk Vercel rewrite
  if (!pathname.startsWith('/api')) {
    pathname = '/api' + (pathname === '/' ? '' : pathname);
  }

  try {
    // Root info
    if (pathname === '/api') {
      return sendJson(res, 200, {
        creator: CREATOR,
        status: 'success',
        message: 'Akunlama REST API by Lann',
        endpoints: {
          'GET /api/gen': 'Generate new random disposable email',
          'GET /api/use?user=<name>': 'Set/format custom email address (or /api/use/:name)',
          'GET /api/inbox?user=<name>': 'Get inbox messages list (or /api/inbox/:user)',
          'GET /api/read?user=<name>&index=<1|key>': 'Read email details (or /api/read/:user/:index)',
          'GET /api/dump?user=<name>': 'Dump all messages with content & links (or /api/dump/:user)',
          'GET /api/stream?user=<name>': 'Server-Sent Events (SSE) real-time email listener'
        }
      });
    }

    // /api/gen
    if (pathname === '/api/gen') {
      const result = opGenerate();
      return sendJson(res, 200, result);
    }

    // /api/use or /api/use/:user
    if (pathname === '/api/use' || pathname.startsWith('/api/use/')) {
      let user = query.user || query.email || query.name;
      if (pathname.startsWith('/api/use/')) {
        user = pathname.split('/')[3];
      }
      if (!user) {
        return sendJson(res, 400, {
          creator: CREATOR,
          status: 'error',
          message: 'Parameter "user" is required.'
        });
      }
      const result = opUse(user);
      return sendJson(res, 200, result);
    }

    // /api/inbox or /api/inbox/:user
    if (pathname === '/api/inbox' || pathname.startsWith('/api/inbox/')) {
      let user = query.user;
      if (pathname.startsWith('/api/inbox/')) {
        user = pathname.split('/')[3];
      }
      if (!user) {
        return sendJson(res, 400, {
          creator: CREATOR,
          status: 'error',
          message: 'Parameter "user" is required'
        });
      }
      const result = await opInbox(user);
      delete result._rawMessages;
      return sendJson(res, result.status === 'success' ? 200 : 400, result);
    }

    // /api/read or /api/read/:user/:index
    if (pathname === '/api/read' || pathname.startsWith('/api/read/')) {
      let user = query.user;
      let index = query.index || query.key || query.id || '1';
      if (pathname.startsWith('/api/read/')) {
        const parts = pathname.split('/');
        user = parts[3];
        if (parts[4]) index = parts[4];
      }
      if (!user) {
        return sendJson(res, 400, {
          creator: CREATOR,
          status: 'error',
          message: 'Parameter "user" is required'
        });
      }
      const result = await opRead(user, index);
      return sendJson(res, result.status === 'success' ? 200 : 404, result);
    }

    // /api/dump or /api/dump/:user
    if (pathname === '/api/dump' || pathname.startsWith('/api/dump/')) {
      let user = query.user;
      if (pathname.startsWith('/api/dump/')) {
        user = pathname.split('/')[3];
      }
      if (!user) {
        return sendJson(res, 400, {
          creator: CREATOR,
          status: 'error',
          message: 'Parameter "user" is required'
        });
      }
      const result = await opDump(user);
      return sendJson(res, result.status === 'success' ? 200 : 400, result);
    }

    // SSE Stream
    if (pathname === '/api/stream' || pathname.startsWith('/api/stream/')) {
      let user = query.user;
      if (pathname.startsWith('/api/stream/')) {
        user = pathname.split('/')[3];
      }
      if (!user) {
        return sendJson(res, 400, {
          creator: CREATOR,
          status: 'error',
          message: 'Parameter "user" is required for stream'
        });
      }

      const clean = cleanRecipient(user);
      const intervalSec = parseInt(query.interval, 10) || 5;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write(`data: ${JSON.stringify({ creator: CREATOR, status: 'connected', email: `${clean}@${DOMAIN}` })}\n\n`);

      let knownKeys = new Set();
      const initial = await listInbox(clean);
      initial.forEach(m => m.storage?.key && knownKeys.add(m.storage.key));

      const timer = setInterval(async () => {
        try {
          const messages = await listInbox(clean);
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const key = msg.storage?.key;
            if (key && !knownKeys.has(key)) {
              knownKeys.add(key);
              const detail = await getEmailDetail(msg.storage.region || 'us', key);
              const eventPayload = {
                creator: CREATOR,
                status: 'success',
                event: 'new_email',
                email: `${clean}@${DOMAIN}`,
                data: {
                  id: key,
                  region: msg.storage?.region || 'us',
                  from: detail.meta?.name ? `${detail.meta.name} <${detail.meta.emailAddress}>` : (detail.meta?.emailAddress || null),
                  subject: detail.meta?.subject || '(No Subject)',
                  date: detail.meta?.Date || new Date().toISOString(),
                  otp: detail.possibleOtp || null,
                  links: detail.links || [],
                  text: detail.text,
                  html: detail.html
                }
              };
              res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
            }
          }
        } catch (err) {}
      }, intervalSec * 1000);

      req.on('close', () => {
        clearInterval(timer);
      });
      return;
    }

    // Not found
    return sendJson(res, 404, {
      creator: CREATOR,
      status: 'error',
      message: `Endpoint '${pathname}' not found`
    });
  } catch (err) {
    return sendJson(res, 500, {
      creator: CREATOR,
      status: 'error',
      message: err.message
    });
  }
}

// Export module agar Vercel dapat mengeksekusi sebagai Serverless Function
module.exports = handleApiRequest;

function startServer(port = 3000) {
  const server = http.createServer(handleApiRequest);
  server.listen(port, () => {
    console.log(`\n${ui.coral}●${ui.reset} ${ui.bold}Akunlama REST API Server${ui.reset} ${ui.dim}· by ${ui.coral}${CREATOR}${ui.reset}`);
    console.log(`  ${ui.dim}Listening on:${ui.reset} ${ui.green}http://localhost:${port}${ui.reset}`);
    console.log(`\n  ${ui.dim}Press Ctrl+C to stop server${ui.reset}\n`);
  });
}

// CLI Operations
async function handleUse(target) {
  const res = opUse(target);
  if (res.status === 'success') currentMailbox = res.data.username;
  printJson(res);
}

async function handleGen() {
  const res = opGenerate();
  currentMailbox = res.data.username;
  printJson(res);
}

async function handleInbox(username) {
  const clean = cleanRecipient(username || currentMailbox);
  const res = await opInbox(clean);
  if (res.status === 'success') {
    currentMailbox = clean;
    lastMessages = res._rawMessages;
    delete res._rawMessages;
  }
  printJson(res);
}

async function handleRead(target, indexOrKey) {
  let cleanUser = currentMailbox;
  let targetIndex = indexOrKey;

  if (!targetIndex) {
    if (!currentMailbox) {
      printJson({ creator: CREATOR, status: 'error', message: 'No mailbox selected.' });
      return;
    }
    targetIndex = target;
  } else {
    cleanUser = cleanRecipient(target);
    currentMailbox = cleanUser;
  }

  const res = await opRead(cleanUser, targetIndex);
  printJson(res);
}

async function handleDump(username) {
  const clean = cleanRecipient(username || currentMailbox);
  const res = await opDump(clean);
  if (res.status === 'success') currentMailbox = clean;
  printJson(res);
}

function showHelpUI() {
  console.log(`\n${ui.dim}Commands: use, gen, inbox, read, dump, server, clear, exit${ui.reset}\n`);
}

function getPromptStr() {
  return currentMailbox ? `${ui.dim}${currentMailbox}@${DOMAIN}${ui.reset} ${ui.coral}❯${ui.reset} ` : `${ui.coral}❯${ui.reset} `;
}

async function executeCommand(line) {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;

  const rawCmd = parts[0].toLowerCase();
  const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;

  if (cmd === 'exit' || cmd === 'quit') process.exit(0);
  if (cmd === 'help') return showHelpUI();
  if (cmd === 'clear') return console.clear();
  if (cmd === 'server') return startServer(parseInt(parts[1], 10) || 3000);
  if (cmd === 'gen') return await handleGen();
  if (cmd === 'use') return await handleUse(parts[1]);
  if (cmd === 'inbox') return await handleInbox(parts[1] || currentMailbox);
  if (cmd === 'read') return await handleRead(parts[1], parts[2]);
  if (cmd === 'dump') return await handleDump(parts[1]);

  printJson({ creator: CREATOR, status: 'error', message: `Unknown command '${cmd}'` });
}

function startRepl() {
  console.log(`${ui.coral}●${ui.reset} ${ui.bold}akunlama CLI${ui.reset}`);
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => { rl.setPrompt(getPromptStr()); rl.prompt(); };
  prompt();
  rl.on('line', async (line) => { await executeCommand(line); prompt(); });
  rl.on('close', () => process.exit(0));
}

// Hanya jalankan CLI / Server jika dieksekusi langsung (bukan di-import Vercel)
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    startRepl();
  } else {
    executeCommand(args.join(' '));
  }
}

