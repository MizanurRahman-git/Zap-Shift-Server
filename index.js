const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

const crypto = require("crypto")



const generateTrackingId = () =>{
  const prefix = "PRCL"
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const random = crypto.randomBytes(3).toString("hex").toUpperCase()

  return `${prefix}-${date}-${random}`
}

// MiddleWare
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@simple-crud-serv.sbd6kzc.mongodb.net/?appName=Simple-CRUD-Serv`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("Zap Shift Server Running!");
});

async function run() {
  try {
    await client.connect();
    const db = client.db("zap_shift_db");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments")

    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderemail = email;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // payment chackout related api

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: paymentInfo.parcelName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({url: session.url})

    });



    // payment success information
    
    app.patch('/payment-success', async (req, res)=> {
      const sessionId = req.query.session_id
      const trackingId = generateTrackingId()
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      if(session.payment_status === "paid"){
        const id = session.metadata.parcelId
        const query = {_id: new ObjectId(id)}
        const update ={
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId
          }
        }

        const result = await parcelCollection.updateOne(query, update)

        const payment = {
          amount: session.amount_total/100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date()
        }

        if(session.payment_status === "paid"){
          const paymentResult = await paymentCollection.insertOne(payment)
          res.send({
            success: true, 
            trackingId: trackingId,
            transactionId: session.payment_intent,
            modifyParcel: result, 
            paymentInfo: paymentResult})
        }
      }

      res.send({success: false})
    })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
