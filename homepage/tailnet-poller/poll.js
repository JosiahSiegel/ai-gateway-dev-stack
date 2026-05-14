#!/usr/bin/env node
// Poll the Tailscale API and merge live tailnet devices into
// homepage/config/services.yaml. Zero dependencies — mirrors the style of
// provider-proxy/provider-proxy.js so the repo stays node-built-ins-only.
//
// Env (one of the auth pairs is required):
//   TAILSCALE_OAUTH_CLIENT_ID + TAILSCALE_OAUTH_CLIENT_SECRET
//                            non-expiring OAuth client (recommended);
//                            poller exchanges these for short-lived access
//                            tokens at runtime. Takes precedence if both
//                            this pair and TAILSCALE_API_KEY are set.
//                            Scopes: `devices:core:read` (required) and
//                            `services:read` (optional, enables the VIP
//                            services tiles).
//   TAILSCALE_API_KEY        tskey-api-... — max 90-day expiry; rotate
//                            manually before expiration.
//
//   TAILSCALE_TAILNET        tailnet name; default "-" (your default tailnet)
//   TAILSCALE_TS_DOMAIN      your-tailnet.ts.net (used as the fallback when
//                            an API device record lacks a full FQDN)
//   TAILSCALE_HOSTNAME       this node's Tailscale hostname; when set, the
//                            poller adds an ssh:// tile for this host.
//   HOMEPAGE_SSH_USER        SSH username for the host tile; default root.
//   HOMEPAGE_SSH_TILE        set to 0/false/off to disable the host SSH tile.
//   TAILSCALE_TAG_FILTER     optional, e.g. "tag:web". Empty = include all.
//   POLL_INTERVAL_MS         default 60000
//   TEMPLATE_PATH            input template
//   OUTPUT_PATH              services.yaml written here

'use strict';

const fs = require('fs');
const https = require('https');

const API_KEY = process.env.TAILSCALE_API_KEY || '';
const OAUTH_CLIENT_ID = process.env.TAILSCALE_OAUTH_CLIENT_ID || '';
const OAUTH_CLIENT_SECRET = process.env.TAILSCALE_OAUTH_CLIENT_SECRET || '';
const USE_OAUTH = !!(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET);
const TAILNET = process.env.TAILSCALE_TAILNET || '-';
const TS_DOMAIN = process.env.TAILSCALE_TS_DOMAIN || '';
const TAILSCALE_HOSTNAME = process.env.TAILSCALE_HOSTNAME || '';
const HOMEPAGE_SSH_USER = process.env.HOMEPAGE_SSH_USER || 'root';
const HOMEPAGE_SSH_TILE = !['0', 'false', 'off', 'no'].includes((process.env.HOMEPAGE_SSH_TILE || '1').toLowerCase());
const TAG_FILTER = process.env.TAILSCALE_TAG_FILTER || '';
const INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/template/services.template.yaml';
const OUTPUT_PATH = process.env.OUTPUT_PATH || '/output/services.yaml';

// Distinct token so it can't collide with prose in template comments.
// Anchored to start-of-line via the regex below so even if the literal
// string appears mid-line (e.g. in documentation), we won't false-match.
const MARKER = '# >>> TAILNET_POLLER_MANAGED >>> do not edit below this line';
const MARKER_RE = /^# >>> TAILNET_POLLER_MANAGED >>>.*$/m;

function log(...a) { console.log('[poller]', ...a); }
function err(...a) { console.error('[poller]', ...a); }

// Some node errors (ECONNRESET, socket hangups) arrive with code but no
// message. Stringify defensively so we never log a blank line.
function describeError(e) {
  if (!e) return '(no error object)';
  const parts = [];
  if (e.message) parts.push(e.message);
  if (e.code) parts.push(`code=${e.code}`);
  if (e.errno) parts.push(`errno=${e.errno}`);
  if (e.syscall) parts.push(`syscall=${e.syscall}`);
  if (parts.length === 0) parts.push(String(e));
  return parts.join(' ');
}

if (!USE_OAUTH && !API_KEY) {
  err('no credentials set (need TAILSCALE_API_KEY or OAuth client) — copying template once and exiting.');
  try { fs.copyFileSync(TEMPLATE_PATH, OUTPUT_PATH); } catch (e) { err(e.message); process.exit(1); }
  process.exit(0);
}

// OAuth bearer token cache. Refreshed lazily when missing or near expiry.
let cachedToken = '';
let cachedTokenExpiresAt = 0;

function fetchOAuthToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
    }).toString();
    const req = https.request({
      hostname: 'api.tailscale.com',
      path: '/api/v2/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
      timeout: 15000,
      // Force IPv4. Docker bridge networks commonly lack IPv6 routes, and
      // Node's dual-stack resolver may hand back an AAAA record that then
      // fails with ENETUNREACH on the second attempt.
      family: 4,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const j = JSON.parse(data);
            if (!j.access_token) return reject(new Error('oauth response missing access_token'));
            resolve({ token: j.access_token, expiresIn: j.expires_in || 3600 });
          } catch (e) { reject(new Error('invalid JSON from oauth: ' + e.message)); }
        } else {
          reject(new Error(`oauth ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('oauth request timeout after 15s')); });
    req.write(body);
    req.end();
  });
}

async function getAuthHeader() {
  if (!USE_OAUTH) {
    return 'Basic ' + Buffer.from(API_KEY + ':').toString('base64');
  }
  // Refresh 60s before expiry to avoid mid-request token death.
  if (!cachedToken || Date.now() > cachedTokenExpiresAt - 60_000) {
    const { token, expiresIn } = await fetchOAuthToken();
    cachedToken = token;
    cachedTokenExpiresAt = Date.now() + expiresIn * 1000;
    log(`refreshed oauth access token (expires in ${expiresIn}s)`);
  }
  return 'Bearer ' + cachedToken;
}

async function tsGet(path) {
  const authHeader = await getAuthHeader();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.tailscale.com',
      path,
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      timeout: 15000,
      // Force IPv4. Docker bridge networks commonly lack IPv6 routes, and
      // Node's dual-stack resolver may hand back an AAAA record that then
      // fails with ENETUNREACH on the second attempt.
      family: 4,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('invalid JSON from tailscale: ' + e.message)); }
        } else {
          // 401 means our cached token went stale early — drop it so the
          // next tick re-exchanges instead of looping on a dead token.
          if (res.statusCode === 401) cachedTokenExpiresAt = 0;
          const e = new Error(`tailscale API ${res.statusCode} (${path}): ${body.slice(0, 200)}`);
          e.statusCode = res.statusCode;
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request timeout after 15s')); });
    req.end();
  });
}

function fetchDevices() {
  return tsGet(`/api/v2/tailnet/${encodeURIComponent(TAILNET)}/devices`);
}

// VIP services (the newer "Services" feature — separate from devices).
// Requires the `services:read` OAuth scope. Non-fatal if the call fails;
// the poller still writes devices so the page isn't empty.
function fetchVipServices() {
  return tsGet(`/api/v2/tailnet/${encodeURIComponent(TAILNET)}/vip-services`);
}

// Double-quote a YAML scalar when it contains anything that could confuse the
// parser. Conservative — when in doubt, quote.
function yqs(s) {
  if (typeof s !== 'string') s = String(s);
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildHostSshYaml() {
  if (!HOMEPAGE_SSH_TILE || !TAILSCALE_HOSTNAME || !TS_DOMAIN) return '';
  const fqdn = TAILSCALE_HOSTNAME.includes('.') ? TAILSCALE_HOSTNAME : `${TAILSCALE_HOSTNAME}.${TS_DOMAIN}`;
  const out = ['- Infrastructure:'];
  out.push('    - "This host SSH":');
  out.push(`        href: ${yqs(`ssh://${HOMEPAGE_SSH_USER}@${fqdn}`)}`);
  out.push(`        description: ${yqs(`SSH as ${HOMEPAGE_SSH_USER} via Tailscale`)}`);
  out.push('        icon: mdi-console');
  return out.join('\n') + '\n';
}

function buildTailnetYaml(devices) {
  let kept = devices.slice();
  if (TAG_FILTER) {
    kept = kept.filter((d) => Array.isArray(d.tags) && d.tags.includes(TAG_FILTER));
  }
  kept.sort((a, b) => (a.hostname || a.name || '').localeCompare(b.hostname || b.name || ''));

  const out = ['- Tailnet:'];
  if (kept.length === 0) {
    out.push('    # No tailnet devices matched the current filter.');
    return out.join('\n') + '\n';
  }
  for (const d of kept) {
    const short = d.hostname || (d.name || '').split('.')[0] || 'unknown';
    const fqdn = d.name || (TS_DOMAIN ? `${short}.${TS_DOMAIN}` : short);
    const addr = (d.addresses && d.addresses[0]) || '';
    const desc = [d.os, addr].filter(Boolean).join(' · ');
    out.push(`    - ${yqs(short)}:`);
    out.push(`        href: ${yqs('https://' + fqdn)}`);
    if (desc) out.push(`        description: ${yqs(desc)}`);
    out.push('        icon: si-tailscale');
  }
  return out.join('\n') + '\n';
}

// VIP service `name` comes back as e.g. "svc:cloudcli" — strip the prefix
// for the hostname and tile label.
function svcShortName(name) {
  if (typeof name !== 'string') return 'unknown';
  return name.startsWith('svc:') ? name.slice(4) : name;
}

function buildVipServicesYaml(services) {
  let kept = services.slice();
  if (TAG_FILTER) {
    kept = kept.filter((s) => Array.isArray(s.tags) && s.tags.includes(TAG_FILTER));
  }
  kept.sort((a, b) => svcShortName(a.name).localeCompare(svcShortName(b.name)));

  const out = ['- Tailscale Services:'];
  if (kept.length === 0) {
    out.push('    # No VIP services matched the current filter.');
    return out.join('\n') + '\n';
  }
  for (const s of kept) {
    const short = svcShortName(s.name);
    const fqdn = TS_DOMAIN ? `${short}.${TS_DOMAIN}` : short;
    const desc = s.comment || (Array.isArray(s.ports) ? s.ports.join(', ') : '');
    out.push(`    - ${yqs(short)}:`);
    out.push(`        href: ${yqs('https://' + fqdn)}`);
    if (desc) out.push(`        description: ${yqs(desc)}`);
    out.push('        icon: si-tailscale');
  }
  return out.join('\n') + '\n';
}

async function tick() {
  try {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const devicesData = await fetchDevices();
    const hostSshYaml = buildHostSshYaml();
    const tailnetYaml = buildTailnetYaml(devicesData.devices || []);

    // Services fetch is best-effort: missing scope or older API plan
    // shouldn't block device discovery.
    let servicesYaml = '';
    let servicesCount = 0;
    try {
      const servicesData = await fetchVipServices();
      const services = servicesData.vipServices || servicesData.services || [];
      servicesCount = services.length;
      servicesYaml = buildVipServicesYaml(services);
    } catch (e) {
      const code = e.statusCode;
      if (code === 401 || code === 403) {
        err(`vip-services unavailable (${code}) — OAuth client likely missing services:read scope; skipping`);
      } else if (code === 404) {
        err('vip-services endpoint not found — tailnet may not have Services enabled; skipping');
      } else {
        err('vip-services fetch failed:', describeError(e));
      }
    }

    let base = template;
    const match = MARKER_RE.exec(base);
    if (match) base = base.slice(0, match.index);
    base = base.replace(/\s+$/, '') + '\n';

    const managed = hostSshYaml + (hostSshYaml ? '\n' : '') + tailnetYaml + (servicesYaml ? '\n' + servicesYaml : '');
    const final = base + '\n' + MARKER + '\n' + managed;

    // Write in-place (no rename). Some file watchers — notably homepage's
    // chokidar on Docker Desktop / WSL bind mounts — miss inotify events
    // from rename(2). A truncate+write triggers a reliable modify event.
    fs.writeFileSync(OUTPUT_PATH, final, 'utf8');

    log(`wrote ${OUTPUT_PATH} (${(devicesData.devices || []).length} devices, ${servicesCount} services${TAG_FILTER ? `, filter=${TAG_FILTER}` : ''})`);
  } catch (e) {
    err('poll failed:', describeError(e));
  }
}

(async function main() {
  log(`starting; auth=${USE_OAUTH ? 'oauth' : 'api-key'} tailnet=${TAILNET} interval=${INTERVAL}ms${TAG_FILTER ? ` filter=${TAG_FILTER}` : ''}`);
  await tick();
  setInterval(tick, INTERVAL);
})();
