#
# ~/.bash_profile
#

# if uwsm check may-start; then
#   exec uwsm start hyprland.desktop
# fi

# sensitive env variables
[[ -r "$HOME/.bash_profile.local" ]] && . "$HOME/.bash_profile.local"

[[ -f "$HOME/.bashrc" ]] && . "$HOME/.bashrc"
