import {PlaybackController} from "../playback/controller.mjs";
import {ProfileSimulator} from "./profile-simulator.mjs";
import {ReaderDeviceController} from "./reader-device.mjs";

export function createReaderSimulation({simulator, alpha, now, ...options}) {
  const device = simulator || new ProfileSimulator({now, alpha});
  return {device, playback: new PlaybackController({...options, device, now})};
}

export class BetaReaderDeviceController extends ReaderDeviceController {
  constructor(options = {}) {
    super({...options, createSimulation: createReaderSimulation});
  }
}
