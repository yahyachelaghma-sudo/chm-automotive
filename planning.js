/* ═══════════════════════════════════════════════════════════════
   PLANNING : tous les véhicules sur une frise, jour par jour
   ═══════════════════════════════════════════════════════════════ */
const planning = { debut: ajouterJours(aujourdhui(), -3), jours: 28 };

function rendrePlanning(conteneur) {
  const { debut, jours } = planning, auj = aujourdhui(), fin = ajouterJours(debut, jours);
  const voitures = [...etat.voitures].sort((a, b) => a.categorie.localeCompare(b.categorie) || `${a.marque} ${a.modele}`.localeCompare(`${b.marque} ${b.modele}`));
  const colonnes = Array.from({ length: jours }, (_, i) => ajouterJours(debut, i));
  const indiceAuj = joursEntre(debut, auj);

  const entetesMois = colonnes.map((j, i) => (i === 0 || j.endsWith("-01") ? `<div class="planning-mois" style="grid-column:${i + 1} / span ${Math.min(jours - i, new Date(+j.slice(0, 4), +j.slice(5, 7), 0).getDate() - +j.slice(8) + 1)}">${MOIS[+j.slice(5, 7) - 1]} ${j.slice(0, 4)}</div>` : "")).join("");

  const lignes = voitures.map((v) => {
    const blocs = etat.reservations
      .filter((r) => r.voiture_id === v.id && r.statut !== "annulée" && finOccupee(r) > debut && r.date_debut < fin)
      .map((r) => {
        const a = Math.max(0, joursEntre(debut, r.date_debut)), b = Math.min(jours, joursEntre(debut, finOccupee(r)));
        const texte = r.statut === "blocage" ? `🔧 ${echapper(r.motif)}` : echapper(nomClient(r));
        const aide = r.statut === "blocage" ? `${r.motif} · ${dateFr(r.date_debut)} → ${dateFr(r.date_fin)}` : `${r.numero} · ${nomClient(r)} · ${dateFr(r.date_debut)} → ${dateFr(r.date_fin)} · ${STATUTS[r.statut].nom}`;
        return `<div class="bloc-planning ${STATUTS[r.statut].cls}" data-res="${r.numero}" style="left:calc(${(a / jours) * 100}% + 2px);width:calc(${((b - a) / jours) * 100}% - 4px)" title="${echapper(aide)}">${texte}</div>`;
      }).join("");
    return `<div class="planning-ligne">
      <div class="planning-nom ${v.disponible && !bloquee(v) ? "" : "hors-ligne"}"><strong>${echapper(v.marque)} ${echapper(v.modele)}</strong><span>${echapper(v.gamme ?? v.categorie)}${bloquee(v) ? ` · ${ETATS[etatVoiture(v)].nom.toLowerCase()}` : v.disponible ? "" : " · hors ligne"}</span></div>
      <div class="planning-piste" data-voiture="${v.id}">${indiceAuj >= 0 && indiceAuj < jours ? `<div class="planning-aujourdhui" style="left:calc(${((indiceAuj + 0.5) / jours) * 100}% - 1px)"></div>` : ""}${blocs}</div></div>`;
  }).join("");

  conteneur.innerHTML = `
    <div class="entete-vue">
      <div><h2>Planning</h2><p>Cliquez sur une case libre pour créer une réservation, ou sur une barre pour l'ouvrir.</p></div>
      <div class="actions">
        <button class="btn btn-contour btn-icone" data-plan="-7" aria-label="Semaine précédente">${icone("gauche")}</button>
        <button class="btn btn-contour" data-plan="0">Aujourd'hui</button>
        <button class="btn btn-contour btn-icone" data-plan="7" aria-label="Semaine suivante">${icone("droite")}</button>
        <select id="plan-jours" aria-label="Durée affichée" style="width:auto"><option value="14">2 semaines</option><option value="28">4 semaines</option><option value="42">6 semaines</option></select>
        <button class="btn btn-contour" data-bloquer>${icone("blocage")}Bloquer un véhicule</button>
      </div>
    </div>
    <section class="carte planning"><div class="planning-grille" style="--n:${jours}">
      <div class="planning-entete"><div></div><div><div class="planning-jours" style="grid-template-rows:auto">${entetesMois}</div>
        <div class="planning-jours">${colonnes.map((j) => { const d = dateDepuis(j).getDay(); return `<div class="planning-jour ${d === 5 || d === 6 ? "week-end" : ""} ${j === auj ? "aujourdhui" : ""}">${jourSemaine(j).slice(0, 3)}<b>${+j.slice(8)}</b></div>`; }).join("")}</div></div></div>
      ${lignes}
    </div>
    <div class="legende"><span style="color:var(--or)">En attente</span><span style="color:var(--bleu)">Confirmée</span><span style="color:var(--vert)">En cours</span><span style="color:#b9b9c2">Terminée</span><span style="color:var(--gris-2)">Indisponible</span></div></section>`;
  $("#plan-jours").value = String(jours);
}

enregistrerVue("planning", { titre: "Planning", icone: "planning", rendre: rendrePlanning });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "planning" || !$("#contenu").contains(e.target)) return;
  const nav = e.target.closest("[data-plan]");
  if (nav) {
    planning.debut = nav.dataset.plan === "0" ? ajouterJours(aujourdhui(), -3) : ajouterJours(planning.debut, +nav.dataset.plan);
    return rendrePlanning($("#contenu"));
  }
  if (e.target.closest("[data-bloquer]")) return ouvrirFormulaireBlocage();
  if (e.target.closest("[data-res]")) return; // géré par le tableau de bord (ouvre la fiche)
  const piste = e.target.closest(".planning-piste");
  if (piste) {
    const x = (e.clientX - piste.getBoundingClientRect().left) / piste.clientWidth;
    const jour = ajouterJours(planning.debut, Math.min(planning.jours - 1, Math.floor(x * planning.jours)));
    ouvrirFormulaireReservation({ voiture_id: piste.dataset.voiture, date_debut: jour < aujourdhui() ? aujourdhui() : jour, date_fin: ajouterJours(jour < aujourdhui() ? aujourdhui() : jour, 3) });
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "plan-jours") { planning.jours = +e.target.value; rendrePlanning($("#contenu")); }
});
