#!/bin/sh
. /koolshare/scripts/base.sh
[ "$1" = start ] || exit 0
ROOT=/koolshare/configs/uniterm
port=$(dbus get uniterm_port)
lan=$(nvram get lan_ipaddr)
case "$port" in ''|*[!0-9]*) exit 1;; esac
[ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || exit 1
export UNITERM_DATA_DIR="$ROOT/data"
export UNITERM_GATEWAY_ADDR="$lan:$port"
export UNITERM_SERVER_BIN=/koolshare/uniterm/uniterm-server
if [ "$(dbus get uniterm_tls)" = 1 ]; then
 . /koolshare/scripts/uniterm_tls.sh
 tls_paths || exit 1
 export UNITERM_TLS_CERT_FILE="$TLS_CERT"
 export UNITERM_TLS_KEY_FILE="$TLS_KEY"
 export UNITERM_COOKIE_SECURE=true
else
 unset UNITERM_TLS_CERT_FILE UNITERM_TLS_KEY_FILE UNITERM_COOKIE_SECURE
fi
export UNITERM_ADMIN_USER=admin
export UNITERM_WORKER_IDLE_MINUTES=10
if [ -f "$ROOT/bootstrap-password" ]; then
 UNITERM_ADMIN_PASSWORD=$(cat "$ROOT/bootstrap-password")
 export UNITERM_ADMIN_PASSWORD
fi
umask 077
cd "$ROOT" || exit 1
exec /koolshare/uniterm/uniterm-gateway >>/tmp/uniterm.log 2>&1
