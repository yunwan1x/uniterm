#!/bin/sh
. /koolshare/scripts/base.sh
/koolshare/scripts/uniterm_config.sh stop || exit 1
dbus set uniterm_enable=0
dbus remove uniterm_initial_password
rm -rf /koolshare/perp/uniterm /koolshare/uniterm
rm -f /koolshare/scripts/uniterm_run.sh /koolshare/scripts/uniterm_tls.sh /koolshare/scripts/uniterm_config.sh /koolshare/init.d/S98uniterm.sh /koolshare/webs/Module_uniterm.asp /koolshare/res/icon-uniterm.png
for key in $(dbus list softcenter_module_uniterm_ | cut -d= -f1); do dbus remove "$key"; done
echo '已卸载程序，保留 /koolshare/configs/uniterm 内账号和连接数据。'
rm -f /koolshare/scripts/uninstall_uniterm.sh
