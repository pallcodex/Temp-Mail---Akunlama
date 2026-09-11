#!/usr/bin/env node

const http = require('http');
const https = require('https');
const readline = require('readline');
const url = require('url');

const BASE_URL = 'https://akunlama.com/api';
const DOMAIN = 'akunlama.com';
const CREATOR = 'Lann';

// Styling untuk Claude Code UI (HANYA untuk border, prompt, dan status dot)
// TIDAK PERNAH disuntikkan ke dalam string JSON agar JSON tetap valid & murni
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

// Core Operations returning data objects
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

  // Check if indexOrKey is numeric index
  const parsedInt = parseInt(indexOrKey, 10);
  if (!isNaN(parsedInt) && parsedInt > 0 && parsedInt <= messages.length) {
    targetIndex = parsedInt;
    selected = messages[parsedInt - 1];
  } else {
    // Search by key/id
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

// CLI Handlers
async function handleUse(target) {
  const res = opUse(target);
  if (res.status === 'success') {
    currentMailbox = res.data.username;
  }
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
      printJson({
        creator: CREATOR,
        status: 'error',
        message: 'No mailbox selected. Run: inbox <user> first'
      });
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
  if (res.status === 'success') {
    currentMailbox = clean;
  }
  printJson(res);
}

async function handleWatch(username, intervalSeconds = 5) {
  const clean = cleanRecipient(username || currentMailbox);
  if (!clean) {
    printJson({
      creator: CREATOR,
      status: 'error',
      message: 'Username or email required for watch'
    });
    return;
  }

  currentMailbox = clean;
  const fullEmail = `${clean}@${DOMAIN}`;

  console.log(`\n${ui.coral}●${ui.reset} ${ui.dim}Watching${ui.reset} ${ui.bold}${fullEmail}${ui.reset} ${ui.dim}(polling every ${intervalSeconds}s · press Ctrl+C to return)${ui.reset}\n`);

  let knownKeys = new Set();
  const initial = await listInbox(clean);
  initial.forEach(m => m.storage?.key && knownKeys.add(m.storage.key));
  console.log(`${ui.dim}  Initial: ${knownKeys.size} message(s) present${ui.reset}\n`);

  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      try {
        const messages = await listInbox(clean);
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const key = msg.storage?.key;
          if (key && !knownKeys.has(key)) {
            knownKeys.add(key);
            const detail = await getEmailDetail(msg.storage.region || 'us', key);

            printJson({
              creator: CREATOR,
              status: 'success',
              event: 'new_email',
              email: fullEmail,
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
            });
          }
        }
      } catch (err) {}
    }, intervalSeconds * 1000);

    const onSigInt = () => {
      clearInterval(timer);
      process.removeListener('SIGINT', onSigInt);
      console.log(`\n${ui.dim}● Stopped watcher${ui.reset}\n`);
      resolve();
    };
    process.once('SIGINT', onSigInt);
  });
}

// REST API Server Implementation
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function startServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
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
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = parsed.query;

    try {
      // Root info
      if (pathname === '/' || pathname === '/api') {
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
            message: 'Parameter "user" is required. Usage: /api/use/:name or /api/use?user=:name'
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

      // SSE Stream: /api/stream or /api/stream/:user
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
  });

  server.listen(port, () => {
    console.log(`\n${ui.coral}●${ui.reset} ${ui.bold}Akunlama REST API Server${ui.reset} ${ui.dim}· by ${ui.coral}${CREATOR}${ui.reset}`);
    console.log(`  ${ui.dim}Listening on:${ui.reset} ${ui.green}http://localhost:${port}${ui.reset}`);
    console.log(`  ${ui.dim}Endpoints:${ui.reset}`);
    console.log(`    ${ui.coral}GET${ui.reset}  /api/gen`);
    console.log(`    ${ui.coral}GET${ui.reset}  /api/inbox?user=<name>`);
    console.log(`    ${ui.coral}GET${ui.reset}  /api/read?user=<name>&index=<no>`);
    console.log(`    ${ui.coral}GET${ui.reset}  /api/dump?user=<name>`);
    console.log(`    ${ui.coral}GET${ui.reset}  /api/stream?user=<name>`);
    console.log(`\n  ${ui.dim}Press Ctrl+C to stop server${ui.reset}\n`);
  });
}

function showHelpUI() {
  console.log(`
${ui.dim}╭─ Commands${ui.reset}
${ui.dim}│${ui.reset}  ${ui.coral}use${ui.reset} ${ui.dim}<name>${ui.reset}            Set custom email (e.g. use lann -> lann@akunlama.com)
${ui.dim}│${ui.reset}  ${ui.coral}gen${ui.reset}                   Generate random cat-themed email (e.g. sleepy-kitten-42)
${ui.dim}│${ui.reset}  ${ui.coral}inbox${ui.reset} ${ui.dim}[user]${ui.reset}          List messages (returns JSON)
${ui.dim}│${ui.reset}  ${ui.coral}read${ui.reset} ${ui.dim}[user] <no>${ui.reset}     Read email content, links, & OTP (returns JSON)
${ui.dim}│${ui.reset}  ${ui.coral}dump${ui.reset} ${ui.dim}[user]${ui.reset}          Extract all messages with full body & links
${ui.dim}│${ui.reset}  ${ui.coral}watch${ui.reset} ${ui.dim}[user] [sec]${ui.reset}  Live monitor incoming emails (streams JSON)
${ui.dim}│${ui.reset}  ${ui.coral}server${ui.reset} ${ui.dim}[port]${ui.reset}         Start REST API server (default port 3000)
${ui.dim}│${ui.reset}  ${ui.coral}clear${ui.reset}                 Clear screen
${ui.dim}│${ui.reset}  ${ui.coral}exit${ui.reset}                  Quit
${ui.dim}│${ui.reset}
${ui.dim}╰─ Author: ${ui.coral}${CREATOR}${ui.dim} · Shortcut: Enter username to view inbox, or a number to read${ui.reset}
`);
}

function getPromptStr() {
  if (currentMailbox) {
    return `${ui.dim}${currentMailbox}@${DOMAIN}${ui.reset} ${ui.coral}❯${ui.reset} `;
  }
  return `${ui.coral}❯${ui.reset} `;
}

async function executeCommand(line) {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;

  const rawCmd = parts[0].toLowerCase();
  const cmd = rawCmd.startsWith('/') ? rawCmd.slice(1) : rawCmd;

  if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
    process.exit(0);
  }

  if (cmd === 'help' || cmd === '?') {
    showHelpUI();
    return;
  }

  if (cmd === 'clear' || cmd === 'cls') {
    console.clear();
    return;
  }

  if (cmd === 'server' || cmd === 'serve' || cmd === 'api') {
    const port = parseInt(parts[1], 10) || 3000;
    startServer(port);
    return;
  }

  if (cmd === 'gen' || cmd === 'new' || cmd === 'random') {
    await handleGen();
    return;
  }

  if (cmd === 'use' || cmd === 'set') {
    await handleUse(parts[1]);
    return;
  }

  if (cmd === 'inbox' || cmd === 'list' || cmd === 'ls') {
    const target = parts[1] || currentMailbox;
    if (!target) {
      printJson({
        creator: CREATOR,
        status: 'error',
        message: 'Username or email required: inbox <user>'
      });
      return;
    }
    await handleInbox(target);
    return;
  }

  if (cmd === 'read' || cmd === 'open' || cmd === 'view') {
    if (parts[2]) {
      await handleRead(parts[1], parts[2]);
    } else if (parts[1]) {
      await handleRead(parts[1], null);
    } else {
      printJson({
        creator: CREATOR,
        status: 'error',
        message: 'Usage: read <number>'
      });
    }
    return;
  }

  if (cmd === 'dump' || cmd === 'all') {
    await handleDump(parts[1]);
    return;
  }

  if (cmd === 'watch' || cmd === 'listen') {
    const target = parts[1] && isNaN(parseInt(parts[1], 10)) ? parts[1] : currentMailbox;
    const interval = parts[2] ? parseInt(parts[2], 10) : (parts[1] && !isNaN(parseInt(parts[1], 10)) ? parseInt(parts[1], 10) : 5);
    await handleWatch(target, interval);
    return;
  }

  if (/^\d+$/.test(cmd)) {
    if (currentMailbox) {
      await handleRead(cmd, null);
      return;
    }
  }

  if (/^[a-zA-Z0-9_\-\.]+(@[a-zA-Z0-9_\-\.]+)?$/.test(cmd)) {
    await handleInbox(cmd);
    return;
  }

  printJson({
    creator: CREATOR,
    status: 'error',
    message: `Unknown command '${cmd}'. Type /help for available commands.`
  });
}

function startRepl() {
  console.log(`${ui.coral}●${ui.reset} ${ui.bold}akunlama${ui.reset} ${ui.dim}· by ${ui.coral}${CREATOR}${ui.dim} · disposable email cli${ui.reset}`);
  console.log(`${ui.dim}  Type /help for commands, or enter an email address to start.${ui.reset}\n`);

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => {
      const completions = ['gen', 'use', 'inbox', 'read', 'dump', 'watch', 'server', 'clear', 'exit', 'help'];
      const hits = completions.filter(c => c.startsWith(line.trim()));
      return [hits.length ? hits : completions, line];
    }
  });

  const prompt = () => {
    rl.setPrompt(getPromptStr());
    rl.prompt();
  };

  prompt();

  rl.on('line', async (line) => {
    try {
      await executeCommand(line);
    } catch (err) {
      printJson({
        creator: CREATOR,
        status: 'error',
        message: err.message
      });
    }
    prompt();
  });

  rl.on('close', () => {
    console.log(`\n${ui.dim}Goodbye.${ui.reset}`);
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Jika tanpa argumen, buka interactive prompt Claude Code
  if (args.length === 0) {
    startRepl();
    return;
  }

  const first = args[0];
  if (first === 'help' || first === '--help' || first === '-h') {
    showHelpUI();
    return;
  }

  try {
    await executeCommand(args.join(' '));
  } catch (err) {
    printJson({
      creator: CREATOR,
      status: 'error',
      message: err.message
    });
  }
}

main();
