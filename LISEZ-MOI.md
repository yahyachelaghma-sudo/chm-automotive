# CHM Automotive Location — site client + espace employés

| | Adresse | Qui |
|---|---|---|
| Site client | `/site/` | tout le monde |
| **Espace employés** | `/employe/` | le personnel de l'agence (connexion obligatoire) |

## Espace employés : premier lancement
Au premier démarrage, le serveur crée le compte **admin** et affiche son mot de passe provisoire (aussi dans `donnees/PREMIER_MOT_DE_PASSE.txt`). Connectez-vous sur `/employe/` : vous devez le changer tout de suite. Ensuite, onglet **Équipe** : ajoutez chaque employé (rôle *Employé* ou *Administrateur*).

- **Employé** : réservations, planning, dossiers clients, clients, véhicules (état, emplacement, kilométrage, entretien, blocages)
- **Administrateur** : tout cela + ajout/modification des véhicules, paramètres (paiements, tarifs, remises), équipe, journal, sauvegarde

**Langues** : l'espace employés existe en **français, anglais et arabe** (affichage de droite à gauche). Le choix se fait avec le sélecteur de langue en haut de page (et sur l'écran de connexion) ; il est mémorisé. Les traductions sont dans `employe/traductions.js` (un tableau `[français, anglais, arabe]` : pour corriger un mot, modifiez la ligne). Le contrat imprimable et le site client restent en français.

**Photos avant / après** : à chaque départ et retour, l'employé relève le compteur et le carburant et prend jusqu'à 6 photos. Elles sont stockées dans `donnees/etats/` (jamais publiques), visibles dans la fiche de la réservation et en bas de la carte du véhicule, et reprises en annexe du contrat.

Pour une **démonstration** avec de fausses données : `python3 employe/demo.py` puis `CHM_DONNEES=donnees_demo PORT=8001 python3 serveur.py` (comptes `admin` / `Demo-Admin-2026` et `samir` / `Demo-Employe-2026`).

---

# Mettre le site en ligne

## Ce qu'il te faut
- Un serveur Linux Ubuntu/Debian (VPS) avec accès SSH root, et son **adresse IP**
- Un **nom de domaine** dont l'enregistrement DNS « A » pointe vers cette IP (ex. `chm-location.dz`)

## 1. Envoyer le projet (depuis ton Mac)
```bash
cd "/Users/yahyachelaghma/location de voiture"
rsync -av --exclude donnees --exclude .DS_Store ./ root@IP_DU_SERVEUR:/opt/chm/
```

## 2. Installer (une seule commande)
```bash
ssh root@IP_DU_SERVEUR "bash /opt/chm/deploiement/installer.sh chm-location.dz"
```
Le site est alors sur `https://chm-location.dz` (HTTPS automatique).

## Au quotidien
| Je veux… | Commande sur le serveur |
|---|---|
| Voir les réservations, dossiers, planning | espace employés `https://ton-domaine/employe/` |
| Voir les erreurs | `journalctl -u chm -f` |
| Redémarrer | `systemctl restart chm` |
| Modifier prix / voitures / paiement | modifier `informations/*.json` (pris en compte tout de suite, sans redémarrer) |
| Mettre à jour le site | refaire l'étape 1 (le dossier `donnees` n'est jamais écrasé) |

## À faire avant d'ouvrir aux vrais clients
- Remplir `informations/agence.json` : vrai téléphone, WhatsApp, adresse, RIP BaridiMob / CCP / RIB, lien de paiement par carte
- Remplacer `images/logo.jpg` par ton vrai logo si tu en as un
- **Sauvegarder `/opt/chm/donnees`** régulièrement (ce sont les réservations et les pièces d'identité des clients : données personnelles, à protéger)
