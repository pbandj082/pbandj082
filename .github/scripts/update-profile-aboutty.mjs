import { execFile as execFileCallback } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const username = process.env.GITHUB_REPOSITORY_OWNER ?? "pbandj082";
const outputPath = "aboutty.json";

const user = await fetchJson(`https://api.github.com/users/${username}`);
const repos = await fetchRepos(username);
const ownRepos = repos.filter((repo) => !repo.fork);
const topRepos = [...ownRepos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 5);
const topLanguages = summarizeLanguages(ownRepos).slice(0, 5);
const totalStars = ownRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
const totalForks = ownRepos.reduce((sum, repo) => sum + repo.forks_count, 0);
const profileCommitCount = await readGitOutput(["rev-list", "--count", "HEAD"], "0");
const updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const config = {
  "$schema": "https://raw.githubusercontent.com/pbandj082/aboutty/main/schema/aboutty.schema.json",
  title: "github profile",
  username,
  hostname: "github",
  prompt: "$",
  width: 860,
  padding: 24,
  fontSize: 14,
  lineHeight: 22,
  loop: true,
  stepIntervalMs: 28,
  theme: {
    background: "#101418",
    border: "#2a3138",
    title: "#d7dee6",
    username: "#6ee7b7",
    hostname: "#93c5fd",
    separator: "#8bd5ca",
    prompt: "#6ee7b7",
    text: "#f8fafc",
    command: "#f8fafc",
    output: "#cbd5e1"
  },
  steps: [
    {
      type: "command",
      text: "whoami"
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: username
    },
    {
      type: "command",
      text: `neofetch --source github --user ${username}`
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: [
        { value: `${username}@github\n`, color: "#6ee7b7", bold: true },
        { value: "----------------\n", color: "#475569" },
        ...line("Name", user.name ?? username, "#f8fafc"),
        ...line("Bio", compact(user.bio ?? "building software in public", 48), "#cbd5e1"),
        ...line("Location", user.location ?? "remote", "#93c5fd"),
        ...line("Company", user.company ?? "independent", "#c084fc"),
        ...line("Followers", formatNumber(user.followers), "#facc15"),
        ...line("Following", formatNumber(user.following), "#facc15"),
        ...line("Public repos", formatNumber(user.public_repos), "#6ee7b7"),
        ...line("Owned repos", formatNumber(ownRepos.length), "#6ee7b7"),
        ...line("Total stars", formatNumber(totalStars), "#facc15"),
        ...line("Total forks", formatNumber(totalForks), "#c084fc"),
        ...line("Profile commits", profileCommitCount, "#6ee7b7"),
        ...line("Languages", topLanguages.join(", ") || "unknown", "#8bd5ca"),
        ...line("Updated", updatedAt, "#94a3b8", false)
      ]
    },
    {
      type: "command",
      text: `gh repo list ${username} --limit 5 --sort stargazers`
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: repoSegments(topRepos)
    },
    {
      type: "command",
      text: "aboutty aboutty.json --out assets/aboutty.svg"
    },
    {
      type: "output",
      text: [
        { value: "Rendering GitHub profile SVG" },
        { value: "...", repeat: 3, repeatDelayMs: 280, typingIntervalMs: 160, color: "#6ee7b7" }
      ]
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: "Generated assets/aboutty.svg"
    }
  ]
};

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updated ${outputPath}`);

async function fetchRepos(owner) {
  const repos = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchJson(
      `https://api.github.com/users/${owner}/repos?type=owner&sort=updated&per_page=100&page=${page}`
    );

    repos.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return repos;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: createGitHubHeaders()
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

function createGitHubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function readGitOutput(args, fallback) {
  try {
    const result = await execFile("git", args);
    return result.stdout.trim() || fallback;
  } catch {
    return fallback;
  }
}

function line(label, value, color, includeNewline = true) {
  return [
    { value: `${label.padEnd(15)} `, color: "#94a3b8" },
    { value: `${String(value)}${includeNewline ? "\n" : ""}`, color, bold: true }
  ];
}

function repoSegments(repos) {
  if (repos.length === 0) {
    return [{ value: "No public repositories found", color: "#94a3b8" }];
  }

  return repos.flatMap((repo, index) => [
    { value: `${String(index + 1).padStart(2, " ")}. `, color: "#475569" },
    { value: compact(repo.name, 24).padEnd(24, " "), color: "#93c5fd", bold: true },
    { value: ` stars ${String(repo.stargazers_count).padStart(4, " ")}`, color: "#facc15" },
    { value: `  ${repo.language ?? "Unknown"}${index === repos.length - 1 ? "" : "\n"}`, color: "#cbd5e1" }
  ]);
}

function summarizeLanguages(repos) {
  const counts = new Map();

  for (const repo of repos) {
    if (!repo.language) {
      continue;
    }

    counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([language]) => language);
}

function compact(value, maxLength) {
  const normalized = String(value).replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
