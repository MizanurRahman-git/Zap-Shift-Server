const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 3000;

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
    const db = client.db('zap_shift_db')
    const parcelCollection = db.collection('parcels')


    app.get('/parcels', async(req, res)=> {
        const query = {}
        const {email} = req.query
        if(email){
            query.senderemail = email
        }
        const cursor = parcelCollection.find(query)
        const result = await cursor.toArray()
        res.send(result)
    })

    app.post('/parcels', async (req, res)=> {
        const parcel = req.body
        const result = await parcelCollection.insertOne(parcel)
        res.send(result)
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
