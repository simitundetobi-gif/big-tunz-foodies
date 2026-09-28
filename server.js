// BIG TUNZ FOODIES payment server
// Node.js 18+ recommended.
// IMPORTANT: keep PAYSTACK_SECRET_KEY and WhatsApp access tokens on the server only.

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json({verify:(req,res,buf)=>{req.rawBody=buf}}));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const OWNER_WHATSAPP_TO = process.env.OWNER_WHATSAPP_TO || "2347072378866";
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_GRAPH_VERSION = process.env.WA_GRAPH_VERSION || "v23.0";
const WA_TEMPLATE_NAME = process.env.WA_TEMPLATE_NAME || "big_tunz_new_order";
const WA_TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || "en_US";

function requireConfig(res){
  if(!PAYSTACK_SECRET_KEY) {
    res.status(500).json({error:"PAYSTACK_SECRET_KEY is not configured on the server."});
    return false;
  }
  return true;
}

app.post("/api/create-payment", async (req,res)=>{
  try{
    if(!requireConfig(res)) return;
    const {name,phone,email,location,note,items,amount} = req.body;
    if(!name || !phone || !email || !location || !Array.isArray(items) || !items.length || !Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({error:"Please complete all order details."});

    // Recalculate from the server-side price list. Never trust the browser amount.
    const prices = {
      "Piece of Turkey":3500,
      "Piece of Chicken":2500,
      "Fried Sausages":500,
      "1 Portion Fried Plantain (Dodo)":500,
      "1 Slice Pancake":450,
      "Can of Zobo":700,
      "1 Fried Egg":400
    };
    let verifiedAmount = 300 + 800; // fixed packaging + delivery charges per order
    const cleanItems = items.map(i=>{
      const price = prices[i.name];
      const qty = Number(i.qty);
      if(!price || !Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error("Invalid item or quantity.");
      verifiedAmount += price * qty;
      return {name:i.name, qty, price};
    });
    cleanItems.push({name:"Packaging per order", qty:1, price:300});
    cleanItems.push({name:"Delivery", qty:1, price:800});

    const reference = "BTZ-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
    const response = await fetch("https://api.paystack.co/transaction/initialize",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+PAYSTACK_SECRET_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        email,
        amount:String(verifiedAmount * 100),
        currency:"NGN",
        reference,
        callback_url: process.env.PAYSTACK_CALLBACK_URL || undefined,
        metadata:{
          custom_fields:[
            {display_name:"Customer",variable_name:"customer",value:name},
            {display_name:"Phone",variable_name:"phone",value:phone},
            {display_name:"Delivery",variable_name:"delivery",value:location},
            {display_name:"Note",variable_name:"note",value:note || ""},
            {display_name:"Items",variable_name:"items",value:JSON.stringify(cleanItems)}
          ]
        }
      })
    });
    const data = await response.json();
    if(!response.ok || !data.status) return res.status(502).json({error:data.message || "Paystack initialization failed."});
    res.json({authorization_url:data.data.authorization_url,reference:data.data.reference});
  }catch(err){
    res.status(500).json({error:err.message || "Unable to create payment."});
  }
});

// Paystack webhook: configure this URL in Paystack Dashboard.
// The signature check prevents forged "payment successful" notifications.
app.post("/api/paystack/webhook", async (req,res)=>{
  const signature = req.headers["x-paystack-signature"];
  if(!signature || !PAYSTACK_SECRET_KEY) return res.sendStatus(401);
  const expected = crypto.createHmac("sha512",PAYSTACK_SECRET_KEY).update(req.rawBody).digest("hex");
  if(signature !== expected) return res.sendStatus(401);

  res.sendStatus(200); // acknowledge quickly

  const event = req.body;
  if(event.event !== "charge.success") return;

  const d = event.data || {};
  const metadata = d.metadata || {};
  const fields = {};
  (metadata.custom_fields || []).forEach(x=>fields[x.variable_name]=x.value);
  const paidAmount = Number(d.amount || 0) / 100;
  const itemsText = (()=>{
    try {
      const items = JSON.parse(fields.items || "[]");
      return items.map(x => `${x.name} x${x.qty} — ₦${Number(x.price) * Number(x.qty)}`).join("\n");
    } catch { return fields.items || "N/A"; }
  })();

  const orderText = `BIG TUNZ FOODIES — PAID ORDER%0A%0A` +
    `Customer: ${fields.customer || "N/A"}%0A` +
    `Phone: ${fields.phone || "N/A"}%0A` +
    `Delivery: ${fields.delivery || "N/A"}%0A` +
    `Items: ${encodeURIComponent(itemsText)}%0A` +
    `Amount: ₦${paidAmount}%0A` +
    `Reference: ${d.reference || "N/A"}%0A%0A` +
    `Payment verified by Paystack.`;

  // WhatsApp Cloud API notification to the owner's WhatsApp number.
  // For production, create an approved WhatsApp template matching your Meta setup.
  if(WA_ACCESS_TOKEN && WA_PHONE_NUMBER_ID){
    try{
      const url=`https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;
      const body={
        messaging_product:"whatsapp",
        to:OWNER_WHATSAPP_TO,
        type:"template",
        template:{
          name:WA_TEMPLATE_NAME,
          language:{code:WA_TEMPLATE_LANG},
          components:[{
            type:"body",
            parameters:[
              {type:"text",text:String(fields.customer || "N/A")},
              {type:"text",text:String(fields.phone || "N/A")},
              {type:"text",text:String(fields.delivery || "N/A")},
              {type:"text",text:String(itemsText).slice(0,900)},
              {type:"text",text:`₦${paidAmount}`},
              {type:"text",text:String(d.reference || "N/A")}
            ]
          }]
        }
      };
      await fetch(url,{method:"POST",headers:{
        "Authorization":"Bearer "+WA_ACCESS_TOKEN,
        "Content-Type":"application/json"
      },body:JSON.stringify(body)});
    }catch(err){
      console.error("WhatsApp notification error:",err.message);
    }
  } else {
    console.log("Paid order received. WhatsApp Cloud API is not configured yet:", decodeURIComponent(orderText));
  }
});

app.get("/payment-success",(req,res)=>{
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIG TUNZ — Payment</title>
  <style>body{font-family:Arial;background:#fff8ef;text-align:center;padding:50px;color:#222}.box{max-width:500px;margin:auto;background:white;padding:35px;border-radius:20px;box-shadow:0 10px 30px #0001}h1{color:#ff8a00}a{display:inline-block;margin-top:20px;padding:12px 18px;background:#171717;color:#fff;text-decoration:none;border-radius:25px}</style></head>
  <body><div class="box"><h1>Payment received</h1><p>Your payment has been returned to BIG TUNZ FOODIES. We are verifying the transaction and preparing your order.</p><a href="/">Back to BIG TUNZ FOODIES</a></div></body></html>`);
});

app.listen(PORT,()=>console.log(`BIG TUNZ FOODIES running on http://localhost:${PORT}`));
