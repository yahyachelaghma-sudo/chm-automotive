/* ═══════════════════════════════════════════════════════════════
   ENTRETIEN & DOCUMENTS : échéances de toute la flotte (assurance, contrôle technique, vignette, révision)
   et carnet d'entretien global avec les coûts.
   ═══════════════════════════════════════════════════════════════ */
const filtreEntretien = { type: "tous", voiture: "", visibles: 20 };

const DOCUMENTS_FLOTTE = [["assurance_expiration", "Assurance"], ["controle_technique_expiration", "Contrôle technique"], ["vignette_expiration", "Vignette"]];

// Toutes les échéances de la flotte, de la plus urgente à la plus lointaine
function echeancesFlotte() {
  const liste = [];
  for (const v of etat.voitures) {
    for (const [champ, nom] of DOCUMENTS_FLOTTE) {
      const j = joursRestants(v[champ]);
      if (j === null) { if (champ === "assurance_expiration") liste.push({ v, nom, jours: -9999, date: "", manquant: true }); continue; }
      liste.push({ v, nom, jours: j, date: v[champ] });
    }
    const jd = joursRestants(v.entretien_prochaine_date);
    if (jd !== null) liste.push({ v, nom: "Entretien prévu", jours: jd, date: v.entretien_prochaine_date });
    if (v.entretien_prochain_km && v.kilometrage != null) {
      const restant = v.entretien_prochain_km - v.kilometrage;
      if (restant <= 2000) liste.push({ v, nom: "Entretien au kilométrage", jours: restant < 0 ? -1 : 15, date: "", km: restant });
    }
  }
  return liste.sort((a, b) => a.jours - b.jours);
}

function classeEcheance(e) {
  if (e.manquant || e.jours < 0) return { cls: "badge-annulee", icone: "alerte" };
  return e.jours <= 30 ? { cls: "badge-alerte", icone: "horloge" } : { cls: "badge-valide", icone: "check" };
}
function texteEcheance(e) {
  if (e.manquant) return "non renseignée";
  if (e.km !== undefined) return e.km < 0 ? `dépassé de ${Math.abs(e.km).toLocaleString("fr-FR")} km` : `dans ${e.km.toLocaleString("fr-FR")} km`;
  return e.jours < 0 ? `expirée depuis ${pluriel(-e.jours, "jour")}` : e.jours === 0 ? "aujourd'hui" : `dans ${pluriel(e.jours, "jour")}`;
}

function toutesInterventions() {
  return etat.voitures.flatMap((v) => (v.entretiens ?? []).map((e) => ({ ...e, v }))).sort((a, b) => b.date.localeCompare(a.date));
}

function rendreEntretien(conteneur) {
  const echeances = echeancesFlotte();
  const urgentes = echeances.filter((e) => e.manquant || e.jours <= 30);
  const expirees = echeances.filter((e) => e.manquant || e.jours < 0).length;
  const interventions = toutesInterventions();
  const an = String(new Date().getFullYear());
  const coutAnnee = interventions.filter((e) => e.date.startsWith(an)).reduce((s, e) => s + (e.cout || 0), 0);
  const enAtelier = etat.voitures.filter((v) => ["maintenance", "reparation"].includes(v.etat));
  const liste = interventions.filter((e) => (filtreEntretien.type === "tous" || e.type === filtreEntretien.type) && (!filtreEntretien.voiture || e.v.id === filtreEntretien.voiture));
  const types = [...new Set(interventions.map((e) => e.type))];
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Entretien &amp; documents</h2><p>Échéances de toute la flotte et historique des interventions, pour ne jamais rouler avec un document expiré.</p></div></div>
    <div class="indicateurs">
      <div class="carte indicateur"><span>Échéances à traiter</span><strong class="${urgentes.length ? "tendance-bas" : ""}">${urgentes.length}</strong><em>${urgentes.length ? "dans les 30 jours ou dépassées" : "tout est à jour ✓"}</em></div>
      <div class="carte indicateur"><span>Documents expirés</span><strong class="${expirees ? "tendance-bas" : ""}">${expirees}</strong><em>${expirees ? "à renouveler en priorité" : "aucun document expiré ✓"}</em></div>
      <div class="carte indicateur"><span>Au garage</span><strong>${enAtelier.length}</strong><em>${enAtelier.length ? enAtelier.map((v) => `${echapper(v.marque)} ${echapper(v.modele)}`).join(", ") : "aucun véhicule immobilisé"}</em></div>
      <div class="carte indicateur"><span>Coût d'entretien ${an}</span><strong>${da(coutAnnee)}</strong><em>${pluriel(interventions.filter((e) => e.date.startsWith(an)).length, "intervention")}</em></div>
    </div>
    <section class="carte" style="margin-bottom:14px"><div class="carte-titre"><h3>Échéances à venir</h3><small>${echeances.length}</small></div>
      ${echeances.length ? `<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Véhicule</th><th>Document / entretien</th><th>Échéance</th><th>Situation</th><th></th></tr></thead><tbody>
        ${echeances.slice(0, 40).map((e) => { const c = classeEcheance(e); return `<tr>
          <td data-label="Véhicule"><div class="cellule-vehicule"><img class="mini-photo" src="${urlPhoto(e.v)}" alt="" loading="lazy"><div class="cellule-principale"><strong>${echapper(e.v.marque)} ${echapper(e.v.modele)}</strong><span>${e.v.immatriculation ? ltr(e.v.immatriculation) : echapper(e.v.categorie ?? "")}</span></div></div></td>
          <td data-label="Document">${e.nom}</td>
          <td data-label="Échéance" class="mono">${e.date ? dateFr(e.date) : e.km !== undefined ? `${e.v.entretien_prochain_km.toLocaleString("fr-FR")} km` : "—"}</td>
          <td data-label="Situation">${badge(c.cls, texteEcheance(e), c.icone)}</td>
          <td class="actions-ligne"><button type="button" class="btn btn-petit btn-contour" data-entretien-ajouter="${e.v.id}">${icone("entretien")}Enregistrer</button></td></tr>`; }).join("")}
      </tbody></table></div>` : `<p class="vide-liste">Aucune échéance enregistrée. Renseignez l'assurance, le contrôle technique et la vignette dans la fiche de chaque véhicule.</p>`}
    </section>
    <section class="carte"><div class="carte-titre"><h3>Historique des interventions</h3><small>${liste.length}</small></div>
      <div class="barre-filtres" style="padding:0 18px">
        <select id="entretien-voiture" aria-label="Véhicule"><option value="">Tous les véhicules</option>${etat.voitures.map((v) => `<option value="${v.id}" ${v.id === filtreEntretien.voiture ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select>
        <select id="entretien-type" aria-label="Type"><option value="tous">Tous les types</option>${types.map((t) => `<option value="${t}" ${t === filtreEntretien.type ? "selected" : ""}>${TYPES_ENTRETIEN[t] ?? t}</option>`).join("")}</select>
        <button type="button" class="btn btn-rouge" data-entretien-ajouter="" style="margin-inline-start:auto">${icone("plus")}Nouvelle intervention</button>
      </div>
      ${liste.length ? `<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Date</th><th>Véhicule</th><th>Intervention</th><th>Km</th><th>Coût</th><th>Note</th></tr></thead><tbody>
        ${liste.slice(0, filtreEntretien.visibles).map((e) => `<tr>
          <td data-label="Date" class="mono">${dateFr(e.date)}</td>
          <td data-label="Véhicule"><strong>${echapper(e.v.marque)} ${echapper(e.v.modele)}</strong></td>
          <td data-label="Intervention">${TYPES_ENTRETIEN[e.type] ?? e.type}</td>
          <td data-label="Km" class="mono">${e.km != null ? e.km.toLocaleString("fr-FR") : "—"}</td>
          <td data-label="Coût" class="mono">${e.cout ? da(e.cout) : "—"}</td>
          <td data-label="Note" class="gris">${echapper(e.note || "")}</td></tr>`).join("")}</tbody></table></div>
        ${liste.length > filtreEntretien.visibles ? `<div style="text-align:center;padding:14px"><button class="btn btn-contour" data-entretien-plus>Afficher plus (${liste.length - filtreEntretien.visibles})</button></div>` : ""}`
        : `<p class="vide-liste">Aucune intervention enregistrée.</p>`}
    </section>`;
}
enregistrerVue("entretien", { titre: "Entretien", icone: "entretien", rendre: rendreEntretien });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "entretien" || !$("#contenu").contains(e.target)) return;
  if (e.target.closest("[data-entretien-plus]")) { filtreEntretien.visibles += 20; return rendreEntretien($("#contenu")); }
  const ajout = e.target.closest("[data-entretien-ajouter]");
  if (!ajout) return;
  const id = ajout.dataset.entretienAjouter;
  if (id) return ouvrirFormulaireEntretien(id);
  const corps = ouvrirFenetre("Pour quel véhicule ?", `<label>Véhicule<select id="choix-vehicule-entretien">${etat.voitures.map((v) => `<option value="${v.id}">${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select></label>
    <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button type="button" class="btn btn-rouge" id="valider-vehicule-entretien">Continuer</button></div>`, 440);
  corps.querySelector("#valider-vehicule-entretien").onclick = () => { const choisi = corps.querySelector("select").value; fermerFenetre(); ouvrirFormulaireEntretien(choisi); };
});
document.addEventListener("change", (e) => {
  if (routeActuelle().vue !== "entretien") return;
  if (e.target.id === "entretien-voiture") { filtreEntretien.voiture = e.target.value; filtreEntretien.visibles = 20; rendreEntretien($("#contenu")); }
  if (e.target.id === "entretien-type") { filtreEntretien.type = e.target.value; filtreEntretien.visibles = 20; rendreEntretien($("#contenu")); }
});
