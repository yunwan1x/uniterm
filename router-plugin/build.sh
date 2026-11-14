#!/bin/sh
# Build on Linux with Go >=1.26.3, Node >=22.12, wails3 v3.1.0 and UPX 5.2.
set -eu
cd "$(dirname "$0")/.."
: "${UNITERM_BUILD_ROOT:=$PWD/.router-build}"
mkdir -p "$UNITERM_BUILD_ROOT" router-plugin/package/uniterm/bin router-plugin/output
export CGO_ENABLED=0
wails3 generate bindings -f "-tags server,production" -clean=true
(cd frontend && npm ci --no-audit --no-fund && npm run build)
export GOOS=linux GOARCH=arm64
go build -trimpath -tags "server production" -ldflags="-s -w -X main.Version=router-0.3.0-rc.3" -o router-plugin/package/uniterm/bin/uniterm-server .
go build -trimpath -ldflags="-s -w" -o router-plugin/package/uniterm/bin/uniterm-gateway ./cmd/uniterm-gateway
chmod 755 router-plugin/package/uniterm/bin/*
upx --lzma router-plugin/package/uniterm/bin/*
upx -t router-plugin/package/uniterm/bin/*
cp LICENSE THIRD_PARTY_NOTICES.md router-plugin/package/uniterm/
cp -R third_party/adb-go/LICENSE router-plugin/package/uniterm/adb-go-LICENSE
chmod 755 router-plugin/package/uniterm/install.sh router-plugin/package/uniterm/uninstall.sh router-plugin/package/uniterm/scripts/*.sh router-plugin/package/uniterm/init.d/*.sh
tar -czf router-plugin/output/uniterm-0.3.0-rc.3-arm64.tar.gz -C router-plugin/package uniterm
(cd router-plugin/output && sha256sum uniterm-0.3.0-rc.3-arm64.tar.gz >SHA256SUMS)
