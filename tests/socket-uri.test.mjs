import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {build} from "esbuild";
import parseUri from "../app/static/devices/safe-uri.cjs";

test("the bounded WHATWG adapter preserves the fields used by Socket.IO and engine.io",()=>{
  for(const [input,protocol,host,port,path,query]of [
    ["https://apps.lovense-api.com", "https","apps.lovense-api.com","","/",""],
    ["wss://apps.lovense-api.com:30010/fixture?token=a%2Bb", "wss","apps.lovense-api.com","30010","/fixture","token=a%2Bb"],
    ["https://apps.lovense-api.com:443/socket", "https","apps.lovense-api.com","","/socket",""],
    ["127-0-0-1.lovense.club:30010/command", "https","127-0-0-1.lovense.club","30010","/command",""],
    ["http://[::1]:30010/fixture", "http","::1","30010","/fixture", ""],
  ]){
    const actual=parseUri(input);assert.deepEqual([actual.protocol,actual.host,actual.port,actual.path,actual.query],[protocol,host,port,path,query]);
  }
  for(const input of [null,{},"", "x".repeat(8193)])assert.throws(()=>parseUri(input));
  const safe=parseUri("https://apps.lovense-api.com/?__proto__=x&constructor=y");
  assert.equal(Object.getPrototypeOf(safe.queryKey),null);assert.equal({}.polluted,undefined);
});

test("the deployed bridge build replaces the legacy regex URI parser",async()=>{
  const root=fileURLToPath(new URL("../",import.meta.url));
  const script=await readFile(resolve(root,"scripts/build-private-app.mjs"),"utf8");
  assert.match(script,/alias:\s*\{parseuri:\s*resolve\(SOURCE, "devices\/safe-uri\.cjs"\)\}/);
  const result=await build({entryPoints:[resolve(root,"app/static/device-bridge.mjs")],bundle:true,write:false,metafile:true,
    alias:{parseuri:resolve(root,"app/static/devices/safe-uri.cjs")},format:"iife",platform:"browser",target:"es2022",legalComments:"none"});
  const paths=Object.keys(result.metafile.inputs);
  assert.ok(paths.some(path=>path.endsWith("devices/safe-uri.cjs")));
  assert.ok(!paths.some(path=>path.includes("node_modules/parseuri/")));
  assert.ok(!result.outputFiles[0].text.includes("node_modules/parseuri/index.js"));
});
