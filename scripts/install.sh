#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
#  ConShell — Installer Script (GitHub-based)
#
#  Usage:
#    git clone git@github.com:Arch1eSUN/WEB4.0.git && cd WEB4.0 && bash scripts/install.sh
#
#  Or if you already have the repo:
#    cd WEB4.0 && bash scripts/install.sh
#
#  What this does:
#    1. Checks for Node.js (≥ 20), pnpm, git
#    2. Clones the repo (if not already in it)
#    3. Installs dependencies & builds
#    4. Links `conshell` globally
#    5. Runs `conshell doctor` post-install
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_URL="git@github.com:Arch1eSUN/WEB4.0.git"
INSTALL_DIR="${CONSHELL_INSTALL_DIR:-$HOME/.conshell/source}"

# ── Colors ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✓${NC}  $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}✗${NC}  $1"; }

# ── Banner ───────────────────────────────────────────────────────────────

echo -e "
${BOLD}╔══════════════════════════════════════════╗
║       🐚 ConShell Installer              ║
║   Sovereign AI Agent Runtime             ║
╚══════════════════════════════════════════╝${NC}
"

# ── Step 1: Check Prerequisites ──────────────────────────────────────────

REQUIRED_NODE_MAJOR=20

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

    if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
        success "Node.js v${NODE_VERSION} (≥ v${REQUIRED_NODE_MAJOR} ✓)"
    else
        error "Node.js v${NODE_VERSION} is too old. v${REQUIRED_NODE_MAJOR}+ required."
        echo ""
        echo "  Install via nvm:"
        echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
        echo "    nvm install --lts"
        exit 1
    fi
else
    error "Node.js not found. Install v${REQUIRED_NODE_MAJOR}+:"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
    echo "    nvm install --lts"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    success "npm v$(npm --version)"
else
    error "npm not found."
    exit 1
fi

# Check git
if command -v git &> /dev/null; then
    success "git v$(git --version | awk '{print $3}')"
else
    error "git not found. Install git first."
    echo "    • macOS: xcode-select --install"
    echo "    • Linux: sudo apt install git"
    exit 1
fi

# Check pnpm (install if missing)
if command -v pnpm &> /dev/null; then
    success "pnpm v$(pnpm --version)"
else
    warn "pnpm not found. Installing..."
    npm install -g pnpm
    success "pnpm installed"
fi

# Check C++ build tools (for better-sqlite3)
if [[ "$OSTYPE" == "darwin"* ]]; then
    if xcode-select -p &> /dev/null; then
        success "Xcode Command Line Tools"
    else
        warn "Xcode CLT not found. Installing..."
        xcode-select --install 2>/dev/null || true
        echo "  Click 'Install' in the dialog, then re-run this script."
        exit 1
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if command -v g++ &> /dev/null && command -v make &> /dev/null; then
        success "Build tools (g++, make)"
    else
        error "Build tools not found."
        echo "    Ubuntu/Debian: sudo apt-get install build-essential"
        echo "    Fedora: sudo dnf groupinstall 'Development Tools'"
        exit 1
    fi
fi

echo ""

# ── Step 2: Clone or Locate Repo ─────────────────────────────────────────

# Check if we're already inside the repo
if [ -f "packages/app/package.json" ] && grep -q '"conshell"' packages/app/package.json 2>/dev/null; then
    INSTALL_DIR="$(pwd)"
    info "Already inside ConShell repo: ${INSTALL_DIR}"
elif [ -f "../packages/app/package.json" ] && grep -q '"conshell"' ../packages/app/package.json 2>/dev/null; then
    INSTALL_DIR="$(cd .. && pwd)"
    info "Already inside ConShell repo: ${INSTALL_DIR}"
else
    # Clone the repo
    if [ -d "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR/.git" ]; then
        info "Updating existing clone at ${INSTALL_DIR}..."
        cd "$INSTALL_DIR"
        git pull --rebase origin main
    else
        info "Cloning ConShell from GitHub..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
fi

cd "$INSTALL_DIR"
success "Source directory: ${INSTALL_DIR}"
echo ""

# ── Step 3: Install Dependencies ─────────────────────────────────────────

info "Installing dependencies (this may take a minute)..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
success "Dependencies installed"
echo ""

# ── Step 4: Build ─────────────────────────────────────────────────────────

info "Building ConShell..."
pnpm -r build
success "Build complete"
echo ""

# ── Step 5: Link Globally ────────────────────────────────────────────────

info "Linking 'conshell' command globally..."
cd packages/app
npm link
cd "$INSTALL_DIR"
success "'conshell' command is now available globally"
echo ""

# ── Step 6: Post-Install Doctor ──────────────────────────────────────────

info "Running post-install health check..."
echo ""
conshell doctor || true

# ── Done ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  🎉 ConShell is ready!${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Quick start:"
echo ""
echo -e "    ${CYAN}conshell onboard${NC}       # First-time setup wizard"
echo -e "    ${CYAN}conshell${NC}               # Start REPL (interactive chat)"
echo -e "    ${CYAN}conshell start${NC}         # Start agent + HTTP server"
echo -e "    ${CYAN}conshell start -d${NC}      # Start as background daemon"
echo -e "    ${CYAN}conshell configure${NC}     # Edit configuration"
echo -e "    ${CYAN}conshell doctor${NC}        # Health diagnostics"
echo ""
echo "  Source:  ${INSTALL_DIR}"
echo "  Update:  conshell update"
echo ""
echo -e "  Docs: ${CYAN}https://github.com/Arch1eSUN/WEB4.0${NC}"
echo ""
