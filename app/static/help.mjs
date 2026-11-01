const build = document.querySelector('meta[name="satinlore-build"]')?.content;
document.getElementById("help-build").textContent = /^[a-f0-9]{40}$/.test(build ?? "") ? build.slice(0, 12) : "Local development";
if (document.querySelector('meta[name="satinlore-hosted-access"]')?.content === "true") {
  document.getElementById("help-signout").hidden = false;
  document.getElementById("help-signout-note").hidden = false;
}
