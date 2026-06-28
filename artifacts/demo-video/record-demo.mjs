import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire('/Users/captain/python/arc_hack/package.json')
const { chromium } = require('playwright')

async function parseEnvFile(file) {
  const text = await fs.readFile(file, 'utf8')
  const env = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function signSession(secret, address) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256' }))
  const payload = base64url(JSON.stringify({
    sub: address.toLowerCase(),
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  }))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64url(new Uint8Array(sig))}`
}

const root = '/Users/captain/python/arc-lepton'
const env = await parseEnvFile(path.join(root, '.env.local'))
const appUrl = env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const address = '0xf8a17d8ab4c1e78419ef0895f1cb37ef7f221a98'
const jwt = await signSession(env.JWT_SECRET, address)
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const outRoot = path.join(root, 'artifacts/demo-video', `signal-ledger-${runId}`)
const framesDir = path.join(outRoot, 'frames')
await fs.mkdir(framesDir, { recursive: true })

const fps = 2
let frameIndex = 0
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
})
await context.addCookies([{ name: 'arc_session', value: jwt, url: appUrl, httpOnly: true, sameSite: 'Lax' }])
const page = await context.newPage()

async function shot(copies = 1) {
  const png = await page.screenshot({ fullPage: false })
  for (let i = 0; i < copies; i += 1) {
    frameIndex += 1
    await fs.writeFile(path.join(framesDir, `frame-${String(frameIndex).padStart(5, '0')}.png`), png)
  }
}

async function hold(seconds) {
  await shot(Math.max(1, Math.round(seconds * fps)))
}

async function hasText(text) {
  try {
    return await page.evaluate((needle) => document.body.innerText.includes(needle), text)
  } catch {
    return false
  }
}

await page.goto(`${appUrl}/research`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(2500)
await hold(10)

await page.locator('textarea').fill('Should I buy PEPE this week?')
await hold(5)
await page.locator('input:not([type="range"])').fill('0.0100')
await hold(5)
await page.getByRole('button', { name: '[ ▸ START RESEARCH ]' }).click()
await page.waitForTimeout(2000)
await hold(5)

let sawFinal = false
for (let second = 0; second < 75; second += 1) {
  await shot(fps)
  await page.waitForTimeout(1000)
  const completed = await hasText('COMPLETED:') || await hasText('[VIEW FULL REPORT')
  if (completed && second >= 18) {
    sawFinal = true
    break
  }
}
await hold(sawFinal ? 2 : 6)

if (sawFinal) {
  const reportButton = page.getByRole('button', { name: '[VIEW FULL REPORT →]' })
  if (await reportButton.count()) {
    await reportButton.click()
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(2000)
    await hold(22)
  }
}

await page.goto(`${appUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(2500)
await hold(10)

await fs.writeFile(path.join(outRoot, 'meta.json'), JSON.stringify({
  outRoot,
  framesDir,
  frameIndex,
  fps,
  sawFinal,
  finalUrl: page.url(),
}, null, 2))

await browser.close()
console.log(JSON.stringify({ outRoot, framesDir, frameIndex, fps, sawFinal }, null, 2))
