#!/usr/bin/env bash
# curl -fsSL https://raw.githubusercontent.com/gentclaw/gentclaw/main/install.sh | bash
set -euo pipefail

REPO="https://github.com/gentclaw/gentclaw.git"
INSTALL_DIR="${GENTCLAW_INSTALL:-$HOME/.local/share/gentclaw}"
BIN_DIR="${GENTCLAW_BIN:-$HOME/.local/bin}"

echo "gentclaw installer"
echo "=================="

# Prereqs
for cmd in node npm git; do
  command -v "$cmd" &>/dev/null || { echo "Error: $cmd not found"; exit 1; }
done

# Clone or pull (skip when GENTCLAW_INSTALL points at an existing repo checkout)
if [ "${GENTCLAW_INSTALL:-}" != "" ] && [ -d "$INSTALL_DIR/.git" ]; then
  echo "Using local repo at $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning to $INSTALL_DIR..."
  git clone "$REPO" "$INSTALL_DIR"
fi

# Build
cd "$INSTALL_DIR"
npm install --loglevel=warn
npm run build --silent

# Symlink
mkdir -p "$BIN_DIR"
rm -f "$BIN_DIR/gentclaw"
cat > "$BIN_DIR/gentclaw" <<'SHIM'
#!/usr/bin/env bash
exec node "${GENTCLAW_INSTALL:-$HOME/.local/share/gentclaw}/dist/cli.js" "$@"
SHIM
chmod +x "$BIN_DIR/gentclaw"

echo ""
echo "Installed: $BIN_DIR/gentclaw"

# PATH hint — detect shell rc file, print exact command
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  case "${SHELL:-/bin/bash}" in
    */zsh)  RC="$HOME/.zshrc"; LINE="export PATH=\"$BIN_DIR:\$PATH\"" ;;
    */fish) RC="$HOME/.config/fish/config.fish"; LINE="fish_add_path $BIN_DIR" ;;
    *)      RC="$HOME/.bashrc"; LINE="export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
  echo ""
  echo "Add to PATH:"
  echo "  echo '$LINE' >> $RC && source $RC"
fi

# Setup if interactive and no config exists
if [ -t 0 ] && [ ! -f "${GENTCLAW_HOME:-$HOME/.gentclaw}/settings.json" ]; then
  echo ""
  node "$INSTALL_DIR/dist/cli.js" setup
else
  echo "Run '$BIN_DIR/gentclaw setup' to configure."
fi
