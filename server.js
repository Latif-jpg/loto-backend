// ✅ Inscription utilisateur avec gestion des doublons
app.post("/api/register-user", async (req, res) => {
  const { nom, prenom, telephone, reference_cni, email } = req.body;

  if (!nom || !prenom || !telephone || !reference_cni || !email) {
    return res.status(400).json({ error: "Tous les champs sont obligatoires." });
  }

  try {
    // Vérifier si l'utilisateur existe déjà
    const { data: existingUser, error: selectError } = await supabase
      .from("utilisateurs")
      .select("*")
      .eq("telephone", telephone)
      .single();

    if (selectError && selectError.code !== "PGRST116") throw selectError;

    if (existingUser) {
      // L'utilisateur existe déjà : on renvoie ses infos
      return res.json({
        success: true,
        message: "Utilisateur déjà inscrit, récupération réussie",
        user: existingUser,
      });
    }

    // Créer un nouvel utilisateur
    const { data: newUser, error: insertError } = await supabase
      .from("utilisateurs")
      .insert([{ nom, prenom, telephone, reference_cni, email }])
      .select()
      .single();

    if (insertError) throw insertError;

    res.json({
      success: true,
      message: "Inscription réussie",
      user: newUser,
    });
  } catch (err) {
    console.error("Erreur inscription :", err);
    res.status(500).json({ error: "Impossible de traiter l'inscription." });
  }
});
