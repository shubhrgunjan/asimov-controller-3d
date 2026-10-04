#!/usr/bin/env bash
# scripts/setup-network.sh
# Universal network helper for Asimov Controller 3D & VASIMOV Simulation
# Automates USB reverse tethering and displays current LAN IP for any environment.

set -e

ADB_BIN=$(which adb 2>/dev/null || echo "$HOME/Android/Sdk/platform-tools/adb")

echo "============================================================"
echo "    ASIMOV CONTROLLER 3D — NETWORK AUTOMATION HELPER"
echo "============================================================"

# 1. Discover current host LAN IP
HOST_IP=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $7}' || hostname -I | awk '{print $1}')
echo "🌐 Current Host LAN IP : $HOST_IP"
echo "📡 VASIMOV WS State    : ws://${HOST_IP}:8854"
echo "🌐 VASIMOV HTTP API    : http://${HOST_IP}:8852"

# 2. Check for connected Android devices via ADB
if [ -x "$ADB_BIN" ]; then
    DEVICES=$("$ADB_BIN" devices | grep -v "List" | grep "device$" | awk '{print $1}' || true)
    if [ -n "$DEVICES" ]; then
        echo ""
        echo "📱 Found connected Android device(s):"
        echo "$DEVICES"
        echo "🔗 Setting up ADB reverse port forwarding (USB zero-latency)..."
        "$ADB_BIN" reverse tcp:8854 tcp:8854
        "$ADB_BIN" reverse tcp:8852 tcp:8852
        "$ADB_BIN" reverse tcp:8081 tcp:8081
        "$ADB_BIN" reverse tcp:7880 tcp:7880
        echo "✅ Forwarded 8854 (State), 8852 (HTTP), 8081 (Expo), 7880 (LiveKit WebRTC)"
        echo "👉 In app, you can now connect directly using: USB / Localhost (127.0.0.1)"
    else
        echo ""
        echo "ℹ️  No USB Android device detected via ADB."
        echo "👉 If connecting over Wi-Fi, ensure your phone is on the same network."
        echo "👉 The app will automatically detect host IP: $HOST_IP"
    fi
else
    echo "⚠️  ADB binary not found. Standard Wi-Fi auto-detection active."
fi

echo "============================================================"
