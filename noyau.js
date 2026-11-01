/* ═══════════════════════════════════════════════════════════════
   ESPACE EMPLOYÉS — noyau : outils, API, navigation, fenêtres, notifications
   ═══════════════════════════════════════════════════════════════ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Tout ce que les clients écrivent (nom, message…) est protégé avant d'être affiché
const REMPLACEMENTS = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const echapper = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => REMPLACEMENTS[c]);

const da = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR")} DA`;
const pluriel = (n, mot, motPluriel) => `${n} ${n > 1 ? motPluriel || mot + "s" : mot}`;
const normaliser = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- Dates (toujours en AAAA-MM-JJ, à l'heure locale) ----------
const versISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const aujourdhui = () => versISO(new Date());
const dateDepuis = (iso) => new Date(`${iso}T00:00:00`);
const ajouterJours = (iso, n) => { const d = dateDepuis(iso); d.setDate(d.getDate() + n); return versISO(d); };
const joursEntre = (a, b) => Math.round((dateDepuis(b) - dateDepuis(a)) / 86400000);
const dateFr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const dateCourte = (iso) => dateDepuis(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "short" }).replace(".", "");
const dateLongue = (iso) => dateDepuis(iso).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const heureFr = (iso) => (iso ? new Date(iso).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "") : "");
const jourSemaine = (iso) => dateDepuis(iso).toLocaleDateString(LOCALE, { weekday: "short" }).replace(".", "");

// ---------- Icônes ----------
const ICONES = {
  tableau: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  reservations: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
  planning: '<path d="M3 6h9M8 12h12M5 18h8"/>',
  flotte: '<path d="M3 15v-3l2-5h14l2 5v3"/><path d="M3 15h18v3H3z"/><circle cx="7" cy="18" r="1.3"/><circle cx="17" cy="18" r="1.3"/>',
  dossiers: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  parametres: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  equipe: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  sortie: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9"/>',
  cloche: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8M10 21h4"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  cle: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  drapeau: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  croix: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  blocage: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  tel: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.2-4.6A8 8 0 1 1 21 12z"/>',
  imprimer: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  telecharger: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  editer: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  corbeille: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  alerte: '<path d="M12 3l10 18H2zM12 10v5M12 18h0"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  agence: '<path d="M4 21V5l8-2v18M12 8h8v13M8 8h0M8 12h0M8 16h0M16 12h0M16 16h0"/>',
  journal: '<path d="M8 6h12M8 12h12M8 18h12M4 6h0M4 12h0M4 18h0"/>',
  gauche: '<path d="M15 5l-7 7 7 7"/>',
  droite: '<path d="M9 5l7 7-7 7"/>',
  argent: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  dossier: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  contrat: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 17c1-2 2-2 3 0s2 0 3-1"/>',
  entretien: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  sinistre: '<path d="M12 3l9 4v5c0 5-3.5 8-9 9-5.5-1-9-4-9-9V7z"/><path d="M12 8v5M12 16h0"/>',
  statistiques: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
const icone = (nom) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom] ?? ""}</svg>`;

// ---------- Statuts ----------
const STATUTS = {
  "en attente": { cls: "badge-attente", icone: "horloge", nom: "En attente" },
  "confirmée": { cls: "badge-confirmee", icone: "check", nom: "Confirmée" },
  "en cours": { cls: "badge-en-cours", icone: "cle", nom: "En cours" },
  "terminée": { cls: "badge-terminee", icone: "drapeau", nom: "Terminée" },
  "annulée": { cls: "badge-annulee", icone: "croix", nom: "Annulée" },
  "blocage": { cls: "badge-blocage", icone: "blocage", nom: "Indisponible" },
};
const badgeStatut = (s) => `<span class="badge ${STATUTS[s]?.cls ?? "badge-neutre"}">${icone(STATUTS[s]?.icone ?? "horloge")}${STATUTS[s]?.nom ?? echapper(s)}</span>`;
const badge = (cls, texte, ico) => `<span class="badge ${cls}">${ico ? icone(ico) : ""}${texte}</span>`;

// ---------- État de l'application ----------
const etat = { utilisateur: null, csrf: "", reservations: [], voitures: [], dossiers: [], depenses: [], categoriesDepense: {}, agence: {}, vues: {}, vuesVues: new Set(), tiroirRendu: null, vehiculeOuvert: null };
const estAdmin = () => etat.utilisateur?.role === "admin";

// ---------- Communication avec le serveur ----------
async function api(methode, chemin, corps) {
  const options = { method: methode, headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
  if (methode !== "GET") options.headers["X-CSRF-Token"] = etat.csrf;
  if (corps !== undefined) options.body = JSON.stringify(corps);
  let reponse;
  try {
    reponse = await fetch(`/api/employe${chemin}`, options);
  } catch {
    throw new Error("Le serveur ne répond pas. Vérifiez la connexion.");
  }
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) {
    if (reponse.status === 401 && etat.utilisateur && chemin !== "/connexion") sessionExpiree();
    if (donnees.changer_mot_de_passe) demanderNouveauMotDePasse();
    const erreur = new Error(donnees.erreur || "Une erreur est survenue.");
    erreur.statut = reponse.status;
    throw erreur;
  }
  return donnees;
}

// Action déclenchée par un bouton : empêche le double clic et affiche l'erreur proprement
async function agir(bouton, travail, messageSucces) {
  if (bouton) bouton.disabled = true;
  try {
    const resultat = await travail();
    if (messageSucces) notifier(messageSucces);
    return resultat;
  } catch (e) {
    notifier(e.message, "erreur");
    return undefined;
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

// ---------- Notifications ----------
function notifier(texte, type = "succes", duree = 4200, auClic) {
  const el = document.createElement("div");
  el.className = `notification ${type === "succes" ? "" : type}`;
  el.textContent = texte;
  el.addEventListener("click", () => { auClic?.(); el.remove(); });
  $("#notifications").append(el);
  setTimeout(() => el.remove(), type === "erreur" ? Math.max(duree, 6500) : duree);
  return el;
}

// ---------- Infobulle (graphiques) ----------
function montrerInfobulle(evenement, html) {
  const bulle = $("#infobulle");
  bulle.innerHTML = html;
  bulle.hidden = false;
  const { clientWidth: l, clientHeight: h } = document.documentElement;
  const x = Math.min(evenement.clientX + 14, l - bulle.offsetWidth - 10);
  const y = Math.min(evenement.clientY + 14, h - bulle.offsetHeight - 10);
  bulle.style.left = `${Math.max(8, x)}px`;
  bulle.style.top = `${Math.max(8, y)}px`;
}
const cacherInfobulle = () => ($("#infobulle").hidden = true);

// ---------- Panneau latéral ----------
function ouvrirTiroir(rendu) {
  etat.tiroirRendu = rendu;
  const { titre, sousTitre = "", corps } = rendu();
  $("#tiroir-titre").innerHTML = titre;
  $("#tiroir-sous-titre").innerHTML = sousTitre;
  const zone = $("#tiroir-corps");
  const defilement = zone.scrollTop;
  zone.innerHTML = corps;
  $("#tiroir").hidden = false;
  zone.scrollTop = defilement;
}
function fermerTiroir() {
  $("#tiroir").hidden = true;
  etat.tiroirRendu = null;
}
const rafraichirTiroir = () => etat.tiroirRendu && !$("#tiroir").hidden && ouvrirTiroir(etat.tiroirRendu);

// ---------- Fenêtre ----------
function ouvrirFenetre(titre, html, largeur) {
  $("#fenetre-titre").textContent = titre;
  $("#fenetre-corps").innerHTML = html;
  $(".fenetre-boite").style.width = largeur ? `min(${largeur}px, 100%)` : "";
  $("#fenetre").hidden = false;
  const premier = $("#fenetre-corps input:not([type=hidden]), #fenetre-corps select");
  if (premier) setTimeout(() => premier.focus(), 50);
  return $("#fenetre-corps");
}
const fermerFenetre = () => { $("#fenetre").hidden = true; $("#fenetre-corps").innerHTML = ""; };

function confirmer(message, libelle = "Confirmer", danger = false) {
  return new Promise((resolve) => {
    const corps = ouvrirFenetre("Êtes-vous sûr ?", `<p>${message}</p><div class="fenetre-pied">
      <button class="btn btn-contour" data-non>Annuler</button><button class="btn ${danger ? "btn-rouge" : "btn-vert"}" data-oui>${libelle}</button></div>`, 460);
    corps.querySelector("[data-non]").onclick = () => { fermerFenetre(); resolve(false); };
    corps.querySelector("[data-oui]").onclick = () => { fermerFenetre(); resolve(true); };
  });
}

// ---------- Outils métier partagés ----------
// numéros de téléphone et immatriculations : toujours lisibles de gauche à droite, même en arabe
const ltr = (t) => `<bdi dir="ltr">${echapper(t)}</bdi>`;
const nomClient = (r) => `${r.client?.prenom ?? ""} ${r.client?.nom ?? ""}`.trim();
const chiffresTel = (t) => String(t ?? "").replace(/\D/g, "");
const memeTel = (a, b) => chiffresTel(a).slice(-9) === chiffresTel(b).slice(-9) && chiffresTel(a).length >= 9;
const encaisse = (r) => r.paye || 0;
const reste = (r) => Math.max(0, (r.total || 0) - encaisse(r));
const compteVoiture = (id) => etat.voitures.find((v) => v.id === id);
const urlPhoto = (v) => (v?.photo ? `../images/voitures/${encodeURIComponent(v.photo)}${v.photo_v ? `?v=${v.photo_v}` : ""}` : "logo.jpg");
const estReservation = (r) => r.statut !== "blocage";
const actives = () => etat.reservations.filter((r) => estReservation(r) && r.statut !== "annulée");
const enRetard = (r) => r.statut === "en cours" && r.date_fin < aujourdhui();
const departEnRetard = (r) => r.statut === "confirmée" && r.date_debut < aujourdhui();
const dossierDe = (r) => etat.dossiers.find((d) => (d.reservation_numero || "").toUpperCase() === r.numero) || etat.dossiers.find((d) => memeTel(d.telephone, r.client?.telephone));
const lienWhatsApp = (tel, texte) => {
  let n = chiffresTel(tel);
  if (n.startsWith("00")) n = n.slice(2);
  else if (n.startsWith("0")) n = "213" + n.slice(1);
  return `https://wa.me/${n}?text=${encodeURIComponent(texte)}`;
};
function initiales(nom) {
  return nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0].toUpperCase()).join("") || "?";
}

// ---------- Navigation ----------
const MENU = [
  { groupe: "Activité", vues: ["tableau", "reservations", "planning", "contrats"] },
  { groupe: "Gestion", vues: ["vehicules", "etats", "entretien", "sinistres", "dossiers", "clients"] },
  { groupe: "Finances", vues: ["comptabilite", "statistiques"], admin: true },
  { groupe: "Administration", vues: ["parametres", "equipe"], admin: true },
];
function enregistrerVue(nom, definition) { etat.vues[nom] = definition; }

function routeActuelle() {
  const [, vue = "tableau", ...reste] = location.hash.split("/");
  return { vue: etat.vues[vue] ? vue : "tableau", param: decodeURIComponent(reste.join("/")) };
}

function dessinerMenu() {
  const enAttente = etat.reservations.filter((r) => r.statut === "en attente").length;
  const dossiers = etat.dossiers.filter((d) => d.statut === "à vérifier").length;
  const { vue } = routeActuelle();
  $("#menu").innerHTML = MENU.filter((g) => !g.admin || estAdmin()).map((g) => `
    <div class="menu-titre">${g.groupe}</div>
    ${g.vues.map((v) => {
      const compte = { reservations: enAttente, dossiers, contrats: contratsASigner().length, sinistres: (etat.incidents ?? []).filter((i) => ["ouvert", "en_cours"].includes(i.statut)).length, etats: (typeof releves_a_faire === "function" ? (({ departs, retours }) => departs.length + retours.length)(releves_a_faire()) : 0) }[v] ?? 0;
      return `<a class="menu-lien ${v === vue ? "actif" : ""}" href="#/${v}">${icone(etat.vues[v].icone)}${etat.vues[v].titre}${compte ? `<span class="pastille">${compte}</span>` : ""}</a>`;
    }).join("")}`).join("");
  $("#cloche").innerHTML = `${icone("cloche")}${enAttente ? `<span class="pastille">${enAttente}</span>` : ""}`;
  $("#cloche").title = enAttente ? `${pluriel(enAttente, "réservation")} à confirmer` : "Rien à confirmer";
}

function afficherVue() {
  const { vue, param } = routeActuelle();
  const definition = etat.vues[vue];
  if (definition.admin && !estAdmin()) { location.hash = "#/tableau"; return; }
  $("#titre-page").textContent = definition.titre;
  document.title = `${definition.titre} — CHM Automotive Location`;
  dessinerMenu();
  $("#lateral").classList.remove("ouvert");
  $("#voile").classList.remove("ouvert");
  definition.rendre($("#contenu"), param);
}
const rafraichirVue = () => { dessinerMenu(); const y = scrollY; afficherVue(); scrollTo(0, y); rafraichirTiroir(); };

// ---------- Données et mise à jour automatique ----------
async function chargerDonnees() {
  const [reservations, voitures, dossiers, agence, depenses, incidents] = await Promise.all([
    api("GET", "/reservations"), api("GET", "/voitures"), api("GET", "/dossiers"),
    fetch("/api/agence").then((r) => r.json()), api("GET", "/depenses"), api("GET", "/incidents"),
  ]);
  Object.assign(etat, { reservations, voitures, dossiers, agence, depenses: depenses.depenses, categoriesDepense: depenses.categories, incidents: incidents.incidents, typesIncident: incidents.types });
}

async function actualiser(silencieux) {
  const avant = new Set(etat.reservations.map((r) => r.numero));
  const dossiersAvant = new Set(etat.dossiers.map((d) => d.numero));
  try {
    await chargerDonnees();
  } catch (e) {
    if (!silencieux) notifier(e.message, "erreur");
    return;
  }
  const nouvelles = etat.reservations.filter((r) => !avant.has(r.numero) && r.statut === "en attente");
  const nouveauxDossiers = etat.dossiers.filter((d) => !dossiersAvant.has(d.numero));
  if (silencieux) {
    nouvelles.forEach((r) => { etat.nouvelles.add(r.numero); notifier(`Nouvelle réservation ${r.numero} — ${nomClient(r)} (${r.voiture})`, "info", 9000, () => { location.hash = "#/reservations"; setTimeout(() => ouvrirReservation(r.numero), 100); }); });
    nouveauxDossiers.forEach((d) => notifier(`Nouveau dossier client : ${d.prenom} ${d.nom}`, "info", 9000, () => { location.hash = "#/dossiers"; }));
  }
  if (nouvelles.length || nouveauxDossiers.length || !silencieux) rafraichirVue();
  else dessinerMenu();
}
etat.nouvelles = new Set();

// ---------- Session ----------
function sessionExpiree() {
  etat.utilisateur = null;
  fermerTiroir(); fermerFenetre();
  afficherConnexion("Votre session a expiré : reconnectez-vous.");
}

function afficherConnexion(message) {
  $("#app").hidden = true;
  $("#connexion").hidden = false;
  const zone = $("#erreur-connexion");
  zone.hidden = !message;
  zone.textContent = message || "";
  $("#form-connexion").elements.mot_de_passe.value = "";
  $("#form-connexion").elements.identifiant.focus();
}

function demanderNouveauMotDePasse() {
  if ($("#fenetre").hidden === false && $("#form-mdp")) return;
  const corps = ouvrirFenetre("Choisissez votre mot de passe", `
    <p class="gris">Pour la sécurité de l'agence, remplacez le mot de passe provisoire par le vôtre (8 caractères minimum).</p>
    <form id="form-mdp" class="formulaire-colonne" novalidate>
      <label>Mot de passe actuel<input type="password" name="actuel" autocomplete="current-password" required></label>
      <label>Nouveau mot de passe<input type="password" name="nouveau" autocomplete="new-password" required></label>
      <label>Répétez le nouveau mot de passe<input type="password" name="repete" autocomplete="new-password" required></label>
      <p class="erreur-form" hidden></p>
      <button class="btn btn-rouge btn-large" type="submit">Enregistrer</button>
    </form>`, 480);
  $(".fenetre-entete .fermer").hidden = true;
  $(".fenetre-fond").removeAttribute("data-fermer-fenetre");
  corps.querySelector("#form-mdp").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements, erreur = e.target.querySelector(".erreur-form");
    erreur.hidden = true;
    if (f.nouveau.value !== f.repete.value) { erreur.textContent = "Les deux mots de passe ne sont pas identiques."; erreur.hidden = false; return; }
    try {
      await api("POST", "/mot-de-passe", { actuel: f.actuel.value, nouveau: f.nouveau.value });
      etat.utilisateur.doit_changer = false;
      $(".fenetre-entete .fermer").hidden = false;
      $(".fenetre-fond").setAttribute("data-fermer-fenetre", "");
      fermerFenetre();
      notifier("Mot de passe enregistré. Bienvenue !");
      rafraichirVue();
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}

// ---------- Événements communs ----------
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-fermer-tiroir]")) fermerTiroir();
  if (e.target.closest("[data-fermer-fenetre]")) fermerFenetre();
  const oeil = e.target.closest("[data-oeil]");
  if (oeil) { const champ = oeil.previousElementSibling; champ.type = champ.type === "password" ? "text" : "password"; }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($(".visionneuse")) return $(".visionneuse").remove();
    if (!$("#fenetre").hidden && $(".fenetre-fond").hasAttribute("data-fermer-fenetre")) return fermerFenetre();
    if (!$("#tiroir").hidden) return fermerTiroir();
  }
  const saisie = /input|textarea|select/i.test(document.activeElement?.tagName ?? "");
  if (!etat.utilisateur || saisie || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); $("#recherche-globale").focus(); }
  if (e.key === "n") { e.preventDefault(); ouvrirFormulaireReservation(); }
});
