export {createReaderSimulation} from "../devices/reader-beta-device.mjs";
export {createSimulatorView} from "./simulator-view.mjs";
export {PRACTICE_STORIES} from "./practice-stories.mjs";
export {createBetaRecorder, mountBetaRecording} from "./beta-recording.mjs";
export {PRACTICE_STORY, SETUP_STORIES} from "./beta-stories.mjs";
import {createSetupFlow} from "./setup-flow.mjs";
import {PRACTICE_STORY, SETUP_STORIES} from "./beta-stories.mjs";

export function createBetaSetupFlow(options) {
  return createSetupFlow({...options, allowSimulation: true, practiceStories: SETUP_STORIES, defaultPractice: PRACTICE_STORY});
}
