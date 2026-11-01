/* ═══════════════════════════════════════════════════════════════
   CONTRATS : suivi des signatures, impression
   Un contrat se signe avant la remise des clés : la liste du haut montre ceux qui manquent.
   ═══════════════════════════════════════════════════════════════ */
const filtreContrats = { statut: "a_signer", texte: "", visibles: 25 };

const contratsActifs = () => etat.reservations.filter((r) => estReservation(r) && ["confirmée", "en cours", "terminée"].includes(r.statut));
// À signer : confirmées ou en cours, dont le départ approche (ou est passé) et sans signature
const contratsASigner = () => contratsActifs().filter((r) => !r.contrat_signe && r.statut !== "terminée" && r.date_debut <= ajouterJours(aujourdhui(), 2))
  .sort((a, b) => a.date_debut.localeCompare(b.date_debut));

function contratsFiltres() {
  const texte = normaliser(filtreContrats.texte);
  const test = { a_signer: (r) => !r.contrat_signe && r.statut !== "terminée", signes: (r) => r.contrat_signe, tous: () => true }[filtreContrats.statut];
  return contratsActifs().filter((r) => test(r) && (!texte || normaliser(`${r.numero} ${nomClient(r)} ${r.voiture}`).includes(texte)))
    .sort((a, b) => (filtreContrats.statut === "signes" ? b.date_debut.localeCompare(a.date_debut) : a.date_debut.localeCompare(b.date_debut)));
}

const badgeSignature = (r) => r.contrat_signe
  ? badge("badge-valide", `Signé${r.contrat_signe_le ? ` le ${dateFr(r.contrat_signe_le.slice(0, 10))}` : ""}`, "check")
  : (r.statut === "en cours" || r.date_debut <= aujourdhui()) ? badge("badge-annulee", "Non signé", "alerte") : badge("badge-attente", "À signer", "horloge");

function ligneContrat(r) {
  return `<tr data-res="${r.numero}">
    <td data-label="Contrat"><span class="mono">${r.numero}</span></td>
    <td data-label="Client"><div class="cellule-principale"><strong>${echapper(nomClient(r))}</strong><span>${ltr(r.client?.telephone ?? "")}</span></div></td>
    <td data-label="Véhicule">${echapper(r.voiture)}</td>
    <td data-label="Période" class="mono">${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)}</td>
    <td data-label="Statut">${badgeStatut(r.statut)}</td>
    <td data-label="Signature">${badgeSignature(r)}</td>
    <td class="actions-ligne">
      <a class="btn btn-petit btn-contour" href="contrat.html?n=${r.numero}" target="_blank" rel="noopener" data-stop title="Imprimer le contrat" aria-label="Imprimer le contrat">${icone("imprimer")}</a>
      <button type="button" class="btn btn-petit ${r.contrat_signe ? "btn-contour" : "btn-vert"}" data-signer="${r.numero}:${r.contrat_signe ? "non" : "oui"}">${r.contrat_signe ? "Retirer" : "Marquer signé"}</button>
    </td></tr>`;
}

function rendreContrats(conteneur) {
  const actifs = contratsActifs(), manquants = contratsASigner();
  const signes = actifs.filter((r) => r.contrat_signe).length;
  const encours = actifs.filter((r) => r.statut === "en cours");
  const horsContrat = encours.filter((r) => !r.contrat_signe);
  const taux = actifs.length ? Math.round((signes / actifs.length) * 100) : 100;
  const liste = contratsFiltres();
  const compte = { a_signer: actifs.filter((r) => !r.contrat_signe && r.statut !== "terminée").length, signes, tous: actifs.length };
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Contrats</h2><p>Suivi des signatures : aucune clé ne devrait partir sans contrat signé.</p></div></div>
    <div class="indicateurs">
      <div class="carte indicateur"><span>À signer bientôt</span><strong class="${manquants.length ? "tendance-bas" : ""}">${manquants.length}</strong><em>${manquants.length ? "départ dans 2 jours ou déjà passé" : "rien en attente ✓"}</em></div>
      <div class="carte indicateur"><span>Locations en cours</span><strong>${encours.length}</strong><em>${horsContrat.length ? `${horsContrat.length} sans contrat signé` : "tous les contrats sont signés ✓"}</em></div>
      <div class="carte indicateur"><span>Contrats signés</span><strong>${signes}</strong><em>sur ${actifs.length} locations</em></div>
      <div class="carte indicateur"><span>Taux de signature</span><strong>${taux} %</strong><em>des locations confirmées</em></div>
    </div>
    <div class="barre-filtres">
      <input type="search" id="contrats-recherche" placeholder="Rechercher un client, un n°, un véhicule…" value="${echapper(filtreContrats.texte)}">
      <div class="puces">${[["a_signer", "À signer"], ["signes", "Signés"], ["tous", "Tous"]].map(([k, n]) => `<button class="puce ${filtreContrats.statut === k ? "actif" : ""}" data-contrats-statut="${k}">${n} <b>${compte[k]}</b></button>`).join("")}</div>
    </div>
    ${liste.length ? `<div class="carte tableau-conteneur"><table class="tableau"><thead><tr><th>Contrat</th><th>Client</th><th>Véhicule</th><th>Période</th><th>Statut</th><th>Signature</th><th></th></tr></thead>
      <tbody>${liste.slice(0, filtreContrats.visibles).map(ligneContrat).join("")}</tbody></table></div>
      ${liste.length > filtreContrats.visibles ? `<div style="text-align:center;margin-top:18px"><button class="btn btn-contour" data-contrats-plus>Afficher plus (${liste.length - filtreContrats.visibles})</button></div>` : ""}`
      : `<div class="carte vide-grand"><strong>${filtreContrats.statut === "a_signer" ? "Tous les contrats sont signés" : "Aucun contrat"}</strong>${filtreContrats.statut === "a_signer" ? "Rien à faire pour l'instant." : "Aucun contrat ne correspond à la recherche."}</div>`}`;
}
enregistrerVue("contrats", { titre: "Contrats", icone: "contrat", rendre: rendreContrats });

document.addEventListener("click", async (e) => {
  if (routeActuelle().vue !== "contrats" || !$("#contenu").contains(e.target)) return;
  const puce = e.target.closest("[data-contrats-statut]");
  if (puce) { filtreContrats.statut = puce.dataset.contratsStatut; filtreContrats.visibles = 25; return rendreContrats($("#contenu")); }
  if (e.target.closest("[data-contrats-plus]")) { filtreContrats.visibles += 25; return rendreContrats($("#contenu")); }
  const signer = e.target.closest("[data-signer]");
  if (signer) {
    const [numero, oui] = signer.dataset.signer.split(":");
    await agir(signer, async () => {
      const maj = await api("PATCH", `/reservations/${numero}`, { contrat_signe: oui === "oui" });
      const i = etat.reservations.findIndex((x) => x.numero === numero);
      if (i >= 0) etat.reservations[i] = maj;
      rafraichirVue(); dessinerMenu();
    }, oui === "oui" ? "Contrat marqué signé ✓" : "Signature retirée");
  }
}, true);
document.addEventListener("input", (e) => {
  if (e.target.id !== "contrats-recherche") return;
  filtreContrats.texte = e.target.value; filtreContrats.visibles = 25;
  const p = e.target.selectionStart;
  rendreContrats($("#contenu"));
  const c = $("#contrats-recherche"); c.focus(); c.setSelectionRange(p, p);
});
