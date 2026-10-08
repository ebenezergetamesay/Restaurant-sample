import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BUSINESS } from './config';
import { categories, menu } from './menu';
import './styles.css';

const money = n => `${Number(n).toLocaleString()} ETB`;
const CART_KEY = 'barch_demo_cart_v1';

function ethiopianTimeLabel(value){
  const [h,m] = value.split(':').map(Number);
  const period = h < 6 ? 'ሌሊት' : h < 12 ? 'ጠዋት' : h < 18 ? 'ከሰዓት' : 'ማታ';
  const eh = ((h - 6 + 12) % 12) || 12;
  return `${eh}:${String(m).padStart(2,'0')} ${period}`;
}

function ethiopianTimeOptions(){
  const out=[];
  for(let h=6;h<24;h++) for(let m=0;m<60;m+=30){
    const value=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    out.push({value,label:ethiopianTimeLabel(value)});
  }
  for(let h=0;h<6;h++) for(let m=0;m<60;m+=30){
    const value=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    out.push({value,label:ethiopianTimeLabel(value)});
  }
  return out;
}

function getEthiopianNow(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Addis_Ababa',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const rawH=Number(parts.find(p=>p.type==='hour')?.value||'0');
  const h=rawH % 24;
  const m=parts.find(p=>p.type==='minute')?.value||'00';
  return `${String(h).padStart(2,'0')}:${m}`;
}

function validateReceipt(file){
  if(!file) return {ok:false,reason:'Please select the payment receipt image.'};
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)) return {ok:false,reason:'Choose a JPG, PNG, or WEBP receipt image.'};
  if(file.size < 8*1024) return {ok:false,reason:'This image is unusually small to be a payment receipt. Please choose the actual receipt screenshot/photo.'};
  if(file.size > 10*1024*1024) return {ok:false,reason:'Receipt image is larger than 10 MB.'};
  return {ok:true,reason:'Receipt selected. The restaurant must still verify the payment.'};
}

function App(){
  const [cart,setCart]=useState(()=>{try{return JSON.parse(localStorage.getItem(CART_KEY)||'{}')}catch{return {}}});
  const [category,setCategory]=useState('Popular');
  const [showCart,setShowCart]=useState(false);
  const [showCheckout,setShowCheckout]=useState(false);
  const [selectedOrder,setSelectedOrder]=useState(null);

  useEffect(()=>localStorage.setItem(CART_KEY,JSON.stringify(cart)),[cart]);
  const items=useMemo(()=>Object.entries(cart).map(([id,qty])=>({item:menu.find(x=>x.id===id),qty})).filter(x=>x.item),[cart]);
  const total=items.reduce((s,x)=>s+x.item.price*x.qty,0);
  const deposit=Math.ceil(total/2);
  const count=items.reduce((s,x)=>s+x.qty,0);
  const visible=menu.filter(x=>category==='Popular'?['m1','m6','m8','m11'].includes(x.id):x.category===category);

  const add=id=>setCart(c=>({...c,[id]:(c[id]||0)+1}));
  const change=(id,d)=>setCart(c=>{const n=(c[id]||0)+d;const x={...c}; if(n<=0)delete x[id]; else x[id]=n;return x});
  const clear=()=>setCart({});

  async function createOrder(form,receipt,orderId){
    const orderItems=items.map(x=>({id:x.item.id,qty:x.qty}));
    const payload={orderId,customer:form,items:orderItems};
    const data=new FormData();
    data.append('order',JSON.stringify(payload));
    data.append('receipt',receipt,receipt.name);
    let response;
    try {
      response=await fetch('/api/orders',{method:'POST',body:data});
    } catch(error) {
      console.error('Order API request could not connect:',error);
      throw new Error('Could not connect to the order API at /api/orders. Make sure the backend is running on port 3001 and Vite is running with its API proxy.');
    }
    const responseText=await response.text();
    const contentType=response.headers.get('content-type')||'unknown';
    let result;
    try {
      result=JSON.parse(responseText);
    } catch {
      const bodyPreview=responseText.trim().slice(0,500);
      result={error:bodyPreview||(
        response.status===502
          ? 'The Vite API proxy returned an empty response. Confirm the backend is running with npm run dev:server on port 3001.'
          : `Server returned an empty ${response.status} response (${contentType}).`
      )};
    }
    if(!response.ok) {
      const details=`HTTP ${response.status} ${response.statusText}: ${result.error||'No error details returned.'}`;
      console.error('Order API rejected submission:',{url:response.url,status:response.status,statusText:response.statusText,contentType,details:result});
      throw new Error(details);
    }
    clear(); setShowCheckout(false); setShowCart(false); setSelectedOrder(result.order);
  }
  return <div className="app">
    <header className="nav">
      <div className="brand"><div className="logo">BFZ</div><div><strong>BARCH FOOD ZONE</strong><span>Fresh food • Easy ordering</span></div></div>
      <nav><a href="#how">How it works</a><a href="#menu">Menu</a><button className="cartBtn" onClick={()=>setShowCart(true)}>Cart <b>{count}</b></button></nav>
    </header>

    <main>
      <section className="hero">
        <div className="heroCopy"><div className="eyebrow">BARCH FOOD ZONE</div><h1>Order your favorites.<br/><em>Pay 50% now.</em></h1><p>Choose whatever you want from the menu, place your order, pay the 50% deposit, and send your receipt on Telegram. Pay the remaining 50% at the restaurant.</p><div className="heroActions"><a className="primary" href="#how">How to order</a></div><div className="trust"><span>✓ Order by Telegram</span><span>✓ 50% deposit</span><span>✓ Receipt verification</span></div></div>
        <div className="heroCard"><div className="receiptTop"><span>ORDER PREVIEW</span><span>BFZ-DEMO</span></div><div className="previewLine"><span>2 × Firfir</span><b>480 ETB</b></div><div className="previewLine"><span>1 × Pasta</span><b>170 ETB</b></div><div className="previewLine"><span>2 × Drink</span><b>300 ETB</b></div><div className="divider"/><div className="previewLine totalLine"><span>Total</span><b>950 ETB</b></div><div className="deposit"><span>50% deposit</span><strong>475 ETB</strong></div><div className="balance">475 ETB remaining at restaurant</div></div>
      </section>

      <section id="how" className="steps"><h2>HOW IT WORKS</h2><div className="sameDayNotice">Orders are for the same day unless Barch Food Zone makes another arrangement with you.</div><div className="stepGrid"><Step n="1" title="Choose your food" text="Select anything you want from the menu and add it to your cart."/><Step n="2" title="Review your order" text="Check your items, quantities, and total price."/><Step n="3" title="Pay 50%" text="After placing your order, you will be asked to pay 50% of the total."/><Step n="4" title="Send your receipt" text="Send the payment receipt through Telegram."/><Step n="5" title="Wait for confirmation" text="Barch Food Zone will verify your payment and confirm your order through Telegram. Payment confirmation is done by the restaurant, not automatically by this website."/><Step n="6" title="Pay the remaining 50%" text="Pay the remaining balance when you arrive at Barch Food Zone."/></div></section>

      <section id="menu" className="menuSection"><div className="sectionHead"><div><div className="eyebrow">TODAY'S MENU</div><h2>Choose whatever you want</h2></div></div>
        <div className="chips">{categories.map(c=><button className={category===c?'active':''} onClick={()=>setCategory(c)} key={c}>{c}</button>)}</div>
        <div className="menuGrid">{visible.map(x=><article className="foodCard" key={x.id}><div className="foodImage"><div className="foodInitial">{x.name[0]}</div>{x.badge&&<span className="badge">{x.badge}</span>}</div><div className="foodBody"><div className="foodTitle"><div className="foodNames"><div className="amharic amharicTop">{x.amharic}</div><h3>{x.name}</h3></div><strong>{money(x.price)}</strong></div><p>{x.description}</p><button onClick={()=>add(x.id)} className="add">Add to order <span>+</span></button></div></article>)}</div>
        <div className="menuNotice">Menu names and prices in this demo are a starter transcription from the supplied photos. Verify them with Barch before publishing. The original menu photos are included in the project under <code>public/menu/</code>.</div>
      </section>

    </main>

    <footer><div><strong>BARCH FOOD ZONE</strong><span>Online ordering demo</span></div><div>© 2026 Barch Food Zone</div></footer>

    {showCart&&<Modal title="Your order" close={()=>setShowCart(false)}><Cart items={items} change={change} total={total} deposit={deposit} onCheckout={()=>{if(items.length){setShowCheckout(true)}}} clear={clear}/></Modal>}
    {showCheckout&&<Modal title="Checkout & 50% deposit" close={()=>setShowCheckout(false)}><Checkout total={total} deposit={deposit} items={items} onSubmit={createOrder}/></Modal>}
    {selectedOrder&&<Modal title={`Order ${selectedOrder.id}`} close={()=>setSelectedOrder(null)}><OrderResult order={selectedOrder}/></Modal>}
  </div>
}
function Step({n,title,text}){return <div className="step"><span>{n}</span><h3>{title}</h3><p>{text}</p></div>}
function Modal({title,close,children}){return <div className="overlay" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modalHead"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</div></div>}
function Cart({items,change,total,deposit,onCheckout,clear}){return <div>{!items.length?<div className="empty"><div>🛒</div><h3>Your cart is empty</h3><p>Add items from the menu to start an order.</p></div>:<><div className="cartItems">{items.map(x=><div className="cartRow" key={x.item.id}><div><strong>{x.item.name}</strong><small>{x.item.amharic}</small></div><div className="qty"><button onClick={()=>change(x.item.id,-1)}>−</button><b>{x.qty}</b><button onClick={()=>change(x.item.id,1)}>+</button></div><strong>{money(x.item.price*x.qty)}</strong></div>)}</div><div className="summary"><div><span>Total</span><b>{money(total)}</b></div><div><span>50% deposit</span><b>{money(deposit)}</b></div><div><span>Pay at restaurant</span><b>{money(total-deposit)}</b></div></div><div className="modalActions"><button className="secondary" onClick={clear}>Clear</button><button className="primary" onClick={onCheckout}>Continue</button></div></>}</div>}
function Checkout({total,deposit,items,onSubmit}){
  const options=useMemo(()=>ethiopianTimeOptions(),[]);
  const [orderId]=useState(()=>`BFZ-${crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`);
  const [form,setForm]=useState({name:'',phone:'',time:getEthiopianNow(),payment:'Telebirr',notes:''});
  const [receipt,setReceipt]=useState(null);
  const [receiptCheck,setReceiptCheck]=useState(null);
  const [err,setErr]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  return <form onSubmit={e=>{
    e.preventDefault();
    if(submitting) return;
    if(!form.name||!form.phone||!form.time){setErr('Please fill in name, phone and pickup time.');return}
    const check=validateReceipt(receipt);
    if(!check.ok){setReceiptCheck(check);setErr(check.reason);return}
    setErr('');
    setSubmitting(true);
    onSubmit(form,receipt,orderId).catch(error=>setErr(error.message)).finally(()=>setSubmitting(false));
  }}>
    <div className="todayNotice">📍 <b>Pickup is today.</b> Orders are for the same day unless Barch specifically agrees otherwise.</div>
    <div className="depositBox"><div><span>Order total</span><b>{money(total)}</b></div><div><span>Pay now (50%)</span><strong>{money(deposit)}</strong></div><div><span>Pay at restaurant</span><b>{money(total-deposit)}</b></div></div>
    <div className="formGrid">
      <label>Name<input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Customer name"/></label>
      <label>Phone<input value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="09..."/></label>
      <label className="full">Pickup time — Ethiopian time<select value={form.time} onChange={e=>set('time',e.target.value)}>{options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
      <label className="full">Payment method<select value={form.payment} onChange={e=>set('payment',e.target.value)}>{BUSINESS.paymentMethods.map(x=><option key={x.name}>{x.name}</option>)}</select></label>
      <label className="full">Notes<textarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Allergies, preferences, pickup notes..."/></label>
    </div>
    <div className="payInstruction"><strong>Submit your receipt:</strong> Pay {money(deposit)} using the selected method, then upload the receipt image. The website sends the actual image and order details to Barch via Telegram. The restaurant will manually verify payment. The remaining {money(total-deposit)} is paid at the restaurant.</div>
    <label className="upload">🧾 Payment receipt<input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0]||null;setReceipt(f);setReceiptCheck(f?validateReceipt(f):null);setErr('')}}/><small>{receipt?receipt.name:'Choose JPG, PNG, or WEBP receipt image (max 10 MB)'}</small>{receiptCheck&&<span className={receiptCheck.ok?'receiptOk':'receiptWarn'}>{receiptCheck.ok?'✓ '+receiptCheck.reason:'⚠ '+receiptCheck.reason}</span>}</label>
    {err&&<div className="error">{err}</div>}
    <button className="primary fullBtn" type="submit" disabled={submitting}>{submitting?'Submitting order and receipt…':'Submit order & receipt'}</button>
    <p className="tiny">Submitting a receipt does not confirm payment. Barch Food Zone will manually verify the image before confirming or rejecting the payment.</p>
  </form>
}
function OrderResult({order}){
  return <div><div className="statusBanner"><span className="statusDot"/> Receipt submitted — waiting for restaurant verification.</div><div className="orderDetails"><p><b>Order:</b> {order.id}</p><p><b>Customer:</b> {order.customer.name} · {order.customer.phone}</p><p><b>Pickup:</b> Today · {ethiopianTimeLabel(order.customer.time)} Ethiopian time</p><p><b>Total:</b> {money(order.total)} · <b>Deposit:</b> {money(order.deposit)} · <b>Balance:</b> {money(order.balance)}</p><p><b>Receipt:</b> Sent as an image to the restaurant.</p><p><b>Payment:</b> Not confirmed. The restaurant must review the receipt.</p></div>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
