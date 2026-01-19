const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const crypto = require("crypto");

const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

const { stat } = require("fs");
const { count } = require("console");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// MiddleWare
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;

  if (!token) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

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
    const userCollection = db.collection("users");
    const riderCollection = db.collection("riders");
    const paymentCollection = db.collection("payments");
    const trackingsCollection = db.collection("trackings");

    // middle admin  before allowing admin activity
    // must be used after verifyFBToken middleware

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      next();
    };

    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status,
        createdAt: new Date(),
      };

      const result = await trackingsCollection.insertOne(log);

      return result;
    };

    // Get Users

    app.get("/users", verifyFBToken, async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};
      if (searchText) {
        query.$or = [
          { displayName: { $regex: searchText, $options: "i" } },
          { email: { $regex: searchText, $options: "i" } },
        ];
      }
      const cursor = userCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // get spacific user

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    // Update User

    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const newRole = req.body.role;
        const updateInfo = {
          $set: {
            role: newRole,
          },
        };
        const result = await userCollection.updateOne(query, updateInfo);
        res.send(result);
      },
    );

    // Post User

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const emailExist = await userCollection.findOne({ email });
      if (emailExist) {
        return res.send({ message: "Email Already Exist. Please Log in " });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Get Parcels

    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email, deliveryStatus } = req.query;
      if (email) {
        query.senderemail = email;
      }

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = parcelCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/rider", async (req, res) => {
      const { riderEmail, deliveryStatus } = req.query;
      const query = {};
      if (riderEmail) {
        query.riderEmail = riderEmail;
      }

      if (deliveryStatus !== "Parcel Delivered") {
        // query.deliveryStatus = {$in:["Driver Assigned", "Rider Arriving"]}
        query.deliveryStatus = { $nin: ["Parcel Delivered"] };
      } else {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.findOne(query);
      res.send(result);
    });

    app.get("/parcels/delivery-status/stats", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$deliveryStatus",
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            status: "$_id",
            count: 1,
            _id: 0,
          },
        },
      ];

      const result = await parcelCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      const trackingId = generateTrackingId();
      parcel.createdAt = new Date();
      parcel.trackingId = trackingId;
      logTracking(trackingId, "Parcel Created");
      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    // update after rider assigned for parcel delivery

    app.patch("/parcels/:id", async (req, res) => {
      const { riderName, riderEmail, riderId, trackingId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          deliveryStatus: "Driver Assigned",
          riderId: riderId,
          riderName: riderName,
          riderEmail: riderEmail,
        },
      };

      const result = await parcelCollection.updateOne(query, updateDoc);

      // update Rider Info

      const riderQuery = { _id: new ObjectId(riderId) };
      const riderUpdate = {
        $set: {
          workStatus: "In_Delivery",
        },
      };

      const riderResult = await riderCollection.updateOne(
        riderQuery,
        riderUpdate,
      );

      // Log Tracking
      logTracking(trackingId, "Driver Assigned");

      res.send(riderResult);
    });

    // update after rider confirmation for parcel

    app.patch("/parcels/:id/status", async (req, res) => {
      const id = req.params.id;
      const { deliveryStatus, riderId, trackingId } = req.body;
      const query = { _id: new ObjectId(id) };
      const statusUpdate = {
        $set: {
          deliveryStatus,
        },
      };

      if (deliveryStatus === "Parcel Delivered") {
        const riderQuery = { _id: new ObjectId(riderId) };
        const riderUpdate = {
          $set: {
            workStatus: "Available",
          },
        };

        const riderResult = await riderCollection.updateOne(
          riderQuery,
          riderUpdate,
        );
      }

      const result = await parcelCollection.updateOne(query, statusUpdate);

      // log Tracking
      logTracking(trackingId, deliveryStatus);
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
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
          trackingId: paymentInfo.trackingId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    // payment success information

    app.patch("/payment-success", async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return res.send({
          message: "Already Exist",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      const trackingId = session.metadata.trackingId;

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "Panding-Pickup",
          },
        };

        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        const paymentResult = await paymentCollection.insertOne(payment);

        logTracking(trackingId, "Panding-Pickup");

        return res.send({
          success: true,
          trackingId: trackingId,
          transactionId: session.payment_intent,
          modifyParcel: result,
          paymentInfo: paymentResult,
        });
      }
      return res.send({ success: false });
    });

    // get payment api

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }
      }

      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();

      res.send(result);
    });

    // Riders post

    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "panding";
      rider.createdAt = new Date();

      const result = await riderCollection.insertOne(rider);
      res.send(result);
    });

    // get Riders

    app.get("/riders", async (req, res) => {
      const { status, district, workStatus } = req.query;
      const query = {};
      if (status) {
        query.status = status;
      }

      if (district) {
        query.district = district;
      }

      if (workStatus) {
        query.workStatus = workStatus;
      }

      const cursor = riderCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();

      res.send(result);
    });

    // Optional think. If it seems difficult you can Avoid it
    app.get("/riders/delivery-per-day", async (req, res) => {
      const email = req.query.email;
      const pipeline = [
        {
          $match: {
            riderEmail: email,
            deliveryStatus: "Parcel Delivered",
          },
        },
      ];

      const result = await parcelCollection.aggregate(pipeline).toArray();
      res.send(result);
    });

    // patch rider  info
    app.patch("/riders/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const { status, workStatus } = req.body;
      const updatedDoc = {
        $set: {
          status: status,
          workStatus: workStatus,
        },
      };

      const result = await riderCollection.updateOne(query, updatedDoc);
      if (status === "Approved") {
        const email = req.body.email;
        const query = { email };
        const updateRole = {
          $set: {
            role: "Rider",
          },
        };

        const userUpdate = await userCollection.updateOne(query, updateRole);
      }

      res.send(result);
    });

    app.get("/trackings/:trackingId/logs", async (req, res) => {
      const trackingId = req.params.trackingId;
      const query = { trackingId };
      const cursor = trackingsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
