#!/bin/zsh
# Double-click to open a Claude Code writer that can only use Story Studio's
# tools and writes each turn you queue in MCP mode. Start Story Studio first.
exec "${0:A:h}/bin/story-studio-claude-writer"
