"""
CHM Automotive Location — logique métier partagée par le site client et la plateforme employeurs.

Fichiers, prix, disponibilités, réservations, dossiers, véhicules, comptes, journal.
Uniquement la bibliothèque standard de Python : rien à installer.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import unicodedata
from pathlib import Path

RACINE = Path(__file__).resolve().parent
PHOTOS = RACINE / "images" / "voitures"
# CHM_DONNEES permet de lancer une démonstration sans toucher aux vraies données
DONNEES = Path(os.environ.get("CHM_DONNEES") or RACINE / "donnees")
# Démo : si donnees_demo/informations existe, c'est elle qui sert (les vraies données ne sont jamais touchées)
INFOS = Path(os.environ.get("CHM_INFOS") or (DONNEES / "informations" if (DONNEES / "informations").is_dir() else RACINE / "informations"))
RESERVATIONS = DONNEES / "reservations.json"
DOSSIERS = DONNEES / "dossiers"
COMPTES = DONNEES / "comptes.json"
JOURNAL = DONNEES / "journal.json"
COMPTA = DONNEES / "comptabilite.json"  # journal des encaissements et décaissements
ETATS_PHOTOS = DONNEES / "etats"  # photos avant/après : jamais accessibles sans connexion

TAILLE_MAX_FICHIER = 8 * 1024 * 1024
TYPES_DOCUMENTS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif", "application/pdf": ".pdf"}
MIME_PAR_EXTENSION = {v: k for k, v in TYPES_DOCUMENTS.items()}
DOCUMENTS = {"permis_recto", "permis_verso", "identite_recto", "identite_verso", "domicile", "permis_international"}
CHAMPS_DOSSIER = {
    "nom", "prenom", "date_naissance", "nationalite", "telephone", "email", "adresse", "ville",
    "identite_type", "identite_numero", "identite_expiration", "permis_numero", "permis_date", "permis_pays",
    "reservation_numero", "conducteur2_nom", "conducteur2_prenom", "conducteur2_permis",
}
STATUTS_RESERVATION = ["en attente", "confirmée", "en cours", "terminée", "annulée"]
STATUTS_DOSSIER = ["à vérifier", "validé", "refusé"]
TELEPHONE = re.compile(r"^(\+213|00213|0)[2-7]\d{7,8}$")

# Tous les moyens de paiement proposés : l'agence choisit lesquels activer dans ses paramètres
CATALOGUE_PAIEMENT = [
    {"id": "Visa", "nom": "Carte Visa", "icone": "💳", "type": "carte"},
    {"id": "Mastercard", "nom": "Carte Mastercard", "icone": "💳", "type": "carte"},
    {"id": "CIB", "nom": "Carte CIB (interbancaire)", "icone": "💳", "type": "carte"},
    {"id": "Edahabia", "nom": "Carte Edahabia (Algérie Poste)", "icone": "💳", "type": "carte"},
    {"id": "BaridiMob", "nom": "BaridiMob", "icone": "📱", "type": "virement"},
    {"id": "CCP", "nom": "Virement CCP", "icone": "🏦", "type": "virement"},
    {"id": "Virement bancaire", "nom": "Virement bancaire (RIB)", "icone": "🏦", "type": "virement"},
    {"id": "Chèque", "nom": "Chèque de banque", "icone": "🧾", "type": "cheque"},
    {"id": "Espèces", "nom": "Espèces", "icone": "💵", "type": "especes"},
]

# Une seule écriture à la fois : deux personnes ne peuvent pas réserver la même voiture en même temps
VERROU = threading.RLock()


class ErreurClient(Exception):
    def __init__(self, message, code=400, **extra):
        super().__init__(message)
        self.code = code
        self.extra = extra


# ───────────────────────── Fichiers JSON ─────────────────────────
def lire_json(chemin, defaut):
    try:
        return json.loads(chemin.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defaut


def ecrire_json(chemin, valeur):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    temporaire = chemin.with_suffix(".tmp")
    temporaire.write_text(json.dumps(valeur, ensure_ascii=False, indent=2), encoding="utf-8")
    temporaire.replace(chemin)


def agence():
    return lire_json(INFOS / "agence.json", {})


def voitures():
    return lire_json(INFOS / "voitures.json", [])


def maintenant():
    return datetime.datetime.now().isoformat(timespec="seconds")


def journaliser(par, action, detail=""):
    """Qui a fait quoi, et quand. Visible par l'administrateur."""
    with VERROU:
        entrees = lire_json(JOURNAL, [])
        entrees.append({"le": maintenant(), "par": par or "client", "action": action, "detail": detail})
        ecrire_json(JOURNAL, entrees[-3000:])


# ───────────────────────── Dates et prix ─────────────────────────
def date_iso(texte, nom):
    try:
        return datetime.date.fromisoformat(str(texte))
    except ValueError:
        raise ErreurClient(f"La date de {nom} n'est pas valide.")


def jours_location(debut, fin):
    return max(1, (fin - debut).days)


def remise_pour(a, jours):
    return max([r["pourcentage"] for r in a.get("remises", []) if jours >= r["jours_min"]], default=0)


def devis(a, voiture, jours, ids_options):
    location = jours * voiture["prix_par_jour"]
    remise = remise_pour(a, jours)
    montant_remise = round(location * remise / 100)
    options = [
        {"nom": o["nom"], "montant": o["prix"] * jours if o["par"] == "jour" else o["prix"]}
        for o in a.get("options", []) if o["id"] in ids_options
    ]
    total = location - montant_remise + sum(o["montant"] for o in options)
    return {"location": location, "remise": remise, "montant_remise": montant_remise, "options": options, "total": total}


# ───────────────────────── Disponibilités ─────────────────────────
def periode(r):
    debut = datetime.date.fromisoformat(r["date_debut"])
    fin = datetime.date.fromisoformat(r["date_fin"])
    # Un départ et un retour le même jour occupent quand même la journée
    return debut, max(fin, debut + datetime.timedelta(days=1))


def voitures_occupees(debut, fin, reservations):
    fin = max(fin, debut + datetime.timedelta(days=1))
    return sorted({
        r["voiture_id"] for r in reservations
        if r.get("statut") != "annulée" and debut < periode(r)[1] and periode(r)[0] < fin
    })


def prochaine_fenetre_libre(voiture_id, debut, duree, reservations, horizon=240):
    """Première date de départ (à partir de `debut`) où le véhicule est libre pendant `duree` jours, ou None."""
    actives = [periode(r) for r in reservations if r["voiture_id"] == voiture_id and r.get("statut") != "annulée"]
    for decalage in range(horizon):
        depart = debut + datetime.timedelta(days=decalage)
        retour = depart + datetime.timedelta(days=duree)
        if not any(depart < fin_r and debut_r < retour for debut_r, fin_r in actives):
            return depart
    return None


def vue_alternative(v):
    return {k: v.get(k) for k in ("id", "marque", "modele", "annee", "categorie", "gamme", "prix_par_jour", "caution", "photo", "photo_v", "boite", "carburant", "places")}


def disponibilite(voiture_id, debut, fin):
    """
    Pour le site client : ce véhicule est-il libre sur ces dates ?
    Sinon : à partir de quand, et quels autres véhicules sont libres sur ces mêmes dates.
    Ne révèle jamais qui a réservé : seulement ce qui est libre ou occupé.
    """
    liste = voitures()
    voiture = next((v for v in liste if v["id"] == voiture_id), None)
    if not voiture or not en_ligne(voiture):
        raison = "hors_ligne"
    else:
        raison = None
    reservations = lire_json(RESERVATIONS, [])
    occupees = set(voitures_occupees(debut, fin, reservations))
    if raison is None and voiture_id in occupees:
        raison = "reserve"
    duree = max(1, (fin - debut).days)
    resultat = {"disponible": raison is None, "raison": raison, "libre_le": None, "libre_au": None, "alternatives": []}
    if raison is None:
        return resultat
    if raison == "reserve":
        libre = prochaine_fenetre_libre(voiture_id, debut, duree, reservations)
        if libre:
            resultat["libre_le"] = libre.isoformat()
            resultat["libre_au"] = (libre + datetime.timedelta(days=(fin - debut).days)).isoformat()
    ref = voiture or {}
    candidats = [v for v in liste if v["id"] != voiture_id and en_ligne(v) and v["id"] not in occupees]
    candidats.sort(key=lambda v: (v.get("categorie") != ref.get("categorie"), v.get("gamme") != ref.get("gamme"), abs(v.get("prix_par_jour", 0) - ref.get("prix_par_jour", 0))))
    resultat["alternatives"] = [vue_alternative(v) for v in candidats[:4]]
    return resultat


def prochaines_dates_libres(debut, fin):
    """Pour le catalogue : pour chaque véhicule occupé sur ces dates, la prochaine date de départ possible."""
    reservations = lire_json(RESERVATIONS, [])
    occupees = voitures_occupees(debut, fin, reservations)
    duree = max(1, (fin - debut).days)
    libre = {}
    for identifiant in occupees:
        v = next((x for x in voitures() if x["id"] == identifiant), None)
        if not v or not en_ligne(v):
            continue
        d = prochaine_fenetre_libre(identifiant, debut, duree, reservations)
        libre[identifiant] = d.isoformat() if d else None
    return {"occupees": occupees, "libre_le": libre}


# ───────────────────────── Réservations ─────────────────────────
def texte(corps, champ, longueur=120):
    return str(corps.get(champ) or "").strip()[:longueur]


def entier(valeur, nom, minimum=0, maximum=10**9):
    try:
        n = int(valeur)
    except (TypeError, ValueError):
        raise ErreurClient(f"{nom} : nombre invalide.")
    if not minimum <= n <= maximum:
        raise ErreurClient(f"{nom} : la valeur doit être entre {minimum} et {maximum}.")
    return n


def prochain_numero(reservations, prefixe):
    dernier = max((int(r["numero"].split("-")[1]) for r in reservations if r["numero"].startswith(prefixe + "-")), default=0)
    return f"{prefixe}-{dernier + 1:04d}"


def trouver_voiture(identifiant, seulement_en_ligne=False):
    return next((v for v in voitures() if v["id"] == identifiant and (en_ligne(v) or not seulement_en_ligne)), None)


def mode_paiement(a, corps):
    modes = {m["id"]: m for m in a.get("paiement_modes", [])} or {"Espèces": {"id": "Espèces", "type": "especes"}}
    paiement = corps.get("paiement") or {}
    mode = paiement.get("mode") if paiement.get("mode") in modes else next(iter(modes))
    type_mode = modes[mode].get("type")
    en_ligne = (
        bool(str(a.get("paiement_en_ligne_lien") or "").strip()) if type_mode == "carte"
        else bool(str((a.get("paiement_coordonnees") or {}).get(mode) or "").strip()) if type_mode == "virement"
        else False
    )
    lieux = {"agence", "livraison"} | ({"en ligne"} if en_ligne else set())
    lieu = paiement.get("lieu") if paiement.get("lieu") in lieux else "agence"
    return {"mode": mode, "lieu": lieu}


def creer_reservation(corps, par=None):
    """Réservation faite sur le site (par=None) ou saisie par un employé (par = son nom)."""
    a = agence()
    voiture = trouver_voiture(corps.get("voiture_id"), seulement_en_ligne=par is None)
    if not voiture:
        raise ErreurClient("Ce véhicule n'existe pas ou n'est plus proposé.")

    debut = date_iso(corps.get("date_debut"), "départ")
    fin = date_iso(corps.get("date_fin"), "retour")
    if debut < datetime.date.today() and par is None:
        raise ErreurClient("La date de départ est déjà passée.")
    if fin < debut:
        raise ErreurClient("La date de retour doit être après la date de départ.")
    if (fin - debut).days > 365:
        raise ErreurClient("Pour une location de plus d'un an, contactez directement l'agence.")

    nom, prenom, telephone = texte(corps, "nom"), texte(corps, "prenom"), texte(corps, "telephone", 30)
    if not nom or not prenom:
        raise ErreurClient("Indiquez le nom et le prénom.")
    if not TELEPHONE.match(re.sub(r"[\s.-]", "", telephone)):
        raise ErreurClient("Le numéro de téléphone n'est pas valide.")

    lieux = a.get("lieux", [])
    lieu_depart, lieu_retour = texte(corps, "lieu_depart"), texte(corps, "lieu_retour")
    if lieu_depart not in lieux or lieu_retour not in lieux:
        raise ErreurClient("Le lieu choisi n'est pas proposé.")

    ids_options = {o["id"] for o in a.get("options", [])}
    options = [o for o in corps.get("options") or [] if o in ids_options]
    jours = jours_location(debut, fin)
    prix = devis(a, voiture, jours, options)

    with VERROU:
        reservations = lire_json(RESERVATIONS, [])
        if voiture["id"] in voitures_occupees(debut, fin, reservations):
            raise ErreurClient("Ce véhicule est déjà réservé sur ces dates." if par else "Ce véhicule vient d'être réservé sur ces dates. Choisissez-en un autre ou d'autres dates.", 409)
        reservation = {
            "numero": prochain_numero(reservations, "CHM"),
            "statut": "confirmée" if par else "en attente",
            "source": "agence" if par else "site",
            "cree_le": maintenant(),
            "voiture_id": voiture["id"],
            "voiture": f'{voiture["marque"]} {voiture["modele"]}',
            "date_debut": debut.isoformat(),
            "heure_depart": texte(corps, "heure_depart", 5),
            "date_fin": fin.isoformat(),
            "heure_retour": texte(corps, "heure_retour", 5),
            "lieu_depart": lieu_depart,
            "lieu_retour": lieu_retour,
            "jours": jours,
            "options": options,
            "prix": prix,
            "total": prix["total"],
            "caution": voiture.get("caution"),
            "paye": 0,
            "caution_recue": False,
            "notes": texte(corps, "notes", 2000),
            "client": {
                "nom": nom, "prenom": prenom, "telephone": telephone,
                "email": texte(corps, "email"), "message": texte(corps, "message", 1000),
            },
            "paiement_souhaite": mode_paiement(a, corps),
            "historique": [{"le": maintenant(), "par": par or "client", "action": "Réservation créée"}],
        }
        reservations.append(reservation)
        ecrire_json(RESERVATIONS, reservations)

    journaliser(par, "réservation créée", f'{reservation["numero"]} · {reservation["voiture"]} · {prenom} {nom} · {prix["total"]} DA')
    print(f"  ✅ Réservation {reservation['numero']} : {reservation['voiture']} pour {prenom} {nom} ({telephone}), {prix['total']} DA")
    return reservation


def vue_publique(r):
    return {k: r[k] for k in ("numero", "voiture", "date_debut", "date_fin", "jours", "total", "prix", "caution", "paiement_souhaite")} | {"telephone": r["client"]["telephone"]}


def modifier_reservation(numero, corps, par):
    with VERROU:
        reservations = lire_json(RESERVATIONS, [])
        r = next((x for x in reservations if x["numero"] == numero), None)
        if not r:
            raise ErreurClient("Réservation introuvable.", 404)
        if r.get("statut") == "blocage":
            raise ErreurClient("Un blocage ne se modifie pas : supprimez-le puis recréez-le.")
        faits = []
        mouvements = []

        ancien_statut = r["statut"]
        if "statut" in corps and corps["statut"] != ancien_statut:
            if corps["statut"] not in STATUTS_RESERVATION:
                raise ErreurClient("Statut inconnu.")
            r["statut"] = corps["statut"]
            faits.append(f'statut : {ancien_statut} → {corps["statut"]}')
        if "paye" in corps and entier(corps["paye"], "Montant payé", 0, 10**8) != r.get("paye", 0):
            faits.append(f'paiement enregistré : {r.get("paye", 0)} → {int(corps["paye"])} DA')
            ecart = int(corps["paye"]) - r.get("paye", 0)
            mouvements.append(nouveau_mouvement(
                "entree" if ecart > 0 else "sortie", "location" if ecart > 0 else "remboursement", abs(ecart), par, source="reservation",
                mode=r["paiement_souhaite"]["mode"], voiture_id=r.get("voiture_id"), reservation=numero,
                libelle=f'{"Paiement" if ecart > 0 else "Remboursement"} · {numero} · {r["client"]["prenom"]} {r["client"]["nom"]}'))
            r["paye"] = int(corps["paye"])
        if "caution_recue" in corps and bool(corps["caution_recue"]) != r.get("caution_recue", False):
            r["caution_recue"] = bool(corps["caution_recue"])
            faits.append("caution encaissée" if r["caution_recue"] else "caution rendue")
            if r.get("caution"):
                mouvements.append(nouveau_mouvement(
                    "entree" if r["caution_recue"] else "sortie", "caution" if r["caution_recue"] else "restitution_caution", r["caution"], par, source="reservation",
                    mode=r["paiement_souhaite"]["mode"], voiture_id=r.get("voiture_id"), reservation=numero,
                    libelle=f'{"Caution reçue" if r["caution_recue"] else "Caution rendue"} · {numero} · {r["client"]["prenom"]} {r["client"]["nom"]}'))
        if "contrat_signe" in corps and bool(corps["contrat_signe"]) != r.get("contrat_signe", False):
            r["contrat_signe"] = bool(corps["contrat_signe"])
            r["contrat_signe_le"] = maintenant() if r["contrat_signe"] else ""
            faits.append("contrat signé" if r["contrat_signe"] else "signature du contrat retirée")
        if "notes" in corps and texte(corps, "notes", 2000) != r.get("notes", ""):
            r["notes"] = texte(corps, "notes", 2000)
            faits.append("notes modifiées")
        if "paiement_mode" in corps:
            modes = {m["id"] for m in agence().get("paiement_modes", [])} | {m["id"] for m in CATALOGUE_PAIEMENT}
            if corps["paiement_mode"] in modes and corps["paiement_mode"] != r["paiement_souhaite"]["mode"]:
                r["paiement_souhaite"]["mode"] = corps["paiement_mode"]
                faits.append(f'mode de paiement : {corps["paiement_mode"]}')

        if isinstance(corps.get("client"), dict):
            nouveau = {k: texte(corps["client"], k, 120) for k in ("nom", "prenom", "telephone", "email")}
            if not nouveau["nom"] or not nouveau["prenom"]:
                raise ErreurClient("Indiquez le nom et le prénom.")
            if not TELEPHONE.match(re.sub(r"[\s.-]", "", nouveau["telephone"])):
                raise ErreurClient("Le numéro de téléphone n'est pas valide.")
            if any(nouveau[k] != r["client"].get(k, "") for k in nouveau):
                r["client"].update(nouveau)
                faits.append("coordonnées du client modifiées")

        for cle, nom_cle in (("etat_depart", "départ"), ("etat_retour", "retour")):
            if isinstance(corps.get(cle), dict):
                e = corps[cle]
                r[cle] = {"km": entier_ou_none(e.get("km"), "Kilométrage", 0, 2_000_000), "carburant": choix(e, "carburant", CARBURANTS_NIVEAU, "plein", "Niveau de carburant"),
                          "dommages": bool(e.get("dommages")), "note": texte(e, "note", 300), "le": maintenant(), "par": par,
                          "photos": (r.get(cle) or {}).get("photos", [])}
                faits.append(f'état des lieux au {nom_cle} : {r[cle]["km"] if r[cle]["km"] is not None else "?"} km, carburant {r[cle]["carburant"]}' + (" · dommage signalé" if r[cle]["dommages"] else ""))
                maj_vehicule_apres_etat_des_lieux(r["voiture_id"], r[cle]["km"], r[cle]["dommages"], par)

        champs_prix = ("date_debut", "date_fin", "options", "voiture_id", "lieu_depart", "lieu_retour", "heure_depart", "heure_retour")
        modifie = any(k in corps and corps[k] != r.get(k) for k in champs_prix)
        if modifie:
            a = agence()
            voiture = trouver_voiture(corps.get("voiture_id", r["voiture_id"]))
            if not voiture:
                raise ErreurClient("Véhicule inconnu.")
            debut = date_iso(corps.get("date_debut", r["date_debut"]), "départ")
            fin = date_iso(corps.get("date_fin", r["date_fin"]), "retour")
            if fin < debut:
                raise ErreurClient("La date de retour doit être après la date de départ.")
            ids = {o["id"] for o in a.get("options", [])}
            options = [o for o in corps.get("options", r["options"]) if o in ids]
            lieux = a.get("lieux", [])
            for champ in ("lieu_depart", "lieu_retour"):
                if corps.get(champ, r[champ]) not in lieux:
                    raise ErreurClient("Le lieu choisi n'est pas proposé.")
            jours = jours_location(debut, fin)
            prix = devis(a, voiture, jours, options)
            r.update({
                "voiture_id": voiture["id"], "voiture": f'{voiture["marque"]} {voiture["modele"]}',
                "date_debut": debut.isoformat(), "date_fin": fin.isoformat(), "jours": jours,
                "options": options, "prix": prix, "total": prix["total"], "caution": voiture.get("caution"),
                "heure_depart": texte({"h": corps.get("heure_depart", r.get("heure_depart", ""))}, "h", 5),
                "heure_retour": texte({"h": corps.get("heure_retour", r.get("heure_retour", ""))}, "h", 5),
                "lieu_depart": corps.get("lieu_depart", r["lieu_depart"]), "lieu_retour": corps.get("lieu_retour", r["lieu_retour"]),
            })
            faits.append(f'réservation modifiée : {r["voiture"]}, du {r["date_debut"]} au {r["date_fin"]}, total {prix["total"]} DA')

        if r["statut"] != "annulée" and (modifie or ancien_statut == "annulée"):
            autres = [x for x in reservations if x["numero"] != numero]
            if r["voiture_id"] in voitures_occupees(*periode(r), autres):
                raise ErreurClient("Ce véhicule est déjà pris (réservation ou blocage) sur ces dates.", 409)

        if faits:
            r.setdefault("historique", []).extend({"le": maintenant(), "par": par, "action": f} for f in faits)
            ecrire_json(RESERVATIONS, reservations)
            enregistrer_mouvements(mouvements)
            journaliser(par, "réservation modifiée", f'{numero} · ' + " ; ".join(faits))
        return r


def supprimer_reservation(numero, par):
    with VERROU:
        reservations = lire_json(RESERVATIONS, [])
        r = next((x for x in reservations if x["numero"] == numero), None)
        if not r:
            raise ErreurClient("Introuvable.", 404)
        ecrire_json(RESERVATIONS, [x for x in reservations if x["numero"] != numero])
        if (ETATS_PHOTOS / numero).is_dir():
            shutil.rmtree(ETATS_PHOTOS / numero)
    journaliser(par, "suppression", f'{numero} ({r.get("voiture", "")})')


def creer_blocage(corps, par):
    """Immobilise un véhicule (entretien, panne, réservé pour un proche…) : il n'est plus louable sur ces dates."""
    voiture = trouver_voiture(corps.get("voiture_id"))
    if not voiture:
        raise ErreurClient("Véhicule inconnu.")
    debut, fin = date_iso(corps.get("date_debut"), "début"), date_iso(corps.get("date_fin"), "fin")
    if fin < debut:
        raise ErreurClient("La date de fin doit être après la date de début.")
    with VERROU:
        reservations = lire_json(RESERVATIONS, [])
        if voiture["id"] in voitures_occupees(debut, fin, reservations):
            raise ErreurClient("Ce véhicule est déjà réservé sur ces dates : annulez d'abord la réservation.", 409)
        blocage = {
            "numero": prochain_numero(reservations, "BLK"), "statut": "blocage", "cree_le": maintenant(),
            "voiture_id": voiture["id"], "voiture": f'{voiture["marque"]} {voiture["modele"]}',
            "date_debut": debut.isoformat(), "date_fin": fin.isoformat(), "motif": texte(corps, "motif", 200) or "Indisponible",
            "client": {"nom": "", "prenom": "", "telephone": ""}, "total": 0, "paye": 0, "jours": jours_location(debut, fin),
        }
        reservations.append(blocage)
        ecrire_json(RESERVATIONS, reservations)
    journaliser(par, "véhicule bloqué", f'{blocage["voiture"]} du {debut} au {fin} · {blocage["motif"]}')
    return blocage


# ───────────────────────── Photos de l'état des lieux (avant la prise / après le retour) ─────────────────────────
VUES_ETAT = ["avant", "arriere", "gauche", "droite", "interieur", "compteur", "dommage", "autre"]
CLES_MOMENT = {"depart": "etat_depart", "retour": "etat_retour"}
MAX_PHOTOS_PAR_MOMENT = 24
NOM_PHOTO = re.compile(r"^[0-9a-f]{8}\.(jpg|png|webp)$")
MIME_IMAGES = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def extension_image(contenu):
    """Le type réel se lit dans le fichier lui-même, pas dans ce que le navigateur annonce."""
    if contenu[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if contenu[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if contenu[:4] == b"RIFF" and contenu[8:12] == b"WEBP":
        return ".webp"
    return None


def ajouter_photo_etat(numero, moment, corps, par):
    """Une photo à la fois (le navigateur les réduit avant l'envoi)."""
    if moment not in CLES_MOMENT:
        raise ErreurClient("Moment inconnu : départ ou retour.")
    cle = CLES_MOMENT[moment]
    vue = choix(corps, "vue", VUES_ETAT, "autre", "Vue")
    try:
        contenu = base64.b64decode(corps.get("contenu") or "", validate=True)
    except ValueError:
        raise ErreurClient("Photo illisible.")
    if not contenu or len(contenu) > 6 * 1024 * 1024:
        raise ErreurClient("La photo doit faire moins de 6 Mo.")
    extension = extension_image(contenu)
    if not extension:
        raise ErreurClient("Format non accepté : utilisez une photo JPG, PNG ou WebP.")
    with VERROU:
        reservations = lire_json(RESERVATIONS, [])
        r = next((x for x in reservations if x["numero"] == numero), None)
        if not r or r.get("statut") == "blocage":
            raise ErreurClient("Réservation introuvable.", 404)
        etat_des_lieux = r.setdefault(cle, {"km": None, "carburant": "plein", "dommages": False, "note": "", "le": maintenant(), "par": par, "photos": []})
        etat_des_lieux.setdefault("photos", [])
        if len(etat_des_lieux["photos"]) >= MAX_PHOTOS_PAR_MOMENT:
            raise ErreurClient(f"Maximum {MAX_PHOTOS_PAR_MOMENT} photos par état des lieux.")
        nom = f"{secrets.token_hex(4)}{extension}"
        dossier = ETATS_PHOTOS / numero / moment
        dossier.mkdir(parents=True, exist_ok=True)
        (dossier / nom).write_bytes(contenu)
        photo = {"fichier": nom, "vue": vue, "legende": texte(corps, "legende", 120), "le": maintenant(), "par": par}
        etat_des_lieux["photos"].append(photo)
        r.setdefault("historique", []).append({"le": maintenant(), "par": par, "action": f'photo ajoutée ({vue}) — état des lieux au {"départ" if moment == "depart" else "retour"}'})
        ecrire_json(RESERVATIONS, reservations)
    journaliser(par, "photo d'état des lieux", f'{numero} · {moment} · {vue}')
    return r


def lire_photo_etat(numero, moment, fichier):
    if moment not in CLES_MOMENT or not NOM_PHOTO.match(fichier or "") or not re.fullmatch(r"[A-Z]{3}-\d{4}", numero):
        raise ErreurClient("Photo introuvable.", 404)
    r = next((x for x in lire_json(RESERVATIONS, []) if x["numero"] == numero), None)
    if not r or not any(p["fichier"] == fichier for p in (r.get(CLES_MOMENT[moment]) or {}).get("photos", [])):
        raise ErreurClient("Photo introuvable.", 404)
    chemin = ETATS_PHOTOS / numero / moment / fichier
    if not chemin.is_file():
        raise ErreurClient("Photo introuvable.", 404)
    return chemin.read_bytes(), MIME_IMAGES[chemin.suffix], fichier


def supprimer_photo_etat(numero, moment, fichier, par):
    with VERROU:
        lire_photo_etat(numero, moment, fichier)  # vérifie que tout existe
        reservations = lire_json(RESERVATIONS, [])
        r = next(x for x in reservations if x["numero"] == numero)
        e = r[CLES_MOMENT[moment]]
        e["photos"] = [p for p in e["photos"] if p["fichier"] != fichier]
        (ETATS_PHOTOS / numero / moment / fichier).unlink(missing_ok=True)
        r.setdefault("historique", []).append({"le": maintenant(), "par": par, "action": f"photo supprimée — état des lieux au {'départ' if moment == 'depart' else 'retour'}"})
        ecrire_json(RESERVATIONS, reservations)
    journaliser(par, "photo supprimée", f"{numero} · {moment}")
    return r


# ───────────────────────── Dossiers clients ─────────────────────────
NUMERO_DOSSIER = re.compile(r"^D-\d{4}$")


def creer_dossier(corps):
    champs = {k: str(v).strip()[:200] for k, v in (corps.get("champs") or {}).items() if k in CHAMPS_DOSSIER}
    for champ in ("nom", "prenom", "telephone", "permis_numero", "identite_numero"):
        if not champs.get(champ):
            raise ErreurClient("Il manque des informations obligatoires dans le dossier.")

    documents = []
    for d in corps.get("documents") or []:
        type_doc, mime = d.get("type"), d.get("mime")
        if type_doc not in DOCUMENTS or mime not in TYPES_DOCUMENTS:
            raise ErreurClient("Un des fichiers n'est pas accepté (photo JPG/PNG ou PDF uniquement).")
        try:
            contenu = base64.b64decode(d.get("contenu") or "", validate=True)
        except ValueError:
            raise ErreurClient("Un des fichiers est abîmé, choisissez-le à nouveau.")
        if not contenu or len(contenu) > TAILLE_MAX_FICHIER:
            raise ErreurClient("Chaque fichier doit faire moins de 8 Mo.")
        documents.append((type_doc, TYPES_DOCUMENTS[mime], contenu, str(d.get("nom") or "")[:120]))
    if not documents:
        raise ErreurClient("Ajoutez au moins la photo de votre permis et de votre pièce d'identité.")

    with VERROU:
        DOSSIERS.mkdir(parents=True, exist_ok=True)
        dernier = max((int(p.name.split("-")[1]) for p in DOSSIERS.glob("D-*") if p.is_dir()), default=0)
        numero = f"D-{dernier + 1:04d}"
        dossier = DOSSIERS / numero
        dossier.mkdir()

    fichiers = []
    for type_doc, extension, contenu, nom_origine in documents:
        (dossier / f"{type_doc}{extension}").write_bytes(contenu)
        fichiers.append({"type": type_doc, "fichier": f"{type_doc}{extension}", "nom_origine": nom_origine})
    ecrire_json(dossier / "dossier.json", {
        "numero": numero, "recu_le": maintenant(), "statut": "à vérifier", "notes": "", **champs, "documents": fichiers,
    })
    journaliser(None, "dossier reçu", f'{numero} · {champs["prenom"]} {champs["nom"]}')
    print(f"  📁 Dossier {numero} reçu : {champs['prenom']} {champs['nom']} ({len(fichiers)} documents)")
    return {"numero": numero}


def lister_dossiers():
    return sorted((lire_json(p / "dossier.json", {}) for p in DOSSIERS.glob("D-*") if p.is_dir()), key=lambda d: d.get("recu_le", ""), reverse=True)


def dossier_valide(numero):
    if not NUMERO_DOSSIER.match(str(numero)):
        raise ErreurClient("Dossier introuvable.", 404)
    chemin = DOSSIERS / numero / "dossier.json"
    if not chemin.exists():
        raise ErreurClient("Dossier introuvable.", 404)
    return chemin


def fichier_dossier(numero, nom):
    chemin = dossier_valide(numero)
    doc = next((d for d in lire_json(chemin, {}).get("documents", []) if d["fichier"] == nom), None)
    if not doc:
        raise ErreurClient("Fichier introuvable.", 404)
    fichier = chemin.parent / doc["fichier"]
    return fichier.read_bytes(), MIME_PAR_EXTENSION.get(fichier.suffix, "application/octet-stream"), doc["fichier"]


def modifier_dossier(numero, corps, par):
    with VERROU:
        chemin = dossier_valide(numero)
        d = lire_json(chemin, {})
        faits = []
        if "statut" in corps and corps["statut"] != d.get("statut"):
            if corps["statut"] not in STATUTS_DOSSIER:
                raise ErreurClient("Statut inconnu.")
            d["statut"] = corps["statut"]
            faits.append(f'statut → {corps["statut"]}')
        if "notes" in corps and texte(corps, "notes", 2000) != d.get("notes", ""):
            d["notes"] = texte(corps, "notes", 2000)
            faits.append("notes modifiées")
        if faits:
            ecrire_json(chemin, d)
            journaliser(par, "dossier modifié", f'{numero} · ' + " ; ".join(faits))
        return d


def supprimer_dossier(numero, par):
    with VERROU:
        chemin = dossier_valide(numero)
        shutil.rmtree(chemin.parent)
    journaliser(par, "dossier supprimé", numero)


# ───────────────────────── Véhicules ─────────────────────────
def slug(texte_brut):
    s = unicodedata.normalize("NFD", texte_brut.lower())
    return re.sub(r"[^a-z0-9]+", "-", "".join(c for c in s if unicodedata.category(c) != "Mn")).strip("-")


GAMMES = ["Économique", "Confort", "Premium", "Luxe", "Utilitaire"]
ETATS_VEHICULE = ["disponible", "nettoyage", "maintenance", "reparation", "hors_service"]
ETATS_BLOQUANTS = {"maintenance", "reparation", "hors_service"}  # le véhicule ne peut plus être loué
ETATS_GENERAUX = ["excellent", "bon", "correct", "a_revoir"]
CARBURANTS_NIVEAU = ["plein", "3/4", "1/2", "1/4", "reserve"]
TYPES_ENTRETIEN = ["vidange", "revision", "pneus", "freins", "batterie", "climatisation", "controle_technique", "assurance", "vignette", "carrosserie", "autre"]
CHAMPS_OPERATIONNELS = ("disponible", "etat", "etat_general", "emplacement", "emplacement_detail", "kilometrage", "notes")
CHAMPS_PRIVES = ("vin", "prix_achat", "date_achat", "assurance_police", "notes", "entretiens", "assurance_compagnie")


def en_ligne(v):
    """Un véhicule est proposé sur le site s'il est « en ligne » ET en état de rouler."""
    return bool(v.get("disponible", True)) and v.get("etat", "disponible") not in ETATS_BLOQUANTS


def vue_publique_voiture(v):
    """Ce que le site client a le droit de voir (jamais le châssis, le prix d'achat, les notes…)."""
    cache = {k: x for k, x in v.items() if k not in CHAMPS_PRIVES and not k.startswith(("assurance_", "controle_", "vignette_", "entretien_", "date_", "emplacement", "etat", "kilometrage", "immatriculation"))}
    cache["disponible"] = en_ligne(v)
    return cache


def date_ou_vide(valeur, nom):
    valeur = str(valeur or "").strip()
    return date_iso(valeur, nom).isoformat() if valeur else ""


def entier_ou_none(valeur, nom, minimum=0, maximum=10**9):
    return None if valeur in (None, "") else entier(valeur, nom, minimum, maximum)


def choix(corps, champ, valides, defaut, nom):
    valeur = corps.get(champ, defaut)
    if valeur not in valides:
        raise ErreurClient(f"{nom} : valeur inconnue.")
    return valeur


def valider_voiture(corps, existante=None):
    marque, modele = texte(corps, "marque", 40), texte(corps, "modele", 60)
    if not marque or not modele:
        raise ErreurClient("Indiquez la marque et le modèle.")
    if corps.get("boite") not in ("Manuelle", "Automatique"):
        raise ErreurClient("Boîte de vitesses : Manuelle ou Automatique.")
    base = existante or {}
    voiture = dict(base)
    voiture.update({
        "marque": marque, "modele": modele,
        "annee": entier(corps.get("annee"), "Année", 1990, datetime.date.today().year + 1),
        "categorie": texte(corps, "categorie", 30) or "Citadine",
        "gamme": choix(corps, "gamme", GAMMES, base.get("gamme", "Confort"), "Gamme"),
        "couleur": texte(corps, "couleur", 30) if "couleur" in corps else base.get("couleur", ""),
        "prix_par_jour": entier(corps.get("prix_par_jour"), "Prix par jour", 500, 1_000_000),
        "caution": entier(corps.get("caution"), "Caution", 0, 10_000_000),
        "boite": corps["boite"], "carburant": texte(corps, "carburant", 20) or "Essence",
        "places": entier(corps.get("places"), "Places", 1, 20), "portes": entier(corps.get("portes", 5), "Portes", 2, 6),
        "bagages": entier(corps.get("bagages", 2), "Bagages", 0, 20),
        "description": texte(corps, "description", 400),
        "equipements": [str(e).strip()[:60] for e in (corps.get("equipements") or []) if str(e).strip()][:14],
        "disponible": bool(corps.get("disponible", True)),
        "etat": choix(corps, "etat", ETATS_VEHICULE, base.get("etat", "disponible"), "État"),
        "etat_general": choix(corps, "etat_general", ETATS_GENERAUX, base.get("etat_general", "bon"), "État général"),
    })
    if corps.get("autonomie_km"):
        voiture["autonomie_km"] = entier(corps["autonomie_km"], "Autonomie", 50, 1500)
    else:
        voiture.pop("autonomie_km", None)
    # informations facultatives : on ne touche que ce qui est envoyé
    for champ, longueur in (("immatriculation", 20), ("vin", 24), ("emplacement", 60), ("emplacement_detail", 40), ("assurance_compagnie", 60), ("assurance_police", 40), ("notes", 1000)):
        if champ in corps:
            valeur = texte(corps, champ, longueur)
            voiture[champ] = valeur.upper() if champ == "vin" else valeur
    for champ, nom in (("assurance_expiration", "expiration de l'assurance"), ("controle_technique_expiration", "contrôle technique"), ("vignette_expiration", "vignette"),
                       ("date_mise_en_circulation", "mise en circulation"), ("date_achat", "achat"), ("entretien_prochaine_date", "prochain entretien")):
        if champ in corps:
            voiture[champ] = date_ou_vide(corps[champ], nom)
    for champ, nom, maximum in (("kilometrage", "Kilométrage", 2_000_000), ("entretien_prochain_km", "Kilométrage du prochain entretien", 2_000_000), ("prix_achat", "Prix d'achat", 10**9)):
        if champ in corps:
            voiture[champ] = entier_ou_none(corps[champ], nom, 0, maximum)
    return voiture


def creer_voiture(corps, par):
    with VERROU:
        liste = voitures()
        voiture = valider_voiture(corps)
        base = slug(f'{voiture["marque"]} {voiture["modele"]}') or "vehicule"
        identifiant, n = base, 2
        while any(v["id"] == identifiant for v in liste):
            identifiant, n = f"{base}-{n}", n + 1
        voiture = {"id": identifiant, **voiture}
        liste.append(voiture)
        ecrire_json(INFOS / "voitures.json", liste)
    journaliser(par, "véhicule ajouté", f'{voiture["marque"]} {voiture["modele"]}')
    return voiture


def modifier_voiture(identifiant, corps, par):
    """Modification complète (administrateur)."""
    with VERROU:
        liste = voitures()
        existante = next((v for v in liste if v["id"] == identifiant), None)
        if not existante:
            raise ErreurClient("Véhicule introuvable.", 404)
        voiture = valider_voiture(corps, existante)
        liste[liste.index(existante)] = voiture
        ecrire_json(INFOS / "voitures.json", liste)
    journaliser(par, "véhicule modifié", f'{voiture["marque"]} {voiture["modele"]}')
    return voiture


def modifier_voiture_operationnel(identifiant, corps, par):
    """Ce que tout employé peut changer au quotidien : état, emplacement, kilométrage, mise en ligne."""
    with VERROU:
        liste = voitures()
        existante = next((v for v in liste if v["id"] == identifiant), None)
        if not existante:
            raise ErreurClient("Véhicule introuvable.", 404)
        v, faits = dict(existante), []
        if "disponible" in corps and bool(corps["disponible"]) != v.get("disponible", True):
            v["disponible"] = bool(corps["disponible"])
            faits.append("remis en ligne" if v["disponible"] else "retiré du site")
        if "etat" in corps and corps["etat"] != v.get("etat", "disponible"):
            if corps["etat"] not in ETATS_VEHICULE:
                raise ErreurClient("État inconnu.")
            faits.append(f'état : {v.get("etat", "disponible")} → {corps["etat"]}')
            v["etat"] = corps["etat"]
        if "etat_general" in corps and corps["etat_general"] != v.get("etat_general", "bon"):
            if corps["etat_general"] not in ETATS_GENERAUX:
                raise ErreurClient("État général inconnu.")
            faits.append(f'état général : {corps["etat_general"]}')
            v["etat_general"] = corps["etat_general"]
        for champ in ("emplacement", "emplacement_detail"):
            if champ in corps and texte(corps, champ, 60) != v.get(champ, ""):
                v[champ] = texte(corps, champ, 60)
                faits.append(f'{"emplacement" if champ == "emplacement" else "place"} : {v[champ] or "—"}')
        if "kilometrage" in corps and entier_ou_none(corps["kilometrage"], "Kilométrage", 0, 2_000_000) != v.get("kilometrage"):
            v["kilometrage"] = entier_ou_none(corps["kilometrage"], "Kilométrage", 0, 2_000_000)
            faits.append(f'kilométrage : {v["kilometrage"]} km')
        if "notes" in corps and texte(corps, "notes", 1000) != v.get("notes", ""):
            v["notes"] = texte(corps, "notes", 1000)
            faits.append("notes modifiées")
        if faits:
            liste[liste.index(existante)] = v
            ecrire_json(INFOS / "voitures.json", liste)
            journaliser(par, "véhicule modifié", f'{v["marque"]} {v["modele"]} · ' + " ; ".join(faits))
        return v


def ajouter_entretien(identifiant, corps, par):
    """Carnet d'entretien : vidange, pneus, contrôle technique… (met à jour le kilométrage et le prochain rendez-vous)."""
    with VERROU:
        liste = voitures()
        v = next((x for x in liste if x["id"] == identifiant), None)
        if not v:
            raise ErreurClient("Véhicule introuvable.", 404)
        entree = {
            "id": secrets.token_hex(3),
            "date": date_ou_vide(corps.get("date"), "intervention") or datetime.date.today().isoformat(),
            "type": choix(corps, "type", TYPES_ENTRETIEN, "autre", "Type d'intervention"),
            "km": entier_ou_none(corps.get("km"), "Kilométrage", 0, 2_000_000),
            "cout": entier(corps.get("cout") or 0, "Coût", 0, 100_000_000),
            "note": texte(corps, "note", 300), "par": par,
        }
        v["entretiens"] = sorted([*v.get("entretiens", []), entree], key=lambda e: e["date"], reverse=True)
        if entree["km"] and entree["km"] > (v.get("kilometrage") or 0):
            v["kilometrage"] = entree["km"]
        if corps.get("prochain_km") not in (None, ""):
            v["entretien_prochain_km"] = entier(corps["prochain_km"], "Prochain entretien (km)", 0, 2_000_000)
        if corps.get("prochaine_date"):
            v["entretien_prochaine_date"] = date_ou_vide(corps["prochaine_date"], "prochain entretien")
        if entree["type"] == "assurance" and corps.get("nouvelle_expiration"):
            v["assurance_expiration"] = date_ou_vide(corps["nouvelle_expiration"], "assurance")
        if entree["type"] == "controle_technique" and corps.get("nouvelle_expiration"):
            v["controle_technique_expiration"] = date_ou_vide(corps["nouvelle_expiration"], "contrôle technique")
        if entree["type"] == "vignette" and corps.get("nouvelle_expiration"):
            v["vignette_expiration"] = date_ou_vide(corps["nouvelle_expiration"], "vignette")
        if corps.get("remettre_en_service") and v.get("etat") in ETATS_BLOQUANTS:
            v["etat"] = "disponible"
        ecrire_json(INFOS / "voitures.json", liste)
        if entree["cout"]:
            enregistrer_mouvements([nouveau_mouvement(
                "sortie", entree["type"] if entree["type"] in CATEGORIES_SORTIE else "reparation", entree["cout"], par, source="entretien", lien=entree["id"],
                date=entree["date"], voiture_id=v["id"], libelle=entree["note"] or f'Entretien · {v["marque"]} {v["modele"]}')])
    journaliser(par, "entretien enregistré", f'{v["marque"]} {v["modele"]} · {entree["type"]}' + (f' · {entree["cout"]} DA' if entree["cout"] else ""))
    return v


# ───────────────────────── Comptabilité ─────────────────────────
# groupe : « vehicule » = charge qui se rattache à un véhicule précis ; « hors_resultat » = ne compte ni en recette ni en charge (cautions)
CATEGORIES_ENTREE = {
    "location": {"nom": "Location (paiement client)"},
    "supplement": {"nom": "Options, livraison, suppléments"},
    "penalite": {"nom": "Pénalité (retard, carburant, dommage)"},
    "caution": {"nom": "Caution reçue", "groupe": "hors_resultat"},
    "autre_entree": {"nom": "Autre encaissement"},
}
CATEGORIES_SORTIE = {
    "carburant": {"nom": "Carburant", "groupe": "vehicule"},
    "assurance": {"nom": "Assurance", "groupe": "vehicule"},
    "vignette": {"nom": "Vignette", "groupe": "vehicule"},
    "controle_technique": {"nom": "Contrôle technique", "groupe": "vehicule"},
    "vidange": {"nom": "Vidange", "groupe": "vehicule"},
    "revision": {"nom": "Révision", "groupe": "vehicule"},
    "pneus": {"nom": "Pneus", "groupe": "vehicule"},
    "freins": {"nom": "Freins", "groupe": "vehicule"},
    "batterie": {"nom": "Batterie", "groupe": "vehicule"},
    "climatisation": {"nom": "Climatisation", "groupe": "vehicule"},
    "carrosserie": {"nom": "Carrosserie", "groupe": "vehicule"},
    "reparation": {"nom": "Réparation, pièces", "groupe": "vehicule"},
    "lavage": {"nom": "Lavage, nettoyage", "groupe": "vehicule"},
    "amende": {"nom": "Amende, PV", "groupe": "vehicule"},
    "parking_peage": {"nom": "Parking, péage", "groupe": "vehicule"},
    "credit": {"nom": "Crédit, leasing du véhicule", "groupe": "vehicule"},
    "achat_vehicule": {"nom": "Achat d'un véhicule", "groupe": "vehicule"},
    "remboursement": {"nom": "Remboursement à un client"},
    "restitution_caution": {"nom": "Caution rendue", "groupe": "hors_resultat"},
    "salaires": {"nom": "Salaires, primes"},
    "loyer": {"nom": "Loyer du local"},
    "electricite_eau": {"nom": "Électricité, eau"},
    "telecom": {"nom": "Téléphone, internet"},
    "publicite": {"nom": "Publicité, site web"},
    "impots": {"nom": "Impôts, taxes, cotisations"},
    "fournitures": {"nom": "Fournitures, entretien du local"},
    "autre_sortie": {"nom": "Autre décaissement"},
}


def nouveau_mouvement(sens, categorie, montant, par, source="manuel", **champs):
    return {"id": secrets.token_hex(4), "date": champs.get("date") or datetime.date.today().isoformat(), "sens": sens, "categorie": categorie, "montant": montant,
            "mode": champs.get("mode") or "", "voiture_id": champs.get("voiture_id") or "", "reservation": champs.get("reservation") or "",
            "libelle": champs.get("libelle") or "", "source": source, "lien": champs.get("lien") or "", "par": par, "cree_le": maintenant()}


def enregistrer_mouvements(nouveaux):
    if not nouveaux:
        return
    with VERROU:
        ecrire_json(COMPTA, [*lire_json(COMPTA, []), *nouveaux])


def liste_mouvements():
    return sorted(lire_json(COMPTA, []), key=lambda m: (m["date"], m["cree_le"]), reverse=True)


def ajouter_mouvement(corps, par):
    sens = choix(corps, "sens", ("entree", "sortie"), "", "Sens")
    categories = CATEGORIES_ENTREE if sens == "entree" else CATEGORIES_SORTIE
    categorie = choix(corps, "categorie", categories, "", "Catégorie")
    voiture_id = texte(corps, "voiture_id", 60)
    if voiture_id and not any(v["id"] == voiture_id for v in voitures()):
        raise ErreurClient("Véhicule introuvable.")
    if categories[categorie].get("groupe") == "vehicule" and not voiture_id:
        raise ErreurClient("Choisissez le véhicule concerné par cette charge.")
    m = nouveau_mouvement(sens, categorie, entier(corps.get("montant"), "Montant", 1, 10**9), par, mode=texte(corps, "mode", 30), voiture_id=voiture_id,
                          date=date_ou_vide(corps.get("date"), "Date"), libelle=texte(corps, "libelle", 200))
    enregistrer_mouvements([m])
    journaliser(par, "encaissement enregistré" if sens == "entree" else "décaissement enregistré", f'{categories[categorie]["nom"]} · {m["montant"]} DA' + (f' · {m["libelle"]}' if m["libelle"] else ""))
    return m


def depenses_vehicules():
    """Toutes les charges rattachées à un véhicule (entretien, carburant, assurance…), visibles par les employés dans la fiche du véhicule."""
    return {"depenses": [m for m in liste_mouvements() if m["sens"] == "sortie" and m["voiture_id"] and m["categorie"] in CATEGORIES_SORTIE],
            "categories": {k: c for k, c in CATEGORIES_SORTIE.items() if c.get("groupe") == "vehicule" and k != "achat_vehicule"}}


def ajouter_depense_vehicule(identifiant, corps, par):
    if corps.get("categorie") not in depenses_vehicules()["categories"]:
        raise ErreurClient("Catégorie de dépense inconnue.")
    return ajouter_mouvement({**corps, "sens": "sortie", "voiture_id": identifiant}, par)


def supprimer_mouvement(identifiant, par):
    with VERROU:
        tous = lire_json(COMPTA, [])
        m = next((x for x in tous if x["id"] == identifiant), None)
        if not m:
            raise ErreurClient("Mouvement introuvable.", 404)
        if m.get("source") != "manuel":
            raise ErreurClient("Ce mouvement vient d'une réservation ou d'un entretien : corrigez-le à cet endroit.", 409)
        ecrire_json(COMPTA, [x for x in tous if x["id"] != identifiant])
    journaliser(par, "mouvement supprimé", f'{m["categorie"]} · {m["montant"]} DA')


def supprimer_entretien(identifiant, entretien_id, par):
    with VERROU:
        liste = voitures()
        v = next((x for x in liste if x["id"] == identifiant), None)
        if not v:
            raise ErreurClient("Véhicule introuvable.", 404)
        v["entretiens"] = [e for e in v.get("entretiens", []) if e["id"] != entretien_id]
        ecrire_json(INFOS / "voitures.json", liste)
        ecrire_json(COMPTA, [m for m in lire_json(COMPTA, []) if not (m.get("source") == "entretien" and m.get("lien") == entretien_id)])
    journaliser(par, "entretien supprimé", f'{v["marque"]} {v["modele"]}')
    return v


def maj_vehicule_apres_etat_des_lieux(voiture_id, km, dommages, par):
    """Un départ ou un retour met à jour le compteur du véhicule ; un dommage le signale."""
    with VERROU:
        liste = voitures()
        v = next((x for x in liste if x["id"] == voiture_id), None)
        if not v:
            return
        change = False
        if km and km > (v.get("kilometrage") or 0):
            v["kilometrage"], change = km, True
        if dommages and v.get("etat_general") != "a_revoir":
            v["etat_general"], change = "a_revoir", True
        if change:
            ecrire_json(INFOS / "voitures.json", liste)
            if dommages:
                journaliser(par, "dommage signalé", f'{v["marque"]} {v["modele"]}')


def supprimer_voiture(identifiant, par):
    with VERROU:
        liste = voitures()
        v = next((x for x in liste if x["id"] == identifiant), None)
        if not v:
            raise ErreurClient("Véhicule introuvable.", 404)
        aujourdhui = datetime.date.today().isoformat()
        if any(r["voiture_id"] == identifiant and r.get("statut") not in ("annulée", "terminée") and r["date_fin"] >= aujourdhui for r in lire_json(RESERVATIONS, [])):
            raise ErreurClient("Ce véhicule a des réservations à venir. Mettez-le « hors ligne » plutôt que de le supprimer.", 409)
        ecrire_json(INFOS / "voitures.json", [x for x in liste if x["id"] != identifiant])
        photo = v.get("photo")
        if photo and "/" not in photo and (PHOTOS / photo).is_file():
            (PHOTOS / photo).unlink()
    journaliser(par, "véhicule supprimé", f'{v["marque"]} {v["modele"]}')


def enregistrer_photo(identifiant, corps, par):
    try:
        contenu = base64.b64decode(corps.get("contenu") or "", validate=True)
    except ValueError:
        raise ErreurClient("Photo illisible.")
    if not contenu or len(contenu) > 6 * 1024 * 1024:
        raise ErreurClient("La photo doit faire moins de 6 Mo.")
    if contenu[:3] == b"\xff\xd8\xff":
        extension = ".jpg"
    elif contenu[:8] == b"\x89PNG\r\n\x1a\n":
        extension = ".png"
    elif contenu[:4] == b"RIFF" and contenu[8:12] == b"WEBP":
        extension = ".webp"
    else:
        raise ErreurClient("Format non accepté : utilisez une photo JPG, PNG ou WebP.")
    with VERROU:
        liste = voitures()
        v = next((x for x in liste if x["id"] == identifiant), None)
        if not v:
            raise ErreurClient("Véhicule introuvable.", 404)
        PHOTOS.mkdir(parents=True, exist_ok=True)
        nom = f"{identifiant}{extension}"
        (PHOTOS / nom).write_bytes(contenu)
        ancienne = v.get("photo")
        if ancienne and ancienne != nom and (PHOTOS / ancienne).is_file() and "/" not in ancienne:
            (PHOTOS / ancienne).unlink()
        v["photo"] = nom
        v["photo_v"] = secrets.token_hex(3)  # le navigateur recharge la nouvelle image
        v.pop("credit", None)
        ecrire_json(INFOS / "voitures.json", liste)
    journaliser(par, "photo modifiée", f'{v["marque"]} {v["modele"]}')
    return v


# ───────────────────────── Paramètres de l'agence ─────────────────────────
def https_ou_vide(valeur, nom):
    valeur = str(valeur or "").strip()[:300]
    if valeur and not valeur.startswith("https://"):
        raise ErreurClient(f"{nom} : l'adresse doit commencer par https://")
    return valeur


def liste_textes(valeur, nom, minimum=0, maximum=12, longueur=120):
    if not isinstance(valeur, list):
        raise ErreurClient(f"{nom} : liste invalide.")
    elements = [str(x).strip()[:longueur] for x in valeur if str(x).strip()]
    if not minimum <= len(elements) <= maximum:
        raise ErreurClient(f"{nom} : entre {minimum} et {maximum} éléments.")
    return elements


def modifier_agence(corps, par):
    with VERROU:
        a = agence()
        for champ, longueur in (("nom", 60), ("slogan", 200), ("telephone", 30), ("email", 100), ("adresse", 200), ("paiement_sur_place", 120), ("texte_confidentialite", 300)):
            if champ in corps:
                valeur = texte(corps, champ, longueur)
                if champ in ("nom", "telephone", "adresse") and not valeur:
                    raise ErreurClient(f"Le champ « {champ} » ne peut pas être vide.")
                a[champ] = valeur
        if "whatsapp" in corps:
            chiffres = re.sub(r"\D", "", str(corps["whatsapp"]))
            if chiffres and not 9 <= len(chiffres) <= 15:
                raise ErreurClient("WhatsApp : écrivez le numéro avec l'indicatif, ex. 213555123456.")
            a["whatsapp"] = chiffres
        if "horaires" in corps:
            a["horaires"] = liste_textes(corps["horaires"], "Horaires", 1, 8)
        if "lieux" in corps:
            a["lieux"] = liste_textes(corps["lieux"], "Lieux de remise", 1, 12)
        if "paiement_en_ligne_lien" in corps:
            a["paiement_en_ligne_lien"] = https_ou_vide(corps["paiement_en_ligne_lien"], "Lien de paiement")
        if "lien_avis_google" in corps:
            a["lien_avis_google"] = https_ou_vide(corps["lien_avis_google"], "Lien des avis Google")
        if "paiement_coordonnees" in corps and isinstance(corps["paiement_coordonnees"], dict):
            a["paiement_coordonnees"] = {str(k)[:40]: str(v).strip()[:120] for k, v in corps["paiement_coordonnees"].items()}
        if "paiement_modes" in corps:
            ids = liste_textes(corps["paiement_modes"], "Moyens de paiement", 1, 12, 40)
            catalogue = {m["id"]: m for m in CATALOGUE_PAIEMENT}
            if any(i not in catalogue for i in ids):
                raise ErreurClient("Moyen de paiement inconnu.")
            a["paiement_modes"] = [catalogue[i] for i in ids]
        if "reseaux" in corps and isinstance(corps["reseaux"], dict):
            a["reseaux"] = {k: https_ou_vide(v, k.capitalize()) for k, v in corps["reseaux"].items() if k in ("facebook", "instagram", "tiktok", "youtube") and str(v).strip()}
        if "remises" in corps:
            if not isinstance(corps["remises"], list) or len(corps["remises"]) > 8:
                raise ErreurClient("Remises : liste invalide.")
            a["remises"] = sorted(
                [{"jours_min": entier(r.get("jours_min"), "Jours", 2, 365), "pourcentage": entier(r.get("pourcentage"), "Remise", 1, 90)} for r in corps["remises"]],
                key=lambda r: r["jours_min"],
            )
        if "options" in corps:
            if not isinstance(corps["options"], list) or len(corps["options"]) > 14:
                raise ErreurClient("Options : liste invalide.")
            options, ids = [], set()
            for o in corps["options"]:
                nom = texte(o, "nom", 60)
                if not nom:
                    raise ErreurClient("Chaque option doit avoir un nom.")
                identifiant = o.get("id") if re.fullmatch(r"[a-z0-9-]{1,30}", str(o.get("id") or "")) else slug(nom)[:30]
                if identifiant in ids:
                    identifiant = f"{identifiant}-{len(ids) + 1}"
                ids.add(identifiant)
                options.append({"id": identifiant, "nom": nom, "description": texte(o, "description", 200),
                                "prix": entier(o.get("prix"), "Prix de l'option", 0, 1_000_000), "par": "jour" if o.get("par") == "jour" else "location"})
            a["options"] = options
        extra = dict(a.get("tarifs_supplementaires") or {})
        if "km_inclus_par_jour" in corps:
            extra["km_inclus_par_jour"] = entier(corps["km_inclus_par_jour"], "Kilomètres inclus", 50, 2000)
        if "prix_km_supplementaire" in corps:
            extra["prix_km_supplementaire"] = entier(corps["prix_km_supplementaire"], "Prix du km supplémentaire", 0, 1000)
        a["tarifs_supplementaires"] = extra
        if "age_minimum" in corps:
            a["age_minimum"] = entier(corps["age_minimum"], "Âge minimum", 18, 30)
        if "permis_annees_minimum" in corps:
            a["permis_annees_minimum"] = entier(corps["permis_annees_minimum"], "Ancienneté du permis", 0, 10)
        ecrire_json(INFOS / "agence.json", a)
    journaliser(par, "paramètres modifiés", ", ".join(sorted(corps)))
    return a


# ───────────────────────── Sinistres et amendes ─────────────────────────
INCIDENTS = DONNEES / "incidents.json"
INCIDENTS_PHOTOS = DONNEES / "incidents_photos"  # photos de constats, de dégâts, de PV : jamais publiques
TYPES_INCIDENT = {"amende": "Amende, PV", "accident": "Accident", "dommage": "Dommage, rayure", "panne": "Panne", "autre": "Autre"}
STATUTS_INCIDENT = ["ouvert", "en_cours", "regle", "classe"]
MAX_PHOTOS_INCIDENT = 16


def lister_incidents():
    return sorted(lire_json(INCIDENTS, []), key=lambda i: (i["date"], i["cree_le"]), reverse=True)


def locataire_a_la_date(voiture_id, jour):
    """La réservation qui avait ce véhicule ce jour-là (pour rattacher une amende ou un sinistre au bon client)."""
    for r in lire_json(RESERVATIONS, []):
        if r.get("statut") in ("confirmée", "en cours", "terminée") and r["voiture_id"] == voiture_id and r["date_debut"] <= jour <= r["date_fin"]:
            return r
    return None


def synchroniser_compta_incident(incident, par):
    """Le coût payé par l'agence et la refacturation encaissée entrent tout seuls dans la comptabilité (et dans la rentabilité du véhicule)."""
    nouveaux = []
    categorie = "amende" if incident["type"] == "amende" else "reparation"
    base = dict(source="sinistre", voiture_id=incident["voiture_id"], reservation=incident.get("reservation", ""))
    libelle = f'{TYPES_INCIDENT[incident["type"]]} · {incident["voiture"]}' + (f' · {incident["description"][:50]}' if incident.get("description") else "")
    if incident.get("cout_paye") and incident["montant"] > 0:
        nouveaux.append(nouveau_mouvement("sortie", categorie, incident["montant"], par, lien=f'{incident["id"]}:cout', libelle=libelle, **base))
    if incident.get("refacture_encaisse") and incident["refacture"] > 0:
        nouveaux.append(nouveau_mouvement("entree", "penalite", incident["refacture"], par, lien=f'{incident["id"]}:refact', libelle=f"Refacturation · {libelle}", **base))
    with VERROU:
        reste = [m for m in lire_json(COMPTA, []) if not (m.get("source") == "sinistre" and str(m.get("lien", "")).startswith(f'{incident["id"]}:'))]
        ecrire_json(COMPTA, [*reste, *nouveaux])


def creer_incident(corps, par):
    type_incident = choix(corps, "type", TYPES_INCIDENT, "", "Type")
    voiture = trouver_voiture(corps.get("voiture_id"))
    if not voiture:
        raise ErreurClient("Choisissez le véhicule concerné.")
    jour = date_ou_vide(corps.get("date"), "incident") or datetime.date.today().isoformat()
    if jour > datetime.date.today().isoformat():
        raise ErreurClient("La date de l'incident ne peut pas être dans le futur.")
    numero = texte(corps, "reservation", 10).upper()
    reservations = lire_json(RESERVATIONS, [])
    r = next((x for x in reservations if x["numero"] == numero and x.get("statut") != "blocage"), None) if numero else locataire_a_la_date(voiture["id"], jour)
    if numero and not r:
        raise ErreurClient("Cette réservation n'existe pas.")
    incident = {
        "id": secrets.token_hex(4), "type": type_incident, "date": jour, "voiture_id": voiture["id"], "voiture": f'{voiture["marque"]} {voiture["modele"]}',
        "reservation": r["numero"] if r else "", "client": f'{r["client"]["prenom"]} {r["client"]["nom"]}'.strip() if r else "", "telephone": r["client"]["telephone"] if r else "",
        "description": texte(corps, "description", 1000), "lieu": texte(corps, "lieu", 120), "reference": texte(corps, "reference", 60),
        "montant": entier(corps.get("montant") or 0, "Coût pour l'agence", 0, 10**9), "refacture": entier(corps.get("refacture") or 0, "Montant refacturé au client", 0, 10**9),
        "cout_paye": False, "refacture_encaisse": False, "statut": "ouvert", "photos": [], "cree_le": maintenant(), "par": par,
        "historique": [{"le": maintenant(), "par": par, "action": "Incident enregistré"}],
    }
    with VERROU:
        liste = lire_json(INCIDENTS, [])
        liste.append(incident)
        ecrire_json(INCIDENTS, liste)
    if corps.get("immobiliser"):
        modifier_voiture_operationnel(voiture["id"], {"etat": "reparation", "etat_general": "a_revoir"}, par)
    journaliser(par, "incident enregistré", f'{TYPES_INCIDENT[type_incident]} · {incident["voiture"]}' + (f' · {incident["client"]}' if incident["client"] else ""))
    return incident


def modifier_incident(identifiant, corps, par):
    with VERROU:
        liste = lire_json(INCIDENTS, [])
        i = next((x for x in liste if x["id"] == identifiant), None)
        if not i:
            raise ErreurClient("Incident introuvable.", 404)
        faits = []
        if "statut" in corps and corps["statut"] != i["statut"]:
            if corps["statut"] not in STATUTS_INCIDENT:
                raise ErreurClient("Statut inconnu.")
            faits.append(f'statut : {i["statut"]} → {corps["statut"]}')
            i["statut"] = corps["statut"]
        for champ, longueur in (("description", 1000), ("lieu", 120), ("reference", 60)):
            if champ in corps and texte(corps, champ, longueur) != i.get(champ, ""):
                i[champ] = texte(corps, champ, longueur)
                faits.append(f"{champ} modifié")
        for champ, nom in (("montant", "Coût pour l'agence"), ("refacture", "Montant refacturé")):
            if champ in corps and entier(corps[champ] or 0, nom, 0, 10**9) != i[champ]:
                faits.append(f"{champ} : {i[champ]} → {int(corps[champ] or 0)} DA")
                i[champ] = int(corps[champ] or 0)
        for champ, texte_on, texte_off in (("cout_paye", "coût payé par l'agence", "coût marqué non payé"), ("refacture_encaisse", "refacturation encaissée", "refacturation marquée non encaissée")):
            if champ in corps and bool(corps[champ]) != i.get(champ, False):
                i[champ] = bool(corps[champ])
                faits.append(texte_on if i[champ] else texte_off)
        if faits:
            i["historique"].extend({"le": maintenant(), "par": par, "action": f} for f in faits)
            ecrire_json(INCIDENTS, liste)
    if faits:
        synchroniser_compta_incident(i, par)
        journaliser(par, "incident modifié", f'{i["voiture"]} · ' + " ; ".join(faits))
    return i


def supprimer_incident(identifiant, par):
    with VERROU:
        liste = lire_json(INCIDENTS, [])
        i = next((x for x in liste if x["id"] == identifiant), None)
        if not i:
            raise ErreurClient("Incident introuvable.", 404)
        ecrire_json(INCIDENTS, [x for x in liste if x["id"] != identifiant])
        ecrire_json(COMPTA, [m for m in lire_json(COMPTA, []) if not (m.get("source") == "sinistre" and str(m.get("lien", "")).startswith(f"{identifiant}:"))])
        if (INCIDENTS_PHOTOS / identifiant).is_dir():
            shutil.rmtree(INCIDENTS_PHOTOS / identifiant)
    journaliser(par, "incident supprimé", f'{i["voiture"]} · {TYPES_INCIDENT.get(i["type"], i["type"])}')


def ajouter_photo_incident(identifiant, corps, par):
    try:
        contenu = base64.b64decode(corps.get("contenu") or "", validate=True)
    except ValueError:
        raise ErreurClient("Photo illisible.")
    if not contenu or len(contenu) > 6 * 1024 * 1024:
        raise ErreurClient("La photo doit faire moins de 6 Mo.")
    extension = extension_image(contenu)
    if not extension:
        raise ErreurClient("Format non accepté : utilisez une photo JPG, PNG ou WebP.")
    with VERROU:
        liste = lire_json(INCIDENTS, [])
        i = next((x for x in liste if x["id"] == identifiant), None)
        if not i:
            raise ErreurClient("Incident introuvable.", 404)
        if len(i["photos"]) >= MAX_PHOTOS_INCIDENT:
            raise ErreurClient(f"Maximum {MAX_PHOTOS_INCIDENT} photos par incident.")
        nom = f"{secrets.token_hex(4)}{extension}"
        (INCIDENTS_PHOTOS / identifiant).mkdir(parents=True, exist_ok=True)
        (INCIDENTS_PHOTOS / identifiant / nom).write_bytes(contenu)
        i["photos"].append({"fichier": nom, "legende": texte(corps, "legende", 120), "le": maintenant(), "par": par})
        i["historique"].append({"le": maintenant(), "par": par, "action": "Photo ajoutée"})
        ecrire_json(INCIDENTS, liste)
    return i


def lire_photo_incident(identifiant, fichier):
    if not re.fullmatch(r"[0-9a-f]{8}", identifiant or "") or not NOM_PHOTO.match(fichier or ""):
        raise ErreurClient("Photo introuvable.", 404)
    i = next((x for x in lire_json(INCIDENTS, []) if x["id"] == identifiant), None)
    if not i or not any(p["fichier"] == fichier for p in i["photos"]) or not (INCIDENTS_PHOTOS / identifiant / fichier).is_file():
        raise ErreurClient("Photo introuvable.", 404)
    chemin = INCIDENTS_PHOTOS / identifiant / fichier
    return chemin.read_bytes(), MIME_IMAGES[chemin.suffix], fichier


def supprimer_photo_incident(identifiant, fichier, par):
    with VERROU:
        lire_photo_incident(identifiant, fichier)
        liste = lire_json(INCIDENTS, [])
        i = next(x for x in liste if x["id"] == identifiant)
        i["photos"] = [p for p in i["photos"] if p["fichier"] != fichier]
        (INCIDENTS_PHOTOS / identifiant / fichier).unlink(missing_ok=True)
        i["historique"].append({"le": maintenant(), "par": par, "action": "Photo supprimée"})
        ecrire_json(INCIDENTS, liste)
    return i


# ───────────────────────── Comptes des employés ─────────────────────────
def hacher(mot_de_passe, sel=None):
    sel = sel or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode(), bytes.fromhex(sel), 400_000)
    return sel, h.hex()


def verifier_mot_de_passe(mot_de_passe, sel, attendu):
    return hmac.compare_digest(hacher(mot_de_passe, sel)[1], attendu)


def lister_comptes():
    return lire_json(COMPTES, [])


def compte_public(c):
    return {k: c[k] for k in ("id", "nom", "identifiant", "role", "actif", "cree_le", "derniere_connexion") if k in c} | {"doit_changer": c.get("doit_changer", False)}


def valider_mot_de_passe(mot_de_passe):
    if len(mot_de_passe or "") < 8:
        raise ErreurClient("Le mot de passe doit faire au moins 8 caractères.")
    if mot_de_passe.lower() in ("12345678", "password", "motdepasse", "azertyui", "chm12345"):
        raise ErreurClient("Ce mot de passe est trop simple.")


def creer_compte(corps, par, mot_de_passe=None, doit_changer=True):
    nom, identifiant = texte(corps, "nom", 60), texte(corps, "identifiant", 30).lower()
    if not nom or not re.fullmatch(r"[a-z0-9._-]{3,30}", identifiant):
        raise ErreurClient("Indiquez un nom et un identifiant (3 à 30 lettres minuscules, chiffres, . _ -).")
    role = corps.get("role") if corps.get("role") in ("admin", "employe") else "employe"
    mot_de_passe = mot_de_passe or corps.get("mot_de_passe") or secrets.token_urlsafe(9)
    valider_mot_de_passe(mot_de_passe)
    with VERROU:
        comptes = lister_comptes()
        if any(c["identifiant"] == identifiant for c in comptes):
            raise ErreurClient("Cet identifiant existe déjà.", 409)
        sel, h = hacher(mot_de_passe)
        compte = {"id": secrets.token_hex(4), "nom": nom, "identifiant": identifiant, "role": role, "actif": True,
                  "sel": sel, "hash": h, "doit_changer": doit_changer, "cree_le": maintenant()}
        comptes.append(compte)
        ecrire_json(COMPTES, comptes)
    journaliser(par, "compte créé", f"{identifiant} ({role})")
    return compte, mot_de_passe


def modifier_compte(identifiant_compte, corps, par):
    with VERROU:
        comptes = lister_comptes()
        c = next((x for x in comptes if x["id"] == identifiant_compte), None)
        if not c:
            raise ErreurClient("Compte introuvable.", 404)
        nouveau_mdp = None
        if "actif" in corps:
            c["actif"] = bool(corps["actif"])
        if "role" in corps and corps["role"] in ("admin", "employe"):
            c["role"] = corps["role"]
        if "nom" in corps and texte(corps, "nom", 60):
            c["nom"] = texte(corps, "nom", 60)
        if corps.get("reinitialiser"):
            nouveau_mdp = secrets.token_urlsafe(9)
            c["sel"], c["hash"] = hacher(nouveau_mdp)
            c["doit_changer"] = True
        if not any(x["actif"] and x["role"] == "admin" for x in comptes):
            raise ErreurClient("Il doit rester au moins un administrateur actif.")
        ecrire_json(COMPTES, comptes)
    journaliser(par, "compte modifié", c["identifiant"] + (" · mot de passe réinitialisé" if nouveau_mdp else ""))
    return c, nouveau_mdp


def amorcer_comptes():
    """Premier lancement : crée l'administrateur et affiche son mot de passe (une seule fois)."""
    if lister_comptes():
        return
    compte, mot_de_passe = creer_compte({"nom": "Administrateur", "identifiant": "admin", "role": "admin"}, "système")
    DONNEES.mkdir(parents=True, exist_ok=True)
    note = DONNEES / "PREMIER_MOT_DE_PASSE.txt"
    note.write_text(f"Identifiant : admin\nMot de passe : {mot_de_passe}\n\nVous devrez le changer à la première connexion. Supprimez ce fichier ensuite.\n", encoding="utf-8")
    note.chmod(0o600)
    print("\n" + "═" * 62)
    print("  🔐 PLATEFORME EMPLOYEURS — compte administrateur créé")
    print(f"     Adresse      : /employe/")
    print(f"     Identifiant  : admin")
    print(f"     Mot de passe : {mot_de_passe}")
    print("     (aussi dans donnees/PREMIER_MOT_DE_PASSE.txt — à changer à la 1re connexion)")
    print("═" * 62 + "\n")
