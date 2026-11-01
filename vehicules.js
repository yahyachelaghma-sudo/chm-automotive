/* ═══════════════════════════════════════════════════════════════
   VÉHICULES : gamme, état, emplacement, documents, entretien, rentabilité
   ═══════════════════════════════════════════════════════════════ */
const filtreVehicules = { texte: "", statut: "tous", gamme: "", categorie: "", emplacement: "", vue: "cartes" };

const ETATS = {
  disponible: { nom: "Disponible", cls: "badge-valide", icone: "check", aide: "Prêt à être loué" },
  nettoyage: { nom: "En nettoyage", cls: "badge-attente", icone: "horloge", aide: "Reste louable, à préparer" },
  maintenance: { nom: "En maintenance", cls: "badge-alerte", icone: "alerte", aide: "Retiré de la location" },
  reparation: { nom: "En réparation", cls: "badge-annulee", icone: "alerte", aide: "Retiré de la location" },
  hors_service: { nom: "Hors service", cls: "badge-annulee", icone: "croix", aide: "Retiré de la location" },
};
const ETATS_BLOQUANTS = ["maintenance", "reparation", "hors_service"];
const GAMMES = ["Économique", "Confort", "Premium", "Luxe", "Utilitaire"];
const ETATS_GENERAUX = { excellent: "Excellent", bon: "Bon", correct: "Correct", a_revoir: "À revoir" };
const NIVEAUX_CARBURANT = { plein: "Plein", "3/4": "3/4", "1/2": "1/2", "1/4": "1/4", reserve: "Réserve" };
const TYPES_ENTRETIEN = { vidange: "Vidange", revision: "Révision", pneus: "Pneus", freins: "Freins", batterie: "Batterie", climatisation: "Climatisation",
  controle_technique: "Contrôle technique", assurance: "Assurance (renouvellement)", vignette: "Vignette", carrosserie: "Carrosserie", autre: "Autre" };

const etatVoiture = (v) => (ETATS[v.etat] ? v.etat : "disponible");
const bloquee = (v) => ETATS_BLOQUANTS.includes(etatVoiture(v));
const badgeEtat = (e) => badge(ETATS[e].cls, ETATS[e].nom, ETATS[e].icone);
const joursRestants = (iso) => (iso ? joursEntre(aujourdhui(), iso) : null);
const reservationsAVenir = (v) => etat.reservations.filter((r) => r.voiture_id === v.id && estReservation(r) && ["en attente", "confirmée", "en cours"].includes(r.statut) && r.date_fin >= aujourdhui());

function emplacementsPossibles() {
  const lieux = (etat.agence.lieux ?? []).filter((l) => !/domicile/i.test(l));
  return [...new Set([...lieux, "Parking de l'agence", "Garage / atelier", "Chez le client", "Autre"])];
}

// Tout ce qui demande l'attention d'un employé pour ce véhicule
function alertesVehicule(v) {
  const alertes = [];
  for (const [champ, nom] of [["assurance_expiration", "Assurance"], ["controle_technique_expiration", "Contrôle technique"], ["vignette_expiration", "Vignette"]]) {
    const j = joursRestants(v[champ]);
    if (j === null) { if (champ === "assurance_expiration") alertes.push({ gravite: "or", type: "document", texte: "Assurance non renseignée" }); continue; }
    if (j < 0) alertes.push({ gravite: "rouge", type: "document", texte: `${nom} expirée depuis le ${dateFr(v[champ])}` });
    else if (j <= 30) alertes.push({ gravite: j <= 7 ? "rouge" : "or", type: "document", texte: `${nom} : expire dans ${j} jour${j > 1 ? "s" : ""} (${dateFr(v[champ])})` });
  }
  if (v.entretien_prochain_km && v.kilometrage != null) {
    const restant = v.entretien_prochain_km - v.kilometrage;
    if (restant < 0) alertes.push({ gravite: "rouge", type: "entretien", texte: `Entretien dépassé de ${Math.abs(restant).toLocaleString("fr-FR")} km` });
    else if (restant <= 1000) alertes.push({ gravite: "or", type: "entretien", texte: `Entretien à prévoir dans ${restant.toLocaleString("fr-FR")} km` });
  }
  const jEntretien = joursRestants(v.entretien_prochaine_date);
  if (jEntretien !== null && jEntretien < 0) alertes.push({ gravite: "rouge", type: "entretien", texte: `Entretien en retard depuis le ${dateFr(v.entretien_prochaine_date)}` });
  else if (jEntretien !== null && jEntretien <= 30) alertes.push({ gravite: "or", type: "entretien", texte: `Entretien prévu dans ${jEntretien} jour${jEntretien > 1 ? "s" : ""} (${dateFr(v.entretien_prochaine_date)})` });
  if (v.etat_general === "a_revoir") alertes.push({ gravite: "or", type: "etat", texte: "État général à revoir (dommage signalé)" });
  if (bloquee(v) && reservationsAVenir(v).length) alertes.push({ gravite: "rouge", type: "reservation", texte: `${ETATS[etatVoiture(v)].nom} mais ${pluriel(reservationsAVenir(v).length, "réservation")} à venir : à réaffecter` });
  return alertes;
}
const toutesAlertes = () => etat.voitures.flatMap((v) => alertesVehicule(v).map((a) => ({ ...a, voiture: v }))).sort((a, b) => (a.gravite === "rouge" ? 0 : 1) - (b.gravite === "rouge" ? 0 : 1));

// Locations de ce véhicule pour lesquelles un état des lieux a été fait (la plus récente d'abord)
function locationsAvecEtat(voiture) {
  return etat.reservations
    .filter((r) => r.voiture_id === voiture.id && estReservation(r) && (r.etat_depart || r.etat_retour))
    .sort((a, b) => b.date_debut.localeCompare(a.date_debut));
}

const ORDRE_VUES = ["avant", "arriere", "gauche", "droite", "interieur", "compteur", "dommage", "autre"];
// Petites vignettes (3 au plus) d'un état des lieux : cliquer sur l'une l'agrandit
function minivignettes(r, moment, max = 3) {
  const e = r[CLE_MOMENT[moment]], photos = [...(e?.photos ?? [])].sort((a, b) => ORDRE_VUES.indexOf(a.vue) - ORDRE_VUES.indexOf(b.vue));
  return photos.slice(0, max).map((p, i) => `<div class="vignette mini" data-doc="${urlPhotoEtat(r.numero, moment, p.fichier)}" data-pdf="false" title="${VUES_ETAT[p.vue] ?? ""}"><img src="${urlPhotoEtat(r.numero, moment, p.fichier)}" alt="" loading="lazy">${i === max - 1 && photos.length > max ? `<span class="plus-photos">+${photos.length - max}</span>` : ""}</div>`).join("");
}

// Bloc « état avant la prise / après le retour » d'une location (carte et fiche du véhicule)
function blocEtatLocation(r) {
  const colonne = (moment, titre, attente) => {
    const e = r[CLE_MOMENT[moment]];
    if (!e) return `<div class="etat-col"><small>${titre}</small><div class="etat-vide">${attente}</div></div>`;
    return `<div class="etat-col"><small>${titre}</small>
      <div class="mini-vignettes">${minivignettes(r, moment) || `<span class="etat-vide">Pas de photo</span>`}</div>
      <span class="mono petit">${e.km != null ? e.km.toLocaleString("fr-FR") + " km" : "—"} · ${NIVEAUX_CARBURANT[e.carburant] ?? echapper(e.carburant)}</span>
      ${e.dommages ? `<span class="rouge-texte petit">⚠ dommage${e.note ? ` : ${echapper(e.note)}` : ""}</span>` : ""}</div>`;
  };
  const photos = (r.etat_depart?.photos?.length ?? 0) + (r.etat_retour?.photos?.length ?? 0);
  return `<div class="etat-cols">${colonne("depart", "Avant la prise", "Pas encore réalisé")}${colonne("retour", "Après le retour", r.statut === "en cours" ? "En cours de location…" : "Pas encore réalisé")}</div>
    ${photos ? `<button type="button" class="btn btn-contour btn-petit" data-comparer="${r.numero}">${icone("dossier")}Comparer avant / après</button>` : ""}`;
}

function situationVoiture(v) {
  const auj = aujourdhui();
  if (bloquee(v)) return { cle: "indispo", badge: badgeEtat(etatVoiture(v)), libre: null };
  if (!v.disponible) return { cle: "hors", badge: badge("badge-neutre", "Hors ligne", "croix"), libre: null };
  const occupe = etat.reservations.filter((r) => r.voiture_id === v.id && r.statut !== "annulée" && r.statut !== "terminée" && r.date_debut <= auj && finOccupee(r) > auj).sort((a, b) => b.date_fin.localeCompare(a.date_fin))[0];
  if (!occupe) return { cle: "libre", badge: badgeEtat(etatVoiture(v)), libre: auj };
  let libre = finOccupee(occupe);
  for (let i = 0; i < 60; i++) {
    const suite = etat.reservations.find((r) => r.voiture_id === v.id && r.statut !== "annulée" && r.date_debut <= libre && finOccupee(r) > libre);
    if (!suite) break;
    libre = finOccupee(suite);
  }
  return occupe.statut === "blocage" ? { cle: "indispo", badge: badge("badge-blocage", "Indisponible", "blocage"), libre } : { cle: "loue", badge: badge("badge-en-cours", "Loué", "cle"), libre };
}

const depensesVoiture = (id) => etat.depenses.filter((d) => d.voiture_id === id);

function statsVoiture(v) {
  const facturables = reservationsFacturables().filter((r) => r.voiture_id === v.id);
  const debut = ajouterJours(aujourdhui(), -90), fin = aujourdhui();
  let loues = 0;
  for (const r of facturables) {
    const a = r.date_debut > debut ? r.date_debut : debut, b = finOccupee(r) < fin ? finOccupee(r) : fin;
    if (b > a) loues += joursEntre(a, b);
  }
  const ca = facturables.reduce((s, r) => s + r.total, 0), depenses = depensesVoiture(v.id).reduce((s, d) => s + d.montant, 0);
  return { locations: facturables.length, ca, depenses, occupation: Math.min(100, Math.round((loues / 90) * 100)) };
}

const datePastille = (iso) => {
  const j = joursRestants(iso);
  if (j === null) return `<span class="gris">—</span>`;
  const cls = j < 0 ? "badge-annulee" : j <= 30 ? "badge-alerte" : "badge-valide";
  return `<span class="mono" style="margin-inline-end:6px">${dateFr(iso)}</span>${badge(cls, j < 0 ? "expirée" : j <= 30 ? `${j} j` : "OK")}`;
};

// ---------- Liste ----------
function vehiculesFiltres() {
  const f = filtreVehicules, texte = normaliser(f.texte);
  return etat.voitures.map((v) => ({ v, s: situationVoiture(v), st: statsVoiture(v), al: alertesVehicule(v) })).filter(({ v, s, al }) =>
    (f.statut === "tous" || (f.statut === "alertes" ? al.length : s.cle === f.statut)) && (!f.gamme || v.gamme === f.gamme) && (!f.categorie || v.categorie === f.categorie) &&
    (!f.emplacement || (v.emplacement || "") === f.emplacement) && (!texte || normaliser(`${v.marque} ${v.modele} ${v.categorie} ${v.gamme} ${v.couleur ?? ""} ${v.immatriculation ?? ""}`).includes(texte)));
}

// En bas de la carte : l'état (avant / après) de la dernière location de ce véhicule
function carteEtatLocation(v) {
  const r = locationsAvecEtat(v)[0];
  if (!r) return `<div class="voiture-etat vide"><strong>État à la dernière location</strong><span class="gris petit">Aucun état des lieux enregistré pour l'instant.</span></div>`;
  return `<div class="voiture-etat"><div class="voiture-etat-tete"><strong>État à la dernière location</strong><span class="gris petit mono">${r.numero} · ${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)}</span></div>${blocEtatLocation(r)}</div>`;
}

function carteVehicule({ v, s, st, al }) {
  const rouge = al.some((a) => a.gravite === "rouge");
  return `<article class="carte voiture" data-vehicule="${v.id}" tabindex="0">
    <div class="voiture-photo ${v.disponible && !bloquee(v) ? "" : "hors-ligne"}"><img src="${urlPhoto(v)}" alt="" loading="lazy">${s.badge}<span class="badge badge-gamme">${echapper(v.gamme ?? "Confort")}</span></div>
    <div class="voiture-corps">
      <h3>${echapper(v.marque)} ${echapper(v.modele)}<small>${v.annee} · ${echapper(v.categorie)} · ${echapper(v.boite)} · ${echapper(v.carburant)}${v.couleur ? ` · ${echapper(v.couleur)}` : ""}</small></h3>
      <ul class="infos-voiture">
        <li>${icone("agence")}<span>${echapper(v.emplacement || "Emplacement non renseigné")}${v.emplacement_detail ? ` · ${echapper(v.emplacement_detail)}` : ""}</span></li>
        <li>${icone("planning")}<span class="mono">${v.kilometrage != null ? `${v.kilometrage.toLocaleString("fr-FR")} km` : "Kilométrage non renseigné"}</span>${v.immatriculation ? `<span class="gris mono" style="margin-inline-start:auto">${ltr(v.immatriculation)}</span>` : ""}</li>
      </ul>
      ${al.length ? `<div class="chip-alerte ${rouge ? "rouge" : ""}">${icone("alerte")}${pluriel(al.length, "alerte")} · ${echapper(al[0].texte)}</div>` : ""}
      <div class="voiture-stats">
        <div><small>Par jour</small><strong>${da(v.prix_par_jour)}</strong></div>
        <div><small>Occupation 90 j</small><strong>${st.occupation} %</strong></div>
        <div><small>Chiffre d'aff.</small><strong>${abreger(st.ca)} DA</strong></div>
      </div>
      ${s.libre && s.cle !== "libre" ? `<p class="petit gris">Libre à partir du <b style="color:var(--blanc)">${dateFr(s.libre)}</b></p>` : ""}
      <div class="voiture-pied">
        <label class="interrupteur"><input type="checkbox" data-en-ligne="${v.id}" ${v.disponible ? "checked" : ""}><i></i>${v.disponible ? "En ligne" : "Hors ligne"}</label>
        <button class="btn btn-contour btn-petit" data-vehicule="${v.id}">Détails ›</button>
      </div>
      ${carteEtatLocation(v)}</div></article>`;
}

function tableVehicules(liste) {
  return `<div class="carte tableau-boite"><table class="tableau tableau-large"><thead><tr><th>Véhicule</th><th>Gamme</th><th>État</th><th>Emplacement</th><th>Kilométrage</th><th>Assurance</th><th>Contrôle technique</th><th>Prix / jour</th><th>Occupation</th></tr></thead><tbody>
    ${liste.map(({ v, s, st, al }) => `<tr data-vehicule="${v.id}">
      <td data-label="Véhicule" class="plein"><div style="display:flex;gap:12px;align-items:center"><img class="mini-photo" src="${urlPhoto(v)}" alt="" loading="lazy"><div class="cellule-principale"><strong>${echapper(v.marque)} ${echapper(v.modele)}</strong><span class="mono">${ltr(v.immatriculation || v.annee)}${al.length ? ` · <b style="color:var(--or)">⚠ ${al.length}</b>` : ""}</span></div></div></td>
      <td data-label="Gamme">${echapper(v.gamme ?? "")}</td><td data-label="État">${s.badge}</td>
      <td data-label="Emplacement" class="cellule-principale"><strong>${echapper(v.emplacement || "—")}</strong><span>${echapper(v.emplacement_detail || "")}</span></td>
      <td data-label="Kilométrage" class="mono">${v.kilometrage != null ? v.kilometrage.toLocaleString("fr-FR") + " km" : "—"}</td>
      <td data-label="Assurance">${datePastille(v.assurance_expiration)}</td><td data-label="Contrôle technique">${datePastille(v.controle_technique_expiration)}</td>
      <td data-label="Prix / jour" class="mono"><strong style="color:var(--blanc)">${da(v.prix_par_jour)}</strong></td><td data-label="Occupation" class="mono">${st.occupation} %</td></tr>`).join("")}</tbody></table></div>`;
}

function rendreVehicules(conteneur) {
  const f = filtreVehicules;
  const tout = etat.voitures.map((v) => ({ s: situationVoiture(v), al: alertesVehicule(v) }));
  const compte = (k) => k === "tous" ? tout.length : k === "alertes" ? tout.filter((x) => x.al.length).length : tout.filter((x) => x.s.cle === k).length;
  const liste = vehiculesFiltres();
  const options = (valeurs, vide, courant) => `<option value="">${vide}</option>${valeurs.map((x) => `<option ${x === courant ? "selected" : ""}>${echapper(x)}</option>`).join("")}`;
  conteneur.innerHTML = `
    <div class="entete-vue">
      <div><h2>Véhicules</h2><p>${pluriel(etat.voitures.length, "véhicule")} · ${compte("libre")} disponible${compte("libre") > 1 ? "s" : ""} aujourd'hui${compte("alertes") ? ` · <b style="color:var(--or)">${pluriel(compte("alertes"), "véhicule")} avec alerte</b>` : ""}</p></div>
      <div class="actions"><button class="btn btn-contour" data-bloquer-v>${icone("blocage")}Bloquer des dates</button>
        ${estAdmin() ? `<button class="btn btn-rouge" data-ajouter-voiture>${icone("plus")}Ajouter un véhicule</button>` : ""}</div>
    </div>
    <div class="barre-filtres">
      <input type="search" id="vehicule-recherche" placeholder="Rechercher : marque, modèle, immatriculation, couleur…" value="${echapper(f.texte)}">
      <select id="v-gamme" aria-label="Gamme">${options(GAMMES, "Toutes les gammes", f.gamme)}</select>
      <select id="v-categorie" aria-label="Catégorie">${options([...new Set(etat.voitures.map((v) => v.categorie))].sort(), "Toutes les catégories", f.categorie)}</select>
      <select id="v-emplacement" aria-label="Emplacement">${options([...new Set(etat.voitures.map((v) => v.emplacement).filter(Boolean))].sort(), "Tous les emplacements", f.emplacement)}</select>
      <div class="puces" style="margin-inline-start:auto"><button class="puce ${f.vue === "cartes" ? "actif" : ""}" data-vue-vehicules="cartes">▦ Cartes</button><button class="puce ${f.vue === "tableau" ? "actif" : ""}" data-vue-vehicules="tableau">☰ Tableau</button></div>
    </div>
    <div class="barre-filtres"><div class="puces">${[["tous", "Tous"], ["libre", "Disponibles"], ["loue", "Loués"], ["indispo", "Indisponibles"], ["hors", "Hors ligne"], ["alertes", "⚠ Alertes"]]
      .map(([k, n]) => `<button class="puce ${f.statut === k ? "actif" : ""}" data-vehicule-statut="${k}">${n} <b>${compte(k)}</b></button>`).join("")}</div></div>
    ${!liste.length ? `<div class="carte vide-grand"><strong>Aucun véhicule</strong>Aucun véhicule ne correspond à votre recherche.</div>` : f.vue === "tableau" ? tableVehicules(liste) : `<div class="grille-voitures">${liste.map(carteVehicule).join("")}</div>`}`;
}
enregistrerVue("vehicules", { titre: "Véhicules", icone: "flotte", rendre: rendreVehicules });

// ---------- Fiche détaillée ----------
function lignesAlertes(v) {
  const al = alertesVehicule(v);
  return al.length ? `<div class="alertes">${al.map((a) => `<div class="alerte ${a.gravite === "rouge" ? "rouge" : ""}">⚠️ ${echapper(a.texte)}</div>`).join("")}</div>` : "";
}

function listeDepenses(id) {
  const liste = depensesVoiture(id);
  if (!liste.length) return `<p class="gris petit">Aucune dépense enregistrée (carburant, assurance, réparations, lavage…).</p>`;
  const total = liste.reduce((s, d) => s + d.montant, 0);
  const parCat = {};
  for (const d of liste) parCat[d.categorie] = (parCat[d.categorie] ?? 0) + d.montant;
  const nom = (k) => etat.categoriesDepense[k]?.nom ?? TYPES_ENTRETIEN[k] ?? k;
  const info = (titre, valeur) => `<div class="paire"><small>${titre}</small><strong>${echapper(valeur)}</strong></div>`;
  return `<div class="paires">${info("Total des dépenses", da(total))}${info("Nombre d'opérations", String(liste.length))}</div>
    <div style="margin:10px 0">${Object.entries(parCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="barre-ligne"><span>${echapper(nom(k))}</span><div><i style="width:${Math.max(2, (v / total) * 100)}%;background:var(--rouge)"></i></div><b class="mono">${da(v)}</b></div>`).join("")}</div>
    <ul class="historique">${liste.slice(0, 25).map((d) => `<li><b style="color:var(--blanc)">${echapper(nom(d.categorie))}</b> <span class="gris">· ${dateFr(d.date)} · ${da(d.montant)}${d.mode ? ` · ${echapper(d.mode)}` : ""}</span>${d.libelle ? `<br><span class="gris">${echapper(d.libelle)}</span>` : ""}<small>${echapper(d.par ?? "")}${d.source === "entretien" ? " · carnet d'entretien" : ""}</small></li>`).join("")}</ul>`;
}

function ouvrirFormulaireDepense(id) {
  const v = compteVoiture(id);
  const corps = ouvrirFenetre(`Dépense — ${v.marque} ${v.modele}`, `
    <form id="form-depense" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="grille-form">
        <label class="large">Type de dépense<select name="categorie">${Object.entries(etat.categoriesDepense).map(([k, c]) => `<option value="${k}">${echapper(c.nom)}</option>`).join("")}</select></label>
        <label>Date<input type="date" name="date" value="${aujourdhui()}" required></label>
        <label>Montant (DA)<input type="number" name="montant" min="1" step="50" required autofocus></label>
        <label>Mode de paiement<select name="mode">${["Espèces", "Virement", "Chèque", "Carte", "Autre"].map((m) => `<option>${m}</option>`).join("")}</select></label>
        <label>Note<input name="libelle" placeholder="Ex. : plein station Naftal, assurance annuelle…"></label>
      </div>
      <p class="gris petit">Pour une vidange, des pneus, un contrôle technique… utilisez plutôt « Enregistrer un entretien » : le coût arrive ici tout seul et le prochain rendez-vous est suivi.</p>
      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Enregistrer</button></div>
    </form>`, 560);
  const f = corps.querySelector("form");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    try {
      await api("POST", `/voitures/${id}/depenses`, { categorie: f.categorie.value, date: f.date.value, montant: f.montant.value, mode: f.mode.value, libelle: f.libelle.value });
      await chargerDonnees(); fermerFenetre(); rafraichirVue(); notifier("Dépense enregistrée ✓");
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}

function rendreTiroirVehicule(id) {
  const v = compteVoiture(id);
  if (!v) return { titre: "Introuvable", corps: `<p class="gris">Ce véhicule n'existe plus.</p>` };
  const s = situationVoiture(v), st = statsVoiture(v), avenir = reservationsAVenir(v).sort((a, b) => a.date_debut.localeCompare(b.date_debut));
  const km = v.kilometrage, reste = v.entretien_prochain_km != null && km != null ? v.entretien_prochain_km - km : null;
  const rentabilite = v.prix_achat ? Math.round(((st.ca - st.depenses) / v.prix_achat) * 100) : null;
  const doc = (nom, champ, extra = "") => `<div class="paire"><small>${nom}</small><strong>${datePastille(v[champ])}</strong>${extra}</div>`;
  const info = (nom, valeur, large) => `<div class="paire ${large ? "large" : ""}"><small>${nom}</small><strong>${valeur ? echapper(valeur) : `<span class="gris">—</span>`}</strong></div>`;
  return {
    titre: `${echapper(v.marque)} ${echapper(v.modele)}`,
    sousTitre: `${s.badge}${badge("badge-neutre", echapper(v.gamme ?? "Confort"))}<span class="gris petit">${v.annee} · ${echapper(v.categorie)}${v.immatriculation ? ` · ${ltr(v.immatriculation)}` : ""}</span>`,
    corps: `
      <img class="tiroir-photo" src="${urlPhoto(v)}" alt="">
      ${lignesAlertes(v)}
      <section class="section-tiroir"><h4>État et emplacement</h4>
        <div class="grille-form" style="align-items:end">
          <label>État du véhicule<select id="vh-etat">${Object.entries(ETATS).map(([k, e]) => `<option value="${k}" ${k === etatVoiture(v) ? "selected" : ""}>${e.nom}</option>`).join("")}</select></label>
          <label>État général<select id="vh-general">${Object.entries(ETATS_GENERAUX).map(([k, n]) => `<option value="${k}" ${k === (v.etat_general ?? "bon") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label>Emplacement<input id="vh-emplacement" list="liste-emplacements" value="${echapper(v.emplacement ?? "")}"><datalist id="liste-emplacements">${emplacementsPossibles().map((e) => `<option value="${echapper(e)}">`).join("")}</datalist></label>
          <label>Place / détail<input id="vh-detail" value="${echapper(v.emplacement_detail ?? "")}" placeholder="Ex. : place 12"></label>
          <label>Kilométrage actuel<input id="vh-km" type="number" min="0" step="1" value="${km ?? ""}"></label>
          <label class="interrupteur" style="padding-bottom:10px"><input type="checkbox" id="vh-enligne" ${v.disponible ? "checked" : ""}><i></i>Proposé sur le site</label>
        </div>
        <label style="margin-top:12px">Notes internes<textarea id="vh-notes" placeholder="Ex. : rayure pare-chocs avant, pneus à changer…">${echapper(v.notes ?? "")}</textarea></label>
        <div class="actions" style="margin-top:10px"><button class="btn btn-rouge" data-vact="sauver">Enregistrer</button></div>
        ${bloquee(v) && avenir.length ? `<div class="alerte rouge" style="margin-top:12px">⚠️ ${pluriel(avenir.length, "réservation")} à venir sur ce véhicule retiré de la location : ${avenir.slice(0, 3).map((r) => `<a href="#" data-res="${r.numero}" style="text-decoration:underline">${r.numero}</a>`).join(", ")}</div>` : ""}
      </section>

      <section class="section-tiroir"><h4>Documents</h4><div class="paires">
        ${doc("Assurance", "assurance_expiration", v.assurance_compagnie ? `<small style="display:block;margin-top:2px">${echapper(v.assurance_compagnie)}${v.assurance_police ? ` · ${echapper(v.assurance_police)}` : ""}</small>` : "")}
        ${doc("Contrôle technique", "controle_technique_expiration")}${doc("Vignette", "vignette_expiration")}
        ${info("Mise en circulation", v.date_mise_en_circulation ? dateFr(v.date_mise_en_circulation) : "")}
        ${info("N° de châssis (VIN)", v.vin, true)}</div></section>

      <section class="section-tiroir"><h4>Entretien</h4><div class="paires">
        ${info("Kilométrage", km != null ? `${km.toLocaleString("fr-FR")} km` : "")}
        <div class="paire"><small>Prochain entretien</small><strong>${v.entretien_prochain_km ? `${v.entretien_prochain_km.toLocaleString("fr-FR")} km${reste !== null ? ` <span class="${reste < 0 ? "tendance-bas" : reste <= 1000 ? "" : "gris"}" style="font-weight:500">(${reste < 0 ? `dépassé de ${Math.abs(reste).toLocaleString("fr-FR")}` : `dans ${reste.toLocaleString("fr-FR")}`} km)</span>` : ""}` : `<span class="gris">—</span>`}${v.entretien_prochaine_date ? `<small style="display:block;margin-top:2px;font-weight:500" class="gris">ou avant le ${dateFr(v.entretien_prochaine_date)}</small>` : ""}</strong></div></div>
        <div class="actions" style="margin:12px 0"><button class="btn btn-contour btn-petit" data-vact="entretien">${icone("plus")}Enregistrer un entretien</button></div>
        ${(v.entretiens ?? []).length ? `<ul class="historique">${(v.entretiens ?? []).map((e) => `<li><b style="color:var(--blanc)">${TYPES_ENTRETIEN[e.type] ?? echapper(e.type)}</b> <span class="gris">· ${dateFr(e.date)}${e.km != null ? ` · ${e.km.toLocaleString("fr-FR")} km` : ""}${e.cout ? ` · ${da(e.cout)}` : ""}</span>${e.note ? `<br><span class="gris">${echapper(e.note)}</span>` : ""}<small>${echapper(e.par ?? "")}${estAdmin() ? ` · <a href="#" data-vact="suppr-entretien" data-eid="${e.id}" style="text-decoration:underline">supprimer</a>` : ""}</small></li>`).join("")}</ul>` : `<p class="gris petit">Aucun entretien enregistré.</p>`}</section>

      <section class="section-tiroir"><h4>Dépenses du véhicule</h4>
        <div class="actions" style="margin:4px 0 12px"><button class="btn btn-contour btn-petit" data-vact="depense">${icone("plus")}Ajouter une dépense</button></div>
        ${listeDepenses(id)}</section>

      <section class="section-tiroir"><h4>Performances</h4><div class="paires">
        ${info("Prix par jour", da(v.prix_par_jour))}${info("Caution", da(v.caution))}
        ${info("Chiffre d'affaires", `${da(st.ca)} · ${pluriel(st.locations, "location")}`)}${info("Occupation (90 jours)", `${st.occupation} %`)}
        ${info("Dépenses totales", da(st.depenses))}
        ${estAdmin() ? info("Prix d'achat", v.prix_achat ? da(v.prix_achat) : "") : ""}
        ${estAdmin() && rentabilite !== null ? `<div class="paire large"><small>Rentabilité (CA − dépenses) / prix d'achat</small><strong style="color:${rentabilite >= 100 ? "var(--vert)" : "var(--blanc)"}">${rentabilite} %</strong><div class="suivi" style="width:100%"><i style="width:${Math.min(100, rentabilite)}%"></i></div></div>` : ""}</div></section>

      <section class="section-tiroir"><h4>États des lieux récents</h4>
        ${locationsAvecEtat(v).slice(0, 4).map((r) => `<div class="bloc-edl"><div class="bloc-edl-tete"><strong>${r.numero} · ${echapper(nomClient(r))}</strong><span class="gris petit">${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)}</span></div>${blocEtatLocation(r)}</div>`).join("") || `<p class="gris petit">Aucun état des lieux enregistré pour l'instant.</p>`}</section>

      <section class="section-tiroir"><h4>Réservations à venir (${avenir.length})</h4>
        ${avenir.length ? `<ul class="liste-taches" style="padding:0">${avenir.slice(0, 6).map((r) => tache(r, `${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)} · ${da(r.total)}`, badgeStatut(r.statut))).join("")}</ul>` : `<p class="gris petit">Aucune réservation à venir.</p>`}</section>

      <section class="section-tiroir"><h4>Actions</h4><div class="actions">
        <button class="btn btn-contour" data-vact="bloquer">${icone("blocage")}Bloquer des dates</button>
        ${estAdmin() ? `<button class="btn btn-contour" data-vact="modifier">${icone("editer")}Modifier la fiche</button>` : ""}</div></section>`,
  };
}

function ouvrirVehicule(id) {
  etat.vehiculeOuvert = id; etat.numeroOuvert = null; etat.dossierOuvert = null;
  ouvrirTiroir(() => rendreTiroirVehicule(id));
}

async function remplacerVoiture(voiture) {
  const i = etat.voitures.findIndex((x) => x.id === voiture.id);
  if (i >= 0) etat.voitures[i] = { ...etat.voitures[i], ...voiture }; else etat.voitures.push(voiture);
}

// ---------- Carnet d'entretien ----------
function ouvrirFormulaireEntretien(id) {
  const v = compteVoiture(id);
  const corps = ouvrirFenetre(`Entretien — ${v.marque} ${v.modele}`, `
    <form id="form-entretien" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="grille-form">
        <label>Type d'intervention<select name="type">${Object.entries(TYPES_ENTRETIEN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
        <label>Date<input type="date" name="date" value="${aujourdhui()}" required></label>
        <label>Kilométrage<input type="number" name="km" min="0" value="${v.kilometrage ?? ""}"></label>
        <label>Coût (DA)<input type="number" name="cout" min="0" step="100" value="0"></label>
        <label class="large" id="zone-expiration" hidden>Nouvelle date d'expiration<input type="date" name="nouvelle_expiration"></label>
        <label class="large">Note<input name="note" placeholder="Ex. : filtre à huile + filtre à air, garage Benali"></label>
        <label>Prochain entretien (km)<input type="number" name="prochain_km" min="0" value="${v.kilometrage != null ? v.kilometrage + 10000 : ""}"></label>
        <label>…ou avant le<input type="date" name="prochaine_date"></label>
      </div>
      ${bloquee(v) ? `<label class="case"><input type="checkbox" name="remettre_en_service" checked> Remettre le véhicule en service (état : disponible)</label>` : ""}
      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Enregistrer</button></div>
    </form>`, 620);
  const f = corps.querySelector("form");
  f.type.addEventListener("change", () => { f.querySelector("#zone-expiration").hidden = !["assurance", "controle_technique", "vignette"].includes(f.type.value); });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    try {
      const maj = await api("POST", `/voitures/${id}/entretiens`, { type: f.type.value, date: f.date.value, km: f.km.value, cout: f.cout.value, note: f.note.value, prochain_km: f.prochain_km.value,
        prochaine_date: f.prochaine_date.value, nouvelle_expiration: f.nouvelle_expiration.value, remettre_en_service: f.remettre_en_service?.checked });
      await remplacerVoiture(maj); await chargerDonnees(); fermerFenetre(); rafraichirVue(); notifier("Entretien enregistré ✓");
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}

// ---------- Fiche de saisie complète (administrateur) ----------
function ouvrirFormulaireVoiture(id) {
  const vide = { marque: "", modele: "", annee: new Date().getFullYear(), categorie: "Citadine", gamme: "Confort", prix_par_jour: 6000, caution: 60000, boite: "Manuelle", carburant: "Essence", places: 5, portes: 5, bagages: 3, equipements: [], description: "", disponible: true, etat: "disponible", etat_general: "excellent", emplacement: (etat.agence.lieux ?? [])[0] ?? "" };
  const v = id ? compteVoiture(id) : vide;
  const categories = [...new Set([...etat.voitures.map((x) => x.categorie), "Citadine", "Berline", "SUV", "7 places", "Électrique", "4x4", "Prestige", "Utilitaire"])];
  const champ = (nom, etiquette, valeur, extra = "") => `<label>${etiquette}<input name="${nom}" value="${echapper(valeur ?? "")}" ${extra}></label>`;
  const corps = ouvrirFenetre(id ? `Modifier ${v.marque} ${v.modele}` : "Ajouter un véhicule", `
    <form id="form-voiture" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="televerser"><img id="apercu-photo" src="${id ? urlPhoto(v) : "logo.jpg"}" alt="">
        <div><label>Photo du véhicule<input type="file" id="fichier-photo" accept="image/jpeg,image/png,image/webp"></label><p class="aide-petit" style="margin-top:6px">JPG, PNG ou WebP · 6 Mo maximum · format paysage de préférence.</p></div></div>

      <h4 class="titre-groupe">Identification</h4>
      <div class="grille-form trois">
        ${champ("marque", "Marque *", v.marque, "required")}${champ("modele", "Modèle *", v.modele, "required")}
        <label>Année<input name="annee" type="number" min="1990" max="${new Date().getFullYear() + 1}" value="${v.annee}"></label>
        ${champ("immatriculation", "Immatriculation", v.immatriculation, 'placeholder="12345 124 16"')}${champ("vin", "N° de châssis (VIN)", v.vin)}${champ("couleur", "Couleur", v.couleur)}
        <label>Mise en circulation<input name="date_mise_en_circulation" type="date" value="${v.date_mise_en_circulation ?? ""}"></label>
      </div>

      <h4 class="titre-groupe">Gamme et caractéristiques</h4>
      <div class="grille-form trois">
        <label>Gamme<select name="gamme">${GAMMES.map((g) => `<option ${g === (v.gamme ?? "Confort") ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <label>Catégorie<input name="categorie" list="liste-categories" value="${echapper(v.categorie)}"><datalist id="liste-categories">${categories.map((c) => `<option value="${echapper(c)}">`).join("")}</datalist></label>
        <label>Boîte<select name="boite"><option ${v.boite === "Manuelle" ? "selected" : ""}>Manuelle</option><option ${v.boite === "Automatique" ? "selected" : ""}>Automatique</option></select></label>
        <label>Carburant<select name="carburant">${["Essence", "Diesel", "Hybride", "Électrique", "GPL"].map((c) => `<option ${c === v.carburant ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label>Places<input name="places" type="number" min="1" max="20" value="${v.places}"></label>
        <label>Portes<input name="portes" type="number" min="2" max="6" value="${v.portes ?? 5}"></label>
        <label>Valises<input name="bagages" type="number" min="0" max="20" value="${v.bagages ?? 2}"></label>
        <label>Autonomie (électrique, km)<input name="autonomie_km" type="number" min="0" value="${v.autonomie_km ?? ""}"></label>
        <label class="large">Description (visible sur le site)<input name="description" value="${echapper(v.description ?? "")}" maxlength="400"></label>
        <label class="large">Équipements <small>(séparés par des virgules)</small><input name="equipements" value="${echapper((v.equipements ?? []).join(", "))}" placeholder="Climatisation, Bluetooth, Caméra de recul"></label>
      </div>

      <h4 class="titre-groupe">Tarifs</h4>
      <div class="grille-form"><label>Prix par jour (DA)<input name="prix_par_jour" type="number" min="500" step="500" value="${v.prix_par_jour}"></label><label>Caution (DA)<input name="caution" type="number" min="0" step="5000" value="${v.caution}"></label></div>

      <h4 class="titre-groupe">État et emplacement</h4>
      <div class="grille-form trois">
        <label>État<select name="etat">${Object.entries(ETATS).map(([k, e]) => `<option value="${k}" ${k === (v.etat ?? "disponible") ? "selected" : ""}>${e.nom}</option>`).join("")}</select></label>
        <label>État général<select name="etat_general">${Object.entries(ETATS_GENERAUX).map(([k, n]) => `<option value="${k}" ${k === (v.etat_general ?? "bon") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        ${champ("kilometrage", "Kilométrage", v.kilometrage, 'type="number" min="0"')}
        <label>Emplacement<input name="emplacement" list="liste-emplacements" value="${echapper(v.emplacement ?? "")}"><datalist id="liste-emplacements">${emplacementsPossibles().map((e) => `<option value="${echapper(e)}">`).join("")}</datalist></label>
        ${champ("emplacement_detail", "Place / détail", v.emplacement_detail)}
        <label class="case" style="padding-top:22px"><input type="checkbox" name="disponible" ${v.disponible ? "checked" : ""}> Proposé sur le site</label>
      </div>

      <h4 class="titre-groupe">Documents</h4>
      <div class="grille-form trois">
        ${champ("assurance_compagnie", "Compagnie d'assurance", v.assurance_compagnie)}${champ("assurance_police", "N° de police", v.assurance_police)}
        <label>Assurance expire le<input name="assurance_expiration" type="date" value="${v.assurance_expiration ?? ""}"></label>
        <label>Contrôle technique expire le<input name="controle_technique_expiration" type="date" value="${v.controle_technique_expiration ?? ""}"></label>
        <label>Vignette expire le<input name="vignette_expiration" type="date" value="${v.vignette_expiration ?? ""}"></label>
      </div>

      <h4 class="titre-groupe">Entretien et achat</h4>
      <div class="grille-form trois">
        ${champ("entretien_prochain_km", "Prochain entretien (km)", v.entretien_prochain_km, 'type="number" min="0"')}
        <label>…ou avant le<input name="entretien_prochaine_date" type="date" value="${v.entretien_prochaine_date ?? ""}"></label><span></span>
        ${champ("prix_achat", "Prix d'achat (DA)", v.prix_achat, 'type="number" min="0" step="10000"')}
        <label>Date d'achat<input name="date_achat" type="date" value="${v.date_achat ?? ""}"></label>
      </div>
      <label>Notes internes<textarea name="notes" rows="2">${echapper(v.notes ?? "")}</textarea></label>

      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied">
        ${id ? `<button type="button" class="btn btn-danger" data-supprimer-voiture style="margin-inline-end:auto">${icone("corbeille")}Supprimer</button>` : ""}
        <button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Enregistrer</button></div>
    </form>`, 900);
  const f = corps.querySelector("form");
  let photo = null;
  $("#fichier-photo").addEventListener("change", (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    if (fichier.size > 6 * 1024 * 1024) { notifier("Cette photo dépasse 6 Mo.", "erreur"); e.target.value = ""; return; }
    const lecteur = new FileReader();
    lecteur.onload = () => { $("#apercu-photo").src = lecteur.result; photo = String(lecteur.result).split(",")[1]; };
    lecteur.readAsDataURL(fichier);
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    const donnees = Object.fromEntries([...new FormData(f)].filter(([k, x]) => typeof x === "string" && k !== "disponible").map(([k, x]) => [k, x.trim()]));
    donnees.equipements = (donnees.equipements ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    donnees.disponible = f.disponible.checked;
    const bouton = f.querySelector("[type=submit]"); bouton.disabled = true;
    try {
      let enregistre = id ? await api("PUT", `/voitures/${id}`, donnees) : await api("POST", "/voitures", donnees);
      if (photo) enregistre = await api("POST", `/voitures/${enregistre.id}/photo`, { contenu: photo });
      await remplacerVoiture(enregistre);
      fermerFenetre(); rafraichirVue(); notifier(id ? "Véhicule modifié ✓" : "Véhicule ajouté ✓");
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; bouton.disabled = false; }
  });
  corps.querySelector("[data-supprimer-voiture]")?.addEventListener("click", async () => {
    if (!(await confirmer(`Supprimer définitivement <b>${echapper(v.marque)} ${echapper(v.modele)}</b> ? Pour le retirer temporairement de la location, passez-le plutôt en « maintenance » ou « hors ligne ».`, "Supprimer", true))) return;
    try {
      await api("DELETE", `/voitures/${id}`);
      etat.voitures = etat.voitures.filter((x) => x.id !== id);
      fermerFenetre(); fermerTiroir(); rafraichirVue(); notifier("Véhicule supprimé");
    } catch (err) { notifier(err.message, "erreur"); }
  });
}

// ---------- Événements ----------
document.addEventListener("click", async (e) => {
  // actions dans la fiche d'un véhicule
  const comp = e.target.closest("#tiroir [data-comparer]");
  if (comp) return ouvrirComparaison(etat.reservations.find((x) => x.numero === comp.dataset.comparer));
  const act = e.target.closest("[data-vact]");
  if (act && etat.vehiculeOuvert && !$("#tiroir").hidden) {
    e.preventDefault();
    const id = etat.vehiculeOuvert, v = compteVoiture(id), a = act.dataset.vact;
    if (a === "bloquer") return ouvrirFormulaireBlocage(id);
    if (a === "modifier") return ouvrirFormulaireVoiture(id);
    if (a === "entretien") return ouvrirFormulaireEntretien(id);
    if (a === "depense") return ouvrirFormulaireDepense(id);
    if (a === "suppr-entretien") {
      if (!(await confirmer("Supprimer cette ligne du carnet d'entretien ?", "Supprimer", true))) return;
      return agir(null, async () => { await remplacerVoiture(await api("DELETE", `/voitures/${id}/entretiens/${act.dataset.eid}`)); await chargerDonnees(); rafraichirVue(); }, "Ligne supprimée");
    }
    if (a === "sauver") {
      const nouvelEtat = $("#vh-etat").value;
      return agir(act, async () => {
        const maj = await api("PATCH", `/voitures/${id}`, { etat: nouvelEtat, etat_general: $("#vh-general").value, emplacement: $("#vh-emplacement").value, emplacement_detail: $("#vh-detail").value,
          kilometrage: $("#vh-km").value, notes: $("#vh-notes").value, disponible: $("#vh-enligne").checked });
        await remplacerVoiture(maj); rafraichirVue();
        if (ETATS_BLOQUANTS.includes(nouvelEtat) && reservationsAVenir(maj).length) notifier(`⚠️ ${pluriel(reservationsAVenir(maj).length, "réservation")} à venir sur ce véhicule : pensez à les réaffecter.`, "erreur", 9000);
      }, `${v.marque} ${v.modele} : fiche mise à jour ✓`);
    }
  }
  if (routeActuelle().vue !== "vehicules" || !$("#contenu").contains(e.target)) return;
  const f = filtreVehicules;
  const st = e.target.closest("[data-vehicule-statut]");
  if (st) { f.statut = st.dataset.vehiculeStatut; return rendreVehicules($("#contenu")); }
  const vue = e.target.closest("[data-vue-vehicules]");
  if (vue) { f.vue = vue.dataset.vueVehicules; return rendreVehicules($("#contenu")); }
  if (e.target.closest("[data-ajouter-voiture]")) return ouvrirFormulaireVoiture();
  const blo = e.target.closest("[data-bloquer-v]");
  if (blo) return ouvrirFormulaireBlocage(blo.dataset.bloquerV);
  const comparer = e.target.closest("[data-comparer]");
  if (comparer) return ouvrirComparaison(etat.reservations.find((x) => x.numero === comparer.dataset.comparer));
  if (e.target.closest(".interrupteur, [data-en-ligne], .vignette, .etat-cols")) return;
  const carte = e.target.closest("[data-vehicule]");
  if (carte) ouvrirVehicule(carte.dataset.vehicule);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.(".voiture[data-vehicule]")) ouvrirVehicule(e.target.dataset.vehicule);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "vehicule-recherche") { filtreVehicules.texte = e.target.value; const p = e.target.selectionStart; rendreVehicules($("#contenu")); const c = $("#vehicule-recherche"); c.focus(); c.setSelectionRange(p, p); }
});
document.addEventListener("change", async (e) => {
  const map = { "v-gamme": "gamme", "v-categorie": "categorie", "v-emplacement": "emplacement" };
  if (map[e.target.id]) { filtreVehicules[map[e.target.id]] = e.target.value; return rendreVehicules($("#contenu")); }
  const interrupteur = e.target.closest?.("[data-en-ligne]");
  if (!interrupteur) return;
  const v = compteVoiture(interrupteur.dataset.enLigne);
  try {
    await remplacerVoiture(await api("PATCH", `/voitures/${v.id}`, { disponible: interrupteur.checked }));
    notifier(`${v.marque} ${v.modele} : ${interrupteur.checked ? "remis en ligne ✓" : "retiré du site"}`);
  } catch (err) { notifier(err.message, "erreur"); }
  rafraichirVue();
});
