# Barch Food Zone — Online Ordering Prototype

A local React/Vite prototype for Barch Food Zone. It demonstrates:

- Restaurant menu browsing
- Menu categories
- Add-to-cart with quantity controls
- Automatic total / 50% deposit / remaining balance
- Customer checkout
- Payment-method selection
- Receipt upload to the backend and delivery as an actual Telegram image
- Prepared Telegram order details
- LocalStorage persistence
- Original supplied menu photos in `public/menu/`

## Run locally

Requirements: Node.js 18+.

```bash
npm install
```

## Backend and Telegram setup

Order submission requires the Node API in `server/index.js`. It validates the order against the server menu, recalculates all prices and the 50% deposit, validates the receipt's image type and size, saves the receipt under a random server-generated filename, then sends the actual image with Telegram `sendPhoto` and the full order details with `sendMessage`. Orders and receipt files are stored under `server/data/`. Payment stays pending until a restaurant operator manually verifies it.

The Telegram bot token, destination chat ID, and restaurant API key exist only in `server/.env`; none are sent to the browser.

1. In Telegram, create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Sign in to the desired recipient Telegram account (for testing, `@Markov_198`) and send `/start` to the new bot.
3. Obtain the numeric chat ID for the conversation. A bot cannot initiate a private conversation to `@Markov_198` by username; the recipient must start the bot first. Use a trusted Telegram bot/API update method to read the numeric `message.chat.id`.
4. Copy `server/.env.example` to `server/.env` and fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and a long random `ADMIN_API_KEY`. Never commit or share `server/.env`.
5. In one terminal run `npm run dev:server`; in another run `npm run dev`. Vite forwards `/api` requests to the backend at `127.0.0.1:3001`.

For production, serve the frontend and API behind the same HTTPS origin (or configure an HTTPS reverse proxy for `/api`). Do not expose the backend directly to the internet without HTTPS and suitable rate limiting.

### Restaurant verification

The API never trusts client-submitted payment status. A new order is saved as `pending_verification`. After viewing the image delivered to Telegram, an operator can inspect/update the record with the server-only `ADMIN_API_KEY`:

```http
GET /api/admin/orders
GET /api/admin/orders/BFZ-ORDERID/receipt
PATCH /api/admin/orders/BFZ-ORDERID/payment-status
X-Admin-Api-Key: <ADMIN_API_KEY>
Content-Type: application/json
{"status":"payment_confirmed"}
```

Use `payment_rejected` instead of `payment_confirmed` to reject a receipt. The receipt retrieval endpoint is also protected by the admin key.

## Important: menu accuracy

The supplied menu photos contain glare/reflections that make several Amharic names difficult to read reliably. The demo therefore contains an editable starter menu and clearly labels it as needing verification. Replace the entries in `src/menu.js` with the restaurant's confirmed menu before publishing.

## Receipt validation

The API accepts only JPG/JPEG, PNG, or WEBP images up to 10 MB. It checks the image signature, stores the bytes without executing them, and associates the generated order ID with the stored receipt. A browser-side file check is only for quick feedback; backend validation is authoritative.

## Production payment flow

1. Customer builds cart.
2. Website calculates total, 50% deposit and remaining balance.
3. Customer pays the deposit using the restaurant's chosen payment method.
4. Customer submits receipt.
5. Backend recalculates the order, creates an order ID, and stores the uploaded receipt.
6. Telegram bot sends the actual receipt image and complete order details to the restaurant.
7. Restaurant visually verifies payment.
8. Restaurant marks payment confirmed or rejected through the protected API.
9. Remaining 50% is paid at the restaurant.

Do not automatically trust a customer-provided receipt or mark payment received without verification.

## Updated demo behavior
- Menu cards show Amharic item names first, with the English name underneath.
- The six-step ordering guide appears before the menu and explains same-day orders, payment, receipt submission, and restaurant verification.
- Orders are for TODAY; no customer date field is requested.
- Pickup time is selected/displayed using the Ethiopian clock convention and Africa/Addis_Ababa current time.
- The test Telegram recipient is intended to be `@Markov_198`; configure that account's numeric chat ID on the backend after starting the bot conversation.
- Receipt submission reports that the order is waiting for restaurant verification. It never confirms payment automatically.

Run the backend integration checks with `npm run test:server`.
