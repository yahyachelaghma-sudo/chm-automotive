/* ═══════════════════════════════════════════════════════════════
   LE SITE : catalogue, fiches des voitures, réservation
   ═══════════════════════════════════════════════════════════════ */
const $ = (selecteur) => document.querySelector(selecteur);
const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

const TAILLE_PAGE = 12;

const grille = $("#grille");
const recherche = $("#recherche");
const infoDates = $("#info-dates");
const modale = $("#modale");
const form = $("#formulaire");
const message = $("#message");

let agence = {};
let voitures = [];
let occupees = [];
let categorie = "Toutes";
let dates = { debut: "", fin: "" };
let lieuChoisi = "";
let voitureChoisie = null;
let visibles = TAILLE_PAGE;
let derniereReservation = null;
let prochaines = {};            // pour chaque véhicule occupé sur les dates cherchées : première date où il est libre
let dispo = { etat: "inconnu" }; // disponibilité du véhicule dans la fenêtre de réservation
let minuteurDispo = null;
let numeroVerification = 0;

const aujourdhui = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// Les dates passées (naissance, obtention du permis) ne peuvent pas être dans le futur, les autres pas dans le passé
$$('input[type="date"]').forEach((input) => (input.hasAttribute("data-passe") ? (input.max = aujourdhui) : (input.min = aujourdhui)));

// ---------- Utilitaires ----------
// Protège l'affichage contre le HTML tapé dans les champs
const REMPLACEMENTS = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const echapper = (texte) => String(texte ?? "").replace(/[&<>"']/g, (c) => REMPLACEMENTS[c]);

const da = (montant) => `${Math.round(montant).toLocaleString("fr-FR")} DA`;
const nombreDeJours = (debut, fin) => Math.round((new Date(fin) - new Date(debut)) / 86400000);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const dateFr = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const nomVoiture = (v) => `${v.marque} ${v.modele}`;
// Photo du véhicule, ou le logo si aucune photo n'a encore été ajoutée
const urlPhoto = (v) => (v.photo ? `../images/voitures/${encodeURIComponent(v.photo)}${v.photo_v ? `?v=${v.photo_v}` : ""}` : "logo.jpg");
const kmInclus = () => agence.tarifs_supplementaires?.km_inclus_par_jour ?? 300;
// Minuscules sans accents, pour les recherches
const normaliser = (texte) => String(texte ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Une location dure au moins un jour (départ et retour le même jour = 1 jour)
const joursLocation = (debut, fin) => Math.max(1, nombreDeJours(debut, fin));
const telephoneValide = (tel) => /^(\+213|00213|0)[2-7]\d{7,8}$/.test(tel.replace(/[\s.-]/g, ""));

function remisePour(jours) {
  return (agence.remises ?? []).filter((r) => jours >= r.jours_min).reduce((max, r) => Math.max(max, r.pourcentage), 0);
}

// Même calcul que le serveur (le serveur recalcule toujours le prix final)
function devis(voiture, jours, idsOptions) {
  const location = jours * voiture.prix_par_jour;
  const remise = remisePour(jours);
  const montantRemise = Math.round((location * remise) / 100);
  const options = agence.options
    .filter((o) => idsOptions.includes(o.id))
    .map((o) => ({ nom: o.nom, montant: o.par === "jour" ? o.prix * jours : o.prix }));
  const total = location - montantRemise + options.reduce((s, o) => s + o.montant, 0);
  return { location, remise, montantRemise, options, total };
}

const lienWhatsApp = (texte) => `https://wa.me/${agence.whatsapp}?text=${encodeURIComponent(texte)}`;
function messageVehicule(v) {
  const periode = dates.debut && dates.fin ? ` du ${dateFr(dates.debut)} au ${dateFr(dates.fin)}` : "";
  return `Bonjour ${agence.nom}, je souhaite louer la ${nomVoiture(v)}${periode}. Est-elle disponible ?`;
}

function fermerModales() {
  $$(".modale").forEach((m) => (m.hidden = true));
  document.body.style.overflow = "";
}

function ouvrirModale(m) {
  fermerModales();
  m.hidden = false;
  document.body.style.overflow = "hidden";
  m.querySelector(".modale-contenu").scrollTop = 0;
}

// ---------- Contenu de l'agence ----------
function afficherAgence() {
  $$("[data-agence]").forEach((el) => (el.textContent = agence[el.dataset.agence] ?? ""));
  $$("[data-tel]").forEach((el) => (el.href = `tel:${agence.telephone.replace(/\s/g, "")}`));
  $$("[data-whatsapp]").forEach((el) => (el.href = lienWhatsApp(`Bonjour ${agence.nom}, je souhaite louer une voiture.`)));
  $$("[data-lieux]").forEach((select) => {
    select.innerHTML = agence.lieux.map((l) => `<option>${echapper(l)}</option>`).join("");
  });
  lieuChoisi = agence.lieux[0];

  $("#horaire-court").textContent = agence.horaires[0] ?? "";
  $("#horaires").innerHTML = agence.horaires.map((h) => `<p>${echapper(h)}</p>`).join("");
  $("#reseaux").innerHTML = Object.entries(agence.reseaux)
    .map(([nom, lien]) => `<a href="${echapper(lien)}" target="_blank" rel="noopener">${nom[0].toUpperCase() + nom.slice(1)}</a>`)
    .join("");
  $("#carte").src = `https://www.google.com/maps?q=${encodeURIComponent(agence.adresse)}&output=embed`;
  $("#annee").textContent = new Date().getFullYear();

  $("#liste-services").innerHTML = agence.options
    .map((o) => `<div class="service"><h3>${echapper(o.nom)}</h3><p>${echapper(o.description)}</p><strong>${da(o.prix)} / ${o.par}</strong></div>`)
    .join("");
  $("#liste-conditions").innerHTML = agence.conditions
    .map((c) => `<div class="condition"><h3>${echapper(c.titre)}</h3><p>${echapper(c.texte)}</p></div>`)
    .join("");
  $("#liste-documents").innerHTML = (agence.documents_contrat ?? []).map((d) => `<span>${echapper(d)}</span>`).join("");
  $("#liste-faq").innerHTML = agence.faq.map((f) => `<details><summary>${echapper(f.q)}</summary><p>${echapper(f.r)}</p></details>`).join("");
  $("#options").innerHTML = agence.options
    .map((o) => `
      <label class="option">
        <input type="checkbox" value="${o.id}">
        <span><strong>${echapper(o.nom)}</strong><small>+ ${da(o.prix)} / ${o.par}</small></span>
      </label>`)
    .join("");

  // Points forts : tout vient des réglages de l'agence
  $("#hero-points").innerHTML = [`${kmInclus()} km par jour inclus`, "Assistance 24h/24", "Livraison aéroport", "Prix en dinars, sans frais cachés"]
    .map((p) => `<li>${echapper(p)}</li>`)
    .join("");
  $("#confiance").innerHTML = [
    ["🛣️", `${kmInclus()} km par jour inclus`, "Roulez sans compter"],
    ["🛟", "Assistance 24h/24", "En cas de panne ou d'accident"],
    ["✈️", "Livraison aéroport", "Ou à l'adresse de votre choix"],
    ["💳", "Paiement facile", "Visa, CIB, Edahabia, BaridiMob, CCP ou espèces"],
  ].map(([icone, titre, texte]) => `<div><span class="icone">${icone}</span><div><strong>${echapper(titre)}</strong><span>${echapper(texte)}</span></div></div>`).join("");

  const remises = [...(agence.remises ?? [])].sort((a, b) => a.jours_min - b.jours_min);
  if (remises.length) {
    $("#offre").hidden = false;
    $("#offre").innerHTML = `
      <div class="offre-textes">
        ${remises.map((r) => `<div><strong>-${r.pourcentage}%</strong><p>dès ${r.jours_min} jours de location</p></div>`).join("")}
      </div>
      <a class="btn" href="#vehicules">Calculer mon prix</a>`;
  }

  $("#aide-age").textContent = agence.age_minimum ?? 23;
  $("#aide-permis").textContent = agence.permis_annees_minimum ?? 2;
  $("#texte-confidentialite").textContent = agence.texte_confidentialite ?? "";

  afficherPaiements();
  afficherAvis();
  afficherAvantages();
}

// ---------- Paiement : cartes, BaridiMob, CCP, virement, chèque, espèces (aucun numéro de carte n'est saisi sur le site) ----------
const MODES_PAR_DEFAUT = [
  { id: "Visa", nom: "Carte Visa", icone: "💳", type: "carte" },
  { id: "Mastercard", nom: "Carte Mastercard", icone: "💳", type: "carte" },
  { id: "CIB", nom: "Carte CIB", icone: "💳", type: "carte" },
  { id: "Edahabia", nom: "Carte Edahabia", icone: "💳", type: "carte" },
  { id: "Espèces", nom: "Espèces", icone: "💵", type: "especes" },
];
const modesPaiement = () => agence.paiement_modes?.length ? agence.paiement_modes : MODES_PAR_DEFAUT;
const modeChoisi = () => modesPaiement().find((m) => m.id === form.elements.paiement_mode?.value) ?? modesPaiement()[0];
const paiementEnLigne = () => Boolean(String(agence.paiement_en_ligne_lien ?? "").trim());
const coordonneesPaiement = (mode) => String(agence.paiement_coordonnees?.[mode.id] ?? "").trim();
// Payer « maintenant » : lien sécurisé pour les cartes, coordonnées de l'agence pour BaridiMob / CCP / virement
const paiementMaintenant = (mode) => (mode.type === "carte" ? paiementEnLigne() : mode.type === "virement" && Boolean(coordonneesPaiement(mode)));
const lieuSurPlace = () => agence.paiement_sur_place || "À l'agence ou à la remise des clés";

function afficherPaiements() {
  $("#paiement-modes").innerHTML = modesPaiement().map((m, i) => `
    <label class="option"><input type="radio" name="paiement_mode" value="${echapper(m.id)}" ${i === 0 ? "checked" : ""}><span><strong>${m.icone ?? "💳"} ${echapper(m.nom)}</strong></span></label>`).join("");
  majLieuxPaiement();
}

function majLieuxPaiement() {
  const mode = modeChoisi();
  const livraisonAide = { carte: "Par carte (terminal de paiement) ou en espèces au moment de la remise", virement: "Montrez le reçu de votre virement au moment de la remise", cheque: "Chèque de banque remis avec les clés", especes: "En espèces au moment de la remise" }[mode.type];
  const lieux = [
    ...(paiementMaintenant(mode) ? [["en ligne", mode.type === "carte" ? "🌐 En ligne maintenant" : "📲 Maintenant, depuis mon téléphone ou ma banque", mode.type === "carte" ? "Paiement sécurisé par carte, juste après la réservation" : "Vous recevez les coordonnées de l'agence juste après la réservation"]] : []),
    ["agence", "🏢 À l'agence", lieuSurPlace()],
    ["livraison", "🚗 À la livraison du véhicule", livraisonAide],
  ];
  const actuel = form.elements.paiement_lieu?.value;
  const choisi = lieux.some(([id]) => id === actuel) ? actuel : lieux[0][0];
  $("#paiement-lieux").innerHTML = lieux.map(([id, nom, aide]) => `
    <label class="option"><input type="radio" name="paiement_lieu" value="${id}" ${id === choisi ? "checked" : ""}><span><strong>${nom}</strong><small>${echapper(aide)}</small></span></label>`).join("");
}

// Ce que le client voit après avoir réservé : comment et où il va payer
function afficherSuitePaiement(r) {
  const zone = $("#succes-paiement");
  const p = r.paiement_souhaite;
  if (!p) { zone.hidden = true; return; }
  const mode = modesPaiement().find((m) => m.id === p.mode) ?? { id: p.mode, nom: p.mode, type: "especes" };
  const lieuTexte = p.lieu === "en ligne" ? "maintenant" : p.lieu === "livraison" ? "à la livraison du véhicule" : lieuSurPlace().replace(/^À/, "à");
  let suite = `<p class="aide-paiement">Rien à payer maintenant. La caution est demandée à la remise des clés.</p>`;
  if (p.lieu === "en ligne" && mode.type === "carte" && paiementEnLigne()) {
    suite = `<a class="btn btn-rouge btn-large" href="${echapper(agence.paiement_en_ligne_lien)}" target="_blank" rel="noopener">💳 Payer ${da(r.total)} en ligne</a>
      <p class="aide-paiement">Indiquez votre numéro de réservation <strong>${echapper(r.numero)}</strong> sur la page de paiement. Cette page est sécurisée : l'agence ne voit jamais votre numéro de carte.</p>`;
  } else if (p.lieu === "en ligne" && mode.type === "virement" && coordonneesPaiement(mode)) {
    suite = `<div class="coordonnees"><small>${echapper(mode.nom)}</small><strong>${echapper(coordonneesPaiement(mode))}</strong></div>
      <p class="aide-paiement">Montant : <strong>${da(r.total)}</strong>. Indiquez <strong>${echapper(r.numero)}</strong> en motif du virement, puis envoyez-nous le reçu sur WhatsApp.</p>`;
  } else if (mode.type === "cheque") {
    suite = `<p class="aide-paiement">Chèque de banque de ${da(r.total)} à remettre avec les clés. La caution est demandée à ce moment-là.</p>`;
  }
  zone.hidden = false;
  zone.innerHTML = `<p>${mode.icone ?? "💳"} Paiement choisi : <strong>${echapper(mode.nom)}</strong> — ${echapper(lieuTexte)}.</p>${suite}`;
}

// Les avis n'apparaissent que si tu en ajoutes dans informations/agence.json (champ "avis")
function afficherAvis() {
  const avis = agence.avis ?? [];
  if (!avis.length) return;
  $("#avis").hidden = false;
  $("#liste-avis").innerHTML = avis
    .map((a) => `
      <article class="avis-carte">
        <div class="etoiles" aria-label="${a.note ?? 5} sur 5">${"★".repeat(Math.round(a.note ?? 5))}${"☆".repeat(5 - Math.round(a.note ?? 5))}</div>
        <p>« ${echapper(a.texte)} »</p>
        <strong>${echapper(a.nom)}</strong> ${a.ville ? `<small>· ${echapper(a.ville)}</small>` : ""}
      </article>`)
    .join("");
  if (agence.lien_avis_google) {
    $("#lien-avis").hidden = false;
    $("#lien-avis").href = agence.lien_avis_google;
  }
}

function afficherAvantages() {
  $("#liste-avantages").innerHTML = [
    ["💰", "Prix clairs, en dinars", "Le prix total s'affiche avant de réserver, remises comprises. Pas de frais cachés au comptoir."],
    ["🚗", "Véhicules récents et entretenus", "Une flotte de moins de 3 ans, révisée et nettoyée avant chaque location."],
    ["✈️", "Livraison où vous voulez", "À l'aéroport, à la gare, à votre hôtel ou devant chez vous, 7 jours sur 7."],
    ["🛟", "Assistance 24h/24", "Une panne, un accident, une question ? Un conseiller vous répond à toute heure."],
    ["📁", "Dossier en ligne", "Envoyez vos documents à l'avance : la remise des clés prend quelques minutes."],
    ["🤝", "Annulation gratuite", "Jusqu'à 48 heures avant le départ, sans aucun frais."],
  ].map(([icone, titre, texte]) => `<div class="avantage"><span class="icone">${icone}</span><h3>${titre}</h3><p>${texte}</p></div>`).join("");
}

// Données pour Google (affichage dans les résultats de recherche)
function ajouterDonneesGoogle() {
  const prix = voitures.filter((v) => v.disponible).map((v) => v.prix_par_jour);
  const donnees = [
    {
      "@context": "https://schema.org",
      "@type": "AutoRental",
      name: agence.nom,
      telephone: agence.telephone,
      email: agence.email,
      address: { "@type": "PostalAddress", streetAddress: agence.adresse, addressCountry: "DZ" },
      areaServed: "Algérie",
      priceRange: prix.length ? `${Math.min(...prix)} - ${Math.max(...prix)} DZD` : undefined,
      image: new URL("logo.jpg", location.href).href,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: agence.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.r } })),
    },
  ];
  const balise = document.createElement("script");
  balise.type = "application/ld+json";
  balise.textContent = JSON.stringify(donnees);
  document.head.append(balise);
}

// ---------- Accueil : diaporama des plus belles voitures ----------
function afficherDiaporama() {
  const choix = ["Prestige", "4x4", "SUV"].flatMap((c) => voitures.filter((v) => v.photo && v.categorie === c)).slice(0, 5);
  if (!choix.length) return;
  $("#hero-fond").innerHTML = choix.map((v, i) => `<img class="diapo${i === 0 ? " active" : ""}" src="${urlPhoto(v)}" alt="">`).join("");
  const legende = (v) => ($("#hero-legende").innerHTML = `${echapper(nomVoiture(v))} — dès ${da(v.prix_par_jour)} / jour · <a href="#" data-fiche="${echapper(v.id)}">voir la fiche</a>`);
  let actuelle = 0;
  legende(choix[0]);
  if (choix.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  setInterval(() => {
    const diapos = $$(".diapo");
    diapos[actuelle].classList.remove("active");
    actuelle = (actuelle + 1) % diapos.length;
    diapos[actuelle].classList.add("active");
    legende(choix[actuelle]);
  }, 6000);
}

// ---------- Catégories ----------
const ORDRE_CATEGORIES = ["Citadine", "Berline", "SUV", "7 places", "Électrique", "4x4", "Prestige"];
const enLigne = () => voitures.filter((v) => v.disponible);
function categoriesPresentes() {
  const rang = (c) => (ORDRE_CATEGORIES.includes(c) ? ORDRE_CATEGORIES.indexOf(c) : 99);
  return [...new Set(enLigne().map((v) => v.categorie))].sort((a, b) => rang(a) - rang(b));
}

function afficherTuiles() {
  $("#tuiles").innerHTML = categoriesPresentes()
    .map((c) => {
      const liste = enLigne().filter((v) => v.categorie === c);
      const exemple = liste.find((v) => v.photo) ?? liste[0];
      const min = Math.min(...liste.map((v) => v.prix_par_jour));
      return `
        <button type="button" class="tuile" data-categorie="${echapper(c)}">
          <img src="${urlPhoto(exemple)}" alt="" decoding="async">
          <span class="tuile-texte"><strong>${echapper(c)}</strong><small>${pluriel(liste.length, "véhicule")} · <span class="tuile-prix">dès ${da(min)}/jour</span></small></span>
        </button>`;
    })
    .join("");
}

function afficherPuces() {
  $("#categories").innerHTML = ["Toutes", ...categoriesPresentes()]
    .map((c) => `<button type="button" data-categorie="${echapper(c)}" class="${c === categorie ? "actif" : ""}">${echapper(c)}</button>`)
    .join("");
}

function choisirCategorie(c) {
  categorie = c;
  visibles = TAILLE_PAGE;
  afficherPuces();
  afficherCatalogue();
}

// ---------- Filtres ----------
function preparerFiltres() {
  const ORDRE_GAMMES = ["Économique", "Confort", "Premium", "Luxe", "Utilitaire"];
  const gammes = [...new Set(enLigne().map((v) => v.gamme).filter(Boolean))].sort((a, b) => ORDRE_GAMMES.indexOf(a) - ORDRE_GAMMES.indexOf(b));
  $("#filtre-gamme").innerHTML += gammes.map((g) => `<option>${echapper(g)}</option>`).join("");
  if (gammes.length < 2) $("#filtre-gamme").hidden = true;
  const carburants = [...new Set(enLigne().map((v) => v.carburant))].sort();
  $("#filtre-carburant").innerHTML += carburants.map((c) => `<option>${echapper(c)}</option>`).join("");

  const prix = enLigne().map((v) => v.prix_par_jour);
  const budget = $("#budget");
  budget.min = Math.floor(Math.min(...prix) / 500) * 500;
  budget.max = Math.ceil(Math.max(...prix) / 500) * 500;
  budget.value = budget.max;
  majBudget();
}

function majBudget() {
  const budget = $("#budget");
  $("#budget-valeur").textContent = Number(budget.value) >= Number(budget.max) ? "sans limite" : `${da(budget.value)} / jour`;
}

function voituresFiltrees() {
  const texte = normaliser($("#recherche-texte").value.trim());
  const gamme = $("#filtre-gamme").value;
  const boite = $("#filtre-boite").value;
  const carburant = $("#filtre-carburant").value;
  const places = Number($("#filtre-places").value) || 0;
  const budget = Number($("#budget").value) || Infinity;

  const liste = enLigne().filter(
    (v) =>
      (categorie === "Toutes" || v.categorie === categorie) &&
      (!texte || normaliser(`${v.marque} ${v.modele} ${v.categorie} ${v.gamme ?? ""} ${v.couleur ?? ""} ${v.carburant}`).includes(texte)) &&
      (!gamme || v.gamme === gamme) &&
      (!boite || v.boite === boite) &&
      (!carburant || v.carburant === carburant) &&
      v.places >= places &&
      v.prix_par_jour <= budget,
  );
  const tris = {
    "prix-asc": (a, b) => a.prix_par_jour - b.prix_par_jour,
    "prix-desc": (a, b) => b.prix_par_jour - a.prix_par_jour,
    "annee-desc": (a, b) => b.annee - a.annee || a.prix_par_jour - b.prix_par_jour,
  };
  liste.sort(tris[$("#tri").value]);
  // Les véhicules déjà réservés sur les dates choisies passent à la fin
  return liste.sort((a, b) => occupees.includes(a.id) - occupees.includes(b.id));
}

// ---------- Catalogue ----------
const joursChoisis = () => (dates.debut && dates.fin ? joursLocation(dates.debut, dates.fin) : 0);

function caracteristiques(v) {
  return [`⚙️ ${v.boite}`, `⛽ ${v.carburant}`, `👥 ${v.places} places`, v.autonomie_km ? `🔋 ${v.autonomie_km} km` : `🧳 ${v.bagages} valises`]
    .map((c) => `<span>${echapper(c)}</span>`)
    .join("");
}

function messageLibre(v) {
  const jour = prochaines[v.id];
  return jour
    ? `<p class="libre-le">Déjà réservé sur vos dates · libre à partir du <strong>${dateFr(jour)}</strong><button type="button" class="lien" data-decaler="${jour}">Voir ces dates</button></p>`
    : `<p class="libre-le">Indisponible sur vos dates</p>`;
}

function carteHTML(v) {
  const occupee = occupees.includes(v.id);
  const jours = joursChoisis();
  const d = jours ? devis(v, jours, []) : null;
  const recente = v.annee >= new Date().getFullYear() - 2;
  const badgeDroite = d?.remise ? `<span class="badge badge-vert">-${d.remise}%</span>` : recente ? `<span class="badge badge-rouge">Récent</span>` : "";
  return `
    <article class="carte${occupee ? " occupee" : ""}">
      <div class="carte-image" data-fiche="${echapper(v.id)}">
        <img src="${urlPhoto(v)}" alt="${echapper(nomVoiture(v))}" decoding="async">
        <div class="badges"><span class="badge">${echapper(v.categorie)}${v.gamme ? ` · ${echapper(v.gamme)}` : ""}</span>${badgeDroite}</div>
      </div>
      <div class="carte-corps">
        <h3 data-fiche="${echapper(v.id)}">${echapper(nomVoiture(v))}<small>${v.annee} · ou similaire</small></h3>
        <div class="caracteristiques">${caracteristiques(v)}</div>
        ${occupee ? messageLibre(v) : ""}
        <div class="carte-bas">
          <div>
            <p class="prix">${da(v.prix_par_jour)}<small>par jour</small></p>
            ${d ? `<p class="total-carte">Total ${da(d.total)} · ${pluriel(jours, "jour")}</p>` : ""}
          </div>
          <div class="carte-actions">
            <a class="btn btn-whatsapp btn-icone" href="${lienWhatsApp(messageVehicule(v))}" target="_blank" rel="noopener" aria-label="Demander sur WhatsApp">💬</a>
            <button type="button" class="btn btn-rouge" data-reserver="${echapper(v.id)}" ${occupee ? "disabled" : ""}>${occupee ? "Indisponible" : "Réserver"}</button>
          </div>
        </div>
      </div>
    </article>`;
}

function afficherCatalogue() {
  const liste = voituresFiltrees();
  const reservees = liste.filter((v) => occupees.includes(v.id)).length;
  grille.innerHTML = liste.length
    ? liste.slice(0, visibles).map(carteHTML).join("")
    : `<p class="vide">Aucun véhicule ne correspond à votre recherche.<br><button type="button" class="lien" id="tout-voir">Effacer les filtres</button></p>`;
  $("#compteur").innerHTML = `<strong>${pluriel(liste.length, "véhicule")}</strong>${
    reservees ? ` · dont ${reservees} déjà réservé${reservees > 1 ? "s" : ""} sur vos dates` : ""
  }`;
  $("#voir-plus").hidden = liste.length <= visibles;
}

function effacerFiltres() {
  $("#recherche-texte").value = "";
  $("#filtre-boite").value = "";
  $("#filtre-carburant").value = "";
  $("#filtre-places").value = "";
  $("#budget").value = $("#budget").max;
  majBudget();
  choisirCategorie("Toutes");
}

// ---------- Recherche par dates ----------
async function chargerOccupees() {
  prochaines = {};
  if (!dates.debut || !dates.fin) { occupees = []; return; }
  try {
    const r = await fetch(`/api/disponibilites?debut=${dates.debut}&fin=${dates.fin}`);
    if (r.ok) {
      const d = await r.json();
      occupees = d.occupees ?? [];
      prochaines = d.libre_le ?? {};
      return;
    }
  } catch { /* on essaie l'ancienne route */ }
  try {
    const r = await fetch(`/api/occupees?debut=${dates.debut}&fin=${dates.fin}`);
    occupees = r.ok ? await r.json() : [];
  } catch {
    occupees = [];
  }
}

const ajouterJours = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// Relance la recherche sur de nouvelles dates de départ en gardant la même durée
async function decalerDates(nouveauDepart) {
  const duree = Math.max(0, nombreDeJours(dates.debut, dates.fin));
  recherche.elements.debut.value = nouveauDepart;
  recherche.elements.fin.value = ajouterJours(nouveauDepart, duree);
  recherche.requestSubmit();
}

async function rechercher(e) {
  e.preventDefault();
  const { debut, fin, lieu } = recherche.elements;
  if (!debut.value || !fin.value) return;
  if (fin.value < debut.value) {
    infoDates.innerHTML = `<strong>La date de retour doit être après la date de départ.</strong>`;
    $("#vehicules").scrollIntoView();
    return;
  }
  dates = { debut: debut.value, fin: fin.value, heureDebut: recherche.elements.heure_debut.value, heureFin: recherche.elements.heure_fin.value };
  lieuChoisi = lieu.value;
  await chargerOccupees();
  majInfoDates();
  visibles = TAILLE_PAGE;
  afficherCatalogue();
  $("#vehicules").scrollIntoView();
}

function majInfoDates() {
  const jours = joursChoisis();
  if (!jours) return;
  const libres = enLigne().filter((v) => !occupees.includes(v.id)).length;
  const remise = remisePour(jours);
  infoDates.innerHTML = `Du <strong>${dateFr(dates.debut)}</strong> au <strong>${dateFr(dates.fin)}</strong> · ${pluriel(jours, "jour")} · ${echapper(lieuChoisi)}<br>
    <strong>${pluriel(libres, "véhicule")} disponible${libres > 1 ? "s" : ""}</strong>${remise ? ` · remise de <strong>${remise}%</strong> déjà appliquée` : ""}`;
}

// ---------- Fiche d'un véhicule ----------
function bandeauFiche(v) {
  if (!dates.debut || !dates.fin) return `<div class="dispo dispo-info">Choisissez vos dates en haut de la page pour vérifier que ce véhicule est libre.</div>`;
  const periode = `du <strong>${dateFr(dates.debut)}</strong> au <strong>${dateFr(dates.fin)}</strong>`;
  if (!occupees.includes(v.id)) return `<div class="dispo dispo-oui">✅ Disponible ${periode}.</div>`;
  const jour = prochaines[v.id];
  return `<div class="dispo dispo-non"><strong>❌ Indisponible ${periode}.</strong>
    ${jour ? `<p>Il sera libre à partir du <strong>${dateFr(jour)}</strong>.</p><button type="button" class="btn btn-rouge btn-petit" data-reserver-dates="${echapper(v.id)}|${jour}">Réserver à partir du ${dateFr(jour)}</button>` : ""}</div>`;
}

function ouvrirFiche(v) {
  const paliers = [1, ...[...(agence.remises ?? [])].sort((a, b) => a.jours_min - b.jours_min).map((r) => r.jours_min)];
  const specs = [
    ["Année", v.annee],
    ...(v.gamme ? [["Gamme", v.gamme]] : []),
    ...(v.couleur ? [["Couleur", v.couleur]] : []),
    ["Boîte", v.boite],
    ["Carburant", v.carburant],
    ["Places", v.places],
    ["Portes", v.portes],
    v.autonomie_km ? ["Autonomie", `${v.autonomie_km} km`] : ["Valises", v.bagages],
    ["Caution", da(v.caution)],
    ["Kilométrage", `${kmInclus()} km/jour`],
  ];
  $("#fiche-contenu").innerHTML = `
    <img class="fiche-photo" src="${urlPhoto(v)}" alt="${echapper(nomVoiture(v))}">
    <div class="fiche-corps">
      <div>
        <p class="surtitre">${echapper(v.categorie)}</p>
        <h3>${echapper(nomVoiture(v))}<small>${v.annee} · ou similaire</small></h3>
      </div>
      <p>${echapper(v.description)}</p>
      <div class="specs">${specs.map(([nom, valeur]) => `<div class="spec"><small>${nom}</small><strong>${echapper(valeur)}</strong></div>`).join("")}</div>
      <div class="fiche-prix">
        ${paliers.map((n) => {
          const remise = remisePour(n);
          const parJour = v.prix_par_jour * (1 - remise / 100);
          return `<div><small>${n === 1 ? "1 à " + (paliers[1] - 1 || 6) + " jours" : "dès " + n + " jours"}</small><strong>${da(parJour)}</strong><small>par jour</small>${remise ? `<span class="remise">-${remise}%</span>` : ""}</div>`;
        }).join("")}
      </div>
      ${v.equipements?.length ? `<div class="equipements">${v.equipements.map((e) => `<span>${echapper(e)}</span>`).join("")}</div>` : ""}
      <ul class="inclus">
        <li>Assurance responsabilité civile incluse</li>
        <li>${kmInclus()} km par jour inclus</li>
        <li>Assistance 24h/24 en cas de panne</li>
        <li>Annulation gratuite jusqu'à 48 h avant le départ</li>
      </ul>
      ${bandeauFiche(v)}
      <div class="fiche-actions">
        <button type="button" class="btn btn-rouge btn-grand" data-reserver="${echapper(v.id)}" ${occupees.includes(v.id) ? "disabled" : ""}>${occupees.includes(v.id) ? "Indisponible sur vos dates" : "Réserver ce véhicule"}</button>
        <a class="btn btn-whatsapp btn-grand" href="${lienWhatsApp(messageVehicule(v))}" target="_blank" rel="noopener">💬 Demander sur WhatsApp</a>
      </div>
    </div>`;
  ouvrirModale($("#modale-fiche"));
}

// ---------- Réservation ----------
function ouvrirReservation(v) {
  voitureChoisie = v;
  $("#etape-formulaire").hidden = false;
  $("#etape-succes").hidden = true;
  message.textContent = "";
  message.className = "message";

  const el = form.elements;
  el.date_debut.value = dates.debut || "";
  el.date_fin.value = dates.fin || "";
  if (dates.heureDebut) el.heure_depart.value = dates.heureDebut;
  if (dates.heureFin) el.heure_retour.value = dates.heureFin;
  el.lieu_depart.value = lieuChoisi;
  el.lieu_retour.value = lieuChoisi;
  el.date_fin.min = el.date_debut.value || aujourdhui;

  $("#recap-photo").src = urlPhoto(v);
  $("#recap-photo").alt = nomVoiture(v);
  $("#recap-categorie").textContent = v.categorie;
  $("#recap-titre").innerHTML = `${echapper(nomVoiture(v))} <small>${v.annee}</small>`;
  $("#recap-caracteristiques").innerHTML = caracteristiques(v);
  majRecap();
  ouvrirModale(modale);
  dispo = { etat: "inconnu" };
  verifierDisponibilite();
}

// ---------- Disponibilité : on la dit AVANT que le client remplisse ses informations ----------
const classesResume = { libre: "dispo-oui", occupe: "dispo-non", verification: "dispo-info", invalide: "dispo-info" };

function afficherDisponibilite() {
  const zone = $("#disponibilite"), suite = $("#suite-reservation"), nom = voitureChoisie ? nomVoiture(voitureChoisie) : "Ce véhicule";
  const { etat, d } = dispo;
  const { date_debut, date_fin } = form.elements;
  const periode = `du <strong>${dateFr(date_debut.value)}</strong> au <strong>${dateFr(date_fin.value)}</strong>`;
  suite.hidden = !["libre", "erreur"].includes(etat);
  // résumé en haut de la fenêtre : sur téléphone, le client le voit sans faire défiler
  const resume = $("#dispo-resume");
  resume.className = `dispo-resume ${classesResume[etat] ?? ""}`;
  resume.innerHTML = { verification: "⏳ Vérification de la disponibilité…", libre: "✅ Disponible sur vos dates", occupe: `❌ Indisponible sur ces dates · <a href="#disponibilite" data-aller-dispo>voir les solutions ↓</a>`, invalide: "⚠️ Vérifiez vos dates", erreur: "", inconnu: "" }[etat] ?? "";
  resume.hidden = !resume.innerHTML;
  const classes = { inconnu: "dispo-info", invalide: "dispo-info", verification: "dispo-info", libre: "dispo-oui", erreur: "dispo-info", occupe: "dispo-non" };
  zone.className = `dispo ${classes[etat] ?? "dispo-info"}`;
  if (etat === "inconnu") zone.innerHTML = `Choisissez vos dates de départ et de retour : nous vérifions tout de suite que ce véhicule est libre.`;
  else if (etat === "invalide") zone.innerHTML = `⚠️ ${echapper(dispo.message)}`;
  else if (etat === "verification") zone.innerHTML = `<span class="rond-attente" aria-hidden="true"></span> Vérification de la disponibilité…`;
  else if (etat === "erreur") zone.innerHTML = `⚠️ Nous n'avons pas pu vérifier la disponibilité à l'instant. Vous pouvez continuer : l'agence confirmera votre réservation.`;
  else if (etat === "libre") zone.innerHTML = `✅ <strong>${echapper(nom)}</strong> est disponible ${periode}. Vous pouvez continuer : remplissez vos informations ci-dessous.`;
  else {
    const alt = d?.alternatives ?? [];
    zone.innerHTML = `
      ${dispo.note ? `<p class="dispo-note">${echapper(dispo.note)}</p>` : ""}
      <strong>❌ ${d?.raison === "hors_ligne" ? `${echapper(nom)} n'est pas proposé à la location en ce moment.` : `${echapper(nom)} n'est pas disponible ${periode}.`}</strong>
      ${d?.libre_le ? `<div class="dispo-bloc"><p>Il sera libre à partir du <strong>${dateFr(d.libre_le)}</strong>. Pour la même durée : <strong>${dateFr(d.libre_le)} → ${dateFr(d.libre_au)}</strong>.</p>
        <button type="button" class="btn btn-rouge btn-petit" data-dispo-dates="${d.libre_le}|${d.libre_au}">Choisir ces dates</button></div>` : ""}
      ${alt.length ? `<div class="dispo-bloc"><p>Ces véhicules sont <strong>libres sur vos dates</strong> :</p><div class="alternatives">${alt.map((a) => `
        <button type="button" class="alternative" data-dispo-voiture="${echapper(a.id)}">
          <img src="${urlPhoto(a)}" alt="" loading="lazy"><span><strong>${echapper(nomVoiture(a))}</strong><small>${echapper(a.categorie)}${a.gamme ? ` · ${echapper(a.gamme)}` : ""}</small></span><em>${da(a.prix_par_jour)}/jour</em></button>`).join("")}</div></div>`
        : `<div class="dispo-bloc"><p>Aucun autre véhicule n'est libre sur ces dates : essayez d'autres dates ou contactez-nous.</p></div>`}
      <a class="lien-dispo" href="${lienWhatsApp(messageVehicule(voitureChoisie))}" target="_blank" rel="noopener">💬 Demander à l'agence</a>`;
    requestAnimationFrame(() => zone.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
}

async function verifierDisponibilite(note = "") {
  clearTimeout(minuteurDispo);
  const { date_debut, date_fin } = form.elements;
  if (!voitureChoisie) return;
  if (!date_debut.value || !date_fin.value) { dispo = { etat: "inconnu" }; return afficherDisponibilite(); }
  if (date_debut.value < aujourdhui) { dispo = { etat: "invalide", message: "La date de départ est déjà passée." }; return afficherDisponibilite(); }
  if (date_fin.value < date_debut.value) { dispo = { etat: "invalide", message: "La date de retour doit être après la date de départ." }; return afficherDisponibilite(); }
  dispo = { etat: "verification" };
  afficherDisponibilite();
  const numero = ++numeroVerification;
  try {
    const r = await fetch(`/api/disponibilite?voiture=${encodeURIComponent(voitureChoisie.id)}&debut=${date_debut.value}&fin=${date_fin.value}`);
    if (!r.ok) throw new Error("vérification impossible");
    const d = await r.json();
    if (numero !== numeroVerification) return; // une vérification plus récente a pris le relais
    dispo = { etat: d.disponible ? "libre" : "occupe", d, note };
  } catch {
    if (numero !== numeroVerification) return;
    dispo = { etat: "erreur" };
  }
  afficherDisponibilite();
}

// Le client modifie ses dates : on masque la suite du formulaire le temps de vérifier
function datesModifiees() {
  clearTimeout(minuteurDispo);
  dispo = { etat: "verification" };
  afficherDisponibilite();
  minuteurDispo = setTimeout(() => verifierDisponibilite(), 350);
}

const optionsCochees = () => $$("#options input:checked").map((i) => i.value);

function majRecap() {
  const v = voitureChoisie;
  if (!v) return;
  const { date_debut, date_fin } = form.elements;
  if (!date_debut.value || !date_fin.value || date_fin.value < date_debut.value) {
    $("#recap-prix").innerHTML = `<p class="caution">${date_fin.value && date_fin.value < date_debut.value ? "⚠️ La date de retour doit être après la date de départ." : "Choisissez vos dates pour voir le prix total."}</p>
      <p class="caution">À partir de ${da(v.prix_par_jour)} par jour · caution ${da(v.caution)}</p>`;
    return;
  }
  const jours = joursLocation(date_debut.value, date_fin.value);
  const d = devis(v, jours, optionsCochees());
  $("#recap-prix").innerHTML = `
    <div class="ligne-prix"><span>${da(v.prix_par_jour)} × ${pluriel(jours, "jour")}</span><span>${da(d.location)}</span></div>
    ${d.remise ? `<div class="ligne-prix remise"><span>Remise ${d.remise}%</span><span>− ${da(d.montantRemise)}</span></div>` : ""}
    ${d.options.map((o) => `<div class="ligne-prix"><span>${echapper(o.nom)}</span><span>${da(o.montant)}</span></div>`).join("")}
    <div class="total"><span>Total</span><span>${da(d.total)}</span></div>
    <p class="caution">Caution à la remise des clés : ${da(v.caution)} (rendue au retour) · ${kmInclus() * jours} km inclus</p>`;
}

function verifierReservation() {
  const el = form.elements;
  if (dispo.etat === "occupe") return "Ce véhicule n'est pas disponible sur ces dates : choisissez d'autres dates ou un autre véhicule.";
  if (dispo.etat === "verification") return "Vérification de la disponibilité en cours : un instant…";
  if (!el.date_debut.value || !el.date_fin.value) return "Choisissez vos dates de départ et de retour.";
  if (el.date_debut.value < aujourdhui) return "La date de départ est déjà passée.";
  if (el.date_fin.value < el.date_debut.value) return "La date de retour doit être après la date de départ.";
  if (!el.nom.value.trim() || !el.prenom.value.trim()) return "Indiquez votre nom et votre prénom.";
  if (!telephoneValide(el.telephone.value)) return "Indiquez un numéro de téléphone valide (ex. 05 55 12 34 56).";
  if (el.email.value && !el.email.checkValidity()) return "L'adresse email n'est pas valide.";
  if (!el.conditions_acceptees.checked) return "Merci d'accepter les conditions de location.";
  return "";
}

async function reserver(e) {
  e.preventDefault();
  const erreur = verifierReservation();
  message.className = "message erreur";
  if (erreur) { message.textContent = erreur; return; }

  const el = form.elements;
  const corps = {
    voiture_id: voitureChoisie.id,
    date_debut: el.date_debut.value,
    heure_depart: el.heure_depart.value,
    date_fin: el.date_fin.value,
    heure_retour: el.heure_retour.value,
    lieu_depart: el.lieu_depart.value,
    lieu_retour: el.lieu_retour.value,
    options: optionsCochees(),
    nom: el.nom.value.trim(),
    prenom: el.prenom.value.trim(),
    telephone: el.telephone.value.trim(),
    email: el.email.value.trim(),
    message: el.message.value.trim(),
    paiement: { mode: el.paiement_mode.value, lieu: el.paiement_lieu.value },
  };

  const bouton = form.querySelector('button[type="submit"]');
  bouton.disabled = true;
  message.className = "message";
  message.textContent = "Envoi en cours…";
  try {
    const r = await fetch("/api/reservations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    const reponse = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(reponse.erreur || "La réservation n'a pas pu être enregistrée."), { statut: r.status });
    derniereReservation = { ...reponse, nom: corps.nom, prenom: corps.prenom, telephone: corps.telephone, email: corps.email };
    afficherSucces(derniereReservation);
    if (dates.debut) { await chargerOccupees(); afficherCatalogue(); }
  } catch (err) {
    if (err.statut === 409) {
      // quelqu'un vient de réserver ce véhicule : le client garde ce qu'il a saisi et on lui propose autre chose
      message.textContent = "";
      await verifierDisponibilite("Ce véhicule vient d'être réservé par un autre client. Vos informations sont conservées : choisissez d'autres dates ou un autre véhicule.");
      if (dates.debut) { await chargerOccupees(); afficherCatalogue(); }
      return;
    }
    message.className = "message erreur";
    message.innerHTML = `${echapper(err.message === "Failed to fetch" ? "Le serveur ne répond pas." : err.message)}
      <a href="${lienWhatsApp(messageVehicule(voitureChoisie))}" target="_blank" rel="noopener">Réserver sur WhatsApp</a>`;
  } finally {
    bouton.disabled = false;
  }
}

function afficherSucces(r) {
  $("#etape-formulaire").hidden = true;
  $("#etape-succes").hidden = false;
  $("#succes-numero").textContent = r.numero;
  $("#succes-texte").textContent = `${r.voiture} · du ${dateFr(r.date_debut)} au ${dateFr(r.date_fin)} (${pluriel(r.jours, "jour")}) · total ${da(r.total)}. Nous vous appelons au ${r.telephone} pour confirmer.`;
  afficherSuitePaiement(r);
  $("#succes-whatsapp").href = lienWhatsApp(
    `Bonjour ${agence.nom}, je viens de réserver la ${r.voiture} du ${dateFr(r.date_debut)} au ${dateFr(r.date_fin)}. Mon numéro de réservation : ${r.numero}.`,
  );
  modale.querySelector(".modale-contenu").scrollTop = 0;
}

// Après une réservation, le dossier est déjà prérempli
function allerAuDossier() {
  const r = derniereReservation;
  fermerModales();
  if (r) {
    const el = $("#form-dossier").elements;
    for (const champ of ["nom", "prenom", "telephone", "email"]) if (!el[champ].value) el[champ].value = r[champ] ?? "";
    el.reservation_numero.value = r.numero;
  }
  $("#dossier").scrollIntoView();
}

// ---------- Tarifs ----------
function afficherTarifs() {
  const remises = [...(agence.remises ?? [])].sort((a, b) => a.jours_min - b.jours_min);
  const premier = remises[0]?.jours_min;
  $("#tarifs-tete").innerHTML = `<tr><th>Catégorie</th><th>${premier ? `1 à ${premier - 1} jours` : "Par jour"}</th>${remises
    .map((r) => `<th>Dès ${r.jours_min} jours<small>-${r.pourcentage}%</small></th>`)
    .join("")}<th>Caution dès</th></tr>`;
  $("#tarifs-corps").innerHTML = categoriesPresentes()
    .map((c) => {
      const liste = enLigne().filter((v) => v.categorie === c).sort((a, b) => a.prix_par_jour - b.prix_par_jour);
      const min = liste[0].prix_par_jour;
      const exemples = liste.slice(0, 3).map((v) => v.modele).join(", ");
      return `<tr>
        <td>${echapper(c)}<small>${echapper(exemples)}</small></td>
        <td>${da(min)} <small>/ jour</small></td>
        ${remises.map((r) => `<td>${da(min * (1 - r.pourcentage / 100))} <small>/ jour</small></td>`).join("")}
        <td>${da(Math.min(...liste.map((v) => v.caution)))}</td>
      </tr>`;
    })
    .join("");
}

// ---------- Crédits photos ----------
function afficherCredits() {
  $("#liste-credits").innerHTML = voitures
    .filter((v) => v.credit)
    .map((v) => `<li>${echapper(nomVoiture(v))} — <a href="${echapper(v.credit.source)}" target="_blank" rel="noopener">${echapper(v.credit.auteur)}</a>, ${echapper(v.credit.licence)}</li>`)
    .join("");
}

/* ═══════════════════════════════════════════════════════════════
   DOSSIER DU CLIENT : informations + photos des documents
   ═══════════════════════════════════════════════════════════════ */
const formDossier = $("#form-dossier");
const TAILLE_MAX_FICHIER = 8 * 1024 * 1024;
const TYPES_ACCEPTES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const fichiers = {};

const DOCUMENTS = [
  { id: "permis_recto", nom: "Permis de conduire — recto", aide: "Le côté avec votre photo" },
  { id: "permis_verso", nom: "Permis de conduire — verso", aide: "Le côté avec les catégories" },
  { id: "identite_recto", nom: "Pièce d'identité — recto", aide: "Ou la page photo du passeport" },
  { id: "identite_verso", nom: "Pièce d'identité — verso", aide: "Inutile pour un passeport" },
  { id: "domicile", nom: "Justificatif de domicile", aide: "Facultatif : facture, certificat de résidence…" },
  { id: "permis_international", nom: "Permis international ou traduction", aide: "Seulement si votre permis n'est pas algérien" },
];

// Les documents obligatoires dépendent de ce que le client a choisi
function documentsRequis() {
  const el = formDossier.elements;
  return [
    "permis_recto",
    "permis_verso",
    "identite_recto",
    ...(el.identite_type.value === "CNI" ? ["identite_verso"] : []),
    ...(el.permis_pays.value === "Autre pays" ? ["permis_international"] : []),
  ];
}

function afficherDepots() {
  $("#depots").innerHTML = DOCUMENTS.map((d) => `
    <div class="depot" data-depot="${d.id}">
      <div class="depot-texte"><strong>${d.nom} <span class="requis"></span></strong><small>${d.aide}</small></div>
      <div class="depot-zone">
        <div class="depot-apercu"></div>
        <label class="depot-bouton">📎 Choisir<input type="file" accept="image/*,application/pdf" hidden></label>
        <button type="button" class="depot-retirer" aria-label="Retirer ce fichier" hidden>×</button>
      </div>
    </div>`).join("");
  majRequis();
}

function majRequis() {
  const requis = documentsRequis();
  $$(".depot").forEach((zone) => (zone.querySelector(".requis").textContent = requis.includes(zone.dataset.depot) ? "*" : ""));
}

function choisirFichier(zone, fichier) {
  const erreurs = $("#dossier-erreurs");
  if (!TYPES_ACCEPTES.includes(fichier.type)) {
    erreurs.hidden = false;
    erreurs.innerHTML = `<li>« ${echapper(fichier.name)} » : seules les photos (JPG, PNG) et les PDF sont acceptés.</li>`;
    return;
  }
  if (fichier.size > TAILLE_MAX_FICHIER) {
    erreurs.hidden = false;
    erreurs.innerHTML = `<li>« ${echapper(fichier.name)} » est trop lourd (${(fichier.size / 1048576).toFixed(1)} Mo, maximum 8 Mo).</li>`;
    return;
  }
  erreurs.hidden = true;
  fichiers[zone.dataset.depot] = fichier;
  const apercu = zone.querySelector(".depot-apercu");
  const image = fichier.type.startsWith("image/") && !fichier.type.includes("hei");
  apercu.innerHTML = `${image ? `<img src="${URL.createObjectURL(fichier)}" alt="">` : `<span class="pdf">📄</span>`}<span>${echapper(fichier.name)}</span>`;
  zone.classList.add("rempli");
  zone.querySelector(".depot-retirer").hidden = false;
  zone.querySelector(".depot-bouton").firstChild.textContent = "🔁 Changer";
}

function retirerFichier(zone) {
  delete fichiers[zone.dataset.depot];
  zone.querySelector(".depot-apercu").innerHTML = "";
  zone.querySelector("input[type=file]").value = "";
  zone.classList.remove("rempli");
  zone.querySelector(".depot-retirer").hidden = true;
  zone.querySelector(".depot-bouton").firstChild.textContent = "📎 Choisir";
}

const anneesDepuis = (date) => {
  const d = new Date(date), maintenant = new Date();
  return maintenant.getFullYear() - d.getFullYear() - (maintenant < new Date(maintenant.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0);
};

// Avertissements non bloquants : l'agence décide au cas par cas
function majAvertissements() {
  const el = formDossier.elements;
  const age = agence.age_minimum ?? 23, permis = agence.permis_annees_minimum ?? 2;
  const messages = [];
  if (el.date_naissance.value && anneesDepuis(el.date_naissance.value) < age) messages.push(`Vous avez moins de ${age} ans : l'agence vous contactera pour voir si une location reste possible.`);
  if (el.permis_date.value && anneesDepuis(el.permis_date.value) < permis) messages.push(`Votre permis a moins de ${permis} ans : l'agence vous contactera pour en parler.`);
  const zone = $("#dossier-avertissements");
  zone.hidden = !messages.length;
  zone.innerHTML = messages.map((m) => `⚠️ ${echapper(m)}`).join("<br>");
}

function verifierDossier() {
  const el = formDossier.elements;
  const erreurs = [];
  const obligatoires = { nom: "le nom", prenom: "le prénom", date_naissance: "la date de naissance", nationalite: "la nationalité", adresse: "l'adresse", identite_numero: "le numéro de la pièce d'identité", identite_expiration: "la date d'expiration de la pièce d'identité", permis_numero: "le numéro de permis", permis_date: "la date d'obtention du permis" };
  for (const [champ, nom] of Object.entries(obligatoires)) if (!el[champ].value.trim()) erreurs.push(`Indiquez ${nom}.`);
  if (!telephoneValide(el.telephone.value)) erreurs.push("Indiquez un numéro de téléphone valide.");
  if (el.email.value && !el.email.checkValidity()) erreurs.push("L'adresse email n'est pas valide.");
  if (el.identite_expiration.value && el.identite_expiration.value < aujourdhui) erreurs.push("Votre pièce d'identité est expirée.");
  if (el.reservation_numero.value && !/^CHM-\d{4}$/i.test(el.reservation_numero.value.trim())) erreurs.push("Le numéro de réservation ressemble à CHM-0012.");
  for (const id of documentsRequis()) if (!fichiers[id]) erreurs.push(`Ajoutez la photo : ${DOCUMENTS.find((d) => d.id === id).nom}.`);
  if (!el.consentement.checked) erreurs.push("Merci d'accepter l'utilisation de vos documents pour le contrat.");
  return erreurs;
}

const lireEnBase64 = (fichier) =>
  new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result).split(",")[1]);
    lecteur.onerror = () => reject(new Error(`Impossible de lire ${fichier.name}`));
    lecteur.readAsDataURL(fichier);
  });

// XMLHttpRequest plutôt que fetch : il donne la progression de l'envoi
function envoyerAvecProgression(url, corps, progression) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => e.lengthComputable && progression(e.loaded / e.total);
    xhr.onload = () => {
      let reponse = {};
      try { reponse = JSON.parse(xhr.responseText); } catch {}
      xhr.status < 300 ? resolve(reponse) : reject(new Error(reponse.erreur || "L'envoi a échoué, réessayez."));
    };
    xhr.onerror = () => reject(new Error("Le serveur ne répond pas. Vérifiez votre connexion et réessayez."));
    xhr.send(corps);
  });
}

async function envoyerDossier(e) {
  e.preventDefault();
  const zoneErreurs = $("#dossier-erreurs");
  const erreurs = verifierDossier();
  if (erreurs.length) {
    zoneErreurs.hidden = false;
    zoneErreurs.innerHTML = erreurs.map((m) => `<li>${echapper(m)}</li>`).join("");
    zoneErreurs.scrollIntoView({ block: "center" });
    return;
  }
  zoneErreurs.hidden = true;

  const bouton = $("#dossier-envoyer");
  const progression = $("#dossier-progression");
  const barre = progression.querySelector(".envoi-barre span");
  const texte = progression.querySelector("p");
  bouton.disabled = true;
  progression.hidden = false;
  barre.style.width = "0";
  texte.textContent = "Préparation des documents…";

  try {
    const champs = Object.fromEntries([...new FormData(formDossier)].filter(([, valeur]) => typeof valeur === "string").map(([k, v]) => [k, v.trim()]));
    delete champs.consentement;
    const documents = await Promise.all(
      Object.entries(fichiers).map(async ([type, f]) => ({ type, nom: f.name, mime: f.type, contenu: await lireEnBase64(f) })),
    );
    const reponse = await envoyerAvecProgression("/api/dossiers", JSON.stringify({ champs, documents }), (p) => {
      barre.style.width = `${Math.round(p * 100)}%`;
      texte.textContent = p < 1 ? `Envoi… ${Math.round(p * 100)} %` : "Enregistrement…";
    });
    formDossier.hidden = true;
    $("#dossier-succes").hidden = false;
    $("#dossier-numero").textContent = reponse.numero;
    $("#dossier-whatsapp").href = lienWhatsApp(
      `Bonjour ${agence.nom}, je viens d'envoyer mon dossier (n° ${reponse.numero})${champs.reservation_numero ? ` pour la réservation ${champs.reservation_numero}` : ""}. ${champs.prenom} ${champs.nom}`,
    );
    $("#dossier").scrollIntoView();
  } catch (err) {
    zoneErreurs.hidden = false;
    zoneErreurs.innerHTML = `<li>${echapper(err.message)}</li>`;
  } finally {
    bouton.disabled = false;
    progression.hidden = true;
  }
}

/* ═══════════════════════════════════════════════════════════════
   ASSISTANT DE CHAT : répond à partir des informations de l'agence
   ═══════════════════════════════════════════════════════════════ */
const chat = $("#chat");
const chatMessages = $("#chat-messages");
const SUGGESTIONS = ["Quels sont vos prix ?", "Une voiture automatique", "Quels documents faut-il ?", "Livraison à l'aéroport ?", "Montant de la caution", "Comment payer ?"];

function bulle(qui, html) {
  const div = document.createElement("div");
  div.className = `chat-bulle chat-${qui}`;
  div.innerHTML = html;
  chatMessages.append(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function listeVoitures(liste, max = 4) {
  if (!liste.length) return "";
  const lignes = liste.slice(0, max).map((v) => `• <a href="#" data-fiche="${echapper(v.id)}">${echapper(nomVoiture(v))}</a> — ${da(v.prix_par_jour)}/jour`);
  return `<br>${lignes.join("<br>")}${liste.length > max ? `<br>… et ${liste.length - max} autre${liste.length - max > 1 ? "s" : ""} dans le catalogue.` : ""}`;
}

const contient = (texte, mots) => mots.some((m) => texte.includes(m));
const moinsCheres = (liste) => [...liste].sort((a, b) => a.prix_par_jour - b.prix_par_jour);

// Chaque règle : des mots-clés (français, darija en lettres latines) et la réponse
const REGLES = [
  [["bonjour", "salam", "salut", "bonsoir", "hello", "ahlan", " cc "], () => `Bonjour ! 👋 Je peux vous aider à trouver un véhicule, connaître les prix, les documents ou la livraison. Que cherchez-vous ?`],
  [["merci", "saha", "chokran", "choukran", "parfait", "super"], () => `Avec plaisir ! Bonne route avec ${echapper(agence.nom)} 🚗`],
  [["automatique", "auto ", "boite auto", "bva"], () => `Nos véhicules automatiques :${listeVoitures(moinsCheres(enLigne().filter((v) => v.boite === "Automatique")))}`],
  [["7 places", "sept places", "famille", "familial", "monospace"], () => `Pour toute la famille, nos 7 places :${listeVoitures(moinsCheres(enLigne().filter((v) => v.places >= 7)))}`],
  [["electrique", "hybride", "recharge", "batterie"], () => `Nos véhicules électriques, rechargés au départ :${listeVoitures(moinsCheres(enLigne().filter((v) => v.carburant === "Électrique")))}`],
  [["4x4", "desert", "sahara", "sud", "piste", "tamanrasset", "djanet", "ghardaia"], () => `Pour le Sud et les pistes, nos 4x4 :${listeVoitures(moinsCheres(enLigne().filter((v) => v.categorie === "4x4")))}`],
  [["luxe", "prestige", "mariage", "haut de gamme", "vip"], () => `Nos véhicules de prestige, parfaits pour un mariage ou un rendez-vous important :${listeVoitures(moinsCheres(enLigne().filter((v) => v.categorie === "Prestige")))}`],
  [["pas cher", "moins cher", "economique", "petit prix", "petit budget"], () => `Nos véhicules les plus économiques :${listeVoitures(moinsCheres(enLigne()), 3)}`],
  [["document", "papier", "dossier", "piece", "permis", "passeport"], () => `Pour louer, il faut : ${(agence.documents_contrat ?? []).map(echapper).join(", ")}. Le permis doit avoir au moins ${agence.permis_annees_minimum ?? 2} ans. 👉 Vous pouvez <a href="#dossier" data-chat-aller>déposer votre dossier en ligne</a> pour gagner du temps.`],
  [[" age ", "quel age", "jeune", "ans minimum"], () => `Il faut avoir au moins ${agence.age_minimum ?? 23} ans et un permis de plus de ${agence.permis_annees_minimum ?? 2} ans.`],
  [["caution", "garantie", "depot"], () => {
    const c = enLigne().map((v) => v.caution);
    return `La caution va de ${da(Math.min(...c))} à ${da(Math.max(...c))} selon le véhicule (elle est indiquée sur chaque fiche). Elle est demandée à la remise des clés et rendue au retour s'il n'y a pas de dommage.`;
  }],
  [["aeroport", "livraison", "livrer", "domicile", "hotel", "gare", " vol "], () => {
    const livraison = agence.options.find((o) => o.id === "livraison");
    return `Oui ! Nous livrons ici : ${agence.lieux.map(echapper).join(", ")}.${livraison ? ` La livraison et la reprise coûtent ${da(livraison.prix)} par location.` : ""} Indiquez votre numéro de vol dans le message de réservation.`;
  }],
  [["payer", "paiement", "carte", "cib", "edahabia", "dahabia", "espece", "cash", "visa", "mastercard", "baridi", "ccp", "virement", "cheque"], () => `Vous pouvez payer par ${modesPaiement().map((m) => echapper(m.nom.replace(/ \(.*\)/, ""))).join(", ")}, ${echapper(lieuSurPlace().toLowerCase())}${paiementEnLigne() ? ", ou en ligne par carte" : ""}. Rien à payer pour réserver, et nous ne demandons jamais votre numéro de carte sur le site.`],
  [["horaire", "ouvert", "ouverture", "ferme", "heure", "vendredi"], () => `Nos horaires :<br>${agence.horaires.map(echapper).join("<br>")}`],
  [["adresse", "ou etes", "ou se trouve", "localisation", "agence", "situe"], () => `Notre agence : ${echapper(agence.adresse)}. <a href="#contact" data-chat-aller>Voir le plan</a>`],
  [["km", "kilometr"], () => `${kmInclus()} km par jour sont inclus. Au-delà, chaque kilomètre est facturé ${da(agence.tarifs_supplementaires?.prix_km_supplementaire ?? 20)}.`],
  [["remise", "reduction", "promo", "semaine", "mois", "long"], () => `Les remises sont automatiques : ${[...(agence.remises ?? [])].sort((a, b) => a.jours_min - b.jours_min).map((r) => `-${r.pourcentage}% dès ${r.jours_min} jours`).join(", ")}.`],
  [["assurance", "accident", "panne", "franchise", "assistance"], () => {
    const assurance = agence.options.find((o) => o.id === "assurance");
    return `L'assurance de base et l'assistance 24h/24 sont incluses.${assurance ? ` Pour ne rien payer en cas d'accident, ajoutez l'option « ${echapper(assurance.nom)} » à ${da(assurance.prix)}/${assurance.par}.` : ""} En cas de panne, appelez-nous au ${echapper(agence.telephone)}.`;
  }],
  [["reserver", "reservation", "louer", "disponible"], () => `Pour réserver : choisissez vos dates en haut de la page, puis cliquez sur « Réserver » sous le véhicule. Ça prend 2 minutes. <a href="#vehicules" data-chat-aller>Voir les véhicules</a>`],
  [["prix", "tarif", "combien", " cher", "chhal", "ch7al", "bch7al", "cout"], () => {
    const p = enLigne().map((v) => v.prix_par_jour);
    return `Nos prix vont de ${da(Math.min(...p))} à ${da(Math.max(...p))} par jour, avec des remises dès ${agence.remises?.[0]?.jours_min ?? 7} jours. Les moins chers :${listeVoitures(moinsCheres(enLigne()), 3)}`;
  }],
];

function repondre(question) {
  const texte = ` ${normaliser(question)} `;

  // Un budget dans la question : « j'ai 8000 DA par jour »
  const budget = texte.match(/(\d[\d\s.]{2,})\s*(da|dinars?|dzd)?/);
  if (budget) {
    const montant = Number(budget[1].replace(/[\s.]/g, ""));
    if (montant >= 1000 && montant <= 200000) {
      const liste = moinsCheres(enLigne().filter((v) => v.prix_par_jour <= montant)).reverse();
      return liste.length
        ? `Avec ${da(montant)} par jour, voici ce que je vous conseille :${listeVoitures(liste)}`
        : `Nos prix commencent à ${da(Math.min(...enLigne().map((v) => v.prix_par_jour)))} par jour. Pensez aux remises dès ${agence.remises?.[0]?.jours_min ?? 7} jours !`;
    }
  }

  // Une marque ou un modèle cité
  const cites = enLigne().filter((v) => contient(texte, [normaliser(v.marque), normaliser(v.modele)].filter((m) => m.length > 2)));
  if (cites.length) return `Voici ce que nous avons :${listeVoitures(cites)}<br>Cliquez sur un véhicule pour voir sa fiche.`;

  for (const [mots, reponse] of REGLES) if (contient(texte, mots)) return reponse();

  // Sinon, on cherche la question fréquente qui ressemble le plus
  const mots = texte.split(/\W+/).filter((m) => m.length > 3);
  const meilleure = agence.faq
    .map((f) => ({ f, score: mots.filter((m) => normaliser(f.q + " " + f.r).includes(m)).length }))
    .sort((a, b) => b.score - a.score)[0];
  if (meilleure?.score >= 2) return `${echapper(meilleure.f.r)}`;

  return `Je n'ai pas la réponse à cette question 🤔 Un conseiller peut vous répondre tout de suite sur <a href="${lienWhatsApp(question)}" target="_blank" rel="noopener">WhatsApp</a> ou au ${echapper(agence.telephone)}.`;
}

function poser(question) {
  if (!question.trim()) return;
  bulle("user", echapper(question));
  $("#chat-suggestions").innerHTML = "";
  const attente = bulle("assistant", `<span class="chat-ecrit">● ● ●</span>`);
  setTimeout(() => {
    attente.innerHTML = repondre(question);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 450 + Math.random() * 400);
}

function ouvrirChat() {
  chat.hidden = false;
  $("#chat-ouvrir").classList.add("masque");
  if (!chatMessages.children.length) {
    $("#chat-mode").textContent = "Assistant automatique · répond tout de suite";
    bulle("assistant", `Bonjour 👋 Je suis l'assistant de ${echapper(agence.nom)}. Posez-moi vos questions sur nos véhicules, nos prix ou la location.`);
    $("#chat-suggestions").innerHTML = SUGGESTIONS.map((s) => `<button type="button">${s}</button>`).join("");
  }
  $("#chat-texte").focus();
}

function fermerChat() {
  chat.hidden = true;
  $("#chat-ouvrir").classList.remove("masque");
}

/* ═══════════════════════════════════════════════════════════════
   ÉVÉNEMENTS
   ═══════════════════════════════════════════════════════════════ */
const voitureParId = (id) => voitures.find((v) => v.id === id);

// Un seul écouteur pour tous les boutons « fiche », « réserver », catégories…
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-aller-dispo]")) { e.preventDefault(); $("#disponibilite").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
  const cible = e.target.closest("[data-fiche], [data-reserver], [data-categorie], [data-fermer], [data-chat-aller], #tout-voir, [data-decaler], [data-reserver-dates], [data-dispo-dates], [data-dispo-voiture]");
  if (!cible) return;
  if (cible.dataset.decaler) {
    decalerDates(cible.dataset.decaler);
  } else if (cible.dataset.reserverDates) {
    const [identifiant, jour] = cible.dataset.reserverDates.split("|");
    fermerModales();
    decalerDates(jour).then(() => ouvrirReservation(voitureParId(identifiant)));
  } else if (cible.dataset.dispoDates) {
    const [debut, fin] = cible.dataset.dispoDates.split("|");
    form.elements.date_debut.value = debut;
    form.elements.date_fin.min = debut;
    form.elements.date_fin.value = fin;
    majRecap();
    verifierDisponibilite();
  } else if (cible.dataset.dispoVoiture) {
    // le client garde ses dates : on bascule sur le véhicule libre
    const el = form.elements;
    dates = { debut: el.date_debut.value, fin: el.date_fin.value, heureDebut: el.heure_depart.value, heureFin: el.heure_retour.value };
    ouvrirReservation(voitureParId(cible.dataset.dispoVoiture));
  } else if (cible.dataset.fiche) {
    e.preventDefault();
    ouvrirFiche(voitureParId(cible.dataset.fiche));
  } else if (cible.dataset.reserver) {
    ouvrirReservation(voitureParId(cible.dataset.reserver));
  } else if (cible.dataset.categorie) {
    choisirCategorie(cible.dataset.categorie);
    if (cible.classList.contains("tuile")) $("#vehicules").scrollIntoView();
  } else if (cible.hasAttribute("data-fermer")) {
    fermerModales();
  } else if (cible.hasAttribute("data-chat-aller")) {
    fermerChat();
  } else if (cible.id === "tout-voir") {
    effacerFiltres();
  }
});

// Clic à côté d'une fenêtre ou touche Échap : on ferme
$$(".modale").forEach((m) => m.addEventListener("click", (e) => e.target === m && fermerModales()));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  fermerModales();
  fermerChat();
});

recherche.addEventListener("submit", rechercher);
recherche.elements.debut.addEventListener("change", (e) => {
  recherche.elements.fin.min = e.target.value;
  if (recherche.elements.fin.value && recherche.elements.fin.value < e.target.value) recherche.elements.fin.value = e.target.value;
});

["#recherche-texte", "#filtre-gamme", "#filtre-boite", "#filtre-carburant", "#filtre-places", "#tri"].forEach((id) =>
  $(id).addEventListener("input", () => { visibles = TAILLE_PAGE; afficherCatalogue(); }),
);
$("#budget").addEventListener("input", () => { majBudget(); visibles = TAILLE_PAGE; afficherCatalogue(); });
$("#voir-plus").addEventListener("click", () => { visibles += TAILLE_PAGE; afficherCatalogue(); });

form.addEventListener("input", (e) => {
  if (e.target.name === "date_debut") form.elements.date_fin.min = e.target.value;
  majRecap();
  if (["date_debut", "date_fin"].includes(e.target.name)) datesModifiees();
});
form.addEventListener("change", (e) => {
  if (e.target.name === "paiement_mode") majLieuxPaiement();
  // certains téléphones n'envoient que « change » pour un champ date
  if (["date_debut", "date_fin"].includes(e.target.name)) { majRecap(); datesModifiees(); }
});
form.addEventListener("submit", reserver);
$("#succes-dossier").addEventListener("click", allerAuDossier);
$("#ouvrir-credits").addEventListener("click", () => ouvrirModale($("#modale-credits")));

// Dossier
$("#depots").addEventListener("change", (e) => e.target.type === "file" && e.target.files[0] && choisirFichier(e.target.closest(".depot"), e.target.files[0]));
$("#depots").addEventListener("click", (e) => e.target.closest(".depot-retirer") && retirerFichier(e.target.closest(".depot")));
formDossier.addEventListener("change", (e) => {
  if (["identite_type", "permis_pays"].includes(e.target.name)) majRequis();
  if (["date_naissance", "permis_date"].includes(e.target.name)) majAvertissements();
});
formDossier.addEventListener("submit", envoyerDossier);

// Chat
$("#chat-ouvrir").addEventListener("click", ouvrirChat);
$("#chat-fermer").addEventListener("click", fermerChat);
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  poser($("#chat-texte").value);
  $("#chat-texte").value = "";
});
$("#chat-suggestions").addEventListener("click", (e) => e.target.matches("button") && poser(e.target.textContent));

// Menu sur téléphone
$("#burger").addEventListener("click", () => {
  const ouvert = $("#nav-liens").classList.toggle("ouvert");
  $("#burger").setAttribute("aria-expanded", ouvert);
  $("#burger").textContent = ouvert ? "✕" : "☰";
});
$$("#nav-liens a").forEach((a) => a.addEventListener("click", () => {
  $("#nav-liens").classList.remove("ouvert");
  $("#burger").setAttribute("aria-expanded", false);
  $("#burger").textContent = "☰";
}));

// Apparition des sections au défilement
const observateur = new IntersectionObserver(
  (entrees) => entrees.forEach((e) => e.isIntersecting && (e.target.classList.add("visible"), observateur.unobserve(e.target))),
  { threshold: 0.12 },
);
$$(".reveal").forEach((el) => observateur.observe(el));

/* ═══════════════════════════════════════════════════════════════
   DÉMARRAGE : le serveur d'abord, sinon les fichiers JSON directement
   ═══════════════════════════════════════════════════════════════ */
async function chargerJSON(...adresses) {
  for (const adresse of adresses) {
    try {
      const r = await fetch(adresse);
      if (r.ok) return await r.json();
    } catch {}
  }
  throw new Error(`Impossible de charger ${adresses[0]}`);
}

async function demarrer() {
  try {
    [agence, voitures] = await Promise.all([
      chargerJSON("/api/agence", "../informations/agence.json"),
      chargerJSON("/api/voitures", "../informations/voitures.json"),
    ]);
  } catch (err) {
    grille.innerHTML = `<p class="vide">Le catalogue n'a pas pu être chargé. Lancez le site avec <strong>python3 serveur.py</strong>, puis ouvrez http://localhost:8000</p>`;
    console.error(err);
    return;
  }
  afficherAgence();
  afficherDiaporama();
  afficherTuiles();
  afficherPuces();
  preparerFiltres();
  afficherCatalogue();
  afficherTarifs();
  afficherDepots();
  afficherCredits();
  ajouterDonneesGoogle();
}

demarrer();
