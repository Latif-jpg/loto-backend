import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json()); // pour parser le JSON

// ✅ Inscription utilisateur
app.post("/api/register-user", (req, res) => {
  const { nom, prenom, telephone, reference_cni, email } = req.body;

  if (!nom || !prenom || !telephone || !reference_cni || !email) {
    return res.status(400).json({ error: "Tous les champs sont obligatoires." });
  }

  // Ici tu peux enregistrer dans Supabase ou une base locale
  console.log("Nouvel utilisateur :", req.body);

  res.json({
    success: true,
    message: "Inscription réussie",
    user: { nom, prenom, telephone, reference_cni, email },
  });
});

// ✅ Paiement
app.post("/api/payments", (req, res) => {
  const { userId, amount, provider, numTickets } = req.body;

  if (!userId || !amount || !provider || !numTickets) {
    return res.status(400).json({ error: "Informations de paiement manquantes." });
  }

  console.log("Paiement reçu :", req.body);

  // Simuler un lien de checkout Yengapay
  const checkoutPageUrlWithPaymentToken = `https://yengapay.com/checkout?token=${Date.now()}-${userId}`;

  res.json({
    success: true,
    checkoutPageUrlWithPaymentToken,
  });
});

// ✅ Route par défaut
app.get("/", (req, res) => {
  res.send("✅ Backend Lotoemploi fonctionne !");
});

// Lancer le serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});
