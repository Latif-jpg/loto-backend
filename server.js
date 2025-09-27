import express from "express";
import cors from "cors";
import fetch from "node-fetch"; // pour appels Yengapay
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// ⚡ Config Supabase
const supabaseUrl = "https://YOUR_SUPABASE_URL";
const supabaseKey = "YOUR_SUPABASE_ANON_KEY";
const supabase = createClient(supabaseUrl, supabaseKey);

// ✅ Inscription utilisateur
app.post("/api/register-user", async (req, res) => {
  const { nom, prenom, telephone, reference_cni, email } = req.body;
  if (!nom || !prenom || !telephone || !reference_cni || !email)
    return res.status(400).json({ error: "Tous les champs sont obligatoires." });

  // Insertion Supabase
  const { data, error } = await supabase
    .from("utilisateurs")
    .insert([{ nom, prenom, telephone, reference_cni, email }])
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, user: data[0] });
});

// ✅ Paiement
app.post("/api/payments", async (req, res) => {
  const { userId, amount, provider, numTickets } = req.body;
  if (!userId || !amount || !provider || !numTickets)
    return res.status(400).json({ error: "Informations de paiement manquantes." });

  // Générer URL sandbox Yengapay
  const checkoutPageUrlWithPaymentToken = `https://sandbox.yengapay.com/checkout?token=${Date.now()}-${userId}`;
  
  // Sauvegarde transaction initiale dans Supabase
  const { data, error } = await supabase
    .from("transactions")
    .insert([{ user_id: userId, amount, provider, num_tickets: numTickets, status: "pending" }])
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true, checkoutPageUrlWithPaymentToken });
});

// ✅ Webhook Yengapay pour confirmation
app.post("/api/confirm-payment", async (req, res) => {
  const { token, status } = req.body; // Yengapay envoie token + statut
  if (!token || !status) return res.status(400).json({ error: "Données manquantes." });

  // Chercher transaction
  const { data: txData, error: txError } = await supabase
    .from("transactions")
    .select("*")
    .eq("payment_token", token)
    .single();

  if (txError) return res.status(500).json({ error: txError.message });

  // Générer codes tickets si payé
  let tickets = [];
  if (status === "paid") {
    for (let i = 0; i < txData.num_tickets; i++) {
      tickets.push(`TICKET-${Math.random().toString(36).substr(2, 9).toUpperCase()}`);
    }

    await supabase
      .from("transactions")
      .update({ status: "paid", tickets })
      .eq("id", txData.id);
  }

  res.json({ success: true, tickets });
});

// ✅ Route test
app.get("/", (req, res) => res.send("Backend Lotoemploi fonctionne !"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`));
