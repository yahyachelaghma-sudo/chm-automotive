#!/usr/bin/env python3
"""
Données de DÉMONSTRATION pour la plateforme employeurs (noms, numéros et documents inventés).

    python3 employe/demo.py          crée le dossier  donnees_demo/
    CHM_DONNEES=donnees_demo PORT=8001 python3 serveur.py

Comptes :  admin / Demo-Admin-2026     samir / Demo-Employe-2026
"""
import datetime
import json
import os
import random
import shutil
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
os.environ["CHM_DONNEES"] = str(RACINE / "donnees_demo")
sys.path.insert(0, str(RACINE))
import commun as c  # noqa: E402

random.seed(2026)
# La démo travaille sur sa propre copie de la configuration : les vrais fichiers ne sont jamais modifiés
SOURCE_INFOS = RACINE / "informations"
auj = datetime.date.today()
jour = lambda n: (auj + datetime.timedelta(days=n)).isoformat()

if c.DONNEES.exists():
    shutil.rmtree(c.DONNEES)
c.DONNEES.mkdir(parents=True)
shutil.copytree(SOURCE_INFOS, c.DONNEES / "informations")
c.INFOS = c.DONNEES / "informations"

PRENOMS = ["Karim", "Amine", "Yacine", "Sofiane", "Mehdi", "Walid", "Riad", "Nassim", "Lyes", "Anis", "Sarah", "Imane", "Yasmine", "Lina", "Nadia", "Samira", "Rania", "Meriem", "Hakim", "Bilal", "Farid", "Omar"]
NOMS = ["Benali", "Haddad", "Messaoudi", "Boudiaf", "Cherif", "Hamidi", "Khelifi", "Mansouri", "Slimani", "Brahimi", "Bouzid", "Taleb", "Zerrouki", "Belkacem", "Meziane", "Aouadi", "Saidi", "Ferhat", "Lounis", "Amrani"]
agence = c.agence()
voitures = [v for v in c.voitures() if v.get("disponible")]
modes = [m["id"] for m in agence["paiement_modes"]]
lieux = agence["lieux"]
options_ids = [o["id"] for o in agence["options"]]
poids_voitures = [3 if v["prix_par_jour"] < 10000 else 2 if v["prix_par_jour"] < 20000 else 1 for v in voitures]


def telephone():
    return f"0{random.choice('567')}{random.randint(10, 99)} {random.randint(10, 99)} {random.randint(10, 99)} {random.randint(10, 99)}"


reservations, numero = [], 0


def ajouter(voiture, debut, duree, statut, source, cree_il_y_a):
    global numero
    numero += 1
    fin = debut + datetime.timedelta(days=duree)
    options = random.sample(options_ids, k=random.choice([0, 0, 1, 1, 2]))
    prix = c.devis(agence, voiture, c.jours_location(debut, fin), options)
    prenom, nom = random.choice(PRENOMS), random.choice(NOMS)
    mode = random.choice(modes)
    total = prix["total"]
    paye = {"terminée": total, "en cours": random.choice([total, total, total // 2]), "confirmée": random.choice([0, total // 3, total // 2, total]), "en attente": 0, "annulée": 0}[statut]
    cree = datetime.datetime.combine(auj - datetime.timedelta(days=cree_il_y_a), datetime.time(random.randint(8, 19), random.randint(0, 59)))
    reservations.append({
        "numero": f"CHM-{numero:04d}", "statut": statut, "source": source, "cree_le": cree.isoformat(timespec="seconds"),
        "voiture_id": voiture["id"], "voiture": f'{voiture["marque"]} {voiture["modele"]}',
        "date_debut": debut.isoformat(), "heure_depart": random.choice(["08:00", "09:00", "10:00", "14:00"]), "date_fin": fin.isoformat(), "heure_retour": random.choice(["10:00", "12:00", "18:00"]),
        "lieu_depart": random.choice(lieux[:3]), "lieu_retour": random.choice(lieux[:3]), "jours": c.jours_location(debut, fin), "options": options, "prix": prix, "total": total,
        "caution": voiture["caution"], "paye": paye, "caution_recue": statut == "en cours", "notes": random.choice(["", "", "", "Client fidèle", "Livraison à l'aéroport, vol AH 1234", "Demande siège bébé"]),
        "client": {"nom": nom, "prenom": prenom, "telephone": telephone(), "email": random.choice(["", f"{prenom.lower()}.{nom.lower()}@gmail.com"]), "message": ""},
        "paiement_souhaite": {"mode": mode, "lieu": random.choice(["agence", "livraison"])},
        "historique": [{"le": cree.isoformat(timespec="seconds"), "par": "client" if source == "site" else "Samir Haddad", "action": "Réservation créée"}],
    })


# Chaque véhicule : des locations qui se suivent, sans jamais se chevaucher
for v in voitures:
    curseur = -random.randint(95, 120)
    while curseur < 24:
        curseur += random.choice([0, 1, 2, 3, 5, 8]) if random.random() < 0.8 else random.randint(6, 16)
        duree = random.choice([2, 3, 3, 4, 5, 7, 7, 10, 14])
        debut, fin = curseur, curseur + duree
        if debut > 24:
            break
        d = auj + datetime.timedelta(days=debut)
        if fin < 0:
            statut = "annulée" if random.random() < 0.07 else "terminée"
        elif debut <= 0 < fin or (debut <= 0 and fin == 0):
            statut = "en cours"
        elif debut < 0:
            statut = "terminée"
        elif debut <= 1:
            statut = random.choice(["confirmée", "confirmée", "en attente"])
        else:
            statut = random.choice(["confirmée", "confirmée", "confirmée", "en attente"])
        ajouter(v, d, duree, statut, random.choice(["site", "site", "agence"]), max(1, abs(min(debut, 0)) + random.randint(1, 9)) if debut < 0 else random.randint(0, 6))
        curseur = fin
# on ne garde qu'un échantillon réaliste (toute la flotte n'est pas louée en permanence)
random.shuffle(reservations)
reservations = [r for r in reservations if random.random() < 0.62]
reservations.sort(key=lambda r: r["cree_le"])
for i, r in enumerate(reservations, 1):
    r["numero"] = f"CHM-{i:04d}"

# Quelques demandes toutes fraîches arrivées du site (à confirmer)
for r in [x for x in reservations if x["statut"] == "en attente"][:4]:
    r["source"] = "site"
    r["cree_le"] = (datetime.datetime.now() - datetime.timedelta(hours=random.randint(1, 20))).isoformat(timespec="seconds")

for j, (v, debut, duree, motif) in enumerate([(voitures[3], 3, 2, "Entretien / vidange"), (voitures[7], 1, 4, "Panne / réparation")], 1):
    blocage = {"numero": f"BLK-{j:04d}", "statut": "blocage", "cree_le": c.maintenant(), "voiture_id": v["id"], "voiture": f'{v["marque"]} {v["modele"]}',
               "date_debut": jour(debut), "date_fin": jour(debut + duree), "motif": motif, "client": {"nom": "", "prenom": "", "telephone": ""}, "total": 0, "paye": 0, "jours": duree}
    if not any(r["voiture_id"] == v["id"] and r["statut"] != "annulée" and r["date_debut"] < blocage["date_fin"] and blocage["date_debut"] < c.periode(r)[1].isoformat() for r in reservations):
        reservations.append(blocage)
# de quoi remplir « départs » et « retours » du tableau de bord
conf = [r for r in reservations if r["statut"] == "confirmée"]
for r, decalage in zip(conf[:3], (0, 0, 1)):
    ecart = (datetime.date.fromisoformat(r["date_debut"]) - (auj + datetime.timedelta(days=decalage))).days
    # on ne déplace que si le véhicule reste libre
    nouveau = (auj + datetime.timedelta(days=decalage), datetime.date.fromisoformat(r["date_fin"]) - datetime.timedelta(days=ecart))
    libre = not any(x["voiture_id"] == r["voiture_id"] and x is not r and x["statut"] != "annulée" and nouveau[0] < c.periode(x)[1] and c.periode(x)[0] < max(nouveau[1], nouveau[0] + datetime.timedelta(days=1)) for x in reservations)
    if libre:
        r["date_debut"], r["date_fin"] = nouveau[0].isoformat(), nouveau[1].isoformat()
        r["jours"] = c.jours_location(*nouveau)
        r["prix"] = c.devis(agence, c.trouver_voiture(r["voiture_id"]), r["jours"], r["options"]); r["total"] = r["prix"]["total"]
for r, decalage in zip([x for x in reservations if x["statut"] == "en cours"][:3], (0, 0, 1)):
    fin = auj + datetime.timedelta(days=decalage)
    if fin > datetime.date.fromisoformat(r["date_debut"]):
        r["date_fin"] = fin.isoformat(); r["jours"] = c.jours_location(datetime.date.fromisoformat(r["date_debut"]), fin)
        r["prix"] = c.devis(agence, c.trouver_voiture(r["voiture_id"]), r["jours"], r["options"]); r["total"] = r["prix"]["total"]; r["paye"] = min(r["paye"], r["total"])
c.ecrire_json(c.RESERVATIONS, reservations)

# Dossiers clients (les documents sont simplement le logo : ce sont des exemples)
logo = (RACINE / "images" / "logo.jpg").read_bytes()
actifs = [r for r in reservations if r["statut"] in ("en attente", "confirmée", "en cours")]
for i, r in enumerate(actifs[:14], 1):
    cl = r["client"]
    dossier = c.DOSSIERS / f"D-{i:04d}"
    dossier.mkdir(parents=True)
    types = ["permis_recto", "permis_verso", "identite_recto", "identite_verso"] if i % 6 else ["permis_recto", "identite_recto"]
    for t in types:
        (dossier / f"{t}.jpg").write_bytes(logo)
    jeune = i == 3
    c.ecrire_json(dossier / "dossier.json", {
        "numero": f"D-{i:04d}", "recu_le": (datetime.datetime.now() - datetime.timedelta(hours=i * 7)).isoformat(timespec="seconds"),
        "statut": "à vérifier" if i % 3 else "validé", "notes": "", "nom": cl["nom"], "prenom": cl["prenom"], "telephone": cl["telephone"], "email": cl["email"],
        "date_naissance": jour(-365 * (20 if jeune else random.randint(26, 52))), "nationalite": "Algérienne", "adresse": f"{random.randint(1, 120)} rue des Frères Bouadou", "ville": random.choice(["Alger", "Oran", "Constantine", "Blida", "Annaba"]),
        "identite_type": "CNI", "identite_numero": str(random.randint(10**8, 10**9 - 1)), "identite_expiration": jour(random.randint(200, 2500)),
        "permis_numero": str(random.randint(10**7, 10**8 - 1)), "permis_date": jour(-365 * (1 if jeune else random.randint(3, 20))), "permis_pays": "Algérie",
        "reservation_numero": r["numero"] if i % 2 else "", "documents": [{"type": t, "fichier": f"{t}.jpg", "nom_origine": f"{t}.jpg"} for t in types],
    })

# Véhicules : états, emplacements, alertes et états des lieux variés pour la démonstration
flotte = c.voitures()
par_id = {v["id"]: v for v in flotte}
def regler(identifiant, **champs):
    par_id[identifiant].update(champs)
regler("audi-q3-chine", etat="maintenance", emplacement="Garage / atelier", emplacement_detail="Atelier Benali", notes="Révision des 10 000 km, retour prévu sous 2 jours")
regler("livan-gx3-pro", etat="reparation", etat_general="a_revoir", emplacement="Garage / atelier", emplacement_detail="Carrosserie Amine", notes="Pare-chocs arrière à remplacer après un accrochage au retour")
regler("mg3", etat="nettoyage", emplacement="Parking de l'agence", emplacement_detail="Place 3")
regler("geely-coolray-beyond-pro", assurance_expiration=jour(9))                 # assurance bientôt expirée
regler("changan-x5-at-plus", assurance_expiration=jour(-4))                      # assurance expirée !
regler("audi-a3-chine", controle_technique_expiration=jour(18), vignette_expiration=jour(200), assurance_expiration=jour(240))
regler("volkswagen-passat-pro-chine", kilometrage=61400, entretien_prochain_km=60000, assurance_expiration=jour(120))   # entretien dépassé
regler("jetour-x70-luxury-plus", kilometrage=44300, entretien_prochain_km=45000, assurance_expiration=jour(300), controle_technique_expiration=jour(150), vignette_expiration=jour(90))  # entretien dans 700 km
regler("mg5", etat_general="excellent", emplacement="Aéroport d'Alger Houari-Boumediene", emplacement_detail="Parking P2", assurance_expiration=jour(180))
for v_ in par_id.values():
    if not v_.get("assurance_expiration"):
        v_["assurance_expiration"] = jour(random.randint(70, 330))
louees = {r["voiture_id"] for r in reservations if r["statut"] == "en cours"}
for identifiant in louees:
    if par_id[identifiant]["etat"] == "disponible":
        par_id[identifiant]["emplacement"], par_id[identifiant]["emplacement_detail"] = "Chez le client", ""
c.ecrire_json(c.INFOS / "voitures.json", flotte)

# états des lieux (kilométrage et carburant) sur les locations en cours et récemment terminées
for r in reservations:
    if r["statut"] not in ("en cours", "terminée") or r["statut"] == "terminée" and r["date_fin"] < jour(-45):
        continue
    km = max(1000, (par_id[r["voiture_id"]].get("kilometrage") or 20000) - random.randint(300, 2500))
    r["etat_depart"] = {"km": km, "carburant": "plein", "dommages": False, "note": "", "le": r["cree_le"], "par": "Samir Haddad"}
    if r["statut"] == "terminée":
        r["etat_retour"] = {"km": km + r["jours"] * random.randint(90, 330), "carburant": random.choice(["plein", "3/4", "1/2"]), "dommages": random.random() < 0.08, "note": "", "le": r["date_fin"] + "T11:00:00", "par": "Lila Bouzid"}
c.ecrire_json(c.RESERVATIONS, reservations)

# photos avant / après : photos d'exemple de la même voiture (employe/exemples_demo/), sinon la photo du catalogue
import secrets
EXEMPLES = RACINE / "employe" / "exemples_demo"
VUES_DEMO = ["avant", "arriere", "gauche", "droite", "interieur", "compteur"]
def jeu_exemples(identifiant):
    return (EXEMPLES / identifiant / "avant" / "avant.jpg").exists() and (EXEMPLES / identifiant / "apres" / "avant.jpg").exists()
candidates = sorted([r for r in reservations if r.get("etat_depart") and r["statut"] in ("en cours", "terminée")], key=lambda r: r["date_debut"], reverse=True)
avec_exemples = [r for r in candidates if jeu_exemples(r["voiture_id"])]
autres = [r for r in candidates if r not in avec_exemples]
avec_photos = avec_exemples[:14] if avec_exemples else candidates[:14]
# deux retours avec un dommage, pour montrer la comparaison
for r in [x for x in avec_exemples if x["statut"] == "terminée"][:2]:
    r["etat_retour"]["dommages"], r["etat_retour"]["note"] = True, "Rayure sur le pare-chocs arrière"
for r in avec_photos:
    voiture = par_id[r["voiture_id"]]
    catalogue = c.PHOTOS / (voiture.get("photo") or "")
    for moment, dossier_exemple in (("depart", "avant"), ("retour", "apres")):
        e = r.get(c.CLES_MOMENT[moment])
        if not e:
            continue
        dossier = c.ETATS_PHOTOS / r["numero"] / moment
        dossier.mkdir(parents=True, exist_ok=True)
        e["photos"] = []
        vues = VUES_DEMO + (["dommage"] if e.get("dommages") else [])
        for vue in vues:
            source = EXEMPLES / r["voiture_id"] / dossier_exemple / f"{vue}.jpg"
            if vue == "dommage":
                source = EXEMPLES / r["voiture_id"] / "dommage.jpg"
            if not source.is_file() and not jeu_exemples(r["voiture_id"]):
                source = catalogue  # véhicule sans photos d'exemple : on réutilise la photo du catalogue
            if not source.is_file():
                continue
            nom = f"{secrets.token_hex(4)}.jpg"
            shutil.copyfile(source, dossier / nom)
            e["photos"].append({"fichier": nom, "vue": vue, "legende": "", "le": e["le"], "par": e["par"]})
c.ecrire_json(c.RESERVATIONS, reservations)

# Contrats : presque tous signés, sauf quelques-uns à relancer
for r in reservations:
    if r["statut"] in ("en cours", "terminée") and random.random() < 0.9 or r["statut"] == "confirmée" and r["date_debut"] > jour(2) and random.random() < 0.3:
        r["contrat_signe"], r["contrat_signe_le"] = True, r["date_debut"] + "T09:30:00"
c.ecrire_json(c.RESERVATIONS, reservations)

# Carnet d'entretien (alimente aussi la comptabilité)
for identifiant, type_, il_y_a, cout, km, note in [
    ("audi-a3-chine", "vidange", 40, 9500, 8200, "Huile + filtre, garage Benali"), ("audi-q3-chine", "pneus", 65, 62000, 9100, "4 pneus neufs"),
    ("mg3", "revision", 28, 14000, 800, "Première révision"), ("geely-coolray-beyond-pro", "freins", 15, 21000, 7400, "Plaquettes avant"),
    ("jetour-x70-luxury-plus", "vidange", 52, 12500, 35000, "Vidange + filtre à air"), ("volkswagen-passat-pro-chine", "batterie", 22, 28000, 60500, "Batterie 70 Ah"),
    ("changan-x5-at-plus", "climatisation", 9, 8000, 12100, "Recharge gaz"), ("mg5", "vidange", 80, 9000, 6000, "Vidange"),
]:
    c.ajouter_entretien(identifiant, {"type": type_, "date": jour(-il_y_a), "km": km, "cout": cout, "note": note}, "Samir Haddad")

# Sinistres et amendes : on rattache chaque incident à la location qui avait la voiture ce jour-là
terminees = [r for r in reservations if r["statut"] == "terminée" and r["date_fin"] < jour(-3)]
for r, (type_, description, montant, refacture, lieu, reference) in zip(terminees[:5], [
    ("amende", "Excès de vitesse constaté par radar", 2000, 2000, "RN 5, Boumerdès", "PV-2026-48213"),
    ("dommage", "Rayure sur le pare-chocs arrière au retour", 18000, 12000, "Agence Alger Centre", ""),
    ("accident", "Accrochage léger au stationnement, constat amiable signé", 45000, 30000, "Hydra, Alger", "CA-7741"),
    ("panne", "Batterie déchargée, dépannage sur place", 6000, 0, "Blida", ""),
    ("amende", "Stationnement interdit", 1500, 1500, "Alger Centre", "PV-2026-51877"),
]):
    jour_incident = min(r["date_fin"], jour(-1))
    i = c.creer_incident({"type": type_, "date": jour_incident, "voiture_id": r["voiture_id"], "description": description, "lieu": lieu, "reference": reference,
                          "montant": montant, "refacture": refacture, "reservation": r["numero"]}, "Samir Haddad")
    etapes = {"amende": {"cout_paye": True, "refacture_encaisse": True, "statut": "regle"}, "dommage": {"cout_paye": True, "statut": "en_cours"}, "accident": {"statut": "ouvert"},
              "panne": {"cout_paye": True, "statut": "regle"}}.get(type_, {"statut": "ouvert"})
    if r is terminees[4]:
        etapes = {"statut": "ouvert"}
    c.modifier_incident(i["id"], etapes, "Samir Haddad")

# Comptes et journal
for nom, ident, role, mdp in [("Administrateur", "admin", "admin", "Demo-Admin-2026"), ("Samir Haddad", "samir", "employe", "Demo-Employe-2026"), ("Lila Bouzid", "lila", "employe", "Demo-Employe-2026")]:
    c.creer_compte({"nom": nom, "identifiant": ident, "role": role}, "démo", mot_de_passe=mdp, doit_changer=False)
journal = [{"le": r["cree_le"], "par": r["historique"][0]["par"], "action": "réservation créée", "detail": f'{r["numero"]} · {r["voiture"]} · {r["client"]["prenom"]} {r["client"]["nom"]}'} for r in reservations if r["statut"] != "blocage"][-40:]
c.ecrire_json(c.JOURNAL, journal)
print(f"✅ Démo créée : {len([r for r in reservations if r['statut'] != 'blocage'])} réservations, 14 dossiers, 3 comptes  →  {c.DONNEES}")
