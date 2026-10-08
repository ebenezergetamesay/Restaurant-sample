import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApp } from './index.js';

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'barch-orders-'));
const telegramCalls = [];
let rejectTelegramMethod = null;
const app = createApp({
  dataDir,
  env: {
    TELEGRAM_BOT_TOKEN: ' test-token ',
    TELEGRAM_CHAT_ID: ' test-chat ',
    ADMIN_API_KEY: 'test-admin-key'
  },
  telegramFetch: async (url, options) => {
    const method = url.split('/').at(-1);
    assert.equal(url.includes('/bottest-token/'), true);
    telegramCalls.push({ method, body: options.body });
    if (method === rejectTelegramMethod) {
      rejectTelegramMethod = null;
      return { ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized: invalid bot token' }) };
    }
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: telegramCalls.length } })
    };
  }
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const adminHeaders = { 'x-admin-api-key': 'test-admin-key' };

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

function orderForm({ mimeType = 'image/jpeg', imageBytes = Buffer.alloc(9000), orderId = 'BFZ-D6E1B839151F' } = {}) {
  if (mimeType === 'image/jpeg') imageBytes.set([0xff, 0xd8, 0xff], 0);
  const form = new FormData();
  form.set('order', JSON.stringify({
    orderId,
    customer: { name: 'Abebe', phone: '0912345678', time: '13:00', payment: 'Telebirr', notes: 'No onions' },
    items: [{ id: 'm6', qty: 2, price: 1 }],
    paymentStatus: 'payment_confirmed',
    total: 2
  }));
  form.set('receipt', new Blob([imageBytes], { type: mimeType }), '../../unsafe-name.jpg');
  return form;
}

test('stores the actual receipt, sends it to Telegram with the order, and allows manual verification', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    telegramConfigured: true,
    telegramBotTokenConfigured: true,
    telegramChatIdConfigured: true
  });
  const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', body: orderForm() });
  assert.equal(response.status, 201);
  const { order } = await response.json();
  assert.equal(order.id, 'BFZ-D6E1B839151F');
  assert.equal(order.total, 340);
  assert.equal(order.deposit, 170);
  assert.equal(order.balance, 170);
  assert.equal(order.paymentStatus, 'pending_verification');
  assert.equal(order.telegramStatus, 'delivered');
  assert.deepEqual(order.telegramMessageIds, { photo: 1, text: 2 });
  assert.notEqual(order.receipt.filename, '../../unsafe-name.jpg');
  assert.equal(telegramCalls.length, 2);
  assert.equal(telegramCalls[0].method, 'sendPhoto');
  assert.equal(telegramCalls[0].body.get('chat_id'), 'test-chat');
  const sentPhoto = telegramCalls[0].body.get('photo');
  assert.equal(sentPhoto.name, order.receipt.filename);
  assert.deepEqual(Buffer.from(await sentPhoto.arrayBuffer()), (await readFile(path.join(dataDir, 'receipts', order.receipt.filename))));
  assert.equal(telegramCalls[0].body.get('caption').includes(order.id), true);
  assert.equal(telegramCalls[1].method, 'sendMessage');
  const message = telegramCalls[1].body.get('text');
  for (const requiredText of [order.id, 'Abebe', '0912345678', 'Shiro', '× 2', '170 ETB each (340 ETB)', '7:00 ከሰዓት', 'Telebirr', 'No onions', 'PENDING']) {
    assert.equal(message.includes(requiredText), true, `Telegram order text includes ${requiredText}`);
  }
  const retryResponse = await fetch(`${baseUrl}/api/orders`, { method: 'POST', body: orderForm() });
  assert.equal(retryResponse.status, 200);
  assert.equal((await retryResponse.json()).order.id, order.id);
  assert.equal(telegramCalls.length, 2);

  const unauthorized = await fetch(`${baseUrl}/api/admin/orders`);
  assert.equal(unauthorized.status, 401);
  const adminList = await fetch(`${baseUrl}/api/admin/orders`, { headers: adminHeaders });
  assert.equal((await adminList.json()).orders[0].id, order.id);
  const receiptResponse = await fetch(`${baseUrl}/api/admin/orders/${order.id}/receipt`, { headers: adminHeaders });
  assert.equal(receiptResponse.status, 200);
  assert.equal(receiptResponse.headers.get('content-type'), 'image/jpeg');

  const verifyResponse = await fetch(`${baseUrl}/api/admin/orders/${order.id}/payment-status`, {
    method: 'PATCH',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'payment_confirmed' })
  });
  assert.equal((await verifyResponse.json()).order.paymentStatus, 'payment_confirmed');
});

test('rejects unsupported or mismatched image types before Telegram delivery', async () => {
  const callsBefore = telegramCalls.length;
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    body: orderForm({ mimeType: 'image/gif', imageBytes: Buffer.from('not an image') })
  });
  assert.equal(response.status, 415);
  assert.match((await response.json()).error, /JPG, PNG, or WEBP/);
  assert.equal(telegramCalls.length, callsBefore);
});

test('retries partial Telegram delivery without sending the receipt photo twice', async () => {
  const orderId = 'BFZ-66D833F74275';
  const callsBefore = telegramCalls.length;
  rejectTelegramMethod = 'sendMessage';
  const failedResponse = await fetch(`${baseUrl}/api/orders`, { method: 'POST', body: orderForm({ orderId }) });
  assert.equal(failedResponse.status, 502);
  const failed = await failedResponse.json();
  assert.equal(failed.error.includes(orderId), true);
  assert.match(failed.error, /Telegram sendMessage returned HTTP 401: Unauthorized: invalid bot token/);

  const retryResponse = await fetch(`${baseUrl}/api/orders`, { method: 'POST', body: orderForm({ orderId }) });
  assert.equal(retryResponse.status, 200);
  const { order } = await retryResponse.json();
  assert.equal(order.id, orderId);
  assert.equal(order.telegramStatus, 'delivered');
  assert.deepEqual(telegramCalls.slice(callsBefore).map(call => call.method), ['sendPhoto', 'sendMessage', 'sendMessage']);
});

test('rejects missing or malformed order IDs', async () => {
  const form = orderForm({ orderId: 'bad-id' });
  const response = await fetch(`${baseUrl}/api/orders`, { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid order ID/);
});

test('reports unconfigured Telegram credentials and blocks order submission with HTTP 503', async () => {
  const unconfiguredApp = createApp({ dataDir: path.join(dataDir, 'unconfigured'), env: {} });
  const unconfiguredServer = unconfiguredApp.listen(0, '127.0.0.1');
  await once(unconfiguredServer, 'listening');
  const unconfiguredUrl = `http://127.0.0.1:${unconfiguredServer.address().port}`;
  try {
    const health = await fetch(`${unconfiguredUrl}/api/health`);
    assert.deepEqual(await health.json(), {
      ok: true,
      telegramConfigured: false,
      telegramBotTokenConfigured: false,
      telegramChatIdConfigured: false
    });
    const response = await fetch(`${unconfiguredUrl}/api/orders`, { method: 'POST', body: orderForm() });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  } finally {
    await new Promise((resolve, reject) => unconfiguredServer.close(error => error ? reject(error) : resolve()));
  }
});

test('rejects receipt files over the configured maximum size', async () => {
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    body: orderForm({ imageBytes: Buffer.alloc(10 * 1024 * 1024 + 1) })
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /10 MB/);
});
