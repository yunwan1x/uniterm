#!/bin/sh
case "$1" in
 start) /koolshare/scripts/uniterm_config.sh start;;
 stop|kill) /koolshare/scripts/uniterm_config.sh stop;;
 restart) /koolshare/scripts/uniterm_config.sh restart;;
esac
