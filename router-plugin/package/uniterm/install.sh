#!/bin/sh
. /koolshare/scripts/base.sh
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "$(uname -m)" = aarch64 ] || { echo '此包仅支持 ARM64 路由器'; exit 1; }
[ -d /koolshare ] && [ -d /koolshare/perp ] || { echo '需要 KoolCenter 软件中心'; exit 1; }
# Upgrades stop the service before overwriting its existing binaries. Count
# growth per replaced file, while retaining the same 8 MiB free-space reserve.
need=0
for file in "$DIR"/bin/*; do
 incoming=$(du -k "$file" | awk '{print $1}')
 installed="/koolshare/uniterm/$(basename "$file")"
 retained=0
 if [ -f "$installed" ] && [ ! -L "$installed" ]; then
  retained=$(du -k "$installed" | awk '{print $1}')
 fi
 growth=$((incoming - retained))
 if [ "$growth" -gt 0 ]; then need=$((need + growth)); fi
done
free=$(df -Pk /koolshare | awk 'END{print $4}')
[ "$free" -ge "$((need + 8192))" ] || { echo 'JFFS 空间不足：新增程序之外需保留 8MiB，请先清理后安装'; exit 1; }
if [ -x /koolshare/scripts/uniterm_config.sh ]; then /koolshare/scripts/uniterm_config.sh stop; fi
mkdir -p /koolshare/uniterm /koolshare/configs/uniterm /koolshare/scripts /koolshare/webs /koolshare/res /koolshare/init.d
cp "$DIR"/bin/* /koolshare/uniterm/
cp "$DIR"/scripts/* /koolshare/scripts/
cp "$DIR"/webs/* /koolshare/webs/
cp "$DIR"/res/* /koolshare/res/
cp "$DIR"/init.d/* /koolshare/init.d/
cp "$DIR/uninstall.sh" /koolshare/scripts/uninstall_uniterm.sh
chmod 755 /koolshare/uniterm/* /koolshare/scripts/uniterm_*.sh /koolshare/scripts/uninstall_uniterm.sh /koolshare/init.d/S98uniterm.sh
chmod 700 /koolshare/configs/uniterm
[ -n "$(dbus get uniterm_port)" ] || dbus set uniterm_port=18888
[ -n "$(dbus get uniterm_tls)" ] || dbus set uniterm_tls=0
[ -n "$(dbus get uniterm_tls_mode)" ] || dbus set uniterm_tls_mode=auto
dbus set uniterm_enable=0
dbus set softcenter_module_uniterm_install=1
dbus set softcenter_module_uniterm_name=uniterm
dbus set softcenter_module_uniterm_title=uniTerm
dbus set softcenter_module_uniterm_description='Web 终端、文件传输与远程连接管理'
dbus set softcenter_module_uniterm_version=0.3.0-rc.3
echo '安装完成。请打开 uniTerm 插件设置首次密码并启用；升级后也需重新启用。'
