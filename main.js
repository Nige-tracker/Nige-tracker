import { renderVotes } from "./modules/votes.js";
import { renderInterests } from "./modules/interests.js";

const MEMBER_ID = 5091;

// Simple tab switcher
const tabs = document.querySelectorAll("nav.tabs button");
const sections = {
  votes: document.getElementById("votes"),
  interests: document.getElementById("interests")
};
tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    Object.values(sections).forEach(s => s.classList.add("hidden"));
    sections[btn.dataset.tab].classList.remove("hidden");
  });
});

// Initial renders
renderVotes(sections.votes, MEMBER_ID);
renderInterests(sections.interests, MEMBER_ID);
