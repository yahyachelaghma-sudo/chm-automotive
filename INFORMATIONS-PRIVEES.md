# CHM Automotive Location — informations privées

⚠️ Fichier PRIVÉ : il contient des mots de passe. Il est exclu de GitHub (.gitignore). Ne l'envoyez à personne.

## 1. Comptes de l'espace employés (sur le Mac, http://localhost:8000/employe/)

| Identifiant | Mot de passe | Rôle |
|---|---|---|
| admin | (mot de passe provisoire dans donnees/PREMIER_MOT_DE_PASSE.txt, à changer) | administrateur |
| yahia | Smail1968 | administrateur |
| smail | Smail1968 | employé |

Ces comptes existent SEULEMENT sur le Mac. Le site en ligne a ses propres comptes (voir §4).

## 2. Où est quoi

- Projet complet (serveur + site + données) : /Users/yahyachelaghma/location de voiture
- Dépôt GitHub : https://github.com/yahyachelaghma-sudo/chm-automotive
  (le dépôt en ligne ne contient aujourd'hui que l'interface, sans serveur → la connexion ne peut pas marcher dessus)
- Données clients / réservations / comptes : dossier donnees/ (jamais sur GitHub)
- Prix, voitures, paiements : informations/*.json

## 3. Lancer le serveur sur le Mac

    cd "/Users/yahyachelaghma/location de voiture"
    python3 serveur.py

Puis ouvrir http://localhost:8000/employe/ (espace employés) ou http://localhost:8000/site/ (site client).

## 4. Mise en ligne sur Render (étape par étape)

Pourquoi Render et pas Vercel : le serveur écrit ses données dans des fichiers (comptes, réservations,
pièces d'identité). Vercel efface ces fichiers ; Render garde un disque permanent (plan « starter », ~7 $/mois).

1. Installer Homebrew : copier la commande de https://brew.sh dans le Terminal.
2. Installer GitHub CLI et se connecter :
       brew install gh
       gh auth login      (GitHub.com → HTTPS → Yes → Login with a web browser)
3. Envoyer le projet sur GitHub (dépôt privé conseillé). Le .gitignore exclut donnees/ et ce fichier.
4. Créer un compte sur https://render.com (« Get Started » avec GitHub).
5. Render : New → Blueprint → choisir le dépôt → Apply (le fichier render.yaml configure tout).
6. Onglet Shell du service Render :  cat donnees/PREMIER_MOT_DE_PASSE.txt  → mot de passe provisoire de « admin ».
7. Ouvrir https://NOM-DU-SERVICE.onrender.com/employe/ , se connecter en admin, changer le mot de passe,
   puis recréer yahia et smail dans l'onglet « Équipe ».

## 5. Au quotidien

- Sauvegarde : connecté en admin, bouton « Sauvegarde » (zip des données). À faire régulièrement.
- Changer un prix / une voiture : modifier informations/*.json, puis redéployer.
- Mise à jour du site : git push → Render redéploie tout seul. Le disque donnees/ n'est pas écrasé.

## 6. Avant d'ouvrir aux vrais clients

- Remplir informations/agence.json : vrai téléphone, WhatsApp, adresse, RIP/CCP/RIB, lien de paiement.
- Changer le mot de passe de tous les comptes de test.
- Sauvegarder donnees/ : ce sont des données personnelles (pièces d'identité), à protéger.

## 7. Dépannage rapide

| Symptôme | Cause | Solution |
|---|---|---|
| « Une erreur est survenue » + logo cassé | page servie sans le serveur Python (GitHub Pages, Live Server, fichier ouvert) | utiliser l'adresse du vrai serveur |
| « Le serveur ne répond pas » | serveur arrêté ou mauvaise adresse | relancer python3 serveur.py / vérifier l'adresse |
| « Identifiant ou mot de passe incorrect » | compte inexistant sur CE serveur | créer le compte sur ce serveur |
| « Trop d'essais » | 5 échecs → blocage 5 minutes | attendre 5 minutes |
