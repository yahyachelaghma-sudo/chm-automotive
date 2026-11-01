/* ═══════════════════════════════════════════════════════════════
   TABLEAU DE BORD : ce qu'il faut savoir et faire aujourd'hui
   ═══════════════════════════════════════════════════════════════ */
const MOIS = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 15).toLocaleDateString(LOCALE, { month: "long" }));
const moisCourt = (m) => new Date(2026, m, 15).toLocaleDateString(LOCALE, { month: "short" }).replace(".", "");
const abreger = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${Math.round(n / 1e3).toLocaleString("fr-FR")} k` : String(Math.round(n)));

// Un départ et un retour le même jour occupent quand même la journée
const finOccupee = (r) => (r.date_fin > r.date_debut ? r.date_fin : ajouterJours(r.date_debut, 1));
const prefixeMois = (annee, mois) => `${annee}-${String(mois + 1).padStart(2, "0")}`;

function reservationsFacturables() {
  return etat.reservations.filter((r) => estReservation(r) && ["confirmée", "en cours", "terminée"].includes(r.statut));
}

function chiffreAffairesParMois(nombre) {
  const maintenant = new Date();
  const liste = [];
  for (let i = nombre - 1; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    const prefixe = prefixeMois(d.getFullYear(), d.getMonth());
    const doMois = reservationsFacturables().filter((r) => r.date_debut.startsWith(prefixe));
    liste.push({ prefixe, annee: d.getFullYear(), mois: d.getMonth(), total: doMois.reduce((s, r) => s + r.total, 0), nombre: doMois.length });
  }
  return liste;
}

function tauxOccupation(annee, mois) {
  const debut = `${prefixeMois(annee, mois)}-01`;
  const fin = versISO(new Date(annee, mois + 1, 1));
  const jours = joursEntre(debut, fin);
  const enLigne = etat.voitures.filter((v) => v.disponible).length || 1;
  let loues = 0;
  for (const r of reservationsFacturables()) {
    const a = r.date_debut > debut ? r.date_debut : debut;
    const b = finOccupee(r) < fin ? finOccupee(r) : fin;
    if (b > a) loues += joursEntre(a, b);
  }
  return Math.min(100, Math.round((loues / (enLigne * jours)) * 100));
}

function graphiqueChiffreAffaires(donnees) {
  const L = 620, H = 250, g = 54, d = 12, h = 34, b = 30;
  const max = Math.max(...donnees.map((x) => x.total), 1);
  const pas = (() => { const brut = max / 4, p = 10 ** Math.floor(Math.log10(brut)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= brut); })();
  const sommet = pas * Math.ceil(max / pas);
  const y = (v) => H - b - ((H - b - h) * v) / sommet;
  const largeurCol = (L - g - d) / donnees.length, largeurBarre = Math.min(46, largeurCol * 0.55);
  const traits = Array.from({ length: Math.round(sommet / pas) + 1 }, (_, i) => i * pas);
  const dernier = donnees.length - 1;
  return `
    <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Chiffre d'affaires des ${donnees.length} derniers mois">
      ${traits.map((v) => `<line class="grille-trait" x1="${g}" x2="${L - d}" y1="${y(v)}" y2="${y(v)}"/><text class="axe-texte" x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${abreger(v)}</text>`).join("")}
      ${donnees.map((x, i) => {
        const cx = g + largeurCol * i + largeurCol / 2, hauteur = Math.max(x.total ? 3 : 0, y(0) - y(x.total));
        return `
          <path class="barre-graph" data-i="${i}" d="M${cx - largeurBarre / 2},${y(0)} v${-Math.max(0, hauteur - 4)} q0,-4 4,-4 h${largeurBarre - 8} q4,0 4,4 v${Math.max(0, hauteur - 4)} z"/>
          <text class="axe-texte" x="${cx}" y="${H - 8}" text-anchor="middle">${moisCourt(x.mois)}</text>
          ${i === dernier && x.total ? `<text class="axe-texte" x="${cx}" y="${y(x.total) - 9}" text-anchor="middle" style="fill:#fff;font-weight:700">${abreger(x.total)}</text>` : ""}
          <rect class="zone-survol" data-i="${i}" x="${cx - largeurCol / 2}" y="${h - 10}" width="${largeurCol}" height="${H - h - 6}"/>`;
      }).join("")}
    </svg>
    <table class="visuel-cache"><caption>Chiffre d'affaires par mois</caption>${donnees.map((x) => `<tr><th>${MOIS[x.mois]} ${x.annee}</th><td>${da(x.total)}</td></tr>`).join("")}</table>`;
}

function classementVoitures() {
  const parVoiture = new Map();
  for (const r of reservationsFacturables()) {
    const ligne = parVoiture.get(r.voiture_id) ?? { nom: r.voiture, total: 0, locations: 0 };
    ligne.total += r.total; ligne.locations++;
    parVoiture.set(r.voiture_id, ligne);
  }
  const liste = [...parVoiture.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  if (!liste.length) return `<p class="vide-liste">Le classement apparaîtra avec les premières locations.</p>`;
  return `<ol class="classement">${liste.map((v) => `
    <li><div class="ligne-haut"><strong>${echapper(v.nom)}</strong><span>${da(v.total)} · ${pluriel(v.locations, "location")}</span></div>
    <div class="piste"><i style="width:${Math.max(3, (v.total / liste[0].total) * 100)}%"></i></div></li>`).join("")}</ol>`;
}

function tache(r, details, droite) {
  const v = compteVoiture(r.voiture_id);
  return `<li class="tache" data-res="${r.numero}" tabindex="0">
    <div class="tache-info"><strong>${echapper(nomClient(r))} · ${echapper(r.voiture)}</strong><span>${details}</span></div>${droite ?? ""}</li>`;
}

function carteTaches(titre, ico, lignes, videTexte, compteur) {
  return `<section class="carte">
    <div class="carte-titre"><h3>${titre}</h3>${compteur ? `<small>${compteur}</small>` : ""}</div>
    ${lignes.length ? `<ul class="liste-taches">${lignes.join("")}</ul>` : `<p class="vide-liste">${videTexte}</p>`}</section>`;
}

function carteAlertesVehicules() {
  const alertes = toutesAlertes();
  const lignes = alertes.slice(0, 7).map((a) => `<li class="tache" data-vehicule="${a.voiture.id}" tabindex="0"><div class="tache-info"><strong>${echapper(a.voiture.marque)} ${echapper(a.voiture.modele)}</strong><span style="color:${a.gravite === "rouge" ? "#ff9a9a" : "var(--or)"}">${echapper(a.texte)}</span></div>${a.gravite === "rouge" ? badge("badge-annulee", "urgent", "alerte") : ""}</li>`);
  return carteTaches("Alertes véhicules", "alerte", lignes, "Documents et entretiens à jour ✓", alertes.length || "");
}

function rendreTableau(conteneur) {
  const auj = aujourdhui(), maintenant = new Date();
  const mois = chiffreAffairesParMois(6);
  const courant = mois[5], precedent = mois[4];
  const variation = precedent.total ? Math.round(((courant.total - precedent.total) / precedent.total) * 100) : null;
  const occupation = tauxOccupation(maintenant.getFullYear(), maintenant.getMonth());
  const facturables = reservationsFacturables();
  const aEncaisser = facturables.reduce((s, r) => s + reste(r), 0);
  const encaisseTotal = facturables.reduce((s, r) => s + encaisse(r), 0);
  const enLigne = etat.voitures.filter((v) => v.disponible).length;
  const louesAujourdhui = new Set(etat.reservations.filter((r) => estReservation(r) && ["confirmée", "en cours"].includes(r.statut) && r.date_debut <= auj && finOccupee(r) > auj).map((r) => r.voiture_id)).size;

  const departs = etat.reservations.filter((r) => r.statut === "confirmée" && r.date_debut <= ajouterJours(auj, 2)).sort((a, b) => a.date_debut.localeCompare(b.date_debut));
  const retours = etat.reservations.filter((r) => r.statut === "en cours" && r.date_fin <= ajouterJours(auj, 1)).sort((a, b) => a.date_fin.localeCompare(b.date_fin));
  const attente = etat.reservations.filter((r) => r.statut === "en attente").sort((a, b) => a.date_debut.localeCompare(b.date_debut));
  const impayes = facturables.filter((r) => reste(r) > 0 && r.date_debut <= ajouterJours(auj, 7)).sort((a, b) => a.date_debut.localeCompare(b.date_debut)).slice(0, 6);
  const dossiers = etat.dossiers.filter((d) => d.statut === "à vérifier");

  const prenom = etat.utilisateur.nom.split(" ")[0];
  conteneur.innerHTML = `
    <div class="entete-vue">
      <div><h2>Bonjour ${echapper(prenom)} 👋</h2><p>${dateLongue(auj).replace(/^./, (c) => c.toUpperCase())}</p></div>
      <div class="actions"><button class="btn btn-contour" data-actualiser>${icone("horloge")}Actualiser</button></div>
    </div>

    <div class="indicateurs">
      <div class="carte indicateur"><span>Chiffre d'affaires · ${MOIS[maintenant.getMonth()]}</span><strong>${da(courant.total)}</strong>
        <em class="${variation === null ? "" : variation >= 0 ? "tendance-haut" : "tendance-bas"}">${variation === null ? pluriel(courant.nombre, "location") : `${variation >= 0 ? "▲" : "▼"} ${Math.abs(variation)} % vs ${MOIS[precedent.mois]} · ${pluriel(courant.nombre, "location")}`}</em></div>
      <div class="carte indicateur"><span>Reste à encaisser</span><strong>${da(aEncaisser)}</strong><em>${da(encaisseTotal)} déjà encaissés</em></div>
      <div class="carte indicateur"><span>Occupation du mois</span><strong>${occupation}<small>%</small></strong><em>${louesAujourdhui} véhicule${louesAujourdhui > 1 ? "s" : ""} sur ${enLigne} loué${louesAujourdhui > 1 ? "s" : ""} aujourd'hui</em></div>
      <div class="carte indicateur"><span>À confirmer</span><strong>${attente.length}</strong><em>${attente.length ? "réservations du site à traiter" : "tout est à jour ✓"}</em></div>
    </div>

    <div class="grille-2">
      <section class="carte">
        <div class="carte-titre"><h3>Chiffre d'affaires par mois</h3><small>locations confirmées</small></div>
        <div class="graphique" id="graphique-ca">${graphiqueChiffreAffaires(mois)}</div>
      </section>
      <section class="carte">
        <div class="carte-titre"><h3>Véhicules les plus rentables</h3><small>depuis le début</small></div>
        ${classementVoitures()}
      </section>
    </div>

    <div class="grille-3">
      ${carteTaches("Départs à préparer <small style='color:var(--gris);font-weight:500'>(2 jours)</small>", "cle", departs.map((r) => tache(r, `${r.date_debut < auj ? `<b style="color:#ff8d8d">en retard · </b>` : r.date_debut === auj ? `<b style="color:var(--vert)">aujourd'hui · </b>` : `${jourSemaine(r.date_debut)} ${dateCourte(r.date_debut)} · `}${r.heure_depart ? r.heure_depart + " · " : ""}${echapper(r.lieu_depart)}`, reste(r) ? badge("badge-alerte", `reste ${da(reste(r))}`) : badge("badge-valide", "payé", "check"))), "Aucun départ aujourd'hui.", departs.length || "")}
      ${carteTaches("Retours attendus", "drapeau", retours.map((r) => tache(r, `${r.date_fin < auj ? `<b style="color:#ff8d8d">${pluriel(joursEntre(r.date_fin, auj), "jour")} de retard · </b>` : r.date_fin === auj ? `<b style="color:var(--vert)">aujourd'hui · </b>` : "demain · "}${r.heure_retour ? r.heure_retour + " · " : ""}${echapper(r.lieu_retour)}`, `<a class="btn btn-petit btn-contour" href="tel:${echapper(r.client.telephone)}" onclick="event.stopPropagation()">${icone("tel")}</a>`)), "Aucun retour aujourd'hui.", retours.length || "")}
      ${carteTaches("Réservations à confirmer", "horloge", attente.slice(0, 6).map((r) => tache(r, `${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)} · ${da(r.total)}`, badge("badge-attente", r.source === "site" ? "site" : "agence"))), "Aucune réservation en attente.", attente.length || "")}
      ${carteTaches("Paiements à encaisser", "argent", impayes.map((r) => tache(r, `${echapper(r.paiement_souhaite?.mode ?? "")} · départ ${dateCourte(r.date_debut)}`, `<strong class="mono" style="color:var(--or)">${da(reste(r))}</strong>`)), "Rien à encaisser pour l'instant.", impayes.length || "")}
      ${carteAlertesVehicules()}
      ${carteTaches("Dossiers à vérifier", "dossiers", dossiers.slice(0, 6).map((d) => `<li class="tache" data-dossier="${d.numero}" tabindex="0"><div class="tache-info"><strong>${echapper(d.prenom)} ${echapper(d.nom)}</strong><span>reçu ${heureFr(d.recu_le)} · ${pluriel((d.documents || []).length, "document")}</span></div></li>`), "Aucun dossier en attente.", dossiers.length || "")}
    </div>`;

  // infobulles du graphique
  $$("#graphique-ca .zone-survol", conteneur).forEach((zone) => {
    const x = mois[zone.dataset.i];
    zone.addEventListener("mousemove", (e) => {
      $$("#graphique-ca .barre-graph").forEach((b) => b.classList.toggle("attenuee", b.dataset.i !== zone.dataset.i));
      montrerInfobulle(e, `<strong>${MOIS[x.mois].replace(/^./, (c) => c.toUpperCase())} ${x.annee}</strong>${da(x.total)} · ${pluriel(x.nombre, "location")}`);
    });
    zone.addEventListener("mouseleave", () => { cacherInfobulle(); $$("#graphique-ca .barre-graph").forEach((b) => b.classList.remove("attenuee")); });
  });
}

enregistrerVue("tableau", { titre: "Tableau de bord", icone: "tableau", rendre: rendreTableau });

// Clic sur une ligne « à faire » : ouvre la réservation ou le dossier
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-edl-rapide], [data-signer], [data-stop]")) return;
  const res = e.target.closest("[data-res]");
  if (res) { e.preventDefault(); return ouvrirReservation(res.dataset.res); }
  const veh = e.target.closest(".tache[data-vehicule]");
  if (veh) return ouvrirVehicule(veh.dataset.vehicule);
  const dos = e.target.closest("[data-dossier]");
  if (dos) return ouvrirDossier(dos.dataset.dossier);
  if (e.target.closest("[data-actualiser]")) actualiser(false).then(() => notifier("Données à jour"));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.(".tache")) e.target.click();
});
