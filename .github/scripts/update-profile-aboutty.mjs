import { execFile as execFileCallback } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const username = process.env.GITHUB_REPOSITORY_OWNER ?? "pbandj082";
const outputPath = "aboutty.json";
const token = await resolveGitHubToken();
const profileAsciiArt = String.raw` ____   ____      _     _   _  ____       _    ___    ___   ____  
|  _ \ | __ )    / \   | \ | ||  _ \     | |  / _ \  ( _ ) |___ \ 
| |_) ||  _ \   / _ \  |  \| || | | | _  | | | | | | / _ \   __) |
|  __/ | |_) | / ___ \ | |\  || |_| || |_| | | |_| || (_) | / __/ 
|_|    |____/ /_/   \_\|_| \_||____/  \___/   \___/  \___/ |_____|`;

const user = await fetchJson(`https://api.github.com/users/${username}`, token);
const [repos, events, contributions] = await Promise.all([
  fetchRepos(username),
  fetchRecentEvents(username),
  fetchContributions(username)
]);
const ownRepos = repos.filter((repo) => !repo.fork);
const languages = await fetchLanguageBreakdown(ownRepos);
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
      type: "output",
      typingIntervalMs: 0,
      text: [
        { value: profileAsciiArt, color: "#6ee7b7", bold: true }
      ]
    },
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
        ...line("Bio", compact(user.bio ?? "building software in public", 52), "#cbd5e1"),
        ...line("Location", user.location ?? "remote", "#93c5fd"),
        ...line("Followers", formatNumber(user.followers), "#facc15"),
        ...line("Following", formatNumber(user.following), "#facc15"),
        ...line("Updated", updatedAt, "#94a3b8", false)
      ]
    },
    {
      type: "command",
      text: `gh api graphql --field login=${username} --field query=contributions`
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: contributionSegments(contributions)
    },
    {
      type: "command",
      text: `gh api users/${username}/events/public --jq '.[0:5]'`
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: activitySegments(events)
    },
    {
      type: "command",
      text: `github-linguist --user ${username} --summary`
    },
    {
      type: "output",
      typingIntervalMs: 0,
      text: languageSegments(languages)
    }
  ]
};

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updated ${outputPath}`);

async function fetchRepos(owner) {
  const repos = [];

  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchJson(
      `https://api.github.com/users/${owner}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
      token
    );

    repos.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return repos;
}

async function fetchRecentEvents(owner) {
  try {
    const events = await fetchJson(`https://api.github.com/users/${owner}/events/public?per_page=30`, token);
    return events.map(describeEvent).filter(Boolean).slice(0, 5);
  } catch (error) {
    console.warn(`Could not fetch recent activity: ${formatError(error)}`);
    return [];
  }
}

async function fetchContributions(login) {
  const activeToken = token;
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);

  if (!activeToken) {
    return await fetchPublicContributions(login, from, to);
  }

  const query = `
    query ProfileContributions($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          restrictedContributionsCount
        }
      }
    }
  `;

  try {
    const result = await fetchGraphQL(query, {
      login,
      from: from.toISOString(),
      to: to.toISOString()
    }, activeToken);
    const collection = result?.data?.user?.contributionsCollection;

    if (!collection) {
      return null;
    }

    const days = collection.contributionCalendar.weeks.flatMap((week) => week.contributionDays);
    const activeDays = days.filter((day) => day.contributionCount > 0).length;
    const bestDay = days.reduce(
      (best, day) => (day.contributionCount > best.contributionCount ? day : best),
      { date: "unknown", contributionCount: 0 }
    );

    return {
      source: "graphql",
      total: collection.contributionCalendar.totalContributions,
      commits: collection.totalCommitContributions,
      issues: collection.totalIssueContributions,
      pullRequests: collection.totalPullRequestContributions,
      reviews: collection.totalPullRequestReviewContributions,
      restricted: collection.restrictedContributionsCount,
      activeDays,
      bestDay,
      period: `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`
    };
  } catch (error) {
    console.warn(`Could not fetch contribution summary: ${formatError(error)}`);
    return await fetchPublicContributions(login, from, to);
  }
}

async function fetchPublicContributions(login, from, to) {
  try {
    const url = new URL(`https://github.com/users/${login}/contributions`);
    url.searchParams.set("from", from.toISOString().slice(0, 10));
    url.searchParams.set("to", to.toISOString().slice(0, 10));

    const response = await fetch(url, {
      headers: {
        "User-Agent": "aboutty-profile-readme"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub contribution page request failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const totalMatch = html.match(/>\s*([\d,]+)\s+contributions?\s+in\s+(\d{4})\s*</);
    const days = [];
    const cellPattern =
      /<td[^>]*data-date="([^"]+)"[^>]*class="ContributionCalendar-day"[^>]*><\/td>\s*<tool-tip[^>]*>([\s\S]*?)<\/tool-tip>/g;

    for (const match of html.matchAll(cellPattern)) {
      const countMatch = match[2].match(/([\d,]+)\s+contributions?/);
      days.push({
        date: match[1],
        contributionCount: countMatch ? parseNumber(countMatch[1]) : 0
      });
    }

    const activeDays = days.filter((day) => day.contributionCount > 0).length;
    const bestDay = days.reduce(
      (best, day) => (day.contributionCount > best.contributionCount ? day : best),
      { date: "unknown", contributionCount: 0 }
    );

    return {
      source: "public",
      total: totalMatch ? parseNumber(totalMatch[1]) : days.reduce((sum, day) => sum + day.contributionCount, 0),
      commits: null,
      issues: null,
      pullRequests: null,
      reviews: null,
      restricted: null,
      activeDays,
      bestDay,
      period: totalMatch ? `${totalMatch[2]} public calendar` : `${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}`
    };
  } catch (error) {
    console.warn(`Could not fetch public contribution calendar: ${formatError(error)}`);
    return null;
  }
}

async function fetchLanguageBreakdown(repos) {
  const totals = new Map();
  const targetRepos = repos.slice(0, 30);
  const languageMaps = await Promise.all(
    targetRepos.map(async (repo) => {
      try {
        return await fetchJson(repo.languages_url, token);
      } catch {
        return {};
      }
    })
  );

  for (const languageMap of languageMaps) {
    for (const [language, bytes] of Object.entries(languageMap)) {
      totals.set(language, (totals.get(language) ?? 0) + bytes);
    }
  }

  const totalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0);

  if (totalBytes === 0) {
    return [];
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([language, bytes]) => ({
      language,
      percent: Math.round((bytes / totalBytes) * 100)
    }));
}

async function fetchJson(url, activeToken) {
  const response = await fetch(url, {
    headers: createGitHubHeaders(activeToken)
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function fetchGraphQL(query, variables, activeToken) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...createGitHubHeaders(activeToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }

  return result;
}

function createGitHubHeaders(activeToken) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (activeToken) {
    headers.Authorization = `Bearer ${activeToken}`;
  }

  return headers;
}

async function resolveGitHubToken() {
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (envToken) {
    return envToken;
  }

  try {
    const result = await execFile("gh", ["auth", "token"]);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function contributionSegments(contributions) {
  if (!contributions) {
    return [
      { value: "Contribution summary unavailable without GitHub auth", color: "#94a3b8" }
    ];
  }

  const segments = [
    ...line("Period", contributions.period, "#94a3b8"),
    ...line("Contributions", formatNumber(contributions.total), "#6ee7b7")
  ];

  if (contributions.commits !== null) {
    segments.push(...line("Commits", formatNumber(contributions.commits), "#93c5fd"));
  }

  if (contributions.pullRequests !== null) {
    segments.push(...line("Pull requests", formatNumber(contributions.pullRequests), "#c084fc"));
  }

  if (contributions.issues !== null) {
    segments.push(...line("Issues", formatNumber(contributions.issues), "#fb7185"));
  }

  if (contributions.reviews !== null) {
    segments.push(...line("Reviews", formatNumber(contributions.reviews), "#facc15"));
  }

  segments.push(
    ...line("Active days", formatNumber(contributions.activeDays), "#8bd5ca"),
    ...line(
      "Best day",
      `${contributions.bestDay.date} (${formatNumber(contributions.bestDay.contributionCount)})`,
      "#a7f3d0"
    )
  );

  if (contributions.restricted !== null) {
    segments.push(...line("Private count", formatNumber(contributions.restricted), "#94a3b8"));
  }

  return segments;
}

function activitySegments(events) {
  if (events.length === 0) {
    return [{ value: "No recent public activity found", color: "#94a3b8" }];
  }

  return events.flatMap((event, index) => [
    { value: `${event.date} `, color: "#94a3b8" },
    { value: `${event.kind.padEnd(12)} `, color: event.color, bold: true },
    { value: `${compact(event.detail, 54)}${index === events.length - 1 ? "" : "\n"}`, color: "#cbd5e1" }
  ]);
}

function languageSegments(languages) {
  if (languages.length === 0) {
    return [{ value: "No language data found", color: "#94a3b8" }];
  }

  return languages.flatMap((language, index) => [
    { value: `${language.language.padEnd(14)} `, color: "#93c5fd", bold: true },
    { value: bar(language.percent), color: "#6ee7b7" },
    { value: ` ${String(language.percent).padStart(3, " ")}%${index === languages.length - 1 ? "" : "\n"}`, color: "#cbd5e1" }
  ]);
}

function describeEvent(event) {
  const date = event.created_at.slice(0, 10);
  const repo = event.repo?.name ?? "github";

  switch (event.type) {
    case "PushEvent": {
      const count = event.payload?.commits?.length ?? 0;
      return {
        date,
        kind: "push",
        detail: count > 0 ? `${count} commit${count === 1 ? "" : "s"} to ${repo}` : `pushed to ${repo}`,
        color: "#6ee7b7"
      };
    }
    case "PullRequestEvent":
      return {
        date,
        kind: "pull request",
        detail: `${event.payload?.action ?? "updated"} ${repo}`,
        color: "#c084fc"
      };
    case "IssuesEvent":
      return {
        date,
        kind: "issue",
        detail: `${event.payload?.action ?? "updated"} ${repo}`,
        color: "#fb7185"
      };
    case "IssueCommentEvent":
      return {
        date,
        kind: "comment",
        detail: `commented on ${repo}`,
        color: "#facc15"
      };
    case "PullRequestReviewEvent":
      return {
        date,
        kind: "review",
        detail: `${event.payload?.action ?? "reviewed"} ${repo}`,
        color: "#8bd5ca"
      };
    case "CreateEvent":
      return {
        date,
        kind: "create",
        detail: `created ${event.payload?.ref_type ?? "ref"} in ${repo}`,
        color: "#93c5fd"
      };
    case "WatchEvent":
      return {
        date,
        kind: "star",
        detail: `starred ${repo}`,
        color: "#facc15"
      };
    case "ForkEvent":
      return {
        date,
        kind: "fork",
        detail: `forked ${repo}`,
        color: "#c084fc"
      };
    case "ReleaseEvent":
      return {
        date,
        kind: "release",
        detail: `${event.payload?.action ?? "published"} ${repo}`,
        color: "#6ee7b7"
      };
    default:
      return {
        date,
        kind: event.type.replace(/Event$/, "").toLowerCase(),
        detail: repo,
        color: "#94a3b8"
      };
  }
}

function line(label, value, color, includeNewline = true) {
  return [
    { value: `${label.padEnd(15)} `, color: "#94a3b8" },
    { value: `${String(value)}${includeNewline ? "\n" : ""}`, color, bold: true }
  ];
}

function bar(percent) {
  const filled = Math.max(1, Math.round(percent / 10));
  const empty = Math.max(0, 10 - filled);
  return `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
}

function compact(value, maxLength) {
  const normalized = String(value).replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function parseNumber(value) {
  return Number(value.replaceAll(",", ""));
}
