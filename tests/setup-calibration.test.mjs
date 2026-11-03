import test from "node:test";
import assert from "node:assert/strict";
import {createCalibrationView, calibrationFeature, calibrationDraft, CALIBRATION_FIELDS} from "../app/static/reader/calibration-view.mjs";
import {createSetupFlow, SETUP_STORIES} from "../app/static/reader/setup-flow.mjs";
import {setupDOM} from "./helpers/setup-dom.mjs";

const context = overrides => ({model: "flexer", mode: "simulator", connected: true, selectedId: "sim-flexer", channels: ["vibrate", "fingering"], ceiling: 5, output: 0, ...overrides});
function viewHarness(options = {}) {
  const dom = setupDOM(), changes = [], events = [], tests = [], applied = [], complete = [], stops = [];
  const view = createCalibrationView({...dom, mount: dom.make("div"), onChange: value => changes.push(value), onEvent: value => events.push(value),
    onStop: () => stops.push(true), onTest: value => {tests.push(value); return true;}, onConfirmTest: () => true,
    onApply: value => {applied.push(value); return true;}, onComplete: value => complete.push(value), ...options});
  const click = id => dom.nodes.get(id).click();
  const input = async (id,value,event="input") => {dom.nodes.get(id).value=String(value); await dom.nodes.get(id).dispatch(event);};
  return {...dom,view,changes,events,tests,applied,complete,stops,click,input};
}

test("calibration explains only discovered movements and never automatically sends a test", async () => {
  const app=viewHarness(); app.view.open(context({channels:["fingering","unknown","fingering"]}));
  assert.deepEqual(app.nodes.get("calibration-channel").children.map(el=>el.value),["fingering"]);
  assert.match(app.nodes.get("calibration-feature-title").textContent,/Fingering/);
  assert.match(app.nodes.get("calibration-feature-copy").textContent,/separately/);
  assert.equal(calibrationFeature("unknown"),null);
  assert.equal(app.tests.length,0);assert.equal(app.applied.length,0);
  await app.click("calibration-next");
  assert.equal(app.view.snapshot().stage,"levels");
  await app.input("calibration-level",2);
  assert.equal(app.tests.length,0);assert.equal(app.applied.length,0);
  assert.equal(app.changes.at(-1).apply,false);
  assert.equal(app.changes.at(-1).settings.minimum,2);
  assert.equal(app.nodes.get("calibration-feature-glyph").dataset.running,"false");
  app.view.update({output:2});assert.equal(app.nodes.get("calibration-feature-glyph").dataset.running,"true");
  assert.match(app.nodes.get("calibration-live-output").textContent,/Simulated output: 2/);
  app.view.update({mode:"lovense"});assert.equal(app.nodes.get("calibration-feature-glyph").dataset.running,"false");
});

test("ratings require a completed stopped test and current human confirmation", async () => {
  let confirmed=false;
  const app=viewHarness({onConfirmTest:()=>confirmed});app.view.open(context());await app.click("calibration-next");
  await app.input("calibration-level",1);
  await app.click("calibration-rating-good"); assert.equal(app.events.some(x=>x.type==="calibration_rating"),false);
  await app.click("calibration-test"); assert.deepEqual(app.tests,[{channel:"vibrate",level:1}]);
  app.nodes.get("calibration-stopped").checked=true;await app.nodes.get("calibration-stopped").dispatch("change");
  assert.equal(app.view.snapshot().accepted,false);
  confirmed=true;app.nodes.get("calibration-stopped").checked=true;await app.nodes.get("calibration-stopped").dispatch("change");
  await app.click("calibration-rating-good");assert.equal(app.events.at(-1).rating,"good");
  await app.input("calibration-level",2); assert.equal(app.view.snapshot().accepted,false);
  assert.equal(app.nodes.get("calibration-rating-good").disabled,true);
});

test("unknown or active output cannot be confirmed even if a test request returned", async () => {
  const app=viewHarness();app.view.open(context());await app.click("calibration-next");await app.input("calibration-level",1);await app.click("calibration-test");
  for(const output of [1,null,undefined]) {
    app.view.update({output}); assert.equal(app.nodes.get("calibration-stopped").disabled,true);
    app.nodes.get("calibration-stopped").checked=true;await app.nodes.get("calibration-stopped").dispatch("change");assert.equal(app.view.snapshot().accepted,false);
  }
});

test("Stop invalidates a pending test and its late acknowledgement cannot enable ratings", async () => {
  let resolve;
  const app=viewHarness({onTest:()=>new Promise(done=>{resolve=done;})});app.view.open(context());await app.click("calibration-next");await app.input("calibration-level",1);
  const pending=app.click("calibration-test");assert.equal(app.view.snapshot().busy,true);
  app.view.interrupt();resolve(true);await pending;
  assert.equal(app.view.snapshot().busy,false);assert.equal(app.view.snapshot().tested,false);
  assert.equal(app.nodes.get("calibration-stopped").disabled,true);assert.equal(app.applied.length,0);
});

test("connection loss cancels pending calibration without repeated Stop recursion", async () => {
  let resolve,stops=0,view;
  const app=viewHarness({onTest:()=>new Promise(done=>{resolve=done;}),onStop:()=>{stops++;view?.update({output:0});}});view=app.view;
  view.open(context());await app.click("calibration-next");await app.input("calibration-level",1);
  const pending=app.click("calibration-test");view.update({connected:false,connectionState:"disconnected"});resolve(true);await pending;
  assert.equal(view.snapshot().tested,false);assert.equal(view.snapshot().busy,false);assert.ok(stops<10);
  assert.equal(app.nodes.get("calibration-test").disabled,true);
});

test("per-movement drafts and explicit apply remain separate; a failed apply is not reported saved", async () => {
  const app=viewHarness({onApply:()=>false});app.view.open(context());await app.click("calibration-next");await app.input("calibration-level",2);
  for(let i=0;i<CALIBRATION_FIELDS.length;i++)await app.click("calibration-next");
  assert.equal(app.view.snapshot().stage,"summary");await app.click("calibration-apply");
  assert.match(app.nodes.get("calibration-status").textContent,/not applied/);
  assert.equal(app.view.snapshot().draft.minimum,2);
  await app.click("calibration-next"); assert.equal(app.view.snapshot().channel,"fingering");
  assert.equal(app.view.snapshot().draft.minimum,0);
  assert.equal(app.view.snapshot().settings.vibrate.minimum,2);
});

test("maximum zero remains zero and live tests cannot exceed the physical beta ceiling", async () => {
  const app=viewHarness();app.view.open(context({mode:"lovense",ceiling:20,channels:["vibrate"]}));await app.click("calibration-next");
  assert.equal(app.nodes.get("calibration-level").max,"5");
  await app.input("calibration-level",6);assert.equal(app.view.snapshot().draft.minimum,0);
  app.view.update({ceiling:0});await app.click("calibration-test");assert.equal(app.tests.length,0);
  await app.input("calibration-level",1);assert.equal(app.nodes.get("calibration-test").disabled,true);await app.click("calibration-test");assert.equal(app.tests.length,0);
  assert.equal(app.view.snapshot().draft.maximum,5,"A zero playback maximum does not erase a draft preference.");
  assert.deepEqual(calibrationDraft({minimum:9,background:2,preferred:20,maximum:4,recovery:8,gain:99,rhythm:"bad"},5),
    {minimum:4,background:4,preferred:4,maximum:4,recovery:4,gain:1,rhythm:"steady"});
});

test("extended setup leads from verified device to calibration then controlled story, never automatic Start", async () => {
  const dom=setupDOM(), calls=[], toy={id:"sim-flexer",label:"Flexer",model:"flexer",capabilities:["vibrate","fingering"]};let flow;
  flow=createSetupFlow({...dom,enableCalibration:true,onStop:()=>calls.push("stop"),
    onConnect:()=>({mode:"simulator",connected:true,toys:[toy],selectedId:null,ceiling:5,output:0}),
    onSelectDevice:id=>({selectedId:id}),onTest:()=>true,onConfirmTest:()=>true,
    onPractice:story=>{calls.push(story);return true;},onStart:()=>calls.push("start")});
  const click=id=>dom.nodes.get(id).click();flow.open({model:"flexer"});await click("setup-primary");
  dom.nodes.get("setup-devices").value="sim-flexer";await dom.nodes.get("setup-devices").dispatch("change");await click("setup-primary");await click("setup-test");
  dom.nodes.get("setup-response-checked").checked=true;await dom.nodes.get("setup-response-checked").dispatch("change");await click("setup-primary");
  assert.equal(flow.snapshot().phase,"calibrate");assert.match(dom.nodes.get("calibration-capabilities").children[1].children[1].textContent,/Fingering/);
  await click("calibration-skip-movement");await click("calibration-skip-movement");assert.equal(flow.snapshot().phase,"practice");
  dom.nodes.get("setup-practice-story").value="rain-at-window-v1";await click("setup-primary");
  assert.equal(calls.at(-1).betaId,"rain-at-window-v1");assert.equal(calls.includes("start"),false);
  assert.equal(flow.snapshot().phase,"reading");
  flow.openCalibration();assert.equal(flow.snapshot().phase,"calibrate");assert.equal(calls.includes("start"),false);
  flow.update({connected:false,connectionState:"disconnected"});assert.equal(flow.snapshot().phase,"pair");assert.equal(flow.calibrationSnapshot().active,false);
});

test("controlled story fixtures have exact authored mappings and no external source data",()=>{
  assert.equal(SETUP_STORIES.length,3);
  assert.equal(new Set(SETUP_STORIES.map(x=>x.betaId)).size,3);
  for(const story of SETUP_STORIES){assert.equal(story.controlled,true);assert.equal(story.authoredLevels,true);assert.equal(story.quietZeros,true);assert.equal(story.text.split("\n\n").length,story.corrections.length);assert.ok(story.corrections.every(x=>Number.isInteger(x)&&x>=0&&x<=5));}
});

test("qualified live oscillation has truthful live wording and simulator wording stays distinct",()=>{
  const app=viewHarness();app.view.open(context({mode:"lovense",model:"osci3",channels:["oscillate"]}));
  assert.equal(app.nodes.get("calibration-feature-title").textContent,"Oscillation");
  assert.doesNotMatch(app.nodes.get("calibration-feature-copy").textContent,/does not send|simulator only/);
  app.view.open(context({mode:"simulator",model:"osci3",channels:["oscillate"]}));
  assert.equal(app.nodes.get("calibration-feature-title").textContent,"Oscillation · simulator");
});

test("saved calibration is re-exposed without applying it or lowering it to a paused playback ceiling",()=>{
  const app=viewHarness(), saved={minimum:2,background:3,preferred:8,maximum:12,recovery:1,gain:1.3,rhythm:"gentle"};
  app.view.open(context({ceiling:0,settings:{vibrate:saved}}));assert.deepEqual(app.view.snapshot().draft,saved);
  assert.equal(app.tests.length,0);assert.equal(app.applied.length,0);assert.equal(app.changes.length,0);
});

test("combining movements is explicit, requires individually checked actions and applies paused",async()=>{
  const combinations=[],app=viewHarness({onApplyChannels:value=>{combinations.push({value,stops:app.stops.length});return true;}});
  app.view.open(context({supportsCombined:true,verifiedChannels:["vibrate"]}));
  await app.click("calibration-skip-movement");await app.click("calibration-skip-movement");
  assert.equal(app.view.snapshot().stage,"together");assert.equal(app.nodes.get("calibration-combine-fingering").disabled,true);
  assert.equal(app.nodes.get("calibration-together-apply").disabled,true);assert.equal(combinations.length,0);
  app.view.update({verifiedChannels:["vibrate","fingering"]});
  for(const name of ["vibrate","fingering"]){app.nodes.get("calibration-combine-"+name).checked=true;await app.nodes.get("calibration-combine-"+name).dispatch("change");}
  assert.equal(app.nodes.get("calibration-together-apply").disabled,false);
  const before=app.stops.length;await app.click("calibration-together-apply");
  assert.deepEqual(combinations[0].value.channels,["vibrate","fingering"]);assert.ok(combinations[0].stops>before);
  assert.match(app.nodes.get("calibration-status").textContent,/Output is paused/);
  assert.equal(app.tests.length,0,"Applying a combination does not start a test or reading output.");
  app.view.update({connected:false,connectionState:"disconnected"});assert.equal(app.nodes.get("calibration-together-apply").disabled,true);
});

test("personal range requires checked live movement and explicit grant, without applying or raising the chosen maximum",async()=>{
  let grants=0;
  const app=viewHarness({onEnablePersonalRange:()=>{grants++;return {maxCeiling:20,personalRangeChannels:["vibrate"],ceiling:5,output:0};}});
  app.view.open(context({mode:"lovense",maxCeiling:5,channels:["vibrate"]}));
  assert.equal(app.nodes.get("calibration-enable-personal-range").disabled,true);await app.click("calibration-enable-personal-range");assert.equal(grants,0);
  app.view.update({verifiedChannels:["vibrate"]});assert.equal(app.nodes.get("calibration-enable-personal-range").disabled,false);
  await app.click("calibration-enable-personal-range");assert.equal(grants,1);assert.equal(app.applied.length,0);assert.equal(app.tests.length,0);
  assert.equal(app.view.snapshot().draft.maximum,5,"Grant does not raise a maximum or apply a saved setting.");
  assert.match(app.nodes.get("calibration-personal-range-copy").textContent,/maximum is still 5/);
  for(let i=0;i<4;i++)await app.click("calibration-next");
  assert.equal(app.view.snapshot().field,"maximum");assert.equal(app.nodes.get("calibration-level").max,"20");
  await app.input("calibration-level",12);assert.equal(app.view.snapshot().draft.maximum,12);
  assert.equal(app.nodes.get("calibration-test").disabled,true,"Higher draft is not the current applied test ceiling.");
  await app.click("calibration-test");assert.equal(app.tests.length,0);
});

test("a grant keeps an intentional zero ceiling authoritative and a saved preset cannot grant permission",async()=>{
  const app=viewHarness({onEnablePersonalRange:()=>({maxCeiling:20,personalRangeChannels:["vibrate"],ceiling:0,output:0})});
  app.view.open(context({mode:"lovense",maxCeiling:5,ceiling:0,channels:["vibrate"],settings:{vibrate:{minimum:8,background:9,preferred:12,maximum:20}}}));
  assert.equal(app.nodes.get("calibration-level").max,"5");assert.equal(app.nodes.get("calibration-enable-personal-range").disabled,true);
  app.view.update({verifiedChannels:["vibrate"]});await app.click("calibration-enable-personal-range");await app.click("calibration-next");
  assert.match(app.nodes.get("calibration-personal-range-copy").textContent,/maximum is still 0/);
  assert.equal(app.nodes.get("calibration-test").disabled,true);assert.equal(app.tests.length,0);assert.equal(app.applied.length,0);
});

test("personal range cannot borrow another channel's grant",async()=>{
  const app=viewHarness({onEnablePersonalRange:()=>true});
  app.view.open(context({mode:"lovense",maxCeiling:20,personalRangeChannels:["vibrate"],verifiedChannels:["vibrate","fingering"]}));
  assert.equal(app.nodes.get("calibration-level").max,"20");
  await app.input("calibration-channel","fingering","change");
  assert.equal(app.nodes.get("calibration-level").max,"5");assert.equal(app.nodes.get("calibration-enable-personal-range").disabled,false);
});
