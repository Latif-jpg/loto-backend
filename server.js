// loto-backend/server.js

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config'; 
import axios from 'axios'; 
import twilio from 'twilio'; 
import url from 'url';

// --- CONFIGURATION INITIALE & CLÉS ---

const app = express();

// --- CONFIGURATION DU BODY PARSER ET CORS ---
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000; 
const BASE_URL = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`; 
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://loto-frontend.onrender.com';

// --- CONFIGURATION PAYDUNYA (Vos clés sont dans .env) ---
const PAYDUNYA_MASTER_KEY = process.env.PAYDUNYA_MASTER_KEY; 
const PAYDUNYA_PRIVATE_KEY = process.env.PAYDUNYA_PRIVATE_KEY; 
const PAYDUNYA_TOKEN = process.env.PAYDUNYA_TOKEN; 
const PAYDUNYA_PUBLIC_KEY = process.env.PAYDUNYA_PUBLIC_KEY; 

const PAYDUNYA_API_URL = `https://app.paydunya.com/sandbox-api/v1/checkout-invoice/create`;
const PAYDUNYA_VERIFY_URL = `https://app.paydunya.com/sandbox-api/v1/checkout-invoice/confirm/`;

// --- CONFIGURATION TWILIO (Vos clés sont dans .env) ---
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_TEST_TEMPLATE_SID = process.env.TWILIO_TEMPLATE_SID || 'HX350d429d32e64a552466cafecbe95f3c'; 
const TWILIO_WHATSAPP_NUMBER = TWILIO_ACCOUNT_SID ? 'whatsapp:' + process.env.TWILIO_WHATSAPP_NUMBER : null; 
const twilioClient = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;


// 🌐 CONFIGURATION CORS 
const allowedOrigins = [
    'http://localhost:5173', 
    'http://localhost:4000', 
    FRONTEND_URL 
];

const corsOptions = {
    origin: function (origin, callback) {
        // Ajout d'une vérification pour les requêtes sans 'origin' (ex: Postman, Webhooks)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.error(`CORS: Origin ${origin} non autorisé.`);
            callback(new Error('Non autorisé par CORS'), false); 
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
    optionsSuccessStatus: 204,
    // Correction de PAYDUNYA-TOKEN dans la liste des headers autorisés
    allowedHeaders: ['Content-Type', 'Authorization', 'PAYDUNYA-MASTER-KEY', 'PAYDUNYA-PRIVATE-KEY', 'PAYDUNYA-TOKEN'] 
};

app.use(cors(corsOptions)); 


// ⚡ Config Supabase - SÉCURITÉ CRITIQUE
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

if (!supabaseUrl || !supabaseKey) {
    console.error("ERREUR CRITIQUE: Clés Supabase manquantes.");
    process.exit(1); 
}

const supabase = createClient(supabaseUrl, supabaseKey);


// --- FONCTIONS UTILITAIRES ---

/**
 * Crée une clé unique et normalisée à partir des informations principales.
 */
const createUniqueKey = (nom, prenom, telephone, reference_cnib) => {
    const normalize = (str) => {
        const safeStr = String(str || '').trim(); 
        if (safeStr === 'null' || safeStr === 'undefined') return '';
        
        return safeStr
               .toLowerCase()
               .replace(/\s/g, '') 
               .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    };

    const key = 
        normalize(nom) + 
        '|' + 
        normalize(prenom) + 
        '|' + 
        normalize(telephone) + 
        '|' + 
        normalize(reference_cnib);

    return key;
};

// Logique pour obtenir le code suivant (ex: A000 -> A001)
const getNextCode = (currentCode) => {
    let letter = currentCode.charAt(0);
    let number = parseInt(currentCode.substring(1), 10);

    number++;

    if (number > 999) {
        number = 0; 
        if (letter === 'Z') {
            console.warn("ATTENTION: La limite de tickets (Z999) est atteinte ! Le compteur redémarre à A000.");
            letter = 'A'; 
        } else {
            letter = String.fromCharCode(letter.charCodeAt(0) + 1);
        }
    }

    const paddedNumber = String(number).padStart(3, '0');
    
    return `${letter}${paddedNumber}`;
};

// Fonction asynchrone pour générer un code en toute sécurité via la DB
async function generateAndStoreTicketCode() {
    let newCode;
    let oldCode;

    // 1. Lire le dernier code utilisé
    const { data: configData, error: configError } = await supabase
        .from('configuration')
        .select('value')
        .eq('key', 'last_ticket_code')
        .maybeSingle(); 
    
    if (configError && configError.code !== 'PGRST116') { 
        console.error("Erreur de lecture du compteur de tickets:", configError);
        return null; 
    }
    
    oldCode = configData ? configData.value : 'A000'; 

    // 2. Calculer le nouveau code
    newCode = getNextCode(oldCode);

    // 3. Mettre à jour dans la DB (upsert)
    const { error: updateError } = await supabase
        .from('configuration')
        .upsert([{ key: 'last_ticket_code', value: newCode }], { onConflict: 'key' }); 
        
    if (updateError) {
        console.error("Erreur critique lors de la mise à jour du compteur de tickets:", updateError);
        return null; 
    }

    return newCode;
}


// Fonction d'envoi des tickets par WhatsApp
async function sendWhatsAppTicket(recipientNumber, ticketList, paymentToken) {
    if (!twilioClient || !TWILIO_WHATSAPP_NUMBER || !TWILIO_TEST_TEMPLATE_SID) {
        console.error("Erreur Twilio: Client/Numéro/SID de Template manquant.");
        return;
    }

    const whatsappRecipient = 'whatsapp:+226' + recipientNumber.replace(/\s/g, ''); 
    
    const tickets = ticketList.join(', ');
    const frontendUrl = `${FRONTEND_URL}/status/${paymentToken}`;

    try {
        await twilioClient.messages.create({
            from: TWILIO_WHATSAPP_NUMBER, 
            to: whatsappRecipient, 
            contentSid: TWILIO_TEST_TEMPLATE_SID,
            contentVariables: JSON.stringify({
                "1": `la confirmation de vos tickets: ${tickets}`,
                "2": `Consultez votre reçu: ${frontendUrl}`    
            })
        });
        console.log(`WhatsApp template envoyé avec succès au numéro: ${recipientNumber}`);
    } catch (error) {
        console.error(`Erreur d'envoi WhatsApp à ${recipientNumber}:`, error.message);
    }
}


// --- ROUTES API ---

app.get("/", (req, res) => res.send("Backend LotoEmploi fonctionne ! Version finale (Stabilité du flux assurée)."));

// 0. Route d'Inscription Utilisateur (Table: utilisateurs) - FIND OR CREATE
app.post("/api/register-user", async (req, res) => {
    // Déstructuration: Renomme 'reference_cni' (envoyé par le frontend) en 'reference_cnib' (nom de la colonne DB)
    const { nom, prenom, telephone, reference_cni: reference_cnib, email } = req.body; 

    // 0. Vérification des données critiques
    if (!nom || !prenom || !telephone || !reference_cnib)
        return res.status(400).json({ error: "Les champs Nom, Prénom, Téléphone et Référence CNI sont obligatoires." });
        
    // 1. Création de la clé unique normalisée
    const uniqueKey = createUniqueKey(nom, prenom, telephone, reference_cnib);

    try {
        // 2. Chercher un utilisateur existant
        let { data: existingUsers, error: searchError } = await supabase
            .from("utilisateurs")
            .select("id")
            .eq("unique_key", uniqueKey); 

        if (searchError) { 
            console.error("Erreur Supabase Recherche:", searchError.message);
            return res.status(500).json({ error: "Erreur lors de la recherche de l'utilisateur existant." });
        }

        if (existingUsers && existingUsers.length > 0) {
            // 3. Utilisateur trouvé.
            const existingUser = existingUsers[0];
            return res.json({ success: true, user: existingUser }); 
        }

        // 4. Utilisateur non trouvé, on insère un nouveau
        const { data, error: insertError } = await supabase
            .from("utilisateurs")
            .insert([{ 
                nom, 
                prenom, 
                telephone, 
                reference_cnib, // Nom de la colonne DB
                email,
                unique_key: uniqueKey 
            }])
            .select("id, nom, prenom, telephone, reference_cnib")
            .single(); 

        if (insertError) {
            console.error("Erreur Supabase Inscription:", insertError.message);
            return res.status(500).json({ 
                error: "Erreur lors de l'inscription.", 
                details: insertError.message
            });
        }
        
        // 5. Retourner le nouvel utilisateur inséré
        res.json({ success: true, user: data });
    } catch (error) {
        console.error("Erreur imprévue lors de l'enregistrement:", error);
        return res.status(500).json({
            error: "Erreur serveur inattendue durant l'inscription.",
            details: error.message || String(error)
        });
    }
});


// 1. Route d'Initialisation de Paiement (Passage à PayDunya)
app.post("/api/payments", async (req, res) => {
    const { userId, amount, provider, numTickets } = req.body; 
    
    // --- ÉTAPE 1 : RÉCUPÉRER LES INFOS CLIENT DE SUPABASE ---
    const { data: userData, error: userError } = await supabase
        .from("utilisateurs")
        .select("telephone, email, nom, prenom") 
        .eq("id", userId)
        .maybeSingle();
        
    if (userError || !userData) {
        console.error("Erreur Supabase: Utilisateur non trouvé pour le paiement:", userError?.message);
        return res.status(404).json({ error: "Informations utilisateur requises non trouvées." });
    }

    const customerPhone = userData.telephone;
    const customerEmail = userData.email || "noreply@lotoemploi.com"; 
    const customerName = `${userData.prenom} ${userData.nom}`;
    
    if (!userId || !amount || !numTickets || !PAYDUNYA_MASTER_KEY || !PAYDUNYA_PRIVATE_KEY || !PAYDUNYA_TOKEN || !PAYDUNYA_PUBLIC_KEY) 
        return res.status(500).json({ error: "Erreur de communication avec le service de paiement: Clés PayDunya non définies." });

    const paymentToken = `${Date.now()}-${userId}`;

    // Les URLs de retour et de callback utilisent la BASE_URL dynamique
    const RETURN_URL = `${BASE_URL}/api/payment-return/${paymentToken}`; 
    const CALLBACK_URL = `${BASE_URL}/api/confirm-payment`; 

    try {
        // ÉTAPE 2 : APPEL À L'API PAYDUNYA POUR CRÉER LA FACTURE
        const payDuniaResponse = await axios.post(
            PAYDUNYA_API_URL, 
            {
                "invoice": {
                    "total_amount": amount, 
                    "description": `${numTickets} Tickets Loto Emploi`,
                    "items": [
                        {
                            "name": `${numTickets} Tickets Loto Emploi`,
                            "quantity": 1, 
                            "unit_price": amount,
                            "total_price": amount,
                            "description": "Achat de tickets de tombola pour l'emploi"
                        }
                    ],
                    "customer": {
                        "name": customerName, 
                        "email": customerEmail,
                        "phone": customerPhone 
                    },
                    "actions": {
                        "cancel_url": RETURN_URL,
                        "return_url": RETURN_URL, 
                        "callback_url": CALLBACK_URL 
                    }
                },
                "store": { 
                    "name": "Loto Emploi Test" 
                },
                "public_key": PAYDUNYA_PUBLIC_KEY,
                "custom_data": { 
                    "payment_token": paymentToken, 
                    "user_id": userId 
                }
            },
            {
                headers: {
                    'PAYDUNYA-MASTER-KEY': PAYDUNYA_MASTER_KEY, 
                    'PAYDUNYA-PRIVATE-KEY': PAYDUNYA_PRIVATE_KEY, 
                    'PAYDUNYA-TOKEN': PAYDUNYA_TOKEN, 
                    'Content-Type': 'application/json'
                }
            }
        );

        const responseData = payDuniaResponse.data;

        if (responseData.response_code !== '00') {
             console.error("Erreur PayDunya:", responseData);
             throw new Error(`PayDunia Rejet (${responseData.response_text || responseData.message || 'Erreur inconnue'})`);
        }

        const checkoutUrl = responseData.response_text; 

        // ÉTAPE 3 : ENREGISTREMENT DANS SUPABASE
        const { error: insertError } = await supabase
            .from("payments") 
            .insert([{ 
                user_id: userId, 
                status: "pending",
                totalamount: amount, 
                platform: provider, 
                numtickets: numTickets, 
                payment_token: paymentToken,
                invoice_token: responseData.token 
            }]);

        if (insertError) {
            console.error("Erreur Supabase à l'insertion (Critique):", insertError.message); 
        }

        // ÉTAPE 4 : RENVOI DE L'URL ET DU TOKEN AU FRONTEND (CORRIGÉ !)
        res.json({ 
            success: true, 
            checkoutPageUrlWithPaymentToken: checkoutUrl,
            paymentToken: paymentToken // 🎯 Correction: Ajout du token
        });

    } catch (apiError) {
        console.error("Erreur API PayDunya (Requête POST échouée):", apiError.response ? apiError.response.data : apiError.message);
        
        let errorMessage = "Échec de l'initialisation du paiement PayDunya.";
        if (apiError.response && apiError.response.data && apiError.response.data.response_text) {
             errorMessage += ` Détails: ${apiError.response.data.response_text}`;
        } else if (apiError.message) {
             errorMessage += ` Détails techniques: ${apiError.message}`;
        }
        
        return res.status(500).json({ error: errorMessage });
    }
});


// 2. Route de Vérification de Statut (Consultée par le Frontend)
// 🟢 CORRECTION APPLIQUÉE : Simplification du chemin pour éviter le 404
app.get("/api/status/:token", async (req, res) => {
    const { token } = req.params;
    
    try {
        const { data: txData, error: txError } = await supabase
            .from("payments")
            .select(`
                status, 
                tickets, 
                numtickets, 
                totalamount, 
                user_id,
                utilisateurs ( nom, prenom, telephone, reference_cnib )
            `) 
            .eq("payment_token", token)
            .maybeSingle();

        if (txError || !txData) {
            // Le 404 est maintenant renvoyé si la transaction n'existe pas, et non par Express
            return res.status(404).json({ status: "error", message: "Transaction introuvable ou erreur DB." });
        }
        
        // Récupération des infos utilisateur imbriquées
        const clientInfo = txData.utilisateurs || null; 

        res.json({
            status: txData.status,
            tickets: txData.tickets,
            nbTickets: txData.numtickets,
            amount: txData.totalamount,
            client: clientInfo // Ajout des infos client à la réponse
        });
    } catch (error) {
        console.error("Erreur de récupération du statut de paiement:", error.message);
        res.status(500).json({ status: "error", message: "Erreur serveur lors de la récupération du statut." });
    }
});


// 3. Webhook PayDunya (IPN) - Pour la mise à jour asynchrone ET l'envoi WhatsApp
app.post("/api/confirm-payment", async (req, res) => {
    const payDuniaIPN = req.body || {}; 
    
    const invoiceToken = (payDuniaIPN.data && payDuniaIPN.data.invoice && payDuniaIPN.data.invoice.token) 
                         || payDuniaIPN.invoice_token; 
    
    if (!invoiceToken) {
        console.error("Webhook Erreur: Invoice Token manquant.", payDuniaIPN);
        return res.status(200).send("Invoice Token manquant."); 
    }

    // 1. Chercher la transaction correspondante dans Supabase
    const { data: txData, error: txError } = await supabase
        .from("payments")
        .select("id, status, numtickets, user_id, payment_token") 
        .eq("invoice_token", invoiceToken) 
        .maybeSingle();
    
    if (txError || !txData) {
        console.error("Webhook Erreur: Transaction non trouvée avec l'Invoice Token.", invoiceToken);
        return res.status(200).send("Transaction DB non trouvée.");
    }
    
    // 2. VÉRIFICATION DU STATUT DE LA TRANSACTION VIA L'API DE VÉRIFICATION PAYDUNYA
    try {
        const verificationResponse = await axios.get(
            `${PAYDUNYA_VERIFY_URL}${invoiceToken}`,
            {
                headers: {
                    'PAYDUNYA-MASTER-KEY': PAYDUNYA_MASTER_KEY,
                    'PAYDUNYA-PRIVATE-KEY': PAYDUNYA_PRIVATE_KEY, 
                    'PAYDUNYA-TOKEN': PAYDUNYA_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );

        const verifiedData = verificationResponse.data;
        
        if (verifiedData.status === "completed" && verifiedData.response_code === '00') {
            
            if (txData.status === "pending") {
                let tickets = [];
                for (let i = 0; i < txData.numtickets; i++) { 
                    const ticketCode = await generateAndStoreTicketCode(); 
                    if (ticketCode) {
                        tickets.push(ticketCode);
                    } else {
                        console.error("CRITIQUE: Échec de la génération du code de ticket séquentiel.");
                    }
                }
                
                // Mettre à jour le statut et les tickets
                const { error: updateError } = await supabase.from("payments").update({ 
                    status: "paid", 
                    tickets: tickets 
                }).eq("id", txData.id);

                if (updateError) {
                    console.error("Erreur Supabase lors de la mise à jour du statut:", updateError.message);
                } else {
                    console.log(`Webhook Succès: Paiement ID ${txData.id} mis à jour à 'paid'.`);
                    
                    // ENVOI WHATSAPP 
                    const { data: userData } = await supabase
                        .from("utilisateurs")
                        .select("telephone")
                        .eq("id", txData.user_id)
                        .maybeSingle();
                        
                    if (userData?.telephone) {
                        sendWhatsAppTicket(userData.telephone, tickets, txData.payment_token);
                    } else {
                        console.warn("Impossible d'envoyer le WhatsApp: Données utilisateur manquantes.");
                    }
                }
            }
        } else {
             console.log(`Webhook Info: Paiement ID ${txData.id} a un statut vérifié: ${verifiedData.status}`);
        }
    } catch (error) {
           console.error("Erreur Webhook lors de la vérification de statut PayDunia:", error.message);
    }
    
    res.status(200).send("Webhook PayDunya reçu et traité.");
});


// 4. Route de Redirection Sécurisée (RETURN_URL PayDunya)
app.get("/api/payment-return/:token", async (req, res) => {
    const { token } = req.params; 
    
    const { data: txData, error: txError } = await supabase
        .from("payments")
        .select("status") 
        .eq("payment_token", token)
        .maybeSingle();
        
    if (txError || !txData) {
        console.error(`Erreur Redirection : Transaction introuvable pour le token ${token}`);
        return res.redirect(302, `${FRONTEND_URL}/status/error?msg=TX_NOT_FOUND`);
    }

    // 🟢 IMPORTANT : La redirection utilise désormais le chemin simplifié du Frontend pour correspondre à l'appel API
    const finalFrontendUrl = `${FRONTEND_URL}/status/${token}`;

    console.log(`✅ Redirection vers la page de tickets pour le token: ${token}. Statut: ${txData.status}`);
    
    return res.redirect(302, finalFrontendUrl); 
});


// --- DÉMARRAGE DU SERVEUR ---

app.listen(PORT, () => console.log(`🚀 Serveur démarré sur le port ${PORT}. BASE_URL: ${BASE_URL}`));
