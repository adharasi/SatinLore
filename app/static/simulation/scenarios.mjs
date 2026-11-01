export const SIMULATION_SCENARIOS = Object.freeze([
  { id: "steady", name: "Steady connection", description: "Two eligible simulated devices. Choose one explicitly; requests acknowledge after 80 ms.", options: {} },
  { id: "none", name: "No devices", description: "Discovery returns an empty list. Connect and Start remain unavailable.", options: { devices: [] } },
  { id: "unsupported", name: "Unsupported capability", description: "A simulated device has no vibration capability. It cannot be selected for playback.", options: { devices: [{ id: "sim-unsupported", name: "Simulated light only", vibration: false }] } },
  { id: "connect-fails", name: "Connection fails", description: "The connection request rejects. Recovery requires an explicit new connection.", options: { connect: { reject: true, delay: 400 } } },
  { id: "slow-connect", name: "Delayed connection", description: "The connection takes 2200 ms. Cancel it, or advance the clock and complete it; neither action starts playback.", options: { connect: { delay: 2200 } } },
  { id: "connect-timeout", name: "Connection times out", description: "The connection completes after its 3000 ms timeout and ignores cancellation. A late reply cannot arm playback.", options: { connect: { delay: 5000, ignoreAbort: true } } },
  { id: "late-command", name: "Late command after Stop", description: "The first command arrives 1700 ms late and ignores cancellation. Stop first: its late completion must be ignored and followed by a targeted Stop.", options: { commandPlan: [{ delay: 1700, applyDelay: 1400, ignoreAbort: true }] } },
  { id: "wrong-ack", name: "Out-of-order acknowledgement", description: "The first command replies with an old request ID. The controller pauses and requests Stop rather than trusting the reply.", options: { commandPlan: [{ wrongId: true, delay: 350 }] } },
  { id: "command-timeout", name: "Command acknowledgement timeout", description: "The first command applies but never acknowledges. The controller pauses; uncertainty is shown rather than an invented zero.", options: { commandPlan: [{ never: true, ignoreAbort: true }] } },
  { id: "stop-fails", name: "Stop fails / output unknown", description: "A Stop during playback fails after the connection's initial zero check. Even when the fixture expires, the controller keeps its failure state until explicit recovery.", options: { stopPlan: [{}, { reject: true }] } },
  { id: "disconnect", name: "Disconnect while playing", description: "The simulated transport drops after the first command. Reconnect explicitly, then confirm a new Start.", options: { disconnectAfterCommand: 500 } },
]);
export function simulationScenario(id) { return SIMULATION_SCENARIOS.find(item => item.id === id) || SIMULATION_SCENARIOS[0]; }
