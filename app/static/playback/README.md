# Playback controller milestone

Current simulator orchestration is in `../app.mjs`. Extract the real controller here
when implementing connection lifecycle; avoid a second controller running alongside it.

Target states: disconnected, connecting, ready-paused, playing, error-paused.
Stop cancels dispatch first. Every nonzero device command has a short finite duration
and an explicit selected device. Reconnection and restored progress never auto-play.
Hardware expiry must be observed on real devices; JavaScript timers do not prove it.
