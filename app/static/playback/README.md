# Simulator playback controller

`controller.mjs` owns continuous simulator dispatch. It accepts paragraph levels and
the current index, with no story text or vendor credentials. The UI owns text,
corrections, reading position and the single-tab Web Lock.

- Explicit Start requires a connection, loaded paragraphs and a visible page.
- Each nonzero command lasts two seconds. Dispatch occurs at most once per second;
  intermediate reading changes replace the desired level instead of forming a queue.
- A lower desired level or ceiling stops existing output immediately. The next normal
  heartbeat applies the newest bounded level. A zero level stays at zero.
- Stop, hide, disconnect and story replacement cancel dispatch and invalidate stale
  timers. Reconnection and tab return remain paused.
- Explicit reading activity refreshes a two-minute idle timeout. Heartbeats, layout
  changes and rendering must not count as user activity.
- A timer gap of two seconds or more pauses playback instead of resuming after a stall.
- The adapter contract is synchronous, matching `MockDevice`. Promise-returning
  adapters fail closed and are not a supported real-device integration path.

The hardware-check screen has its own isolated single-pulse adapter. Do not wire the
reader into it without qualifying the real transport, identity, timing and isolation
boundaries. Simulator output and JavaScript timers cannot establish physical stopping.
