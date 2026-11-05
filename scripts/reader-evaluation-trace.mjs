import assert from "node:assert/strict";
import {ProfileSimulator} from "../app/static/devices/profile-simulator.mjs";
import {PlaybackController} from "../app/static/playback/controller.mjs";
import {CombinedReadingFeel} from "../app/static/reader/calibration.mjs";
import {SimulationClock} from "../app/static/simulation/clock.mjs";

export async function trace(toy, levels, profiles, position, manualZeros, {maximum, timestamps}) {
  const clock = new SimulationClock();
  const device = new ProfileSimulator({model: toy, now: clock.now});
  const {simChannels} = device.profile;
  const commands = [];
  const command = device.command.bind(device), commandVector = device.commandVector.bind(device);
  device.command = (level, seconds) => {
    commands.push({at: clock.now(), levels: {vibrate: level}, seconds});
    command(level, seconds);
  };
  device.commandVector = (vector, seconds) => {
    commands.push({at: clock.now(), levels: {...vector}, seconds});
    commandVector(vector, seconds);
  };
  const playback = new PlaybackController({device, now: clock.now, setTimer: clock.setTimer,
    clearTimer: clock.clearTimer, getMovement: () => "vibrate"});
  if (simChannels.length > 1) {
    playback.feel = new CombinedReadingFeel(Object.fromEntries(simChannels.map(channel => [channel, {maximum, rhythm: "scene"}])),
      {automaticMovement: true, preferredMovement: "vibrate"});
  } else playback.setFeel({rhythm: "scene"});
  playback.connect();
  playback.setStory(levels, profiles);
  playback.setCeilingFromControl(maximum);
  playback.setManualZeros(manualZeros);
  playback.setPosition(position);
  assert.equal(device.snapshot().strength, 0);
  assert.equal(commands.length, 0);
  assert.equal(playback.start(), true);
  const samples = [device.snapshot().channels];
  for (let index = 1; index < timestamps.length; index++) {
    await clock.advance(timestamps[index] - timestamps[index - 1]);
    assert.ok(playback.snapshot().running, "The simulator must remain armed throughout the sampled section.");
    samples.push(device.snapshot().channels);
  }
  playback.pause();
  assert.equal(device.snapshot().strength, 0);
  const commandCount = commands.length;
  await clock.advance(3000);
  assert.equal(commands.length, commandCount, "Stop prevents renewed output.");
  for (const [index, frame] of commands.entries()) {
    assert.equal(frame.seconds, 2);
    assert.ok(index === 0 || frame.at - commands[index - 1].at >= 1000);
    assert.ok(Object.entries(frame.levels).every(([id, level]) => simChannels.includes(id) && level >= 0 && level <= maximum));
  }
  const movements = simChannels.filter(channel => samples.some(sample => sample[channel] > 0));
  return {movements, samples, commandCount};
}
