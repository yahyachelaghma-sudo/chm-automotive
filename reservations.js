/* ═══════════════════════════════════════════════════════════════
   RÉSERVATIONS : liste, fiche détaillée, saisie, blocages
   ═══════════════════════════════════════════════════════════════ */
const filtres = { statut: "toutes", periode: "toutes", voiture: "", tri: "debut-desc", recherche: "", visibles: 40 };

// ---------- Prix (même calcul que le serveur ; le serveur recalcule toujours) ----------
function remisePour(jours) {
  return (etat.agence.remises ?? []).filter((r) => jours >= r.jours_min).reduce((m, r) => Math.max(m, r.pourcentage), 0);
}
function devisLocal(voiture, jours, idsOptions) {
  const location = jours * voiture.prix_par_jour, remise = remisePour(jours);
  const montantRemise = Math.round((location * remise) / 100);
  const options = (etat.agence.options ?? []).filter((o) => idsOptions.includes(o.id)).map((o) => ({ nom: o.nom, montant: o.par === "jour" ? o.prix * jours : o.prix }));
  return { location, remise, montantRemise, options, total: location - montantRemise + options.reduce((s, o) => s + o.montant, 0) };
}
const joursLocation = (debut, fin) => Math.max(1, joursEntre(debut, fin));
const conflit = (voitureId, debut, fin, sauf) => etat.reservations.find((r) =>
  r.voiture_id === voitureId && r.numero !== sauf && r.statut !== "annulée" && debut < finOccupee(r) && r.date_debut < (fin > debut ? fin : ajouterJours(debut, 1)));

// ---------- Liste ----------
function appliquerFiltres() {
  const aujourdhuiISO = aujourdhui(), finSemaine = ajouterJours(aujourdhuiISO, 7);
  const texte = normaliser(etat.recherche || "");
  let liste = etat.reservations.filter(estReservation);
  const parStatut = (s) => liste.filter((r) => s === "toutes" || r.statut === s).length;
  const compte = Object.fromEntries(["toutes", "en attente", "confirmée", "en cours", "terminée", "annulée"].map((s) => [s, parStatut(s)]));
  liste = liste.filter((r) =>
    (filtres.statut === "toutes" || r.statut === filtres.statut) &&
    (!filtres.voiture || r.voiture_id === filtres.voiture) &&
    (!texte || normaliser(`${r.numero} ${nomClient(r)} ${r.client.telephone} ${r.voiture} ${r.client.email ?? ""}`).includes(texte)) &&
    ({ toutes: () => true, aujourdhui: () => r.date_debut <= aujourdhuiISO && finOccupee(r) > aujourdhuiISO, semaine: () => r.date_debut <= finSemaine && finOccupee(r) > aujourdhuiISO,
       avenir: () => r.date_debut >= aujourdhuiISO, passees: () => r.date_fin < aujourdhuiISO, impayes: () => reste(r) > 0 && r.statut !== "annulée",
       edl: () => (r.statut === "confirmée" && !r.etat_depart && r.date_debut <= finSemaine) || (r.statut === "en cours" && !r.etat_retour && r.date_fin <= finSemaine) }[filtres.periode]?.() ?? true));
  const tris = { "debut-desc": (a, b) => b.date_debut.localeCompare(a.date_debut), "debut-asc": (a, b) => a.date_debut.localeCompare(b.date_debut), "creation": (a, b) => b.cree_le.localeCompare(a.cree_le) };
  return { liste: liste.sort(tris[filtres.tri]), compte };
}

// Photo + gamme du véhicule, comme dans le catalogue
function cellVehicule(r) {
  const v = compteVoiture(r.voiture_id);
  return `<div class="cellule-vehicule"><img class="mini-photo" src="${urlPhoto(v)}" alt="" loading="lazy">
    <div class="cellule-principale"><strong>${echapper(r.voiture)}</strong><span>${v?.gamme ? `<b class="gamme">${echapper(v.gamme)}</b>` : ""}${v?.immatriculation ? ` ${ltr(v.immatriculation)}` : ` ${echapper(r.lieu_depart)}`}</span></div></div>`;
}

// État du véhicule avant la prise / après le retour, visible d'un coup d'œil dans la liste
function cellEtatDesLieux(r, moment) {
  if (!["confirmée", "en cours", "terminée"].includes(r.statut)) return `<span class="gris">—</span>`;
  const e = r[CLE_MOMENT[moment]], cible = `data-edl-rapide="${r.numero}:${moment}"`;
  if (!e) {
    if (moment === "retour" && r.statut !== "terminée" && r.statut !== "en cours") return `<span class="gris petit">au retour</span>`;
    const urgent = moment === "depart" ? r.statut === "confirmée" && r.date_debut <= ajouterJours(aujourdhui(), 1) : r.statut === "en cours" && r.date_fin <= aujourdhui();
    return `<button type="button" class="edl-cell vide ${urgent ? "urgent" : ""}" ${cible}>${icone("plus")}<span>${urgent ? "À faire" : "Ajouter"}</span></button>`;
  }
  const nb = e.photos?.length ?? 0;
  return `<button type="button" class="edl-cell fait ${e.dommages ? "dommage" : ""}" ${cible} title="Voir / compléter l'état des lieux">
    <b class="mono">${e.km != null ? e.km.toLocaleString("fr-FR") + " km" : "—"}</b>
    <small>${NIVEAUX_CARBURANT[e.carburant] ?? echapper(e.carburant)} · <span class="${nb ? "" : "gris"}">📷 ${nb}</span>${e.dommages ? ` · <span class="rouge-texte">⚠ dommage</span>` : ""}</small></button>`;
}

function ligneReservation(r) {
  const nouveau = etat.nouvelles.has(r.numero);
  const part = r.total ? Math.min(100, Math.round((encaisse(r) / r.total) * 100)) : 0;
  const paiement = r.statut === "annulée" ? `<span class="gris">—</span>` : reste(r) === 0 ? badge("badge-valide", "Payé", "check") : `<strong class="mono">${da(reste(r))}</strong><div class="suivi"><i style="width:${part}%"></i></div>`;
  return `<tr data-res="${r.numero}" class="${nouveau ? "nouveau" : ""}">
    <td data-label="N°" class="mono"><strong style="color:var(--blanc)">${r.numero}</strong><br><span class="gris petit">${r.source === "site" ? "🌐 site" : "🏢 agence"}</span></td>
    <td data-label="Client" class="cellule-principale"><strong>${echapper(nomClient(r))}</strong><span>${ltr(r.client.telephone)}</span></td>
    <td data-label="Véhicule" class="plein">${cellVehicule(r)}</td>
    <td data-label="Période" class="cellule-principale mono"><strong>${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)}</strong><span>${pluriel(r.jours, "jour")}</span></td>
    <td data-label="Total" class="mono"><strong style="color:var(--blanc)">${da(r.total)}</strong></td>
    <td data-label="À encaisser">${paiement}</td>
    <td data-label="État avant la prise">${cellEtatDesLieux(r, "depart")}</td>
    <td data-label="État après le retour">${cellEtatDesLieux(r, "retour")}</td>
    <td data-label="Statut" class="plein">${badgeStatut(r.statut)}${enRetard(r) ? ` ${badge("badge-annulee", "en retard", "alerte")}` : departEnRetard(r) ? ` ${badge("badge-alerte", "à remettre", "alerte")}` : ""}</td></tr>`;
}

function rendreReservations(conteneur) {
  filtres.recherche = etat.recherche || "";
  const { liste, compte } = appliquerFiltres();
  const noms = { toutes: "Toutes", "en attente": "En attente", "confirmée": "Confirmées", "en cours": "En cours", "terminée": "Terminées", "annulée": "Annulées" };
  conteneur.innerHTML = `
    <div class="entete-vue">
      <div><h2>Réservations</h2><p>${pluriel(liste.length, "réservation")}${etat.recherche ? ` pour « ${echapper(etat.recherche)} »` : ""}</p></div>
      <div class="actions">
        <button class="btn btn-contour" data-exporter>${icone("telecharger")}Exporter (Excel)</button>
      </div>
    </div>
    <div class="barre-filtres">
      <div class="puces">${Object.entries(noms).map(([s, n]) => `<button class="puce ${filtres.statut === s ? "actif" : ""}" data-statut="${s}">${n} <b>${compte[s]}</b></button>`).join("")}</div>
    </div>
    <div class="barre-filtres">
      <select id="f-periode" aria-label="Période">
        <option value="toutes">Toutes les dates</option><option value="aujourdhui">En cours aujourd'hui</option><option value="semaine">Cette semaine</option>
        <option value="avenir">À venir</option><option value="passees">Passées</option><option value="impayes">Reste à payer</option><option value="edl">État des lieux à faire</option></select>
      <select id="f-voiture" aria-label="Véhicule"><option value="">Tous les véhicules</option>${etat.voitures.map((v) => `<option value="${v.id}">${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select>
      <select id="f-tri" aria-label="Tri"><option value="debut-desc">Départ : récent d'abord</option><option value="debut-asc">Départ : proche d'abord</option><option value="creation">Dernières saisies</option></select>
      ${etat.recherche ? `<button class="btn btn-contour btn-petit" data-effacer-recherche>✕ Effacer la recherche</button>` : ""}
    </div>
    <div class="carte tableau-boite">
      ${liste.length ? `<table class="tableau tableau-res"><thead><tr><th>N°</th><th>Client</th><th>Véhicule · gamme</th><th>Période</th><th>Total</th><th>À encaisser</th><th>État avant la prise</th><th>État après le retour</th><th>Statut</th></tr></thead>
        <tbody>${liste.slice(0, filtres.visibles).map(ligneReservation).join("")}</tbody></table>
        ${liste.length > filtres.visibles ? `<div style="padding:14px;text-align:center"><button class="btn btn-contour" data-plus>Afficher plus (${liste.length - filtres.visibles})</button></div>` : ""}`
      : `<div class="vide-grand"><strong>Aucune réservation</strong>Essayez d'autres filtres, ou créez une réservation prise par téléphone.</div>`}
    </div>`;
  $("#f-periode").value = filtres.periode; $("#f-voiture").value = filtres.voiture; $("#f-tri").value = filtres.tri;
}

enregistrerVue("reservations", { titre: "Réservations", icone: "reservations", rendre: rendreReservations });

function exporterCSV() {
  const { liste } = appliquerFiltres();
  const colonnes = ["N°", "Statut", "Origine", "Client", "Téléphone", "Email", "Véhicule", "Gamme", "Km au départ", "Carburant au départ", "Km au retour", "Carburant au retour", "Dommage", "Départ", "Retour", "Jours", "Total (DA)", "Payé (DA)", "Reste (DA)", "Mode de paiement", "Créée le"];
  const cellule = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lignes = liste.map((r) => [r.numero, r.statut, r.source, nomClient(r), r.client.telephone, r.client.email, r.voiture, compteVoiture(r.voiture_id)?.gamme, r.etat_depart?.km, r.etat_depart?.carburant, r.etat_retour?.km, r.etat_retour?.carburant, (r.etat_depart?.dommages || r.etat_retour?.dommages) ? "oui" : "", r.date_debut, r.date_fin, r.jours, r.total, r.paye || 0, reste(r), r.paiement_souhaite?.mode, r.cree_le.slice(0, 10)].map(cellule).join(";"));
  const blob = new Blob(["﻿" + [colonnes.map(cellule).join(";"), ...lignes].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const lien = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `reservations-${aujourdhui()}.csv` });
  document.body.append(lien); lien.click(); lien.remove();
  notifier(`${pluriel(liste.length, "réservation exportée")}`);
}

// ---------- Fiche détaillée ----------
function messageWhatsApp(r) {
  const nom = etat.agence.nom, prenom = r.client.prenom, v = r.voiture, du = dateFr(r.date_debut), au = dateFr(r.date_fin);
  return {
    "en attente": `Bonjour ${prenom}, c'est ${nom}. Nous avons bien reçu votre demande ${r.numero} pour la ${v} du ${du} au ${au}. Nous revenons vers vous pour la confirmer.`,
    "confirmée": `Bonjour ${prenom}, votre réservation ${r.numero} est confirmée : ${v} du ${du} au ${au}. Total : ${da(r.total)}. N'oubliez pas votre permis et votre pièce d'identité. À bientôt ! — ${nom}`,
    "en cours": `Bonjour ${prenom}, c'est ${nom}. Un petit rappel : le retour de la ${v} est prévu le ${au}${r.heure_retour ? " à " + r.heure_retour : ""}. Bonne route !`,
    "terminée": `Merci ${prenom} d'avoir choisi ${nom} ! Nous espérons que tout s'est bien passé. À très bientôt.`,
    "annulée": `Bonjour ${prenom}, votre réservation ${r.numero} a bien été annulée. N'hésitez pas à nous recontacter. — ${nom}`,
  }[r.statut];
}

function sectionPaires(titre, paires) {
  return `<section class="section-tiroir"><h4>${titre}</h4><div class="paires">${paires.map(([nom, valeur, large]) => `<div class="paire ${large ? "large" : ""}"><small>${nom}</small><strong>${valeur}</strong></div>`).join("")}</div></section>`;
}

function rendreTiroirReservation(numero) {
  const r = etat.reservations.find((x) => x.numero === numero);
  if (!r) return { titre: "Introuvable", corps: `<p class="gris">Cette réservation n'existe plus.</p>` };
  const dossier = dossierDe(r), restant = reste(r), kmTotal = (etat.agence.tarifs_supplementaires?.km_inclus_par_jour ?? 300) * r.jours;
  const modes = [...new Map([...(etat.agence.paiement_modes ?? []), { id: r.paiement_souhaite?.mode, nom: r.paiement_souhaite?.mode }].filter((m) => m.id).map((m) => [m.id, m])).values()];
  const actions = {
    "en attente": [["confirmée", "check", "Confirmer la réservation", "btn-vert"], ["annulée", "croix", "Refuser", "btn-danger"]],
    "confirmée": [["en cours", "cle", "Remettre les clés", "btn-vert"], ["annulée", "croix", "Annuler", "btn-danger"]],
    "en cours": [["terminée", "drapeau", "Enregistrer le retour", "btn-vert"]],
    "terminée": [],
    "annulée": [["confirmée", "check", "Réactiver", "btn-contour"]],
  }[r.statut];
  const alertes = [];
  if (enRetard(r)) alertes.push(`<div class="alerte rouge">⚠️ Retour en retard de ${pluriel(joursEntre(r.date_fin, aujourdhui()), "jour")} — pensez à appeler le client.</div>`);
  if (departEnRetard(r)) alertes.push(`<div class="alerte">⚠️ Le départ était prévu le ${dateFr(r.date_debut)} et les clés n'ont pas été remises.</div>`);
  if (r.statut !== "annulée" && r.statut !== "terminée" && !dossier) alertes.push(`<div class="alerte">📁 Aucun dossier client (permis, pièce d'identité) reçu pour cette réservation.</div>`);
  if (dossier && dossier.statut === "refusé") alertes.push(`<div class="alerte rouge">📁 Le dossier de ce client a été refusé.</div>`);
  const sous = `${badgeStatut(r.statut)}<span class="gris petit">${r.source === "site" ? "🌐 Réservée sur le site" : "🏢 Saisie à l'agence"} · ${heureFr(r.cree_le)}</span>`;

  return {
    titre: `${r.numero} · ${echapper(nomClient(r))}`, sousTitre: sous,
    corps: `
      ${alertes.length ? `<div class="alertes">${alertes.join("")}</div>` : ""}
      ${actions.length ? `<div class="actions-statut">${actions.map(([s, ico, texte, cls]) => `<button class="btn ${cls}" data-act="statut" data-valeur="${s}">${icone(ico)}${texte}</button>`).join("")}</div>` : ""}

      <section class="section-tiroir"><h4>Client</h4>
        <div class="paires">
          <div class="paire"><small>Téléphone</small><strong class="mono">${ltr(r.client.telephone)}</strong></div>
          <div class="paire"><small>Email</small><strong>${echapper(r.client.email || "—")}</strong></div>
          ${r.client.message ? `<div class="paire large"><small>Message du client</small><strong>${echapper(r.client.message)}</strong></div>` : ""}
        </div>
        <div class="actions" style="margin-top:10px">
          <a class="btn btn-contour btn-petit" href="tel:${echapper(r.client.telephone)}">${icone("tel")}Appeler</a>
          <a class="btn btn-whatsapp btn-petit" target="_blank" rel="noopener" href="${lienWhatsApp(r.client.telephone, messageWhatsApp(r))}">${icone("message")}WhatsApp</a>
          ${r.client.email ? `<a class="btn btn-contour btn-petit" href="mailto:${echapper(r.client.email)}">✉ Email</a>` : ""}
        </div>
      </section>

      ${sectionPaires("Location", [
        ["Véhicule", echapper(r.voiture), true],
        ["Départ", `${dateFr(r.date_debut)}${r.heure_depart ? " · " + r.heure_depart : ""}`], ["Retour", `${dateFr(r.date_fin)}${r.heure_retour ? " · " + r.heure_retour : ""}`],
        ["Lieu de départ", echapper(r.lieu_depart)], ["Lieu de retour", echapper(r.lieu_retour)],
        ["Durée", pluriel(r.jours, "jour")], ["Kilométrage inclus", `${kmTotal.toLocaleString("fr-FR")} km`],
      ])}

      ${sectionEtatDesLieux(r, kmTotal)}

      <section class="section-tiroir"><h4>Prix et paiement</h4>
        <div class="lignes-prix">
          <div class="ligne-prix"><span>Location (${pluriel(r.jours, "jour")})</span><span class="mono">${da(r.prix?.location ?? r.total)}</span></div>
          ${r.prix?.remise ? `<div class="ligne-prix remise"><span>Remise ${r.prix.remise} %</span><span class="mono">− ${da(r.prix.montant_remise)}</span></div>` : ""}
          ${(r.prix?.options ?? []).map((o) => `<div class="ligne-prix"><span>${echapper(o.nom)}</span><span class="mono">${da(o.montant)}</span></div>`).join("")}
          <div class="ligne-prix total"><span>Total</span><span class="mono">${da(r.total)}</span></div>
          <div class="ligne-prix"><span>Déjà encaissé</span><span class="mono">${da(encaisse(r))}</span></div>
          <div class="ligne-prix reste"><span>Reste à encaisser</span><span class="mono">${da(restant)}</span></div>
        </div>
        <div class="encaisser" style="margin-top:12px">
          <label>Montant encaissé (total)<input type="number" min="0" step="500" id="champ-paye" value="${encaisse(r)}"></label>
          <label>Mode<select id="champ-mode">${modes.map((m) => `<option value="${echapper(m.id)}" ${m.id === r.paiement_souhaite?.mode ? "selected" : ""}>${echapper(m.nom)}</option>`).join("")}</select></label>
          <button class="btn btn-contour" data-act="paye">Enregistrer</button>
          ${restant ? `<button class="btn btn-vert" data-act="tout-encaisser">${icone("argent")}Encaisser ${da(restant)}</button>` : ""}
        </div>
        <label class="case" style="margin-top:12px"><input type="checkbox" data-act="caution" ${r.caution_recue ? "checked" : ""}> Caution de ${da(r.caution)} encaissée</label>
      </section>

      <section class="section-tiroir"><h4>Dossier client</h4>
        ${dossier ? `<div class="paire"><small>${echapper(dossier.numero)} · ${echapper(dossier.prenom)} ${echapper(dossier.nom)}</small>
            <strong>${badge(dossier.statut === "validé" ? "badge-valide" : dossier.statut === "refusé" ? "badge-refuse" : "badge-attente", dossier.statut)}</strong></div>
          <div class="actions" style="margin-top:10px"><button class="btn btn-contour btn-petit" data-act="dossier" data-valeur="${dossier.numero}">${icone("dossier")}Ouvrir le dossier</button></div>`
        : `<p class="gris petit">Aucun dossier reçu. Envoyez le lien au client pour qu'il dépose ses documents.</p>
          <div class="actions" style="margin-top:10px"><a class="btn btn-whatsapp btn-petit" target="_blank" rel="noopener" href="${lienWhatsApp(r.client.telephone, `Bonjour ${r.client.prenom}, pour préparer votre location (${r.numero}), merci de déposer votre dossier (permis et pièce d'identité) ici : ${location.origin}/site/#dossier — ${etat.agence.nom}`)}">${icone("message")}Demander le dossier</a></div>`}
      </section>

      <section class="section-tiroir"><h4>Notes internes</h4>
        <textarea id="champ-notes" placeholder="Ex. : client fidèle, livraison à l'aéroport vol AH1234…">${echapper(r.notes || "")}</textarea>
        <div class="actions" style="margin-top:8px"><button class="btn btn-contour btn-petit" data-act="notes">Enregistrer la note</button></div>
      </section>

      <section class="section-tiroir"><h4>Actions</h4>
        <div class="actions">
          <a class="btn btn-contour" href="contrat.html?n=${r.numero}" target="_blank" rel="noopener">${icone("imprimer")}Contrat à imprimer</a>
          <button class="btn btn-contour" data-act="modifier">${icone("editer")}Modifier</button>
          ${estAdmin() ? `<button class="btn btn-danger" data-act="supprimer">${icone("corbeille")}Supprimer</button>` : ""}
        </div>
      </section>

      <section class="section-tiroir"><h4>Historique</h4>
        <ul class="historique">${[...(r.historique ?? [])].reverse().map((h) => `<li>${echapper(h.action)}<small>${echapper(h.par)} · ${heureFr(h.le)}</small></li>`).join("")}</ul>
      </section>`,
  };
}

function ouvrirReservation(numero) {
  const r = etat.reservations.find((x) => x.numero === numero);
  if (!r) return notifier("Réservation introuvable.", "erreur");
  if (r.statut === "blocage") return ouvrirBlocage(numero);
  etat.nouvelles.delete(numero);
  ouvrirTiroir(() => rendreTiroirReservation(numero));
  etat.numeroOuvert = numero;
  dessinerMenu();
}

// ---------- État des lieux : compteur, carburant, dommages et PHOTOS (avant la prise / après le retour) ----------
const VUES_ETAT = { avant: "Avant", arriere: "Arrière", gauche: "Côté gauche", droite: "Côté droit", interieur: "Intérieur", compteur: "Compteur", dommage: "Dommage", autre: "Autre" };
const VUES_GUIDEES = ["avant", "arriere", "gauche", "droite", "interieur", "compteur"];
const CLE_MOMENT = { depart: "etat_depart", retour: "etat_retour" };
const urlPhotoEtat = (numero, moment, fichier) => `/api/employe/reservations/${numero}/photos/${moment}/${fichier}`;

// Les photos de téléphone sont lourdes : on les réduit (1600 px) avant l'envoi
async function preparerPhoto(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const image = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Photo illisible : format non pris en charge.")); i.src = url; });
    const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const toile = document.createElement("canvas");
    toile.width = Math.round(image.naturalWidth * ratio); toile.height = Math.round(image.naturalHeight * ratio);
    toile.getContext("2d").drawImage(image, 0, 0, toile.width, toile.height);
    return toile.toDataURL("image/jpeg", 0.82).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}

async function televerserPhotos(numero, moment, photos) {
  if (!photos.length) return;
  const message = notifier(`Envoi des photos… 0/${photos.length}`, "info", 180000);
  let envoyees = 0;
  const erreurs = [];
  for (const [i, p] of photos.entries()) {
    try {
      const maj = await api("POST", `/reservations/${numero}/photos/${moment}`, { vue: p.vue, contenu: await preparerPhoto(p.fichier) });
      etat.reservations[etat.reservations.findIndex((x) => x.numero === numero)] = maj;
      envoyees++;
    } catch (err) { erreurs.push(err.message); }
    message.textContent = `Envoi des photos… ${i + 1}/${photos.length}`;
  }
  message.remove();
  if (envoyees) notifier(`${pluriel(envoyees, "photo")} enregistrée${envoyees > 1 ? "s" : ""} ✓`);
  if (erreurs.length) notifier(`${pluriel(erreurs.length, "photo")} non envoyée${erreurs.length > 1 ? "s" : ""} : ${erreurs[0]}`, "erreur", 9000);
  rafraichirVue();
}

function ouvrirEtatDesLieux(r, type, options = {}) {
  return new Promise((resolve) => {
    const v = compteVoiture(r.voiture_id), depart = type === "depart", ex = r[CLE_MOMENT[type]];
    const km = ex?.km ?? (depart ? v?.kilometrage : (v?.kilometrage ?? r.etat_depart?.km)) ?? "";
    const emplacement = (vue) => `<div class="emplacement-photo" data-vue="${vue}"><span class="nom-vue">${VUES_ETAT[vue]}</span>
      <button type="button" class="visuel" data-choisir-photo aria-label="Prendre ou choisir une photo : ${VUES_ETAT[vue]}">📷</button>
      <input type="file" accept="image/*" capture="environment" hidden><button type="button" class="vignette-x" data-vider-photo aria-label="Retirer la photo">×</button></div>`;
    const corps = ouvrirFenetre(depart ? "État du véhicule avant la prise" : "État du véhicule après le retour", `
      <form id="form-edl" class="formulaire-colonne" style="max-width:none" novalidate>
        <p class="gris petit">${echapper(r.voiture)}${v?.immatriculation ? ` · ${ltr(v.immatriculation)}` : ""} · ${echapper(nomClient(r))}${depart ? "" : r.etat_depart ? ` · au départ : ${r.etat_depart.km ?? "?"} km` : ""}${ex?.photos?.length ? ` · ${pluriel(ex.photos.length, "photo")} déjà enregistrée${ex.photos.length > 1 ? "s" : ""}` : ""}</p>
        <div class="grille-form">
          <label>Kilométrage au compteur<input type="number" name="km" min="0" value="${km}"></label>
          <label>Niveau de carburant / batterie<select name="carburant">${Object.entries(NIVEAUX_CARBURANT).map(([k, n]) => `<option value="${k}" ${k === (ex?.carburant ?? (depart ? "plein" : r.etat_depart?.carburant ?? "plein")) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="large">${depart ? "Dommages ou rayures déjà présents (facultatif)" : "Remarques (facultatif)"}<input name="note" value="${echapper(ex?.note ?? "")}" placeholder="${depart ? "Ex. : rayure légère portière avant gauche" : "Ex. : pare-chocs arrière rayé"}"></label>
        </div>
        <label class="case"><input type="checkbox" name="dommages" ${ex?.dommages ? "checked" : ""}> ${depart ? "Le véhicule présente déjà des dommages" : "Un nouveau dommage a été constaté au retour"}</label>
        <div><span class="petit gris" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px">Photos du véhicule</span>
          <p class="aide-petit" style="margin:4px 0 10px">Prenez les 6 vues pour protéger l'agence et le client en cas de litige. Sur téléphone, le bouton ouvre directement l'appareil photo.</p>
          <div class="photos-etat" id="photos-etat">${VUES_GUIDEES.map(emplacement).join("")}<button type="button" class="emplacement-photo ajouter" data-ajouter-photo>＋ Autre photo<small>dommage, détail…</small></button></div></div>
        <p class="erreur-form" hidden></p>
        <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-non>Annuler</button>${options.complement ? "" : `<button type="button" class="btn btn-contour" data-passer>Passer cette étape</button>`}
          <button class="btn btn-vert" type="submit">${options.complement ? "Enregistrer" : depart ? "Enregistrer et remettre les clés" : "Enregistrer le retour"}</button></div>
      </form>`, 760);
    const f = corps.querySelector("form");
    $(".fenetre-fond").removeAttribute("data-fermer-fenetre");
    const fin = (valeur) => { fermerFenetre(); $(".fenetre-fond").setAttribute("data-fermer-fenetre", ""); resolve(valeur); };
    corps.querySelector("[data-non]").onclick = () => fin(null);
    corps.querySelector("[data-passer]")?.addEventListener("click", () => fin("passer"));
    corps.addEventListener("click", (e) => {
      const choisir = e.target.closest("[data-choisir-photo]");
      if (choisir) return choisir.closest(".emplacement-photo").querySelector("input[type=file]").click();
      const vider = e.target.closest("[data-vider-photo]");
      if (vider) {
        const case_ = vider.closest(".emplacement-photo");
        case_.querySelector("input[type=file]").value = ""; case_.classList.remove("rempli"); case_.querySelector(".visuel").style.backgroundImage = "";
        if (case_.dataset.supplementaire) case_.remove();
        return;
      }
      if (e.target.closest("[data-ajouter-photo]")) {
        const case_ = document.createElement("div");
        case_.className = "emplacement-photo"; case_.dataset.supplementaire = "1";
        case_.innerHTML = `<select class="vue-photo" aria-label="Type de photo"><option value="dommage">Dommage</option><option value="autre">Autre</option></select>
          <button type="button" class="visuel" data-choisir-photo aria-label="Prendre ou choisir une photo">📷</button><input type="file" accept="image/*" capture="environment" hidden><button type="button" class="vignette-x" data-vider-photo aria-label="Retirer la photo">×</button>`;
        e.target.closest("[data-ajouter-photo]").before(case_);
        case_.querySelector("input[type=file]").click();
      }
    });
    corps.addEventListener("change", (e) => {
      const input = e.target.closest(".emplacement-photo input[type=file]");
      const fichier = input?.files[0];
      if (!fichier) return;
      if (!fichier.type.startsWith("image/")) { notifier("Choisissez une photo (JPG, PNG, WebP).", "erreur"); input.value = ""; return; }
      const case_ = input.closest(".emplacement-photo");
      case_.classList.add("rempli");
      case_.querySelector(".visuel").style.backgroundImage = `url("${URL.createObjectURL(fichier)}")`;
      case_.querySelector(".visuel").textContent = "";
    });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const photos = $$(".emplacement-photo.rempli", f).map((c) => ({ vue: c.querySelector("select")?.value ?? c.dataset.vue, fichier: c.querySelector("input[type=file]").files[0] }));
      fin({ km: f.km.value, carburant: f.carburant.value, dommages: f.dommages.checked, note: f.note.value.trim(), photos });
    });
  });
}

// Section de la fiche : ce qui a été relevé et photographié, avant et après
function sectionEtatDesLieux(r, kmTotal) {
  if (!["confirmée", "en cours", "terminée"].includes(r.statut)) return "";
  const bloc = (moment, titre) => {
    const e = r[CLE_MOMENT[moment]], photos = e?.photos ?? [];
    return `<div class="bloc-edl">
      <div class="bloc-edl-tete"><strong>${titre}</strong>${e ? `<span class="gris petit">${heureFr(e.le)} · ${echapper(e.par)}</span>` : ""}</div>
      ${e ? `<div class="paires"><div class="paire"><small>Kilométrage</small><strong class="mono">${e.km != null ? e.km.toLocaleString("fr-FR") + " km" : "—"}</strong></div>
        <div class="paire"><small>Carburant / batterie</small><strong>${NIVEAUX_CARBURANT[e.carburant] ?? echapper(e.carburant)}</strong></div>
        ${e.dommages || e.note ? `<div class="paire large"><small>${e.dommages ? "Dommage signalé" : "Remarque"}</small><strong style="${e.dommages ? "color:#ff9a9a" : ""}">${echapper(e.note || "Dommage constaté")}</strong></div>` : ""}</div>` : `<p class="gris petit">Pas encore réalisé.</p>`}
      ${photos.length ? `<div class="vignettes">${photos.map((p) => `<div class="vignette" data-doc="${urlPhotoEtat(r.numero, moment, p.fichier)}" data-pdf="false" title="${VUES_ETAT[p.vue] ?? ""}">
        <img src="${urlPhotoEtat(r.numero, moment, p.fichier)}" alt="" loading="lazy"><span>${VUES_ETAT[p.vue] ?? echapper(p.vue)}</span>
        ${estAdmin() ? `<button class="vignette-x" data-act="suppr-photo" data-moment="${moment}" data-fichier="${p.fichier}" aria-label="Supprimer la photo">×</button>` : ""}</div>`).join("")}</div>` : ""}
      <div class="actions" style="margin-top:10px"><button class="btn btn-contour btn-petit" data-act="edl" data-moment="${moment}">${icone(e ? "editer" : "plus")}${e ? "Compléter / ajouter des photos" : "Faire l'état des lieux + photos"}</button></div></div>`;
  };
  const des_photos = [r.etat_depart, r.etat_retour].some((e) => e?.photos?.length);
  const parcourus = r.etat_depart?.km != null && r.etat_retour?.km != null ? r.etat_retour.km - r.etat_depart.km : null;
  return `<section class="section-tiroir"><h4>État du véhicule : avant et après</h4>
    ${bloc("depart", "Avant la prise")}${r.statut === "terminée" || r.etat_retour ? bloc("retour", "Après le retour") : ""}
    ${parcourus !== null ? `<div class="paire" style="margin-top:12px"><small>Kilomètres parcourus</small><strong>${parcourus.toLocaleString("fr-FR")} km <span class="gris" style="font-weight:500">(inclus : ${kmTotal.toLocaleString("fr-FR")} km)</span>${parcourus > kmTotal ? ` ${badge("badge-alerte", "dépassement", "alerte")}` : ""}</strong></div>` : ""}
    ${des_photos ? `<div class="actions" style="margin-top:12px"><button class="btn btn-contour" data-act="comparer">${icone("dossier")}Comparer avant / après</button></div>` : ""}</section>`;
}

function ouvrirComparaison(r) {
  const d = r.etat_depart, ret = r.etat_retour;
  const vues = Object.keys(VUES_ETAT).filter((v) => [d, ret].some((e) => (e?.photos ?? []).some((p) => p.vue === v)));
  const cellule = (moment, e, vue) => {
    const ps = (e?.photos ?? []).filter((p) => p.vue === vue);
    return ps.length ? ps.map((p) => `<div class="vignette grande" data-doc="${urlPhotoEtat(r.numero, moment, p.fichier)}" data-pdf="false"><img src="${urlPhotoEtat(r.numero, moment, p.fichier)}" alt="" loading="lazy"></div>`).join("") : `<div class="vide-photo">Pas de photo</div>`;
  };
  const tete = (titre, e) => `<div class="comp-tete"><strong>${titre}</strong>${e ? `<span>${e.km != null ? e.km.toLocaleString("fr-FR") + " km · " : ""}${NIVEAUX_CARBURANT[e.carburant] ?? ""}${e.dommages ? ` · <b style="color:#ff9a9a">dommage</b>` : ""}</span>${e.note ? `<span class="gris">${echapper(e.note)}</span>` : ""}` : `<span class="gris">Pas encore réalisé</span>`}</div>`;
  ouvrirFenetre(`Comparer l'état — ${r.voiture}`, `<p class="gris petit">${echapper(nomClient(r))} · ${dateFr(r.date_debut)} → ${dateFr(r.date_fin)} · cliquez sur une photo pour l'agrandir</p>
    <div class="comparaison"><div></div>${tete("Avant la prise", d)}${tete("Après le retour", ret)}
    ${vues.map((v) => `<div class="comp-vue">${VUES_ETAT[v]}</div><div class="comp-cell">${cellule("depart", d, v)}</div><div class="comp-cell">${cellule("retour", ret, v)}</div>`).join("")}</div>`, 1000);
}

async function majReservation(numero, changements, message) {
  const maj = await api("PATCH", `/reservations/${numero}`, changements);
  etat.reservations[etat.reservations.findIndex((r) => r.numero === numero)] = maj;
  if (message) notifier(message);
  rafraichirVue();
  return maj;
}

// Renseigne l'état du véhicule (km, carburant, dommages, photos) sans changer le statut de la location
async function faireEtatDesLieux(r, moment, bouton) {
  const edl = await ouvrirEtatDesLieux(r, moment, { complement: true });
  if (!edl || edl === "passer") return;
  const { photos = [], ...donnees } = edl;
  return agir(bouton, async () => {
    await majReservation(r.numero, { [CLE_MOMENT[moment]]: donnees }, "État des lieux enregistré ✓");
    etat.voitures = await api("GET", "/voitures");
    await televerserPhotos(r.numero, moment, photos);
  });
}

async function actionReservation(e) {
  const cible = e.target.closest("[data-act]");
  if (!cible || !etat.numeroOuvert) return;
  const numero = etat.numeroOuvert, r = etat.reservations.find((x) => x.numero === numero);
  const act = cible.dataset.act;
  const messages = { "confirmée": "Réservation confirmée ✓", "en cours": "Clés remises : location en cours", "terminée": "Retour enregistré", "annulée": "Réservation annulée" };
  if (act === "caution") return agir(null, () => majReservation(numero, { caution_recue: cible.checked }, cible.checked ? "Caution encaissée" : "Caution rendue"));
  if (e.type !== "click") return;
  if (act === "statut") {
    const s = cible.dataset.valeur;
    if (s === "annulée" && !(await confirmer(`Annuler la réservation ${numero} de ${echapper(nomClient(r))} ?`, "Oui, annuler", true))) return;
    if (s === "terminée" && (reste(r) > 0 || (r.caution_recue)) &&
      !(await confirmer(`${reste(r) > 0 ? `Il reste <b>${da(reste(r))}</b> à encaisser. ` : ""}${r.caution_recue ? `La caution de ${da(r.caution)} est encaissée : pensez à la rendre. ` : ""}Enregistrer le retour quand même ?`, "Enregistrer le retour"))) return;
    let complement = {}, photos = [];
    const moment = s === "en cours" ? "depart" : "retour";
    if (s === "en cours" || s === "terminée") {
      const edl = await ouvrirEtatDesLieux(r, moment);
      if (edl === null) return;
      if (edl !== "passer") { ({ photos = [], ...complement } = edl); complement = { [CLE_MOMENT[moment]]: complement }; }
    }
    return agir(cible, async () => {
      await majReservation(numero, { statut: s, ...complement }, messages[s]);
      if (complement.etat_depart || complement.etat_retour) etat.voitures = await api("GET", "/voitures");
      await televerserPhotos(numero, moment, photos);
      rafraichirVue();
    });
  }
  if (act === "paye") return agir(cible, () => majReservation(numero, { paye: Number($("#champ-paye").value || 0), paiement_mode: $("#champ-mode").value }, "Paiement enregistré"));
  if (act === "tout-encaisser") return agir(cible, () => majReservation(numero, { paye: r.total, paiement_mode: $("#champ-mode").value }, "Paiement complet enregistré ✓"));
  if (act === "notes") return agir(cible, () => majReservation(numero, { notes: $("#champ-notes").value }, "Note enregistrée"));
  if (act === "modifier") return ouvrirFormulaireReservation(r, numero);
  if (act === "comparer") return ouvrirComparaison(r);
  if (act === "edl") return faireEtatDesLieux(r, cible.dataset.moment, cible);
  if (act === "suppr-photo") {
    if (!(await confirmer("Supprimer cette photo ? Elle ne pourra pas être récupérée.", "Supprimer", true))) return;
    return agir(cible, async () => {
      const maj = await api("DELETE", `/reservations/${numero}/photos/${cible.dataset.moment}/${cible.dataset.fichier}`);
      etat.reservations[etat.reservations.findIndex((x) => x.numero === numero)] = maj;
      rafraichirVue();
    }, "Photo supprimée");
  }
  if (act === "dossier") return ouvrirDossier(cible.dataset.valeur);
  if (act === "supprimer") {
    if (!(await confirmer(`Supprimer définitivement la réservation ${numero} ? Préférez « Annuler » pour garder une trace.`, "Supprimer", true))) return;
    return agir(cible, async () => { await api("DELETE", `/reservations/${numero}`); etat.reservations = etat.reservations.filter((x) => x.numero !== numero); fermerTiroir(); rafraichirVue(); }, "Réservation supprimée");
  }
}
$("#tiroir-corps").addEventListener("click", actionReservation);
$("#tiroir-corps").addEventListener("change", (e) => e.target.matches("[data-act=caution]") && actionReservation(e));

// ---------- Formulaire de saisie / modification ----------
function ouvrirFormulaireReservation(donnees = {}, numeroEdition = null) {
  const edition = Boolean(numeroEdition);
  const a = etat.agence, auj = aujourdhui();
  const d = { voiture_id: "", date_debut: auj, date_fin: ajouterJours(auj, 3), heure_depart: "10:00", heure_retour: "10:00", lieu_depart: a.lieux?.[0], lieu_retour: a.lieux?.[0], options: [], client: {}, notes: "", paiement_souhaite: { mode: a.paiement_modes?.[0]?.id }, ...donnees };
  const voituresTriees = [...etat.voitures].sort((x, y) => `${x.marque} ${x.modele}`.localeCompare(`${y.marque} ${y.modele}`));
  const corps = ouvrirFenetre(edition ? `Modifier ${numeroEdition}` : "Nouvelle réservation", `
    <form id="form-reservation" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="grille-form">
        <label class="large">Véhicule<select name="voiture_id" required><option value="">Choisir un véhicule…</option>${voituresTriees.map((v) => `<option value="${v.id}" ${v.id === d.voiture_id ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)} — ${da(v.prix_par_jour)}/jour${v.disponible ? "" : " (hors ligne)"}</option>`).join("")}</select></label>
        <label>Départ<input type="date" name="date_debut" value="${d.date_debut}" ${edition ? "" : `min="${auj}"`} required></label>
        <label>Heure de départ<input type="time" name="heure_depart" value="${d.heure_depart || "10:00"}"></label>
        <label>Retour<input type="date" name="date_fin" value="${d.date_fin}" required></label>
        <label>Heure de retour<input type="time" name="heure_retour" value="${d.heure_retour || "10:00"}"></label>
        <label>Lieu de départ<select name="lieu_depart">${(a.lieux ?? []).map((l) => `<option ${l === d.lieu_depart ? "selected" : ""}>${echapper(l)}</option>`).join("")}</select></label>
        <label>Lieu de retour<select name="lieu_retour">${(a.lieux ?? []).map((l) => `<option ${l === d.lieu_retour ? "selected" : ""}>${echapper(l)}</option>`).join("")}</select></label>
      </div>
      <div><span class="petit gris" style="font-weight:700;text-transform:uppercase;letter-spacing:.5px">Options</span>
        <div class="cases-grille" style="margin-top:8px">${(a.options ?? []).map((o) => `<label class="case"><input type="checkbox" name="option" value="${o.id}" ${d.options.includes(o.id) ? "checked" : ""}> ${echapper(o.nom)} <small class="gris">+ ${da(o.prix)}/${o.par}</small></label>`).join("")}</div></div>
      <div class="grille-form">
        <label>Nom *<input name="nom" value="${echapper(d.client.nom ?? "")}" required></label>
        <label>Prénom *<input name="prenom" value="${echapper(d.client.prenom ?? "")}" required></label>
        <label>Téléphone *<input name="telephone" type="tel" value="${echapper(d.client.telephone ?? "")}" placeholder="05 55 12 34 56" required></label>
        <label>Email<input name="email" type="email" value="${echapper(d.client.email ?? "")}"></label>
        ${edition ? "" : `<label>Moyen de paiement prévu<select name="paiement_mode">${(a.paiement_modes ?? []).map((m) => `<option value="${echapper(m.id)}" ${m.id === d.paiement_souhaite?.mode ? "selected" : ""}>${echapper(m.nom)}</option>`).join("")}</select></label>`}
        <label class="${edition ? "large" : ""}">Notes internes<input name="notes" value="${echapper(d.notes ?? "")}" placeholder="Facultatif"></label>
      </div>
      <div class="apercu-prix" id="apercu-prix"></div>
      <p class="erreur-form" id="erreur-reservation" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button>
        <button type="submit" class="btn btn-rouge">${edition ? "Enregistrer les modifications" : "Créer la réservation"}</button></div>
    </form>`, 780);

  const f = corps.querySelector("form");
  const apercu = () => {
    const v = compteVoiture(f.voiture_id.value), zone = $("#apercu-prix");
    if (!v || !f.date_debut.value || !f.date_fin.value) { zone.innerHTML = `<span class="gris">Choisissez un véhicule et des dates pour voir le prix.</span>`; return; }
    if (f.date_fin.value < f.date_debut.value) { zone.innerHTML = `<span style="color:#ff8d8d">La date de retour doit être après le départ.</span>`; return; }
    const jours = joursLocation(f.date_debut.value, f.date_fin.value);
    const q = devisLocal(v, jours, $$("[name=option]:checked", f).map((i) => i.value));
    const pris = conflit(v.id, f.date_debut.value, f.date_fin.value, numeroEdition);
    zone.innerHTML = `${pris ? `<div class="alerte rouge" style="margin-bottom:10px">⚠️ Ce véhicule est déjà ${pris.statut === "blocage" ? "bloqué" : `réservé (${pris.numero})`} du ${dateFr(pris.date_debut)} au ${dateFr(pris.date_fin)}.</div>` : ""}
      <div class="ligne-prix"><span>${da(v.prix_par_jour)} × ${pluriel(jours, "jour")}</span><span class="mono">${da(q.location)}</span></div>
      ${q.remise ? `<div class="ligne-prix remise"><span>Remise ${q.remise} %</span><span class="mono">− ${da(q.montantRemise)}</span></div>` : ""}
      ${q.options.map((o) => `<div class="ligne-prix"><span>${echapper(o.nom)}</span><span class="mono">${da(o.montant)}</span></div>`).join("")}
      <div class="ligne-prix total"><span>Total</span><span class="mono">${da(q.total)}</span></div>
      <div class="ligne-prix"><span class="gris">Caution</span><span class="mono gris">${da(v.caution)}</span></div>`;
  };
  f.addEventListener("input", apercu); apercu();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = $("#erreur-reservation"); erreur.hidden = true;
    const donneesForm = {
      voiture_id: f.voiture_id.value, date_debut: f.date_debut.value, date_fin: f.date_fin.value, heure_depart: f.heure_depart.value, heure_retour: f.heure_retour.value,
      lieu_depart: f.lieu_depart.value, lieu_retour: f.lieu_retour.value, options: $$("[name=option]:checked", f).map((i) => i.value),
      nom: f.nom.value.trim(), prenom: f.prenom.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(), notes: f.notes.value.trim(),
    };
    if (!donneesForm.voiture_id) { erreur.textContent = "Choisissez un véhicule."; erreur.hidden = false; return; }
    const bouton = f.querySelector("[type=submit]"); bouton.disabled = true;
    try {
      if (edition) {
        const { nom, prenom, telephone, email, ...reste } = donneesForm;
        const maj = await api("PATCH", `/reservations/${numeroEdition}`, { ...reste, client: { nom, prenom, telephone, email } });
        etat.reservations[etat.reservations.findIndex((r) => r.numero === numeroEdition)] = maj;
        notifier("Réservation modifiée");
      } else {
        const nouvelle = await api("POST", "/reservations", { ...donneesForm, paiement: { mode: f.paiement_mode?.value } });
        etat.reservations.push(nouvelle);
        notifier(`Réservation ${nouvelle.numero} créée ✓`);
        fermerFenetre(); rafraichirVue(); return ouvrirReservation(nouvelle.numero);
      }
      fermerFenetre(); rafraichirVue();
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; bouton.disabled = false; }
  });
}

// ---------- Blocages (entretien, panne…) ----------
function ouvrirFormulaireBlocage(voitureId = "", debut = aujourdhui()) {
  const corps = ouvrirFenetre("Bloquer un véhicule", `
    <form id="form-blocage" class="formulaire-colonne" style="max-width:none" novalidate>
      <p class="gris petit">Le véhicule ne pourra plus être loué sur ces dates (ni sur le site, ni à l'agence).</p>
      <div class="grille-form">
        <label class="large">Véhicule<select name="voiture_id" required>${etat.voitures.map((v) => `<option value="${v.id}" ${v.id === voitureId ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select></label>
        <label>Du<input type="date" name="date_debut" value="${debut}" required></label>
        <label>Au<input type="date" name="date_fin" value="${ajouterJours(debut, 2)}" required></label>
        <label class="large">Motif<select name="motif">${["Entretien / vidange", "Panne / réparation", "Carrosserie", "Contrôle technique", "Nettoyage", "Réservé (usage interne)", "Autre"].map((m) => `<option>${m}</option>`).join("")}</select></label>
      </div>
      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Bloquer ces dates</button></div>
    </form>`, 520);
  const f = corps.querySelector("form");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    try {
      const b = await api("POST", "/blocages", { voiture_id: f.voiture_id.value, date_debut: f.date_debut.value, date_fin: f.date_fin.value, motif: f.motif.value });
      etat.reservations.push(b); fermerFenetre(); rafraichirVue(); notifier(`${b.voiture} bloqué du ${dateFr(b.date_debut)} au ${dateFr(b.date_fin)}`);
    } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}

function ouvrirBlocage(numero) {
  const b = etat.reservations.find((r) => r.numero === numero);
  const corps = ouvrirFenetre("Véhicule indisponible", `
    <div class="paires"><div class="paire large"><small>Véhicule</small><strong>${echapper(b.voiture)}</strong></div>
      <div class="paire"><small>Du</small><strong>${dateFr(b.date_debut)}</strong></div><div class="paire"><small>Au</small><strong>${dateFr(b.date_fin)}</strong></div>
      <div class="paire large"><small>Motif</small><strong>${echapper(b.motif)}</strong></div></div>
    <div class="fenetre-pied"><button class="btn btn-contour" data-fermer-fenetre>Fermer</button><button class="btn btn-danger" data-liberer>${icone("corbeille")}Libérer ces dates</button></div>`, 480);
  corps.querySelector("[data-liberer]").onclick = (e) => agir(e.currentTarget, async () => {
    await api("DELETE", `/reservations/${numero}`);
    etat.reservations = etat.reservations.filter((r) => r.numero !== numero);
    fermerFenetre(); rafraichirVue();
  }, "Dates libérées");
}

// ---------- Événements de la liste ----------
document.addEventListener("click", (e) => {
  const c = $("#contenu");
  if (!c.contains(e.target) || routeActuelle().vue !== "reservations") return;
  const rapide = e.target.closest("[data-edl-rapide]");
  if (rapide) {
    const [numero, moment] = rapide.dataset.edlRapide.split(":");
    return faireEtatDesLieux(etat.reservations.find((x) => x.numero === numero), moment, rapide);
  }
  const puce = e.target.closest("[data-statut]");
  if (puce) { filtres.statut = puce.dataset.statut; filtres.visibles = 40; rendreReservations(c); }
  if (e.target.closest("[data-nouvelle]")) ouvrirFormulaireReservation();
  if (e.target.closest("[data-exporter]")) exporterCSV();
  if (e.target.closest("[data-plus]")) { filtres.visibles += 40; rendreReservations(c); }
  if (e.target.closest("[data-effacer-recherche]")) { etat.recherche = ""; $("#recherche-globale").value = ""; rendreReservations(c); }
});
document.addEventListener("change", (e) => {
  if (routeActuelle().vue !== "reservations") return;
  const map = { "f-periode": "periode", "f-voiture": "voiture", "f-tri": "tri" };
  if (map[e.target.id]) { filtres[map[e.target.id]] = e.target.value; filtres.visibles = 40; rendreReservations($("#contenu")); }
});
