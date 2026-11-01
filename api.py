"""
CHM Automotive Location — plateforme employeurs : connexion sécurisée et API (/api/employe/…).

  • Mots de passe hachés (PBKDF2, 400 000 tours), jamais stockés en clair
  • Cookie de session HttpOnly + SameSite=Strict, jeton CSRF sur chaque modification
  • Blocage après 5 échecs de connexion, journal de toutes les actions
  • Deux rôles : « employe » (réservations, dossiers, planning) et « admin » (tout, y compris flotte, paramètres, équipe)
"""
import hmac
import io
import json
import os
import re
import secrets
import time
import zipfile
from urllib.parse import urlparse

import commun as c

DUREE_SESSION = 8 * 3600
MAX_ECHECS = 5
BLOCAGE = 300  # secondes
TAILLE_MAX_REQUETE = 12 * 1024 * 1024

sessions = {}   # jeton → {"compte": id, "csrf": str, "expire": float}
echecs = {}     # clé (ip ou identifiant) → [nombre, bloqué_jusqu_à]


class Fichier:
    def __init__(self, contenu, mime, nom, telechargement=False):
        self.contenu, self.mime, self.nom, self.telechargement = contenu, mime, nom, telechargement


# ───────────────────────── Sessions ─────────────────────────
def adresse_ip(h):
    ip = h.client_address[0]
    # on ne fait confiance à l'en-tête du proxy (Caddy, Cloudflare) que s'il vient de cette machine
    if ip in ("127.0.0.1", "::1"):
        return (h.headers.get("CF-Connecting-IP") or (h.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or ip)
    return ip


def verifier_blocage(*cles):
    for cle in cles:
        n, jusqua = echecs.get(cle, (0, 0))
        if jusqua > time.time():
            raise c.ErreurClient(f"Trop d'essais. Réessayez dans {int((jusqua - time.time()) // 60) + 1} minute(s).", 429)


def noter_echec(*cles):
    for cle in cles:
        n, jusqua = echecs.get(cle, (0, 0))
        n = 0 if jusqua and jusqua < time.time() else n
        n += 1
        echecs[cle] = [n, time.time() + BLOCAGE if n >= MAX_ECHECS else 0]


def cookie_session(h):
    for morceau in (h.headers.get("Cookie") or "").split(";"):
        nom, _, valeur = morceau.strip().partition("=")
        if nom == "chm_session":
            return valeur
    return None


SANS_CODE = os.environ.get("CHM_SANS_CODE") == "1"  # essai local uniquement : jamais sur un vrai serveur
SESSION_ESSAI = {"compte": None, "csrf": secrets.token_urlsafe(24), "expire": float("inf")}


def session_courante(h):
    if SANS_CODE and h.client_address[0] in ("127.0.0.1", "::1") and not h.headers.get("X-Forwarded-For"):
        admin = next((x for x in c.lister_comptes() if x["role"] == "admin" and x["actif"]), None)
        if admin:
            return SESSION_ESSAI, {**admin, "doit_changer": False}
    jeton = cookie_session(h)
    s = sessions.get(jeton or "")
    if not s or s["expire"] < time.time():
        sessions.pop(jeton or "", None)
        return None, None
    compte = next((x for x in c.lister_comptes() if x["id"] == s["compte"] and x["actif"]), None)
    if not compte:
        sessions.pop(jeton, None)
        return None, None
    s["expire"] = time.time() + DUREE_SESSION
    return s, compte


def en_tete_cookie(h, jeton, duree):
    secure = "; Secure" if (h.headers.get("X-Forwarded-Proto") == "https") else ""
    return f"chm_session={jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age={duree}{secure}"


# ───────────────────────── Routes ─────────────────────────
def connexion(ctx, corps):
    h = ctx["h"]
    identifiant = c.texte(corps, "identifiant", 30).lower()
    ip = adresse_ip(h)
    verifier_blocage("ip:" + ip, "id:" + identifiant)
    compte = next((x for x in c.lister_comptes() if x["identifiant"] == identifiant), None)
    # on calcule toujours un hachage : le temps de réponse ne révèle pas si l'identifiant existe
    sel, attendu = (compte["sel"], compte["hash"]) if compte else ("00" * 16, "00" * 32)
    bon = c.verifier_mot_de_passe(str(corps.get("mot_de_passe") or ""), sel, attendu)
    if not (compte and bon and compte["actif"]):
        noter_echec("ip:" + ip, "id:" + identifiant)
        c.journaliser(identifiant or "?", "connexion refusée", ip)
        raise c.ErreurClient("Identifiant ou mot de passe incorrect.", 401)
    echecs.pop("ip:" + ip, None)
    echecs.pop("id:" + identifiant, None)
    jeton = secrets.token_urlsafe(32)
    sessions[jeton] = {"compte": compte["id"], "csrf": secrets.token_urlsafe(24), "expire": time.time() + DUREE_SESSION}
    with c.VERROU:
        comptes = c.lister_comptes()
        for x in comptes:
            if x["id"] == compte["id"]:
                x["derniere_connexion"] = c.maintenant()
        c.ecrire_json(c.COMPTES, comptes)
    c.journaliser(compte["nom"], "connexion", ip)
    return 200, {"utilisateur": c.compte_public(compte), "csrf": sessions[jeton]["csrf"]}, {"Set-Cookie": en_tete_cookie(h, jeton, DUREE_SESSION)}


def deconnexion(ctx, corps):
    sessions.pop(cookie_session(ctx["h"]) or "", None)
    return 200, {"ok": True}, {"Set-Cookie": en_tete_cookie(ctx["h"], "", 0)}


def moi(ctx, corps):
    return 200, {"utilisateur": c.compte_public(ctx["compte"]), "csrf": ctx["session"]["csrf"]}


def changer_mot_de_passe(ctx, corps):
    compte = ctx["compte"]
    if not c.verifier_mot_de_passe(str(corps.get("actuel") or ""), compte["sel"], compte["hash"]):
        raise c.ErreurClient("Le mot de passe actuel est incorrect.", 403)
    nouveau = str(corps.get("nouveau") or "")
    c.valider_mot_de_passe(nouveau)
    if nouveau == corps.get("actuel"):
        raise c.ErreurClient("Choisissez un mot de passe différent de l'ancien.")
    with c.VERROU:
        comptes = c.lister_comptes()
        for x in comptes:
            if x["id"] == compte["id"]:
                x["sel"], x["hash"] = c.hacher(nouveau)
                x["doit_changer"] = False
        c.ecrire_json(c.COMPTES, comptes)
    note = c.DONNEES / "PREMIER_MOT_DE_PASSE.txt"
    if note.exists() and compte["identifiant"] == "admin":
        note.unlink()
    c.journaliser(compte["nom"], "mot de passe changé")
    return 200, {"ok": True}


# Réservations
def liste_reservations(ctx, corps):
    return 200, c.lire_json(c.RESERVATIONS, [])


def nouvelle_reservation(ctx, corps):
    return 201, c.creer_reservation(corps, par=ctx["compte"]["nom"])


def maj_reservation(ctx, corps, numero):
    return 200, c.modifier_reservation(numero, corps, ctx["compte"]["nom"])


def suppr_reservation(ctx, corps, numero):
    if not numero.startswith("BLK-") and ctx["compte"]["role"] != "admin":
        raise c.ErreurClient("Seul un administrateur peut supprimer une réservation. Annulez-la plutôt.", 403)
    c.supprimer_reservation(numero, ctx["compte"]["nom"])
    return 200, {"ok": True}


def nouvelle_photo_etat(ctx, corps, numero, moment):
    return 201, c.ajouter_photo_etat(numero, moment, corps, ctx["compte"]["nom"])


def une_photo_etat(ctx, corps, numero, moment, fichier):
    contenu, mime, nom = c.lire_photo_etat(numero, moment, fichier)
    return 200, Fichier(contenu, mime, nom)


def suppr_photo_etat(ctx, corps, numero, moment, fichier):
    return 200, c.supprimer_photo_etat(numero, moment, fichier, ctx["compte"]["nom"])


def liste_incidents(ctx, corps):
    return 200, {"incidents": c.lister_incidents(), "types": c.TYPES_INCIDENT}


def nouvel_incident(ctx, corps):
    return 201, c.creer_incident(corps, ctx["compte"]["nom"])


def maj_incident(ctx, corps, identifiant):
    return 200, c.modifier_incident(identifiant, corps, ctx["compte"]["nom"])


def suppr_incident(ctx, corps, identifiant):
    c.supprimer_incident(identifiant, ctx["compte"]["nom"])
    return 200, {"ok": True}


def nouvelle_photo_incident(ctx, corps, identifiant):
    return 201, c.ajouter_photo_incident(identifiant, corps, ctx["compte"]["nom"])


def une_photo_incident(ctx, corps, identifiant, fichier):
    contenu, mime, nom = c.lire_photo_incident(identifiant, fichier)
    return 200, Fichier(contenu, mime, nom)


def suppr_photo_incident(ctx, corps, identifiant, fichier):
    return 200, c.supprimer_photo_incident(identifiant, fichier, ctx["compte"]["nom"])


def nouveau_blocage(ctx, corps):
    return 201, c.creer_blocage(corps, ctx["compte"]["nom"])


# Dossiers
def liste_dossiers(ctx, corps):
    return 200, c.lister_dossiers()


def un_fichier(ctx, corps, numero, nom):
    contenu, mime, nom_fichier = c.fichier_dossier(numero, nom)
    return 200, Fichier(contenu, mime, nom_fichier)


def maj_dossier(ctx, corps, numero):
    return 200, c.modifier_dossier(numero, corps, ctx["compte"]["nom"])


def suppr_dossier(ctx, corps, numero):
    c.supprimer_dossier(numero, ctx["compte"]["nom"])
    return 200, {"ok": True}


# Flotte
def liste_voitures(ctx, corps):
    voitures = c.voitures()
    if ctx["compte"]["role"] != "admin":  # les chiffres d'achat ne regardent pas tout le monde
        voitures = [{k: x for k, x in v.items() if k not in ("prix_achat", "date_achat")} for v in voitures]
    return 200, voitures


def nouvelle_voiture(ctx, corps):
    return 201, c.creer_voiture(corps, ctx["compte"]["nom"])


def maj_voiture(ctx, corps, identifiant):
    return 200, c.modifier_voiture(identifiant, corps, ctx["compte"]["nom"])


def maj_voiture_operationnel(ctx, corps, identifiant):
    return 200, c.modifier_voiture_operationnel(identifiant, corps, ctx["compte"]["nom"])


def nouvel_entretien(ctx, corps, identifiant):
    return 201, c.ajouter_entretien(identifiant, corps, ctx["compte"]["nom"])


def suppr_entretien(ctx, corps, identifiant, entretien_id):
    return 200, c.supprimer_entretien(identifiant, entretien_id, ctx["compte"]["nom"])


def suppr_voiture(ctx, corps, identifiant):
    c.supprimer_voiture(identifiant, ctx["compte"]["nom"])
    return 200, {"ok": True}


def photo_voiture(ctx, corps, identifiant):
    return 200, c.enregistrer_photo(identifiant, corps, ctx["compte"]["nom"])


# Paramètres, équipe, journal, sauvegarde
# Comptabilité
def lire_compta(ctx, corps):
    return 200, {"mouvements": c.liste_mouvements(),
                 "categories": {"entree": c.CATEGORIES_ENTREE, "sortie": c.CATEGORIES_SORTIE}}


def nouveau_mouvement(ctx, corps):
    return 201, c.ajouter_mouvement(corps, ctx["compte"]["nom"])


def suppr_mouvement(ctx, corps, identifiant):
    c.supprimer_mouvement(identifiant, ctx["compte"]["nom"])
    return 200, {"ok": True}


def liste_depenses(ctx, corps):
    return 200, c.depenses_vehicules()


def nouvelle_depense(ctx, corps, identifiant):
    return 201, c.ajouter_depense_vehicule(identifiant, corps, ctx["compte"]["nom"])


def lire_agence(ctx, corps):
    return 200, {"agence": c.agence(), "catalogue_paiement": c.CATALOGUE_PAIEMENT}


def maj_agence(ctx, corps):
    return 200, {"agence": c.modifier_agence(corps, ctx["compte"]["nom"]), "catalogue_paiement": c.CATALOGUE_PAIEMENT}


def liste_comptes(ctx, corps):
    return 200, [c.compte_public(x) for x in c.lister_comptes()]


def nouveau_compte(ctx, corps):
    compte, mot_de_passe = c.creer_compte(corps, ctx["compte"]["nom"], mot_de_passe=None)
    return 201, {"compte": c.compte_public(compte), "mot_de_passe": mot_de_passe}


def maj_compte(ctx, corps, identifiant):
    if identifiant == ctx["compte"]["id"] and (corps.get("actif") is False or corps.get("role") == "employe"):
        raise c.ErreurClient("Vous ne pouvez pas vous retirer vos propres droits.")
    compte, mot_de_passe = c.modifier_compte(identifiant, corps, ctx["compte"]["nom"])
    for jeton in [j for j, s in sessions.items() if s["compte"] == identifiant and (not compte["actif"] or mot_de_passe)]:
        sessions.pop(jeton, None)
    return 200, {"compte": c.compte_public(compte), "mot_de_passe": mot_de_passe}


def lire_journal(ctx, corps):
    return 200, list(reversed(c.lire_json(c.JOURNAL, [])))[:400]


def sauvegarde(ctx, corps):
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as z:
        for dossier in (c.DONNEES, c.INFOS):
            for chemin in dossier.rglob("*"):
                if chemin.is_file() and chemin.name not in ("PREMIER_MOT_DE_PASSE.txt",) and chemin.suffix != ".tmp":
                    z.write(chemin, f"{dossier.name}/{chemin.relative_to(dossier)}")
    c.journaliser(ctx["compte"]["nom"], "sauvegarde téléchargée")
    nom = f"sauvegarde-chm-{time.strftime('%Y-%m-%d-%Hh%M')}.zip"
    return 200, Fichier(tampon.getvalue(), "application/zip", nom, telechargement=True)


# (méthode, motif, fonction, rôle minimum, public ?)
ROUTES = [
    ("POST", r"/connexion", connexion, None),
    ("POST", r"/deconnexion", deconnexion, None),
    ("GET", r"/moi", moi, "employe"),
    ("POST", r"/mot-de-passe", changer_mot_de_passe, "employe"),
    ("GET", r"/reservations", liste_reservations, "employe"),
    ("POST", r"/reservations", nouvelle_reservation, "employe"),
    ("PATCH", r"/reservations/([A-Z]{3}-\d{4})", maj_reservation, "employe"),
    ("DELETE", r"/reservations/([A-Z]{3}-\d{4})", suppr_reservation, "employe"),
    ("POST", r"/reservations/([A-Z]{3}-\d{4})/photos/(depart|retour)", nouvelle_photo_etat, "employe"),
    ("GET", r"/reservations/([A-Z]{3}-\d{4})/photos/(depart|retour)/([0-9a-f]{8}\.(?:jpg|png|webp))", une_photo_etat, "employe"),
    ("DELETE", r"/reservations/([A-Z]{3}-\d{4})/photos/(depart|retour)/([0-9a-f]{8}\.(?:jpg|png|webp))", suppr_photo_etat, "admin"),
    ("GET", r"/incidents", liste_incidents, "employe"),
    ("POST", r"/incidents", nouvel_incident, "employe"),
    ("PATCH", r"/incidents/([0-9a-f]{8})", maj_incident, "employe"),
    ("DELETE", r"/incidents/([0-9a-f]{8})", suppr_incident, "admin"),
    ("POST", r"/incidents/([0-9a-f]{8})/photos", nouvelle_photo_incident, "employe"),
    ("GET", r"/incidents/([0-9a-f]{8})/photos/([0-9a-f]{8}\.(?:jpg|png|webp))", une_photo_incident, "employe"),
    ("DELETE", r"/incidents/([0-9a-f]{8})/photos/([0-9a-f]{8}\.(?:jpg|png|webp))", suppr_photo_incident, "admin"),
    ("POST", r"/blocages", nouveau_blocage, "employe"),
    ("GET", r"/dossiers", liste_dossiers, "employe"),
    ("GET", r"/dossiers/(D-\d{4})/fichiers/([\w.-]+)", un_fichier, "employe"),
    ("PATCH", r"/dossiers/(D-\d{4})", maj_dossier, "employe"),
    ("DELETE", r"/dossiers/(D-\d{4})", suppr_dossier, "admin"),
    ("GET", r"/voitures", liste_voitures, "employe"),
    ("POST", r"/voitures", nouvelle_voiture, "admin"),
    ("PUT", r"/voitures/([a-z0-9-]+)", maj_voiture, "admin"),
    ("PATCH", r"/voitures/([a-z0-9-]+)", maj_voiture_operationnel, "employe"),
    ("POST", r"/voitures/([a-z0-9-]+)/entretiens", nouvel_entretien, "employe"),
    ("DELETE", r"/voitures/([a-z0-9-]+)/entretiens/([0-9a-f]{6})", suppr_entretien, "admin"),
    ("DELETE", r"/voitures/([a-z0-9-]+)", suppr_voiture, "admin"),
    ("POST", r"/voitures/([a-z0-9-]+)/photo", photo_voiture, "admin"),
    ("GET", r"/depenses", liste_depenses, "employe"),
    ("POST", r"/voitures/([a-z0-9-]+)/depenses", nouvelle_depense, "employe"),
    ("GET", r"/comptabilite", lire_compta, "admin"),
    ("POST", r"/comptabilite", nouveau_mouvement, "admin"),
    ("DELETE", r"/comptabilite/([0-9a-f]{8})", suppr_mouvement, "admin"),
    ("GET", r"/agence", lire_agence, "admin"),
    ("PUT", r"/agence", maj_agence, "admin"),
    ("GET", r"/utilisateurs", liste_comptes, "admin"),
    ("POST", r"/utilisateurs", nouveau_compte, "admin"),
    ("PATCH", r"/utilisateurs/([0-9a-f]{8})", maj_compte, "admin"),
    ("GET", r"/journal", lire_journal, "admin"),
    ("GET", r"/sauvegarde", sauvegarde, "admin"),
]


def traiter(h, methode):
    """Appelé par le serveur pour tout /api/employe/…  Renvoie (code, données, en-têtes) ou (code, Fichier, {})."""
    chemin = urlparse(h.path).path[len("/api/employe"):]
    route = None
    for m, motif, fonction, role in ROUTES:
        trouve = re.fullmatch(motif, chemin)
        if m == methode and trouve:
            route = (fonction, role, trouve.groups())
            break
    if not route:
        return 404, {"erreur": "Adresse inconnue."}, {}
    fonction, role, args = route

    corps = {}
    if methode in ("POST", "PUT", "PATCH"):
        taille = int(h.headers.get("Content-Length") or 0)
        if taille > TAILLE_MAX_REQUETE:
            raise c.ErreurClient("Envoi trop lourd.", 413)
        try:
            corps = json.loads(h.rfile.read(taille) or b"{}")
        except ValueError:
            raise c.ErreurClient("Requête illisible.")
        if not isinstance(corps, dict):
            raise c.ErreurClient("Requête illisible.")

    ctx = {"h": h, "session": None, "compte": None}
    if role:
        session, compte = session_courante(h)
        if not session:
            raise c.ErreurClient("Session expirée : reconnectez-vous.", 401)
        if methode != "GET" and not hmac.compare_digest(h.headers.get("X-CSRF-Token") or "", session["csrf"]):
            raise c.ErreurClient("Requête refusée (jeton de sécurité invalide). Rechargez la page.", 403)
        if role == "admin" and compte["role"] != "admin":
            raise c.ErreurClient("Cette action est réservée à l'administrateur.", 403)
        if compte.get("doit_changer") and chemin not in ("/moi", "/mot-de-passe", "/deconnexion"):
            raise c.ErreurClient("Choisissez d'abord un nouveau mot de passe.", 403, changer_mot_de_passe=True)
        ctx.update(session=session, compte=compte)

    resultat = fonction(ctx, corps, *args)
    return (*resultat, {}) if len(resultat) == 2 else resultat
