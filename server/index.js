import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { menu } from '../src/menu.js';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(SERVER_DIR, '.env') });
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const imageTypes = {
  'image/jpeg': { extension: '.jpg', matches: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: '.png', matches: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: '.webp', matches: buffer => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }
};

function money(amount) {
  return `${Number(amount).toLocaleString('en-US')} ETB`;
}

function ethiopianTimeLabel(value) {
  const [hour, minute] = value.split(':').map(Number);
  const period = hour < 6 ? 'ሌሊት' : hour < 12 ? 'ጠዋት' : hour < 18 ? 'ከሰዓት' : 'ማታ';
  const displayHour = ((hour - 6 + 12) % 12) || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function buildOrderMessage(order) {
  const lines = order.items.map(item =>
    `• ${item.name}${item.amharic ? ` (${item.amharic})` : ''} × ${item.qty} — ${money(item.price)} each (${money(item.price * item.qty)})`
  );
  return [
    '🍽️ BARCH FOOD ZONE',
    'NEW ORDER — RECEIPT SUBMITTED',
    '',
    `Order: #${order.id}`,
    '',
    `Customer: ${order.customer.name}`,
    `Phone: ${order.customer.phone}`,
    '',
    'ORDER:',
    ...lines,
    '',
    `TOTAL: ${money(order.total)}`,
    `💰 DEPOSIT REQUIRED: ${money(order.deposit)}`,
    `💵 REMAINING: ${money(order.balance)}`,
    '',
    `🕐 Pickup today: ${ethiopianTimeLabel(order.customer.time)} (Ethiopian time)`,
    `💳 Payment: ${order.customer.payment}`,
    `Notes: ${order.customer.notes || 'None'}`,
    '',
    'Payment status: PENDING — verify the attached receipt manually.'
  ].join('\n');
}

function validateOrder(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Order details are required.');
  const { customer, items } = input;
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) throw new Error('Customer details are required.');
  const name = typeof customer.name === 'string' ? customer.name.trim() : '';
  const phone = typeof customer.phone === 'string' ? customer.phone.trim() : '';
  const time = typeof customer.time === 'string' ? customer.time : '';
  const payment = typeof customer.payment === 'string' ? customer.payment : '';
  const notes = typeof customer.notes === 'string' ? customer.notes.trim() : '';
  if (!name || name.length > 120) throw new Error('Enter a customer name up to 120 characters.');
  if (!phone || phone.length > 30 || phone.replace(/\D/g, '').length < 7) throw new Error('Enter a valid customer phone number.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid pickup time.');
  if (!['Telebirr', 'CBE', 'Other'].includes(payment)) throw new Error('Choose a valid payment method.');
  if (notes.length > 500) throw new Error('Order notes must be 500 characters or fewer.');
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) throw new Error('An order must contain between 1 and 20 menu items.');

  const orderItems = items.map(entry => {
    const item = menu.find(menuItem => menuItem.id === entry?.id);
    if (!item || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 99) {
      throw new Error('An order item or quantity is invalid.');
    }
    return { id: item.id, name: item.name, amharic: item.amharic, qty: entry.qty, price: item.price };
  });
  const total = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deposit = Math.ceil(total / 2);
  return {
    customer: { name, phone, time, payment, notes },
    items: orderItems,
    total,
    deposit,
    balance: total - deposit
  };
}

async function readOrders(dataDir) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, 'orders.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeOrders(dataDir, orders) {
  const destination = path.join(dataDir, 'orders.json');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(orders, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, destination);
}

async function telegramRequest(token, method, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body });
  } catch (error) {
    throw new Error(`Could not connect to Telegram (${method}): ${error.message}. The order and receipt are stored; contact the restaurant before trying again.`);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const description = typeof result?.description === 'string' ? result.description : 'Telegram returned an invalid response.';
    throw new Error(`Telegram ${method} returned HTTP ${response.status}: ${description}. The order and receipt are stored; contact the restaurant before trying again.`);
  }
  return result.result;
}

async function sendOrderToTelegram(order, receiptPath, telegramConfig, telegramFetch, saveOrder) {
  const { token, chatId } = telegramConfig;
  order.telegramMessageIds ||= {};
  if (!order.telegramMessageIds.photo) {
    const photoForm = new FormData();
    photoForm.set('chat_id', chatId);
    photoForm.set('caption', `Payment receipt for #${order.id}\n${order.customer.name} · ${order.customer.phone}\nDeposit: ${money(order.deposit)} — pending restaurant verification`);
    const imageBlob = new Blob([await readFile(receiptPath)], { type: order.receipt.mimeType });
    photoForm.set('photo', imageBlob, order.receipt.filename);
    const photo = await telegramRequest(token, 'sendPhoto', photoForm, telegramFetch);
    order.telegramMessageIds.photo = photo.message_id;
    await saveOrder(order);
  }
  if (!order.telegramMessageIds.text) {
    const messageForm = new FormData();
    messageForm.set('chat_id', chatId);
    messageForm.set('text', buildOrderMessage(order));
    const message = await telegramRequest(token, 'sendMessage', messageForm, telegramFetch);
    order.telegramMessageIds.text = message.message_id;
    await saveOrder(order);
  }
  order.telegramStatus = 'delivered';
  await saveOrder(order);
  return order;
}

function createApp({ dataDir = process.env.ORDER_DATA_DIR || path.join(SERVER_DIR, 'data'), env = process.env, telegramFetch = fetch } = {}) {
  const app = express();
  const telegramConfig = {
    token: typeof env.TELEGRAM_BOT_TOKEN === 'string' ? env.TELEGRAM_BOT_TOKEN.trim() : '',
    chatId: typeof env.TELEGRAM_CHAT_ID === 'string' ? env.TELEGRAM_CHAT_ID.trim() : ''
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_RECEIPT_SIZE, files: 1, fields: 1, fieldSize: 32 * 1024 }
  });
  let writeQueue = Promise.resolve();
  const serializeWrite = operation => {
    const pending = writeQueue.then(operation);
    writeQueue = pending.catch(() => {});
    return pending;
  };
  const saveOrder = order => serializeWrite(async () => {
    const orders = await readOrders(dataDir);
    const index = orders.findIndex(saved => saved.id === order.id);
    if (index === -1) orders.unshift(order);
    else orders[index] = order;
    await writeOrders(dataDir, orders);
  });

  app.get('/api/health', (_request, response) => response.json({
    ok: true,
    telegramConfigured: Boolean(telegramConfig.token && telegramConfig.chatId),
    telegramBotTokenConfigured: Boolean(telegramConfig.token),
    telegramChatIdConfigured: Boolean(telegramConfig.chatId)
  }));

  app.post('/api/orders', (request, response, next) => {
    if (!telegramConfig.token || !telegramConfig.chatId) {
      return response.status(503).json({ error: 'Order submission is not configured. The restaurant must configure Telegram on the server.' });
    }
    return upload.single('receipt')(request, response, error => error ? next(error) : next());
  }, async (request, response) => {
    let receiptPath;
    try {
      const file = request.file;
      if (!file) return response.status(400).json({ error: 'Upload a receipt image.' });
      const imageType = imageTypes[file.mimetype];
      if (!imageType || !imageType.matches(file.buffer)) {
        return response.status(415).json({ error: 'Receipt must be a valid JPG, PNG, or WEBP image.' });
      }
      let submittedOrder;
      try {
        submittedOrder = JSON.parse(request.body.order);
      } catch {
        return response.status(400).json({ error: 'Order details must be valid JSON.' });
      }
      let orderData;
      try {
        orderData = validateOrder(submittedOrder);
      } catch (error) {
        return response.status(400).json({ error: error.message });
      }
      const id = submittedOrder.orderId;
      if (typeof id !== 'string' || !/^BFZ-[A-F0-9]{12}$/.test(id)) {
        return response.status(400).json({ error: 'A valid order ID is required.' });
      }
      const previousOrder = (await readOrders(dataDir)).find(saved => saved.id === id);
      if (previousOrder?.telegramStatus === 'delivered') return response.status(200).json({ order: previousOrder });
      if (previousOrder) {
        try {
          const receiptPath = path.join(dataDir, 'receipts', previousOrder.receipt.filename);
          const order = await sendOrderToTelegram(previousOrder, receiptPath, telegramConfig, telegramFetch, saveOrder);
          return response.status(200).json({ order });
        } catch (error) {
          previousOrder.telegramStatus = 'delivery_failed';
          await saveOrder(previousOrder);
          console.error(`Telegram delivery retry failed for ${previousOrder.id}: ${error.message}`);
          return response.status(502).json({ error: `${error.message} Order ID: ${previousOrder.id}` });
        }
      }
      const receiptFilename = `${randomUUID()}${imageType.extension}`;
      const receiptsDir = path.join(dataDir, 'receipts');
      receiptPath = path.join(receiptsDir, receiptFilename);
      await mkdir(receiptsDir, { recursive: true });
      await writeFile(receiptPath, file.buffer, { flag: 'wx', mode: 0o600 });

      const order = {
        id,
        createdAt: new Date().toISOString(),
        ...orderData,
        receipt: { filename: receiptFilename, mimeType: file.mimetype, size: file.size },
        paymentStatus: 'pending_verification',
        telegramStatus: 'sending'
      };
      await saveOrder(order);

      try {
        await sendOrderToTelegram(order, receiptPath, telegramConfig, telegramFetch, saveOrder);
        return response.status(201).json({ order });
      } catch (error) {
        order.telegramStatus = 'delivery_failed';
        await saveOrder(order);
        console.error(`Telegram delivery failed for ${id}: ${error.message}`);
        return response.status(502).json({ error: `${error.message} Order ID: ${id}` });
      }
    } catch (error) {
      if (receiptPath) console.error('Order submission failed after receipt processing:', error.message);
      return response.status(500).json({ error: 'The order could not be saved. Please contact the restaurant before retrying.' });
    }
  });

  function requireAdmin(request, response, next) {
    if (!env.ADMIN_API_KEY) return response.status(503).json({ error: 'Restaurant verification API is not configured.' });
    if (request.get('x-admin-api-key') !== env.ADMIN_API_KEY) return response.status(401).json({ error: 'Unauthorized.' });
    return next();
  }

  app.get('/api/admin/orders', requireAdmin, async (_request, response) => {
    try {
      return response.json({ orders: await readOrders(dataDir) });
    } catch (error) {
      console.error('Could not read stored orders:', error.message);
      return response.status(500).json({ error: 'Could not read stored orders.' });
    }
  });

  app.get('/api/admin/orders/:id/receipt', requireAdmin, async (request, response) => {
    try {
      const order = (await readOrders(dataDir)).find(saved => saved.id === request.params.id);
      if (!order) return response.status(404).json({ error: 'Order not found.' });
      response.type(order.receipt.mimeType);
      response.set('Content-Disposition', `inline; filename="${order.receipt.filename}"`);
      return response.sendFile(path.join(dataDir, 'receipts', order.receipt.filename));
    } catch (error) {
      console.error('Could not retrieve receipt:', error.message);
      return response.status(500).json({ error: 'Could not retrieve receipt.' });
    }
  });

  app.patch('/api/admin/orders/:id/payment-status', requireAdmin, express.json({ limit: '2kb' }), async (request, response) => {
    const { status } = request.body || {};
    if (!['payment_confirmed', 'payment_rejected'].includes(status)) {
      return response.status(400).json({ error: 'Status must be payment_confirmed or payment_rejected.' });
    }
    try {
      const updated = await serializeWrite(async () => {
        const orders = await readOrders(dataDir);
        const order = orders.find(saved => saved.id === request.params.id);
        if (!order) return null;
        order.paymentStatus = status;
        order.verifiedAt = new Date().toISOString();
        await writeOrders(dataDir, orders);
        return order;
      });
      if (!updated) return response.status(404).json({ error: 'Order not found.' });
      return response.json({ order: updated });
    } catch (error) {
      console.error('Could not update payment verification:', error.message);
      return response.status(500).json({ error: 'Could not update payment verification.' });
    }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return response.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Receipt image must be 10 MB or smaller.' : 'Upload one receipt image only.' });
    }
    console.error('Unhandled API error:', error.message);
    return response.status(500).json({ error: `The request could not be processed: ${error.message}` });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, '0.0.0.0', () => console.log(`Barch ordering API listening on http://0.0.0.0:${port}`));
}

export { createApp };
