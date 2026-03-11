#!/usr/bin/env bash
# ConShell Local Verification Script
# 安装 → 配置 → 使用 全流程验证
set -e

echo "╔══════════════════════════════════════════╗"
echo "║   ConShell Local Verification Script     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")/.."
ROOT=$(pwd)

# ── Step 1: Build ────────────────────────────────────────────────────────
echo "┌── Step 1: Build ──────────────────────────┐"
pnpm build
echo "✅ Build passed"
echo ""

# ── Step 2: Test ─────────────────────────────────────────────────────────
echo "┌── Step 2: Test ───────────────────────────┐"
pnpm test
echo "✅ Tests passed"
echo ""

# ── Step 3: Link CLI globally ────────────────────────────────────────────
echo "┌── Step 3: Link CLI ───────────────────────┐"
npm link 2>/dev/null || true
echo "✅ CLI linked as 'conshell'"
echo ""

# ── Step 4: Verify CLI entry ─────────────────────────────────────────────
echo "┌── Step 4: Verify CLI ─────────────────────┐"
echo "  conshell --version:"
conshell --version
echo ""
echo "  conshell --help:"
conshell --help
echo "✅ CLI entry works"
echo ""

# ── Step 5: Doctor check ─────────────────────────────────────────────────
echo "┌── Step 5: Doctor Check ───────────────────┐"
conshell doctor || true
echo "✅ Doctor check completed"
echo ""

# ── Step 6: Daemon status ────────────────────────────────────────────────
echo "┌── Step 6: Daemon Status ──────────────────┐"
conshell daemon status || true
echo "✅ Daemon status checked"
echo ""

echo "╔══════════════════════════════════════════╗"
echo "║   ✅ Basic Verification Complete!        ║"
echo "║                                          ║"
echo "║   Next steps:                            ║"
echo "║   1. conshell onboard     (初次配置)     ║"
echo "║   2. conshell configure   (编辑配置)     ║"
echo "║   3. conshell start       (启动 Agent)   ║"
echo "║   4. conshell ui          (打开 WebUI)   ║"
echo "╚══════════════════════════════════════════╝"
