# dotfiles

Personal configuration managed with GNU Stow. Each top-level directory is a Stow package whose contents are symlinked into `$HOME`.

## Usage

From this repository:

```bash
cd ~/dotfiles
stow --no-folding -t "$HOME" <package>
```

Examples:

```bash
stow --no-folding -t "$HOME" bash
stow --no-folding -t "$HOME" kitty
stow --no-folding -t "$HOME" pi
```

Use `--no-folding` so Stow links individual files instead of replacing whole directories like `~/.config` or `~/.pi`. This keeps machine-local/private files in place.

To unstow a package:

```bash
stow -D -t "$HOME" <package>
```

## Pi AI agent setup

Pi configuration is stored in the `pi` Stow package:

```text
pi/
  .pi/agent/settings.json
  .pi/agent/APPEND_SYSTEM.md
  .pi/agent/skills/
  src/AGENTS.md
```

After stowing:

```text
~/.pi/agent/settings.json      -> ~/dotfiles/pi/.pi/agent/settings.json
~/.pi/agent/APPEND_SYSTEM.md   -> ~/dotfiles/pi/.pi/agent/APPEND_SYSTEM.md
~/src/AGENTS.md                -> ~/dotfiles/pi/src/AGENTS.md
```

The intent is to sync reusable Pi configuration and instructions across devices while keeping secrets and local state out of Git.

Synced:

- `~/.pi/agent/settings.json` — global Pi settings
- `~/.pi/agent/APPEND_SYSTEM.md` — extra global system instructions
- `~/.pi/agent/skills/` — custom/shared skills source files
- `~/src/AGENTS.md` — shared instructions for projects under `~/src`

Not synced intentionally:

- `~/.pi/agent/auth.json` — OAuth/subscription tokens
- `~/.pi/agent/sessions/` — conversation history, may contain sensitive data
- `node_modules/` inside skills — local install artifacts
- package caches/clones such as `~/.pi/agent/git/` or npm cache directories

On a new device:

```bash
mkdir -p ~/.pi/agent ~/src
cd ~/dotfiles
stow --no-folding -t "$HOME" pi
```

Then run Pi and log in on that device if needed:

```bash
pi
/login
```

## Other packages

High-level package map:

- `bash` — shell startup files such as `.bashrc` and `.bash_profile`
- `kitty` — Kitty terminal configuration
- `hyprland`, `waybar`, `swaync`, `wlogout`, `uwsm` — Wayland/Hyprland desktop environment configuration
- `yazi` — terminal file manager configuration
- `code`, `cursor`, `antigravity` — editor/AI IDE configuration
- `electron`, `voxtype` — app-specific configuration
- `pi` — Pi AI agent configuration and shared `AGENTS.md`

Stow packages can be installed independently per machine depending on what software is present.
