#!/bin/sh
# Self-signed HTTPS certificate for the LAN, so phones get a secure context (motion + camera
# need HTTPS) without a tunnel. The phone shows a warning once; accept it to continue.
# Re-run when your LAN IP changes.
set -e
cd "$(dirname "$0")/.."
mkdir -p certs
SAN="DNS:localhost,IP:127.0.0.1"
for ip in $(node -e 'import("./src/lib/lan.ts").then(m => console.log(m.lanIps().join(" ")))'); do
  SAN="$SAN,IP:$ip"
done
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout certs/lan-key.pem -out certs/lan-cert.pem \
  -subj "/CN=rehat-prototype" -addext "subjectAltName=$SAN" 2>/dev/null
echo "Wrote certs/lan-cert.pem for $SAN"
