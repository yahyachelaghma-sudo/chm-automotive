#!/usr/bin/env python3
"""
CHM Automotive Location — serveur.

Lancer :   python3 serveur.py
  Site client            http://localhost:8000
  Plateforme employeurs  http://localhost:8000/employe/
Rien à installer : uniquement la bibliothèque standard de Python.

  informations/   l'agence (agence.json) et la flotte (voitures.json)
  donnees/        réservations, dossiers clients, comptes, journal (jamais accessible depuis le navigateur)
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from employe import api as admin
import commun as c

PORT = int(os.environ.get("PORT", 8000))
HOTE = os.environ.get("HOST", "")  # sur un serveur : HOST=127.0.0.1, c'est Caddy qui reçoit les visiteurs

# Seuls ces dossiers sont visibles depuis le navigateur
DOSSIERS_PUBLICS = ("/site/", "/employe/", "/images/", "/informations/")
TAILLE_MAX_REQUETE = 70 * 1024 * 1024


class Gestionnaire(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(c.RACINE), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith(("/api/", "/informations/", "/employe/")):
            self.send_header("Cache-Control", "no-store")
        elif self.path.startswith(("/site/", "/images/")):
            self.send_header("Cache-Control", "no-cache")  # le navigateur vérifie à chaque fois : un nouveau logo s'affiche tout de suite
        super().end_headers()

    def repondre(self, code, valeur, entetes=None):
        if isinstance(valeur, admin.Fichier):
            corps, mime = valeur.contenu, valeur.mime
            disposition = f'{"attachment" if valeur.telechargement else "inline"}; filename="{valeur.nom}"'
        else:
            corps, mime, disposition = json.dumps(valeur, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", None
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(corps)))
        if disposition:
            self.send_header("Content-Disposition", disposition)
        for nom, valeur_entete in (entetes or {}).items():
            self.send_header(nom, valeur_entete)
        self.end_headers()
        self.wfile.write(corps)

    def chemin_public(self):
        chemin = urlparse(self.path).path
        if chemin in ("/", "/index.html", "/site"):
            self.send_response(302)
            self.send_header("Location", "/site/")
            self.end_headers()
            return False
        if chemin in ("/employe", "/employeurs", "/admin"):
            self.send_response(302)
            self.send_header("Location", "/employe/")
            self.end_headers()
            return False
        if ".." in chemin or not chemin.startswith(DOSSIERS_PUBLICS) or chemin.endswith((".py", ".pyc")) or "__pycache__" in chemin:
            self.send_error(404, "Page introuvable")
            return False
        return True

    def gerer(self, action):
        try:
            self.repondre(*action())
        except c.ErreurClient as e:
            self.repondre(e.code, {"erreur": str(e), **e.extra})
        except Exception as e:  # on ne montre jamais les détails techniques
            print("  ⚠️ Erreur :", repr(e))
            self.repondre(500, {"erreur": "Une erreur est survenue. Réessayez ou contactez l'administrateur."})

    def lire_corps(self):
        taille = int(self.headers.get("Content-Length") or 0)
        if taille > TAILLE_MAX_REQUETE:
            raise c.ErreurClient("L'envoi est trop lourd : réduisez la taille des photos.", 413)
        try:
            corps = json.loads(self.rfile.read(taille) or b"{}")
        except ValueError:
            raise c.ErreurClient("Requête illisible.")
        if not isinstance(corps, dict):
            raise c.ErreurClient("Requête illisible.")
        return corps

    def do_HEAD(self):
        if self.chemin_public():
            super().do_HEAD()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/employe/"):
            return self.gerer(lambda: admin.traiter(self, "GET"))
        if url.path == "/api/agence":
            return self.repondre(200, c.agence())
        if url.path == "/api/voitures":
            return self.repondre(200, [c.vue_publique_voiture(x) for x in c.voitures()])
        if url.path in ("/api/disponibilite", "/api/disponibilites"):
            q = parse_qs(url.query)
            try:
                debut = c.date_iso(q.get("debut", [""])[0], "départ")
                fin = c.date_iso(q.get("fin", [""])[0], "retour")
                if fin < debut or (fin - debut).days > 365:
                    raise c.ErreurClient("Les dates ne sont pas valides.")
            except c.ErreurClient as e:
                return self.repondre(400, {"erreur": str(e)})
            if url.path == "/api/disponibilites":
                return self.repondre(200, c.prochaines_dates_libres(debut, fin))
            return self.repondre(200, c.disponibilite(q.get("voiture", [""])[0][:80], debut, fin))
        if url.path == "/api/occupees":
            q = parse_qs(url.query)
            try:
                debut = c.date_iso(q.get("debut", [""])[0], "départ")
                fin = c.date_iso(q.get("fin", [""])[0], "retour")
            except c.ErreurClient as e:
                return self.repondre(400, {"erreur": str(e)})
            return self.repondre(200, c.voitures_occupees(debut, fin, c.lire_json(c.RESERVATIONS, [])))
        if self.chemin_public():
            super().do_GET()

    def do_POST(self):
        chemin = urlparse(self.path).path
        if chemin.startswith("/api/employe/"):
            return self.gerer(lambda: admin.traiter(self, "POST"))
        actions = {
            "/api/reservations": lambda: (201, c.vue_publique(c.creer_reservation(self.lire_corps())), {}),
            "/api/dossiers": lambda: (201, c.creer_dossier(self.lire_corps()), {}),
        }
        if chemin not in actions:
            return self.repondre(404, {"erreur": "Adresse inconnue."})
        self.gerer(actions[chemin])

    def autres_methodes(self, methode):
        if urlparse(self.path).path.startswith("/api/employe/"):
            return self.gerer(lambda: admin.traiter(self, methode))
        self.repondre(404, {"erreur": "Adresse inconnue."})

    def do_PUT(self):
        self.autres_methodes("PUT")

    def do_PATCH(self):
        self.autres_methodes("PATCH")

    def do_DELETE(self):
        self.autres_methodes("DELETE")

    def log_message(self, format, *args):
        if "/api/" in self.path and self.command != "GET":
            return  # les actions ont déjà leur propre ligne
        super().log_message(format, *args)


if __name__ == "__main__":
    c.amorcer_comptes()
    serveur = ThreadingHTTPServer((HOTE, PORT), Gestionnaire)
    print(f"🚗 CHM Automotive Location : http://localhost:{PORT}   ·   employeurs : http://localhost:{PORT}/employe/   (Ctrl+C pour arrêter)")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrêté.")
