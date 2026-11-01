/* ═══════════════════════════════════════════════════════════════
   ÉTATS DES LIEUX : tous les relevés et photos, avant la prise et après le retour
   La file « à faire » en haut, puis la galerie de toute la flotte (avec comparaison avant / après).
   ═══════════════════════════════════════════════════════════════ */
const filtreEtats = { statut: "tous", voiture: "", texte: "", periode: "90", visibles: 18 };

// Ce qu'il faut relever maintenant : les départs d'aujourd'hui et de demain, et les retours attendus ou en retard
function releves_a_faire() {
  const auj = aujourdhui(), demain = ajouterJours(auj, 1);
  return {
    departs: etat.reservations.filter((r) => r.statut === "confirmée" && !r.etat_depart && r.date_debut <= demain).sort((a, b) => a.date_debut.localeCompare(b.date_debut)),
    retours: etat.reservations.filter((r) => r.statut === "en cours" && !r.etat_retour && r.date_fin <= auj).sort((a, b) => a.date_fin.localeCompare(b.date_fin)),
  };
}

function locationsEtats() {
  const limite = filtreEtats.periode === "tout" ? "0000-01-01" : ajouterJours(aujourdhui(), -Number(filtreEtats.periode));
  const texte = normaliser(filtreEtats.texte);
  const test = {
    tous: () => true,
    dommage: (r) => r.etat_depart?.dommages || r.etat_retour?.dommages,
    complet: (r) => r.etat_depart && r.etat_retour,
    incomplet: (r) => !(r.etat_depart && r.etat_retour),
  }[filtreEtats.statut];
  return etat.reservations
    .filter((r) => estReservation(r) && (r.etat_depart || r.etat_retour) && r.date_debut >= limite && (!filtreEtats.voiture || r.voiture_id === filtreEtats.voiture)
      && (!texte || normaliser(`${r.numero} ${nomClient(r)} ${r.voiture}`).includes(texte)) && test(r))
    .sort((a, b) => b.date_debut.localeCompare(a.date_debut));
}

function carteLocationEtat(r) {
  const v = compteVoiture(r.voiture_id);
  const dommage = r.etat_depart?.dommages || r.etat_retour?.dommages;
  const parcourus = r.etat_depart?.km != null && r.etat_retour?.km != null ? r.etat_retour.km - r.etat_depart.km : null;
  return `<article class="carte etat-carte ${dommage ? "avec-dommage" : ""}">
    <div class="etat-carte-tete" data-res="${r.numero}" tabindex="0">
      <img class="mini-photo" src="${urlPhoto(v)}" alt="" loading="lazy">
      <div class="cellule-principale" style="min-width:0;flex:1"><strong>${echapper(r.voiture)}</strong><span>${echapper(nomClient(r))} · <span class="mono">${r.numero}</span></span></div>
      <div class="etat-carte-dates mono">${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)}</div>
    </div>
    ${blocEtatLocation(r)}
    <div class="etat-carte-pied">
      ${badgeStatut(r.statut)}
      ${parcourus !== null ? `<span class="gris petit mono">${parcourus.toLocaleString("fr-FR")} km</span>` : ""}
      ${dommage ? badge("badge-annulee", "dommage signalé", "alerte") : ""}
    </div></article>`;
}

function ligneAFaire(r, moment) {
  const urgent = moment === "depart" ? r.date_debut <= aujourdhui() : r.date_fin < aujourdhui();
  const quand = moment === "depart" ? (r.date_debut <= aujourdhui() ? "aujourd'hui" : "demain") : (r.date_fin < aujourdhui() ? `en retard · ${dateCourte(r.date_fin)}` : "aujourd'hui");
  return `<li class="tache" tabindex="0"><div class="tache-info" data-res="${r.numero}"><strong>${echapper(r.voiture)} · ${echapper(nomClient(r))}</strong><span>${quand} · ${echapper(moment === "depart" ? r.lieu_depart : r.lieu_retour)}</span></div>
    <button type="button" class="btn btn-petit ${urgent ? "btn-rouge" : "btn-contour"}" data-edl-rapide="${r.numero}:${moment}">${icone("camera")}Relever</button></li>`;
}

function rendreEtats(conteneur) {
  const { departs, retours } = releves_a_faire();
  const liste = locationsEtats();
  const tous = etat.reservations.filter((r) => estReservation(r) && (r.etat_depart || r.etat_retour));
  const il30 = ajouterJours(aujourdhui(), -30);
  const dommages = tous.filter((r) => (r.etat_depart?.dommages || r.etat_retour?.dommages) && r.date_debut >= il30).length;
  const photos = tous.reduce((s, r) => s + (r.etat_depart?.photos?.length ?? 0) + (r.etat_retour?.photos?.length ?? 0), 0);
  const complets = tous.filter((r) => r.etat_depart && r.etat_retour).length;
  const compte = (k) => k === "tous" ? tous.length : tous.filter({ dommage: (r) => r.etat_depart?.dommages || r.etat_retour?.dommages, complet: (r) => r.etat_depart && r.etat_retour, incomplet: (r) => !(r.etat_depart && r.etat_retour) }[k]).length;
  const urgents = departs.length + retours.length;
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>États des lieux</h2><p>Les relevés et les photos avant la prise et après le retour, pour tous les véhicules.</p></div></div>
    <div class="indicateurs">
      <div class="carte indicateur"><span>À relever</span><strong>${urgents}</strong><em>${urgents ? "départs et retours sans relevé" : "tout est relevé ✓"}</em></div>
      <div class="carte indicateur"><span>Locations suivies</span><strong>${tous.length}</strong><em>${complets} avec départ et retour</em></div>
      <div class="carte indicateur"><span>Dommages (30 jours)</span><strong class="${dommages ? "tendance-bas" : ""}">${dommages}</strong><em>${dommages ? "à vérifier avec les clients" : "aucun dommage signalé"}</em></div>
      <div class="carte indicateur"><span>Photos enregistrées</span><strong>${photos.toLocaleString("fr-FR")}</strong><em>conservées pour chaque litige</em></div>
    </div>
    ${urgents ? `<div class="grille-3" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <section class="carte"><div class="carte-titre"><h3>Départs à relever</h3><small>${departs.length}</small></div>${departs.length ? `<ul class="liste-taches">${departs.map((r) => ligneAFaire(r, "depart")).join("")}</ul>` : `<p class="vide-liste">Aucun départ sans relevé.</p>`}</section>
      <section class="carte"><div class="carte-titre"><h3>Retours à relever</h3><small>${retours.length}</small></div>${retours.length ? `<ul class="liste-taches">${retours.map((r) => ligneAFaire(r, "retour")).join("")}</ul>` : `<p class="vide-liste">Aucun retour sans relevé.</p>`}</section>
    </div>` : ""}
    <div class="barre-filtres">
      <input type="search" id="etats-recherche" placeholder="Rechercher un client, un n°, un véhicule…" value="${echapper(filtreEtats.texte)}">
      <select id="etats-voiture" aria-label="Véhicule"><option value="">Tous les véhicules</option>${etat.voitures.map((v) => `<option value="${v.id}" ${v.id === filtreEtats.voiture ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select>
      <select id="etats-periode" aria-label="Période">${[["30", "30 derniers jours"], ["90", "90 derniers jours"], ["365", "12 derniers mois"], ["tout", "Tout l'historique"]].map(([k, n]) => `<option value="${k}" ${k === filtreEtats.periode ? "selected" : ""}>${n}</option>`).join("")}</select>
    </div>
    <div class="barre-filtres"><div class="puces">${[["tous", "Tous"], ["dommage", "⚠ Avec dommage"], ["complet", "Départ et retour"], ["incomplet", "Incomplets"]].map(([k, n]) => `<button class="puce ${filtreEtats.statut === k ? "actif" : ""}" data-etats-statut="${k}">${n} <b>${compte(k)}</b></button>`).join("")}</div></div>
    ${liste.length ? `<div class="grille-etats">${liste.slice(0, filtreEtats.visibles).map(carteLocationEtat).join("")}</div>
      ${liste.length > filtreEtats.visibles ? `<div style="text-align:center;margin-top:18px"><button class="btn btn-contour" data-etats-plus>Afficher plus (${liste.length - filtreEtats.visibles})</button></div>` : ""}`
      : `<div class="carte vide-grand"><strong>Aucun état des lieux</strong>Les relevés apparaissent ici dès qu'un départ ou un retour est enregistré avec ses photos.</div>`}`;
}
enregistrerVue("etats", { titre: "États des lieux", icone: "camera", rendre: rendreEtats });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "etats" || !$("#contenu").contains(e.target)) return;
  const puce = e.target.closest("[data-etats-statut]");
  if (puce) { filtreEtats.statut = puce.dataset.etatsStatut; filtreEtats.visibles = 18; return rendreEtats($("#contenu")); }
  if (e.target.closest("[data-etats-plus]")) { filtreEtats.visibles += 18; return rendreEtats($("#contenu")); }
  const rapide = e.target.closest("[data-edl-rapide]");
  if (rapide) {
    const [numero, moment] = rapide.dataset.edlRapide.split(":");
    faireEtatDesLieux(etat.reservations.find((x) => x.numero === numero), moment, rapide);
  }
});
document.addEventListener("change", (e) => {
  if (routeActuelle().vue !== "etats") return;
  const map = { "etats-voiture": "voiture", "etats-periode": "periode" };
  if (map[e.target.id]) { filtreEtats[map[e.target.id]] = e.target.value; filtreEtats.visibles = 18; rendreEtats($("#contenu")); }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "etats-recherche") return;
  filtreEtats.texte = e.target.value;
  const p = e.target.selectionStart;
  rendreEtats($("#contenu"));
  const c = $("#etats-recherche"); c.focus(); c.setSelectionRange(p, p);
});
