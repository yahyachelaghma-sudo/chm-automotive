/* ═══════════════════════════════════════════════════════════════
   COMPTABILITÉ : encaissements, décaissements, charges des véhicules
   Les paiements des réservations, les cautions et les coûts d'entretien arrivent tout seuls dans le journal.
   ═══════════════════════════════════════════════════════════════ */
const compta = { donnees: null, charge_le: 0, chargement: false, periode: "mois", du: "", au: "", sens: "tous", categorie: "", voiture: "", recherche: "", visibles: 60 };
const MODES_COMPTA = () => [...new Set([...(etat.agence.paiement_modes ?? []).map((m) => m.id), "Espèces", "Virement", "Chèque", "Autre"])];
const SOURCES_COMPTA = { reservation: "Réservation", entretien: "Entretien", manuel: "Saisie" };

const categorieCompta = (m) => compta.donnees.categories[m.sens][m.categorie] ?? { nom: m.categorie };
const horsResultat = (m) => categorieCompta(m).groupe === "hors_resultat";
const nomVoitureCompta = (id) => { const v = compteVoiture(id); return v ? `${v.marque} ${v.modele}` : id ? "Véhicule supprimé" : ""; };

function bornesPeriode() {
  const auj = aujourdhui(), a = +auj.slice(0, 4), m = +auj.slice(5, 7) - 1;
  const iso = (annee, mois, jour) => versISO(new Date(annee, mois, jour));
  switch (compta.periode) {
    case "mois": return [iso(a, m, 1), iso(a, m + 1, 0)];
    case "precedent": return [iso(a, m - 1, 1), iso(a, m, 0)];
    case "trimestre": { const t = Math.floor(m / 3) * 3; return [iso(a, t, 1), iso(a, t + 3, 0)]; }
    case "annee": return [iso(a, 0, 1), iso(a, 11, 31)];
    case "perso": return [compta.du || "0000-01-01", compta.au || "9999-12-31"];
    default: return ["0000-01-01", "9999-12-31"];
  }
}

function totauxCompta(liste) {
  const t = { entrees: 0, sorties: 0 };
  for (const m of liste) if (!horsResultat(m)) t[m.sens === "entree" ? "entrees" : "sorties"] += m.montant;
  return { ...t, net: t.entrees - t.sorties };
}

async function chargerCompta() {
  if (compta.chargement) return;
  compta.chargement = true;
  try { compta.donnees = await api("GET", "/comptabilite"); compta.charge_le = Date.now(); }
  catch (e) { notifier(e.message, "erreur"); }
  finally { compta.chargement = false; }
  if (routeActuelle().vue === "comptabilite") rendreCompta($("#contenu"));
}

function lignesBarres(lignes, couleur) {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  return lignes.length ? lignes.map((l) => `<div class="barre-ligne"><span>${l.nom}</span><div><i style="width:${Math.max(2, (l.valeur / max) * 100)}%;background:${couleur}"></i></div><b class="mono">${da(l.valeur)}</b></div>`).join("")
    : `<p class="gris petit">Rien sur cette période.</p>`;
}

function parMois() {
  const auj = aujourdhui(), mois = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(+auj.slice(0, 4), +auj.slice(5, 7) - 1 - i, 1); mois.push({ cle: versISO(d).slice(0, 7), nom: MOIS[d.getMonth()], entrees: 0, sorties: 0 }); }
  for (const m of compta.donnees.mouvements) {
    const ligne = mois.find((x) => x.cle === m.date.slice(0, 7));
    if (ligne && !horsResultat(m)) ligne[m.sens === "entree" ? "entrees" : "sorties"] += m.montant;
  }
  return mois;
}

function rendreCompta(conteneur) {
  if (!compta.donnees) {
    conteneur.innerHTML = `<div class="entete-vue"><div><h2>Comptabilité</h2><p>Chargement…</p></div></div>`;
    chargerCompta();
    return;
  }
  const [du, au] = bornesPeriode();
  const periode = compta.donnees.mouvements.filter((m) => m.date >= du && m.date <= au);
  const t = totauxCompta(periode);
  const cautions = compta.donnees.mouvements.reduce((s, m) => s + (m.categorie === "caution" ? m.montant : m.categorie === "restitution_caution" ? -m.montant : 0), 0);
  const aEncaisser = etat.reservations.filter((r) => ["confirmée", "en cours", "terminée"].includes(r.statut)).reduce((s, r) => s + Math.max(0, (r.total || 0) - (r.paye || 0)), 0);

  const chargesCat = {};
  for (const m of periode) if (m.sens === "sortie" && !horsResultat(m)) chargesCat[m.categorie] = (chargesCat[m.categorie] ?? 0) + m.montant;
  const recettesCat = {};
  for (const m of periode) if (m.sens === "entree" && !horsResultat(m)) recettesCat[m.categorie] = (recettesCat[m.categorie] ?? 0) + m.montant;
  const barres = (obj, sens) => lignesBarres(Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nom: echapper(compta.donnees.categories[sens][k]?.nom ?? k), valeur: v })), sens === "entree" ? "var(--vert)" : "var(--rouge)");

  // Résultat par véhicule : ce que chaque voiture rapporte moins ce qu'elle coûte
  const parVoiture = new Map();
  for (const m of periode) {
    if (horsResultat(m)) continue;
    const ligne = parVoiture.get(m.voiture_id || "") ?? { entrees: 0, sorties: 0 };
    ligne[m.sens === "entree" ? "entrees" : "sorties"] += m.montant;
    parVoiture.set(m.voiture_id || "", ligne);
  }
  const lignesVoitures = [...parVoiture.entries()].map(([id, l]) => ({ id, nom: id ? nomVoitureCompta(id) : "Charges générales de l'agence", ...l, net: l.entrees - l.sorties }))
    .sort((a, b) => (a.id === "") - (b.id === "") || b.net - a.net);

  // Journal filtré
  const q = normaliser(compta.recherche);
  const journal = periode.filter((m) => (compta.sens === "tous" || m.sens === compta.sens) && (!compta.categorie || m.categorie === compta.categorie)
    && (!compta.voiture || m.voiture_id === compta.voiture) && (!q || normaliser(`${m.libelle} ${categorieCompta(m).nom} ${nomVoitureCompta(m.voiture_id)} ${m.reservation} ${m.mode}`).includes(q)));
  const mois = parMois(), maxMois = Math.max(1, ...mois.flatMap((x) => [x.entrees, x.sorties]));
  const toutesCategories = [...Object.entries(compta.donnees.categories.entree), ...Object.entries(compta.donnees.categories.sortie)];

  conteneur.innerHTML = `
    <div class="entete-vue">
      <div><h2>Comptabilité</h2><p>Tout l'argent qui entre et qui sort, et ce que coûte chaque véhicule.</p></div>
      <div class="actions">
        <button class="btn btn-vert" data-mouvement="entree">${icone("plus")}Encaissement</button>
        <button class="btn btn-rouge" data-mouvement="sortie">${icone("plus")}Décaissement</button>
        <button class="btn btn-contour" data-export-compta>${icone("telecharger")}Exporter (Excel)</button>
      </div>
    </div>
    <div class="barre-filtres">
      <div class="puces">${Object.entries({ mois: "Ce mois", precedent: "Mois précédent", trimestre: "Trimestre", annee: "Année", tout: "Tout", perso: "Dates…" }).map(([k, n]) => `<button class="puce ${compta.periode === k ? "actif" : ""}" data-periode="${k}">${n}</button>`).join("")}</div>
      ${compta.periode === "perso" ? `<label class="inline">Du <input type="date" id="c-du" value="${compta.du}"></label><label class="inline">au <input type="date" id="c-au" value="${compta.au}"></label>` : ""}
    </div>

    <div class="indicateurs">
      <div class="carte indicateur"><span>Encaissements</span><strong style="color:var(--vert)">${da(t.entrees)}</strong><em>${pluriel(periode.filter((m) => m.sens === "entree" && !horsResultat(m)).length, "opération")}</em></div>
      <div class="carte indicateur"><span>Décaissements</span><strong style="color:#ff8d8d">${da(t.sorties)}</strong><em>${pluriel(periode.filter((m) => m.sens === "sortie" && !horsResultat(m)).length, "opération")}</em></div>
      <div class="carte indicateur"><span>Résultat</span><strong class="${t.net >= 0 ? "tendance-haut" : "tendance-bas"}">${t.net >= 0 ? "+" : "−"}${da(Math.abs(t.net))}</strong><em>encaissements − décaissements</em></div>
      <div class="carte indicateur"><span>Reste à encaisser</span><strong>${da(aEncaisser)}</strong><em>sur les réservations · ${da(cautions)} de cautions détenues</em></div>
    </div>

    <div class="grille-2">
      <section class="carte"><div class="carte-titre"><h3>Charges par catégorie</h3><small>période choisie</small></div>${barres(chargesCat, "sortie")}</section>
      <section class="carte"><div class="carte-titre"><h3>Encaissements par catégorie</h3><small>période choisie</small></div>${barres(recettesCat, "entree")}</section>
    </div>

    <section class="carte" style="margin-top:14px"><div class="carte-titre"><h3>6 derniers mois</h3><small><span style="color:var(--vert)">■</span> encaissements · <span style="color:var(--rouge)">■</span> décaissements</small></div>
      <div class="histo-compta">${mois.map((x) => `<div><div class="duo"><i style="height:${(x.entrees / maxMois) * 100}%;background:var(--vert)" title="${da(x.entrees)}"></i><i style="height:${(x.sorties / maxMois) * 100}%;background:var(--rouge)" title="${da(x.sorties)}"></i></div><small>${x.nom.slice(0, 4)}</small><b class="mono ${x.entrees - x.sorties >= 0 ? "tendance-haut" : "tendance-bas"}">${x.entrees - x.sorties >= 0 ? "+" : "−"}${Math.abs(Math.round((x.entrees - x.sorties) / 1000))} k</b></div>`).join("")}</div></section>

    <section class="carte tableau-boite" style="margin-top:14px">
      <div class="carte-titre" style="padding:16px 16px 0"><h3>Résultat par véhicule</h3><small>ce que chaque voiture rapporte moins ce qu'elle coûte</small></div>
      ${lignesVoitures.length ? `<table class="tableau"><thead><tr><th>Véhicule</th><th class="droite">Encaissé</th><th class="droite">Charges</th><th class="droite">Résultat</th></tr></thead><tbody>
        ${lignesVoitures.map((l) => `<tr data-filtre-voiture="${l.id}"><td class="cellule-principale"><strong>${echapper(l.nom)}</strong></td><td class="droite mono">${da(l.entrees)}</td><td class="droite mono">${da(l.sorties)}</td>
          <td class="droite mono"><strong class="${l.net >= 0 ? "tendance-haut" : "tendance-bas"}">${l.net >= 0 ? "+" : "−"}${da(Math.abs(l.net))}</strong></td></tr>`).join("")}</tbody></table>`
        : `<div class="vide-grand"><strong>Aucune opération</strong>Les paiements, cautions et entretiens enregistrés apparaîtront ici.</div>`}
    </section>

    <div class="barre-filtres" style="margin-top:22px">
      <h3 style="margin-inline-end:auto">Journal des opérations <span class="gris petit">${pluriel(journal.length, "ligne")}</span></h3>
      <select id="c-sens" aria-label="Sens"><option value="tous">Tout</option><option value="entree">Encaissements</option><option value="sortie">Décaissements</option></select>
      <select id="c-cat" aria-label="Catégorie"><option value="">Toutes les catégories</option>${toutesCategories.map(([k, c]) => `<option value="${k}">${echapper(c.nom)}</option>`).join("")}</select>
      <select id="c-voiture" aria-label="Véhicule"><option value="">Tous les véhicules</option>${etat.voitures.map((v) => `<option value="${v.id}">${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select>
      <input type="search" id="c-recherche" placeholder="Rechercher…" value="${echapper(compta.recherche)}" style="width:180px">
    </div>
    <div class="carte tableau-boite">
      ${journal.length ? `<table class="tableau tableau-compta"><thead><tr><th>Date</th><th>Opération</th><th>Véhicule</th><th>Mode</th><th>Origine</th><th class="droite">Montant</th><th></th></tr></thead><tbody>
        ${journal.slice(0, compta.visibles).map((m) => `<tr style="cursor:default"><td data-label="Date" class="mono">${dateFr(m.date)}</td>
          <td data-label="Opération" class="cellule-principale"><strong>${echapper(categorieCompta(m).nom)}</strong><span>${echapper(m.libelle)}</span></td>
          <td data-label="Véhicule">${echapper(nomVoitureCompta(m.voiture_id)) || '<span class="gris">—</span>'}</td>
          <td data-label="Mode">${echapper(m.mode) || '<span class="gris">—</span>'}</td>
          <td data-label="Origine">${m.reservation ? `<a href="#" data-res="${m.reservation}" style="text-decoration:underline">${m.reservation}</a>` : badge("badge-neutre", SOURCES_COMPTA[m.source] ?? m.source)}</td>
          <td data-label="Montant" class="droite mono"><strong class="${horsResultat(m) ? "" : m.sens === "entree" ? "tendance-haut" : "tendance-bas"}">${m.sens === "entree" ? "+" : "−"}${da(m.montant)}</strong>${horsResultat(m) ? `<br><span class="gris petit">hors résultat</span>` : ""}</td>
          <td class="droite">${m.source === "manuel" ? `<button class="btn btn-contour btn-icone" data-suppr-mouvement="${m.id}" aria-label="Supprimer" title="Supprimer">${icone("corbeille")}</button>` : ""}</td></tr>`).join("")}</tbody></table>
        ${journal.length > compta.visibles ? `<div style="padding:14px;text-align:center"><button class="btn btn-contour" data-plus-compta>Afficher plus (${journal.length - compta.visibles})</button></div>` : ""}`
      : `<div class="vide-grand"><strong>Aucune opération</strong>Ajoutez un encaissement ou un décaissement, ou changez la période.</div>`}
    </div>`;
  $("#c-sens").value = compta.sens; $("#c-cat").value = compta.categorie; $("#c-voiture").value = compta.voiture;
}

function ouvrirFormulaireMouvement(sens) {
  const categories = compta.donnees.categories[sens];
  const options = (groupe) => Object.entries(categories).filter(([, c]) => (c.groupe ?? "agence") === groupe).map(([k, c]) => `<option value="${k}">${echapper(c.nom)}</option>`).join("");
  const groupes = sens === "sortie"
    ? `<optgroup label="Charges d'un véhicule">${options("vehicule")}</optgroup><optgroup label="Charges de l'agence">${options("agence")}</optgroup><optgroup label="Hors résultat">${options("hors_resultat")}</optgroup>`
    : `${options("agence")}`;
  const corps = ouvrirFenetre(sens === "entree" ? "Nouvel encaissement" : "Nouveau décaissement", `
    <form id="form-mouvement" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="grille-form">
        <label>Date<input type="date" name="date" value="${aujourdhui()}" required></label>
        <label>Montant (DA)<input type="number" name="montant" min="1" step="50" required autofocus></label>
        <label class="large">Catégorie<select name="categorie">${groupes}</select></label>
        <label class="large">Véhicule concerné<select name="voiture_id"><option value="">— Aucun —</option>${etat.voitures.map((v) => `<option value="${v.id}">${echapper(v.marque)} ${echapper(v.modele)}${v.immatriculation ? ` · ${echapper(v.immatriculation)}` : ""}</option>`).join("")}</select></label>
        <label>Mode de paiement<select name="mode">${MODES_COMPTA().map((m) => `<option>${echapper(m)}</option>`).join("")}</select></label>
        <label>Note<input name="libelle" placeholder="${sens === "sortie" ? "Ex. : plein à la station Naftal" : "Ex. : supplément livraison aéroport"}"></label>
      </div>
      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn ${sens === "entree" ? "btn-vert" : "btn-rouge"}" type="submit">Enregistrer</button></div>
    </form>`, 560);
  const f = corps.querySelector("form");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    try {
      await api("POST", "/comptabilite", { sens, date: f.date.value, montant: f.montant.value, categorie: f.categorie.value, voiture_id: f.voiture_id.value, mode: f.mode.value, libelle: f.libelle.value });
      fermerFenetre(); await chargerCompta(); notifier("Enregistré ✓");
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}

function exporterCompta() {
  const [du, au] = bornesPeriode();
  const lignes = compta.donnees.mouvements.filter((m) => m.date >= du && m.date <= au).reverse();
  const cellule = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [["Date", "Sens", "Catégorie", "Véhicule", "Réservation", "Mode", "Note", "Encaissement (DA)", "Décaissement (DA)", "Origine", "Saisi par"].map(cellule).join(";"),
    ...lignes.map((m) => [dateFr(m.date), m.sens === "entree" ? "Encaissement" : "Décaissement", categorieCompta(m).nom, nomVoitureCompta(m.voiture_id), m.reservation, m.mode, m.libelle,
      m.sens === "entree" ? m.montant : "", m.sens === "sortie" ? m.montant : "", SOURCES_COMPTA[m.source] ?? m.source, m.par].map(cellule).join(";"))].join("\r\n");
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  lien.download = `comptabilite-${aujourdhui()}.csv`;
  lien.click();
  URL.revokeObjectURL(lien.href);
}

enregistrerVue("comptabilite", { titre: "Comptabilité", icone: "argent", admin: true, rendre: (c) => { rendreCompta(c); if (compta.donnees && Date.now() - compta.charge_le > 20000) chargerCompta(); } });

document.addEventListener("click", async (e) => {
  if (routeActuelle().vue !== "comptabilite" || !$("#contenu").contains(e.target) || !compta.donnees) return;
  const rafraichir = () => rendreCompta($("#contenu"));
  const periode = e.target.closest("[data-periode]");
  if (periode) { compta.periode = periode.dataset.periode; compta.visibles = 60; return rafraichir(); }
  const mouvement = e.target.closest("[data-mouvement]");
  if (mouvement) return ouvrirFormulaireMouvement(mouvement.dataset.mouvement);
  if (e.target.closest("[data-export-compta]")) return exporterCompta();
  if (e.target.closest("[data-plus-compta]")) { compta.visibles += 60; return rafraichir(); }
  const ligneVoiture = e.target.closest("[data-filtre-voiture]");
  if (ligneVoiture && ligneVoiture.dataset.filtreVoiture) { compta.voiture = ligneVoiture.dataset.filtreVoiture; rafraichir(); return $("#c-voiture").scrollIntoView({ behavior: "smooth", block: "center" }); }
  const suppr = e.target.closest("[data-suppr-mouvement]");
  if (suppr && await confirmer("Supprimer cette opération de la comptabilité ?", "Supprimer", true)) {
    try { await api("DELETE", `/comptabilite/${suppr.dataset.supprMouvement}`); await chargerCompta(); notifier("Opération supprimée"); }
    catch (err) { notifier(err.message, "erreur"); }
  }
});

document.addEventListener("change", (e) => {
  if (routeActuelle().vue !== "comptabilite" || !compta.donnees || !$("#contenu").contains(e.target)) return;
  const champs = { "c-sens": "sens", "c-cat": "categorie", "c-voiture": "voiture", "c-du": "du", "c-au": "au" };
  if (champs[e.target.id]) { compta[champs[e.target.id]] = e.target.value; compta.visibles = 60; rendreCompta($("#contenu")); }
});

let attenteCompta;
document.addEventListener("input", (e) => {
  if (e.target.id !== "c-recherche" || !compta.donnees) return;
  clearTimeout(attenteCompta);
  attenteCompta = setTimeout(() => { compta.recherche = e.target.value; rendreCompta($("#contenu")); const c = $("#c-recherche"); c.focus(); c.setSelectionRange(c.value.length, c.value.length); }, 250);
});
