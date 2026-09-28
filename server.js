const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Order counter for the owner's dashboard. It counts orders submitted from the checkout.
// Because OPay is manual, this is NOT automatic payment verification; the owner still confirms payment.
let orderCount = 0;
let lastOrderAt = null;

app.post("/api/orders", (req, res) => {
  orderCount += 1;
  lastOrderAt = new Date().toISOString();
  res.json({ ok: true, orderNumber: orderCount });
});

app.get("/owner", (req, res) => {
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIG TUNZ Owner Dashboard</title><style>body{font-family:Arial;background:#fff5f8;margin:0;padding:30px;color:#222}.box{max-width:650px;margin:auto;background:#fff;border-radius:20px;padding:28px;box-shadow:0 8px 30px #0001}h1{color:#e91e63}.count{font-size:64px;font-weight:900;color:#e91e63;margin:20px 0}.note{color:#666;line-height:1.5}.refresh{border:0;background:#e91e63;color:#fff;padding:12px 18px;border-radius:10px;font-weight:800;cursor:pointer}</style></head><body><div class="box"><h1>BIG TUNZ FOODIES — Owner Dashboard</h1><p class="note">Orders submitted through the website:</p><div class="count" id="count">—</div><p id="last" class="note"></p><button class="refresh" onclick="load()">Refresh</button><p class="note"><b>Important:</b> this counter records orders submitted after customers tap “I HAVE PAID — SEND ORDER”. Since payment is manual OPay transfer, you still need to confirm each payment before preparing the order.</p></div><script>async function load(){const r=await fetch('/api/order-stats');const d=await r.json();document.getElementById('count').textContent=d.orderCount;document.getElementById('last').textContent=d.lastOrderAt?'Last submitted: '+new Date(d.lastOrderAt).toLocaleString():'No orders submitted yet.'}load();</script></body></html>`);
});

app.get("/api/order-stats", (req, res) => {
  res.json({ orderCount, lastOrderAt });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`BIG TUNZ FOODIES running on port ${PORT}`));
