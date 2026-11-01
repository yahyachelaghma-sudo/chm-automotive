/* ═══════════════════════════════════════════════════════════════
   DOSSIERS CLIENTS (permis, pièce d'identité…) et FICHIER CLIENTS
   ═══════════════════════════════════════════════════════════════ */
const filtreDossiers = { statut: "à vérifier", texte: "" };
const NOMS_DOCUMENTS = { permis_recto: "Permis — recto", permis_verso: "Permis — verso", identite_recto: "Identité — recto", identite_verso: "Identité — verso", domicile: "Justificatif de domicile", permis_international: "Permis international" };
const badgeDossier = (s) => badge(s === "validé" ? "badge-valide" : s === "refusé" ? "badge-refuse" : "badge-attente", s === "validé" ? "Validé" : s === "refusé" ? "Refusé" : "À vérifier", s === "validé" ? "check" : s === "refusé" ? "croix" : "horloge");
const urlDocument = (numero, fichier) => `/api/employe/dossiers/${numero}/fichiers/${encodeURIComponent(fichier)}`;

function anneesDepuis(iso) {
  const n = dateDepuis(iso), j = new Date();
  return j.getFullYear() - n.getFullYear() - (j < new Date(j.getFullYear(), n.getMonth(), n.getDate()) ? 1 : 0);
}

// Points d'attention : l'agence décide toujours, mais rien ne passe inaperçu
function alertesDossier(d) {
  const a = etat.agence, alertes = [];
  const age = a.age_minimum ?? 23, permis = a.permis_annees_minimum ?? 2;
  if (d.date_naissance && anneesDepuis(d.date_naissance) < age) alertes.push(["", `Client de ${anneesDepuis(d.date_naissance)} ans (minimum ${age} ans).`]);
  if (d.permis_date && anneesDepuis(d.permis_date) < permis) alertes.push(["", `Permis obtenu il y a ${anneesDepuis(d.permis_date)} an(s) (minimum ${permis} ans).`]);
  if (d.identite_expiration && d.identite_expiration < aujourdhui()) alertes.push(["rouge", `Pièce d'identité expirée depuis le ${dateFr(d.identite_expiration)}.`]);
  else if (d.identite_expiration && d.identite_expiration < ajouterJours(aujourdhui(), 60)) alertes.push(["", `Pièce d'identité qui expire bientôt (${dateFr(d.identite_expiration)}).`]);
  if (d.permis_pays === "Autre pays" && !(d.documents ?? []).some((x) => x.type === "permis_international")) alertes.push(["", "Permis étranger : permis international ou traduction manquant."]);
  const types = (d.documents ?? []).map((x) => x.type);
  if (!types.includes("permis_recto") || !types.includes("permis_verso")) alertes.push(["", "Il manque une face du permis de conduire."]);
  if (!types.includes("identite_recto")) alertes.push(["rouge", "La pièce d'identité n'a pas été envoyée."]);
  return alertes;
}

function rendreDossiers(conteneur) {
  const texte = normaliser(filtreDossiers.texte);
  const compte = (s) => etat.dossiers.filter((d) => s === "tous" || d.statut === s).length;
  const liste = etat.dossiers.filter((d) => (filtreDossiers.statut === "tous" || d.statut === filtreDossiers.statut) && (!texte || normaliser(`${d.numero} ${d.prenom} ${d.nom} ${d.telephone} ${d.permis_numero}`).includes(texte)));
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Dossiers clients</h2><p>Documents envoyés par les clients depuis le site, rangés et protégés.</p></div></div>
    <div class="barre-filtres">
      <input type="search" id="dossier-recherche" placeholder="Rechercher un nom, un téléphone, un n°…" value="${echapper(filtreDossiers.texte)}">
      <div class="puces">${[["à vérifier", "À vérifier"], ["validé", "Validés"], ["refusé", "Refusés"], ["tous", "Tous"]].map(([k, n]) => `<button class="puce ${filtreDossiers.statut === k ? "actif" : ""}" data-dossier-statut="${k}">${n} <b>${compte(k)}</b></button>`).join("")}</div>
    </div>
    <div class="carte tableau-boite">${liste.length ? `<table class="tableau"><thead><tr><th>Dossier</th><th>Client</th><th>Contact</th><th>Permis</th><th>Documents</th><th>Statut</th></tr></thead><tbody>
      ${liste.map((d) => { const al = alertesDossier(d); return `<tr data-dossier="${d.numero}">
        <td data-label="Dossier" class="mono"><strong style="color:var(--blanc)">${d.numero}</strong><br><span class="gris petit">${heureFr(d.recu_le)}</span></td>
        <td data-label="Client" class="cellule-principale"><strong>${echapper(d.prenom)} ${echapper(d.nom)}</strong><span>${d.date_naissance ? `${anneesDepuis(d.date_naissance)} ans` : ""} ${echapper(d.nationalite ?? "")}</span></td>
        <td data-label="Contact" class="cellule-principale"><strong>${ltr(d.telephone)}</strong><span>${echapper(d.ville || d.adresse || "")}</span></td>
        <td data-label="Permis" class="cellule-principale"><strong>${echapper(d.permis_numero)}</strong><span>${d.permis_date ? `depuis ${anneesDepuis(d.permis_date)} an(s)` : ""}</span></td>
        <td data-label="Documents" class="mono">${(d.documents ?? []).length}${al.length ? ` ${badge("badge-alerte", pluriel(al.length, "alerte"), "alerte")}` : ""}</td>
        <td data-label="Statut" class="plein">${badgeDossier(d.statut)}</td></tr>`; }).join("")}</tbody></table>`
      : `<div class="vide-grand"><strong>${filtreDossiers.statut === "à vérifier" ? "Aucun dossier à vérifier 🎉" : "Aucun dossier"}</strong>Les dossiers déposés par les clients sur le site apparaîtront ici.</div>`}</div>`;
}
enregistrerVue("dossiers", { titre: "Dossiers clients", icone: "dossiers", rendre: rendreDossiers });

function rendreTiroirDossier(numero) {
  const d = etat.dossiers.find((x) => x.numero === numero);
  if (!d) return { titre: "Introuvable", corps: `<p class="gris">Ce dossier n'existe plus.</p>` };
  const liees = etat.reservations.filter((r) => estReservation(r) && ((d.reservation_numero || "").toUpperCase() === r.numero || memeTel(d.telephone, r.client?.telephone)));
  const alertes = alertesDossier(d);
  const champs = (liste) => liste.filter(([, v]) => v).map(([n, v, large]) => `<div class="paire ${large ? "large" : ""}"><small>${n}</small><strong>${echapper(v)}</strong></div>`).join("");
  return {
    titre: `${echapper(d.prenom)} ${echapper(d.nom)}`,
    sousTitre: `${badgeDossier(d.statut)}<span class="gris petit">${d.numero} · reçu ${heureFr(d.recu_le)}</span>`,
    corps: `
      ${alertes.length ? `<div class="alertes">${alertes.map(([c, t]) => `<div class="alerte ${c}">⚠️ ${echapper(t)}</div>`).join("")}</div>` : ""}
      <div class="actions-statut">
        ${d.statut !== "validé" ? `<button class="btn btn-vert" data-dact="statut" data-valeur="validé">${icone("check")}Valider le dossier</button>` : ""}
        ${d.statut !== "refusé" ? `<button class="btn btn-danger" data-dact="statut" data-valeur="refusé">${icone("croix")}Refuser</button>` : ""}
        ${d.statut !== "à vérifier" ? `<button class="btn btn-contour" data-dact="statut" data-valeur="à vérifier">Remettre à vérifier</button>` : ""}
      </div>
      <section class="section-tiroir"><h4>Documents (${(d.documents ?? []).length})</h4>
        <div class="documents-grille">${(d.documents ?? []).map((x) => {
          const pdf = x.fichier.endsWith(".pdf");
          return `<div class="document" data-doc="${urlDocument(d.numero, x.fichier)}" data-pdf="${pdf}">${pdf ? `<div class="pdf">📄</div>` : `<img src="${urlDocument(d.numero, x.fichier)}" alt="" loading="lazy">`}<span>${NOMS_DOCUMENTS[x.type] ?? x.type}</span></div>`;
        }).join("") || `<p class="gris petit">Aucun document.</p>`}</div>
        <p class="aide-petit" style="margin-top:8px">Cliquez sur un document pour l'agrandir.</p>
      </section>
      <section class="section-tiroir"><h4>Identité et contact</h4><div class="paires">${champs([
        ["Date de naissance", d.date_naissance ? `${dateFr(d.date_naissance)} (${anneesDepuis(d.date_naissance)} ans)` : ""], ["Nationalité", d.nationalite], ["Téléphone", d.telephone], ["Email", d.email],
        ["Adresse", [d.adresse, d.ville].filter(Boolean).join(", "), true]])}</div>
        <div class="actions" style="margin-top:10px"><a class="btn btn-contour btn-petit" href="tel:${echapper(d.telephone)}">${icone("tel")}Appeler</a>
          <a class="btn btn-whatsapp btn-petit" target="_blank" rel="noopener" href="${lienWhatsApp(d.telephone, `Bonjour ${d.prenom}, c'est ${etat.agence.nom} au sujet de votre dossier ${d.numero}.`)}">${icone("message")}WhatsApp</a></div></section>
      <section class="section-tiroir"><h4>Pièce d'identité et permis</h4><div class="paires">${champs([
        ["Pièce d'identité", d.identite_type], ["Numéro", d.identite_numero], ["Expire le", d.identite_expiration ? dateFr(d.identite_expiration) : ""],
        ["N° de permis", d.permis_numero], ["Permis obtenu le", d.permis_date ? dateFr(d.permis_date) : ""], ["Délivré par", d.permis_pays]])}</div></section>
      ${d.conducteur2_nom ? `<section class="section-tiroir"><h4>2e conducteur</h4><div class="paires">${champs([["Nom", `${d.conducteur2_prenom ?? ""} ${d.conducteur2_nom}`], ["N° de permis", d.conducteur2_permis]])}</div></section>` : ""}
      <section class="section-tiroir"><h4>Réservations de ce client</h4>${liees.length ? `<ul class="liste-taches" style="padding:0">${liees.map((r) => tache(r, `${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)} · ${da(r.total)}`, badgeStatut(r.statut))).join("")}</ul>` : `<p class="gris petit">Aucune réservation liée pour l'instant.</p>`}</section>
      <section class="section-tiroir"><h4>Notes internes</h4><textarea id="notes-dossier" placeholder="Ex. : permis vérifié en agence le…">${echapper(d.notes || "")}</textarea>
        <div class="actions" style="margin-top:8px"><button class="btn btn-contour btn-petit" data-dact="notes">Enregistrer la note</button></div></section>
      ${estAdmin() ? `<section class="section-tiroir"><h4>Données personnelles</h4><button class="btn btn-danger" data-dact="supprimer">${icone("corbeille")}Supprimer ce dossier et ses documents</button>
        <p class="aide-petit" style="margin-top:8px">À utiliser quand le client le demande ou une fois la location terminée et les délais légaux passés.</p></section>` : ""}`,
  };
}

function ouvrirDossier(numero) {
  if (!etat.dossiers.some((d) => d.numero === numero)) return notifier("Dossier introuvable.", "erreur");
  etat.dossierOuvert = numero;
  etat.numeroOuvert = null;
  ouvrirTiroir(() => rendreTiroirDossier(numero));
}

document.addEventListener("click", async (e) => {
  const doc = e.target.closest("[data-doc]");
  if (doc && !e.target.closest(".vignette-x")) {
    if (doc.dataset.pdf === "true") return window.open(doc.dataset.doc, "_blank", "noopener");
    const v = Object.assign(document.createElement("div"), { className: "visionneuse", innerHTML: `<img src="${doc.dataset.doc}" alt="">` });
    v.addEventListener("click", () => v.remove());
    return document.body.append(v);
  }
  const puce = e.target.closest("[data-dossier-statut]");
  if (puce) { filtreDossiers.statut = puce.dataset.dossierStatut; return rendreDossiers($("#contenu")); }
  const act = e.target.closest("[data-dact]");
  if (!act || !etat.dossierOuvert) return;
  const numero = etat.dossierOuvert;
  if (act.dataset.dact === "supprimer") {
    if (!(await confirmer(`Supprimer définitivement le dossier ${numero} et tous ses documents ? Cette action est irréversible.`, "Supprimer", true))) return;
    return agir(act, async () => { await api("DELETE", `/dossiers/${numero}`); etat.dossiers = etat.dossiers.filter((d) => d.numero !== numero); fermerTiroir(); rafraichirVue(); }, "Dossier supprimé");
  }
  const changements = act.dataset.dact === "statut" ? { statut: act.dataset.valeur } : { notes: $("#notes-dossier").value };
  agir(act, async () => {
    const maj = await api("PATCH", `/dossiers/${numero}`, changements);
    etat.dossiers[etat.dossiers.findIndex((d) => d.numero === numero)] = maj;
    rafraichirVue();
  }, act.dataset.dact === "statut" ? `Dossier ${act.dataset.valeur === "validé" ? "validé ✓" : act.dataset.valeur === "refusé" ? "refusé" : "remis à vérifier"}` : "Note enregistrée");
});
document.addEventListener("input", (e) => {
  if (e.target.id === "dossier-recherche") { filtreDossiers.texte = e.target.value; const p = e.target.selectionStart; rendreDossiers($("#contenu")); const c = $("#dossier-recherche"); c.focus(); c.setSelectionRange(p, p); }
});

// ---------- Fichier clients (regroupés par numéro de téléphone) ----------
const filtreClients = { texte: "" };
function listeClients() {
  const clients = new Map();
  const cle = (tel) => chiffresTel(tel).slice(-9);
  for (const r of etat.reservations.filter((x) => estReservation(x) && x.statut !== "annulée")) {
    const k = cle(r.client.telephone), c = clients.get(k) ?? { cle: k, nom: nomClient(r), telephone: r.client.telephone, email: r.client.email, reservations: [], ca: 0 };
    c.reservations.push(r); c.ca += r.total;
    if (r.cree_le > (c.dernier ?? "")) { c.dernier = r.cree_le; c.nom = nomClient(r); c.email = r.client.email || c.email; }
    clients.set(k, c);
  }
  for (const d of etat.dossiers) {
    const k = cle(d.telephone), c = clients.get(k) ?? { cle: k, nom: `${d.prenom} ${d.nom}`, telephone: d.telephone, email: d.email, reservations: [], ca: 0 };
    c.dossier = d; clients.set(k, c);
  }
  return [...clients.values()];
}

function rendreClients(conteneur) {
  const texte = normaliser(filtreClients.texte);
  const liste = listeClients().filter((c) => !texte || normaliser(`${c.nom} ${c.telephone} ${c.email ?? ""}`).includes(texte)).sort((a, b) => b.ca - a.ca);
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Clients</h2><p>${pluriel(liste.length, "client")} · regroupés automatiquement par numéro de téléphone.</p></div></div>
    <div class="barre-filtres"><input type="search" id="client-recherche" placeholder="Rechercher un nom, un téléphone…" value="${echapper(filtreClients.texte)}"></div>
    <div class="carte tableau-boite">${liste.length ? `<table class="tableau"><thead><tr><th>Client</th><th>Téléphone</th><th>Locations</th><th>Chiffre d'affaires</th><th>Dernière réservation</th><th>Dossier</th></tr></thead><tbody>
      ${liste.map((c) => `<tr data-client="${c.cle}">
        <td data-label="Client" class="cellule-principale"><strong>${echapper(c.nom)}</strong><span>${c.reservations.length >= 3 ? badge("badge-valide", "Client fidèle", "check") : echapper(c.email ?? "")}</span></td>
        <td data-label="Téléphone" class="mono">${ltr(c.telephone)}</td>
        <td data-label="Locations" class="mono">${c.reservations.length}</td>
        <td data-label="CA" class="mono"><strong style="color:var(--blanc)">${da(c.ca)}</strong></td>
        <td data-label="Dernière" class="mono">${c.dernier ? dateFr(c.reservations.sort((a, b) => b.date_debut.localeCompare(a.date_debut))[0].date_debut) : "—"}</td>
        <td data-label="Dossier">${c.dossier ? badgeDossier(c.dossier.statut) : `<span class="gris">—</span>`}</td></tr>`).join("")}</tbody></table>` : `<div class="vide-grand"><strong>Aucun client</strong>Les clients apparaissent dès leur première réservation.</div>`}</div>`;
}
enregistrerVue("clients", { titre: "Clients", icone: "clients", rendre: rendreClients });

function ouvrirClient(cle) {
  const c = listeClients().find((x) => x.cle === cle);
  if (!c) return;
  etat.numeroOuvert = null; etat.dossierOuvert = null;
  ouvrirTiroir(() => ({
    titre: echapper(c.nom), sousTitre: `<span class="gris petit">${pluriel(c.reservations.length, "location")} · ${da(c.ca)}</span>`,
    corps: `<div class="actions"><a class="btn btn-contour btn-petit" href="tel:${echapper(c.telephone)}">${icone("tel")}${echapper(c.telephone)}</a>
        <a class="btn btn-whatsapp btn-petit" target="_blank" rel="noopener" href="${lienWhatsApp(c.telephone, `Bonjour ${c.nom.split(" ")[0]}, c'est ${etat.agence.nom}. `)}">${icone("message")}WhatsApp</a></div>
      ${c.dossier ? `<section class="section-tiroir"><h4>Dossier</h4><div class="tache" data-dossier="${c.dossier.numero}" tabindex="0"><div class="tache-info"><strong>${c.dossier.numero} · permis ${echapper(c.dossier.permis_numero)}</strong><span>reçu ${heureFr(c.dossier.recu_le)}</span></div>${badgeDossier(c.dossier.statut)}</div></section>` : ""}
      <section class="section-tiroir"><h4>Historique des locations</h4><ul class="liste-taches" style="padding:0">${[...c.reservations].sort((a, b) => b.date_debut.localeCompare(a.date_debut)).map((r) => tache(r, `${dateCourte(r.date_debut)} → ${dateCourte(r.date_fin)} · ${da(r.total)}`, badgeStatut(r.statut))).join("") || `<p class="gris petit">Aucune location.</p>`}</ul></section>`,
  }));
}
document.addEventListener("click", (e) => {
  const ligne = e.target.closest("[data-client]");
  if (ligne) ouvrirClient(ligne.dataset.client);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "client-recherche") { filtreClients.texte = e.target.value; const p = e.target.selectionStart; rendreClients($("#contenu")); const c = $("#client-recherche"); c.focus(); c.setSelectionRange(p, p); }
});
