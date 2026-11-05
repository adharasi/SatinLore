// Browser-level workspace checks use neutral fixtures and simulated output only.
import assert from "node:assert/strict";
import {mkdir, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {MOVEMENT_READINGS} from "../tests/scene-evaluation-fixtures.mjs";
import {SETUP_MODELS} from "../app/static/reader/setup-flow.mjs";

const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/frontend");
const libraryKey = "satinlore.library.v1";
const preferencesKey = "satinlore.reader-preferences.v1";
const presentationKeys = ["satinlore.appearance", preferencesKey].sort();
const neutralStory = Array.from({length: 8}, (_, index) =>
  `Section ${index + 1}. ` + "An ordinary walk passed the library, garden and station. ".repeat(7)).join("\n\n");

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", {bubbles: true}));
  }, value);
}
async function output(page, level) {
  await page.waitForFunction(value => document.querySelector("#output").textContent === `${value} / 20`, level);
}
async function current(page, index) {
  await page.waitForFunction(value => document.querySelector(".story-paragraph.active")?.dataset.index === String(value), index);
}
async function analysed(page) {
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "ready");
}
async function openSettings(page, section = "reader") {
  await closeAppSettings(page);
  if (await page.locator("#settings-panel").isHidden()) await page.getByRole("button", {name: "Reading controls", exact: true}).click();
  const tab = page.locator(`#settings-${section}-tab`);
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  await page.locator(`#${section}-settings`).waitFor({state: "visible"});
}
async function closeSettings(page) {
  await closeAppSettings(page);
  if (await page.locator("#settings-panel").isVisible()) await page.locator("#close-settings").click();
}
async function openAppSettings(page) {
  if (await page.locator("#app-settings-dialog").isHidden()) await page.getByRole("button", {name: "Settings", exact: true}).click();
  await page.locator("#app-settings-dialog").waitFor({state: "visible"});
}
async function closeAppSettings(page) {
  if (await page.locator("#app-settings-dialog").isVisible()) await page.locator("#close-app-settings").click();
}
async function chooseAppearance(page, theme) {
  await openAppSettings(page);
  await page.locator("#reading-appearance").selectOption(theme);
  await closeAppSettings(page);
}
async function backupSettings(page) {
  await openAppSettings(page);
  if (!await page.locator(".library-tools").evaluate(element => element.open)) await page.locator(".library-tools > summary").click();
}
async function openReview(page) {
  await openSettings(page, "story");
  if (!await page.locator("#review-settings").evaluate(element => element.open)) {
    await page.locator("#review-settings > summary").click();
  }
  await page.waitForFunction(() => document.querySelectorAll("#review-list [data-review-index]").length > 0);
}
async function reviewAndFeedbackChecks(context, origin) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({width: 1366, height: 900});
    await page.goto(origin);
    const text = Array.from({length: 25}, (_, index) => `Section ${index + 1}. An ordinary walk passed the library.`).join("\n\n");
    await add(page, text, "Paged review");
    await openReview(page);
    const rows = page.locator("#review-list [data-review-index]");
    assert.equal(await rows.count(), 1, "Unread story text is hidden by default.");
    await page.locator("#show-upcoming").click();
    assert.equal(await rows.count(), 10, "Revealing future passages mounts only one page.");
    await page.locator("#review-page-next").click();
    assert.equal(await rows.first().getAttribute("data-review-index"), "10");
    assert.equal(await rows.count(), 10);
    await page.locator("#review-page-next").click();
    assert.equal(await rows.count(), 5);
    assert.equal(await page.locator("#review-page-next").isDisabled(), true);
    await page.locator("#review-page-current").click();
    assert.equal(await rows.first().getAttribute("data-review-index"), "0");
    await page.locator("#show-upcoming").click();
    assert.equal(await rows.count(), 1, "Hiding future sections restores the spoiler boundary.");
    await closeSettings(page);
    await page.locator("#connect").click();
    await start(page);
    await page.locator("#mark-reading-section").click();
    assert.equal(await page.locator("#reading-feedback").evaluate(element => element.open), true);
    assert.equal(await page.locator("#reading-feedback-section").inputValue(), "0");
    assert.equal(await page.locator("#reading-feedback-section").evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator("#pause").isDisabled(), true, "The shortcut leaves playback paused.");
    await page.locator('[data-reading-issue="wrong-moment"]').click();
    assert.match(await page.locator("#reading-feedback [role=status]").textContent(), /for this visit/);
  } finally {
    await page.close();
  }
}
async function openLibrary(page) {
  if (await page.locator("#library-panel").isHidden()) await page.locator("#toggle-library").click();
}
async function newDialog(page) {
  await closeAppSettings(page);
  if (!await page.locator("#empty-new-story").isVisible()) {
    await openLibrary(page);
    await page.locator("#new-story").click();
  }
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#empty-new-story").click()]);
  await chooser.setFiles([]);
  await page.locator("#new-story-dialog").waitFor({state: "visible"});
}
async function add(page, text, title = "A quiet afternoon", waitForAnalysis = true) {
  await closeSettings(page);
  await openLibrary(page);
  await page.locator("#new-story").click();
  await page.locator("#empty-workspace").waitFor({state: "visible"});
  await page.locator("#draft-title").fill(title);
  await page.locator("#draft-story").fill(text);
  await page.locator("#open-draft").click();
  await page.locator("#reading-workspace").waitFor({state: "visible"});
  assert.equal(await page.locator("#story-title").textContent(), title);
  if (waitForAnalysis) await analysed(page);
}
async function selectStory(page, title) {
  await closeSettings(page);
  await openLibrary(page);
  await page.locator("#story-list button[data-story-id]").filter({hasText: title}).click();
  await page.waitForFunction(value => document.querySelector("#story-title").textContent === value, title);
  await analysed(page);
}
async function start(page, confirm = true) {
  await page.locator("#start").click();
  await page.locator("#start-dialog").waitFor({state: "visible"});
  assert.match(await page.locator("#start-summary").textContent(), /simulator/i);
  const cap = (await page.locator("#capValue").textContent()).trim();
  assert.match(await page.locator("#confirm-start").textContent(), new RegExp(`maximum ${cap}\\s*\\/\\s*20`, "i"));
  if (confirm) {
    await page.locator("#confirm-start").click();
    await page.locator("#start-dialog").waitFor({state: "hidden"});
  }
}
async function save(page) {
  await openSettings(page, "story");
  await page.locator("#save-story").click();
  await page.locator("#save-dialog").waitFor({state: "visible"});
  await page.locator("#confirm-save").click();
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "saved");
  await closeSettings(page);
}
async function scrollTo(page, index) {
  await page.evaluate(value => {
    const paragraph = document.querySelector(`.story-paragraph[data-index="${value}"]`);
    const dock = document.querySelector("#transport").getBoundingClientRect();
    const header = document.querySelector(".workspace-header").getBoundingClientRect();
    const top = Math.max((visualViewport?.offsetTop || 0) + 16, header.bottom + 16);
    const bottom = Math.max(top + 48, Math.min(innerHeight - 16, dock.top - 16));
    window.scrollBy(0, paragraph.getBoundingClientRect().top - (top + (bottom - top) * .35) + 30);
  }, index);
}
async function assertFits(page, label, stopSelector = "#stop") {
  const overflow = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
    elements: Array.from(document.querySelectorAll("body *")).filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.left < -1 || box.right > innerWidth + 1);
    }).slice(0, 12).map(element => ({tag: element.tagName, id: element.id, width: Math.round(element.getBoundingClientRect().width)})),
  }));
  assert.ok(overflow.fits, `${label}: no horizontal page overflow. ${JSON.stringify(overflow.elements)}`);
  const stopBounds = await page.locator(stopSelector).evaluate(element => {
    const {width, height, top, bottom, left, right} = element.getBoundingClientRect();
    return {width, height, top, bottom, left, right, viewportWidth: innerWidth, viewportHeight: innerHeight};
  });
  const {width, height, top, bottom, left, right, viewportWidth, viewportHeight} = stopBounds;
  assert.ok(width >= 44 && height >= 44 && top >= 0 && bottom <= viewportHeight + 1 && left >= 0 && right <= viewportWidth + 1,
    `${label}: Stop must be reachable with a 44px target. ${JSON.stringify(stopBounds)}`);
}

const toyRehearsals = [
  {id: "lush", label: "Lush", channels: ["vibrate"]},
  {id: "flexer", label: "Flexer", channels: ["vibrate", "fingering"], testChannel: "fingering"},
  {id: "nora", label: "Nora", channels: ["vibrate", "rotate"], testChannel: "rotate"},
  {id: "domi", label: "Domi", channels: ["vibrate"]},
  {id: "velvo", label: "Velvo", channels: ["vibrate", "rotate"], testChannel: "rotate"},
  {id: "spinel", label: "Spinel", channels: ["vibrate", "thrusting"], testChannel: "thrusting"},
  {id: "dolce", label: "Dolce", channels: ["vibrate"]},
  {id: "hush", label: "Hush", channels: ["vibrate"]},
  {id: "osci3", label: "Osci 3", channels: ["vibrate", "oscillate"], testChannel: "oscillate"},
  {id: "solacepro", label: "Solace Pro", channels: ["thrusting"], testChannel: "thrusting"},
];

async function selectRehearsalDevice(page, profile) {
  await page.locator("#setup-selection").waitFor({state: "visible"});
  assert.equal(await page.locator("#setup-primary").isDisabled(), true, "Discovery never automatically selects a toy.");
  assert.equal(await page.locator("#setup-devices").inputValue(), "");
  assert.deepEqual(await page.locator("#setup-devices option").evaluateAll(options => options.map(option => option.value)), ["", `sim-${profile.id}`]);
  await page.locator("#setup-devices").selectOption(`sim-${profile.id}`);
  await page.locator("#setup-primary").click();
  await page.locator("#calibration-view").waitFor({state: "visible"});
  assert.deepEqual(await page.locator("#calibration-movements > section").evaluateAll(cards => cards.map(card => card.id.replace("calibration-movement-", ""))), profile.channels,
    `${profile.label} exposes its own simulated movements, without inventing other controls.`);
  for (const channel of profile.channels) {
    assert.equal(await page.locator(`#calibration-use-${channel}`).isChecked(), true);
    assert.equal(await page.locator(`#calibration-confirm-${channel}`).isChecked(), false);
  }
}

async function testRehearsalDevice(page, profile) {
  const channel = profile.testChannel || "vibrate";
  const confirmation = page.locator(`#calibration-confirm-${channel}`);
  assert.equal(await page.locator(`#calibration-test-level-${channel}`).getAttribute("max"), "5");
  await setRange(page, `calibration-test-level-${channel}`, 2);
  await page.locator(`#calibration-test-${channel}`).click();
  assert.equal(await page.locator("#calibration-live-output").textContent(), "Simulated level: 2 / 20",
    await page.locator("#calibration-status").textContent());
  assert.equal(await page.locator("#calibration-apply").isDisabled(), true, "Settings stay paused during a movement test.");
  assert.equal(await confirmation.isDisabled(), true, "Positive output cannot be confirmed as stopped.");
  await page.clock.runFor(2100);
  await page.waitForFunction(name => !document.querySelector(`#calibration-confirm-${name}`).disabled &&
    /Simulated level: 0 \/ 20/.test(document.querySelector("#calibration-live-output").textContent), channel);
  assert.equal(await confirmation.isChecked(), false, "A timer alone cannot supply the user's response confirmation.");
  await confirmation.check();
  // Leave settings unchanged so the fixture can rehearse the movement tested above.
  await page.locator("#calibration-skip").click();
  await page.locator("#setup-practice-picker").waitFor({state: "visible"});
  await page.locator("#calibration-view").waitFor({state: "hidden"});
  await page.locator("#setup-practice-story").selectOption("control-check-v1");
  await page.waitForFunction(() => document.querySelector("#setup-primary").textContent === "Open practice story");
  await output(page, 0);
}

async function prepareToyRehearsal(page, profile) {
  await openSettings(page);
  await page.locator("#open-setup").click();
  await page.locator("#setup-dialog").waitFor({state: "visible"});
  assert.deepEqual(await page.locator("#setup-model option").evaluateAll(options => options.map(option => [option.value, option.textContent])),
    SETUP_MODELS.map(profile => [profile.id, profile.pickerLabel]), "The compatibility catalogue is reachable in the real setup dialog.");
  await page.locator("#setup-model").selectOption(profile.id);
  await page.locator("#setup-mode-simulator").click();
  await page.locator("#setup-primary").click();
  await selectRehearsalDevice(page, profile);
  await testRehearsalDevice(page, profile);
}

async function combinedSceneChecks(page) {
  const flexer = toyRehearsals.find(profile => profile.id === "flexer");
  await openSettings(page);
  await page.locator("#open-setup").click();
  await page.locator("#setup-model").selectOption(flexer.id);
  await page.locator("#setup-mode-simulator").click();
  await page.locator("#setup-primary").click();
  await selectRehearsalDevice(page, flexer);
  await page.locator("#calibration-apply").click();
  await page.locator("#setup-close").click();

  const paragraphs = [
    "Their tender romantic kiss expressed affection. The device vibrated and flexed.",
    ...MOVEMENT_READINGS.flexer.slice(3, 5).map(({text}) => text),
    "They shared a tender kiss. She held the device. It pulsed in short bursts as her fingers flexed.",
    "They shared a tender kiss. She held the device. Her phone lit up. It pulsed in short bursts as her fingers flexed.",
    "The vibration stopped while her fingers kept flexing.",
    "They shared a tender kiss. The device flexed.",
    "It pulsed in short bursts.",
  ];
  await add(page, paragraphs.join("\n\n"), "Flexer combination rehearsal");
  await openSettings(page, "story");
  await page.locator("#scene-preferred-movement").selectOption("vibrate");
  const switching = page.locator("#scene-auto-movement");
  assert.equal(await switching.isChecked(), false, "Story-driven movement switching starts off.");

  const readChannel = async id => Number(await page.locator(`.simulator-channel-row[data-channel="${id}"] [role="meter"]`).getAttribute("aria-valuenow"));
  await start(page);
  await page.clock.runFor(1100);
  await current(page, 0);
  await output(page, 3);
  assert.equal(await readChannel("vibrate"), 3);
  assert.equal(await readChannel("fingering"), 0, "An overlap keeps the preferred movement with switching off.");
  await page.locator("#stop").click();
  await output(page, 0);
  await switching.check();
  await start(page);
  await page.clock.runFor(1100);
  await output(page, 3);
  assert.ok(await readChannel("vibrate") > 1 && await readChannel("fingering") > 1,
    "A genuine overlap drives both enabled movements in the same simulator tick.");

  await setRange(page, "cap", 1);
  await page.clock.runFor(1100);
  assert.equal(await readChannel("vibrate"), 1);
  assert.equal(await readChannel("fingering"), 1);
  await page.locator("#next").click();
  await current(page, 1);
  await page.clock.runFor(1100);
  assert.equal(await readChannel("vibrate"), 0, "Sequential movements do not overlap.");
  assert.equal(await readChannel("fingering"), 1, "A maximum of one preserves a low positive match.");
  await page.locator("#next").click();
  await current(page, 2);
  await output(page, 0);
  assert.equal(await readChannel("vibrate"), 0);
  assert.equal(await readChannel("fingering"), 0);

  await page.locator("#previous").click();
  await current(page, 1);
  await page.clock.runFor(1100);
  assert.equal(await readChannel("fingering"), 1);
  await page.locator("#stop").click();
  await output(page, 0);
  assert.equal(await readChannel("fingering"), 0, "Stop clears the active channel.");

  await page.locator("#next").click();
  await current(page, 2);
  await start(page);
  await page.waitForFunction(() => document.querySelector("#status").textContent === "Simulator running");
  const expectedMovements = [
    ["vibrate", "fingering"],
    ["fingering"],
    ["fingering"],
    ["fingering"],
    ["vibrate"],
  ];
  for (const [index, expected] of expectedMovements.entries()) {
    await page.locator("#next").click();
    await current(page, index + 3);
    await page.clock.runFor(1100);
    const active = [];
    for (const channel of flexer.channels) if (await readChannel(channel) > 0) active.push(channel);
    assert.deepEqual(active, expected, paragraphs[index + 3]);
  }
  await page.locator("#stop").click();
  await output(page, 0);
  await switching.uncheck();

  await openSettings(page);
  await page.locator("#feel-mode").selectOption("continuous");
  await openSettings(page, "story");
  for (let index = 7; index > 4; index--) await page.locator("#previous").click();
  await current(page, 4);
  await start(page);
  await page.clock.runFor(1100);
  await output(page, 1);
  assert.equal(await readChannel("vibrate"), 1, "The fixed default still plays before the named stop.");
  await page.locator("#next").click();
  await current(page, 5);
  await page.clock.runFor(1100);
  await output(page, 0);
  assert.equal(await readChannel("vibrate"), 0, "A named stop overrides the fixed default and its continuous background.");
  assert.equal(await readChannel("fingering"), 0, "With switching disabled, a named stop does not substitute another movement.");
  await page.locator("#stop").click();

  await page.locator("#combination-controls > summary").click();
  await page.locator('#combination-choices input[value="fingering"]').uncheck();
  await page.locator("#apply-combined").click();
  await page.locator("#scene-movement-settings").waitFor({state: "hidden"});
  await setRange(page, "cap", 1);
  await page.locator("#previous").click();
  await current(page, 4);
  await start(page);
  await page.clock.runFor(1100);
  await output(page, 1);
  await page.locator("#next").click();
  await current(page, 5);
  await page.clock.runFor(1100);
  await output(page, 0);
  await page.locator("#stop").click();
  await openSettings(page);
  await page.locator("#feel-mode").selectOption("story");
}

async function sceneStagePatternChecks(page) {
  const lush = toyRehearsals[0];
  await openSettings(page);
  await page.locator("#open-setup").click();
  await page.locator("#setup-model").selectOption(lush.id);
  await page.locator("#setup-mode-simulator").click();
  await page.locator("#setup-primary").click();
  await selectRehearsalDevice(page, lush);
  await page.locator("#calibration-apply").click();
  await page.locator("#setup-close").click();

  await add(page, [
    "They drew closer. She held her breath.",
    "Their slow tender kiss expressed affection.",
    "Their passionate, tender kiss and romantic embrace expressed affection.",
    "They slowed and relaxed.",
    "***",
  ].join("\n\n"), "Scene variation rehearsal");
  await openSettings(page, "story");
  await page.locator("#open-movement-tuning").click();
  assert.equal(await page.locator("#settings-reader-tab").getAttribute("aria-selected"), "true");
  assert.ok(await page.locator(".simulator-section:has(#simulator-visual):has(#feel-channel) #feel-rhythm").isVisible());
  const tune = page.getByText("Movement limits", {exact: true});
  if (!await tune.evaluate(summary => summary.parentElement.open)) await tune.click();
  await setRange(page, "cap", 18);
  await setRange(page, "feel-preferred", 18);
  await page.locator("#feel-rhythm").selectOption("scene");

  const watch = async (levels, description) => {
    await start(page);
    await output(page, levels[0]);
    for (const level of levels.slice(1)) {
      await page.clock.runFor(2100);
      await output(page, level);
    }
    await page.clock.runFor(2200);
    assert.equal(await page.locator("#output").textContent(), `${levels.at(-1)} / 20`, description);
    await page.locator("#stop").click();
    await output(page, 0);
  };
  await watch([3, 5, 6], "The build rises to a steady level.");
  await page.locator("#next").click();
  await current(page, 1);
  await page.locator("#next").click();
  await current(page, 2);
  await watch([13, 18, 11, 16, 9], "Peak accents hold the final level without looping.");
  await page.locator("#next").click();
  await current(page, 3);
  await watch([6, 4, 3, 2], "The taper holds its final lower level.");
  await page.locator("#next").click();
  await current(page, 4);
  await start(page);
  await page.clock.runFor(2200);
  await output(page, 0);
  await page.locator("#stop").click();
}

async function toyConnectionChecks(page) {
  const vendorRequests = [], leakedText = [], liveRequests = [];
  const monitor = request => {
    const url = new URL(request.url()), body = request.postData() || "";
    if (/(^|\.)lovense(?:-api)?\.(?:com|club)$/.test(url.hostname)) vendorRequests.push(url.hostname);
    if (/TOY_SETUP_PRIVATE_CANARY/.test(request.url() + body)) leakedText.push(url.pathname);
    if (/\/api\/lovense\//.test(url.pathname)) liveRequests.push({path: url.pathname, method: request.method(), body});
  };
  const unavailable = route => route.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({available: false})});
  page.on("request", monitor);
  await page.route("**/api/lovense/status", unavailable);
  try {
    // Lush's full practice is covered immediately before this function. Repeat
    // the actual select/test/practice journey for the core model fixtures and a thrust-only profile.
    for (const profile of toyRehearsals.slice(1)) {
      await prepareToyRehearsal(page, profile);
      await page.locator("#setup-primary").click();
      await page.locator("#setup-coach").waitFor({state: "visible"});
      await analysed(page); await output(page, 0);
      assert.equal(await page.locator("#save-status").getAttribute("data-state"), "session");
      assert.equal(await page.locator(".simulator-view").getAttribute("data-model"), profile.id);
      await start(page); await output(page, 0);
      await page.locator("#next").click(); await current(page, 1);
      await page.clock.runFor(1100); await output(page, 2);
      assert.equal(await page.locator(".simulator-device").getAttribute("data-output"), "2");
      assert.match(await page.locator(".simulator-view-note").textContent(), new RegExp(profile.testChannel === "rotate" ? "Rotation" : profile.testChannel === "fingering" ? "Flexing" : profile.testChannel === "thrusting" ? "Thrusting" : profile.testChannel === "oscillate" ? "Oscillation" : "Vibration"));
      await page.locator("#stop").click(); await output(page, 0);
      await page.locator("#setup-finish").click();
      await page.locator("#empty-workspace").waitFor({state: "visible"});
    }

    // A lost link and a connection error both require a fresh device selection;
    // reconnecting is neither a successful test nor permission to resume output.
    const profile = toyRehearsals.find(toy => toy.id === "nora");
    for (const failure of ["#setup-sim-failure", "#setup-sim-error"]) {
      await prepareToyRehearsal(page, profile);
      await page.locator("#setup-back").click();
      await page.locator("#setup-primary").click();
      await selectRehearsalDevice(page, profile);
      await page.locator(failure).click();
      await page.waitForFunction(() => /interrupted|lost|reconnect/i.test(document.querySelector("#setup-status").textContent));
      await output(page, 0);
      await page.locator("#setup-retry").click();
      await selectRehearsalDevice(page, profile);
      assert.equal(await page.locator(`#calibration-confirm-${profile.testChannel}`).isChecked(), false);
      await testRehearsalDevice(page, profile);
      await page.locator("#setup-close").click();
      await page.locator("#setup-dialog").waitFor({state: "hidden"});
      await output(page, 0);
    }

    await add(page, "TOY_SETUP_PRIVATE_CANARY\n\nA quiet paragraph stays on this device.", "Connection privacy fixture");
    await openSettings(page); await page.locator("#open-setup").click();
    await page.locator("#setup-model").selectOption("nora");
    await page.locator("#setup-mode-lovense").click();
    await page.locator("#setup-primary").click();
    await page.locator("#setup-pairing").waitFor({state: "visible"});
    await page.waitForFunction(() => /not configured/i.test(document.querySelector("#setup-qr-placeholder").textContent));
    assert.equal(await page.locator("#setup-rehearsal-tools").isHidden(), true, "Physical setup never displays simulated failure controls.");
    assert.equal(await page.locator("#setup-qr").isHidden(), true, "An unavailable integration cannot show a simulated pairing QR.");
    assert.equal(await page.locator("#setup-primary").isDisabled(), true);
    assert.equal(await page.locator("#start").isDisabled(), true);
    assert.equal(await page.locator(".simulator-view").getAttribute("data-mode"), "lovense");
    assert.equal(await page.locator(".simulator-view").getAttribute("data-connected"), "false");
    assert.equal(await page.locator(".simulator-device").getAttribute("data-output"), "0");
    assert.deepEqual(liveRequests.map(({path,method})=>({path,method})), [{path:"/api/lovense/status",method:"GET"}],
      "Unavailable setup requests no vendor credential/session and transmits no story.");
    assert.deepEqual(vendorRequests, [], "Rehearsals and unavailable setup must make no real vendor requests.");
    assert.deepEqual(leakedText, [], "Local story text never enters connection requests.");
    await page.locator("#setup-back").click();
    await page.locator("#setup-mode-simulator").click();
    await page.locator("#setup-model").selectOption("lush");
    await page.locator("#setup-primary").click();
    await selectRehearsalDevice(page, toyRehearsals[0]);
    await page.locator("#setup-close").click();
    await page.locator("#setup-dialog").waitFor({state:"hidden"});
    await output(page,0);
  } finally {
    page.off("request", monitor);
    await page.unroute("**/api/lovense/status", unavailable);
  }
}
async function appearanceChecks(page) {
  await page.emulateMedia({colorScheme: "dark"});
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.equal(await page.getByRole("switch", {name: "Dark mode"}).getAttribute("aria-checked"), "true");
  assert.equal(await page.evaluate(() => localStorage.length), 0, "Default appearance and library do not write storage.");
  await openAppSettings(page);
  assert.equal(await page.locator("#reading-appearance").inputValue(), "dark");
  await page.locator("#reading-appearance").selectOption("light");
  await page.emulateMedia({colorScheme: "light"});
  await page.emulateMedia({colorScheme: "dark"});
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "Explicit preference wins over OS.");
  assert.equal(await page.locator("#toggle-dark-mode").getAttribute("aria-checked"), "false");
  await page.getByRole("button", {name: "Close", exact: true}).click();
  assert.equal(await page.locator("#app-settings-dialog").isVisible(), false);
  await page.getByRole("switch", {name: "Dark mode"}).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await openAppSettings(page);
  assert.equal(await page.locator("#reading-appearance").inputValue(), "dark");
  await page.getByRole("button", {name: "Close settings", exact: true}).click();
  assert.equal(await page.locator("#app-settings-dialog").isVisible(), false);
  await page.getByRole("switch", {name: "Dark mode"}).click();
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await openAppSettings(page);
  await page.locator("#reading-appearance").selectOption("system");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({colorScheme: "light"});
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.locator("#reading-appearance").selectOption("light");
  await closeSettings(page);
}

async function captureLayouts(page) {
  await mkdir(evidence, {recursive: true});
  await openSettings(page);
  await page.locator("#follow-scroll").uncheck();
  await page.locator("#font-size").selectOption("normal");
  await page.locator("#reading-width").selectOption("wide");
  await closeSettings(page);
  await page.locator("#previous").evaluate(element => { while (!element.disabled) element.click(); });
  for (const [name, size] of [["desktop", {width: 1440, height: 1000}], ["phone", {width: 390, height: 844}]]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    for (const theme of ["light", "dark"]) {
      await chooseAppearance(page, theme);
      if (name === "desktop") await openLibrary(page);
      else if (await page.locator("#library-panel").isVisible()) await page.locator("#close-library").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertFits(page, `${name}/${theme}`);
      await page.screenshot({path: path.join(evidence, `${name}-${theme}.png`), animations: "disabled"});
    }
  }
  await page.setViewportSize({width: 320, height: 844});
  await page.waitForTimeout(100);
  await page.clock.runFor(100);
  await assertFits(page, "320px reflow");
  assert.ok(await page.locator("#toggle-dark-mode").evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= innerWidth && box.top >= 0;
  }), "The header Dark mode switch remains reachable at 320px.");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await page.locator(".story-paragraph").last().evaluate(element => ({
    bottom: element.getBoundingClientRect().bottom,
    dockTop: document.querySelector("#transport").getBoundingClientRect().top,
  }));
  assert.ok(end.bottom <= end.dockTop + 1, `The final line must be reachable above the dock: ${JSON.stringify(end)}`);
  await openLibrary(page); await assertFits(page, "320px library drawer");
  await page.locator("#close-library").click();
  await openSettings(page); await assertFits(page, "320px settings sheet");
  assert.equal(await page.locator("#main-content").evaluate(main => main.inert), true, "The open phone drawer leaves the obscured reader out of keyboard navigation.");
  const skip = page.locator("#skip-to-story");
  await skip.focus();
  assert.ok(await skip.evaluate(link => {
    const box = link.getBoundingClientRect();
    return link.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), "The focused Skip link appears above the sticky header.");
  await skip.press("Enter");
  assert.equal(await page.locator("#main-content").evaluate(main => main.inert), false);
  await start(page);
  await page.waitForFunction(() => document.querySelector("#transport").dataset.running === "true" && document.activeElement.id === "stop");
  await page.locator("#stop").press("Enter");
  await output(page, 0);
  for (const size of [{width: 844, height: 390}, {width: 390, height: 844}, {width: 320, height: 568}]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(100);
    const collapsed = await page.locator("#transport").evaluate(dock => dock.getBoundingClientRect().height);
    assert.ok(collapsed <= 90, `Compact dock leaves reading space at ${size.width}×${size.height}.`);
    assert.ok(await page.locator("#output").isVisible(), "Output stays visible without expanding playback controls.");
    assert.ok(await page.locator("#reading-sync-state").isVisible(), "Reading sync stays visible alongside output.");
    assert.ok(await page.locator("#cap").isHidden(), "The compact dock keeps the maximum in its secondary controls.");
    await page.locator("#transport-more").click();
    assert.equal(await page.locator("#transport-more").getAttribute("aria-expanded"), "true");
    assert.ok(await page.locator("#cap").isVisible(), "Expanding the dock reveals the maximum.");
    await page.locator("#transport-options").evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    await assertFits(page, `${size.width}×${size.height} with the options scrolled`);
    await page.locator("#cap").press("Escape");
    assert.equal(await page.locator("#transport-more").getAttribute("aria-expanded"), "false");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.clock.runFor(100);
    await assertFits(page, `${size.width}×${size.height} at 200% text`);
    await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.waitForTimeout(100);
  await chooseAppearance(page, "dark");
  await openReview(page);
  await page.screenshot({path: path.join(evidence, "settings-dark.png"), animations: "disabled"});
  await closeSettings(page);
  await start(page, false);
  await assertFits(page, "Start confirmation", "#start-stop");
  await page.screenshot({path: path.join(evidence, "start-confirmation.png"), animations: "disabled"});
  await page.locator("#cancel-start").click();
}

async function analysisChecks(page) {
  // Inject scheduling/failure into the real local model without adding a
  // production test endpoint or exposing story content to a server.
  await page.evaluate(async () => {
    const {ReaderModel} = await import("/static/reader/model.mjs");
    const original = ReaderModel.prototype.analyse;
    globalThis.__restoreAnalysis = () => { ReaderModel.prototype.analyse = original; };
    ReaderModel.prototype.analyse = function (options = {}) {
      if (this.paragraphs[0]?.text.startsWith("DELAYED_ANALYSIS")) {
        return original.call(this, {...options, yieldTask: () => new Promise(resolve => { globalThis.__finishAnalysis = resolve; })});
      }
      if (this.paragraphs[0]?.text.startsWith("FAILED_ANALYSIS")) {
        return original.call(this, {...options, score: () => { throw new Error("Fixture analysis failure"); }});
      }
      return original.call(this, options);
    };
  });
  await add(page, "DELAYED_ANALYSIS. A tender embrace.", "Pending analysis", false);
  await page.waitForFunction(() => typeof globalThis.__finishAnalysis === "function");
  assert.match(await page.locator(".story-paragraph").textContent(), /A tender embrace/);
  await page.locator("#connect").click();
  assert.equal(await page.locator("#start").isDisabled(), true, "Silent reading remains available while mapping is pending.");
  await openLibrary(page);
  await page.locator("#story-list button[data-story-id]").filter({hasText: "Pending analysis"}).click();
  await page.evaluate(() => globalThis.__finishAnalysis()); await analysed(page);
  await start(page); await output(page, 1); await page.locator("#stop").click();
  await add(page, "DELAYED_ANALYSIS. An ordinary walk.", "Stale analysis", false);
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "analysing");
  await add(page, "A new story replaces the active session.", "Newer story");
  await page.evaluate(() => globalThis.__finishAnalysis());
  await page.clock.runFor(100);
  assert.equal(await page.locator("#story-title").textContent(), "Newer story", "Late analysis cannot change the active story.");
  await output(page, 0);
  await add(page, "FAILED_ANALYSIS. Still readable.", "Failed analysis", false);
  await page.waitForFunction(() => document.querySelector("#analysis-status").dataset.state === "error");
  assert.equal(await page.locator("#start").isDisabled(), true);
  assert.equal(await page.locator(".story-paragraph").textContent(), "FAILED_ANALYSIS. Still readable.");
  await output(page, 0);
  await page.evaluate(() => globalThis.__restoreAnalysis());
  await openReview(page); await page.locator("#reanalyze").click(); await analysed(page); await closeSettings(page);
  await output(page, 0);
}

async function shortStoryStartChecks(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({width: 1440, height: 1000});
  await add(page, "A quiet first paragraph.\n\nA quiet second paragraph.", "Short start regression");
  assert.equal(await page.locator("#settings-panel").isVisible(), true, "The first story opens with the desktop Settings sidebar.");
  assert.equal(await page.locator("#settings-reader-tab").getAttribute("aria-selected"), "true");
  const layout = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    return {
      left: box("#transport").left - box("#library-panel").right,
      right: box("#settings-panel").left - box("#transport").right,
      footer: box(".library-actions").top - box(".library-scroll").bottom,
      scroll: getComputedStyle(document.querySelector(".library-scroll")).overflowY,
    };
  });
  assert.ok(Math.abs(layout.left) <= 1 && Math.abs(layout.right) <= 1, "The dock fits between the open sidebars.");
  assert.ok(Math.abs(layout.footer) <= 1 && layout.scroll === "auto", "The library scrolls above a fixed action footer.");
  await assertFits(page, "desktop with both sidebars");
  await current(page, 0);
  await openReview(page);
  await setRange(page, "level", 3);
  assert.equal(await page.locator("#level").inputValue(), "3");
  await closeSettings(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.clock.runFor(300);
  assert.ok(await page.evaluate(() => scrollY <= 1), "The short-story regression starts at the document top.");
  await current(page, 0);
  await page.locator("#connect").click();
  await start(page);
  await output(page, 3);
  await current(page, 0);
  await page.locator("#stop").click();
  await output(page, 0);
  assert.equal(await page.locator("#start").isDisabled(), false);
  await page.clock.runFor(1100);
  await start(page);
  await page.clock.runFor(1100);
  await output(page, 3);
  await current(page, 0);
  await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "3", "Start/Stop/restart preserves the first section's manual correction.");
  await page.locator("#delete-story").click();
  await page.waitForFunction(() => document.querySelectorAll(".story-paragraph").length === 0);
  await closeSettings(page);
  await page.locator("#disconnect").click();
  if (viewport) await page.setViewportSize(viewport);
}

async function practiceLibraryChecks(context, origin) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(origin);
    await openSettings(page);
    const launch = page.locator("#control-playground"), dialog = page.locator("#practice-story-dialog");
    const picker = page.locator("#practice-story-choice");
    const sceneModel = page.locator("#scene-model");
    await sceneModel.selectOption("nocturne");
    assert.equal(await sceneModel.inputValue(), "nocturne");
    assert.equal(await page.locator("#nocturne-panel").isVisible(), false);
    await launch.click();
    await dialog.waitFor({state: "visible"});
    assert.deepEqual(await picker.locator("optgroup").evaluateAll(groups => groups.map(group => [group.label, group.children.length])),
      [["Controls with known levels", 3], ["Compare story models", 4]]);
    await assertFits(page, "Mobile practice story chooser", "#practice-story-stop");
    await page.keyboard.press("Escape");
    await dialog.waitFor({state: "hidden"});
    assert.equal(await launch.evaluate(button => document.activeElement === button), true);

    await launch.click();
    await picker.selectOption("after-the-screening");
    assert.match(await page.locator("#practice-story-checkpoints").textContent(), /Section 4 peaks/);
    await page.locator("#practice-story-open").click();
    await analysed(page); await output(page, 0);
    assert.equal(await page.locator("#story-title").textContent(), "After the screening");
    assert.equal(await page.locator("#save-status").getAttribute("data-state"), "session");
    assert.equal(await page.locator("#settings-panel").isHidden(), true, "Opening a phone practice story leaves the text unobstructed.");
    assert.equal(await page.locator("#start").isDisabled(), true, "Opening a practice story never connects the device.");
    await openSettings(page);
    assert.equal(await sceneModel.inputValue(), "nocturne");
    await launch.click(); await picker.selectOption("control-check-v1");
    await page.locator("#practice-story-open").click();
    await analysed(page); await output(page, 0);
    assert.equal(await page.locator("#story-title").textContent(), "Find your rhythm");
    await openSettings(page);
    await sceneModel.selectOption("loom");
    assert.equal(await sceneModel.inputValue(), "loom");
    assert.match(await page.locator("#scene-model-help").textContent(), /fixed levels/);
    assert.equal(await page.locator("#nocturne-panel").isVisible(), false);
  } finally { await page.close(); }
}

async function storageFailureChecks(context, origin) {
  const restricted = await context.newPage();
  const errors = [];
  restricted.on("pageerror", error => errors.push(error.message));
  await restricted.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {get() { throw new DOMException("Storage blocked", "SecurityError"); }});
  });
  await restricted.goto(origin);
  await add(restricted, "An ordinary walk.", "Storage unavailable");
  await openSettings(restricted, "story"); await restricted.locator("#save-story").click();
  await restricted.locator("#confirm-save").click();
  await restricted.waitForFunction(() => document.querySelector("#save-status").dataset.state === "error");
  assert.equal(await restricted.locator(".story-paragraph").textContent(), "An ordinary walk.");
  await closeSettings(restricted);
  await openAppSettings(restricted);
  await restricted.locator("#reading-appearance").selectOption("dark");
  assert.equal(await restricted.locator("html").getAttribute("data-theme"), "dark");
  assert.deepEqual(errors, [], "Storage denial must be handled without runtime errors.");
  await restricted.close();
}

async function libraryDiscoveryChecks(page) {
  const title = await page.locator("#story-title").textContent();
  await openLibrary(page);
  await page.locator("#library-search").fill("afternoon walk");
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 1, "Title search filters the local library.");
  assert.equal(await page.locator("#story-title").textContent(), title, "Filtering never switches the open story.");
  await page.locator("#library-search").fill("no such neutral title");
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 0);
  assert.equal(await page.locator("#story-title").textContent(), title);
  await page.locator("#library-search").fill("");
  await page.locator("#library-sort").selectOption("title");
  const titles = await page.locator("#story-list .story-item-title").allTextContents();
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, "en", {numeric: true, sensitivity: "base"})), "Title sorting matches the selected order.");
  await page.locator("#library-sort").selectOption("progress");
  assert.equal(await page.locator("#story-title").textContent(), title, "Changing the sort preserves the current story.");
  await page.locator("#library-sort").selectOption("updated");
  const firstTab = page.locator("#story-tabs [role=tab]").filter({hasText: "First story"});
  await firstTab.click();
  await page.waitForFunction(() => document.querySelector("#story-title").textContent === "First story");
  await analysed(page); await output(page, 0);
  assert.equal(await firstTab.getAttribute("aria-selected"), "true");
  await page.locator("#story-tabs [role=tab]").filter({hasText: title}).click();
  await page.waitForFunction(value => document.querySelector("#story-title").textContent === value, title);
  await analysed(page); await output(page, 0);
}

async function storyCardChecks(page) {
  const title = await page.locator("#story-title").textContent();
  await openLibrary(page);
  const card = page.locator("#story-list .story-card");
  const action = name => card.locator(`[data-story-action="${name}"]`);
  await action("edit").click();
  await page.locator("#story-details-dialog").waitFor({state: "visible"});
  assert.equal(await page.locator("#story-details-title").inputValue(), title);
  await page.locator("#story-details-description").fill("A neutral summary for the selected card.");
  await page.locator("#story-details-save").click();
  await page.locator("#story-details-dialog").waitFor({state: "hidden"});
  assert.equal(await card.locator(".story-card-description").textContent(), "A neutral summary for the selected card.");
  assert.equal(await action("edit").evaluate(node => node === document.activeElement), true);
  await action("favorite").click();
  assert.equal(await action("favorite").getAttribute("aria-pressed"), "true");
  const [download] = await Promise.all([page.waitForEvent("download"), action("download").click()]);
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(download.suggestedFilename(), "satinlore-story-backup.json");
  assert.equal(backup.stories[0].description, "A neutral summary for the selected card.");
  assert.equal(backup.stories[0].favorite, true);
  await action("duplicate").click(); await analysed(page); await output(page, 0);
  assert.equal(await page.locator("#story-title").textContent(), `${title} (copy)`);
  assert.equal(await action("favorite").getAttribute("aria-pressed"), "false");
  await action("delete").click();
  await page.waitForFunction(copy => ![...document.querySelectorAll("#story-list .story-item-title")].some(node => node.textContent === copy), `${title} (copy)`);
  await selectStory(page, title);
  await action("favorite").click();
  assert.equal(await action("favorite").getAttribute("aria-pressed"), "false");
}

async function backupAndPreferenceChecks(page) {
  await add(page, "A neutral backup fixture.\n\nA quiet walk home.", "Backup fixture");
  await openReview(page); await setRange(page, "level", 0); await closeSettings(page);
  await save(page);
  await backupSettings(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-story").click()]);
  assert.equal(download.suggestedFilename(), "satinlore-story-backup.json", "A private title must not enter the downloaded filename.");
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "The browser produces a real local download for the backup.");
  const raw = await readFile(downloadedPath, "utf8");
  const backup = JSON.parse(raw);
  assert.equal(backup.format, "satinlore-story-backup");
  assert.equal(backup.stories.length, 1);
  assert.equal(backup.stories[0].title, "Backup fixture");
  assert.equal(backup.stories[0].corrections[0], 0, "A backup preserves manual zero.");
  assert.deepEqual(Object.keys(backup.stories[0]).sort(), ["analysisVersion", "corrections", "position", "text", "title"].sort(), "Backup carries story data only, without playback/session state or retained IDs.");
  await page.locator("#import-backup").setInputFiles({name: "restore.json", mimeType: "application/json", buffer: Buffer.from(raw)});
  await page.waitForFunction(() => document.querySelectorAll("#story-list button[data-story-id]").length === 2);
  await analysed(page); await output(page, 0);
  assert.equal(await page.locator("#story-title").textContent(), "Backup fixture (restored)");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 1, "Restoring adds session-only copies; it does not silently persist a second story.");
  assert.equal(await page.locator("#save-status").getAttribute("data-state"), "session");
  await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "0", "A restored manual zero survives fresh local analysis.");
  await closeSettings(page); await backupSettings(page);
  await page.locator("#import-backup").setInputFiles({name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}")});
  await page.waitForFunction(() => /could not|invalid/i.test(document.querySelector("#library-transfer-status").textContent));
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 2, "Rejected backups preserve existing stories.");
  await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await openSettings(page);
  await page.locator("#reading-width").selectOption("full");
  await page.locator("#font-size").selectOption("large");
  await page.locator("#reading-spacing").selectOption("relaxed");
  await page.locator("#follow-scroll").uncheck();
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#new-story").disabled);
  await openSettings(page);
  assert.equal(await page.locator("#reading-width").inputValue(), "full");
  assert.equal(await page.locator("#font-size").inputValue(), "large");
  assert.equal(await page.locator("#reading-spacing").inputValue(), "relaxed");
  assert.equal(await page.locator("#follow-scroll").isChecked(), false);
  assert.equal(await page.locator("body").getAttribute("data-reading-width"), "full");
  assert.equal(await page.locator("#start").isDisabled(), true, "Presentation restoration cannot connect or arm playback.");
  const preferences = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), preferencesKey);
  assert.deepEqual(Object.keys(preferences.preferences).sort(), ["follow", "fontSize", "spacing", "width"].sort());
  await page.locator("#reading-width").selectOption("wide");
  await page.locator("#font-size").selectOption("normal");
  await page.locator("#reading-spacing").selectOption("normal");
  await page.locator("#follow-scroll").check();
  await closeSettings(page);
}

async function refinementChecks(page, setPromptReply) {
  await page.setViewportSize({width: 1440, height: 1000});
  await add(page, "A neutral folder fixture.\n\nAnother quiet paragraph.", "A story on a shelf");
  await openLibrary(page);
  setPromptReply("Practice shelf");
  await page.locator("#create-folder").click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.folders?.length === 1, libraryKey);
  const folderId = await page.locator("#folder-filter").inputValue();
  assert.match(folderId, /^folder-/);
  await openSettings(page, "story");
  await page.locator("#story-folder").selectOption(folderId);
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 0,
    "Creating/moving a folder does not silently save an unsaved story.");
  await save(page);
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).stories[0].folderId?.startsWith("folder-"), libraryKey);
  await page.reload(); await analysed(page); await output(page, 0);
  await openSettings(page, "story");
  assert.equal(await page.locator("#story-folder").inputValue(), folderId, "Saved membership returns paused after reload.");
  await closeSettings(page); await openLibrary(page);
  await page.locator("#folder-filter").selectOption(folderId);
  if (!await page.locator(".folder-tools").evaluate(element => element.open)) await page.locator(".folder-tools > summary").click();
  setPromptReply("Renamed practice shelf");
  await page.locator("#rename-folder").click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).folders[0].name === "Renamed practice shelf", libraryKey);
  await page.locator("#delete-folder").click();
  await page.waitForFunction(key => !JSON.parse(localStorage.getItem(key)).stories[0].folderId, libraryKey);
  assert.equal(await page.locator("#story-title").textContent(), "A story on a shelf", "Removing a folder retains its story.");
  assert.equal(await page.locator("#folder-filter").inputValue(), "unfiled");
  await openAppSettings(page); await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await closeAppSettings(page);

  await prepareToyRehearsal(page, toyRehearsals[0]);
  await assertFits(page, "Guided setup", "#setup-stop");
  await page.locator("#setup-primary").click();
  await page.locator("#setup-coach").waitFor({state: "visible"});
  await analysed(page);
  assert.equal(await page.locator("#story-title").textContent(), "Find your rhythm");
  assert.equal(await page.locator("#save-status").getAttribute("data-state"), "session");
  await start(page); await output(page, 0);
  await page.locator("#next").click(); await current(page, 1);
  await page.clock.runFor(1100); await output(page, 2);
  assert.equal(await page.locator(".simulator-device").getAttribute("data-output"), "2",
    "The side preview observes actual output while the reading sidebar stays open.");
  await page.locator("#level-up").click();
  await page.locator("#level-down").click();
  await setRange(page, "cap", 6);
  assert.equal(await page.locator("#ceiling-dialog").isVisible(), false);
  assert.equal(await page.locator("#status").textContent(), "Simulator running");
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.clock.runFor(150);
  assert.equal(await page.locator(".simulator-device-body").getAttribute("transform"), "translate(0.00 0)",
    "Reduced motion keeps a static device while retaining the actual output readout.");
  await page.locator("#stop").click(); await output(page, 0);
  assert.equal(await page.locator(".simulator-device").getAttribute("data-output"), "0");
  await start(page); await page.clock.runFor(1100); await output(page, 2);
  await page.waitForFunction(() => document.querySelector("#setup-coach-status").textContent.includes("All tried"));
  await page.locator("#setup-finish").click();
  await page.locator("#empty-workspace").waitFor({state: "visible"});
  await output(page, 0);
  await page.emulateMedia({reducedMotion: "no-preference"});

  await toyConnectionChecks(page);
  await combinedSceneChecks(page);
  await sceneStagePatternChecks(page);

  const resourceRequests = [];
  const resourceMonitor = request => {
    if (request.url().includes("example.invalid/satinlore-import-test")) resourceRequests.push(request.url());
  };
  page.on("request", resourceMonitor);
  const html = '<!doctype html><html><head><style>@import "https://example.invalid/satinlore-import-test.css";</style></head><body>' +
    '<h2 class="title">Download fixture</h2><div id="chapters"><div class="userstuff"><p>A quiet downloaded paragraph.</p>' +
    '<script>globalThis.__downloadExecuted = true;</script><img src="https://example.invalid/satinlore-import-test.png" onerror="globalThis.__downloadExecuted=true">' +
    '<p>A second neutral paragraph.</p></div></div></body></html>';
  await newDialog(page);
  await page.locator("#story-title-input").fill("");
  await page.locator("#file").setInputFiles({name: "ao3-download.html", mimeType: "text/html", buffer: Buffer.from(html)});
  await page.locator("#new-story-dialog").waitFor({state: "hidden"});
  await analysed(page);
  assert.equal(await page.locator("#story-title").textContent(), "Download fixture");
  assert.equal(await page.locator(".story-paragraph").count(), 2);
  assert.equal(await page.locator("#paragraph img, #paragraph script, #paragraph style").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__downloadExecuted), undefined);
  assert.deepEqual(resourceRequests, [], "Downloaded HTML stays inert and loads no remote resources.");
  page.off("request", resourceMonitor);
  await openSettings(page);
  assert.equal(await page.locator("#reading-model").count(), 0, "The placeholder story model selector is removed.");
  await closeSettings(page); await openLibrary(page);
  await page.locator("#new-story").click();
  await page.locator("#empty-link-import").click();
  await page.locator("#story-url").fill("https://www.literotica.com/s/a-neutral-fixture?private=discarded#discarded");
  const linkRequests = [];
  const linkMonitor = request => { if (request.url().includes("/api/story-import")) linkRequests.push(request.url()); };
  page.on("request", linkMonitor);
  await page.locator("#import-url").click();
  assert.match(await page.locator("#url-import-status").textContent(), /terms restrict AI use/i);
  assert.equal(await page.locator("#open-source-link").getAttribute("href"), "https://www.literotica.com/s/a-neutral-fixture");
  assert.deepEqual(linkRequests, [], "Literotica presents a source/copy fallback instead of scraping.");
  await page.locator("#paste-source-trigger").click();
  assert.equal(await page.locator("#story-link-import").isHidden(), true);
  assert.equal(await page.locator("#draft-story").evaluate(node => node === document.activeElement), true);
  page.off("request", linkMonitor);
  await closeSettings(page);
  await openAppSettings(page);
  assert.equal(await page.locator('#app-settings-dialog a[href="/help"]').isVisible(), true);
  assert.equal(await page.locator('#app-settings-dialog a[href="/support"]').isVisible(), true);
  assert.match(await page.locator("#account-storage-description").textContent(), /Stories can be kept for this visit or saved on this browser\./,
    "The account section distinguishes durable toy presets from browser-local story text.");
  assert.match(await page.locator("#account-settings-mount").textContent(), /Account presets are available in the signed-in hosted app\./,
    "The local reader reports the real hosted-account requirement instead of a planned or simulated account.");
  assert.equal(await page.locator("#account-welcome").isHidden(), true,
    "The local simulator does not pretend to register a hosted account.");
  assert.equal(await page.locator("#account-settings-mount").getByRole("button", {name: "Download my presets", exact: true}).isDisabled(), true);
  const accountData = page.locator("#account-settings-mount details");
  if (!await accountData.evaluate(element => element.open)) await accountData.locator("summary").click();
  assert.equal(await page.locator("#account-settings-mount").getByRole("button", {name: "Delete account data", exact: true}).isDisabled(), true,
    "Account data operations stay unavailable without a real registered hosted account.");
  await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await closeAppSettings(page);
}

async function readingCompletionChecks(page) {
  const story = Array.from({length: 12}, (_, index) => `Section ${index + 1}. Their passionate tender kiss and romantic embrace expressed affection.`).join("\n\n");
  for (const size of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
    await page.setViewportSize(size);
    await add(page, story, `Completion at ${size.width}px`);
    await openSettings(page);
    await page.locator("#follow-scroll").check();
    await closeSettings(page);
    if (size.width < 1100 && await page.locator("#library-panel").isVisible()) await page.locator("#close-library").click();
    if (await page.locator("#connect").isVisible()) await page.locator("#connect").click();
    await start(page);
    await page.evaluate(() => window.scrollTo({top: document.documentElement.scrollHeight, behavior: "instant"}));
    await page.clock.runFor(400);
    await current(page, 11);
    assert.equal(await page.locator("#reading-sync-state").textContent(), "Finished");
    await output(page, 0);
    assert.equal(await page.locator("#start").textContent(), "Replay");
    assert.equal(await page.locator("#finish-reading").textContent(), "Back to beginning");
    await start(page, false);
    await current(page, 0);
    await output(page, 0);
    await page.locator("#cancel-start").click();
  }
}

export async function checkReader(page, context, origin) {
  await page.clock.install();
  let promptReply = "Renamed afternoon";
  page.on("dialog", dialog => dialog.type() === "prompt" ? dialog.accept(promptReply) : dialog.accept());
  const requests = [];
  const monitor = request => {
    if (/READER_PRIVATE_CANARY|A%20tender%20embrace|A tender embrace/.test(request.url() + (request.postData() || ""))) {
      requests.push(new URL(request.url()).pathname);
    }
  };
  page.on("request", monitor);
  await page.goto(origin);
  assert.equal(await page.locator("#capValue").textContent(), "10", "A fresh simulator starts with a maximum of 10.");
  await appearanceChecks(page);
  await reviewAndFeedbackChecks(context, origin);
  await page.bringToFront();
  await shortStoryStartChecks(page);
  assert.equal(await page.locator("body").getAttribute("data-reading-width"), "wide");
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  await analysisChecks(page);
  await add(page, "A tender embrace.\n\nAn ordinary walk.", "First story");
  await output(page, 0);
  assert.equal(await page.locator("#review-settings").evaluate(element => element.open), false, "Review is optional and closed.");
  await openReview(page);
  assert.equal(await page.locator("#suggested-level").textContent(), "1 / 20");
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 1, "Review does not expose future passages by default.");
  await page.locator("#show-upcoming").click();
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 2);
  await setRange(page, "level", 0);
  await page.locator("#reanalyze").click();
  await analysed(page);
  assert.equal(await page.locator("#level").inputValue(), "0", "Reanalysis preserves manual zero.");
  await page.locator("#reset-level").click();
  assert.equal(await page.locator("#level").inputValue(), "1");
  await closeSettings(page);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ["satinlore.appearance"], "Import and analysis do not opt into persistence.");

  await add(page, neutralStory, "The afternoon walk");
  await libraryDiscoveryChecks(page);
  await storyCardChecks(page);
  await openSettings(page); await page.locator("#follow-scroll").uncheck();
  await openReview(page);
  await setRange(page, "level", 3);
  await closeSettings(page);
  if (!await page.locator("#connect").isDisabled()) await page.locator("#connect").click();
  await start(page, false);
  await output(page, 0);
  await page.locator("#cancel-start").click();
  await output(page, 0);
  await start(page, false);
  await page.locator("#start-stop").click();
  await page.locator("#start-dialog").waitFor({state: "hidden"});
  await output(page, 0);
  await start(page);
  await output(page, 3);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator("#stop").click();
    await output(page, 0);
    assert.equal(await page.locator("#start").isDisabled(), false, `Stop ${cycle + 1} leaves Start available without reconnecting.`);
    await page.clock.runFor(1100); await output(page, 0);
    await start(page);
    await page.clock.runFor(1100); await output(page, 3);
  }
  await page.locator("#level-up").click();
  assert.equal(await page.locator("#target-output").textContent(), "4 / 20");
  await page.clock.runFor(1100);
  await output(page, 4);
  assert.equal(await page.locator("#capValue").textContent(), "10");
  // Read within the click's browser task, before the next heartbeat can send 3.
  const lowered = await page.locator("#level-down").evaluate(button => {
    button.click();
    return [document.querySelector("#target-output").textContent, document.querySelector("#output").textContent];
  });
  assert.deepEqual(lowered, ["3 / 20", "0 / 20"], "A lower resulting command stops the old one immediately.");
  await page.clock.runFor(1100); await output(page, 3);
  await setRange(page, "cap", 0);
  await output(page, 0); await page.clock.runFor(1100); await output(page, 0);
  await setRange(page, "cap", 5);
  assert.equal(await page.locator("#ceiling-dialog").isVisible(), false, "A deliberate maximum change has no second popup.");
  assert.equal(await page.locator("#capValue").textContent(), "5");
  assert.equal(await page.locator("#status").textContent(), "Simulator running", "A direct maximum change does not interrupt a running simulation.");
  await page.clock.runFor(1100); await output(page, 3);
  await page.locator("#pause").click(); await output(page, 0);
  await page.locator("#level-up").click();
  await page.clock.runFor(1100); await output(page, 0);
  await start(page); await output(page, 4);
  await page.locator("#stop").click();
  assert.equal(await page.locator("#target-output").textContent(), "4 / 20", "Pause and Stop retain the current section level.");
  await page.clock.runFor(1100); await output(page, 0);

  await openReview(page); await setRange(page, "level", 0); await closeSettings(page);
  assert.equal(await page.locator("#target-output").textContent(), "0 / 20");
  assert.equal(await page.locator("#level-up").isDisabled(), true, "Explicit zero outranks the level buttons.");
  await start(page); await page.clock.runFor(1100); await output(page, 0);
  await openReview(page); await setRange(page, "level", 3); await closeSettings(page);
  await page.locator("#level-up").click();
  await page.locator("#level-up").click();
  await start(page); await page.clock.runFor(1100); await output(page, 5);
  assert.equal(await page.locator("#target-output").textContent(), "5 / 20");
  assert.equal(await page.locator("#level-up").isDisabled(), true, "The level cannot exceed the confirmed maximum.");
  for (let i = 0; i < 5; i++) await page.locator("#level-down").click();
  assert.equal(await page.locator("#target-output").textContent(), "0 / 20");
  assert.equal(await page.locator("#level-down").isDisabled(), true);
  assert.equal(await page.locator("#capValue").textContent(), "5", "Level changes do not alter the confirmed ceiling.");
  await page.clock.runFor(1100); await output(page, 0);
  await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "3", "The dock level never rewrites the paragraph correction.");
  await closeSettings(page);

  await openSettings(page); await page.locator("#follow-scroll").check(); await closeSettings(page);
  await scrollTo(page, 2); await page.clock.runFor(300); await current(page, 2);
  await scrollTo(page, 3); await scrollTo(page, 6); await page.clock.runFor(300); await current(page, 6);
  await openReview(page); await current(page, 6);
  assert.equal(await page.locator("#review-list [data-review-index]").count(), 7, "Review includes current and read sections without revealing the last future section.");
  await page.locator("#level").focus(); await page.locator("#level").press("Home");
  assert.equal(await page.locator("#level").inputValue(), "0");
  await setRange(page, "level", 3);
  await openSettings(page);
  await page.locator("#reading-width").selectOption("full");
  await current(page, 6);
  assert.equal(await page.locator("body").getAttribute("data-reading-width"), "full");
  await page.locator("#font-size").selectOption("large");
  await page.locator("#reading-spacing").selectOption("relaxed");
  await chooseAppearance(page, "dark");
  await current(page, 6); await output(page, 0);
  await closeSettings(page);
  await openLibrary(page);
  await page.locator("#focus-mode").click();
  assert.equal(await page.locator("#library-panel").isHidden(), true);
  assert.equal(await page.locator("#settings-panel").isHidden(), true);
  await current(page, 6);
  await page.locator("#focus-mode").click();
  assert.equal(await page.locator("#library-panel").isVisible(), true, "Exiting focus restores the prior library arrangement.");
  await current(page, 6);
  await page.locator("#next").click(); await current(page, 7);
  await page.locator("#previous").click(); await current(page, 6);
  await start(page); await output(page, 3);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {configurable: true, get: () => true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await output(page, 0);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(1100); await output(page, 0);
  await start(page); await output(page, 3);
  await page.clock.fastForward(120_100); await output(page, 0);
  assert.match(await page.locator("#message").textContent(), /inactivity|two minutes/i);

  const holder = await context.newPage();
  await holder.goto(origin);
  await holder.evaluate(() => {
    navigator.locks.request("satinlore-simulator-playback", async () => {
      await new Promise(release => { globalThis.__releaseReaderLock = release; });
    });
  });
  await holder.waitForFunction(() => typeof globalThis.__releaseReaderLock === "function");
  await page.bringToFront(); await start(page);
  await page.waitForFunction(() => document.querySelector("#message").textContent.includes("Another tab"));
  await output(page, 0);
  await holder.evaluate(() => globalThis.__releaseReaderLock()); await holder.close();
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    globalThis.__restoreReaderLock = () => { navigator.locks.request = original; };
    navigator.locks.request = (name, options, callback) => name !== "satinlore-simulator-playback" ? original(name, options, callback) : original(name, options, lock =>
      new Promise(resolve => { globalThis.__finishReaderLock = () => resolve(callback(lock)); }));
  });
  await start(page);
  await page.waitForFunction(() => typeof globalThis.__finishReaderLock === "function");
  await page.locator("#stop").click();
  await page.evaluate(() => { globalThis.__finishReaderLock(); globalThis.__restoreReaderLock(); });
  await page.clock.runFor(1100); await output(page, 0);

  await captureLayouts(page);
  await openSettings(page); await page.locator("#follow-scroll").uncheck(); await closeSettings(page);
  await openSettings(page, "story"); await page.locator("#rename-story").click();
  await page.locator("#story-details-title").fill(promptReply);
  await page.locator("#story-details-save").click();
  assert.equal(await page.locator("#story-title").textContent(), promptReply);
  await save(page);
  await page.locator("#next").evaluate(element => { if (!element.disabled) element.click(); });
  await page.clock.runFor(500);
  const savedPosition = Number(await page.locator(".story-paragraph.active").getAttribute("data-index"));
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).stories[0].position ===
    Number(document.querySelector(".story-paragraph.active").dataset.index), libraryKey);
  const savedId = await page.locator("#story-list button[data-story-id]").filter({hasText: promptReply}).getAttribute("data-story-id");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 1);
  await start(page);
  if (await page.locator("#level-up").isEnabled()) await page.locator("#level-up").click();
  await selectStory(page, "First story");
  await output(page, 0);
  await selectStory(page, promptReply); await current(page, savedPosition);
  await add(page, "READER_PRIVATE_CANARY\n\nAn ordinary walk.", "Session only canary");
  assert.deepEqual(requests, [], "Story text must never appear in network requests.");
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).stories.length, libraryKey), 1);
  await page.reload(); await analysed(page); await current(page, savedPosition);
  assert.equal(await page.locator("#story-title").textContent(), promptReply);
  await output(page, 0);
  assert.equal(await page.locator("#start").isDisabled(), true, "Restoration does not reconnect or arm playback.");
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 1, "Session-only stories disappear on reload.");
  assert.equal(await page.locator("#story-list button[data-story-id]").getAttribute("data-story-id"), savedId);
  await openReview(page); await setRange(page, "level", 0); await closeSettings(page);
  await page.clock.runFor(500);
  await page.waitForFunction(({key, position}) => JSON.parse(localStorage.getItem(key)).stories[0].corrections[position] === 0,
    {key: libraryKey, position: savedPosition});
  await page.reload(); await analysed(page); await openReview(page);
  assert.equal(await page.locator("#level").inputValue(), "0", "Saved manual zero survives reload and reanalysis.");
  assert.match(await page.locator("#level-source").textContent(), /manual|your/i, "Restored zero remains a correction rather than an unset value.");
  await closeSettings(page);
  await add(page, "A second saved story.", "Second saved story"); await save(page);
  await openSettings(page, "story"); await page.locator("#delete-story").click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).stories.length === 1, libraryKey);
  await page.reload(); await analysed(page);
  assert.equal(await page.locator("#story-list button[data-story-id]").count(), 1);
  await openSettings(page, "story"); await page.locator("#session-only").click();
  await page.waitForFunction(key => !localStorage.getItem(key) || JSON.parse(localStorage.getItem(key)).stories.length === 0, libraryKey);
  assert.equal(await page.locator(".story-paragraph").count(), 8, "Session only removes the saved copy but keeps text readable.");
  await save(page);
  await openAppSettings(page); await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.reload(); assert.equal(await page.locator(".story-paragraph").count(), 0);

  await page.evaluate(key => localStorage.setItem(key, "{invalid"), libraryKey);
  await page.reload();
  assert.equal(await page.locator(".story-paragraph").count(), 0);
  await page.waitForFunction(() => /corrupt|unreadable|could not|cannot be read|invalid|damaged/i.test(document.querySelector("#library-status").textContent));
  await openAppSettings(page); await page.locator("#delete-all").click();
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    globalThis.__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, libraryKey);
  await add(page, "Still readable after a failed save.", "Quota fixture");
  await openSettings(page, "story"); await page.locator("#save-story").click(); await page.locator("#confirm-save").click();
  await page.waitForFunction(() => document.querySelector("#save-status").dataset.state === "error");
  assert.equal(await page.locator(".story-paragraph").textContent(), "Still readable after a failed save.");
  assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), null);
  await page.evaluate(() => globalThis.__restoreStorage());
  await save(page);
  // Hold the real browser library lock to exercise the in-flight destructive
  // operation. New stories must not be accepted and then silently lost.
  await page.evaluate(() => {
    const original = navigator.locks.request.bind(navigator.locks);
    globalThis.__restoreDeleteLock = () => { navigator.locks.request = original; };
    navigator.locks.request = (name, ...args) => {
      if (name !== "satinlore-local-library") return original(name, ...args);
      const callback = args.at(-1);
      return original(name, async lock => {
        await new Promise(resolve => { globalThis.__finishDelete = resolve; });
        return callback(lock);
      });
    };
  });
  await openAppSettings(page); await page.locator("#delete-all").click();
  await page.waitForFunction(() => typeof globalThis.__finishDelete === "function");
  assert.equal(await page.locator("#new-story").isDisabled(), true, "New stories are unavailable until Delete All completes.");
  assert.equal(await page.locator("#empty-new-story").isDisabled(), true);
  assert.equal(await page.locator("#story-list button[data-story-id]:not(:disabled)").count(), 0);
  await page.evaluate(() => { globalThis.__finishDelete(); globalThis.__restoreDeleteLock(); });
  await page.waitForFunction(key => localStorage.getItem(key) === null, libraryKey);
  await page.waitForFunction(() => !document.querySelector("#new-story").disabled);

  await backupAndPreferenceChecks(page);

  const literal = '<img src="invalid" onerror="globalThis.__storyExecuted=true">';
  await add(page, literal, "Literal text");
  assert.equal(await page.locator("#paragraph img").count(), 0);
  assert.equal(await page.locator(".story-paragraph").textContent(), literal);
  assert.equal(await page.evaluate(() => globalThis.__storyExecuted), undefined);
  await newDialog(page);
  await page.locator("#file").setInputFiles({name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from([0xff])});
  await page.waitForFunction(() => /UTF-8/.test(document.querySelector("#import-status").textContent));
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "delayed.txt") return original.call(this);
      return new Promise(resolve => { globalThis.__finishReaderImport = () => original.call(this).then(resolve); });
    };
  });
  await page.locator("#file").setInputFiles({name: "delayed.txt", mimeType: "text/plain", buffer: Buffer.from("A delayed story.")});
  await page.waitForFunction(() => typeof globalThis.__finishReaderImport === "function");
  await page.locator("#cancel-import").click();
  await page.evaluate(() => globalThis.__finishReaderImport());
  await page.clock.runFor(300);
  assert.equal(await page.locator("#story-title").textContent(), "Literal text", "Closing import invalidates its delayed completion.");
  await storageFailureChecks(context, origin);
  await practiceLibraryChecks(context, origin);
  await page.bringToFront();
  await refinementChecks(page, value => { promptReply = value; });
  assert.deepEqual(await page.evaluate(() => ({local: Object.keys(localStorage).sort(), session: sessionStorage.length})),
    {local: presentationKeys, session: 0}, "Only allowlisted presentation preferences remain after local story deletion.");
  await readingCompletionChecks(page);
  assert.deepEqual(requests, []);
  page.off("request", monitor);
  console.log("Reader browser checks passed: direct typing/paste, header Dark mode switch and gear Close/×, gear appearance/backup/help and truthful hosted-account requirement, folders with paused saved membership, full toy catalogue and ten model rehearsals with explicit selection, finite tests, optional calibration/combined-step exit, opt-in scene overlap, grounded pulse, named channel stops and channel caps, channel-specific practice, disconnect/error recovery and unavailable physical-mode isolation, guided practice and actual-output/reduced-motion visual, inert AO3 HTML and Literotica fallback, short-story first-section Start/Stop/restart, Settings/Advanced tabs, centered dock, fixed library actions, optional review, repeated Start/Stop/restart, popup-free direct maximum, one-step section levels, title search/sort/tabs, backup download/session-only restore, presentation preference reload, sidebar/focus reflow, opt-in persistence and deletion, storage failures, interruption/locks, literal text and local-only privacy. Neutral workspace screenshots captured.");
}
