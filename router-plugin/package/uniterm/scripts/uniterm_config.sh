#!/bin/sh
. /koolshare/scripts/base.sh
. /koolshare/scripts/uniterm_tls.sh
ROOT=/koolshare/configs/uniterm
SERVICE=/koolshare/perp/uniterm
LOG=/tmp/uniterm.log
port_valid(){
 case "$1" in ''|*[!0-9]*) return 1;; esac
 [ "$1" -ge 1024 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}
health(){
 p=$(dbus get uniterm_port)
 port_valid "$p" || return 1
 scheme=http
 [ "$(dbus get uniterm_tls)" != 1 ] || scheme=https
 # Self-signed/custom domain certificates need an unverified local liveness probe.
 curl -kfsS --max-time 2 "$scheme://$(nvram get lan_ipaddr):$p/health" >/dev/null 2>&1
}
stop_service(){
 if [ -d "$SERVICE" ]; then
  perpctl d uniterm >/dev/null 2>&1
  chmod -t "$SERVICE"
  perpctl X uniterm >/dev/null 2>&1
 fi
 n=0
 while pidof uniterm-gateway >/dev/null && [ "$n" -lt 20 ]; do sleep 1; n=$((n+1)); done
 if pidof uniterm-gateway >/dev/null; then echo '停止超时，请检查进程'; return 1; fi
 cru d UniTermLogRotate
 echo 'uniTerm 已停止'
}
start_service(){
 tls_prepare || return 1
 port=$(dbus get uniterm_port)
 port_valid "$port" || { echo '端口必须为 1024–65535'; return 1; }
 if health; then echo 'uniTerm 已在运行'; return 0; fi
 if netstat -lnt 2>/dev/null | grep -Eq ":$port[[:space:]]"; then echo '端口已被占用'; return 1; fi
 umask 077
 mkdir -p "$ROOT/data" "$SERVICE" || return 1
 if [ ! -s "$ROOT/data/gateway/users.json" ]; then
  pass=$(dbus get uniterm_initial_password)
  length=$(printf '%s' "$pass" | wc -c)
  if [ "$length" -lt 6 ] || [ "$length" -gt 24 ]; then
   dbus remove uniterm_initial_password
   echo '首次启动需设置 6–24 字节的管理员密码'; return 1
  fi
  printf '%s' "$pass" > "$ROOT/bootstrap-password"
  chmod 600 "$ROOT/bootstrap-password"
  unset pass
 fi
 dbus remove uniterm_initial_password
 printf '%s\n' '#!/bin/sh' 'exec /koolshare/scripts/uniterm_run.sh "$@"' > "$SERVICE/rc.main"
 chmod 755 "$SERVICE/rc.main"
 chmod +t "$SERVICE"
 perpctl A uniterm >/dev/null 2>&1
 perpctl u uniterm >/dev/null 2>&1
 n=0
 while [ "$n" -lt 20 ]; do
  if health; then
   rm -f "$ROOT/bootstrap-password"
   cru a UniTermLogRotate '*/5 * * * * /koolshare/scripts/uniterm_config.sh rotate'
   echo 'uniTerm 已启动，管理员账号：admin'; return 0
  fi
  sleep 1; n=$((n+1))
 done
 stop_service >/dev/null
 rm -f "$ROOT/bootstrap-password"
 echo '启动失败，请查看运行日志'; return 1
}
action(){
 case "$1" in
 start) [ "$(dbus get uniterm_enable)" != 1 ] || start_service;;
 stop) stop_service;;
 apply|restart)
  if [ "$(dbus get uniterm_enable)" = 1 ]; then
   port_valid "$(dbus get uniterm_port)" || { echo '端口不合法'; return 1; }
   tls_prepare || return 1
  fi
  stop_service || return 1
  if [ "$(dbus get uniterm_enable)" = 1 ]; then start_service; fi;;
 status)
  scheme=http; [ "$(dbus get uniterm_tls)" != 1 ] || scheme=https
  if health; then echo "运行中：$scheme://$(nvram get lan_ipaddr):$(dbus get uniterm_port)"; else echo '已停止或正在启动'; fi
  [ ! -s "$ROOT/data/gateway/users.json" ] || echo '管理员账号已初始化'
  du -sh "$ROOT/data" 2>/dev/null;;
 log) tail -60 "$LOG" 2>/dev/null | grep -ivE 'password|secret|token|authorization|credential' || true;;
 rotate)
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
   tail -c 131072 "$LOG" > "$LOG.previous"; : > "$LOG"
  fi;;
 result) cat /tmp/uniterm-result.txt 2>/dev/null || echo __PENDING__;;
 *) echo '不支持的操作'; return 1;;
 esac
}
if [ -n "$2" ]; then
 cmd=$2
 case "$cmd" in start|stop|apply|restart)
  mkdir /tmp/uniterm-plugin.lock 2>/dev/null || { http_response "$(printf '%s' '另一个操作正在执行' | base64 | tr -d '\n')"; exit 1; }
  trap 'rmdir /tmp/uniterm-plugin.lock 2>/dev/null' EXIT
  echo __PENDING__ >/tmp/uniterm-result.txt
  http_response "$(printf __PENDING__ | base64 | tr -d '\n')" >/dev/null 2>&1;;
 esac
 result=$(action "$cmd" 2>&1); rc=$?
 [ "$rc" = 0 ] || result="操作失败：$result"
 [ -n "$result" ] || result='操作完成'
 case "$cmd" in start|stop|apply|restart)
  printf '%s' "$result" >/tmp/uniterm-result.txt.new
  mv /tmp/uniterm-result.txt.new /tmp/uniterm-result.txt;;
 *) http_response "$(printf '%s' "$result" | base64 | tr -d '\n')" >/dev/null 2>&1;;
 esac
 exit "$rc"
fi
action "$1"
