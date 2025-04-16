#!/bin/bash
#    ___                    
#   / _ \___ _    _____ ____
#  / ___/ _ \ |/|/ / -_) __/
# /_/   \___/__,__/\__/_/   
#                           

terminate_clients() {
  TIMEOUT=5
  # Get a list of all client PIDs in the current Hyprland session
  client_pids=$(hyprctl clients -j | jq -r '.[] | .pid')

  # Send SIGTERM (kill -15) to each client PID and wait for termination
  for pid in $client_pids; do
    echo ":: Sending SIGTERM to PID $pid"
    kill -15 $pid
  done

  start_time=$(date +%s)
  for pid in $client_pids; do
    # Wait for the process to terminate
    while kill -0 $pid 2>/dev/null; do
      current_time=$(date +%s)
      elapsed_time=$((current_time - start_time))

      if [ $elapsed_time -ge $TIMEOUT ]; then
        echo ":: Timeout reached."
        return 0
      fi

      echo ":: Waiting for PID $pid to terminate..."
      sleep 1
    done

    echo ":: PID $pid has terminated."
  done
}

# Author: Suchith Sridhar
# Website: https://suchicodes.com/
#
# This script is used to manage power based controls on Hyprland
# These are operations like shutdown, lock, and logout.
# 
# Before performing some of these operations we handle the closing of apps.
# If there are apps that can't be closed without losing data, then the power operation
# is cancelled and a notification about the cause of the cancellation is sent.
function close_apps() {
    BRAVE=$(hyprctl clients | grep "class: brave-browser" | wc -l)
    CHROMIUM=$(hyprctl clients | grep "class: brave-browser" | wc -l)
    FIREFOX=$(hyprctl clients | grep "class: firefox" | wc -l)

    if [ "$BRAVE" -gt "1" ]; then
        notify-send "Brave multiple windows open"
        exit 1
    elif [ "$CHROMIUM" -gt "1" ]; then
        notify-send "Chromium multiple windows open"
        exit 1
    elif [ "$FIREFOX" -gt "1" ]; then
        notify-send "Firefox multiple windows open"
        exit 1
    fi

    sleep 3

    # close all client windows
    # required for graceful exit since many apps aren't good SIGNAL citizens
    HYPRCMDS=$(hyprctl -j clients | jq -j '.[] | "dispatch closewindow address:\(.address); "')
    hyprctl --batch "$HYPRCMDS" >> ~/hyprexitwithgrace.log 2>&1

    notify-send "Closing Applications..."

    sleep 2

    COUNT=$(hyprctl clients | grep "class:" | wc -l)
    if [ "$COUNT" -eq "0" ]; then
        notify-send "Closed Applications."
        return
    else
        notify-send "Some apps didn't close. Not shutting down."
        exit 1
    fi
}


if [[ "$1" == "exit" ]]; then
  echo ":: Exit"
  terminate_clients
  sleep 0.5
  hyprctl dispatch exit
  sleep 2
fi

if [[ "$1" == "lock" ]]; then
  echo ":: Lock"
  sleep 0.5
  hyprlock
fi

if [[ "$1" == "reboot" ]]; then
  echo ":: Reboot"
  terminate_clients
  sleep 0.5
  systemctl reboot
fi

if [[ "$1" == "shutdown" ]]; then
  echo ":: Shutdown"
  terminate_clients
  sleep 0.5
  systemctl poweroff
fi

if [[ "$1" == "suspend" ]]; then
  echo ":: Suspend"
  systemctl suspend
fi
