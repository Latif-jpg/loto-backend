// loto-backend/server.js
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios"; // <-- garder cette ligne de HEAD ou distant

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ✅ Test route
app.get("/", (req, res) => {
  res.send("✅ Backend Lotoemploi fonctionne !");
});

// 🔹 Créer un paiement (Frontend → Backend → Yengapay)
app.post("/api/create-payment", async (req, res) => {
  const { userId, totalAmount, platform } = req.body;

  if (!userId || !totalAmount || !platform) {
    return res.status(400).json({ error: "Paramètres manquants" });
  }

  try {
    // Appel à l'API Yengapay pour créer un paiement
    const response = await axios.post(
      "https://api.yengapay.com/payment",
      {
        user_id: userId,
        amount: totalAmount,
        paymentSource: platform,
      },
      {
        headers: { Authorization: `Bearer ${process.env.YENGAPAY_API_KEY}` },
      }
    );

    const checkoutUrl = response.data.checkoutPageUrlWithPaymentToken;

    res.json({ checkoutPageUrlWithPaymentToken: checkoutUrl });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Erreur création paiement" });
  }
});

// 🔹 Webhook Yengapay
app.post("/api/webhook-yengapay", async (req, res) => {
  const { user_id, amount, status, payment_id } = req.body;

  if (status !== "paid") {
    return res.status(400).json({ error: "Paiement non confirmé" });
  }

  try {
    const TICKET_PRICE = 2000;
    const ticketCount = Math.floor(amount / TICKET_PRICE);

    const tickets = [];
    for (let i = 0; i < ticketCount; i++) {
      tickets.push(
        "TICKET-" + Math.random().toString(36).substring(2, 10).toUpperCase()
      );
    }

    await axios.post(
      "https://api.yengapay.com/sms",
      {
        user_id,
        message: `Vos tickets : ${tickets.join(", ")} pour un montant de ${amount} FCFA`,
      },
      { headers: { Authorization: `Bearer ${process.env.YENGAPAY_API_KEY}` } }
    );

    res.json({ success: true, tickets });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Erreur génération tickets" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
