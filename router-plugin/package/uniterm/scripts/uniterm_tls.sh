#!/bin/sh
# Shared TLS configuration; paths are passed as quoted environment values.
tls_paths(){
 case "$(dbus get uniterm_tls_mode)" in
 custom)
  TLS_CERT=$(dbus get uniterm_tls_cert)
  TLS_KEY=$(dbus get uniterm_tls_key)
  case "$TLS_CERT" in /*) ;; *) echo '证书必须是路由器上的绝对路径'; return 1;; esac
  case "$TLS_KEY" in /*) ;; *) echo '私钥必须是路由器上的绝对路径'; return 1;; esac;;
 ''|auto)
  TLS_CERT=/koolshare/configs/uniterm/tls/server.crt
  TLS_KEY=/koolshare/configs/uniterm/tls/server.key;;
 *) echo '证书模式不合法'; return 1;;
 esac
}
tls_prepare(){
 [ "$(dbus get uniterm_tls)" = 1 ] || return 0
 tls_paths || return 1
 if [ "$(dbus get uniterm_tls_mode)" != custom ] && { [ ! -s "$TLS_CERT" ] || [ ! -s "$TLS_KEY" ]; }; then
  lan=$(nvram get lan_ipaddr)
  printf '%s' "$lan" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  umask 077
  dir=/koolshare/configs/uniterm/tls
  mkdir -p "$dir" || return 1
  chmod 700 "$dir"
  cat >"$dir/openssl.cnf" <<EOF
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=uniTerm
[v3]
subjectAltName=IP:$lan,IP:127.0.0.1,DNS:router.asus.com
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
  if ! openssl req -x509 -newkey rsa:2048 -nodes -days 825 -config "$dir/openssl.cnf" -keyout "$TLS_KEY.new" -out "$TLS_CERT.new" >/dev/null 2>&1; then
   rm -f "$TLS_KEY.new" "$TLS_CERT.new" "$dir/openssl.cnf"
   echo '自签名证书生成失败'; return 1
  fi
  mv "$TLS_KEY.new" "$TLS_KEY"; mv "$TLS_CERT.new" "$TLS_CERT"
  chmod 600 "$TLS_KEY"; chmod 644 "$TLS_CERT"
  rm -f "$dir/openssl.cnf"
 fi
 [ -r "$TLS_CERT" ] && [ -r "$TLS_KEY" ] || { echo '证书或私钥文件不可读'; return 1; }
 # Validate before stopping the current service. Never print private key data.
 umask 077
 check=/tmp/uniterm-tls-check.$$
 mkdir -m 700 "$check" || return 1
 openssl x509 -in "$TLS_CERT" -pubkey -noout >"$check/cert" 2>/dev/null &&
 openssl pkey -in "$TLS_KEY" -passin pass: -pubout >"$check/key" 2>/dev/null &&
 cmp -s "$check/cert" "$check/key"
 rc=$?
 rm -rf "$check"
 [ "$rc" = 0 ] || { echo '证书与未加密私钥不匹配或格式不合法'; return 1; }
}
