#!/usr/bin/env sh
set -eu

PACKAGE_NAME="${PIE_INSTALL_PACKAGE:-@pie-lab/coding-agent}"
MIN_NODE_VERSION="${PIE_MIN_NODE_VERSION:-22.19.0}"

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

strip_v_prefix() {
	printf '%s' "$1" | sed 's/^v//'
}

version_part() {
	printf '%s' "$1" | cut -d. -f"$2" | sed 's/[^0-9].*$//'
}

version_ge() {
	current="$(strip_v_prefix "$1")"
	required="$(strip_v_prefix "$2")"

	current_major="$(version_part "$current" 1)"
	current_minor="$(version_part "$current" 2)"
	current_patch="$(version_part "$current" 3)"
	required_major="$(version_part "$required" 1)"
	required_minor="$(version_part "$required" 2)"
	required_patch="$(version_part "$required" 3)"

	current_major="${current_major:-0}"
	current_minor="${current_minor:-0}"
	current_patch="${current_patch:-0}"
	required_major="${required_major:-0}"
	required_minor="${required_minor:-0}"
	required_patch="${required_patch:-0}"

	if [ "$current_major" -gt "$required_major" ]; then return 0; fi
	if [ "$current_major" -lt "$required_major" ]; then return 1; fi
	if [ "$current_minor" -gt "$required_minor" ]; then return 0; fi
	if [ "$current_minor" -lt "$required_minor" ]; then return 1; fi
	[ "$current_patch" -ge "$required_patch" ]
}

if ! command_exists node; then
	echo "Node.js ${MIN_NODE_VERSION} or newer is required to install pie." >&2
	echo "Install Node.js first, then rerun this installer." >&2
	exit 1
fi

node_version="$(node -v)"
if ! version_ge "$node_version" "$MIN_NODE_VERSION"; then
	echo "Node.js ${MIN_NODE_VERSION} or newer is required. Found ${node_version}." >&2
	exit 1
fi

if ! command_exists npm; then
	echo "npm is required to install pie." >&2
	exit 1
fi

if [ -n "${PIE_INSTALL_VERSION:-}" ]; then
	package_spec="${PACKAGE_NAME}@${PIE_INSTALL_VERSION}"
else
	package_spec="$PACKAGE_NAME"
fi

echo "Installing pie from ${package_spec}..."
npm install -g --ignore-scripts "$package_spec"

if command_exists pie; then
	echo "pie installed:"
	pie --version || true
	echo "Run: pie --help"
else
	echo "pie was installed, but the pie command is not on PATH yet." >&2
	echo "Check your npm global bin directory with: npm bin -g" >&2
	exit 1
fi
