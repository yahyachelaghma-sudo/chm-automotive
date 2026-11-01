/* ═══════════════════════════════════════════════════════════════
   PARAMÈTRES de l'agence, ÉQUIPE et JOURNAL (administrateur)
   ═══════════════════════════════════════════════════════════════ */
const reglages = { onglet: "agence", catalogue: [], agence: null };

async function chargerReglages() {
  const r = await api("GET", "/agence");
  reglages.agence = r.agence; reglages.catalogue = r.catalogue_paiement;
}

async function sauverReglages(changements, bouton, message = "Paramètres enregistrés ✓") {
  return agir(bouton, async () => {
    const r = await api("PUT", "/agence", changements);
    reglages.agence = r.agence; etat.agence = r.agence;
    return r;
  }, message);
}

const lignes = (texte) => texte.split("\n").map((x) => x.trim()).filter(Boolean);

const ONGLETS_REGLAGES = [["agence", "Agence"], ["paiement", "Paiement"], ["tarifs", "Tarifs et options"], ["sauvegarde", "Sauvegarde"]];

function ongletAgence(a) {
  return `<form class="formulaire-colonne" data-form="agence" novalidate>
    <div class="grille-form">
      <label>Nom de l'agence<input name="nom" value="${echapper(a.nom)}" required></label>
      <label>Téléphone<input name="telephone" value="${echapper(a.telephone)}" required></label>
      <label>WhatsApp <small>(avec l'indicatif, ex. 213555123456)</small><input name="whatsapp" value="${echapper(a.whatsapp)}"></label>
      <label>Email<input name="email" type="email" value="${echapper(a.email)}"></label>
      <label class="large">Adresse<input name="adresse" value="${echapper(a.adresse)}" required></label>
      <label class="large">Slogan (page d'accueil du site)<input name="slogan" value="${echapper(a.slogan)}"></label>
      <label>Horaires <small>(une ligne par horaire)</small><textarea name="horaires" rows="4">${echapper((a.horaires ?? []).join("\n"))}</textarea></label>
      <label>Lieux de remise <small>(une ligne par lieu)</small><textarea name="lieux" rows="4">${echapper((a.lieux ?? []).join("\n"))}</textarea></label>
      <label>Facebook<input name="facebook" value="${echapper(a.reseaux?.facebook ?? "")}" placeholder="https://…"></label>
      <label>Instagram<input name="instagram" value="${echapper(a.reseaux?.instagram ?? "")}" placeholder="https://…"></label>
      <label>TikTok<input name="tiktok" value="${echapper(a.reseaux?.tiktok ?? "")}" placeholder="https://…"></label>
      <label>Avis Google <small>(lien)</small><input name="lien_avis_google" value="${echapper(a.lien_avis_google ?? "")}" placeholder="https://…"></label>
    </div>
    <div><button class="btn btn-rouge" type="submit">Enregistrer</button></div></form>`;
}

function ongletPaiement(a) {
  const actifs = new Set((a.paiement_modes ?? []).map((m) => m.id));
  const virements = reglages.catalogue.filter((m) => m.type === "virement");
  return `<form class="formulaire-colonne" data-form="paiement" novalidate>
    <section><h3 style="margin-bottom:6px">Moyens de paiement proposés aux clients</h3><p class="gris petit" style="margin-bottom:12px">Cochez ce que l'agence accepte. Cela s'affiche sur le site, dans la réservation.</p>
      <div class="cases-grille">${reglages.catalogue.map((m) => `<label class="case"><input type="checkbox" name="mode" value="${echapper(m.id)}" ${actifs.has(m.id) ? "checked" : ""}> ${m.icone} ${echapper(m.nom)}</label>`).join("")}</div></section>
    <section><h3 style="margin-bottom:6px">Vos coordonnées de paiement</h3><p class="gris petit" style="margin-bottom:12px">Affichées au client qui choisit de payer tout de suite. Laissez vide ce que vous ne proposez pas : l'option « maintenant » disparaît.</p>
      <div class="grille-form">${virements.map((m) => `<label class="large">${m.icone} ${echapper(m.nom)}<input name="coord:${echapper(m.id)}" value="${echapper(a.paiement_coordonnees?.[m.id] ?? "")}" placeholder="${m.id === "BaridiMob" ? "RIP : 00799999 0000000000 00" : m.id === "CCP" ? "CCP n° 0000000000 clé 00 — au nom de…" : "RIB : 000 00000 0000000000000 00 — banque, agence"}"></label>`).join("")}</div></section>
    <section><h3 style="margin-bottom:6px">Paiement par carte en ligne</h3><p class="gris petit" style="margin-bottom:12px">Visa, Mastercard, CIB et Edahabia se paient sur la page sécurisée de votre prestataire (SATIM, Chargily Pay, Slick Pay…) : collez ici le lien de paiement. Le site ne demande jamais de numéro de carte.</p>
      <div class="grille-form"><label class="large">Lien de paiement sécurisé<input name="paiement_en_ligne_lien" value="${echapper(a.paiement_en_ligne_lien ?? "")}" placeholder="https://…"></label>
      <label class="large">Paiement sur place<input name="paiement_sur_place" value="${echapper(a.paiement_sur_place ?? "")}"></label></div></section>
    <div><button class="btn btn-rouge" type="submit">Enregistrer</button></div></form>`;
}

function ongletTarifs(a) {
  const remise = (r = {}) => `<div class="ligne-editable" data-remise><label>À partir de (jours)<input type="number" min="2" name="jours_min" value="${r.jours_min ?? 7}"></label><label>Remise (%)<input type="number" min="1" max="90" name="pourcentage" value="${r.pourcentage ?? 10}"></label><button type="button" class="btn btn-danger btn-icone" data-retirer aria-label="Retirer">${icone("corbeille")}</button></div>`;
  const option = (o = {}) => `<div class="ligne-editable" data-option data-id="${echapper(o.id ?? "")}"><label class="large">Nom<input name="nom" value="${echapper(o.nom ?? "")}"></label><label>Prix (DA)<input type="number" min="0" step="100" name="prix" value="${o.prix ?? 0}"></label>
    <label>Facturé<select name="par"><option value="jour" ${o.par === "jour" ? "selected" : ""}>par jour</option><option value="location" ${o.par !== "jour" ? "selected" : ""}>par location</option></select></label>
    <label class="large">Description<input name="description" value="${echapper(o.description ?? "")}"></label><button type="button" class="btn btn-danger btn-icone" data-retirer aria-label="Retirer">${icone("corbeille")}</button></div>`;
  return `<form class="formulaire-colonne" data-form="tarifs" novalidate>
    <section><h3 style="margin-bottom:6px">Remises longue durée</h3><p class="gris petit" style="margin-bottom:12px">Appliquées automatiquement, sur le site comme à l'agence.</p>
      <div class="liste-editable" id="liste-remises">${(a.remises ?? []).map(remise).join("")}</div><button type="button" class="btn btn-contour btn-petit" style="margin-top:10px" data-ajouter-remise>${icone("plus")}Ajouter une remise</button></section>
    <section><h3 style="margin-bottom:12px">Options et services</h3>
      <div class="liste-editable" id="liste-options">${(a.options ?? []).map(option).join("")}</div><button type="button" class="btn btn-contour btn-petit" style="margin-top:10px" data-ajouter-option>${icone("plus")}Ajouter une option</button></section>
    <section><h3 style="margin-bottom:12px">Règles de location</h3><div class="grille-form">
      <label>Kilomètres inclus par jour<input type="number" name="km_inclus_par_jour" min="50" value="${a.tarifs_supplementaires?.km_inclus_par_jour ?? 300}"></label>
      <label>Prix du km supplémentaire (DA)<input type="number" name="prix_km_supplementaire" min="0" value="${a.tarifs_supplementaires?.prix_km_supplementaire ?? 20}"></label>
      <label>Âge minimum<input type="number" name="age_minimum" min="18" max="30" value="${a.age_minimum ?? 23}"></label>
      <label>Ancienneté minimale du permis (ans)<input type="number" name="permis_annees_minimum" min="0" max="10" value="${a.permis_annees_minimum ?? 2}"></label></div></section>
    <div><button class="btn btn-rouge" type="submit">Enregistrer</button></div>
    <template id="modele-remise">${remise()}</template><template id="modele-option">${option({ par: "location" })}</template></form>`;
}

function ongletSauvegarde() {
  return `<div class="formulaire-colonne"><section class="carte carte-corps"><h3 style="margin-bottom:8px">Sauvegarde complète</h3>
    <p class="gris" style="margin-bottom:14px">Télécharge un fichier .zip contenant toutes les réservations, les dossiers clients (avec leurs documents), les comptes, le journal, vos véhicules et vos paramètres.</p>
    <a class="btn btn-rouge" href="/api/employe/sauvegarde">${icone("telecharger")}Télécharger la sauvegarde</a>
    <p class="aide-petit" style="margin-top:12px">⚠️ Ce fichier contient des données personnelles (pièces d'identité) : gardez-le en lieu sûr et ne le partagez pas. Faites-en une chaque semaine.</p></section></div>`;
}

async function rendreParametres(conteneur) {
  if (!reglages.agence) { conteneur.innerHTML = `<p class="gris">Chargement…</p>`; try { await chargerReglages(); } catch (e) { return notifier(e.message, "erreur"); } }
  const a = reglages.agence;
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Paramètres</h2><p>Tout ce qui apparaît sur le site client se règle ici.</p></div></div>
    <div class="onglets" role="tablist">${ONGLETS_REGLAGES.map(([k, n]) => `<button class="onglet ${reglages.onglet === k ? "actif" : ""}" role="tab" data-onglet="${k}">${n}</button>`).join("")}</div>
    <div id="onglet-contenu">${{ agence: ongletAgence, paiement: ongletPaiement, tarifs: ongletTarifs, sauvegarde: ongletSauvegarde }[reglages.onglet](a)}</div>`;
}
enregistrerVue("parametres", { titre: "Paramètres", icone: "parametres", admin: true, rendre: rendreParametres });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "parametres") return;
  const onglet = e.target.closest("[data-onglet]");
  if (onglet) { reglages.onglet = onglet.dataset.onglet; rendreParametres($("#contenu")); }
  if (e.target.closest("[data-retirer]")) e.target.closest(".ligne-editable").remove();
  if (e.target.closest("[data-ajouter-remise]")) $("#liste-remises").append($("#modele-remise").content.cloneNode(true));
  if (e.target.closest("[data-ajouter-option]")) $("#liste-options").append($("#modele-option").content.cloneNode(true));
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-form]");
  if (!f) return;
  e.preventDefault();
  const type = f.dataset.form, bouton = f.querySelector("[type=submit]"), v = (n) => f.elements[n]?.value ?? "";
  let changements;
  if (type === "agence") {
    changements = { nom: v("nom"), telephone: v("telephone"), whatsapp: v("whatsapp"), email: v("email"), adresse: v("adresse"), slogan: v("slogan"), horaires: lignes(v("horaires")), lieux: lignes(v("lieux")),
      reseaux: { facebook: v("facebook"), instagram: v("instagram"), tiktok: v("tiktok") }, lien_avis_google: v("lien_avis_google") };
  } else if (type === "paiement") {
    const coordonnees = {};
    for (const champ of f.elements) if (champ.name?.startsWith("coord:")) coordonnees[champ.name.slice(6)] = champ.value;
    changements = { paiement_modes: $$("[name=mode]:checked", f).map((i) => i.value), paiement_coordonnees: coordonnees, paiement_en_ligne_lien: v("paiement_en_ligne_lien"), paiement_sur_place: v("paiement_sur_place") };
  } else {
    changements = {
      remises: $$("[data-remise]", f).map((l) => ({ jours_min: l.querySelector("[name=jours_min]").value, pourcentage: l.querySelector("[name=pourcentage]").value })),
      options: $$("[data-option]", f).map((l) => ({ id: l.dataset.id, nom: l.querySelector("[name=nom]").value, prix: l.querySelector("[name=prix]").value, par: l.querySelector("[name=par]").value, description: l.querySelector("[name=description]").value })),
      km_inclus_par_jour: v("km_inclus_par_jour"), prix_km_supplementaire: v("prix_km_supplementaire"), age_minimum: v("age_minimum"), permis_annees_minimum: v("permis_annees_minimum"),
    };
  }
  await sauverReglages(changements, bouton);
});

// ---------- Équipe ----------
const equipe = { comptes: [], journal: [], filtre: "" };

function afficherMotDePasse(titre, nom, motDePasse) {
  const corps = ouvrirFenetre(titre, `<p>Transmettez ce mot de passe provisoire à <b>${echapper(nom)}</b>. Il devra le remplacer dès sa première connexion.</p>
    <div class="mot-de-passe-affiche">${echapper(motDePasse)}</div><p class="aide-petit">⚠️ Il ne sera plus jamais affiché. Notez-le maintenant.</p>
    <div class="fenetre-pied"><button class="btn btn-contour" data-copier>Copier</button><button class="btn btn-rouge" data-fermer-fenetre>C'est noté</button></div>`, 480);
  corps.querySelector("[data-copier]").onclick = () => navigator.clipboard?.writeText(motDePasse).then(() => notifier("Mot de passe copié"));
}

async function rendreEquipe(conteneur) {
  conteneur.innerHTML = `<p class="gris">Chargement…</p>`;
  try { [equipe.comptes, equipe.journal] = await Promise.all([api("GET", "/utilisateurs"), api("GET", "/journal")]); } catch (e) { return notifier(e.message, "erreur"); }
  const journal = equipe.journal;
  conteneur.innerHTML = `
    <div class="entete-vue"><div><h2>Équipe</h2><p>Chaque employé a son propre accès. Tout ce qu'il fait est enregistré.</p></div>
      <div class="actions"><button class="btn btn-rouge" data-nouvel-employe>${icone("plus")}Ajouter un employé</button></div></div>
    <div class="carte tableau-boite" style="margin-bottom:22px"><table class="tableau"><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Dernière connexion</th><th>Accès</th><th></th></tr></thead><tbody>
      ${equipe.comptes.map((c) => `<tr style="cursor:default" data-compte="${c.id}">
        <td data-label="Nom" class="cellule-principale"><strong>${echapper(c.nom)}</strong>${c.id === etat.utilisateur.id ? `<span>c'est vous</span>` : ""}</td>
        <td data-label="Identifiant" class="mono">${echapper(c.identifiant)}</td>
        <td data-label="Rôle"><select data-role ${c.id === etat.utilisateur.id ? "disabled" : ""} style="width:auto"><option value="employe" ${c.role === "employe" ? "selected" : ""}>Employé</option><option value="admin" ${c.role === "admin" ? "selected" : ""}>Administrateur</option></select></td>
        <td data-label="Dernière connexion" class="gris">${c.derniere_connexion ? heureFr(c.derniere_connexion) : "jamais"}</td>
        <td data-label="Accès">${c.id === etat.utilisateur.id ? badge("badge-valide", "Actif", "check") : `<label class="interrupteur"><input type="checkbox" data-actif ${c.actif ? "checked" : ""}><i></i>${c.actif ? "Actif" : "Bloqué"}</label>`}</td>
        <td class="droite"><button class="btn btn-contour btn-petit" data-reinit title="Génère un nouveau mot de passe provisoire">${icone("cle")}Nouveau mot de passe</button></td></tr>`).join("")}</tbody></table></div>
    <div class="carte"><div class="carte-titre"><h3>Journal d'activité</h3><small>${pluriel(journal.length, "événement")}</small></div>
      <div class="carte-corps" style="padding-top:10px"><input type="search" id="journal-recherche" placeholder="Filtrer : employé, action, n° de réservation…" value="${echapper(equipe.filtre)}" style="max-width:420px;margin-bottom:14px">
      <ul class="historique" id="liste-journal" style="max-height:480px;overflow:auto">${htmlJournal()}</ul></div></div>`;
}
enregistrerVue("equipe", { titre: "Équipe", icone: "equipe", admin: true, rendre: rendreEquipe });

document.addEventListener("click", (e) => {
  if (routeActuelle().vue !== "equipe") return;
  if (e.target.closest("[data-nouvel-employe]")) {
    const corps = ouvrirFenetre("Ajouter un employé", `<form id="form-employe" class="formulaire-colonne" style="max-width:none" novalidate>
      <label>Nom complet<input name="nom" required></label>
      <label>Identifiant de connexion <small>(minuscules, sans espace — ex. samir)</small><input name="identifiant" autocapitalize="none" required></label>
      <label>Rôle<select name="role"><option value="employe">Employé — réservations, planning, dossiers</option><option value="admin">Administrateur — accès complet</option></select></label>
      <p class="erreur-form" hidden></p><div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Annuler</button><button class="btn btn-rouge" type="submit">Créer le compte</button></div></form>`, 500);
    corps.querySelector("form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target.elements, erreur = ev.target.querySelector(".erreur-form");
      try {
        const r = await api("POST", "/utilisateurs", { nom: f.nom.value, identifiant: f.identifiant.value, role: f.role.value });
        fermerFenetre(); afficherMotDePasse("Compte créé", r.compte.nom, r.mot_de_passe); rendreEquipe($("#contenu"));
      } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
    });
  }
  const reinit = e.target.closest("[data-reinit]");
  if (reinit) {
    const c = equipe.comptes.find((x) => x.id === reinit.closest("[data-compte]").dataset.compte);
    confirmer(`Générer un nouveau mot de passe provisoire pour <b>${echapper(c.nom)}</b> ? L'ancien ne fonctionnera plus.`, "Générer").then((oui) => oui && agir(reinit, async () => {
      const r = await api("PATCH", `/utilisateurs/${c.id}`, { reinitialiser: true });
      afficherMotDePasse("Nouveau mot de passe", c.nom, r.mot_de_passe);
    }));
  }
});
document.addEventListener("change", async (e) => {
  if (routeActuelle().vue !== "equipe") return;
  const ligne = e.target.closest("[data-compte]");
  if (!ligne) return;
  const changement = e.target.matches("[data-role]") ? { role: e.target.value } : e.target.matches("[data-actif]") ? { actif: e.target.checked } : null;
  if (!changement) return;
  try { await api("PATCH", `/utilisateurs/${ligne.dataset.compte}`, changement); notifier("Compte mis à jour ✓"); } catch (err) { notifier(err.message, "erreur"); }
  rendreEquipe($("#contenu"));
});
function htmlJournal() {
  const texte = normaliser(equipe.filtre);
  const journal = equipe.journal.filter((j) => !texte || normaliser(`${j.par} ${j.action} ${j.detail}`).includes(texte));
  return journal.slice(0, 150).map((j) => `<li><b style="color:var(--blanc)">${echapper(j.action)}</b> ${j.detail ? `<span class="gris">· ${echapper(j.detail)}</span>` : ""}<small>${echapper(j.par)} · ${heureFr(j.le)}</small></li>`).join("") || `<li class="gris">Rien à afficher.</li>`;
}
document.addEventListener("input", (e) => {
  if (e.target.id === "journal-recherche") { equipe.filtre = e.target.value; $("#liste-journal").innerHTML = htmlJournal(); }
});

// ---------- Mon compte ----------
function ouvrirMonCompte() {
  const u = etat.utilisateur;
  const corps = ouvrirFenetre("Mon compte", `
    <div class="paires"><div class="paire"><small>Nom</small><strong>${echapper(u.nom)}</strong></div><div class="paire"><small>Identifiant</small><strong>${echapper(u.identifiant)}</strong></div>
      <div class="paire"><small>Rôle</small><strong>${u.role === "admin" ? "Administrateur" : "Employé"}</strong></div></div>
    <form id="form-mon-mdp" class="formulaire-colonne" style="max-width:none" novalidate><h3>Changer mon mot de passe</h3>
      <label>Mot de passe actuel<input type="password" name="actuel" autocomplete="current-password" required></label>
      <div class="grille-form"><label>Nouveau mot de passe<input type="password" name="nouveau" autocomplete="new-password" required></label><label>Répétez-le<input type="password" name="repete" autocomplete="new-password" required></label></div>
      <p class="erreur-form" hidden></p><div class="fenetre-pied"><button type="button" class="btn btn-contour" data-fermer-fenetre>Fermer</button><button class="btn btn-rouge" type="submit">Changer le mot de passe</button></div></form>`, 560);
  corps.querySelector("#form-mon-mdp").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target.elements, erreur = ev.target.querySelector(".erreur-form");
    erreur.hidden = true;
    if (f.nouveau.value !== f.repete.value) { erreur.textContent = "Les deux mots de passe ne sont pas identiques."; erreur.hidden = false; return; }
    try { await api("POST", "/mot-de-passe", { actuel: f.actuel.value, nouveau: f.nouveau.value }); fermerFenetre(); notifier("Mot de passe modifié ✓"); } catch (err) { erreur.textContent = err.message; erreur.hidden = false; }
  });
}
