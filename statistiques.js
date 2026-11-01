/* ═══════════════════════════════════════════════════════════════
   STATISTIQUES (administrateur) : rentabilité par véhicule, occupation, sources, meilleurs clients
   Chiffre d'affaires = locations confirmées, en cours ou terminées ; charges = dépenses rattachées au véhicule
   (entretien, réparations, amendes… déjà inscrites en comptabilité, donc comptées une seule fois).
   ═══════════════════════════════════════════════════════════════ */
const statistiques = { periode: "90", tri: "net" };

const PERIODES_STATS = [["30", "30 jours"], ["90", "90 jours"], ["365", "12 mois"], ["tout", "Tout"]];
const MODES_SOURCE = { site: "Site web", agence: "Agence", telephone: "Téléphone", whatsapp: "WhatsApp" };

function bornesStats() {
  const fin = aujourdhui();
  if (statistiques.periode === "tout") {
    const debuts = reservationsFacturables().map((r) => r.date_debut).sort();
    return [debuts[0] ?? ajouterJours(fin, -30), fin];
  }
  return [ajouterJours(fin, -Number(statistiques.periode) + 1), fin];
}

// Jours de location tombant dans la période (un départ et un retour le même jour comptent une journée)
function joursDansPeriode(r, du, au) {
  const a = r.date_debut > du ? r.date_debut : du, b = finOccupee(r) < ajouterJours(au, 1) ? finOccupee(r) : ajouterJours(au, 1);
  return b > a ? joursEntre(a, b) : 0;
}

function calculerStats() {
  const [du, au] = bornesStats();
  const nbJours = joursEntre(du, au) + 1;
  const locations = reservationsFacturables().filter((r) => r.date_debut >= du && r.date_debut <= au);
  const ca = locations.reduce((s, r) => s + r.total, 0);
  const charges = etat.depenses.filter((d) => d.date >= du && d.date <= au && d.categorie !== "achat_vehicule");
  const totalCharges = charges.reduce((s, d) => s + d.montant, 0);

  const parVoiture = etat.voitures.map((v) => {
    const l = locations.filter((r) => r.voiture_id === v.id);
    const c = charges.filter((d) => d.voiture_id === v.id).reduce((s, d) => s + d.montant, 0);
    const jours = reservationsFacturables().filter((r) => r.voiture_id === v.id).reduce((s, r) => s + joursDansPeriode(r, du, au), 0);
    const caV = l.reduce((s, r) => s + r.total, 0);
    return { v, locations: l.length, ca: caV, charges: c, net: caV - c, jours, occupation: Math.min(100, Math.round((jours / nbJours) * 100)), moyen: l.length ? Math.round(caV / l.length) : 0 };
  });
  const tri = { net: (a, b) => b.net - a.net, ca: (a, b) => b.ca - a.ca, occupation: (a, b) => b.occupation - a.occupation, charges: (a, b) => b.charges - a.charges }[statistiques.tri];
  parVoiture.sort(tri);

  const groupe = (cle) => {
    const m = new Map();
    for (const r of locations) { const k = cle(r) || "—"; m.set(k, (m.get(k) ?? 0) + r.total); }
    return [...m.entries()].map(([nom, valeur]) => ({ nom, valeur })).sort((a, b) => b.valeur - a.valeur);
  };
  const parCategorie = groupe((r) => compteVoiture(r.voiture_id)?.categorie);
  const parGamme = groupe((r) => compteVoiture(r.voiture_id)?.gamme);
  const parSource = groupe((r) => MODES_SOURCE[r.source] ?? r.source);
  const parMode = groupe((r) => r.paiement_souhaite?.mode);

  const clients = new Map();
  for (const r of locations) {
    const cle = chiffresTel(r.client?.telephone).slice(-9) || r.numero;
    const c = clients.get(cle) ?? { nom: nomClient(r), tel: r.client?.telephone ?? "", locations: 0, total: 0 };
    c.locations++; c.total += r.total; clients.set(cle, c);
  }
  const meilleurs = [...clients.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const fideles = [...clients.values()].filter((c) => c.locations > 1).length;

  const jourLoues = parVoiture.reduce((s, x) => s + x.jours, 0), enLigne = etat.voitures.filter((v) => v.disponible).length || 1;
  const joursTotal = locations.reduce((s, r) => s + r.jours, 0);
  const annulees = etat.reservations.filter((r) => estReservation(r) && r.statut === "annulée" && r.date_debut >= du && r.date_debut <= au).length;
  return { du, au, nbJours, locations, ca, totalCharges, parVoiture, parCategorie, parGamme, parSource, parMode, meilleurs, fideles, clientsTotal: clients.size,
    occupation: Math.min(100, Math.round((jourLoues / (enLigne * nbJours)) * 100)), dureeMoyenne: locations.length ? joursTotal / locations.length : 0, panier: locations.length ? Math.round(ca / locations.length) : 0, annulees };
}

// Barres horizontales fines, une seule couleur de marque
function barresStats(lignes, formater = da) {
  if (!lignes.length) return `<p class="vide-liste">Aucune donnée sur la période.</p>`;
  const max = Math.max(...lignes.map((x) => x.valeur), 1), total = lignes.reduce((s, x) => s + x.valeur, 0) || 1;
  return `<ul class="barres-h">${lignes.map((x) => `<li><div class="barres-h-tete"><span>${echapper(x.nom)}</span><strong class="mono">${formater(x.valeur)} <small class="gris">${Math.round((x.valeur / total) * 100)} %</small></strong></div>
    <div class="barres-h-piste"><i style="width:${Math.max(2, (x.valeur / max) * 100)}%"></i></div></li>`).join("")}</ul>`;
}

function rendreStatistiques(conteneur) {
  const s = calculerStats(), net = s.ca - s.totalCharges;
  const tendance = chiffreAffairesParMois(6);
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Statistiques</h2><p>Du ${dateFr(s.du)} au ${dateFr(s.au)} : ce qui rapporte, ce qui coûte et ce qui dort au parking.</p></div>
      <div class="puces">${PERIODES_STATS.map(([k, n]) => `<button class="puce ${statistiques.periode === k ? "actif" : ""}" data-stats-periode="${k}">${n}</button>`).join("")}</div></div>
    <div class="indicateurs">
      <div class="carte indicateur"><span>Chiffre d'affaires</span><strong>${da(s.ca)}</strong><em>${pluriel(s.locations.length, "location")} · panier moyen ${da(s.panier)}</em></div>
      <div class="carte indicateur"><span>Résultat des véhicules</span><strong class="${net < 0 ? "tendance-bas" : ""}">${da(net)}</strong><em>après ${da(s.totalCharges)} de charges</em></div>
      <div class="carte indicateur"><span>Taux d'occupation</span><strong>${s.occupation} %</strong><em>${s.dureeMoyenne ? `durée moyenne ${s.dureeMoyenne.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} jours` : "aucune location"}</em></div>
      <div class="carte indicateur"><span>Clients</span><strong>${s.clientsTotal}</strong><em>${s.fideles} reviennent · ${pluriel(s.annulees, "annulation")}</em></div>
    </div>
    <div class="grille-3" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">
      <section class="carte"><div class="carte-titre"><h3>Chiffre d'affaires par mois</h3><small>6 derniers mois</small></div><div class="graphique" dir="ltr">${graphiqueChiffreAffaires(tendance)}</div></section>
      <section class="carte"><div class="carte-titre"><h3>Par catégorie</h3><small>${s.parCategorie.length}</small></div><div style="padding:6px 20px 18px">${barresStats(s.parCategorie)}</div></section>
    </div>
    <section class="carte" style="margin-bottom:14px"><div class="carte-titre"><h3>Rentabilité par véhicule</h3>
      <select id="stats-tri" aria-label="Trier par"><option value="net" ${statistiques.tri === "net" ? "selected" : ""}>Trier : résultat</option><option value="ca" ${statistiques.tri === "ca" ? "selected" : ""}>Trier : chiffre d'affaires</option><option value="occupation" ${statistiques.tri === "occupation" ? "selected" : ""}>Trier : occupation</option><option value="charges" ${statistiques.tri === "charges" ? "selected" : ""}>Trier : charges</option></select></div>
      <div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Véhicule</th><th>Locations</th><th>Occupation</th><th>Chiffre d'affaires</th><th>Charges</th><th>Résultat</th></tr></thead><tbody>
      ${s.parVoiture.map((x) => `<tr>
        <td data-label="Véhicule"><div class="cellule-vehicule"><img class="mini-photo" src="${urlPhoto(x.v)}" alt="" loading="lazy"><div class="cellule-principale"><strong>${echapper(x.v.marque)} ${echapper(x.v.modele)}</strong><span>${echapper(x.v.gamme ?? "")} · ${echapper(x.v.categorie)}</span></div></div></td>
        <td data-label="Locations" class="mono">${x.locations}</td>
        <td data-label="Occupation"><div class="jauge" title="${x.jours} jours loués"><i style="width:${x.occupation}%"></i></div><span class="mono petit">${x.occupation} %</span></td>
        <td data-label="Chiffre d'affaires" class="mono">${da(x.ca)}</td>
        <td data-label="Charges" class="mono">${x.charges ? da(x.charges) : "—"}</td>
        <td data-label="Résultat" class="mono ${x.net < 0 ? "tendance-bas" : "tendance-haut"}">${da(x.net)}</td></tr>`).join("")}
      </tbody></table></div></section>
    <div class="grille-3" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">
      <section class="carte"><div class="carte-titre"><h3>Par gamme</h3></div><div style="padding:6px 20px 18px">${barresStats(s.parGamme)}</div></section>
      <section class="carte"><div class="carte-titre"><h3>D'où viennent les réservations</h3></div><div style="padding:6px 20px 18px">${barresStats(s.parSource)}</div></section>
      <section class="carte"><div class="carte-titre"><h3>Modes de paiement</h3></div><div style="padding:6px 20px 18px">${barresStats(s.parMode)}</div></section>
    </div>
    <section class="carte" style="margin-top:14px"><div class="carte-titre"><h3>Meilleurs clients</h3><small>${s.meilleurs.length}</small></div>
      ${s.meilleurs.length ? `<div class="tableau-conteneur"><table class="tableau"><thead><tr><th>Client</th><th>Téléphone</th><th>Locations</th><th>Total</th></tr></thead><tbody>
        ${s.meilleurs.map((c) => `<tr><td data-label="Client"><strong>${echapper(c.nom)}</strong></td><td data-label="Téléphone">${ltr(c.tel)}</td><td data-label="Locations" class="mono">${c.locations}</td><td data-label="Total" class="mono">${da(c.total)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="vide-liste">Aucun client sur la période.</p>`}</section>`;
}
enregistrerVue("statistiques", { titre: "Statistiques", icone: "statistiques", rendre: rendreStatistiques, admin: true });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "statistiques") return;
  const p = e.target.closest("[data-stats-periode]");
  if (p) { statistiques.periode = p.dataset.statsPeriode; rendreStatistiques($("#contenu")); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "stats-tri") { statistiques.tri = e.target.value; rendreStatistiques($("#contenu")); }
});
