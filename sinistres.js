/* ═══════════════════════════════════════════════════════════════
   SINISTRES & AMENDES : accidents, dommages, pannes, PV
   Le client est retrouvé tout seul à partir de la date ; le coût et la refacturation alimentent la comptabilité.
   ═══════════════════════════════════════════════════════════════ */
const filtreSinistres = { statut: "ouverts", type: "", voiture: "", texte: "", visibles: 20 };

const STATUTS_INCIDENT = {
  ouvert: { cls: "badge-annulee", icone: "alerte", nom: "Ouvert" },
  en_cours: { cls: "badge-alerte", icone: "horloge", nom: "En cours" },
  regle: { cls: "badge-valide", icone: "check", nom: "Réglé" },
  classe: { cls: "badge-neutre", icone: "drapeau", nom: "Classé" },
};
const badgeIncident = (s) => badge(STATUTS_INCIDENT[s].cls, STATUTS_INCIDENT[s].nom, STATUTS_INCIDENT[s].icone);
const nomTypeIncident = (t) => etat.typesIncident?.[t] ?? t;
const urlPhotoIncident = (id, fichier) => `/api/employe/incidents/${id}/photos/${fichier}`;
const incidentOuvert = (i) => ["ouvert", "en_cours"].includes(i.statut);

// Le client qui avait ce véhicule ce jour-là
function locataireLe(voitureId, jour) {
  return etat.reservations.find((r) => estReservation(r) && ["confirmée", "en cours", "terminée"].includes(r.statut) && r.voiture_id === voitureId && r.date_debut <= jour && jour <= r.date_fin);
}
// À encaisser auprès du client : refacturé mais pas encore payé
const aRefacturer = (i) => (i.refacture > 0 && !i.refacture_encaisse && incidentOuvert(i) ? i.refacture : 0);

function sinistresFiltres() {
  const f = filtreSinistres, texte = normaliser(f.texte);
  return etat.incidents.filter((i) => (f.statut === "tous" || (f.statut === "ouverts" ? incidentOuvert(i) : i.statut === f.statut)) && (!f.type || i.type === f.type) && (!f.voiture || i.voiture_id === f.voiture)
    && (!texte || normaliser(`${i.voiture} ${i.client} ${i.description} ${i.reference} ${i.reservation}`).includes(texte)));
}

function rendreSinistres(conteneur) {
  const tous = etat.incidents, ouverts = tous.filter(incidentOuvert);
  const an = String(new Date().getFullYear());
  const coutAn = tous.filter((i) => i.date.startsWith(an)).reduce((s, i) => s + i.montant, 0);
  const aEncaisser = tous.reduce((s, i) => s + aRefacturer(i), 0);
  const liste = sinistresFiltres();
  const compte = (k) => k === "tous" ? tous.length : k === "ouverts" ? ouverts.length : tous.filter((i) => i.statut === k).length;
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Sinistres &amp; amendes</h2><p>Accidents, dommages, pannes et PV : qui, quand, combien, et ce qui doit être refacturé au client.</p></div>
      <button type="button" class="btn btn-rouge" data-sinistre-nouveau>${icone("plus")}Déclarer un incident</button></div>
    <div class="indicateurs">
      <div class="carte indicateur"><span>Dossiers ouverts</span><strong class="${ouverts.length ? "tendance-bas" : ""}">${ouverts.length}</strong><em>${ouverts.length ? "à suivre jusqu'au règlement" : "aucun incident en cours ✓"}</em></div>
      <div class="carte indicateur"><span>Coût ${an}</span><strong>${da(coutAn)}</strong><em>${pluriel(tous.filter((i) => i.date.startsWith(an)).length, "incident")}</em></div>
      <div class="carte indicateur"><span>À refacturer</span><strong class="${aEncaisser ? "tendance-bas" : ""}">${da(aEncaisser)}</strong><em>${aEncaisser ? "demandé aux clients, pas encore encaissé" : "rien à encaisser"}</em></div>
      <div class="carte indicateur"><span>Amendes</span><strong>${tous.filter((i) => i.type === "amende" && incidentOuvert(i)).length}</strong><em>à régler ou à transmettre au client</em></div>
    </div>
    <div class="barre-filtres">
      <input type="search" id="sinistres-recherche" placeholder="Rechercher un client, un véhicule, une référence…" value="${echapper(filtreSinistres.texte)}">
      <select id="sinistres-type" aria-label="Type"><option value="">Tous les types</option>${Object.entries(etat.typesIncident ?? {}).map(([k, n]) => `<option value="${k}" ${k === filtreSinistres.type ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select id="sinistres-voiture" aria-label="Véhicule"><option value="">Tous les véhicules</option>${etat.voitures.map((v) => `<option value="${v.id}" ${v.id === filtreSinistres.voiture ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)}</option>`).join("")}</select>
    </div>
    <div class="barre-filtres"><div class="puces">${[["ouverts", "Ouverts"], ["regle", "Réglés"], ["classe", "Classés"], ["tous", "Tous"]].map(([k, n]) => `<button class="puce ${filtreSinistres.statut === k ? "actif" : ""}" data-sinistres-statut="${k}">${n} <b>${compte(k)}</b></button>`).join("")}</div></div>
    ${liste.length ? `<div class="carte tableau-conteneur"><table class="tableau"><thead><tr><th>Date</th><th>Type</th><th>Véhicule</th><th>Client</th><th>Coût agence</th><th>Refacturé</th><th>Statut</th></tr></thead><tbody>
      ${liste.slice(0, filtreSinistres.visibles).map((i) => `<tr data-incident="${i.id}" tabindex="0">
        <td data-label="Date" class="mono">${dateFr(i.date)}</td>
        <td data-label="Type"><div class="cellule-principale"><strong>${nomTypeIncident(i.type)}</strong><span>${echapper(i.description || i.reference || "—").slice(0, 42)}</span></div></td>
        <td data-label="Véhicule">${echapper(i.voiture)}</td>
        <td data-label="Client">${i.client ? `<div class="cellule-principale"><strong>${echapper(i.client)}</strong><span class="mono">${i.reservation}</span></div>` : `<span class="gris">—</span>`}</td>
        <td data-label="Coût agence" class="mono">${i.montant ? `${da(i.montant)} ${i.cout_paye ? "✓" : ""}` : "—"}</td>
        <td data-label="Refacturé" class="mono">${i.refacture ? `${da(i.refacture)} ${i.refacture_encaisse ? "✓" : ""}` : "—"}</td>
        <td data-label="Statut">${badgeIncident(i.statut)}${i.photos.length ? ` <span class="gris petit">${icone("camera")}${i.photos.length}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${liste.length > filtreSinistres.visibles ? `<div style="text-align:center;margin-top:18px"><button class="btn btn-contour" data-sinistres-plus>Afficher plus (${liste.length - filtreSinistres.visibles})</button></div>` : ""}`
      : `<div class="carte vide-grand"><strong>${tous.length ? "Aucun incident ne correspond" : "Aucun incident enregistré"}</strong>${tous.length ? "Modifiez les filtres." : "Déclarez ici un accident, un dommage, une panne ou une amende."}</div>`}`;
}
enregistrerVue("sinistres", { titre: "Sinistres", icone: "sinistre", rendre: rendreSinistres });

// ---------- Déclarer un incident ----------
function ouvrirNouvelIncident(voitureId = "") {
  const corps = ouvrirFenetre("Déclarer un incident", `
    <form id="form-incident" class="formulaire-colonne" style="max-width:none" novalidate>
      <div class="grille-form">
        <label>Type<select name="type">${Object.entries(etat.typesIncident).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
        <label>Date<input type="date" name="date" value="${aujourdhui()}" max="${aujourdhui()}" required></label>
        <label class="large">Véhicule<select name="voiture_id" required><option value="">— Choisir —</option>${etat.voitures.map((v) => `<option value="${v.id}" ${v.id === voitureId ? "selected" : ""}>${echapper(v.marque)} ${echapper(v.modele)}${v.immatriculation ? ` · ${echapper(v.immatriculation)}` : ""}</option>`).join("")}</select></label>
        <p class="large indice-locataire" id="indice-locataire" aria-live="polite"></p>
        <label class="large">Description<textarea name="description" rows="3" maxlength="1000" placeholder="Ex. : rayure aile arrière gauche, constatée au retour"></textarea></label>
        <label>Lieu<input name="lieu" maxlength="120" placeholder="Ville, route…"></label>
        <label>Référence (PV, constat)<input name="reference" maxlength="60"></label>
        <label>Coût pour l'agence (DA)<input type="number" name="montant" min="0" step="100" value="0"></label>
        <label>Refacturé au client (DA)<input type="number" name="refacture" min="0" step="100" value="0"></label>
      </div>
      <label class="case"><input type="checkbox" name="immobiliser"> Immobiliser le véhicule (état : en réparation)</label>
      <p class="erreur-form" hidden></p>
      <div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Enregistrer</button></div>
    </form>`, 640);
  const f = corps.querySelector("form"), indice = corps.querySelector("#indice-locataire");
  const maj = () => {
    const r = f.voiture_id.value && f.date.value ? locataireLe(f.voiture_id.value, f.date.value) : null;
    indice.innerHTML = !f.voiture_id.value ? "" : r ? `${icone("clients")}Client à cette date : <strong>${echapper(nomClient(r))}</strong> · <span class="mono">${r.numero}</span>` : `<span class="gris">Aucune location ce jour-là pour ce véhicule.</span>`;
  };
  f.voiture_id.addEventListener("change", maj); f.date.addEventListener("change", maj); maj();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const erreur = f.querySelector(".erreur-form"); erreur.hidden = true;
    const bouton = f.querySelector("[type=submit]");
    await agir(bouton, async () => {
      try {
        const donnees = Object.fromEntries(new FormData(f));
        donnees.immobiliser = f.immobiliser.checked;
        const incident = await api("POST", "/incidents", donnees);
        await chargerDonnees(); fermerFenetre(); rafraichirVue(); dessinerMenu();
        notifier("Incident enregistré ✓"); ouvrirIncident(incident.id);
      } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
    });
  });
}

// ---------- Fiche d'un incident ----------
function rendreTiroirIncident(id) {
  const i = etat.incidents.find((x) => x.id === id);
  if (!i) return { titre: "Incident introuvable", corps: "" };
  const v = compteVoiture(i.voiture_id), r = i.reservation ? etat.reservations.find((x) => x.numero === i.reservation) : null;
  const interrupteur = (champ, texte, montant) => `<label class="case"><input type="checkbox" data-incident-case="${champ}" ${i[champ] ? "checked" : ""} ${montant > 0 ? "" : "disabled"}> ${texte}</label>`;
  return {
    titre: `${nomTypeIncident(i.type)} · ${echapper(i.voiture)}`,
    sousTitre: `${dateFr(i.date)} · ${badgeIncident(i.statut)}`,
    corps: `
      <div class="section-tiroir"><h4>Statut</h4><div class="puces">${Object.entries(STATUTS_INCIDENT).map(([k, s]) => `<button type="button" class="puce ${i.statut === k ? "actif" : ""}" data-incident-statut="${k}">${s.nom}</button>`).join("")}</div></div>
      <div class="section-tiroir"><h4>Détails</h4>
        <dl class="liste-def">
          <dt>Véhicule</dt><dd>${v ? `<a href="#/vehicules" data-ouvrir-vehicule="${v.id}">${echapper(i.voiture)}</a>` : echapper(i.voiture)}${v?.immatriculation ? ` · ${ltr(v.immatriculation)}` : ""}</dd>
          <dt>Client</dt><dd>${i.client ? `${echapper(i.client)}${i.telephone ? ` · ${ltr(i.telephone)}` : ""}${r ? ` · <a href="#" data-res="${r.numero}">${r.numero}</a>` : ""}` : "<span class='gris'>Aucune location ce jour-là</span>"}</dd>
          ${i.lieu ? `<dt>Lieu</dt><dd>${echapper(i.lieu)}</dd>` : ""}${i.reference ? `<dt>Référence</dt><dd class="mono">${echapper(i.reference)}</dd>` : ""}
        </dl>
        ${i.description ? `<p style="margin-top:10px">${echapper(i.description)}</p>` : ""}
      </div>
      <div class="section-tiroir"><h4>Argent</h4>
        <div class="grille-form">
          <label>Coût pour l'agence (DA)<input type="number" min="0" step="100" data-incident-montant="montant" value="${i.montant}"></label>
          <label>Refacturé au client (DA)<input type="number" min="0" step="100" data-incident-montant="refacture" value="${i.refacture}"></label>
        </div>
        <div style="display:grid;gap:6px;margin-top:8px">${interrupteur("cout_paye", "Coût payé par l'agence (inscrit en dépense)", i.montant)}${interrupteur("refacture_encaisse", "Refacturation encaissée (inscrite en recette)", i.refacture)}</div>
        <p class="gris petit" style="margin-top:6px">Ces cases alimentent automatiquement la comptabilité et la rentabilité du véhicule.</p>
      </div>
      <div class="section-tiroir"><h4>Photos <span class="gris">(${i.photos.length})</span></h4>
        ${i.photos.length ? `<div class="grille-vignettes">${i.photos.map((p) => `<div class="vignette" data-doc="${urlPhotoIncident(i.id, p.fichier)}" data-pdf="false" title="${echapper(p.legende || "")}"><img src="${urlPhotoIncident(i.id, p.fichier)}" alt="" loading="lazy"></div>`).join("")}</div>` : `<p class="gris petit">Aucune photo. Ajoutez le constat, les dégâts ou le PV.</p>`}
        <label class="btn btn-contour btn-petit" style="margin-top:10px">${icone("camera")}Ajouter des photos<input type="file" accept="image/*" multiple hidden data-incident-photos></label>
      </div>
      <div class="section-tiroir"><h4>Historique</h4><ul class="historique">${[...i.historique].reverse().map((h) => `<li><span class="mono gris">${dateFr(h.le.slice(0, 10))} ${h.le.slice(11, 16)}</span> ${echapper(h.action)} <span class="gris">· ${echapper(h.par)}</span></li>`).join("")}</ul></div>
      ${estAdmin() ? `<div class="section-tiroir"><button type="button" class="btn btn-contour btn-petit" data-incident-supprimer>${icone("corbeille")}Supprimer cet incident</button></div>` : ""}`,
  };
}
function ouvrirIncident(id) { etat.incidentOuvert = id; ouvrirTiroir(() => rendreTiroirIncident(id)); }

async function majIncident(id, corps, message) {
  const maj = await api("PATCH", `/incidents/${id}`, corps);
  const k = etat.incidents.findIndex((x) => x.id === id);
  if (k >= 0) etat.incidents[k] = maj;
  await chargerDonnees();
  rafraichirTiroir(); rafraichirVue(); dessinerMenu();
  if (message) notifier(message);
}

document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-sinistre-nouveau]")) return ouvrirNouvelIncident();
  if (e.target.closest("[data-nouvel-incident]")) return ouvrirNouvelIncident(e.target.closest("[data-nouvel-incident]").dataset.nouvelIncident);
  const ligne = e.target.closest("tr[data-incident]");
  if (ligne && routeActuelle().vue === "sinistres") return ouvrirIncident(ligne.dataset.incident);
  const puce = e.target.closest("[data-sinistres-statut]");
  if (puce) { filtreSinistres.statut = puce.dataset.sinistresStatut; filtreSinistres.visibles = 20; return rendreSinistres($("#contenu")); }
  if (e.target.closest("[data-sinistres-plus]")) { filtreSinistres.visibles += 20; return rendreSinistres($("#contenu")); }
  const id = etat.incidentOuvert;
  const statut = e.target.closest("[data-incident-statut]");
  if (statut && id) return agir(statut, () => majIncident(id, { statut: statut.dataset.incidentStatut }, "Statut mis à jour ✓"));
  const vehicule = e.target.closest("[data-ouvrir-vehicule]");
  if (vehicule) { e.preventDefault(); return ouvrirVehicule(vehicule.dataset.ouvrirVehicule); }
  if (e.target.closest("[data-incident-supprimer]") && id) {
    if (!(await confirmer("Supprimer définitivement cet incident, ses photos et ses écritures comptables ?", "Supprimer", true))) return;
    await agir(null, async () => { await api("DELETE", `/incidents/${id}`); fermerTiroir(); await chargerDonnees(); rafraichirVue(); dessinerMenu(); }, "Incident supprimé");
  }
});
document.addEventListener("change", async (e) => {
  const id = etat.incidentOuvert;
  if (e.target.matches("[data-incident-case]") && id) return agir(e.target, () => majIncident(id, { [e.target.dataset.incidentCase]: e.target.checked }));
  if (e.target.matches("[data-incident-montant]") && id) return agir(e.target, () => majIncident(id, { [e.target.dataset.incidentMontant]: e.target.value || 0 }, "Montant enregistré ✓"));
  if (e.target.matches("[data-incident-photos]") && id) {
    const fichiers = [...e.target.files]; e.target.value = "";
    const message = notifier(`Envoi des photos… 0/${fichiers.length}`, "info", 180000);
    let ok = 0;
    for (const [n, fichier] of fichiers.entries()) {
      try { const maj = await api("POST", `/incidents/${id}/photos`, { contenu: await preparerPhoto(fichier) }); etat.incidents[etat.incidents.findIndex((x) => x.id === id)] = maj; ok++; }
      catch (err) { notifier(err.message, "erreur", 8000); }
      message.textContent = `Envoi des photos… ${n + 1}/${fichiers.length}`;
    }
    message.remove(); rafraichirTiroir(); rafraichirVue();
    if (ok) notifier(`${pluriel(ok, "photo")} enregistrée${ok > 1 ? "s" : ""} ✓`);
    return;
  }
  if (routeActuelle().vue !== "sinistres") return;
  const map = { "sinistres-type": "type", "sinistres-voiture": "voiture" };
  if (map[e.target.id]) { filtreSinistres[map[e.target.id]] = e.target.value; filtreSinistres.visibles = 20; rendreSinistres($("#contenu")); }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "sinistres-recherche") return;
  filtreSinistres.texte = e.target.value; filtreSinistres.visibles = 20;
  const p = e.target.selectionStart;
  rendreSinistres($("#contenu"));
  const c = $("#sinistres-recherche"); c.focus(); c.setSelectionRange(p, p);
});
