import { menu } from '../../src/menu.js';

// Image type validators
const imageTypes = {
  'image/jpeg': { extension: '.jpg', matches: buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: '.png', matches: buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: '.webp', matches: buffer => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' }
};

const MAX_RECEIPT_SIZE = 5 * 1024 * 1024; // 5 MB for Netlify Functions

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

async function telegramRequest(token, method, body) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let response;
  try {
    response = await fetch(url, { method: 'POST', body });
  } catch (error) {
    throw new Error(`Could not connect to Telegram (${method}): ${error.message}.`);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    const description = typeof result?.description === 'string' ? result.description : 'Telegram returned an invalid response.';
    throw new Error(`Telegram ${method} returned HTTP ${response.status}: ${description}.`);
  }
  return result.result;
}

async function sendOrderToTelegram(order, receiptBuffer, receiptMimeType, token, chatId) {
  // Send receipt photo
  const photoForm = new FormData();
  photoForm.set('chat_id', chatId);
  photoForm.set('caption', `Payment receipt for #${order.id}\n${order.customer.name} · ${order.customer.phone}\nDeposit: ${money(order.deposit)} — pending restaurant verification`);
  const receiptBlob = new Blob([receiptBuffer], { type: receiptMimeType });
  photoForm.set('photo', receiptBlob, `receipt-${order.id}.jpg`);
  const photo = await telegramRequest(token, 'sendPhoto', photoForm);

  // Send order message
  const messageForm = new FormData();
  messageForm.set('chat_id', chatId);
  messageForm.set('text', buildOrderMessage(order));
  const message = await telegramRequest(token, 'sendMessage', messageForm);

  return {
    telegramMessageIds: {
      photo: photo.message_id,
      text: message.message_id
    },
    telegramStatus: 'delivered'
  };
}

export default async function handler(event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  // Check environment variables
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramChatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!telegramToken || !telegramChatId) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Order submission is not configured. The restaurant must configure Telegram on the server.' })
    };
  }

  try {
    // Parse multipart form data
    const formData = await event.body;
    if (!formData || typeof formData !== 'string') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Request body is required.' })
      };
    }

    // Simple multipart parser for FormData
    const boundary = event.headers['content-type']?.split('boundary=')[1];
    if (!boundary) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid content type. FormData is required.' })
      };
    }

    // Parse form fields and file
    let orderJsonStr = '';
    let receiptBuffer = null;
    let receiptMimeType = '';
    const parts = formData.split(`--${boundary}`);

    for (const part of parts) {
      if (part.includes('name="order"')) {
        const match = part.match(/\r?\n\r?\n([\s\S]*?)\r?\n/);
        if (match) orderJsonStr = match[1];
      } else if (part.includes('name="receipt"')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const headers = part.substring(0, headerEnd);
          const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
          if (contentTypeMatch) receiptMimeType = contentTypeMatch[1].trim();
          
          const bodyStart = headerEnd + 4;
          const bodyEnd = part.lastIndexOf('\r\n');
          const bodyText = part.substring(bodyStart, bodyEnd);
          receiptBuffer = Buffer.from(bodyText, 'binary');
        }
      }
    }

    // Validate receipt
    if (!receiptBuffer) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Upload a receipt image.' })
      };
    }

    if (receiptBuffer.length > MAX_RECEIPT_SIZE) {
      return {
        statusCode: 413,
        body: JSON.stringify({ error: `Receipt image must be ${MAX_RECEIPT_SIZE / (1024 * 1024)} MB or smaller.` })
      };
    }

    const imageType = imageTypes[receiptMimeType];
    if (!imageType || !imageType.matches(receiptBuffer)) {
      return {
        statusCode: 415,
        body: JSON.stringify({ error: 'Receipt must be a valid JPG, PNG, or WEBP image.' })
      };
    }

    // Parse and validate order
    let submittedOrder;
    try {
      submittedOrder = JSON.parse(orderJsonStr);
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Order details must be valid JSON.' })
      };
    }

    let orderData;
    try {
      orderData = validateOrder(submittedOrder);
    } catch (error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: error.message })
      };
    }

    const orderId = submittedOrder.orderId;
    if (typeof orderId !== 'string' || !/^BFZ-[A-F0-9]{12}$/.test(orderId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'A valid order ID is required.' })
      };
    }

    // Build order object
    const order = {
      id: orderId,
      createdAt: new Date().toISOString(),
      ...orderData,
      receipt: { mimeType: receiptMimeType, size: receiptBuffer.length },
      paymentStatus: 'pending_verification'
    };

    // Send to Telegram
    let telegramResult;
    try {
      telegramResult = await sendOrderToTelegram(order, receiptBuffer, receiptMimeType, telegramToken, telegramChatId);
    } catch (error) {
      console.error(`Telegram delivery failed for ${orderId}:`, error.message);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `Could not deliver order to Telegram. Order ID: ${orderId}. Please contact the restaurant.` })
      };
    }

    // Return success response
    return {
      statusCode: 201,
      body: JSON.stringify({
        order: {
          ...order,
          ...telegramResult
        }
      })
    };
  } catch (error) {
    console.error('Order submission error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'The order could not be processed. Please contact the restaurant before retrying.' })
    };
  }
}
