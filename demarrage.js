/* ═══════════════════════════════════════════════════════════════
   DÉMARRAGE : connexion, barre du haut, mise à jour automatique
   ═══════════════════════════════════════════════════════════════ */
let minuteur = null;

function dessinerUtilisateur() {
  const u = etat.utilisateur;
  $("#utilisateur").innerHTML = `<div class="avatar">${echapper(initiales(u.nom))}</div>
    <div style="min-width:0;cursor:pointer" data-mon-compte title="Mon compte"><strong>${echapper(u.nom)}</strong><small>${u.role === "admin" ? "Administrateur" : "Employé"}</small></div>
    <button data-deconnexion aria-label="Se déconnecter" title="Se déconnecter">${icone("sortie")}</button>`;
}

async function entrer(utilisateur, csrf) {
  etat.utilisateur = utilisateur;
  etat.csrf = csrf;
  $("#connexion").hidden = true;
  $("#app").hidden = false;
  dessinerUtilisateur();
  if (utilisateur.doit_changer) { demanderNouveauMotDePasse(); return; }
  await chargerDonnees();
  etat.reservations.forEach(() => 0);
  afficherVue();
  clearInterval(minuteur);
  minuteur = setInterval(() => !document.hidden && etat.utilisateur && !etat.utilisateur.doit_changer && actualiser(true), 30000);
}

$("#form-connexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements, erreur = $("#erreur-connexion"), bouton = e.target.querySelector("[type=submit]");
  erreur.hidden = true;
  if (!f.identifiant.value.trim() || !f.mot_de_passe.value) { erreur.textContent = "Saisissez votre identifiant et votre mot de passe."; erreur.hidden = false; return; }
  bouton.disabled = true;
  try {
    const r = await api("POST", "/connexion", { identifiant: f.identifiant.value, mot_de_passe: f.mot_de_passe.value });
    f.mot_de_passe.value = "";
    await entrer(r.utilisateur, r.csrf);
  } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  finally { bouton.disabled = false; }
});

document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-deconnexion]")) {
    try { await api("POST", "/deconnexion", {}); } catch {}
    clearInterval(minuteur);
    Object.assign(etat, { utilisateur: null, reservations: [], dossiers: [], csrf: "" });
    reglages.agence = null;
    fermerTiroir(); fermerFenetre();
    afficherConnexion();
  }
  if (e.target.closest("[data-mon-compte]")) ouvrirMonCompte();
});

$("#burger").addEventListener("click", () => { $("#lateral").classList.toggle("ouvert"); $("#voile").classList.toggle("ouvert"); });
$("#voile").addEventListener("click", () => { $("#lateral").classList.remove("ouvert"); $("#voile").classList.remove("ouvert"); });
$("#nouvelle-reservation").addEventListener("click", () => ouvrirFormulaireReservation());
$("#cloche").addEventListener("click", () => {
  filtres.statut = "en attente";
  if (routeActuelle().vue === "reservations") rendreReservations($("#contenu")); else location.hash = "#/reservations";
});

// Recherche globale : elle filtre la liste des réservations (nom, téléphone, n°, véhicule)
let attenteRecherche;
$("#recherche-globale").addEventListener("input", (e) => {
  clearTimeout(attenteRecherche);
  attenteRecherche = setTimeout(() => {
    etat.recherche = e.target.value.trim();
    if (etat.recherche && filtres.statut !== "toutes") filtres.statut = "toutes";
    if (routeActuelle().vue === "reservations") rendreReservations($("#contenu"));
    else if (etat.recherche) location.hash = "#/reservations";
  }, 250);
});
$("#recherche-globale").addEventListener("keydown", (e) => e.key === "Escape" && (e.target.value = "", e.target.dispatchEvent(new Event("input")), e.target.blur()));

window.addEventListener("hashchange", () => etat.utilisateur && !etat.utilisateur.doit_changer && afficherVue());
document.addEventListener("visibilitychange", () => !document.hidden && etat.utilisateur && !etat.utilisateur.doit_changer && actualiser(true));

brancherSelecteursLangue();
demarrerTraduction();

// Au chargement : une session est peut-être déjà ouverte
(async () => {
  try {
    const r = await api("GET", "/moi");
    await entrer(r.utilisateur, r.csrf);
  } catch {
    afficherConnexion();
  }
})();
