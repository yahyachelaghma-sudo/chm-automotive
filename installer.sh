#!/usr/bin/env bash
# À lancer SUR LE SERVEUR (Ubuntu / Debian), en root :   bash installer.sh mon-domaine.dz
# Prérequis : le projet est déjà copié dans /opt/chm et le domaine pointe vers l'IP du serveur.
set -euo pipefail
DOMAINE="${1:?Usage : bash installer.sh mon-domaine.dz}"

apt-get update -y
apt-get install -y python3 debian-keyring debian-archive-keyring apt-transport-https curl gpg ufw
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

id chm >/dev/null 2>&1 || useradd --system --home /opt/chm --shell /usr/sbin/nologin chm
mkdir -p /opt/chm/donnees
chown -R root:root /opt/chm
chown -R chm:chm /opt/chm/donnees
chmod 700 /opt/chm/donnees          # les pièces d'identité des clients : lisibles par le service uniquement

cp /opt/chm/deploiement/chm.service /etc/systemd/system/chm.service
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAINE {
    encode gzip
    reverse_proxy 127.0.0.1:8000
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
    request_body {
        max_size 70MB
    }
}
CADDY

ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable
systemctl daemon-reload
systemctl enable --now chm
systemctl restart caddy
echo "✅ En ligne : https://$DOMAINE  (le certificat HTTPS peut prendre une minute)"
echo "   Logs :  journalctl -u chm -f        Dossiers clients : /opt/chm/donnees"
