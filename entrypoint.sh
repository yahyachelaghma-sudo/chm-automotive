#!/bin/sh
# Démarrage sur Fly.io : tout ce que l'agence modifie doit vivre dans le volume « donnees »
# (sinon réservations, comptes, fiches véhicules et photos disparaîtraient à chaque mise à jour).
set -e
APP="${APP_DIR:-/app}"
D="$APP/donnees"

mkdir -p "$D/informations" "$D/images_voitures"
# Première fois seulement : on copie le catalogue et les photos livrés avec le code (jamais d'écrasement)
cp -rn "$APP/informations/." "$D/informations/"
cp -rn "$APP/images/voitures/." "$D/images_voitures/"
# Les photos de voitures ajoutées depuis la plateforme sont enregistrées dans le volume
rm -rf "$APP/images/voitures"
ln -s "$D/images_voitures" "$APP/images/voitures"

cd "$APP"
exec python3 serveur.py
